// V2 Stub - Contract ABIs will be added when marketplace is implemented

// Placeholder for contract addresses by network
export const CONTRACT_ADDRESSES = {
  'arbitrum-one': {
    marketplace: undefined as string | undefined,
    token: undefined as string | undefined,
    verifier: undefined as string | undefined,
  },
  'arbitrum-sepolia': {
    marketplace: undefined as string | undefined,
    token: undefined as string | undefined,
    verifier: undefined as string | undefined,
  },
} as const;

export type NetworkId = keyof typeof CONTRACT_ADDRESSES;

// Placeholder for ABI types - will be generated from contract artifacts
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface MarketplaceABI {
  // V2: Add contract ABI here
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface TokenABI {
  // V2: Add ERC20 ABI here
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface VerifierABI {
  // V2: Add ZK verifier ABI here
}
