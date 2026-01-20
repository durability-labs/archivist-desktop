import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import '../styles/BackupServer.css';

interface DaemonState {
  processedManifests: Record<string, ProcessedManifest>;
  inProgressManifests: Record<string, InProgressManifest>;
  failedManifests: FailedManifest[];
  lastPollTime: string;
  stats: DaemonStats;
}

interface ProcessedManifest {
  manifestCid: string;
  sourcePeerId: string;
  sequenceNumber: number;
  folderId: string;
  processedAt: string;
  fileCount: number;
  totalSizeBytes: number;
  deletedCount: number;
}

interface InProgressManifest {
  manifestCid: string;
  sourcePeerId: string;
  sequenceNumber: number;
  startedAt: string;
  totalFiles: number;
  filesDownloaded: number;
  filesFailed: number;
  currentStatus: string;
}

interface FailedManifest {
  manifestCid: string;
  sourcePeerId: string;
  failedAt: string;
  errorMessage: string;
  retryCount: number;
}

interface DaemonStats {
  totalManifestsProcessed: number;
  totalFilesDownloaded: number;
  totalBytesDownloaded: number;
  totalFilesDeleted: number;
  lastActivityAt: string | null;
}

interface AppConfig {
  backup_server: {
    enabled: boolean;
    poll_interval_secs: number;
    max_concurrent_downloads: number;
    max_retries: number;
    auto_delete_tombstones: boolean;
  };
}

