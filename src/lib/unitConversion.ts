export type SizeUnit = 'B' | 'KB' | 'MB' | 'GB' | 'TB';
export type TimeUnit = 'seconds' | 'minutes' | 'hours' | 'days' | 'months';

export const SIZE_UNITS: SizeUnit[] = ['B', 'KB', 'MB', 'GB', 'TB'];
export const TIME_UNITS: TimeUnit[] = ['seconds', 'minutes', 'hours', 'days', 'months'];

const SIZE_FACTORS: Record<SizeUnit, number> = {
  B: 1,
  KB: 1024,
  MB: 1024 ** 2,
  GB: 1024 ** 3,
  TB: 1024 ** 4,
};

const TIME_FACTORS: Record<TimeUnit, number> = {
  seconds: 1,
  minutes: 60,
  hours: 3600,
  days: 86400,
  months: 2592000, // 30 days
};

function toNum(value: number | string): number {
  return typeof value === 'string' ? Number(value) : value;
}

/**
 * Convert a value in the given unit to bytes.
 * Returns a string to preserve precision for large numbers.
 */
export function toBytes(value: number, unit: SizeUnit): string {
  return String(Math.round(value * SIZE_FACTORS[unit]));
}

/**
 * Convert bytes to the most human-readable unit.
 */
export function fromBytes(bytes: number | string): { value: number; unit: SizeUnit } {
  const b = toNum(bytes);
  if (!isFinite(b) || b === 0) return { value: 0, unit: 'B' };

  const abs = Math.abs(b);
  // Walk units from largest to smallest, pick first where value >= 1
  for (let i = SIZE_UNITS.length - 1; i >= 1; i--) {
    const unit = SIZE_UNITS[i];
    const val = abs / SIZE_FACTORS[unit];
    if (val >= 1) {
      return { value: parseFloat((b / SIZE_FACTORS[unit]).toFixed(2)), unit };
    }
  }
  return { value: b, unit: 'B' };
}

/**
 * Convert a value in the given unit to seconds.
 * Returns a string to preserve precision for large numbers.
 */
export function toSeconds(value: number, unit: TimeUnit): string {
  return String(Math.round(value * TIME_FACTORS[unit]));
}

/**
 * Convert seconds to the most human-readable unit.
 */
export function fromSeconds(seconds: number | string): { value: number; unit: TimeUnit } {
  const s = toNum(seconds);
  if (!isFinite(s) || s === 0) return { value: 0, unit: 'seconds' };

  const abs = Math.abs(s);
  for (let i = TIME_UNITS.length - 1; i >= 1; i--) {
    const unit = TIME_UNITS[i];
    const val = abs / TIME_FACTORS[unit];
    if (val >= 1) {
      return { value: parseFloat((s / TIME_FACTORS[unit]).toFixed(2)), unit };
    }
  }
  return { value: s, unit: 'seconds' };
}

/**
 * Format bytes into a human-readable string, e.g. "1.5 GB".
 */
export function formatBytes(bytes: number | string): string {
  const { value, unit } = fromBytes(bytes);
  return `${value} ${unit}`;
}

/**
 * Format seconds into a human-readable string, e.g. "30 days".
 */
export function formatDuration(seconds: number | string): string {
  const { value, unit } = fromSeconds(seconds);
  return `${value} ${unit}`;
}
