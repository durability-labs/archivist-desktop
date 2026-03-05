// Contract addresses by network

export const CONTRACT_ADDRESSES = {
  'arbitrum-one': {
    marketplace: undefined as string | undefined,
    token: undefined as string | undefined,
    verifier: undefined as string | undefined,
  },
  'arbitrum-sepolia': {
    marketplace: '0x9A110Ae7DC8916Fa741e38caAf204c3ace3eAB0c',
    token: '0x3b7412Ee1144b9801341A4F391490eB735DDc005',
    verifier: '0xeC68ce5Cb9cC174A971FC4a96d0CB87a541490a4',
  },
} as const;

export type NetworkId = keyof typeof CONTRACT_ADDRESSES;

// Archivist network presets (devnet / testnet)
export type ArchivistNetworkId = 'devnet' | 'testnet';

export const NETWORK_PRESETS: Record<ArchivistNetworkId, {
  name: string;
  rpcUrl: string;
  marketplace: string;
  token: string;
  explorerBaseUrl: string;
}> = {
  devnet: {
    name: 'Devnet',
    rpcUrl: 'https://rpc.devnet.archivist.storage',
    marketplace: '0x766e6E608E1FeB762b429155574016D1106b8D04',
    token: '0x3b7412Ee1144b9801341A4F391490eB735DDc005',
    explorerBaseUrl: 'https://sepolia.arbiscan.io',
  },
  testnet: {
    name: 'Testnet',
    rpcUrl: 'https://rpc.testnet.archivist.storage',
    marketplace: '0x9A110Ae7DC8916Fa741e38caAf204c3ace3eAB0c',
    token: '0x3b7412Ee1144b9801341A4F391490eB735DDc005',
    explorerBaseUrl: 'https://sepolia.arbiscan.io',
  },
};

export function getExplorerUrl(network: NetworkId | ArchivistNetworkId, address: string): string {
  // Handle archivist network IDs
  if (network === 'devnet' || network === 'testnet') {
    return `${NETWORK_PRESETS[network].explorerBaseUrl}/address/${address}`;
  }
  switch (network) {
    case 'arbitrum-sepolia':
      return `https://sepolia.arbiscan.io/address/${address}`;
    case 'arbitrum-one':
      return `https://arbiscan.io/address/${address}`;
    default:
      return '';
  }
}
