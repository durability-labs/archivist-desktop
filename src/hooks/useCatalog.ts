import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { MetaItem } from '../lib/stremioTypes';

export function useCatalog() {
  const [items, setItems] = useState<MetaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [selectedType, setSelectedType] = useState<string>('movie');
  const [currentSkip, setCurrentSkip] = useState(0);

  const loadCatalog = useCallback(async (
    addonId: string,
    type_: string,
    catalogId: string,
    extra?: string,
  ) => {
    try {
      setLoading(true);
      setCurrentSkip(0);
      const result = await invoke<MetaItem[]>('get_stremio_catalog', {
        addonId,
        contentType: type_,
        catalogId,
        extra: extra || null,
      });
      setItems(result);
      setHasMore(result.length >= 20); // Stremio pages are typically 20-100 items
      setSelectedType(type_);
      setError(null);
    } catch (e) {
      setError(String(e));
      setItems([]);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async (
    addonId: string,
    type_: string,
    catalogId: string,
  ) => {
    try {
      setLoading(true);
      const newSkip = currentSkip + 100;
      const extra = `skip=${newSkip}`;
      const result = await invoke<MetaItem[]>('get_stremio_catalog', {
        addonId,
        contentType: type_,
        catalogId,
        extra,
      });
      setItems(prev => [...prev, ...result]);
      setHasMore(result.length >= 20);
      setCurrentSkip(newSkip);
      setError(null);
    } catch (e) {
      setError(String(e));
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, [currentSkip]);

  const search = useCallback(async (
    addonId: string,
    type_: string,
    catalogId: string,
    query: string,
  ) => {
    try {
      setLoading(true);
      const extra = `search=${encodeURIComponent(query)}`;
      const result = await invoke<MetaItem[]>('get_stremio_catalog', {
        addonId,
        contentType: type_,
        catalogId,
        extra,
      });
      setItems(result);
      setHasMore(false); // Search results are typically complete
      setError(null);
    } catch (e) {
      setError(String(e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const clearItems = useCallback(() => {
    setItems([]);
    setHasMore(true);
    setCurrentSkip(0);
  }, []);

  return {
    items,
    loading,
    error,
    hasMore,
    selectedType,
    loadCatalog,
    loadMore,
    search,
    clearItems,
    setSelectedType,
  };
}
