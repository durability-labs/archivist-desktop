import { describe, it, expect } from 'vitest';
import { sanitizeFilename } from '../lib/sanitizeFilename';

describe('sanitizeFilename', () => {
  it('replaces illegal characters with hyphens', () => {
    expect(sanitizeFilename('a<b>c:d"e/f\\g|h?i*j')).toBe('a-b-c-d-e-f-g-h-i-j');
  });

  it('strips control characters', () => {
    expect(sanitizeFilename('hello\x00world\x1F!')).toBe('helloworld');
  });

  it('prefixes Windows reserved names', () => {
    expect(sanitizeFilename('CON')).toBe('_con');
    expect(sanitizeFilename('con')).toBe('_con');
    expect(sanitizeFilename('PRN.txt')).toBe('_prn.txt');
    expect(sanitizeFilename('COM1')).toBe('_com1');
    expect(sanitizeFilename('lpt9.log')).toBe('_lpt9.log');
  });

  it('does not prefix non-reserved names', () => {
    expect(sanitizeFilename('CONSOLE')).toBe('console');
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
    expect(result.length).toBeLessThanOrEqual(200);
  });

  it('leaves normal filenames unchanged', () => {
    expect(sanitizeFilename('my_video.mp4')).toBe('my_video.mp4');
    expect(sanitizeFilename('photo-2024-01-15.jpg')).toBe('photo-2024-01-15.jpg');
  });

  it('handles real-world video titles', () => {
    expect(sanitizeFilename('React Tutorial: Build a Full App | 2024'))
      .toBe('react-tutorial-build-a-full-app-2024');
    expect(sanitizeFilename('AC/DC - Thunderstruck'))
      .toBe('ac-dc-thunderstruck');
  });

  it('replaces unicode with hyphens or falls back to unnamed', () => {
    expect(sanitizeFilename('日本語テスト.txt')).toBe('unnamed.txt');
    expect(sanitizeFilename('café résumé.pdf')).toBe('caf-r-sum.pdf');
  });

  it('converts to lowercase', () => {
    expect(sanitizeFilename('MyFile.TXT')).toBe('myfile.txt');
    expect(sanitizeFilename('HELLO WORLD')).toBe('hello-world');
  });

  it('handles complex video titles with mixed special chars', () => {
    expect(sanitizeFilename("The Internet's Own Boy: The Story of Aaron Swartz | full movie (2014)"))
      .toBe('the-internet-s-own-boy-the-story-of-aaron-swartz-full-movie-2014');
  });

  it('handles ampersands and parentheses', () => {
    expect(sanitizeFilename('Tom & Jerry (2021).mkv'))
      .toBe('tom-jerry-2021.mkv');
  });
});
