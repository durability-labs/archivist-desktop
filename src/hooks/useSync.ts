import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

export interface WatchedFolder {
  id: string;
  path: string;
  enabled: boolean;
  fileCount: number;
  totalSizeBytes: number;
  lastSynced: string | null;
  status: 'idle' | 'scanning' | 'syncing' | 'error' | 'paused';
  manifestCid?: string;
  manifestUpdatedAt?: string;
  backupSyncedAt?: string;
}

export interface SyncState {
  folders: WatchedFolder[];
  isSyncing: boolean;
  queueSize: number;
  totalFiles: number;
  syncedFiles: number;
  recentUploads: string[];
}

const defaultSyncState: SyncState = {
  folders: [],
  isSyncing: false,
  queueSize: 0,
  totalFiles: 0,
  syncedFiles: 0,
  recentUploads: [],
};

export function useSync() {
  const [syncState, setSyncState] = useState<SyncState>(defaultSyncState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const result = await invoke<SyncState>('get_sync_status');
      setSyncState(result);
      setError(null);
    } catch (e) {
      const msg = typeof e === 'string' ? e : (e instanceof Error ? e.message : 'Failed to get sync status');
      setError(msg);
    }
  }, []);

  const addWatchFolder = useCallback(async (path: string) => {
    try {
      setError(null);
      await invoke('add_watch_folder', { path });
      await refreshStatus();
    } catch (e) {
      const msg = typeof e === 'string' ? e : (e instanceof Error ? e.message : 'Failed to add watch folder');
      setError(msg);
      throw e;
    }
  }, [refreshStatus]);

  const removeWatchFolder = useCallback(async (folderId: string) => {
    try {
      setError(null);
      await invoke('remove_watch_folder', { folderId });
      await refreshStatus();
    } catch (e) {
      const msg = typeof e === 'string' ? e : (e instanceof Error ? e.message : 'Failed to remove watch folder');
      setError(msg);
      throw e;
    }
  }, [refreshStatus]);

  const toggleWatchFolder = useCallback(async (folderId: string, enabled: boolean) => {
    try {
      setError(null);
      await invoke('toggle_watch_folder', { folderId, enabled });
      await refreshStatus();
    } catch (e) {
      const msg = typeof e === 'string' ? e : (e instanceof Error ? e.message : 'Failed to toggle watch folder');
      setError(msg);
      throw e;
    }
  }, [refreshStatus]);

  const syncNow = useCallback(async () => {
    try {
      setError(null);
      await invoke('sync_now');
      await refreshStatus();
    } catch (e) {
      const msg = typeof e === 'string' ? e : (e instanceof Error ? e.message : 'Failed to start sync');
      setError(msg);
      throw e;
    }
  }, [refreshStatus]);

  const pauseSync = useCallback(async () => {
    try {
      setError(null);
      await invoke('pause_sync');
      await refreshStatus();
    } catch (e) {
      const msg = typeof e === 'string' ? e : (e instanceof Error ? e.message : 'Failed to pause sync');
      setError(msg);
      throw e;
    }
  }, [refreshStatus]);

  useEffect(() => {
    async function init() {
      setLoading(true);
      await refreshStatus();
      setLoading(false);
    }
    init();

    // Poll for updates every 3 seconds
    const interval = setInterval(refreshStatus, 3000);
    return () => clearInterval(interval);
  }, [refreshStatus]);

  return {
    syncState,
    loading,
    error,
    addWatchFolder,
    removeWatchFolder,
    toggleWatchFolder,
    syncNow,
    pauseSync,
    refreshStatus,
  };
}