function BackupServer() {
  const [daemonState, setDaemonState] = useState<DaemonState | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  const loadState = async () => {
    try {
      const state = await invoke<DaemonState>('get_backup_daemon_state');
      setDaemonState(state);
      setError(null);
    } catch (e) {
      const msg = typeof e === 'string' ? e : (e instanceof Error ? e.message : 'Failed to load daemon state');
      setError(msg);
    }
  };

  const loadConfig = async () => {
    try {
      const cfg = await invoke<AppConfig>('get_config');
      setConfig(cfg);
    } catch (e) {
      console.error('Failed to load config:', e);
    }
  };

  useEffect(() => {
    async function init() {
      setLoading(true);
      await Promise.all([loadState(), loadConfig()]);
      setLoading(false);
    }
    init();

    // Poll every 5 seconds
    const interval = setInterval(loadState, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleEnable = async () => {
    try {
      setActionInProgress('enable');
      await invoke('enable_backup_daemon');
      await loadConfig();
      await loadState();
    } catch (e) {
      const msg = typeof e === 'string' ? e : (e instanceof Error ? e.message : 'Failed to enable daemon');
      setError(msg);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleDisable = async () => {
    try {
      setActionInProgress('disable');
      await invoke('disable_backup_daemon');
      await loadConfig();
      await loadState();
    } catch (e) {
      const msg = typeof e === 'string' ? e : (e instanceof Error ? e.message : 'Failed to disable daemon');
      setError(msg);
    } finally {
      setActionInProgress(null);
    }
  };

  const handlePause = async () => {
    try {
      setActionInProgress('pause');
      await invoke('pause_backup_daemon');
      await loadState();
    } catch (e) {
      const msg = typeof e === 'string' ? e : (e instanceof Error ? e.message : 'Failed to pause daemon');
      setError(msg);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleResume = async () => {
    try {
      setActionInProgress('resume');
      await invoke('resume_backup_daemon');
      await loadState();
    } catch (e) {
      const msg = typeof e === 'string' ? e : (e instanceof Error ? e.message : 'Failed to resume daemon');
      setError(msg);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleRetry = async (manifestCid: string) => {
    try {
      setActionInProgress(`retry-${manifestCid}`);
      await invoke('retry_failed_manifest', { manifestCid });
      await loadState();
    } catch (e) {
      const msg = typeof e === 'string' ? e : (e instanceof Error ? e.message : 'Failed to retry manifest');
      setError(msg);
    } finally {
      setActionInProgress(null);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    try {
      return new Date(dateStr).toLocaleString();
    } catch {
      return dateStr;
    }
  };

  const shortenCid = (cid: string) => {
    if (cid.length <= 16) return cid;
    return `${cid.slice(0, 8)}...${cid.slice(-8)}`;
  };

  const shortenPeerId = (peerId: string) => {
    if (peerId.length <= 20) return peerId;
    return `${peerId.slice(0, 12)}...`;
  };

  if (loading) {
    return (
      <div className="backup-server">
        <h1>Backup Server</h1>
        <div className="loading">Loading daemon state...</div>
      </div>
    );
  }

  const isEnabled = config?.backup_server.enabled ?? false;
  const processedManifests = Object.values(daemonState?.processedManifests ?? {});
  const inProgressManifests = Object.values(daemonState?.inProgressManifests ?? {});
  const failedManifests = daemonState?.failedManifests ?? [];
  const stats = daemonState?.stats;

  return (
    <div className="backup-server">
      <div className="page-header">
        <h1>Backup Server Dashboard</h1>
        <div className="header-actions">
          {!isEnabled && (
            <button
              className="primary"
              onClick={handleEnable}
              disabled={actionInProgress === 'enable'}
            >
              {actionInProgress === 'enable' ? 'Enabling...' : 'Enable Daemon'}
            </button>
          )}
          {isEnabled && (
            <>
              <button
                className="secondary"
                onClick={handlePause}
                disabled={actionInProgress === 'pause'}
              >
                {actionInProgress === 'pause' ? 'Pausing...' : 'Pause'}
              </button>
              <button
                className="secondary"
                onClick={handleResume}
                disabled={actionInProgress === 'resume'}
              >
                {actionInProgress === 'resume' ? 'Resuming...' : 'Resume'}
              </button>
              <button
                className="danger"
                onClick={handleDisable}
                disabled={actionInProgress === 'disable'}
              >
                {actionInProgress === 'disable' ? 'Disabling...' : 'Disable Daemon'}
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="error-banner">
          <span className="error-icon">⚠</span>
          <span>{error}</span>
          <button className="error-close" onClick={() => setError(null)}>×</button>
        </div>
      )}

      {!isEnabled && (
        <div className="info-banner">
          <span className="info-icon">ℹ</span>
          <span>Backup daemon is disabled. Enable it to automatically process manifests from source peers.</span>
        </div>
      )}

      {/* Statistics Cards */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Total Manifests Processed</div>
          <div className="stat-value">{stats?.totalManifestsProcessed ?? 0}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Files Downloaded</div>
          <div className="stat-value">{stats?.totalFilesDownloaded ?? 0}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Data Downloaded</div>
          <div className="stat-value">{formatBytes(stats?.totalBytesDownloaded ?? 0)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Files Deleted</div>
          <div className="stat-value">{stats?.totalFilesDeleted ?? 0}</div>
        </div>
      </div>

      <div className="last-activity">
        Last Activity: {formatDate(stats?.lastActivityAt ?? null)} •
        Last Poll: {formatDate(daemonState?.lastPollTime ?? null)}
      </div>

      {/* Configuration Info */}
      {config && (
        <div className="config-info">
          <h3>Configuration</h3>
          <div className="config-grid">
            <div className="config-item">
              <span className="config-label">Poll Interval:</span>
              <span className="config-value">{config.backup_server.poll_interval_secs}s</span>
            </div>
            <div className="config-item">
              <span className="config-label">Max Concurrent Downloads:</span>
              <span className="config-value">{config.backup_server.max_concurrent_downloads}</span>
            </div>
            <div className="config-item">
              <span className="config-label">Max Retries:</span>
              <span className="config-value">{config.backup_server.max_retries}</span>
            </div>
            <div className="config-item">
              <span className="config-label">Auto-Delete Tombstones:</span>
              <span className="config-value">{config.backup_server.auto_delete_tombstones ? 'Yes' : 'No'}</span>
            </div>
          </div>
        </div>
      )}

      {/* In-Progress Manifests */}
      {inProgressManifests.length > 0 && (
        <div className="section">
          <h2>Currently Processing ({inProgressManifests.length})</h2>
          <div className="table-container">
            <table className="manifest-table">
              <thead>
                <tr>
                  <th>Manifest CID</th>
                  <th>Source Peer</th>
                  <th>Sequence</th>
                  <th>Status</th>
                  <th>Progress</th>
                  <th>Started</th>
                </tr>
              </thead>
              <tbody>
                {inProgressManifests.map((manifest) => (
                  <tr key={manifest.manifestCid}>
                    <td>
                      <code title={manifest.manifestCid}>{shortenCid(manifest.manifestCid)}</code>
                    </td>
                    <td title={manifest.sourcePeerId}>{shortenPeerId(manifest.sourcePeerId)}</td>
                    <td>{manifest.sequenceNumber}</td>
                    <td>{manifest.currentStatus}</td>
                    <td>
                      <div className="progress-container">
                        <div className="progress-bar">
                          <div
                            className="progress-fill"
                            style={{
                              width: `${manifest.totalFiles > 0 ? (manifest.filesDownloaded / manifest.totalFiles) * 100 : 0}%`
                            }}
                          />
                        </div>
                        <div className="progress-text">
                          {manifest.filesDownloaded}/{manifest.totalFiles}
                          {manifest.filesFailed > 0 && ` (${manifest.filesFailed} failed)`}
                        </div>
                      </div>
                    </td>
                    <td>{formatDate(manifest.startedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Failed Manifests */}
      {failedManifests.length > 0 && (
        <div className="section">
          <h2>Failed Manifests ({failedManifests.length})</h2>
          <div className="table-container">
            <table className="manifest-table">
              <thead>
                <tr>
                  <th>Manifest CID</th>
                  <th>Source Peer</th>
                  <th>Error</th>
                  <th>Retries</th>
                  <th>Failed At</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {failedManifests.map((manifest) => (
                  <tr key={manifest.manifestCid}>
                    <td>
                      <code title={manifest.manifestCid}>{shortenCid(manifest.manifestCid)}</code>
                    </td>
                    <td title={manifest.sourcePeerId}>{shortenPeerId(manifest.sourcePeerId)}</td>
                    <td className="error-message">{manifest.errorMessage}</td>
                    <td>{manifest.retryCount}/{config?.backup_server.max_retries ?? 3}</td>
                    <td>{formatDate(manifest.failedAt)}</td>
                    <td>
                      <button
                        className="small"
                        onClick={() => handleRetry(manifest.manifestCid)}
                        disabled={actionInProgress === `retry-${manifest.manifestCid}`}
                      >
                        {actionInProgress === `retry-${manifest.manifestCid}` ? 'Retrying...' : 'Retry'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Processed Manifests */}
      <div className="section">
        <h2>Processed Manifests ({processedManifests.length})</h2>
        {processedManifests.length === 0 ? (
          <div className="empty-state">
            <p>No manifests processed yet. Waiting for source peers to send manifests...</p>
          </div>
        ) : (
          <div className="table-container">
            <table className="manifest-table">
              <thead>
                <tr>
                  <th>Manifest CID</th>
                  <th>Source Peer</th>
                  <th>Folder ID</th>
                  <th>Sequence</th>
                  <th>Files</th>
                  <th>Size</th>
                  <th>Deleted</th>
                  <th>Processed At</th>
                </tr>
              </thead>
              <tbody>
                {processedManifests
                  .sort((a, b) => new Date(b.processedAt).getTime() - new Date(a.processedAt).getTime())
                  .map((manifest) => (
                    <tr key={manifest.manifestCid}>
                      <td>
                        <code title={manifest.manifestCid}>{shortenCid(manifest.manifestCid)}</code>
                      </td>
                      <td title={manifest.sourcePeerId}>{shortenPeerId(manifest.sourcePeerId)}</td>
                      <td>
                        <code title={manifest.folderId}>{manifest.folderId.slice(0, 8)}</code>
                      </td>
                      <td>{manifest.sequenceNumber}</td>
                      <td>{manifest.fileCount}</td>
                      <td>{formatBytes(manifest.totalSizeBytes)}</td>
                      <td>{manifest.deletedCount > 0 ? manifest.deletedCount : '-'}</td>
                      <td>{formatDate(manifest.processedAt)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default BackupServer;
