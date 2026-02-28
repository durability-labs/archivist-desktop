const ILLEGAL_RE = /[<>:"/\\|?*]/g;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001F]/g;
const TRAILING_RE = /[. ]+$/;
const RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);
const MAX_LEN = 200;

/**
 * Sanitize a filename for safe use on Windows (and all platforms).
 *
 * - Replaces illegal characters (< > : " / \ | ? *) with _
 * - Strips control characters (0x00–0x1F)
 * - Removes trailing dots and spaces
 * - Prefixes Windows reserved names (CON, PRN, etc.) with _
 * - Truncates to 200 chars preserving file extension
 * - Returns "unnamed" if result would be empty
 */
export function sanitizeFilename(name: string): string {
  let result = name
    .replace(CONTROL_RE, '')
    .replace(ILLEGAL_RE, '_')
    .replace(TRAILING_RE, '');

  // Check reserved names (stem without extension)
  const dotPos = result.lastIndexOf('.');
  const stem = dotPos > 0 ? result.slice(0, dotPos) : result;
  if (RESERVED_NAMES.has(stem.toUpperCase())) {
    result = '_' + result;
  }

  // Truncate preserving extension
  if (result.length > MAX_LEN) {
    if (dotPos > 0) {
      const ext = result.slice(dotPos);
      if (ext.length < MAX_LEN) {
        result = result.slice(0, MAX_LEN - ext.length).trimEnd() + ext;
      } else {
        result = result.slice(0, MAX_LEN);
      }
    } else {
      result = result.slice(0, MAX_LEN);
    }
  }

  return result || 'unnamed';
}
