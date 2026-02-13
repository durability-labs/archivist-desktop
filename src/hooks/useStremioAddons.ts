import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { InstalledAddon } from '../lib/stremioTypes';

export function useStremioAddons() {
  const [addons, setAddons] = useState<InstalledAddon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAddons = useCallback(async () => {
    try {
      setLoading(true);
      const result = await invoke<InstalledAddon[]>('list_stremio_addons');
      setAddons(result);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAddons();
  }, [loadAddons]);

  const installAddon = useCallback(async (url: string) => {
    try {
      setLoading(true);
      const addon = await invoke<InstalledAddon>('install_stremio_addon', { url });
      setAddons(prev => [...prev, addon]);
      setError(null);
      return addon;
    } catch (e) {
      setError(String(e));
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const removeAddon = useCallback(async (addonId: string) => {
    try {
      await invoke('remove_stremio_addon', { addonId });
      setAddons(prev => prev.filter(a => a.manifest.id !== addonId));
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const toggleAddon = useCallback(async (addonId: string, enabled: boolean) => {
    try {
      await invoke('toggle_stremio_addon', { addonId, enabled });
      setAddons(prev =>
        prev.map(a =>
          a.manifest.id === addonId ? { ...a, enabled } : a
        )
      );
    } catch (e) {
      setError(String(e));
    }
  }, []);

  return {
    addons,
    loading,
    error,
    installAddon,
    removeAddon,
    toggleAddon,
    refreshAddons: loadAddons,
  };
}
