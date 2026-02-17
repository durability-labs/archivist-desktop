// Feature flag constants

export const FEATURES = {
  // V1 features - always enabled
  NODE_MANAGEMENT: true,
  FILE_UPLOAD: true,
  FILE_DOWNLOAD: true,
  FOLDER_SYNC: true,
  PEER_CONNECTION: true,
  SYSTEM_TRAY: true,

  // Marketplace features - always enabled (uses node REST API)
  MARKETPLACE: true,
  WALLET: true,
  SMART_CONTRACTS: true,

  // ZK proofs - compile-time feature flag
  ZK_PROOFS: false,
} as const;

export type FeatureKey = keyof typeof FEATURES;

export function isFeatureEnabled(feature: FeatureKey): boolean {
  return FEATURES[feature];
}
