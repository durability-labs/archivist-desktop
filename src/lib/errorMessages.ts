export interface FriendlyError {
  title: string;
  detail: string;
  action?: { label: string; route: string };
}

interface ErrorPattern {
  pattern: string;
  error: FriendlyError;
}

const ERROR_PATTERNS: ErrorPattern[] = [
  {
    pattern: 'node not running',
    error: {
      title: 'Node is not running',
      detail: 'Start your node from the Dashboard to use this feature.',
      action: { label: 'Go to Dashboard', route: '/' },
    },
  },
  {
    pattern: 'node already running',
    error: {
      title: 'Node is already running',
      detail: 'Your node is already active.',
    },
  },
  {
    pattern: 'failed to start node',
    error: {
      title: 'Node failed to start',
      detail: 'Check Settings for port conflicts or try restarting.',
      action: { label: 'Settings', route: '/settings' },
    },
  },
  {
    pattern: 'file not found',
    error: {
      title: 'File not found',
      detail: 'The requested file could not be located.',
    },
  },
  {
    pattern: 'api request failed',
    error: {
      title: 'Connection error',
      detail: 'Unable to reach the node. Make sure it\'s running.',
    },
  },
  {
    pattern: 'connection was forcibly closed',
    error: {
      title: 'Connection lost',
      detail: 'The network connection was interrupted. This may be a VPN or firewall issue.',
    },
  },
  {
    pattern: 'wallet error',
    error: {
      title: 'Wallet error',
      detail: 'There was a problem with your wallet. Try unlocking it again.',
      action: { label: 'Go to Wallet', route: '/wallet' },
    },
  },
  {
    pattern: 'marketplace error',
    error: {
      title: 'Marketplace error',
      detail: 'The marketplace transaction failed. Check your wallet balance and try again.',
    },
  },
];

/**
 * Convert a raw error string into a user-friendly error with title, detail,
 * and an optional action link.
 */
export function humanizeError(rawError: string): FriendlyError {
  const lower = rawError.toLowerCase();

  for (const { pattern, error } of ERROR_PATTERNS) {
    if (lower.includes(pattern)) {
      return error;
    }
  }

  return {
    title: 'Something went wrong',
    detail: rawError,
  };
}
