import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

export interface StorageAsk {
  slots: number;
  slotSize: number;
  duration: number;
  proofProbability: string;
  pricePerBytePerSecond: string;
  collateralPerByte: string;
  maxSlotLoss: number;
}

export interface StorageContent {
  cid: string;
  merkleRoot: string;
}

export interface StorageRequest {
  client: string;
  ask: StorageAsk;
  content: StorageContent;
  expiry: number;
  nonce: string;
}

export interface SalesSlot {
  request: StorageRequest;
  slotIndex: number;
}

/**
 * Provider availability offer.
 *
 * Matches the archivist-node main-branch (ba37d61+) schema, which replaced the
 * v0.2.0 shape (`totalSize`, `freeSize`, `duration`, `totalCollateral` etc.)
 * with a minimal 4-field representation.
 */
export interface Availability {
  maximumDuration: string;
  minimumPricePerBytePerSecond: string;
  maximumCollateralPerByte: string;
  /** Unix timestamp. 0 means no restriction. */
  availableUntil: number;
}

export interface Purchase {
  state: string;
  error?: string;
  request?: StorageRequest;
  requestId: string;
}

export interface SetAvailabilityParams {
  maximumDuration: string;
  minimumPricePerBytePerSecond: string;
  maximumCollateralPerByte: string;
  /** Unix timestamp. Omit or pass 0 for no restriction. */
  availableUntil?: number;
}

export interface CreateStorageRequestParams {
  cid: string;
  duration: string;
  proofProbability: string;
  pricePerBytePerSecond: string;
  collateralPerByte: string;
  slots: number;
  slotSize: number;
  maxSlotLoss: number;
  expiry: number;
}

export interface UseMarketplace {
  // Provider
  slots: SalesSlot[];
  availability: Availability[];
  setAvailability: (params: SetAvailabilityParams) => Promise<Availability>;
  // Client
  purchases: string[];
  createStorageRequest: (params: CreateStorageRequestParams) => Promise<string>;
  getPurchase: (id: string) => Promise<Purchase>;
  // State
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => void;
}

export function useMarketplace(): UseMarketplace {
  const [slots, setSlots] = useState<SalesSlot[]>([]);
  const [availability, setAvailability] = useState<Availability[]>([]);
  const [purchases, setPurchases] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [slotsResult, availResult, purchasesResult] = await Promise.allSettled([
        invoke<SalesSlot[]>('get_sales_slots'),
        invoke<Availability[]>('get_availability'),
        invoke<string[]>('get_purchases'),
      ]);

      if (slotsResult.status === 'fulfilled') setSlots(slotsResult.value);
      if (availResult.status === 'fulfilled') setAvailability(availResult.value);
      if (purchasesResult.status === 'fulfilled') setPurchases(purchasesResult.value);

      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  const doSetAvailability = useCallback(async (params: SetAvailabilityParams) => {
    const result = await invoke<Availability>('set_availability', {
      maximumDuration: params.maximumDuration,
      minimumPricePerBytePerSecond: params.minimumPricePerBytePerSecond,
      maximumCollateralPerByte: params.maximumCollateralPerByte,
      availableUntil: params.availableUntil ?? 0,
    });
    await refresh();
    return result;
  }, [refresh]);

  const doCreateStorageRequest = useCallback(async (params: CreateStorageRequestParams) => {
    const result = await invoke<string>('create_storage_request', {
      cid: params.cid,
      duration: params.duration,
      proofProbability: params.proofProbability,
      pricePerBytePerSecond: params.pricePerBytePerSecond,
      collateralPerByte: params.collateralPerByte,
      slots: params.slots,
      slotSize: params.slotSize,
      maxSlotLoss: params.maxSlotLoss,
      expiry: params.expiry,
    });
    await refresh();
    return result;
  }, [refresh]);

  const doGetPurchase = useCallback(async (id: string) => {
    return await invoke<Purchase>('get_purchase', { id });
  }, []);

  return {
    slots,
    availability,
    setAvailability: doSetAvailability,
    purchases,
    createStorageRequest: doCreateStorageRequest,
    getPurchase: doGetPurchase,
    loading,
    refreshing,
    error,
    refresh,
  };
}
