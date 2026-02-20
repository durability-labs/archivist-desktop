import { useState, useCallback } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import {
  useTorrent,
  TorrentItem,
  TorrentState,
} from '../hooks/useTorrent';
import '../styles/Torrents.css';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec === 0) return '0 B/s';
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
}

function stateLabel(state: TorrentState): string {
  const labels: Record<TorrentState, string> = {
    initializing: 'Initializing',
    downloading: 'Downloading',
    seeding: 'Seeding',
    paused: 'Paused',
    checking: 'Checking',
    error: 'Error',
    queued: 'Queued',
  };
  return labels[state] || state;
}

function stateClass(state: TorrentState): string {
  switch (state) {
    case 'downloading': return 'state-downloading';
    case 'seeding': return 'state-seeding';
    case 'paused': return 'state-paused';
    case 'error': return 'state-error';
    default: return 'state-other';
  }
}

export default function Torrents() {
  const {
    sessionStats,
    loading,
    error,
    selectedTorrentId,
    setSelectedTorrentId,
    peers,
    addTorrent,
    pauseTorrent,
    resumeTorrent,
    removeTorrent,
    setTorrentFiles,
    setSpeedLimits,
  } = useTorrent();

  const [magnetUrl, setMagnetUrl] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<'files' | 'peers' | 'info'>('files');
  const [dlLimitKBs, setDlLimitKBs] = useState('');
  const [ulLimitKBs, setUlLimitKBs] = useState('');

  const selectedTorrent = sessionStats?.torrents.find(t => t.id === selectedTorrentId) ?? null;

  const handleAddMagnet = useCallback(async () => {
    if (!magnetUrl.trim()) return;
    setAddError(null);
    try {
      await addTorrent({
        source: magnetUrl.trim(),
        sourceType: 'magnet',
        paused: false,
        sequential: false,
      });
      setMagnetUrl('');
    } catch (e) {
      setAddError(typeof e === 'string' ? e : (e instanceof Error ? e.message : 'Failed to add torrent'));
    }
  }, [magnetUrl, addTorrent]);

  const handleAddFile = useCallback(async () => {
    setAddError(null);
    try {
      const selected = await open({
        filters: [{ name: 'Torrent', extensions: ['torrent'] }],
        multiple: false,
      });
      if (!selected) return;
      const filePath = typeof selected === 'string' ? selected : selected;
      // Read the file and base64 encode it
      const { readFile } = await import('@tauri-apps/plugin-fs');
      const bytes = await readFile(filePath as string);
      const base64 = btoa(String.fromCharCode(...bytes));
      await addTorrent({
        source: base64,
        sourceType: 'file',
        paused: false,
        sequential: false,
      });
    } catch (e) {
      setAddError(typeof e === 'string' ? e : (e instanceof Error ? e.message : 'Failed to add torrent file'));
    }
  }, [addTorrent]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleAddMagnet();
  }, [handleAddMagnet]);

  const handlePauseResume = useCallback(async (torrent: TorrentItem) => {
    try {
      if (torrent.state === 'paused') {
        await resumeTorrent(torrent.id);
      } else {
        await pauseTorrent(torrent.id);
      }
    } catch (e) {
      console.error('Pause/resume failed:', e);
    }
  }, [pauseTorrent, resumeTorrent]);

  const handleRemove = useCallback(async (id: number, deleteFiles: boolean) => {
    if (!confirm(deleteFiles ? 'Remove torrent and delete files?' : 'Remove torrent?')) return;
    try {
      await removeTorrent(id, deleteFiles);
    } catch (e) {
      console.error('Remove failed:', e);
    }
  }, [removeTorrent]);

  const handleFileToggle = useCallback(async (torrentId: number, files: TorrentItem['files'], toggleIndex: number) => {
    const newSelection = files
      .map((f, i) => {
        if (i === toggleIndex) return { ...f, included: !f.included };
        return f;
      })
      .filter(f => f.included)
      .map(f => f.index);
    try {
      await setTorrentFiles(torrentId, newSelection);
    } catch (e) {
      console.error('File selection update failed:', e);
    }
  }, [setTorrentFiles]);

  const handleSpeedLimitApply = useCallback(() => {
    const dlLimit = dlLimitKBs ? parseInt(dlLimitKBs) * 1024 : null;
    const ulLimit = ulLimitKBs ? parseInt(ulLimitKBs) * 1024 : null;
    setSpeedLimits({ downloadLimitBytes: dlLimit, uploadLimitBytes: ulLimit });
  }, [dlLimitKBs, ulLimitKBs, setSpeedLimits]);

  if (loading) {
    return (
      <div className="torrents-page">
        <h1>Torrents</h1>
        <div className="loading-message">Initializing torrent engine...</div>
      </div>
    );
  }

  return (
    <div className="torrents-page">
      {/* Header with global stats */}
      <div className="torrents-header">
        <h1>Torrents</h1>
        <div className="global-stats">
          <span className="dl-speed" title="Total download speed">
            &#9660; {formatSpeed(sessionStats?.totalDownloadSpeed ?? 0)}
          </span>
          <span className="ul-speed" title="Total upload speed">
            &#9650; {formatSpeed(sessionStats?.totalUploadSpeed ?? 0)}
          </span>
        </div>
      </div>

      {/* Add torrent bar */}
      <div className="add-torrent-bar">
        <input
          type="text"
          value={magnetUrl}
          onChange={e => setMagnetUrl(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Paste magnet link..."
          className="magnet-input"
        />
        <button onClick={handleAddMagnet} className="add-magnet-btn" disabled={!magnetUrl.trim()}>
          Add
        </button>
        <button onClick={handleAddFile} className="add-file-btn">
          Add .torrent File
        </button>
      </div>

      {addError && <div className="torrent-error">{addError}</div>}
      {error && <div className="torrent-error">{error}</div>}

      {/* Torrent list */}
      {(!sessionStats || sessionStats.torrents.length === 0) ? (
        <div className="torrent-empty-state">
          <p>No torrents. Add a magnet link or .torrent file to get started.</p>
        </div>
      ) : (
        <div className="torrent-list">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Size</th>
                <th>Progress</th>
                <th>DL Speed</th>
                <th>UL Speed</th>
                <th>Ratio</th>
                <th>Seeds</th>
                <th>Peers</th>
                <th>ETA</th>
                <th>State</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sessionStats.torrents.map(torrent => (
                <tr
                  key={torrent.id}
                  className={`torrent-row ${selectedTorrentId === torrent.id ? 'selected' : ''}`}
                  onClick={() => setSelectedTorrentId(torrent.id === selectedTorrentId ? null : torrent.id)}
                >
                  <td className="torrent-name" title={torrent.name}>{torrent.name}</td>
                  <td>{formatBytes(torrent.totalBytes)}</td>
                  <td>
                    <div className="torrent-progress-bar">
                      <div
                        className="torrent-progress-fill"
                        style={{ width: `${Math.min(torrent.progressPercent, 100)}%` }}
                      />
                      <span className="torrent-progress-text">
                        {torrent.progressPercent.toFixed(1)}%
                      </span>
                    </div>
                  </td>
                  <td className="torrent-speed-dl">{formatSpeed(torrent.downloadSpeed)}</td>
                  <td className="torrent-speed-ul">{formatSpeed(torrent.uploadSpeed)}</td>
                  <td>{torrent.ratio.toFixed(2)}</td>
                  <td>{torrent.seedsConnected}</td>
                  <td>{torrent.peersConnected}</td>
                  <td>{torrent.eta ?? '—'}</td>
                  <td>
                    <span className={`torrent-state-badge ${stateClass(torrent.state)}`}>
                      {stateLabel(torrent.state)}
                    </span>
                  </td>
                  <td className="torrent-actions" onClick={e => e.stopPropagation()}>
                    {torrent.state === 'paused' ? (
                      <button className="torrent-resume-btn" onClick={() => handlePauseResume(torrent)} title="Resume">
                        &#9654;
                      </button>
                    ) : (
                      <button className="torrent-pause-btn" onClick={() => handlePauseResume(torrent)} title="Pause">
                        &#10074;&#10074;
                      </button>
                    )}
                    <button
                      className="torrent-remove-btn"
                      onClick={() => handleRemove(torrent.id, false)}
                      title="Remove"
                    >
                      &#10005;
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail panel */}
      {selectedTorrent && (
        <div className="torrent-detail-panel">
          <div className="detail-tabs">
            <button
              data-tab="files"
              className={detailTab === 'files' ? 'active' : ''}
              onClick={() => setDetailTab('files')}
            >
              Files
            </button>
            <button
              data-tab="peers"
              className={detailTab === 'peers' ? 'active' : ''}
              onClick={() => setDetailTab('peers')}
            >
              Peers
            </button>
            <button
              data-tab="info"
              className={detailTab === 'info' ? 'active' : ''}
              onClick={() => setDetailTab('info')}
            >
              Info
            </button>
          </div>

          <div className="detail-content">
            {detailTab === 'files' && (
              <div className="file-tree">
                {selectedTorrent.files.map((file) => (
                  <div key={file.index} className="file-tree-item">
                    <input
                      type="checkbox"
                      checked={file.included}
                      onChange={() => handleFileToggle(selectedTorrent.id, selectedTorrent.files, file.index)}
                    />
                    <span className="file-name" title={file.path}>{file.name}</span>
                    <span className="file-size">{formatBytes(file.length)}</span>
                    <div className="file-progress-bar">
                      <div
                        className="file-progress-fill"
                        style={{ width: `${Math.min(file.progressPercent, 100)}%` }}
                      />
                    </div>
                    <span className="file-progress-text">{file.progressPercent.toFixed(1)}%</span>
                  </div>
                ))}
                {selectedTorrent.files.length === 0 && (
                  <div className="detail-empty">Loading file list...</div>
                )}
              </div>
            )}

            {detailTab === 'peers' && (
              <table className="peer-table">
                <thead>
                  <tr>
                    <th>Address</th>
                    <th>Client</th>
                    <th>DL Speed</th>
                    <th>UL Speed</th>
                    <th>Progress</th>
                    <th>Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {peers.map((peer, i) => (
                    <tr key={i}>
                      <td>{peer.addr}</td>
                      <td>{peer.client ?? '—'}</td>
                      <td>{formatSpeed(peer.downloadSpeed)}</td>
                      <td>{formatSpeed(peer.uploadSpeed)}</td>
                      <td>{peer.progressPercent.toFixed(1)}%</td>
                      <td>{peer.flags}</td>
                    </tr>
                  ))}
                  {peers.length === 0 && (
                    <tr><td colSpan={6} className="detail-empty">No peers connected</td></tr>
                  )}
                </tbody>
              </table>
            )}

            {detailTab === 'info' && (
              <div className="torrent-info-panel">
                <div className="info-row">
                  <label>Info Hash</label>
                  <span className="torrent-info-hash">{selectedTorrent.infoHash}</span>
                </div>
                <div className="info-row">
                  <label>Output Folder</label>
                  <span>{selectedTorrent.outputFolder}</span>
                </div>
                <div className="info-row">
                  <label>Added</label>
                  <span>{new Date(selectedTorrent.addedAt).toLocaleString()}</span>
                </div>
                <div className="info-row">
                  <label>Completed</label>
                  <span>{selectedTorrent.completedAt ? new Date(selectedTorrent.completedAt).toLocaleString() : '—'}</span>
                </div>
                <div className="info-row">
                  <label>Downloaded</label>
                  <span>{formatBytes(selectedTorrent.downloadedBytes)}</span>
                </div>
                <div className="info-row">
                  <label>Uploaded</label>
                  <span>{formatBytes(selectedTorrent.uploadedBytes)}</span>
                </div>
                <div className="info-row">
                  <label>Ratio</label>
                  <span>{selectedTorrent.ratio.toFixed(3)}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Status bar */}
      <div className="torrent-status-bar">
        <div className="speed-limit-dl">
          <label>DL Limit (KB/s)</label>
          <input
            type="number"
            value={dlLimitKBs}
            onChange={e => setDlLimitKBs(e.target.value)}
            onBlur={handleSpeedLimitApply}
            placeholder="∞"
            min="0"
          />
        </div>
        <div className="speed-limit-ul">
          <label>UL Limit (KB/s)</label>
          <input
            type="number"
            value={ulLimitKBs}
            onChange={e => setUlLimitKBs(e.target.value)}
            onBlur={handleSpeedLimitApply}
            placeholder="∞"
            min="0"
          />
        </div>
        <span className="dht-peers">DHT: {sessionStats?.dhtPeers ?? 0} peers</span>
        <span className="status-summary">
          {sessionStats?.activeCount ?? 0} active,
          {' '}{sessionStats?.seedingCount ?? 0} seeding,
          {' '}{sessionStats?.pausedCount ?? 0} paused
        </span>
      </div>
    </div>
  );
}
