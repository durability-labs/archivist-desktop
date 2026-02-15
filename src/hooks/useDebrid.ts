import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { DebridStatus, ResolvedStream, CacheCheckResult, StreamObject } from '../lib/stremioTypes';

export function useDebrid() {
  const [status, setStatus] = useState<DebridStatus>({ configured: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const result = await invoke<DebridStatus>('get_debrid_status');
      setStatus(result);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const configureRealDebrid = useCallback(async (token: string) => {
    try {
      setLoading(true);
      await invoke('configure_debrid', { provider: 'real_debrid', token });
      setStatus({ configured: true, provider_type: 'real_debrid' });
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const configurePremiumize = useCallback(async (apiKey: string) => {
    try {
      setLoading(true);
      await invoke('configure_debrid', { provider: 'premiumize', token: apiKey });
      setStatus({ configured: true, provider_type: 'premiumize' });
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const clearProvider = useCallback(async () => {
    try {
      await invoke('clear_debrid');
      setStatus({ configured: false });
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const validateToken = useCallback(async (): Promise<boolean> => {
    try {
      const valid = await invoke<boolean>('validate_debrid_token');
      return valid;
    } catch (e) {
      setError(String(e));
      return false;
    }
  }, []);

  const resolveStream = useCallback(async (stream: StreamObject): Promise<ResolvedStream> => {
    const result = await invoke<ResolvedStream>('resolve_debrid_stream', { stream });
    return result;
  }, []);

  const checkCache = useCallback(async (infoHashes: string[]): Promise<CacheCheckResult[]> => {
    const result = await invoke<CacheCheckResult[]>('check_debrid_cache', { infoHashes });
    return result;
  }, []);

  return {
    configured: status.configured,
    providerType: status.provider_type,
    loading,
    error,
    configureRealDebrid,
    configurePremiumize,
    clearProvider,
    validateToken,
    resolveStream,
    checkCache,
    refreshStatus: loadStatus,
  };
}
