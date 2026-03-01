// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001F]/g;
const EXT_RE = /\.([a-z0-9]{1,10})$/;
const RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);
const MAX_LEN = 200;

/**
 * Sanitize a filename using a strict cross-platform allowlist.
 *
 * Only a-z, 0-9, hyphens, and underscores survive in the stem.
 * All other characters are replaced with hyphens and collapsed.
 *
 * Pipeline:
 * 1. Strip control characters (0x00–0x1F)
 * 2. Convert to lowercase
 * 3. Split extension from stem (last '.' where suffix is 1–10 alphanumeric)
 * 4. Replace any char NOT in [a-z0-9_] with '-'
 * 5. Collapse consecutive hyphens ('---' → '-')
 * 6. Trim leading/trailing hyphens, underscores, and dots from stem
 * 7. Prefix Windows reserved names (CON, PRN, etc.) with '_'
 * 8. Truncate to 200 chars preserving extension; re-trim trailing hyphens
 * 9. Return "unnamed" (or "unnamed.ext") if empty
 */
export function sanitizeFilename(name: string): string {
  // 1. Strip control characters + 2. Convert to lowercase
  const lower = name.replace(CONTROL_RE, '').toLowerCase();

  // 3. Split extension from stem
  let ext = '';
  let stemInput: string;
  const extMatch = lower.match(EXT_RE);
  if (extMatch) {
    ext = extMatch[1];
    stemInput = lower.slice(0, lower.length - ext.length - 1);
  } else {
    stemInput = lower;
  }

  // 4. Replace any char NOT in [a-z0-9_] with '-'
  let stem = stemInput.replace(/[^a-z0-9_]/g, '-');

  // 5. Collapse consecutive hyphens
  stem = stem.replace(/-{2,}/g, '-');

  // 6. Trim leading/trailing hyphens, underscores, and dots
  stem = stem.replace(/^[-_.]+|[-_.]+$/g, '');

  // If stem is empty after cleanup, return early
  if (!stem) {
    return ext ? `unnamed.${ext}` : 'unnamed';
  }

  // 7. Prefix Windows reserved names
  if (RESERVED_NAMES.has(stem.toUpperCase())) {
    stem = '_' + stem;
  }

  // Build result
  let result = ext ? `${stem}.${ext}` : stem;

  // 8. Truncate to 200 chars preserving extension; re-trim trailing hyphens
  if (result.length > MAX_LEN) {
    if (ext) {
      const extWithDot = `.${ext}`;
      const keep = MAX_LEN - extWithDot.length;
      const truncated = stem.slice(0, keep).replace(/[-_.]+$/, '');
      result = truncated ? `${truncated}${extWithDot}` : `unnamed${extWithDot}`;
    } else {
      const truncated = result.slice(0, MAX_LEN).replace(/[-_.]+$/, '');
      result = truncated || 'unnamed';
    }
  }

  return result;
}
