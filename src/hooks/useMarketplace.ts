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
  expiry: string;
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
  minPrice: string;
  maxCollateral: string;
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
  minPrice: string;
  maxCollateral: string;
}

export interface CreateStorageRequestParams {
  cid: string;
  duration: string;
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
  purchases: Purchase[];
  createStorageRequest: (params: CreateStorageRequestParams) => Promise<Purchase>;
  getPurchase: (id: string) => Promise<Purchase>;
  // State
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useMarketplace(): UseMarketplace {
  const [slots, setSlots] = useState<SalesSlot[]>([]);
  const [availability, setAvailability] = useState<Availability[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [slotsResult, availResult, purchasesResult] = await Promise.allSettled([
        invoke<SalesSlot[]>('get_sales_slots'),
        invoke<Availability[]>('get_availability'),
        invoke<Purchase[]>('get_purchases'),
      ]);

      if (slotsResult.status === 'fulfilled') setSlots(slotsResult.value);
      if (availResult.status === 'fulfilled') setAvailability(availResult.value);
      if (purchasesResult.status === 'fulfilled') setPurchases(purchasesResult.value);

      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
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
      minPrice: params.minPrice,
      maxCollateral: params.maxCollateral,
    });
    await refresh();
    return result;
  }, [refresh]);

  const doCreateStorageRequest = useCallback(async (params: CreateStorageRequestParams) => {
    const result = await invoke<Purchase>('create_storage_request', {
      cid: params.cid,
      duration: params.duration,
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
    error,
    refresh,
  };
}
