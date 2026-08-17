/**
 * Static inspection of a candidate Paperback 0.8 source directory.
 *
 * Used by add-source.mjs to refuse anything that would corrupt the repository.
 * This runs BEFORE the source is copied into src/, so a bad source never lands
 * in the tree at all.
 *
 * Everything here is deliberately static analysis: the source is never
 * imported or executed, so inspecting an untrusted folder cannot run its code.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { CONTENT_RATINGS } from './schema.mjs';

/**
 * Markers that only exist in the Paperback 0.9 extension API. A 0.9 source
 * cannot be mechanically converted to 0.8 — the interfaces genuinely differ —
 * so we reject rather than guess.
 */
const V09_MARKERS = [
  { pattern: /@paperback\/types['"]?\s*:\s*['"]\^?0\.9/, hint: 'depends on @paperback/types 0.9' },
  { pattern: /\bextends\s+Extension\b/, hint: 'uses the 0.9 `Extension` base class' },
  { pattern: /\bimplements\s+(?:Chapter|Manga|Discover|Search)Providing\b/, hint: 'uses 0.9 `*Providing` interfaces' },
  { pattern: /\bDiscoverSectionType\b/, hint: 'uses the 0.9 `DiscoverSectionType` enum' },
  { pattern: /\bgetDiscoverSections\s*\(/, hint: 'implements `getDiscoverSections` (0.9 replaced `getHomePageSections`)' },
  { pattern: /\bregisterInterceptor\s*\(/, hint: 'uses the 0.9 interceptor registration API' },
  { pattern: /\bSourceInterceptor\b/, hint: 'uses the 0.9 `SourceInterceptor` type' },
  { pattern: /from\s+['"]@paperback\/types\/lib\/v9/, hint: 'imports from a 0.9 types path' },
];

/** Fields required on the exported `<Id>Info` object for a 0.8 source. */
const REQUIRED_INFO_FIELDS = ['version', 'name', 'icon', 'author', 'description', 'contentRating', 'websiteBaseURL'];

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Inspect a directory. Returns { id, errors, warnings, entryFile, iconFile }.
 * `errors` non-empty means the source must be rejected.
 */
export async function inspectSource(sourceDir) {
  const errors = [];
  const warnings = [];
  const resolved = path.resolve(sourceDir);
  const id = path.basename(resolved);

  // --- The directory itself.
  if (!(await exists(resolved))) {
    return { id, errors: [`Directory does not exist: ${resolved}`], warnings, entryFile: null, iconFile: null };
  }
  if (!(await fs.stat(resolved)).isDirectory()) {
    return { id, errors: [`Not a directory: ${resolved}`], warnings, entryFile: null, iconFile: null };
  }

  // --- The id must be a safe folder name; the toolchain uses it as a path
  // --- segment and as a JS identifier lookup key.
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(id)) {
    errors.push(
      `Folder name '${id}' is not a valid source id. ` +
      'It must start with a letter and contain only letters, digits and underscores.'
    );
  }

  // --- The entry point. The toolchain requires src/<Id>/<Id>.ts exactly.
  const entryFile = path.join(resolved, `${id}.ts`);
  if (!(await exists(entryFile))) {
    errors.push(
      `Missing entry file: ${id}/${id}.ts\n` +
      `    Paperback 0.8 requires the entry file to be named after its folder.`
    );
    return { id, errors, warnings, entryFile: null, iconFile: null };
  }

  const entrySource = await fs.readFile(entryFile, 'utf8');

  // --- Reject 0.9 sources rather than attempting an unsafe conversion.
  const v09Hits = V09_MARKERS.filter(marker => marker.pattern.test(entrySource));
  if (v09Hits.length > 0) {
    errors.push(
      `This looks like a Paperback 0.9 source, which cannot be used in a 0.8 repository:\n` +
      v09Hits.map(hit => `      - ${hit.hint}`).join('\n') +
      `\n    The 0.8 and 0.9 extension APIs are genuinely different. Porting it is a\n` +
      `    manual code change; this tool will not guess at a conversion.`
    );
  }

  // --- The exported SourceInfo object.
  const infoExport = new RegExp(`export\\s+const\\s+${id}Info\\b`);
  if (!infoExport.test(entrySource)) {
    errors.push(
      `Missing export: ${id}/${id}.ts must export a const named '${id}Info'.\n` +
      `    The toolchain reads Sources.${id}Info to build the manifest entry.`
    );
  } else {
    // Light structural check of the info object's fields. This is a textual
    // check because the TypeScript is not compiled at this point.
    for (const field of REQUIRED_INFO_FIELDS) {
      if (!new RegExp(`\\b${field}\\s*:`).test(entrySource)) {
        errors.push(`${id}Info appears to be missing the required field '${field}'.`);
      }
    }

    const ratingMatch = entrySource.match(/contentRating\s*:\s*(?:ContentRating\.)?['"]?([A-Z]+)['"]?/);
    if (ratingMatch && !CONTENT_RATINGS.includes(ratingMatch[1])) {
      errors.push(
        `${id}Info.contentRating is '${ratingMatch[1]}', expected one of: ${CONTENT_RATINGS.join(', ')}`
      );
    }
  }

  // --- The icon, which must live in includes/ next to the source.
  const includesDir = path.join(resolved, 'includes');
  let iconFile = null;

  const iconMatch = entrySource.match(/\bicon\s*:\s*['"]([^'"]+)['"]/);
  if (!iconMatch) {
    errors.push(`Could not determine the icon filename from ${id}Info.icon.`);
  } else {
    const iconName = iconMatch[1];
    iconFile = path.join(includesDir, iconName);
    if (!(await exists(includesDir))) {
      errors.push(`Missing directory: ${id}/includes/`);
    } else if (!(await exists(iconFile))) {
      errors.push(
        `Missing icon: ${id}/includes/${iconName}\n` +
        `    ${id}Info.icon refers to '${iconName}', which must exist in the includes folder.`
      );
    }
  }

  return { id, errors, warnings, entryFile, iconFile };
}
