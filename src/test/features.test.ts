import { describe, it, expect } from 'vitest';
import { FEATURES, isFeatureEnabled } from '../lib/features';

describe('Feature flags', () => {
  it('has core features always enabled', () => {
    expect(FEATURES.NODE_MANAGEMENT).toBe(true);
    expect(FEATURES.FILE_UPLOAD).toBe(true);
    expect(FEATURES.FILE_DOWNLOAD).toBe(true);
    expect(FEATURES.FOLDER_SYNC).toBe(true);
    expect(FEATURES.PEER_CONNECTION).toBe(true);
  });

  it('has marketplace features enabled', () => {
    expect(FEATURES.MARKETPLACE).toBe(true);
    expect(FEATURES.WALLET).toBe(true);
  });

  it('has ZK proofs disabled by default', () => {
    expect(FEATURES.ZK_PROOFS).toBe(false);
  });

  it('isFeatureEnabled returns correct values', () => {
    expect(isFeatureEnabled('NODE_MANAGEMENT')).toBe(true);
    expect(isFeatureEnabled('ZK_PROOFS')).toBe(false);
  });
});
