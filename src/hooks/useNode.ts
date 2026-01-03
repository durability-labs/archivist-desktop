import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

export type NodeState = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

export interface NodeStatus {
  state: NodeState;
  pid?: number;
  version?: string;
  uptimeSeconds?: number;
  peerCount: number;
  storageUsedBytes: number;
  storageAvailableBytes: number;
  lastError?: string;
  restartCount: number;
  apiUrl?: string;
  peerId?: string;
  spr?: string;
  addresses: string[];
}

export interface NodeConfig {
  dataDir: string;
  apiPort: number;
  p2pPort: number;
  maxStorageBytes: number;
  autoStart: boolean;
  autoRestart: boolean;
  maxRestartAttempts: number;
  healthCheckIntervalSecs: number;
}

const defaultStatus: NodeStatus = {
  state: 'stopped',
  peerCount: 0,
  storageUsedBytes: 0,
  storageAvailableBytes: 100 * 1024 * 1024 * 1024, // 100 GB
  restartCount: 0,
  addresses: [],
};

export function useNode() {
  const [status, setStatus] = useState<NodeStatus>(defaultStatus);
  const [config, setConfig] = useState<NodeConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const result = await invoke<NodeStatus>('get_node_status');
      setStatus(result);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const refreshConfig = useCallback(async () => {
    try {
      const result = await invoke<NodeConfig>('get_node_config');
      setConfig(result);
    } catch (e) {
      console.error('Failed to get node config:', e);
    }
  }, []);

  const startNode = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await invoke<NodeStatus>('start_node');
      setStatus(result);
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      setError(errorMsg);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const stopNode = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await invoke<NodeStatus>('stop_node');
      setStatus(result);
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      setError(errorMsg);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const restartNode = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await invoke<NodeStatus>('restart_node');
      setStatus(result);
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      setError(errorMsg);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const updateConfig = useCallback(async (newConfig: NodeConfig) => {
    try {
      await invoke('set_node_config', { config: newConfig });
      setConfig(newConfig);
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      setError(errorMsg);
      throw e;
    }
  }, []);

  const healthCheck = useCallback(async (): Promise<boolean> => {
    try {
      return await invoke<boolean>('health_check_node');
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    async function init() {
      setLoading(true);
      await Promise.all([refreshStatus(), refreshConfig()]);
      setLoading(false);
    }
    init();

    // Poll status every 3 seconds for more responsive UI
    const interval = setInterval(refreshStatus, 3000);
    return () => clearInterval(interval);
  }, [refreshStatus, refreshConfig]);

  // Helper to format uptime
  const formatUptime = useCallback((seconds?: number): string => {
    if (seconds === undefined || seconds === null) return '-';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    }
    return `${secs}s`;
  }, []);

  // Helper to format bytes
  const formatBytes = useCallback((bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }, []);

  return {
    status,
    config,
    loading,
    error,
    startNode,
    stopNode,
    restartNode,
    updateConfig,
    healthCheck,
    refreshStatus,
    refreshConfig,
    formatUptime,
    formatBytes,
    isRunning: status.state === 'running',
    isStopped: status.state === 'stopped',
    isError: status.state === 'error',
    isTransitioning: status.state === 'starting' || status.state === 'stopping',
  };
}
