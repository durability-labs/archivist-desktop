import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

export interface MediaLibraryItem {
  id: string;
  title: string;
  thumbnail: string | null;
  outputPath: string;
  fileSize: number;
  mimeType: string;
  completedAt: string | null;
  audioOnly: boolean;
}

export function useMediaStreaming() {
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [library, setLibrary] = useState<MediaLibraryItem[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshLibrary = useCallback(async () => {
    try {
      const items = await invoke<MediaLibraryItem[]>('get_media_library');
      setLibrary(items);
    } catch (e) {
      console.error('Failed to get media library:', e);
    }
  }, []);

  const refreshServerUrl = useCallback(async () => {
    try {
      const url = await invoke<string | null>('get_streaming_server_url');
      setServerUrl(url);
    } catch (e) {
      console.error('Failed to get streaming server URL:', e);
    }
  }, []);

  const ensureServerRunning = useCallback(async (): Promise<string | null> => {
    // Check if already running
    let url = await invoke<string | null>('get_streaming_server_url');
    if (url) {
      setServerUrl(url);
      return url;
    }
    // Start server
    try {
      await invoke('start_streaming_server');
      url = await invoke<string | null>('get_streaming_server_url');
      setServerUrl(url);
      return url;
    } catch (e) {
      console.error('Failed to start streaming server:', e);
      return null;
    }
  }, []);

  const getStreamUrl = useCallback(
    (id: string) => (serverUrl ? `${serverUrl}/api/v1/media/${id}/stream` : null),
    [serverUrl]
  );

  const getThumbnailUrl = useCallback(
    (id: string) => (serverUrl ? `${serverUrl}/api/v1/media/${id}/thumbnail` : null),
    [serverUrl]
  );

  // Initialize
  useEffect(() => {
    async function init() {
      setLoading(true);
      await Promise.all([refreshServerUrl(), refreshLibrary()]);
      setLoading(false);
    }
    init();
  }, [refreshServerUrl, refreshLibrary]);

  return {
    serverUrl,
    library,
    loading,
    refreshLibrary,
    ensureServerRunning,
    getStreamUrl,
    getThumbnailUrl,
  };
}
