#!/usr/bin/env node
/**
 * Builds the repository with the demo source temporarily staged into src/,
 * to exercise the complete Paperback 0.8 pipeline end to end:
 *
 *   TypeScript -> esbuild bundle -> includes/ copy -> SourceInfo extraction
 *   -> versioning.json -> schema validation -> asset existence checks
 *
 * The demo source lives in demo/ and is never part of the production
 * repository. src/ is always restored to its original state, including when
 * the build fails, so running this can never change what gets deployed.
 *
 * The toolchain hardcodes src/ as its input directory (bundle.js ->
 * findSourceEntryPoints), which is why the demo has to be staged rather than
 * pointed at directly.
 */

import { promises as fs } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, 'src');
const DEMO_DIR = path.join(ROOT, 'demo');
const DEMO_ID = 'Example';
const STAGED = path.join(SRC_DIR, DEMO_ID);

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  return result.status ?? 1;
}

async function main() {
  const demoSource = path.join(DEMO_DIR, DEMO_ID);

  if (!(await exists(demoSource))) {
    console.error(`  Demo source not found at demo/${DEMO_ID}`);
    process.exit(1);
  }

  if (await exists(STAGED)) {
    console.error('');
    console.error(`  src/${DEMO_ID} already exists, so staging the demo would overwrite it.`);
    console.error(`  Remove or rename it first:  npm run remove-source -- ${DEMO_ID}`);
    console.error('');
    process.exit(1);
  }

  console.log('');
  console.log(`  Staging demo/${DEMO_ID} into src/ for a pipeline test`);

  await fs.mkdir(SRC_DIR, { recursive: true });
  await fs.cp(demoSource, STAGED, { recursive: true });

  let status = 1;
  try {
    status = run('npx', ['paperback', 'bundle']);
    if (status === 0) {
      status = run(process.execPath, [path.join('scripts', 'validate-manifest.mjs')]);
    }
  } finally {
    // Always unstage, including on build failure or Ctrl-C, so the production
    // tree is never left containing the demo source.
    await fs.rm(STAGED, { recursive: true, force: true });
    console.log(`  Unstaged src/${DEMO_ID}`);
  }

  if (status !== 0) {
    console.error('');
    console.error('  Demo pipeline test FAILED.');
    console.error('');
    process.exit(status);
  }

  console.log('');
  console.log('  Demo pipeline test PASSED.');
  console.log('  bundles/ now contains the DEMO build; run `npm run bundle` before deploying.');
  console.log('');
}

main().catch(async error => {
  await fs.rm(STAGED, { recursive: true, force: true }).catch(() => {});
  console.error(`  bundle:demo failed: ${error.message}`);
  process.exit(1);
});
