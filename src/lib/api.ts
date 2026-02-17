// Node API types - matches archivist-node/openapi.yaml

export interface NodeInfo {
  version: string;
  localNode: {
    peerId: string;
    addrs: string[];
  };
}

export interface UploadResponse {
  cid: string;
}

export interface PeerInfo {
  peerId: string;
  addresses: string[];
}

export interface StorageInfo {
  used: number;
  available: number;
  totalSlots: number;
  usedSlots: number;
}

// Re-export marketplace types from the hook for convenience
export type { SalesSlot, Availability, Purchase, StorageRequest, StorageAsk, StorageContent } from '../hooks/useMarketplace';
