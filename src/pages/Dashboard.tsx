import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useNode, NodeState, NodeStatus } from '../hooks/useNode';
import { useSync, SyncState } from '../hooks/useSync';
import { usePeers } from '../hooks/usePeers';
import { invoke } from '@tauri-apps/api/core';
import NextSteps from '../components/NextSteps';

interface DiagnosticInfo {
  apiReachable: boolean;
  apiUrl: string;
  nodeVersion?: string;
  peerId?: string;
  addressCount: number;
  error?: string;
}

type ViewMode = 'basic' | 'advanced';

interface BasicViewProps {
  status: NodeStatus;
  loading: boolean;
  isRunning: boolean;
  isStopped: boolean;
  isError: boolean;
  isTransitioning: boolean;
  handleStart: () => Promise<void>;
  handleStop: () => Promise<void>;
  handleRestart: () => Promise<void>;
  getStateLabel: (state: NodeState) => string;
  getStateClass: (state: NodeState) => string;
  formatUptime: (seconds: number) => string;
  formatBytes: (bytes: number) => string;
  syncState: SyncState;
  copied: string | null;
  copyToClipboard: (text: string, label: string) => Promise<void>;
  getShareableAddress: (addresses: string[], publicIp?: string) => string | null;
  connectedPeerCount: number;
}

interface AdvancedViewProps extends BasicViewProps {
  showDiagnostics: boolean;
  setShowDiagnostics: (show: boolean) => void;
  diagnostics: DiagnosticInfo | null;
  runningDiagnostics: boolean;
  runDiagnostics: () => Promise<void>;
}

function Dashboard() {
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem('dashboardViewMode');
    return (saved as ViewMode) || 'basic';
  });
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
  const { peerList } = usePeers();

  // Get actual connected peer count from usePeers hook (more accurate than status.peerCount)
  const connectedPeerCount = peerList.peers.filter(p => p.connected).length;

  useEffect(() => {
    localStorage.setItem('dashboardViewMode', viewMode);
  }, [viewMode]);

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

  const getShareableAddress = (addresses: string[], publicIp?: string): string | null => {
    if (addresses.length === 0) return null;

    if (publicIp) {
      const addrWithPort = addresses.find(addr => addr.includes('/tcp/'));
      if (addrWithPort) {
        const portMatch = addrWithPort.match(/\/tcp\/(\d+)/);
        if (portMatch) {
          return `/ip4/${publicIp}/tcp/${portMatch[1]}`;
        }
      }
    }

    const lanAddress = addresses.find(addr =>
      addr.includes('/ip4/192.168.') ||
      addr.includes('/ip4/10.') ||
      /\/ip4\/172\.(1[6-9]|2[0-9]|3[0-1])\./.test(addr)
    );
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
      <div className="page-header">
        <h2>Dashboard</h2>
        <div className="view-mode-toggle">
          <button
            className={viewMode === 'basic' ? 'active' : 'secondary'}
            onClick={() => setViewMode('basic')}
          >
            Basic
          </button>
          <button
            className={viewMode === 'advanced' ? 'active' : 'secondary'}
            onClick={() => setViewMode('advanced')}
          >
            Advanced
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {viewMode === 'basic' ? (
        <BasicView
          status={status}
          loading={loading}
          isRunning={isRunning}
          isStopped={isStopped}
          isError={isError}
          isTransitioning={isTransitioning}
          handleStart={handleStart}
          handleStop={handleStop}
          handleRestart={handleRestart}
          getStateLabel={getStateLabel}
          getStateClass={getStateClass}
          formatUptime={formatUptime}
          formatBytes={formatBytes}
          syncState={syncState}
          copied={copied}
          copyToClipboard={copyToClipboard}
          getShareableAddress={getShareableAddress}
          connectedPeerCount={connectedPeerCount}
        />
      ) : (
        <AdvancedView
          status={status}
          loading={loading}
          isRunning={isRunning}
          isStopped={isStopped}
          isError={isError}
          isTransitioning={isTransitioning}
          handleStart={handleStart}
          handleStop={handleStop}
          handleRestart={handleRestart}
          getStateLabel={getStateLabel}
          getStateClass={getStateClass}
          formatUptime={formatUptime}
          formatBytes={formatBytes}
          syncState={syncState}
          copied={copied}
          copyToClipboard={copyToClipboard}
          getShareableAddress={getShareableAddress}
          connectedPeerCount={connectedPeerCount}
          showDiagnostics={showDiagnostics}
          setShowDiagnostics={setShowDiagnostics}
          diagnostics={diagnostics}
          runningDiagnostics={runningDiagnostics}
          runDiagnostics={runDiagnostics}
        />
      )}
    </div>
  );
}

