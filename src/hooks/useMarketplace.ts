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

export interface Availability {
  id: string;
  totalSize: string;
  freeSize: string;
  duration: string;
  minPricePerBytePerSecond: string;
  maxCollateralPerByte?: string;
  totalCollateral: string;
  totalRemainingCollateral?: string;
  enabled?: boolean;
  until?: string;
}

export interface Purchase {
  state: string;
  error?: string;
  request?: StorageRequest;
  requestId: string;
}

export interface SetAvailabilityParams {
  totalSize: string;
  duration: string;
  minPricePerBytePerSecond: string;
  maxCollateralPerByte: string;
  totalCollateral: string;
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
      totalSize: params.totalSize,
      duration: params.duration,
      minPricePerBytePerSecond: params.minPricePerBytePerSecond,
      maxCollateralPerByte: params.maxCollateralPerByte,
      totalCollateral: params.totalCollateral,
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
