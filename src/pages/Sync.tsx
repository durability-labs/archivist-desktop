import { useState, useEffect } from 'react';
import { useSync } from '../hooks/useSync';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';

interface AppConfig {
  sync: {
    backup_enabled: boolean;
  };
}

function Sync() {
  const {
    syncState,
    loading,
    error,
    addWatchFolder,
    removeWatchFolder,
    toggleWatchFolder,
    syncNow,
    pauseSync,
    refreshStatus,
  } = useSync();

  const [config, setConfig] = useState<AppConfig | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);

  // Load config to check if backup is enabled
  useEffect(() => {
    async function loadConfig() {
      try {
        const cfg = await invoke<AppConfig>('get_config');
        setConfig(cfg);
      } catch (e) {
        console.error('Failed to load config:', e);
      }
    }
    loadConfig();
  }, []);

  const handleAddFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        title: 'Select folder to watch',
      });

      if (selected && typeof selected === 'string') {
        await addWatchFolder(selected);
      }
    } catch (e) {
      console.error('Failed to add folder:', e);
    }
  };

  const manualBackupFolder = async (folderId: string) => {
    try {
      setBackupError(null);
      await invoke('notify_backup_peer', { folderId });
      await refreshStatus();
    } catch (e) {
      const msg = typeof e === 'string' ? e : (e instanceof Error ? e.message : 'Backup failed');
      setBackupError(msg);
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

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'idle': return 'Idle';
      case 'scanning': return 'Scanning...';
      case 'syncing': return 'Syncing...';
      case 'error': return 'Error';
      case 'paused': return 'Paused';
      default: return status;
    }
  };

  const getStatusClass = (status: string) => {
    switch (status) {
      case 'syncing':
      case 'scanning':
        return 'syncing';
      case 'error':
        return 'error';
      case 'paused':
        return 'stopped';
      default:
        return 'idle';
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h2>Sync</h2>
        <div className="actions">
          <button onClick={handleAddFolder} disabled={loading}>
            Add Watch Folder
          </button>
          {syncState.isSyncing ? (
            <button onClick={pauseSync} disabled={loading} className="danger">
              Pause Sync
            </button>
          ) : (
            <button onClick={syncNow} disabled={loading || syncState.folders.length === 0}>
              Sync Now
            </button>
          )}
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {backupError && <div className="error-banner">{backupError}</div>}

      <div className="sync-status-card">
        <h3>Sync Status</h3>
        <div className={`status-indicator ${syncState.isSyncing ? 'syncing' : 'idle'}`}>
          {syncState.isSyncing ? 'Syncing...' : 'Idle'}
        </div>
        <div className="sync-stats">
          <span>{syncState.syncedFiles} / {syncState.totalFiles} files synced</span>
          {syncState.queueSize > 0 && (
            <span className="queue-size">{syncState.queueSize} files in queue</span>
          )}
        </div>
      </div>

      {syncState.recentUploads.length > 0 && (
        <div className="recent-uploads">
          <h3>Recent Uploads</h3>
          <ul>
            {syncState.recentUploads.map((filename, idx) => (
              <li key={idx}>{filename}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="watched-folders">
        <h3>Watched Folders</h3>
        {syncState.folders.length === 0 ? (
          <div className="empty-state">
            <p>No folders being watched.</p>
            <p>Add a folder to automatically sync its contents to the network.</p>
          </div>
        ) : (
          <ul className="folder-list">
            {syncState.folders.map((folder) => (
              <li key={folder.id} className="folder-item">
                <div className="folder-info">
                  <span className="folder-path">{folder.path}</span>
                  <span className="folder-stats">
                    {folder.fileCount} files ({formatBytes(folder.totalSizeBytes)})
                    <span className={`folder-status ${getStatusClass(folder.status)}`}>
                      {getStatusLabel(folder.status)}
                    </span>
                  </span>
                  <span className="last-sync">
                    Last synced: {formatDate(folder.lastSynced)}
                  </span>
                  {config?.sync.backup_enabled && folder.backupSyncedAt && (
                    <span className="backup-status">
                      Backed up: {formatDate(folder.backupSyncedAt)}
                    </span>
                  )}
                  {folder.manifestCid && (
                    <span className="manifest-cid">
                      Manifest: <code>{folder.manifestCid.slice(0, 12)}...</code>
                    </span>
                  )}
                </div>
                <div className="folder-actions">
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={folder.enabled}
                      onChange={(e) => toggleWatchFolder(folder.id, e.target.checked)}
                    />
                    <span className="toggle-label">
                      {folder.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </label>
                  {config?.sync.backup_enabled && (
                    <button
                      className="small secondary"
                      onClick={() => manualBackupFolder(folder.id)}
                      disabled={!folder.manifestCid}
                      title="Notify backup peer now"
                    >
                      Backup Now
                    </button>
                  )}
                  <button
                    className="small danger"
                    onClick={() => removeWatchFolder(folder.id)}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="sync-info">
        <h3>How Backups Work</h3>
        <ol>
          <li>Add folders you want to back up</li>
          <li>Files are automatically uploaded to your local node when created or modified</li>
          <li>After enough changes, a manifest is generated listing all your files</li>
          <li>Your backup server polls for new manifests and downloads the files</li>
        </ol>
        <p className="hint">
          Hidden files (starting with .) and temporary files (.tmp, ~) are automatically ignored.
          Configure your backup server in Settings → Backup Server.
        </p>
      </div>
    </div>
  );
}

export default Sync;
