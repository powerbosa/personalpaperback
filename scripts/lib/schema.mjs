/**
 * The Paperback 0.8 repository schema, expressed as data.
 *
 * This is the single source of truth used by both the local validator
 * (scripts/validate-manifest.mjs) and the public validator
 * (scripts/validate-public.mjs), so the two can never drift apart.
 *
 * The field list is derived from the toolchain's own manifest generator
 * (@paperback/toolchain@0.8.7 -> dist/commands/bundle.js, generateSourceInfo)
 * and from @paperback/types@0.8.7 -> lib/base/SourceInfo.d.ts.
 *
 * Paperback 0.8's Swift decoder is strict: a missing key raises
 * DecodingError.keyNotFound and a wrong type raises DecodingError.typeMismatch.
 * Either one makes the app reject the WHOLE repository, not just one source.
 */

export const EXPECTED_TOOLCHAIN = '0.8.7';
export const EXPECTED_TYPES = '0.8.7';

/** Valid ContentRating values (SourceInfo.d.ts -> enum ContentRating). */
export const CONTENT_RATINGS = ['EVERYONE', 'MATURE', 'ADULT'];

/** Valid BadgeColor values (Badge.d.ts -> enum BadgeColor). */
export const BADGE_COLORS = ['default', 'success', 'info', 'warning', 'danger'];

/**
 * Every key the toolchain writes into each entry of `sources[]`.
 * `required: true` means Paperback 0.8 will hard-fail without it.
 */
export const SOURCE_FIELDS = [
  { key: 'id', type: 'string', required: true, nonEmpty: true },
  { key: 'name', type: 'string', required: true, nonEmpty: true },
  { key: 'author', type: 'string', required: true },
  { key: 'desc', type: 'string', required: true },
  { key: 'website', type: 'string', required: false },
  { key: 'contentRating', type: 'string', required: true, oneOf: CONTENT_RATINGS },
  { key: 'version', type: 'string', required: true, nonEmpty: true },
  { key: 'icon', type: 'string', required: true, nonEmpty: true },
  { key: 'tags', type: 'badge[]', required: false },
  { key: 'websiteBaseURL', type: 'string', required: true, nonEmpty: true },
  { key: 'intents', type: 'number', required: true },
];

/**
 * Patterns that must never appear in anything we publish. A deployed
 * repository referencing any of these would only work on the machine that
 * built it, which defeats the point of hosting it publicly.
 */
