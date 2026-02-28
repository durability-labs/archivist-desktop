import { describe, it, expect } from 'vitest';
import { sanitizeFilename } from '../lib/sanitizeFilename';

describe('sanitizeFilename', () => {
  it('replaces illegal characters with underscore', () => {
    expect(sanitizeFilename('a<b>c:d"e/f\\g|h?i*j')).toBe('a_b_c_d_e_f_g_h_i_j');
  });

  it('strips control characters', () => {
    expect(sanitizeFilename('hello\x00world\x1F!')).toBe('helloworld!');
  });

  it('prefixes Windows reserved names', () => {
    expect(sanitizeFilename('CON')).toBe('_CON');
    expect(sanitizeFilename('con')).toBe('_con');
    expect(sanitizeFilename('PRN.txt')).toBe('_PRN.txt');
    expect(sanitizeFilename('COM1')).toBe('_COM1');
    expect(sanitizeFilename('lpt9.log')).toBe('_lpt9.log');
  });

  it('does not prefix non-reserved names', () => {
    expect(sanitizeFilename('CONSOLE')).toBe('CONSOLE');
    expect(sanitizeFilename('contest.txt')).toBe('contest.txt');
  });

  it('removes trailing dots and spaces', () => {
    expect(sanitizeFilename('file...')).toBe('file');
    expect(sanitizeFilename('file   ')).toBe('file');
    expect(sanitizeFilename('file . .')).toBe('file');
  });

  it('returns "unnamed" for empty/whitespace-only input', () => {
    expect(sanitizeFilename('')).toBe('unnamed');
    expect(sanitizeFilename('...')).toBe('unnamed');
    expect(sanitizeFilename('   ')).toBe('unnamed');
  });

  it('truncates long names preserving extension', () => {
    const longName = 'a'.repeat(300) + '.mp4';
    const result = sanitizeFilename(longName);
    expect(result.length).toBeLessThanOrEqual(200);
    expect(result.endsWith('.mp4')).toBe(true);
  });

  it('truncates long names without extension', () => {
    const longName = 'a'.repeat(300);
    const result = sanitizeFilename(longName);
    expect(result.length).toBe(200);
  });

  it('leaves normal filenames unchanged', () => {
    expect(sanitizeFilename('my_video.mp4')).toBe('my_video.mp4');
    expect(sanitizeFilename('photo-2024-01-15.jpg')).toBe('photo-2024-01-15.jpg');
  });

  it('handles real-world video titles', () => {
    expect(sanitizeFilename('React Tutorial: Build a Full App | 2024'))
      .toBe('React Tutorial_ Build a Full App _ 2024');
    expect(sanitizeFilename('AC/DC - Thunderstruck'))
      .toBe('AC_DC - Thunderstruck');
  });

  it('preserves unicode characters', () => {
    expect(sanitizeFilename('日本語テスト.txt')).toBe('日本語テスト.txt');
    expect(sanitizeFilename('café résumé.pdf')).toBe('café résumé.pdf');
  });
});