// Helper to format relative time
function formatRelativeTime(dateString: string | null): string {
  if (!dateString) return 'Never';
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

// Get most recent backup time from folders
function getLastBackupTime(syncState: SyncState): string | null {
  const times = syncState.folders
    .map(f => f.lastSynced)
    .filter((t): t is string => t !== null)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
  return times[0] || null;
}

// Basic View - Simple, focused on essential controls
function BasicView({ status, loading, isRunning, isStopped, isError, isTransitioning, handleStart, handleStop, handleRestart, getStateLabel, getStateClass, formatUptime, formatBytes, syncState, copied, copyToClipboard, getShareableAddress, connectedPeerCount }: BasicViewProps) {
  const hasBackupFolders = syncState.folders.length > 0;
  const hasConnectedPeers = connectedPeerCount > 0;
  const lastBackupTime = getLastBackupTime(syncState);

  return (
    <div className="basic-view">
      {/* Main Status Hero */}
      <div className="status-hero">
        <div className="status-hero-content">
          <div className="status-badge-large">
            <div className={`status-dot ${getStateClass(status.state)}`}></div>
            <span className="status-text">{getStateLabel(status.state)}</span>
          </div>
          {isRunning && status.uptimeSeconds !== undefined && (
            <p className="status-detail">Running for {formatUptime(status.uptimeSeconds)}</p>
          )}
          {status.version && <p className="status-detail">Node {status.version}</p>}
        </div>
        <div className="node-controls-large">
          {isStopped || isError ? (
            <button onClick={handleStart} disabled={loading || isTransitioning} className="btn-large">
              {loading ? 'Starting...' : 'Start Node'}
            </button>
          ) : isRunning ? (
            <>
              <button onClick={handleStop} disabled={loading || isTransitioning} className="btn-large danger">
                {loading ? 'Stopping...' : 'Stop Node'}
              </button>
              <button onClick={handleRestart} disabled={loading || isTransitioning} className="btn-large secondary">
                Restart
              </button>
            </>
          ) : (
            <button disabled className="btn-large">
              {getStateLabel(status.state)}
            </button>
          )}
        </div>
      </div>

      {/* Quick Stats - positioned below Status Hero */}
      <div className="quick-stats">
        <Link to="/devices" className="quick-stat-card clickable">
          <div className="quick-stat-icon">👥</div>
          <div className="quick-stat-content">
            <div className="quick-stat-value">{connectedPeerCount}</div>
            <div className="quick-stat-label">Connected Peers</div>
          </div>
        </Link>
        <div className="quick-stat-card">
          <div className="quick-stat-icon">💾</div>
          <div className="quick-stat-content">
            <div className="quick-stat-value">{formatBytes(status.storageUsedBytes)}</div>
            <div className="quick-stat-label">Storage Used</div>
          </div>
        </div>
        <Link to="/sync" className="quick-stat-card clickable">
          <div className="quick-stat-icon">🕐</div>
          <div className="quick-stat-content">
            <div className="quick-stat-value">{formatRelativeTime(lastBackupTime)}</div>
            <div className="quick-stat-label">Last Backup</div>
          </div>
        </Link>
      </div>

      {/* Connection Info (when running) */}
      {isRunning && status.peerId && status.addresses.length > 0 && (
        <div className="connection-card">
          <h3>Share Your Connection</h3>
          <p className="connection-hint">Copy this address to share with other nodes</p>
          {getShareableAddress(status.addresses, status.publicIp) && (
            <div className="connection-field">
              <code className="connection-addr">
                {getShareableAddress(status.addresses, status.publicIp)}/p2p/{status.peerId}
              </code>
              <button
                className="btn-copy"
                onClick={() => copyToClipboard(`${getShareableAddress(status.addresses, status.publicIp)}/p2p/${status.peerId}`, 'multiaddr')}
              >
                {copied === 'multiaddr' ? '✓ Copied' : 'Copy'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Next Steps Panel (for post-onboarding guidance) */}
      {isRunning && (
        <NextSteps
          hasBackupFolders={hasBackupFolders}
          hasConnectedPeers={hasConnectedPeers}
        />
      )}

      {/* Recent Activity (when available) */}
      {syncState.recentUploads.length > 0 && (
        <div className="recent-activity-card">
          <h3>Recent Uploads</h3>
          <div className="recent-list">
            {syncState.recentUploads.slice(0, 3).map((filename: string, i: number) => (
              <div key={i} className="recent-item">
                <span className="recent-icon">📄</span>
                <span className="recent-name">{filename}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Advanced View - Full detailed information
function AdvancedView({ status, loading, isRunning, isStopped, isError, isTransitioning, handleStart, handleStop, handleRestart, getStateLabel, getStateClass, formatUptime, formatBytes, syncState, copied, copyToClipboard, getShareableAddress, connectedPeerCount, showDiagnostics, setShowDiagnostics, diagnostics, runningDiagnostics, runDiagnostics }: AdvancedViewProps) {
  return (
    <div className="advanced-view">
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
          <div className="big-number">{connectedPeerCount}</div>
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
                {status.addresses.slice(0, 3).map((addr: string, i: number) => (
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
                      {diagnostics.apiReachable && diagnostics.addressCount > 0 && connectedPeerCount === 0 && (
                        <li>Node is reachable but no peers connected. Share your SPR on the Devices page.</li>
                      )}
                      {diagnostics.apiReachable && connectedPeerCount > 0 && (
                        <li>✓ Everything looks good! You have {connectedPeerCount} connected peer{connectedPeerCount !== 1 ? 's' : ''}.</li>
                      )}
                    </ul>
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
