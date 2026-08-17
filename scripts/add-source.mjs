#!/usr/bin/env node
/**
 * Installs a Paperback 0.8 source folder into src/.
 *
 *   npm run add-source -- <path-to-source-folder> [--force]
 *
 * The source is fully inspected first and only copied if it passes. If it
 * cannot be validated the command fails and the repository is left untouched,
 * so a bad source can never half-land in the tree.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { inspectSource } from './lib/inspect-source.mjs';

const SRC_DIR = path.resolve(process.cwd(), 'src');

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function usage() {
  console.error('');
  console.error('  Usage: npm run add-source -- <path-to-source-folder> [--force]');
  console.error('');
  console.error('  The folder must be a Paperback 0.8 source laid out as:');
  console.error('');
  console.error('    MySource/');
  console.error('      MySource.ts          exports `MySourceInfo`');
  console.error('      includes/');
  console.error('        icon.png');
  console.error('');
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const sourcePath = args.find(arg => !arg.startsWith('--'));

  if (!sourcePath) usage();

  console.log('');
  console.log(`  Inspecting ${sourcePath}`);

  const { id, errors, warnings } = await inspectSource(sourcePath);

  for (const warning of warnings) {
    console.warn(`    WARN  ${warning}`);
  }

  if (errors.length > 0) {
    console.error('');
    console.error(`  SOURCE REJECTED: ${id}`);
    console.error('');
    for (const error of errors) {
      console.error(`    ${error}`);
    }
    console.error('');
    console.error('  Nothing was copied. The repository is unchanged.');
    console.error('');
    process.exit(1);
  }

  console.log(`    Layout, ${id}Info metadata and icon all look correct.`);

  // --- Install.
  const destination = path.join(SRC_DIR, id);

  if (await exists(destination)) {
    if (!force) {
      console.error('');
      console.error(`  src/${id} already exists.`);
      console.error(`  Re-run with --force to replace it, or remove it first:`);
      console.error(`      npm run remove-source -- ${id}`);
      console.error('');
      process.exit(1);
    }
    console.log(`    Replacing the existing src/${id} (--force)`);
    await fs.rm(destination, { recursive: true, force: true });
  }

  await fs.mkdir(SRC_DIR, { recursive: true });
  await fs.cp(path.resolve(sourcePath), destination, { recursive: true });

  // --- Re-inspect in its installed location, so we never report success for
  // --- something that got mangled on the way in.
  const post = await inspectSource(destination);
  if (post.errors.length > 0) {
    await fs.rm(destination, { recursive: true, force: true });
    console.error('');
    console.error(`  SOURCE REJECTED AFTER COPY: ${id}`);
    for (const error of post.errors) {
      console.error(`    ${error}`);
    }
    console.error('');
    console.error('  The partially copied folder has been removed.');
    console.error('');
    process.exit(1);
  }

  console.log('');
  console.log(`  Added src/${id}`);
  console.log('');
  console.log('  Next: commit and push. CI rebuilds, validates and deploys automatically.');
  console.log('');
  console.log(`      git add src/${id} && git commit -m "Add ${id} source" && git push`);
  console.log('');
}

main().catch(error => {
  console.error('');
  console.error(`  add-source failed: ${error.message}`);
  console.error('');
  process.exit(1);
});
