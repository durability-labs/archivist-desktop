import { useState } from 'react';
import { useWallet } from '../hooks/useWallet';
import { CONTRACT_ADDRESSES, getExplorerUrl, type NetworkId } from '../lib/contracts';
import '../styles/Marketplace.css';

export default function Wallet() {
  const { wallet, loading, error, refresh } = useWallet();
  const [copied, setCopied] = useState(false);

  const copyAddress = async () => {
    if (!wallet?.address) return;
    try {
      await navigator.clipboard.writeText(wallet.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not available
    }
  };

  const network = (wallet?.network || 'arbitrum-sepolia') as NetworkId;
  const contracts = CONTRACT_ADDRESSES[network] || CONTRACT_ADDRESSES['arbitrum-sepolia'];

  if (loading) {
    return (
      <div className="wallet-page">
        <h1>Wallet</h1>
        <div className="mp-empty">Loading wallet info...</div>
      </div>
    );
  }

  return (
    <div className="wallet-page">
      <h1>Wallet</h1>

      {error && <div className="mp-error">{error}</div>}

      <div className="mp-section">
        <h2>Node Identity</h2>

        <div className="wallet-network-badge">
          {network}
        </div>

        <h3>ETH Address</h3>
        <div className="wallet-address">
          <code>{wallet?.address || 'Not available'}</code>
          <button className="wallet-copy-btn" onClick={copyAddress}>
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>

        {wallet?.address && wallet.address !== '0x0000000000000000000000000000000000000000' && (
          <a
            href={getExplorerUrl(network, wallet.address)}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--ui-green)', fontSize: '0.8rem' }}
          >
            View on block explorer
          </a>
        )}
      </div>

      <div className="mp-section">
        <div className="mp-section-header">
          <h2>Contract Addresses</h2>
          <button className="mp-refresh-btn" onClick={refresh}>Refresh</button>
        </div>

        <div className="wallet-contracts">
          <div className="wallet-contract-row">
            <span className="contract-label">Marketplace</span>
            {contracts.marketplace ? (
              <>
                <code>{contracts.marketplace}</code>
                <a
                  href={getExplorerUrl(network, contracts.marketplace)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View
                </a>
              </>
            ) : (
              <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>Not deployed</span>
            )}
          </div>

          <div className="wallet-contract-row">
            <span className="contract-label">Token</span>
            {contracts.token ? (
              <>
                <code>{contracts.token}</code>
                <a
                  href={getExplorerUrl(network, contracts.token)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View
                </a>
              </>
            ) : (
              <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>Not deployed</span>
            )}
          </div>

          <div className="wallet-contract-row">
            <span className="contract-label">Verifier</span>
            {contracts.verifier ? (
              <>
                <code>{contracts.verifier}</code>
                <a
                  href={getExplorerUrl(network, contracts.verifier)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View
                </a>
              </>
            ) : (
              <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>Not deployed</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
