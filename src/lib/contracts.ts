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

export function getExplorerUrl(network: NetworkId, address: string): string {
  switch (network) {
    case 'arbitrum-sepolia':
      return `https://sepolia.arbiscan.io/address/${address}`;
    case 'arbitrum-one':
      return `https://arbiscan.io/address/${address}`;
    default:
      return '';
  }
}