export const LOCAL_URL_PATTERNS = [
  { label: 'localhost', re: /\blocalhost\b/i },
  { label: '127.0.0.0/8 loopback', re: /\b127\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/ },
  { label: '0.0.0.0', re: /\b0\.0\.0\.0\b/ },
  { label: '192.168.0.0/16 private', re: /\b192\.168\.\d{1,3}\.\d{1,3}\b/ },
  { label: '10.0.0.0/8 private', re: /\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/ },
  { label: '172.16.0.0/12 private', re: /\b172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/ },
  { label: '169.254.0.0/16 link-local', re: /\b169\.254\.\d{1,3}\.\d{1,3}\b/ },
  { label: '.local mDNS hostname', re: /\bhttps?:\/\/[a-z0-9-]+\.local\b/i },
  { label: 'file:// URL', re: /\bfile:\/\//i },
  { label: 'absolute unix build path', re: /(?:"|')\/(?:home|Users|tmp|var|root)\//},
];

/** True when `value` is a plain object (not null, not an array). */
export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate a parsed versioning.json against the Paperback 0.8 schema.
 * Pure function: takes the manifest, returns { errors, warnings, sources }.
 * Callers decide how to report. Never throws on malformed input.
 */
export function validateManifest(manifest) {
  const errors = [];
  const warnings = [];

  if (!isPlainObject(manifest)) {
    return { errors: ['manifest is not a JSON object'], warnings, sources: [] };
  }

  // --- buildTime: the exact key whose absence produced the original
  // --- "DecodingError.keyNotFound: Key 'buildTime' not found".
  if (!('buildTime' in manifest)) {
    errors.push(
      "MANIFEST: missing 'buildTime'. Paperback 0.8 requires this top-level key; " +
      'a Paperback 0.9 manifest does not have it and will fail to decode in 0.8.'
    );
  } else if (typeof manifest.buildTime !== 'string') {
    errors.push(
      `MANIFEST: 'buildTime' must be a string, got ${describeType(manifest.buildTime)}`
    );
  } else if (Number.isNaN(Date.parse(manifest.buildTime))) {
    errors.push(`MANIFEST: 'buildTime' is not a parseable timestamp: ${manifest.buildTime}`);
  }

  // --- builtWith
  if (!('builtWith' in manifest)) {
    errors.push("MANIFEST: missing 'builtWith'");
  } else if (!isPlainObject(manifest.builtWith)) {
    errors.push(`MANIFEST: 'builtWith' must be an object, got ${describeType(manifest.builtWith)}`);
  } else {
    for (const key of ['toolchain', 'types']) {
      const value = manifest.builtWith[key];
      if (value === undefined) {
        errors.push(`MANIFEST: missing 'builtWith.${key}'`);
      } else if (typeof value !== 'string' || value.trim() === '') {
        errors.push(`MANIFEST: 'builtWith.${key}' must be a non-empty string, got ${describeType(value)}`);
      }
    }
    // Drifting onto a 0.9 toolchain is the single most likely way this
    // repository silently stops working, so treat it as a hard error.
    const { toolchain, types } = manifest.builtWith;
    if (typeof toolchain === 'string' && toolchain !== EXPECTED_TOOLCHAIN) {
      errors.push(
        `MANIFEST: built with toolchain ${toolchain}, expected ${EXPECTED_TOOLCHAIN}. ` +
        'Dependencies must stay pinned to the Paperback 0.8 line.'
      );
    }
    if (typeof types === 'string' && types !== EXPECTED_TYPES) {
      errors.push(
        `MANIFEST: built with types ${types}, expected ${EXPECTED_TYPES}.`
      );
    }
  }

  // --- sources
  let sources = [];
  if (!('sources' in manifest)) {
    errors.push("MANIFEST: missing 'sources'");
  } else if (!Array.isArray(manifest.sources)) {
    errors.push(`MANIFEST: 'sources' must be an array, got ${describeType(manifest.sources)}`);
  } else {
    sources = manifest.sources;
    // An empty repository is valid and decodes fine; it just has nothing in it.
    if (sources.length === 0) {
      warnings.push("MANIFEST: 'sources' is empty. The repository is valid but contains no extensions.");
    }
    sources.forEach((source, index) => {
      // The toolchain pushes the result of a failed .catch() into sources[],
      // which JSON.stringify renders as null. One null here breaks decoding
      // of the entire repository in the Paperback client.
      if (source === null || source === undefined) {
        errors.push(
          `SOURCE VALIDATION FAILED: sources[${index}] is ${source === null ? 'null' : 'undefined'}. ` +
          'This means a source failed during manifest generation (usually a missing icon). ' +
          'Run the build locally and read the "- <SourceName> Error" line to identify it.'
        );
        return;
      }
      if (!isPlainObject(source)) {
        errors.push(`SOURCE VALIDATION FAILED: sources[${index}] is ${describeType(source)}, expected an object`);
        return;
      }
      const label = typeof source.id === 'string' && source.id ? source.id : `sources[${index}]`;
      for (const field of SOURCE_FIELDS) {
        errors.push(...validateField(source, field, label));
      }
    });
  }

  return { errors, warnings, sources };
}

/** Validate one field of one source entry. Returns an array of error strings. */
function validateField(source, field, label) {
  const errors = [];
  const present = field.key in source && source[field.key] !== undefined && source[field.key] !== null;

  if (!present) {
    if (field.required) {
      errors.push(
        `SOURCE VALIDATION FAILED: ${label}\n    Missing required field '${field.key}' ` +
        `(Paperback 0.8 raises DecodingError.keyNotFound without it)`
      );
    }
    return errors;
  }

  const value = source[field.key];

  if (field.type === 'badge[]') {
    if (!Array.isArray(value)) {
      errors.push(`SOURCE VALIDATION FAILED: ${label}\n    '${field.key}' must be an array, got ${describeType(value)}`);
      return errors;
    }
    value.forEach((badge, i) => {
      if (!isPlainObject(badge)) {
        errors.push(`SOURCE VALIDATION FAILED: ${label}\n    '${field.key}[${i}]' must be an object, got ${describeType(badge)}`);
        return;
      }
      if (typeof badge.text !== 'string') {
        errors.push(`SOURCE VALIDATION FAILED: ${label}\n    '${field.key}[${i}].text' must be a string, got ${describeType(badge.text)}`);
      }
      if (typeof badge.type !== 'string') {
        errors.push(`SOURCE VALIDATION FAILED: ${label}\n    '${field.key}[${i}].type' must be a string, got ${describeType(badge.type)}`);
      } else if (!BADGE_COLORS.includes(badge.type)) {
        errors.push(
          `SOURCE VALIDATION FAILED: ${label}\n    '${field.key}[${i}].type' is '${badge.type}', ` +
          `expected one of: ${BADGE_COLORS.join(', ')}`
        );
      }
    });
    return errors;
  }

  if (field.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      errors.push(`SOURCE VALIDATION FAILED: ${label}\n    '${field.key}' must be a number, got ${describeType(value)}`);
    }
    return errors;
  }

  if (typeof value !== field.type) {
    errors.push(`SOURCE VALIDATION FAILED: ${label}\n    '${field.key}' must be a ${field.type}, got ${describeType(value)}`);
    return errors;
  }

  if (field.nonEmpty && value.trim() === '') {
    errors.push(`SOURCE VALIDATION FAILED: ${label}\n    '${field.key}' must not be empty`);
  }

  if (field.oneOf && !field.oneOf.includes(value)) {
    errors.push(
      `SOURCE VALIDATION FAILED: ${label}\n    '${field.key}' is '${value}', ` +
      `expected one of: ${field.oneOf.join(', ')}`
    );
  }

  return errors;
}

/** Scan arbitrary text for machine-local URLs. Returns an array of error strings. */
export function scanForLocalURLs(text, whereLabel) {
  const errors = [];
  for (const { label, re } of LOCAL_URL_PATTERNS) {
    const match = text.match(re);
    if (match) {
      errors.push(`LOCAL DEPENDENCY: ${whereLabel} contains a ${label} reference: ${match[0]}`);
    }
  }
  return errors;
}

/** Human-readable type name for error messages. */
export function describeType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}
