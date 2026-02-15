import { useState, useCallback } from 'react';
import { useWebArchive } from '../hooks/useWebArchive';
import type { ArchiveTask } from '../lib/archiveTypes';
import '../styles/WebArchive.css';

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function stateLabel(state: string): string {
  switch (state) {
    case 'queued': return 'Queued';
    case 'crawling': return 'Crawling...';
    case 'downloading': return 'Downloading Assets...';
    case 'packaging': return 'Packaging ZIP...';
    case 'uploading': return 'Uploading to Node...';
    case 'completed': return 'Completed';
    case 'failed': return 'Failed';
    case 'cancelled': return 'Cancelled';
    default: return state;
  }
}

function stateBadgeClass(state: string): string {
  switch (state) {
    case 'completed': return 'badge-success';
    case 'failed': return 'badge-error';
    case 'cancelled': return 'badge-warning';
    case 'crawling':
    case 'downloading':
    case 'packaging':
    case 'uploading':
      return 'badge-active';
    default: return 'badge-default';
  }
}

export default function WebArchive() {
  const {
    queueState,
    loading,
    error,
    queueArchive,
    cancelArchive,
    removeTask,
    clearCompleted,
  } = useWebArchive();

  const [url, setUrl] = useState('');
  const [maxDepth, setMaxDepth] = useState(3);
  const [maxPages, setMaxPages] = useState(100);
  const [includeAssets, setIncludeAssets] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const handleSubmit = useCallback(async () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;

    // Basic URL validation
    try {
      new URL(trimmedUrl);
    } catch {
      setSubmitError('Please enter a valid URL (e.g., https://example.com)');
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      await queueArchive({
        url: trimmedUrl,
        maxDepth,
        maxPages,
        includeAssets,
        requestDelayMs: 200,
      });
      setUrl('');
    } catch (e) {
      setSubmitError(
        typeof e === 'string'
          ? e
          : e instanceof Error
            ? e.message
            : 'Failed to queue archive'
      );
    } finally {
      setSubmitting(false);
    }
  }, [url, maxDepth, maxPages, includeAssets, queueArchive]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !submitting) {
      handleSubmit();
    }
  };

  if (loading) {
    return (
      <div className="web-archive-page">
        <h1>Web Archive</h1>
        <div className="loading-text">Loading...</div>
      </div>
    );
  }

  const tasks = queueState?.tasks ?? [];
  const archivedSites = queueState?.archivedSites ?? [];
  const hasCompletedTasks = tasks.some(
    (t) => t.state === 'completed' || t.state === 'failed' || t.state === 'cancelled'
  );

  return (
    <div className="web-archive-page">
      <h1>Web Archive</h1>

      {error && <div className="archive-error">{error}</div>}

      {/* URL Input */}
      <div className="url-input-section">
        <label className="input-label">Website URL</label>
        <div className="url-input-row">
          <input
            type="text"
            className="url-input"
            placeholder="https://example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={submitting}
          />
          <button
            className="archive-btn"
            onClick={handleSubmit}
            disabled={submitting || !url.trim()}
          >
            {submitting ? 'Queuing...' : 'Archive'}
          </button>
        </div>

        {submitError && <div className="submit-error">{submitError}</div>}

        {/* Settings toggle */}
        <button
          className="settings-toggle"
          onClick={() => setShowSettings(!showSettings)}
        >
          {showSettings ? 'Hide Settings' : 'Crawl Settings'}
        </button>

        {showSettings && (
          <div className="crawl-settings">
            <div className="setting-row">
              <label>Max Depth</label>
              <input
                type="number"
                min={1}
                max={10}
                value={maxDepth}
                onChange={(e) => setMaxDepth(Number(e.target.value))}
              />
            </div>
            <div className="setting-row">
              <label>Max Pages</label>
              <input
                type="number"
                min={1}
                max={1000}
                value={maxPages}
                onChange={(e) => setMaxPages(Number(e.target.value))}
              />
            </div>
            <div className="setting-row">
              <label>
                <input
                  type="checkbox"
                  checked={includeAssets}
                  onChange={(e) => setIncludeAssets(e.target.checked)}
                />
                Include Assets (CSS, JS, images)
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Archive Queue */}
      {tasks.length > 0 && (
        <div className="queue-section">
          <div className="section-header">
            <h2>Archive Queue</h2>
            {hasCompletedTasks && (
              <button className="clear-btn" onClick={clearCompleted}>
                Clear Completed
              </button>
            )}
          </div>

          <div className="task-list">
            {tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onCancel={cancelArchive}
                onRemove={removeTask}
              />
            ))}
          </div>
        </div>
      )}

      {/* Archived Sites */}
      {archivedSites.length > 0 && (
        <div className="archived-section">
          <h2>Archived Sites</h2>
          <div className="archived-list">
            {archivedSites.map((site) => (
              <div key={site.cid} className="archived-item">
                <div className="archived-info">
                  <span className="archived-title">
                    {site.title || site.url}
                  </span>
                  <span className="archived-url">{site.url}</span>
                  <span className="archived-meta">
                    {site.pagesCount} pages, {site.assetsCount} assets,{' '}
                    {formatBytes(site.totalBytes)}
                  </span>
                </div>
                <div className="archived-cid" title={site.cid}>
                  CID: {site.cid.slice(0, 12)}...
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tasks.length === 0 && archivedSites.length === 0 && (
        <div className="empty-state">
          <p>Enter a URL above to archive a website to decentralized storage.</p>
          <p className="empty-detail">
            The crawler will download pages, assets, and package everything into
            a ZIP file uploaded to your archivist node.
          </p>
        </div>
      )}
    </div>
  );
}

function TaskCard({
  task,
  onCancel,
  onRemove,
}: {
  task: ArchiveTask;
  onCancel: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const isActive =
    task.state === 'crawling' ||
    task.state === 'downloading' ||
    task.state === 'packaging' ||
    task.state === 'uploading';
  const isFinished =
    task.state === 'completed' ||
    task.state === 'failed' ||
    task.state === 'cancelled';

  return (
    <div className={`task-card ${task.state}`}>
      <div className="task-header">
        <div className="task-info">
          <span className="task-url">{task.title || task.url}</span>
          <span className={`task-badge ${stateBadgeClass(task.state)}`}>
            {stateLabel(task.state)}
          </span>
        </div>
        <div className="task-actions">
          {(isActive || task.state === 'queued') && (
            <button
              className="cancel-btn"
              onClick={() => onCancel(task.id)}
              title="Cancel"
            >
              Cancel
            </button>
          )}
          {isFinished && (
            <button
              className="remove-btn"
              onClick={() => onRemove(task.id)}
              title="Remove"
            >
              Remove
            </button>
          )}
        </div>
      </div>

      {/* Progress info */}
      {(isActive || task.state === 'queued') && (
        <div className="task-progress">
          <div className="progress-stats">
            <span>Pages: {task.pagesDownloaded}/{task.pagesFound || '?'}</span>
            {task.assetsDownloaded > 0 && (
              <span>Assets: {task.assetsDownloaded}</span>
            )}
            {task.totalBytes > 0 && (
              <span>Size: {formatBytes(task.totalBytes)}</span>
            )}
          </div>
          {isActive && (
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{
                  width: task.pagesFound > 0
                    ? `${Math.min(100, (task.pagesDownloaded / task.pagesFound) * 100)}%`
                    : '0%',
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* Completed info */}
      {task.state === 'completed' && task.cid && (
        <div className="task-result">
          <span className="result-label">CID:</span>
          <span className="result-cid" title={task.cid}>
            {task.cid}
          </span>
        </div>
      )}

      {/* Error info */}
      {task.state === 'failed' && task.error && (
        <div className="task-error">{task.error}</div>
      )}

      <div className="task-url-small">{task.url}</div>
    </div>
  );
}
