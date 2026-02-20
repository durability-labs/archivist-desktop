import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export type TorrentState =
  | 'initializing'
  | 'downloading'
  | 'seeding'
  | 'paused'
  | 'checking'
  | 'error'
  | 'queued';

export interface TorrentFile {
  index: number;
  name: string;
  path: string;
  length: number;
  downloadedBytes: number;
  included: boolean;
  progressPercent: number;
}

export interface TorrentPeer {
  addr: string;
  client: string | null;
  downloadSpeed: number;
  uploadSpeed: number;
  progressPercent: number;
  flags: string;
}

export interface TorrentItem {
  id: number;
  infoHash: string;
  name: string;
  state: TorrentState;
  progressPercent: number;
  downloadedBytes: number;
  uploadedBytes: number;
  totalBytes: number;
  downloadSpeed: number;
  uploadSpeed: number;
  ratio: number;
  peersConnected: number;
  seedsConnected: number;
  eta: string | null;
  outputFolder: string;
  files: TorrentFile[];
  error: string | null;
  addedAt: string;
  completedAt: string | null;
  sequential: boolean;
}

export interface AddTorrentParams {
  source: string;
  sourceType: 'magnet' | 'file';
  outputFolder?: string;
  selectedFiles?: number[];
  paused: boolean;
  sequential: boolean;
}

export interface SpeedLimits {
  downloadLimitBytes: number | null;
  uploadLimitBytes: number | null;
}

export interface SeedingRules {
  maxRatio: number | null;
  maxSeedTimeMinutes: number | null;
  actionOnLimit: 'pause' | 'remove';
}

export interface TorrentSessionStats {
  torrents: TorrentItem[];
  totalDownloadSpeed: number;
  totalUploadSpeed: number;
  activeCount: number;
  seedingCount: number;
  pausedCount: number;
  totalDownloaded: number;
  totalUploaded: number;
  dhtPeers: number;
}

export function useTorrent() {
  const [sessionStats, setSessionStats] = useState<TorrentSessionStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTorrentId, setSelectedTorrentId] = useState<number | null>(null);
  const [peers, setPeers] = useState<TorrentPeer[]>([]);

  const refreshStats = useCallback(async () => {
    try {
      const result = await invoke<TorrentSessionStats>('get_torrent_session_stats');
      setSessionStats(result);
      setError(null);
    } catch (e) {
      setError(typeof e === 'string' ? e : (e instanceof Error ? e.message : 'Failed to get torrent stats'));
    }
  }, []);

  const addTorrent = useCallback(async (params: AddTorrentParams): Promise<TorrentItem> => {
    const item = await invoke<TorrentItem>('add_torrent', { params });
    await refreshStats();
    return item;
  }, [refreshStats]);

  const pauseTorrent = useCallback(async (id: number) => {
    await invoke('pause_torrent', { id });
    await refreshStats();
  }, [refreshStats]);

  const resumeTorrent = useCallback(async (id: number) => {
    await invoke('resume_torrent', { id });
    await refreshStats();
  }, [refreshStats]);

  const removeTorrent = useCallback(async (id: number, deleteFiles: boolean) => {
    await invoke('remove_torrent', { id, deleteFiles });
    setSelectedTorrentId(prev => prev === id ? null : prev);
    await refreshStats();
  }, [refreshStats]);

  const setTorrentFiles = useCallback(async (id: number, fileIndices: number[]) => {
    await invoke('set_torrent_files', { id, fileIndices });
    await refreshStats();
  }, [refreshStats]);

  const setSpeedLimits = useCallback(async (limits: SpeedLimits) => {
    await invoke('set_torrent_speed_limits', { limits });
  }, []);

  const setSeedingRules = useCallback(async (rules: SeedingRules) => {
    await invoke('set_torrent_seeding_rules', { rules });
  }, []);

  // Initialize + polling
  useEffect(() => {
    async function init() {
      setLoading(true);
      await refreshStats();
      setLoading(false);
    }
    init();

    const interval = setInterval(refreshStats, 2000);
    return () => clearInterval(interval);
  }, [refreshStats]);

  // Listen for real-time stats from backend event
  useEffect(() => {
    const unlisten = listen<TorrentSessionStats>('torrent-stats-update', (event) => {
      setSessionStats(event.payload);
    });

    return () => {
      unlisten.then(fn => fn());
    };
  }, []);

  // Fetch peers when a torrent is selected
  useEffect(() => {
    if (selectedTorrentId === null) {
      setPeers([]);
      return;
    }

    let cancelled = false;

    async function fetchPeers() {
      try {
        const result = await invoke<TorrentPeer[]>('get_torrent_peers', { id: selectedTorrentId });
        if (!cancelled) setPeers(result);
      } catch {
        if (!cancelled) setPeers([]);
      }
    }

    fetchPeers();
    const interval = setInterval(fetchPeers, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedTorrentId]);

  return {
    sessionStats,
    loading,
    error,
    selectedTorrentId,
    setSelectedTorrentId,
    peers,
    addTorrent,
    pauseTorrent,
    resumeTorrent,
    removeTorrent,
    setTorrentFiles,
    setSpeedLimits,
    setSeedingRules,
    refreshStats,
  };
}
