import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { IptvChannel, IptvPlaylistSummary } from '../lib/stremioTypes';

export function useIPTV() {
  const [playlists, setPlaylists] = useState<IptvPlaylistSummary[]>([]);
  const [channels, setChannels] = useState<IptvChannel[]>([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPlaylists = useCallback(async () => {
    try {
      setLoading(true);
      const result = await invoke<IptvPlaylistSummary[]>('list_iptv_playlists');
      setPlaylists(result);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPlaylists();
  }, [loadPlaylists]);

  const addPlaylist = useCallback(async (url: string, name: string) => {
    try {
      setLoading(true);
      const summary = await invoke<IptvPlaylistSummary>('add_iptv_playlist', { url, name });
      setPlaylists(prev => [...prev, summary]);
      setError(null);
      return summary;
    } catch (e) {
      setError(String(e));
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const addPlaylistContent = useCallback(async (content: string, name: string) => {
    try {
      setLoading(true);
      const summary = await invoke<IptvPlaylistSummary>('add_iptv_playlist_content', { content, name });
      setPlaylists(prev => [...prev, summary]);
      setError(null);
      return summary;
    } catch (e) {
      setError(String(e));
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const removePlaylist = useCallback(async (id: string) => {
    try {
      await invoke('remove_iptv_playlist', { id });
      setPlaylists(prev => prev.filter(p => p.id !== id));
      if (selectedPlaylist === id) {
        setSelectedPlaylist(null);
        setChannels([]);
      }
    } catch (e) {
      setError(String(e));
    }
  }, [selectedPlaylist]);

  const refreshPlaylist = useCallback(async (id: string) => {
    try {
      setLoading(true);
      const updated = await invoke<IptvPlaylistSummary>('refresh_iptv_playlist', { id });
      setPlaylists(prev => prev.map(p => p.id === id ? updated : p));
      // Reload channels if this is the selected playlist
      if (selectedPlaylist === id) {
        const chs = await invoke<IptvChannel[]>('get_iptv_channels', {
          playlistId: id,
          group: selectedGroup,
          search: null,
        });
        setChannels(chs);
      }
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [selectedPlaylist, selectedGroup]);

  const getChannels = useCallback(async (
    playlistId: string,
    group?: string | null,
    search?: string | null,
  ) => {
    try {
      setLoading(true);
      const result = await invoke<IptvChannel[]>('get_iptv_channels', {
        playlistId,
        group: group || null,
        search: search || null,
      });
      setChannels(result);
      setSelectedPlaylist(playlistId);
      setSelectedGroup(group || null);
      setError(null);
    } catch (e) {
      setError(String(e));
      setChannels([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const selectGroup = useCallback(async (group: string | null) => {
    if (!selectedPlaylist) return;
    setSelectedGroup(group);
    await getChannels(selectedPlaylist, group);
  }, [selectedPlaylist, getChannels]);

  const searchChannels = useCallback(async (query: string) => {
    if (!selectedPlaylist) return;
    await getChannels(selectedPlaylist, null, query || null);
  }, [selectedPlaylist, getChannels]);

  return {
    playlists,
    channels,
    selectedPlaylist,
    selectedGroup,
    loading,
    error,
    addPlaylist,
    addPlaylistContent,
    removePlaylist,
    refreshPlaylist,
    getChannels,
    selectGroup,
    searchChannels,
    refreshPlaylists: loadPlaylists,
  };
}
