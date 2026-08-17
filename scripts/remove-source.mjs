#!/usr/bin/env node
/**
 * Removes a source from src/.
 *
 *   npm run remove-source -- <source-id>
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const SRC_DIR = path.resolve(process.cwd(), 'src');

async function listSourceIds() {
  try {
    const entries = await fs.readdir(SRC_DIR, { withFileTypes: true });
    return entries.filter(entry => entry.isDirectory()).map(entry => entry.name);
  } catch {
    return [];
  }
}

async function main() {
  const target = process.argv.slice(2).find(arg => !arg.startsWith('--'));

  if (!target) {
    console.error('');
    console.error('  Usage: npm run remove-source -- <source-id>');
    console.error('');
    const ids = await listSourceIds();
    console.error(ids.length > 0 ? `  Installed: ${ids.join(', ')}` : '  No sources are currently installed.');
    console.error('');
    process.exit(1);
  }

  // Accept either a bare id or a path like src/MySource.
  const id = path.basename(target.replace(/[/\\]+$/, ''));
  const destination = path.join(SRC_DIR, id);

  // Refuse anything that would escape src/.
  if (path.dirname(path.resolve(destination)) !== SRC_DIR) {
    console.error(`  Refusing to remove '${target}': it is outside src/.`);
    process.exit(1);
  }

  try {
    await fs.access(destination);
  } catch {
    console.error('');
    console.error(`  src/${id} does not exist.`);
    const ids = await listSourceIds();
    console.error(ids.length > 0 ? `  Installed: ${ids.join(', ')}` : '  No sources are currently installed.');
    console.error('');
    process.exit(1);
  }

  await fs.rm(destination, { recursive: true, force: true });

  console.log('');
  console.log(`  Removed src/${id}`);
  console.log('');
  console.log('  Next: commit and push. CI rebuilds, validates and deploys automatically.');
  console.log('');
  console.log(`      git add -A src && git commit -m "Remove ${id} source" && git push`);
  console.log('');
}

main().catch(error => {
  console.error(`  remove-source failed: ${error.message}`);
  process.exit(1);
});
