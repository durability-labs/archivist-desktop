import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { useCatalog } from '../hooks/useCatalog';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);

const mockItems = [
  { id: 'tt1234', type: 'movie', name: 'Test Movie', poster: 'http://img.com/1.jpg' },
  { id: 'tt5678', type: 'movie', name: 'Another Movie', poster: 'http://img.com/2.jpg' },
];

describe('useCatalog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should load catalog', async () => {
    mockInvoke.mockResolvedValueOnce(mockItems);

    const { result } = renderHook(() => useCatalog());

    await act(async () => {
      await result.current.loadCatalog('addon1', 'movie', 'top');
    });

    expect(mockInvoke).toHaveBeenCalledWith('get_stremio_catalog', {
      addonId: 'addon1',
      contentType: 'movie',
      catalogId: 'top',
      extra: null,
    });
    expect(result.current.items).toHaveLength(2);
    expect(result.current.selectedType).toBe('movie');
  });

  it('should load more with skip', async () => {
    // First load: 20+ items means hasMore = true
    const firstPage = Array.from({ length: 20 }, (_, i) => ({
      id: `tt${i}`,
      type: 'movie',
      name: `Movie ${i}`,
    }));
    const secondPage = [{ id: 'tt100', type: 'movie', name: 'Movie 100' }];

    mockInvoke.mockResolvedValueOnce(firstPage);

    const { result } = renderHook(() => useCatalog());

    await act(async () => {
      await result.current.loadCatalog('addon1', 'movie', 'top');
    });

    expect(result.current.hasMore).toBe(true);
    expect(result.current.items).toHaveLength(20);

    mockInvoke.mockResolvedValueOnce(secondPage);

    await act(async () => {
      await result.current.loadMore('addon1', 'movie', 'top');
    });

    expect(mockInvoke).toHaveBeenCalledWith('get_stremio_catalog', {
      addonId: 'addon1',
      contentType: 'movie',
      catalogId: 'top',
      extra: 'skip=100',
    });
    expect(result.current.items).toHaveLength(21);
    expect(result.current.hasMore).toBe(false); // < 20 results
  });

  it('should handle empty catalog', async () => {
    mockInvoke.mockResolvedValueOnce([]);

    const { result } = renderHook(() => useCatalog());

    await act(async () => {
      await result.current.loadCatalog('addon1', 'movie', 'top');
    });

    expect(result.current.items).toHaveLength(0);
    expect(result.current.hasMore).toBe(false);
  });

  it('should search catalog', async () => {
    mockInvoke.mockResolvedValueOnce([mockItems[0]]);

    const { result } = renderHook(() => useCatalog());

    await act(async () => {
      await result.current.search('addon1', 'movie', 'top', 'Test');
    });

    expect(mockInvoke).toHaveBeenCalledWith('get_stremio_catalog', {
      addonId: 'addon1',
      contentType: 'movie',
      catalogId: 'top',
      extra: 'search=Test',
    });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.hasMore).toBe(false);
  });

  it('should clear items', async () => {
    mockInvoke.mockResolvedValueOnce(mockItems);

    const { result } = renderHook(() => useCatalog());

    await act(async () => {
      await result.current.loadCatalog('addon1', 'movie', 'top');
    });

    expect(result.current.items).toHaveLength(2);

    act(() => {
      result.current.clearItems();
    });

    expect(result.current.items).toHaveLength(0);
    expect(result.current.hasMore).toBe(true);
  });
});
