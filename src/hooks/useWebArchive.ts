import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type {
  ArchiveOptions,
  ArchiveQueueState,
  ArchiveState,
  ArchivedSite,
} from '../lib/archiveTypes';

export function useWebArchive() {
  const [queueState, setQueueState] = useState<ArchiveQueueState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [viewerLoading, setViewerLoading] = useState(false);
  const [viewerCid, setViewerCid] = useState<string | null>(null);

  const refreshQueue = useCallback(async () => {
    try {
      const result = await invoke<ArchiveQueueState>('get_archive_queue');
      setQueueState(result);
      setError(null);
    } catch (e) {
      setError(
        typeof e === 'string'
          ? e
          : e instanceof Error
            ? e.message
            : 'Failed to get archive queue'
      );
    }
  }, []);

  const queueArchive = useCallback(
    async (options: ArchiveOptions): Promise<string> => {
      const taskId = await invoke<string>('queue_web_archive', { options });
      await refreshQueue();
      return taskId;
    },
    [refreshQueue]
  );

  const cancelArchive = useCallback(
    async (taskId: string) => {
      await invoke('cancel_web_archive', { taskId });
      await refreshQueue();
    },
    [refreshQueue]
  );

  const removeTask = useCallback(
    async (taskId: string) => {
      await invoke('remove_archive_task', { taskId });
      await refreshQueue();
    },
    [refreshQueue]
  );

  const clearCompleted = useCallback(async () => {
    await invoke('clear_completed_archives');
    await refreshQueue();
  }, [refreshQueue]);

  const getArchivedSites = useCallback(async (): Promise<ArchivedSite[]> => {
    return await invoke<ArchivedSite[]>('get_archived_sites');
  }, []);

  const openViewer = useCallback(async (cid: string, originalUrl?: string) => {
    setViewerLoading(true);
    try {
      const viewerResult = await invoke<string>('open_archive_viewer', {
        cid,
        url: originalUrl,
      });
      setViewerUrl(viewerResult);
      setViewerCid(cid);
    } catch (e) {
      setError(
        typeof e === 'string'
          ? e
          : e instanceof Error
            ? e.message
            : 'Failed to open archive viewer'
      );
    } finally {
      setViewerLoading(false);
    }
  }, []);

  const closeViewer = useCallback(async () => {
    try {
      await invoke('close_archive_viewer');
    } catch {
      // Ignore close errors
    }
    setViewerUrl(null);
    setViewerCid(null);
  }, []);

  // Initialize and poll
  useEffect(() => {
    async function init() {
      setLoading(true);
      await refreshQueue();
      setLoading(false);
    }
    init();

    const interval = setInterval(refreshQueue, 2000);
    return () => clearInterval(interval);
  }, [refreshQueue]);

  // Listen to real-time events
  useEffect(() => {
    const unlistenProgress = listen<{
      taskId: string;
      pagesFound: number;
      pagesDownloaded: number;
      assetsDownloaded: number;
      totalBytes: number;
    }>('web-archive-progress', (event) => {
      setQueueState((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          tasks: prev.tasks.map((t) =>
            t.id === event.payload.taskId
              ? {
                  ...t,
                  pagesFound: event.payload.pagesFound,
                  pagesDownloaded: event.payload.pagesDownloaded,
                  assetsDownloaded: event.payload.assetsDownloaded,
                  totalBytes: event.payload.totalBytes,
                }
              : t
          ),
        };
      });
    });

    const unlistenState = listen<{
      taskId: string;
      state: ArchiveState;
      error?: string;
      cid?: string;
    }>('web-archive-state-changed', (event) => {
      setQueueState((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          tasks: prev.tasks.map((t) =>
            t.id === event.payload.taskId
              ? {
                  ...t,
                  state: event.payload.state,
                  error: event.payload.error ?? t.error,
                  cid: event.payload.cid ?? t.cid,
                }
              : t
          ),
        };
      });
    });

    return () => {
      unlistenProgress.then((fn) => fn());
      unlistenState.then((fn) => fn());
    };
  }, []);

  return {
    queueState,
    loading,
    error,
    queueArchive,
    cancelArchive,
    removeTask,
    clearCompleted,
    getArchivedSites,
    refreshQueue,
    viewerUrl,
    viewerLoading,
    viewerCid,
    openViewer,
    closeViewer,
  };
}
