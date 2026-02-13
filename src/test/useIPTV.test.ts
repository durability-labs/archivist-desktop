import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { useIPTV } from '../hooks/useIPTV';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);

const mockPlaylist = {
  id: 'playlist-1',
  name: 'Test IPTV',
  channel_count: 50,
  group_count: 5,
  url: 'http://example.com/playlist.m3u',
  last_updated: '2024-01-01T00:00:00Z',
};

const mockChannels = [
  { id: 'ch1', name: 'CNN', url: 'http://cnn.m3u8', group: 'News', logo: null },
  { id: 'ch2', name: 'ESPN', url: 'http://espn.m3u8', group: 'Sports', logo: null },
];

describe('useIPTV', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should load playlists on mount', async () => {
    mockInvoke.mockResolvedValueOnce([mockPlaylist]);

    const { result } = renderHook(() => useIPTV());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockInvoke).toHaveBeenCalledWith('list_iptv_playlists');
    expect(result.current.playlists).toHaveLength(1);
  });

  it('should add playlist', async () => {
    mockInvoke.mockResolvedValueOnce([]); // list_iptv_playlists
    mockInvoke.mockResolvedValueOnce(mockPlaylist); // add_iptv_playlist

    const { result } = renderHook(() => useIPTV());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.addPlaylist('http://example.com/playlist.m3u', 'Test IPTV');
    });

    expect(mockInvoke).toHaveBeenCalledWith('add_iptv_playlist', {
      url: 'http://example.com/playlist.m3u',
      name: 'Test IPTV',
    });
    expect(result.current.playlists).toHaveLength(1);
  });

  it('should remove playlist', async () => {
    mockInvoke.mockResolvedValueOnce([mockPlaylist]); // list_iptv_playlists
    mockInvoke.mockResolvedValueOnce(undefined); // remove_iptv_playlist

    const { result } = renderHook(() => useIPTV());

    await waitFor(() => {
      expect(result.current.playlists).toHaveLength(1);
    });

    await act(async () => {
      await result.current.removePlaylist('playlist-1');
    });

    expect(mockInvoke).toHaveBeenCalledWith('remove_iptv_playlist', { id: 'playlist-1' });
    expect(result.current.playlists).toHaveLength(0);
  });

  it('should get channels with group filter', async () => {
    mockInvoke.mockResolvedValueOnce([]); // list_iptv_playlists
    mockInvoke.mockResolvedValueOnce(mockChannels.filter(c => c.group === 'News')); // get_iptv_channels

    const { result } = renderHook(() => useIPTV());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.getChannels('playlist-1', 'News');
    });

    expect(mockInvoke).toHaveBeenCalledWith('get_iptv_channels', {
      playlistId: 'playlist-1',
      group: 'News',
      search: null,
    });
  });

  it('should search channels', async () => {
    mockInvoke.mockResolvedValueOnce([]); // list_iptv_playlists
    mockInvoke.mockResolvedValueOnce(mockChannels); // get_iptv_channels (initial)
    mockInvoke.mockResolvedValueOnce([mockChannels[0]]); // get_iptv_channels (search)

    const { result } = renderHook(() => useIPTV());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // First select a playlist
    await act(async () => {
      await result.current.getChannels('playlist-1');
    });

    // Then search
    await act(async () => {
      await result.current.searchChannels('CNN');
    });

    expect(mockInvoke).toHaveBeenCalledWith('get_iptv_channels', {
      playlistId: 'playlist-1',
      group: null,
      search: 'CNN',
    });
  });
});
