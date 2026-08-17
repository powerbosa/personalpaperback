#!/usr/bin/env node
/**
 * Lists the sources currently installed in src/ and whether each one passes
 * inspection. Read-only.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { inspectSource } from './lib/inspect-source.mjs';

const SRC_DIR = path.resolve(process.cwd(), 'src');

async function main() {
  let entries = [];
  try {
    entries = (await fs.readdir(SRC_DIR, { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);
  } catch {
    console.log('\n  src/ does not exist yet.\n');
    return;
  }

  console.log('');
  if (entries.length === 0) {
    console.log('  No sources installed. The repository will build with "sources": [].');
    console.log('');
    console.log('  Add one with:  npm run add-source -- <path-to-source-folder>');
    console.log('');
    return;
  }

  let failures = 0;
  for (const id of entries) {
    const { errors } = await inspectSource(path.join(SRC_DIR, id));
    if (errors.length === 0) {
      console.log(`  OK      ${id}`);
    } else {
      failures++;
      console.log(`  BROKEN  ${id}`);
      for (const error of errors) {
        console.log(`            ${error.split('\n')[0]}`);
      }
    }
  }
  console.log('');
  console.log(`  ${entries.length} source(s), ${failures} broken.`);
  console.log('');

  if (failures > 0) process.exit(1);
}

main().catch(error => {
  console.error(`  list-sources failed: ${error.message}`);
  process.exit(1);
});
