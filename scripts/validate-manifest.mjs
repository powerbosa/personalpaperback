#!/usr/bin/env node
/**
 * Validates the locally generated bundles/versioning.json BEFORE it is deployed.
 *
 * This is the gate that prevents publishing a repository capable of producing
 * Swift DecodingError.keyNotFound / typeMismatch in Paperback 0.8. It exits
 * non-zero on any error, which fails the CI job before the deploy step runs.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { validateManifest, scanForLocalURLs } from './lib/schema.mjs';

const BUNDLES_DIR = path.resolve(process.cwd(), 'bundles');
const MANIFEST_PATH = path.join(BUNDLES_DIR, 'versioning.json');

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const errors = [];
  const warnings = [];

  if (!(await exists(MANIFEST_PATH))) {
    fail([
      `MANIFEST: ${path.relative(process.cwd(), MANIFEST_PATH)} does not exist.`,
      'Run `npm run bundle` first.',
    ]);
  }

  const raw = await fs.readFile(MANIFEST_PATH, 'utf8');

  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (error) {
    fail([`MANIFEST: bundles/versioning.json is not valid JSON: ${error.message}`]);
  }

  // Schema + type checks shared with the public validator.
  const result = validateManifest(manifest);
  errors.push(...result.errors);
  warnings.push(...result.warnings);

  // No machine-local URLs anywhere in the manifest.
  errors.push(...scanForLocalURLs(raw, 'bundles/versioning.json'));

  // Every asset the manifest references must actually exist on disk. The
  // toolchain checks the icon during generation, but not source.js, and a
  // manifest that points at a missing bundle is broken in the client.
  for (const source of result.sources) {
    if (!source || typeof source.id !== 'string') continue;

    const sourceJs = path.join(BUNDLES_DIR, source.id, 'source.js');
    if (!(await exists(sourceJs))) {
      errors.push(
        `SOURCE VALIDATION FAILED: ${source.id}\n    Missing bundle: ${source.id}/source.js`
      );
    }

    if (typeof source.icon === 'string' && source.icon) {
      const icon = path.join(BUNDLES_DIR, source.id, 'includes', source.icon);
      if (!(await exists(icon))) {
        errors.push(
          `SOURCE VALIDATION FAILED: ${source.id}\n    Missing icon: includes/${source.icon}`
        );
      }
    }
  }

  // Scan the generated homepage too; it embeds the repository base URL.
  const indexPath = path.join(BUNDLES_DIR, 'index.html');
  if (await exists(indexPath)) {
    const html = await fs.readFile(indexPath, 'utf8');
    errors.push(...scanForLocalURLs(html, 'bundles/index.html'));
  } else {
    warnings.push('bundles/index.html was not generated (the homepage is optional).');
  }

  report({ errors, warnings, manifest, sources: result.sources });
}

function report({ errors, warnings, manifest, sources }) {
  for (const warning of warnings) {
    console.warn(`  WARN  ${warning}`);
  }

  if (errors.length > 0) {
    fail(errors);
  }

  console.log('');
  console.log('  Local manifest validation: PASSED');
  console.log(`    buildTime     ${manifest.buildTime}`);
  console.log(`    toolchain     ${manifest.builtWith.toolchain}`);
  console.log(`    types         ${manifest.builtWith.types}`);
  console.log(`    sources       ${sources.length}`);
  for (const source of sources) {
    console.log(`                  - ${source.id} v${source.version}`);
  }
  console.log('');
}

function fail(errors) {
  console.error('');
  console.error('  VALIDATION FAILED');
  console.error('');
  for (const error of errors) {
    console.error(`    ${error}`);
  }
  console.error('');
  console.error(`  ${errors.length} error(s). Refusing to deploy.`);
  console.error('');
  process.exit(1);
}

main().catch(error => {
  console.error('');
  console.error(`  VALIDATION CRASHED: ${error.message}`);
  console.error('');
  process.exit(1);
});
