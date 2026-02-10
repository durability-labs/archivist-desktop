import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export interface MediaFormat {
  formatId: string;
  ext: string;
  resolution: string | null;
  filesizeApprox: number | null;
  vcodec: string | null;
  acodec: string | null;
  formatNote: string | null;
  qualityLabel: string;
  hasVideo: boolean;
  hasAudio: boolean;
  fps: number | null;
  tbr: number | null;
}

export interface MediaMetadata {
  title: string;
  url: string;
  thumbnail: string | null;
  durationSeconds: number | null;
  uploader: string | null;
  description: string | null;
  formats: MediaFormat[];
}

export interface DownloadOptions {
  url: string;
  formatId: string | null;
  audioOnly: boolean;
  audioFormat: string | null;
  outputDirectory: string;
  filename: string | null;
}

export type DownloadState =
  | 'queued'
  | 'fetchingMetadata'
  | 'downloading'
  | 'postProcessing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface DownloadTask {
  id: string;
  url: string;
  title: string;
  thumbnail: string | null;
  state: DownloadState;
  progressPercent: number;
  downloadedBytes: number;
  totalBytes: number | null;
  speed: string | null;
  eta: string | null;
  outputPath: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  options: DownloadOptions;
}

export interface DownloadQueueState {
  tasks: DownloadTask[];
  activeCount: number;
  queuedCount: number;
  completedCount: number;
  maxConcurrent: number;
  ytDlpAvailable: boolean;
  ffmpegAvailable: boolean;
  ytDlpVersion: string | null;
}

export interface BinaryStatus {
  ytDlpInstalled: boolean;
  ytDlpVersion: string | null;
  ytDlpPath: string | null;
  ffmpegInstalled: boolean;
  ffmpegVersion: string | null;
  ffmpegPath: string | null;
}

export interface InstallProgress {
  binary: string;
  downloaded: number;
  total: number | null;
}

