import { useNode, NodeState } from '../hooks/useNode';
import { useSync } from '../hooks/useSync';

function Dashboard() {
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
    </div>
  );
}

export default Dashboard;
