import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';
import { useWallet } from '../hooks/useWallet';
import { CONTRACT_ADDRESSES, getExplorerUrl, type NetworkId } from '../lib/contracts';
import '../styles/Marketplace.css';

export default function Wallet() {
  const {
    wallet,
    balances,
    loading,
    error,
    balancesLoading,
    refresh,
    refreshBalances,
    generateWallet,
    importWallet,
    exportWallet,
    unlockWallet,
    deleteWallet,
  } = useWallet();

  const [copied, setCopied] = useState(false);
  const [faucetMessage, setFaucetMessage] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);

  // Wallet setup state
  const [setupMode, setSetupMode] = useState<'none' | 'generate' | 'import'>('none');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [importKey, setImportKey] = useState('');
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupLoading, setSetupLoading] = useState(false);

  // Unlock state
  const [unlockPassword, setUnlockPassword] = useState('');
  const [unlockError, setUnlockError] = useState<string | null>(null);

  // Banner unlock+restart state
  const [bannerPassword, setBannerPassword] = useState('');
  const [bannerError, setBannerError] = useState<string | null>(null);

  // Export state
  const [showExport, setShowExport] = useState(false);
  const [exportPassword, setExportPassword] = useState('');
  const [exportedKey, setExportedKey] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  // Delete confirmation
  const [confirmDelete, setConfirmDelete] = useState(false);

  const network = (wallet?.network || 'arbitrum-sepolia') as NetworkId;
  const contracts = CONTRACT_ADDRESSES[network] || CONTRACT_ADDRESSES['arbitrum-sepolia'];

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

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setSetupError('Passwords do not match');
      return;
    }
    setSetupLoading(true);
    setSetupError(null);
    try {
      await generateWallet(password);
      setSetupMode('none');
      setPassword('');
      setConfirmPassword('');
      setSetupLoading(false);
      setRestarting(true);
      try {
        await invoke('restart_node');
        for (let i = 0; i < 5; i++) {
          await new Promise(r => setTimeout(r, 2000));
          await refresh();
        }
      } catch { /* node may not be running */ }
      setRestarting(false);
    } catch (err) {
      setSetupError(String(err));
      setSetupLoading(false);
    }
  };

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setSetupError('Passwords do not match');
      return;
    }
    setSetupLoading(true);
    setSetupError(null);
    try {
      await importWallet(importKey, password);
      setSetupMode('none');
      setPassword('');
      setConfirmPassword('');
      setImportKey('');
      setSetupLoading(false);
      setRestarting(true);
      try {
        await invoke('restart_node');
        for (let i = 0; i < 5; i++) {
          await new Promise(r => setTimeout(r, 2000));
          await refresh();
        }
      } catch { /* node may not be running */ }
      setRestarting(false);
    } catch (err) {
      setSetupError(String(err));
      setSetupLoading(false);
    }
  };

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setUnlockError(null);
    try {
      await unlockWallet(unlockPassword);
      setUnlockPassword('');
    } catch (err) {
      setUnlockError(String(err));
    }
  };

  const handleExport = async (e: React.FormEvent) => {
    e.preventDefault();
    setExportError(null);
    try {
      const key = await exportWallet(exportPassword);
      setExportedKey(key);
    } catch (err) {
      setExportError(String(err));
    }
  };

  const handleDelete = async () => {
    try {
      await deleteWallet();
      setConfirmDelete(false);
    } catch (err) {
      setSetupError(String(err));
    }
  };

  if (loading) {
    return (
      <div className="wallet-page">
        <h1>Wallet</h1>
        <div className="mp-empty">Loading wallet info...</div>
      </div>
    );
  }

  const hasWallet = wallet?.hasKey;
  const isZeroAddr = !wallet?.address || wallet.address === '0x0000000000000000000000000000000000000000';

  return (
    <div className="wallet-page">
      <h1>Wallet</h1>

      {error && <div className="mp-error">{error}</div>}

      {/* ── Wallet Setup (no wallet yet) ─────────────────────────── */}
      {!hasWallet && setupMode === 'none' && (
        <div className="mp-section">
          <h2>Set Up Your Wallet</h2>
          <p style={{ color: 'var(--text-dim)', marginBottom: '1rem', fontSize: '0.85rem' }}>
            A wallet is required to participate in the marketplace. Generate a new one or import an existing private key.
          </p>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button className="mp-submit-btn" onClick={() => setSetupMode('generate')}>
              Generate New Wallet
            </button>
            <button className="mp-refresh-btn" onClick={() => setSetupMode('import')}>
              Import Private Key
            </button>
          </div>
        </div>
      )}

      {/* ── Generate Wallet Form ─────────────────────────────────── */}
      {!hasWallet && setupMode === 'generate' && (
        <div className="mp-section">
          <h2>Generate New Wallet</h2>
          <p style={{ color: 'var(--text-dim)', marginBottom: '1rem', fontSize: '0.85rem' }}>
            A random ETH keypair will be generated and encrypted with your password.
          </p>
          <form onSubmit={handleGenerate}>
            <div className="mp-form">
              <div className="mp-field">
                <label>Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Encryption password"
                />
              </div>
              <div className="mp-field">
                <label>Confirm Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm password"
                />
              </div>
            </div>
            {setupError && <div className="mp-error">{setupError}</div>}
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.75rem' }}>
              <button type="submit" className="mp-submit-btn" disabled={setupLoading}>
                {setupLoading ? 'Generating...' : 'Generate Wallet'}
              </button>
              <button type="button" className="mp-refresh-btn" onClick={() => { setSetupMode('none'); setSetupError(null); }}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Import Wallet Form ───────────────────────────────────── */}
      {!hasWallet && setupMode === 'import' && (
        <div className="mp-section">
          <h2>Import Private Key</h2>
          <p style={{ color: 'var(--text-dim)', marginBottom: '1rem', fontSize: '0.85rem' }}>
            Enter your existing ETH private key (64 hex chars, with or without 0x prefix).
          </p>
          <form onSubmit={handleImport}>
            <div className="mp-form">
              <div className="mp-field full-width">
                <label>Private Key</label>
                <input
                  type="password"
                  value={importKey}
                  onChange={(e) => setImportKey(e.target.value)}
                  placeholder="0x..."
                  style={{ fontFamily: 'monospace' }}
                />
              </div>
              <div className="mp-field">
                <label>Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Encryption password"
                />
              </div>
              <div className="mp-field">
                <label>Confirm Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm password"
                />
              </div>
            </div>
            {setupError && <div className="mp-error">{setupError}</div>}
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.75rem' }}>
              <button type="submit" className="mp-submit-btn" disabled={setupLoading || !importKey}>
                {setupLoading ? 'Importing...' : 'Import Wallet'}
              </button>
              <button type="button" className="mp-refresh-btn" onClick={() => { setSetupMode('none'); setSetupError(null); }}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Wallet Info (when wallet exists) ─────────────────────── */}
      {hasWallet && (
        <>
          {/* Marketplace status banner */}
          {!wallet?.marketplaceActive && (
            <div className="mp-error" style={{ background: 'rgba(255, 170, 0, 0.1)', borderColor: 'var(--color-warning, #ffaa00)' }}>
              {!wallet?.isUnlocked ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <span>Wallet locked. Unlock your wallet to enable marketplace features.</span>
                  </div>
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      setBannerError(null);
                      setRestarting(true);
                      try {
                        await invoke('unlock_wallet', { password: bannerPassword });
                        setBannerPassword('');
                        await invoke('restart_node');
                        for (let i = 0; i < 5; i++) {
                          await new Promise(r => setTimeout(r, 2000));
                          await refresh();
                        }
                      } catch (err) {
                        setBannerError(String(err));
                      }
                      setRestarting(false);
                    }}
                    style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.5rem', flexWrap: 'wrap' }}
                  >
                    <input
                      type="password"
                      value={bannerPassword}
                      onChange={(e) => setBannerPassword(e.target.value)}
                      placeholder="Wallet password"
                      style={{ flex: 1, minWidth: '150px' }}
                      disabled={restarting}
                    />
                    <button type="submit" className="mp-submit-btn" style={{ whiteSpace: 'nowrap' }}
                      disabled={restarting || !bannerPassword}>
                      {restarting ? 'Restarting...' : 'Unlock & Restart'}
                    </button>
                  </form>
                  {bannerError && <div style={{ marginTop: '0.5rem', color: 'var(--color-error, #ff4444)', fontSize: '0.85rem' }}>{bannerError}</div>}
                </>
              ) : wallet?.marketplaceUnavailable ? (
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span>Marketplace unavailable — contract not deployed on current network.</span>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>Marketplace not active. Restart the node to enable marketplace features with your wallet.</span>
                  <button className="mp-submit-btn" style={{ marginLeft: '0.75rem', whiteSpace: 'nowrap' }}
                    disabled={restarting}
                    onClick={async () => {
                      setRestarting(true);
                      try {
                        await invoke('restart_node');
                        for (let i = 0; i < 5; i++) {
                          await new Promise(r => setTimeout(r, 2000));
                          await refresh();
                        }
                      } catch { /* node may not be running */ }
                      setRestarting(false);
                    }}>
                    {restarting ? 'Restarting...' : 'Restart Node'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Address & Network */}
          <div className="mp-section">
            <div className="mp-section-header">
              <h2>Node Identity</h2>
              <button className="mp-refresh-btn" onClick={refresh}>Refresh</button>
            </div>

            <div className="wallet-network-badge">{network}</div>

            <h3>ETH Address</h3>
            <div className="wallet-address">
              <code>{isZeroAddr ? 'Not available' : wallet?.address}</code>
              {!isZeroAddr && (
                <button className="wallet-copy-btn" onClick={copyAddress}>
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              )}
            </div>

            {!isZeroAddr && (
              <a
                href={getExplorerUrl(network, wallet!.address)}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--ui-green)', fontSize: '0.8rem' }}
              >
                View on block explorer
              </a>
            )}
          </div>

          {/* Balances */}
          <div className="mp-section">
            <div className="mp-section-header">
              <h2>Balances</h2>
              <button className="mp-refresh-btn" onClick={refreshBalances} disabled={balancesLoading}>
                {balancesLoading ? 'Loading...' : 'Refresh'}
              </button>
            </div>

            <div className="mp-stats">
              <div className="mp-stat">
                <span className="mp-stat-label">ETH</span>
                <span className="mp-stat-value">{balances?.ethBalance ?? '...'}</span>
              </div>
              <div className="mp-stat">
                <span className="mp-stat-label">TST</span>
                <span className="mp-stat-value">{balances?.tstBalance ?? '...'}</span>
              </div>
            </div>
          </div>

          {/* Faucets */}
          <div className="mp-section">
            <h2>Testnet Faucets</h2>
            <p style={{ color: 'var(--text-dim)', marginBottom: '0.75rem', fontSize: '0.85rem' }}>
              Get free testnet tokens. Your address will be copied to clipboard so you can paste it in the faucet page.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                className="mp-submit-btn"
                onClick={async () => {
                  if (!wallet?.address) return;
                  try { await navigator.clipboard.writeText(wallet.address); } catch { /* clipboard unavailable */ }
                  setFaucetMessage('Address copied to clipboard. Paste it in the faucet page.');
                  setTimeout(() => setFaucetMessage(null), 5000);
                  await open('https://faucet-arb.testnet.archivist.storage');
                }}
              >
                Get ETH
              </button>
              <button
                className="mp-submit-btn"
                onClick={async () => {
                  if (!wallet?.address) return;
                  try { await navigator.clipboard.writeText(wallet.address); } catch { /* clipboard unavailable */ }
                  setFaucetMessage('Address copied to clipboard. Paste it in the faucet page.');
                  setTimeout(() => setFaucetMessage(null), 5000);
                  await open('https://faucet-tst.testnet.archivist.storage');
                }}
              >
                Get TST
              </button>
            </div>
            {faucetMessage && (
              <div style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: 'var(--ui-green)' }}>
                {faucetMessage}
              </div>
            )}
          </div>

          {/* Unlock (if wallet exists but key not in memory) */}
          {hasWallet && !wallet?.isUnlocked && (
            <div className="mp-section">
              <h2>Unlock Wallet</h2>
              <p style={{ color: 'var(--text-dim)', marginBottom: '0.75rem', fontSize: '0.85rem' }}>
                Unlock your wallet to enable marketplace features on next node start.
              </p>
              <form onSubmit={handleUnlock} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end' }}>
                <div className="mp-field" style={{ flex: 1 }}>
                  <label>Password</label>
                  <input
                    type="password"
                    value={unlockPassword}
                    onChange={(e) => setUnlockPassword(e.target.value)}
                    placeholder="Keystore password"
                  />
                </div>
                <button type="submit" className="mp-submit-btn" style={{ marginBottom: '0.35rem' }}>
                  Unlock
                </button>
              </form>
              {unlockError && <div className="mp-error" style={{ marginTop: '0.5rem' }}>{unlockError}</div>}
            </div>
          )}

          {/* Export Key */}
          <div className="mp-section">
            <div className="mp-section-header">
              <h2>Key Management</h2>
            </div>

            {!showExport ? (
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button className="mp-refresh-btn" onClick={() => setShowExport(true)}>
                  Export Private Key
                </button>
                <button
                  className="mp-refresh-btn"
                  style={{ color: 'var(--color-error, #ff4444)' }}
                  onClick={() => setConfirmDelete(true)}
                >
                  Delete Wallet
                </button>
              </div>
            ) : (
              <div>
                <p style={{ color: 'var(--color-error, #ff4444)', marginBottom: '0.75rem', fontSize: '0.85rem' }}>
                  Warning: Your private key controls your funds. Never share it with anyone.
                </p>
                <form onSubmit={handleExport} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end' }}>
                  <div className="mp-field" style={{ flex: 1 }}>
                    <label>Password</label>
                    <input
                      type="password"
                      value={exportPassword}
                      onChange={(e) => setExportPassword(e.target.value)}
                      placeholder="Keystore password"
                    />
                  </div>
                  <button type="submit" className="mp-submit-btn" style={{ marginBottom: '0.35rem' }}>
                    Decrypt
                  </button>
                  <button type="button" className="mp-refresh-btn" style={{ marginBottom: '0.35rem' }} onClick={() => { setShowExport(false); setExportedKey(null); setExportError(null); }}>
                    Cancel
                  </button>
                </form>
                {exportError && <div className="mp-error" style={{ marginTop: '0.5rem' }}>{exportError}</div>}
                {exportedKey && (
                  <div style={{ marginTop: '0.75rem' }}>
                    <code style={{ wordBreak: 'break-all', fontSize: '0.8rem', color: 'var(--ui-green)' }}>{exportedKey}</code>
                    <button
                      className="wallet-copy-btn"
                      style={{ marginLeft: '0.5rem' }}
                      onClick={async () => {
                        try { await navigator.clipboard.writeText(exportedKey); } catch { /* clipboard unavailable */ }
                      }}
                    >
                      Copy
                    </button>
                  </div>
                )}
              </div>
            )}

            {confirmDelete && (
              <div style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(255, 0, 0, 0.1)', borderRadius: '4px' }}>
                <p style={{ color: 'var(--color-error, #ff4444)', marginBottom: '0.75rem', fontSize: '0.85rem' }}>
                  Are you sure? This will permanently delete your wallet keystore. Make sure you have exported and backed up your private key.
                </p>
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button className="mp-submit-btn" style={{ background: 'var(--color-error, #ff4444)' }} onClick={handleDelete}>
                    Yes, Delete Wallet
                  </button>
                  <button className="mp-refresh-btn" onClick={() => setConfirmDelete(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Contract Addresses */}
          <div className="mp-section">
            <h2>Contract Addresses</h2>

            <div className="wallet-contracts">
              <div className="wallet-contract-row">
                <span className="contract-label">Marketplace</span>
                {contracts.marketplace ? (
                  <>
                    <code>{contracts.marketplace}</code>
                    <a href={getExplorerUrl(network, contracts.marketplace)} target="_blank" rel="noopener noreferrer">View</a>
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
                    <a href={getExplorerUrl(network, contracts.token)} target="_blank" rel="noopener noreferrer">View</a>
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
                    <a href={getExplorerUrl(network, contracts.verifier)} target="_blank" rel="noopener noreferrer">View</a>
                  </>
                ) : (
                  <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>Not deployed</span>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
