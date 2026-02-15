import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { useStremioAddons } from '../hooks/useStremioAddons';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);

const mockAddon = {
  base_url: 'https://v3-cinemeta.strem.io',
  manifest: {
    id: 'com.linvo.cinemeta',
    version: '3.0.12',
    name: 'Cinemeta',
    description: 'The official addon',
    types: ['movie', 'series'],
    catalogs: [],
    resources: [],
  },
  enabled: true,
};

describe('useStremioAddons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should load addons on mount', async () => {
    mockInvoke.mockResolvedValueOnce([mockAddon]);

    const { result } = renderHook(() => useStremioAddons());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockInvoke).toHaveBeenCalledWith('list_stremio_addons');
    expect(result.current.addons).toHaveLength(1);
    expect(result.current.addons[0].manifest.name).toBe('Cinemeta');
  });

  it('should install addon', async () => {
    mockInvoke.mockResolvedValueOnce([]); // list_stremio_addons
    mockInvoke.mockResolvedValueOnce(mockAddon); // install_stremio_addon

    const { result } = renderHook(() => useStremioAddons());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.installAddon('https://v3-cinemeta.strem.io');
    });

    expect(mockInvoke).toHaveBeenCalledWith('install_stremio_addon', {
      url: 'https://v3-cinemeta.strem.io',
    });
    expect(result.current.addons).toHaveLength(1);
  });

  it('should remove addon', async () => {
    mockInvoke.mockResolvedValueOnce([mockAddon]); // list_stremio_addons
    mockInvoke.mockResolvedValueOnce(undefined); // remove_stremio_addon

    const { result } = renderHook(() => useStremioAddons());

    await waitFor(() => {
      expect(result.current.addons).toHaveLength(1);
    });

    await act(async () => {
      await result.current.removeAddon('com.linvo.cinemeta');
    });

    expect(mockInvoke).toHaveBeenCalledWith('remove_stremio_addon', {
      addonId: 'com.linvo.cinemeta',
    });
    expect(result.current.addons).toHaveLength(0);
  });

  it('should toggle addon', async () => {
    mockInvoke.mockResolvedValueOnce([mockAddon]); // list_stremio_addons
    mockInvoke.mockResolvedValueOnce(undefined); // toggle_stremio_addon

    const { result } = renderHook(() => useStremioAddons());

    await waitFor(() => {
      expect(result.current.addons).toHaveLength(1);
    });

    await act(async () => {
      await result.current.toggleAddon('com.linvo.cinemeta', false);
    });

    expect(mockInvoke).toHaveBeenCalledWith('toggle_stremio_addon', {
      addonId: 'com.linvo.cinemeta',
      enabled: false,
    });
    expect(result.current.addons[0].enabled).toBe(false);
  });

  it('should handle install error', async () => {
    mockInvoke.mockResolvedValueOnce([]); // list_stremio_addons
    mockInvoke.mockRejectedValueOnce('Network error'); // install_stremio_addon

    const { result } = renderHook(() => useStremioAddons());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let threwError = false;
    await act(async () => {
      try {
        await result.current.installAddon('https://invalid.url');
      } catch {
        threwError = true;
      }
    });

    expect(threwError).toBe(true);
    expect(result.current.error).toBe('Network error');
  });
});
