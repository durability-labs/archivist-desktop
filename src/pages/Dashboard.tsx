import { useState, useEffect } from 'react';
import { useNode, NodeState } from '../hooks/useNode';
import { useSync } from '../hooks/useSync';
import { invoke } from '@tauri-apps/api/core';

interface DiagnosticInfo {
  apiReachable: boolean;
  apiUrl: string;
  nodeVersion?: string;
  peerId?: string;
  addressCount: number;
  error?: string;
}

function Dashboard() {
  const [copied, setCopied] = useState<string | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [diagnostics, setDiagnostics] = useState<DiagnosticInfo | null>(null);
  const [runningDiagnostics, setRunningDiagnostics] = useState(false);
  const {
    status,
    loading,
    error,
    startNode,
    stopNode,
    restartNode,
    formatUptime,
    formatBytes,
    isRunning,
    isStopped,
    isError,
    isTransitioning,
  } = useNode();
  const { syncState } = useSync();

  const getStateLabel = (state: NodeState): string => {
    switch (state) {
      case 'stopped': return 'Stopped';
      case 'starting': return 'Starting...';
      case 'running': return 'Running';
      case 'stopping': return 'Stopping...';
      case 'error': return 'Error';
      default: return state;
    }
  };

  const getStateClass = (state: NodeState): string => {
    switch (state) {
      case 'running': return 'running';
      case 'error': return 'error';
      case 'starting':
      case 'stopping': return 'transitioning';
      default: return 'stopped';
    }
  };

  const handleStart = async () => {
    try {
      await startNode();
    } catch {
      // Error is already handled by the hook
    }
  };

  const handleStop = async () => {
    try {
      await stopNode();
    } catch {
      // Error is already handled by the hook
    }
  };

  const handleRestart = async () => {
    try {
      await restartNode();
    } catch {
      // Error is already handled by the hook
    }
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Get the best address for sharing - prefer public IP, then LAN IP, then localhost
  const getShareableAddress = (addresses: string[], publicIp?: string): string | null => {
    if (addresses.length === 0) return null;

    // If we have a public IP, construct multiaddr with it using the P2P port from existing addresses
    if (publicIp) {
      // Extract port from an existing address (e.g., /ip4/192.168.0.1/tcp/8090 -> 8090)
      const addrWithPort = addresses.find(addr => addr.includes('/tcp/'));
      if (addrWithPort) {
        const portMatch = addrWithPort.match(/\/tcp\/(\d+)/);
        if (portMatch) {
          return `/ip4/${publicIp}/tcp/${portMatch[1]}`;
        }
      }
    }

    // Fallback: Find LAN address (192.168.x.x, 10.x.x.x, or 172.16-31.x.x)
    const lanAddress = addresses.find(addr =>
      addr.includes('/ip4/192.168.') ||
      addr.includes('/ip4/10.') ||
      /\/ip4\/172\.(1[6-9]|2[0-9]|3[0-1])\./.test(addr)
    );
    // Return LAN address if found, otherwise first non-localhost address, otherwise first address
    if (lanAddress) return lanAddress;
    const nonLocalhost = addresses.find(addr => !addr.includes('/ip4/127.'));
    return nonLocalhost || addresses[0];
  };

  const runDiagnostics = async () => {
    setRunningDiagnostics(true);
    try {
      const result = await invoke<DiagnosticInfo>('run_node_diagnostics');
      setDiagnostics(result);
    } catch (err) {
      setDiagnostics({
        apiReachable: false,
        apiUrl: status.apiUrl || 'http://127.0.0.1:8080',
        addressCount: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRunningDiagnostics(false);
    }
  };

  useEffect(() => {
    if (showDiagnostics && !diagnostics && isRunning) {
      runDiagnostics();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDiagnostics, isRunning]);

  return (
    <div className="page">
      <h2>Dashboard</h2>

      {error && <div className="error-banner">{error}</div>}

      <div className="stats-grid">
        <div className="stat-card">
          <h3>Node Status</h3>
          <div className={`status-indicator ${getStateClass(status.state)}`}>
            {getStateLabel(status.state)}
          </div>
          {status.pid && <p>PID: {status.pid}</p>}
          {status.version && <p>Version: {status.version}</p>}
          {isRunning && status.uptimeSeconds !== undefined && (
            <p>Uptime: {formatUptime(status.uptimeSeconds)}</p>
          )}
          {status.restartCount > 0 && (
            <p className="restart-count">Restarts: {status.restartCount}</p>
          )}
          {status.lastError && (
            <p className="last-error">Last error: {status.lastError}</p>
          )}
          <div className="node-controls">
            {isStopped || isError ? (
              <button onClick={handleStart} disabled={loading || isTransitioning}>
                {loading ? 'Starting...' : 'Start Node'}
              </button>
            ) : isRunning ? (
              <>
                <button onClick={handleStop} disabled={loading || isTransitioning}>
                  {loading ? 'Stopping...' : 'Stop'}
                </button>
                <button onClick={handleRestart} disabled={loading || isTransitioning} className="secondary">
                  Restart
                </button>
              </>
            ) : (
              <button disabled>
                {getStateLabel(status.state)}
              </button>
            )}
          </div>
        </div>

        <div className="stat-card">
          <h3>Connected Peers</h3>
          <div className="big-number">{status.peerCount}</div>
          <p>Active connections</p>
        </div>

        <div className="stat-card">
          <h3>Storage</h3>
          <div className="storage-bar">
            <div
              className="storage-used"
              style={{
                width: `${status.storageAvailableBytes > 0
                  ? (status.storageUsedBytes / status.storageAvailableBytes) * 100
                  : 0}%`,
              }}
            />
          </div>
          <p>
            {formatBytes(status.storageUsedBytes)} / {formatBytes(status.storageAvailableBytes)}
          </p>
        </div>

        <div className="stat-card">
          <h3>Sync Status</h3>
          <div className={`status-indicator ${syncState.isSyncing ? 'syncing' : 'idle'}`}>
            {syncState.isSyncing ? 'Syncing' : 'Idle'}
          </div>
          <p>{syncState.queueSize} files in queue</p>
          <p>{syncState.folders.length} watched folders</p>
        </div>
      </div>

      {isRunning && status.peerId && (
        <div className="peer-info">
          <h3>Peer Identity</h3>
          <div className="peer-id-row">
            <label>Peer ID:</label>
            <div className="copyable-field">
              <code className="peer-id">{status.peerId}</code>
              <button
                className="copy-button"
                onClick={() => copyToClipboard(status.peerId!, 'peerId')}
                title="Copy Peer ID"
              >
                {copied === 'peerId' ? '✓' : 'Copy'}
              </button>
            </div>
          </div>
          {status.addresses.length > 0 && status.peerId && getShareableAddress(status.addresses, status.publicIp) && (
            <div className="peer-id-row">
              <label>Connect Multiaddr (share this):</label>
              <div className="copyable-field">
                <code className="multiaddr">{getShareableAddress(status.addresses, status.publicIp)}/p2p/{status.peerId}</code>
                <button
                  className="copy-button"
                  onClick={() => copyToClipboard(`${getShareableAddress(status.addresses, status.publicIp)}/p2p/${status.peerId}`, 'multiaddr')}
                  title="Copy Multiaddr"
                >
                  {copied === 'multiaddr' ? '✓' : 'Copy'}
                </button>
              </div>
            </div>
          )}
          {status.spr && (
            <div className="peer-id-row">
              <label>SPR (for connecting):</label>
              <div className="copyable-field">
                <code className="spr">{status.spr.substring(0, 40)}...</code>
                <button
                  className="copy-button"
                  onClick={() => copyToClipboard(status.spr!, 'spr')}
                  title="Copy SPR"
                >
                  {copied === 'spr' ? '✓' : 'Copy'}
                </button>
              </div>
            </div>
          )}
          {status.addresses.length > 0 && (
            <div className="peer-id-row">
              <label>Addresses:</label>
              <div className="addresses-list">
                {status.addresses.slice(0, 3).map((addr, i) => (
                  <code key={i} className="address">{addr}</code>
                ))}
                {status.addresses.length > 3 && (
                  <span className="more-addresses">+{status.addresses.length - 3} more</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {status.apiUrl && (
        <div className="api-info">
          <h3>Node API</h3>
          <p><code>{status.apiUrl}</code></p>
        </div>
      )}

      {syncState.recentUploads.length > 0 && (
        <div className="recent-activity">
          <h3>Recent Uploads</h3>
          <ul>
            {syncState.recentUploads.slice(0, 5).map((filename: string, i: number) => (
              <li key={i}>
                {filename}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Diagnostics Panel */}
      {isRunning && (
        <div className="diagnostics-panel">
          <div className="diagnostics-header">
            <h3>Connection Diagnostics</h3>
            <button
              className="secondary small"
              onClick={() => setShowDiagnostics(!showDiagnostics)}
            >
              {showDiagnostics ? 'Hide' : 'Show'} Diagnostics
            </button>
          </div>

          {showDiagnostics && (
            <div className="diagnostics-content">
              <p className="diagnostics-description">
                Use these diagnostics to troubleshoot P2P connectivity issues.
                See <code>P2P-TESTING-GUIDE.md</code> for detailed testing instructions.
              </p>

              <button
                onClick={runDiagnostics}
                disabled={runningDiagnostics}
                className="secondary"
              >
                {runningDiagnostics ? 'Running...' : 'Run Diagnostics'}
              </button>

              {diagnostics && (
                <div className="diagnostic-results">
                  <div className={`diagnostic-item ${diagnostics.apiReachable ? 'success' : 'error'}`}>
                    <span className="diagnostic-label">API Reachable:</span>
                    <span className="diagnostic-value">
                      {diagnostics.apiReachable ? '✓ Yes' : '✗ No'}
                    </span>
                  </div>

                  <div className="diagnostic-item">
                    <span className="diagnostic-label">API URL:</span>
                    <span className="diagnostic-value"><code>{diagnostics.apiUrl}</code></span>
                  </div>

                  {diagnostics.nodeVersion && (
                    <div className="diagnostic-item success">
                      <span className="diagnostic-label">Node Version:</span>
                      <span className="diagnostic-value">{diagnostics.nodeVersion}</span>
                    </div>
                  )}

                  {diagnostics.peerId && (
                    <div className="diagnostic-item success">
                      <span className="diagnostic-label">Peer ID:</span>
                      <span className="diagnostic-value">
                        <code>{diagnostics.peerId.slice(0, 20)}...</code>
                      </span>
                    </div>
                  )}

                  <div className={`diagnostic-item ${diagnostics.addressCount > 0 ? 'success' : 'warning'}`}>
                    <span className="diagnostic-label">Network Addresses:</span>
                    <span className="diagnostic-value">{diagnostics.addressCount} found</span>
                  </div>

                  {diagnostics.error && (
                    <div className="diagnostic-item error">
                      <span className="diagnostic-label">Error:</span>
                      <span className="diagnostic-value">{diagnostics.error}</span>
                    </div>
                  )}

                  <div className="diagnostic-tips">
                    <h4>Troubleshooting Tips:</h4>
                    <ul>
                      {!diagnostics.apiReachable && (
                        <li>Node API is not responding. Try restarting the node.</li>
                      )}
                      {diagnostics.apiReachable && diagnostics.addressCount === 0 && (
                        <li>No network addresses found. Check firewall and network configuration.</li>
                      )}
                      {diagnostics.apiReachable && diagnostics.addressCount > 0 && status.peerCount === 0 && (
                        <li>Node is reachable but no peers connected. Share your SPR on the Peers page.</li>
                      )}
                      {diagnostics.apiReachable && status.peerCount > 0 && (
                        <li>✓ Everything looks good! You have {status.peerCount} connected peer{status.peerCount !== 1 ? 's' : ''}.</li>
                      )}
                    </ul>
                    <p>
                      For detailed testing instructions, see{' '}
                      <a href="#" onClick={(e) => {e.preventDefault(); invoke('open_external', {url: 'https://github.com/durability-labs/archivist-desktop/blob/main/P2P-TESTING-GUIDE.md'});}}>
                        P2P Testing Guide
                      </a>
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default Dashboard;
