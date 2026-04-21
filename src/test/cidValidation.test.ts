import { describe, it, expect } from 'vitest';
import { validateCid, isCidLike } from '../lib/cidValidation';

describe('validateCid', () => {
  it('accepts valid CIDv1 (starts with z)', () => {
    const cid = 'zDvZRwzkyP23unwvD6FTwMdwHUc4Fr2LA2eJ4yB2tU3n7jDNbKn8';
    expect(validateCid(cid)).toEqual({ valid: true });
  });

  it('accepts valid CIDv0 (starts with Q)', () => {
    const cid = 'QmYwAPJzv5CZsnN625s3Xf2nemtYgPpHdWEz79ojWnPbdG';
    expect(validateCid(cid)).toEqual({ valid: true });
  });

  it('rejects empty string', () => {
    expect(validateCid('')).toEqual({ valid: false, error: 'CID cannot be empty' });
  });

  it('rejects whitespace-only', () => {
    expect(validateCid('   ')).toEqual({ valid: false, error: 'CID cannot be empty' });
  });

  it('rejects too-short strings', () => {
    expect(validateCid('zShort')).toEqual({ valid: false, error: 'CID is too short' });
  });

  it('rejects too-long strings', () => {
    const long = 'z' + 'a'.repeat(100);
    expect(validateCid(long)).toEqual({ valid: false, error: 'CID is too long' });
  });

  it('rejects strings not starting with z or Q', () => {
    const cid = 'a' + 'b'.repeat(50);
    expect(validateCid(cid)).toEqual({ valid: false, error: 'Invalid CID format. Must start with z or Q.' });
  });

  it('trims whitespace before validation', () => {
    const cid = '  zDvZRwzkyP23unwvD6FTwMdwHUc4Fr2LA2eJ4yB2tU3n7jDNbKn8  ';
    expect(validateCid(cid)).toEqual({ valid: true });
  });
});

describe('isCidLike', () => {
  it('returns true for CID-like strings', () => {
    expect(isCidLike('zDvZRwzkyP23unwvD6FTwMdwHUc4Fr2LA2eJ4yB2tU3n7jDNbKn8')).toBe(true);
  });

  it('returns false for non-CID strings', () => {
    expect(isCidLike('hello world')).toBe(false);
    expect(isCidLike('')).toBe(false);
    expect(isCidLike('http://example.com')).toBe(false);
  });
});
