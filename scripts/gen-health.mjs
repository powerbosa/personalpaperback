#!/usr/bin/env node
/**
 * Writes bundles/health.json — a small public status file that can be opened
 * in Safari to tell at a glance whether the repository itself is healthy,
 * without needing Paperback or a terminal.
 *
 * Deliberately contains no credentials, tokens, local paths or hostnames:
 * every value below is either a constant, a version string, or a count.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { validateManifest } from './lib/schema.mjs';

const BUNDLES_DIR = path.resolve(process.cwd(), 'bundles');
const MANIFEST_PATH = path.join(BUNDLES_DIR, 'versioning.json');
const HEALTH_PATH = path.join(BUNDLES_DIR, 'health.json');

async function main() {
  const raw = await fs.readFile(MANIFEST_PATH, 'utf8');
  const manifest = JSON.parse(raw);
  const { errors, sources } = validateManifest(manifest);

  const health = {
    status: errors.length === 0 ? 'ok' : 'error',
    manifest: errors.length === 0 ? 'valid' : 'invalid',
    toolchain: manifest?.builtWith?.toolchain ?? 'unknown',
    types: manifest?.builtWith?.types ?? 'unknown',
    paperbackVersion: '0.8',
    sourceCount: sources.length,
    sources: sources.filter(Boolean).map(source => ({ id: source.id, version: source.version })),
    lastDeploy: manifest?.buildTime ?? null,
    // Set by the CI workflow so the health file names the deployment it belongs to.
    deploymentId: process.env.DEPLOYMENT_ID ?? null,
  };

  await fs.writeFile(HEALTH_PATH, `${JSON.stringify(health, null, 2)}\n`);
  console.log(`  Wrote bundles/health.json (status=${health.status}, sources=${health.sourceCount})`);

  // If the manifest is invalid we still write the file (so the public health
  // endpoint can report the problem), but we fail the build.
  if (errors.length > 0) {
    console.error('  health.json reports an invalid manifest; failing.');
    process.exit(1);
  }
}

main().catch(error => {
  console.error(`  Could not generate health.json: ${error.message}`);
  process.exit(1);
});
