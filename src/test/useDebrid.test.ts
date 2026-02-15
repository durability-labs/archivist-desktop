import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { useDebrid } from '../hooks/useDebrid';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);

describe('useDebrid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should check status on mount', async () => {
    mockInvoke.mockResolvedValueOnce({ configured: false, provider_type: null });

    const { result } = renderHook(() => useDebrid());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockInvoke).toHaveBeenCalledWith('get_debrid_status');
    expect(result.current.configured).toBe(false);
  });

  it('should configure provider', async () => {
    mockInvoke.mockResolvedValueOnce({ configured: false }); // get_debrid_status
    mockInvoke.mockResolvedValueOnce(undefined); // configure_debrid

    const { result } = renderHook(() => useDebrid());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.configureRealDebrid('test-token');
    });

    expect(mockInvoke).toHaveBeenCalledWith('configure_debrid', {
      provider: 'real_debrid',
      token: 'test-token',
    });
    expect(result.current.configured).toBe(true);
    expect(result.current.providerType).toBe('real_debrid');
  });

  it('should resolve stream', async () => {
    const mockResolved = {
      url: 'https://debrid.example.com/file.mp4',
      filename: 'movie.mp4',
      filesize: 1000000,
      provider: 'Real-Debrid',
    };

    mockInvoke.mockResolvedValueOnce({ configured: true, provider_type: 'real_debrid' }); // get_debrid_status
    mockInvoke.mockResolvedValueOnce(mockResolved); // resolve_debrid_stream

    const { result } = renderHook(() => useDebrid());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let resolved;
    await act(async () => {
      resolved = await result.current.resolveStream({
        infoHash: 'abc123',
        name: 'Test',
      });
    });

    expect(mockInvoke).toHaveBeenCalledWith('resolve_debrid_stream', {
      stream: { infoHash: 'abc123', name: 'Test' },
    });
    expect(resolved).toEqual(mockResolved);
  });

  it('should check cache', async () => {
    const mockResults = [
      { info_hash: 'hash1', is_cached: true, files: [] },
      { info_hash: 'hash2', is_cached: false, files: [] },
    ];

    mockInvoke.mockResolvedValueOnce({ configured: true, provider_type: 'real_debrid' });
    mockInvoke.mockResolvedValueOnce(mockResults);

    const { result } = renderHook(() => useDebrid());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let results;
    await act(async () => {
      results = await result.current.checkCache(['hash1', 'hash2']);
    });

    expect(mockInvoke).toHaveBeenCalledWith('check_debrid_cache', {
      infoHashes: ['hash1', 'hash2'],
    });
    expect(results).toHaveLength(2);
  });
});
