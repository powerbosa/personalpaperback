#!/usr/bin/env node
/**
 * Validates the LIVE, PUBLICLY DEPLOYED repository over HTTPS.
 *
 * A green `npm run bundle` only proves the build worked on the build machine.
 * This script proves the thing an iPhone on cellular data actually reaches is
 * correct: it fetches the real GitHub Pages URLs and re-runs the full schema
 * validation against what the CDN served, then checks every referenced asset.
 *
 * Usage: node scripts/validate-public.mjs [baseURL]
 *   baseURL defaults to the `baseURL` field in package.json.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { validateManifest, scanForLocalURLs } from './lib/schema.mjs';

// GitHub Pages serves from a CDN that can lag a few seconds to a couple of
// minutes behind a deployment. Treat a 404 as "not propagated yet" and retry
// rather than as a permanent failure.
const MAX_ATTEMPTS = 12;
const RETRY_DELAY_MS = 15_000;
const REQUEST_TIMEOUT_MS = 20_000;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function readBaseURL() {
  const fromArgv = process.argv[2];
  if (fromArgv) return fromArgv.replace(/\/+$/, '');

  const pkg = JSON.parse(await fs.readFile(path.resolve(process.cwd(), 'package.json'), 'utf8'));
  if (!pkg.baseURL) {
    console.error('  No baseURL in package.json and none passed on the command line.');
    process.exit(1);
  }
  return String(pkg.baseURL).replace(/\/+$/, '');
}

/** Fetch with a timeout. Returns { ok, status, body, error }. */
async function request(url, { method = 'GET' } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method,
      signal: controller.signal,
      headers: { 'cache-control': 'no-cache', 'user-agent': 'paperback-repo-validator' },
    });
    const body = method === 'GET' ? await response.text() : '';
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return { ok: false, status: 0, body: '', error: error.name === 'AbortError' ? 'timeout' : error.message };
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch a URL, retrying while Pages propagates. */
async function fetchWithRetry(url, label) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await request(url);
    if (response.ok) {
      if (attempt > 1) console.log(`    ${label}: available after ${attempt} attempts`);
      return response;
    }

    const reason = response.error ? response.error : `HTTP ${response.status}`;
    const retryable = response.status === 404 || response.status === 0 || response.status >= 500;

    if (!retryable || attempt === MAX_ATTEMPTS) {
      return response;
    }

    console.log(`    ${label}: ${reason}, waiting for Pages propagation (${attempt}/${MAX_ATTEMPTS})`);
    await sleep(RETRY_DELAY_MS);
  }
  return { ok: false, status: 0, body: '', error: 'exhausted retries' };
}

async function main() {
  const baseURL = await readBaseURL();
  const manifestURL = `${baseURL}/versioning.json`;
  const healthURL = `${baseURL}/health.json`;

  console.log('');
  console.log('  Verifying the public deployment');
  console.log(`    base      ${baseURL}/`);
  console.log(`    manifest  ${manifestURL}`);
  console.log('');

  const errors = [];

  // --- 1. The base URL, which is what gets pasted into Paperback.
  const root = await fetchWithRetry(`${baseURL}/`, 'base URL');
  if (!root.ok) {
    errors.push(`PUBLIC: base URL ${baseURL}/ returned ${root.error ?? `HTTP ${root.status}`}`);
  } else {
    console.log(`    base URL            HTTP ${root.status}`);
  }

  // --- 2. The manifest Paperback resolves from that base URL.
  const manifestResponse = await fetchWithRetry(manifestURL, 'versioning.json');
  if (!manifestResponse.ok) {
    errors.push(
      `PUBLIC: ${manifestURL} returned ${manifestResponse.error ?? `HTTP ${manifestResponse.status}`}`
    );
    fail(errors);
  }
  console.log(`    versioning.json     HTTP ${manifestResponse.status}`);

  let manifest;
  try {
    manifest = JSON.parse(manifestResponse.body);
  } catch (error) {
    errors.push(`PUBLIC: versioning.json is not valid JSON: ${error.message}`);
    fail(errors);
  }

  // --- 3. Re-run the exact same schema validation against the served bytes.
  const result = validateManifest(manifest);
  errors.push(...result.errors.map(e => `PUBLIC: ${e}`));
  errors.push(...scanForLocalURLs(manifestResponse.body, 'the deployed versioning.json'));

  if (result.errors.length === 0) {
    console.log(`    schema              VALID`);
    console.log(`    buildTime           ${manifest.buildTime}`);
    console.log(`    builtWith           toolchain ${manifest.builtWith.toolchain}, types ${manifest.builtWith.types}`);
    console.log(`    sources             ${result.sources.length}`);
  }

  // --- 4. Every asset each source references must be publicly reachable.
  for (const source of result.sources) {
    if (!source || typeof source.id !== 'string') continue;

    const assets = [`${baseURL}/${source.id}/source.js`];
    if (typeof source.icon === 'string' && source.icon) {
      assets.push(`${baseURL}/${source.id}/includes/${source.icon}`);
    }

    for (const assetURL of assets) {
      const asset = await fetchWithRetry(assetURL, path.basename(assetURL));
      if (!asset.ok) {
        errors.push(
          `PUBLIC ASSET FAILED: ${source.id}\n    ${assetURL} returned ` +
          `${asset.error ?? `HTTP ${asset.status}`}`
        );
      } else {
        console.log(`    asset               HTTP ${asset.status}  ${assetURL.slice(baseURL.length + 1)}`);
      }
    }
  }

  // --- 5. The health endpoint.
  const health = await fetchWithRetry(healthURL, 'health.json');
  if (!health.ok) {
    errors.push(`PUBLIC: ${healthURL} returned ${health.error ?? `HTTP ${health.status}`}`);
  } else {
    try {
      const parsed = JSON.parse(health.body);
      console.log(`    health.json         HTTP ${health.status}  status=${parsed.status}`);
      if (parsed.status !== 'ok') {
        errors.push(`PUBLIC: health.json reports status='${parsed.status}'`);
      }
    } catch (error) {
      errors.push(`PUBLIC: health.json is not valid JSON: ${error.message}`);
    }
  }

  if (errors.length > 0) fail(errors);

  console.log('');
  console.log('  Public deployment validation: PASSED');
  console.log('');
}

function fail(errors) {
  console.error('');
  console.error('  PUBLIC VALIDATION FAILED');
  console.error('');
  for (const error of errors) {
    console.error(`    ${error}`);
  }
  console.error('');
  console.error(`  ${errors.length} error(s). The deployed repository is NOT safe to use.`);
  console.error('');
  process.exit(1);
}

main().catch(error => {
  console.error('');
  console.error(`  PUBLIC VALIDATION CRASHED: ${error.message}`);
  console.error('');
  process.exit(1);
});