export function useMediaDownload() {
  const [queueState, setQueueState] = useState<DownloadQueueState | null>(null);
  const [binaryStatus, setBinaryStatus] = useState<BinaryStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [installingBinary, setInstallingBinary] = useState<string | null>(null);
  const [installProgress, setInstallProgress] = useState<InstallProgress | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  const refreshQueue = useCallback(async () => {
    try {
      const result = await invoke<DownloadQueueState>('get_download_queue');
      setQueueState(result);
      setError(null);
    } catch (e) {
      setError(typeof e === 'string' ? e : (e instanceof Error ? e.message : 'Failed to get download queue'));
    }
  }, []);

  const checkBinaries = useCallback(async () => {
    try {
      const result = await invoke<BinaryStatus>('check_media_binaries');
      setBinaryStatus(result);
    } catch (e) {
      console.error('Failed to check binaries:', e);
    }
  }, []);

  const fetchMetadata = useCallback(async (url: string): Promise<MediaMetadata> => {
    return await invoke<MediaMetadata>('fetch_media_metadata', { url });
  }, []);

  const queueDownload = useCallback(async (
    options: DownloadOptions,
    title: string,
    thumbnail: string | null,
  ): Promise<string> => {
    const taskId = await invoke<string>('queue_media_download', { options, title, thumbnail });
    await refreshQueue();
    return taskId;
  }, [refreshQueue]);

  const cancelDownload = useCallback(async (taskId: string) => {
    await invoke('cancel_media_download', { taskId });
    await refreshQueue();
  }, [refreshQueue]);

  const removeTask = useCallback(async (taskId: string) => {
    await invoke('remove_media_task', { taskId });
    await refreshQueue();
  }, [refreshQueue]);

  const clearCompleted = useCallback(async () => {
    await invoke('clear_completed_downloads');
    await refreshQueue();
  }, [refreshQueue]);

  const installYtDlp = useCallback(async () => {
    setInstallingBinary('yt-dlp');
    setInstallProgress(null);
    setInstallError(null);
    try {
      await invoke('install_yt_dlp');
      await checkBinaries();
      await refreshQueue();
    } catch (e) {
      setInstallError(typeof e === 'string' ? e : (e instanceof Error ? e.message : 'Failed to install yt-dlp'));
    } finally {
      setInstallingBinary(null);
      setInstallProgress(null);
    }
  }, [checkBinaries, refreshQueue]);

  const installFfmpeg = useCallback(async () => {
    setInstallingBinary('ffmpeg');
    setInstallProgress(null);
    setInstallError(null);
    try {
      await invoke('install_ffmpeg');
      await checkBinaries();
      await refreshQueue();
    } catch (e) {
      setInstallError(typeof e === 'string' ? e : (e instanceof Error ? e.message : 'Failed to install ffmpeg'));
    } finally {
      setInstallingBinary(null);
      setInstallProgress(null);
    }
  }, [checkBinaries, refreshQueue]);

  const updateYtDlp = useCallback(async () => {
    setInstallingBinary('yt-dlp');
    setInstallProgress(null);
    setInstallError(null);
    try {
      await invoke('update_yt_dlp');
      await checkBinaries();
    } catch (e) {
      setInstallError(typeof e === 'string' ? e : (e instanceof Error ? e.message : 'Failed to update yt-dlp'));
    } finally {
      setInstallingBinary(null);
      setInstallProgress(null);
    }
  }, [checkBinaries]);

  // Initialize
  useEffect(() => {
    async function init() {
      setLoading(true);
      await Promise.all([refreshQueue(), checkBinaries()]);
      setLoading(false);
    }
    init();

    // Poll queue every 2 seconds
    const interval = setInterval(refreshQueue, 2000);
    return () => clearInterval(interval);
  }, [refreshQueue, checkBinaries]);

  // Listen to real-time progress events
  useEffect(() => {
    const unlistenProgress = listen<{
      taskId: string;
      percent: number;
      speed?: string;
      eta?: string;
    }>('media-download-progress', (event) => {
      setQueueState(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          tasks: prev.tasks.map(t =>
            t.id === event.payload.taskId
              ? {
                  ...t,
                  progressPercent: event.payload.percent,
                  speed: event.payload.speed ?? t.speed,
                  eta: event.payload.eta ?? t.eta,
                }
              : t
          ),
        };
      });
    });

    // Listen to state change events
    const unlistenState = listen<{
      taskId: string;
      state: DownloadState;
      error?: string;
      outputPath?: string;
    }>('media-download-state-changed', (event) => {
      setQueueState(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          tasks: prev.tasks.map(t =>
            t.id === event.payload.taskId
              ? {
                  ...t,
                  state: event.payload.state,
                  error: event.payload.error ?? t.error,
                  outputPath: event.payload.outputPath ?? t.outputPath,
                  progressPercent: event.payload.state === 'completed' ? 100 : t.progressPercent,
                }
              : t
          ),
        };
      });
    });

    // Listen to binary download progress events (yt-dlp/ffmpeg install)
    const unlistenBinaryProgress = listen<{
      binary: string;
      downloaded: number;
      total: number | null;
    }>('binary-download-progress', (event) => {
      setInstallProgress({
        binary: event.payload.binary,
        downloaded: event.payload.downloaded,
        total: event.payload.total,
      });
    });

    return () => {
      unlistenProgress.then(fn => fn());
      unlistenState.then(fn => fn());
      unlistenBinaryProgress.then(fn => fn());
    };
  }, []);

  return {
    queueState,
    binaryStatus,
    loading,
    error,
    installError,
    installingBinary,
    installProgress,
    fetchMetadata,
    queueDownload,
    cancelDownload,
    removeTask,
    clearCompleted,
    installYtDlp,
    installFfmpeg,
    updateYtDlp,
    checkBinaries,
    refreshQueue,
  };
}
