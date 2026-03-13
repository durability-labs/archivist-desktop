import { useState, useCallback, useMemo } from 'react';
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

function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond < 1) return '';
  return `${formatBytes(bytesPerSecond)}/s`;
}

function formatEta(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return '';
  if (seconds < 60) return `~${seconds}s remaining`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `~${mins}m ${secs}s remaining`;
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
    case 'paused': return 'Paused';
    default: return state;
  }
}

function stateBadgeClass(state: string): string {
  switch (state) {
    case 'completed': return 'badge-success';
    case 'failed': return 'badge-error';
    case 'cancelled': return 'badge-warning';
    case 'paused': return 'badge-paused';
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
    pauseArchive,
    resumeArchive,
    removeTask,
    clearCompleted,
    viewerUrl,
    viewerLoading,
    viewerCid,
    openViewer,
    closeViewer,
  } = useWebArchive();

  const [url, setUrl] = useState('');
  const [maxDepth, setMaxDepth] = useState(3);
  const [maxPages, setMaxPages] = useState(100);
  const [includeAssets, setIncludeAssets] = useState(true);
  const [singlePage, setSinglePage] = useState(false);
  const [excludePatterns, setExcludePatterns] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

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
      const patterns = excludePatterns
        .split('\n')
        .map(p => p.trim())
        .filter(p => p.length > 0);

      await queueArchive({
        url: trimmedUrl,
        maxDepth: singlePage ? 0 : maxDepth,
        maxPages: singlePage ? 1 : maxPages,
        includeAssets,
        requestDelayMs: 200,
        singlePage,
        excludePatterns: patterns.length > 0 ? patterns : undefined,
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
  }, [url, maxDepth, maxPages, includeAssets, singlePage, excludePatterns, queueArchive]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !submitting) {
      handleSubmit();
    }
  };

  const filteredSites = useMemo(() => {
    const sites = queueState?.archivedSites ?? [];
    if (!searchQuery.trim()) return sites;
    const q = searchQuery.toLowerCase();
    return sites.filter(
      s =>
        (s.title && s.title.toLowerCase().includes(q)) ||
        s.url.toLowerCase().includes(q)
    );
  }, [queueState?.archivedSites, searchQuery]);

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

      {/* Archive Viewer Panel */}
      {viewerUrl && (
        <div className="archive-viewer-panel">
          <div className="viewer-toolbar">
            <span className="viewer-title">
              Browsing archived site{viewerCid ? ` (${viewerCid.slice(0, 12)}...)` : ''}
            </span>
            <button className="viewer-close-btn" onClick={closeViewer}>
              Close Viewer
            </button>
          </div>
          <iframe
            src={viewerUrl}
            className="archive-viewer-iframe"
            sandbox="allow-same-origin allow-scripts"
            title="Archive Viewer"
          />
        </div>
      )}

      {viewerLoading && (
        <div className="viewer-loading">
          Downloading and extracting archive...
        </div>
      )}

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

        {/* Single Page Toggle */}
        <div className="single-page-toggle">
          <label>
            <input
              type="checkbox"
              checked={singlePage}
              onChange={(e) => setSinglePage(e.target.checked)}
            />
            Single Page Snapshot
          </label>
          <span className="toggle-hint">
            {singlePage ? 'Only archive this one URL' : 'Crawl linked pages'}
          </span>
        </div>

        {/* Settings toggle */}
        <button
          className="settings-toggle"
          onClick={() => setShowSettings(!showSettings)}
        >
          {showSettings ? 'Hide Settings' : 'Crawl Settings'}
        </button>

        {showSettings && (
          <div className="crawl-settings">
            {!singlePage && (
              <>
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
              </>
            )}
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
            {!singlePage && (
              <div className="setting-row exclude-patterns-row">
                <label>Exclude URL Patterns</label>
                <textarea
                  className="exclude-patterns"
                  placeholder={"One regex per line, e.g.:\n/api/\n\\.pdf$\n/login"}
                  value={excludePatterns}
                  onChange={(e) => setExcludePatterns(e.target.value)}
                  rows={3}
                />
              </div>
            )}
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
                onPause={pauseArchive}
                onResume={resumeArchive}
                onRemove={removeTask}
                onBrowse={task.cid ? () => openViewer(task.cid!, task.url) : undefined}
                viewerLoading={viewerLoading}
              />
            ))}
          </div>
        </div>
      )}

      {/* Archived Sites */}
      {archivedSites.length > 0 && (
        <div className="archived-section">
          <div className="section-header">
            <h2>Archived Sites</h2>
          </div>

          {archivedSites.length > 3 && (
            <input
              type="text"
              className="search-input"
              placeholder="Search archived sites..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          )}

          <div className="archived-list">
            {filteredSites.map((site) => (
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
                <div className="archived-actions">
                  <button
                    className="browse-btn"
                    onClick={() => openViewer(site.cid, site.url)}
                    disabled={viewerLoading}
                  >
                    {viewerLoading ? 'Loading...' : 'Browse'}
                  </button>
                  <div className="archived-cid" title={site.cid}>
                    CID: {site.cid.slice(0, 12)}...
                  </div>
                </div>
              </div>
            ))}
            {filteredSites.length === 0 && searchQuery && (
              <div className="no-results">No sites match "{searchQuery}"</div>
            )}
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
  onPause,
  onResume,
  onRemove,
  onBrowse,
  viewerLoading,
}: {
  task: ArchiveTask;
  onCancel: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onRemove: (id: string) => void;
  onBrowse?: () => void;
  viewerLoading: boolean;
}) {
  const isActive =
    task.state === 'crawling' ||
    task.state === 'downloading' ||
    task.state === 'packaging' ||
    task.state === 'uploading';
  const isPaused = task.state === 'paused';
  const isFinished =
    task.state === 'completed' ||
    task.state === 'failed' ||
    task.state === 'cancelled';
  const isPausable = task.state === 'crawling' || task.state === 'downloading';

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
          {isPausable && (
            <button
              className="pause-btn"
              onClick={() => onPause(task.id)}
              title="Pause"
            >
              Pause
            </button>
          )}
          {isPaused && (
            <button
              className="resume-btn"
              onClick={() => onResume(task.id)}
              title="Resume"
            >
              Resume
            </button>
          )}
          {(isActive || task.state === 'queued' || isPaused) && (
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
      {(isActive || task.state === 'queued' || isPaused) && (
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
          {/* Speed and ETA */}
          {(isActive || isPaused) && (task.bytesPerSecond > 0 || task.etaSeconds !== null) && (
            <div className="speed-eta">
              {task.bytesPerSecond > 0 && (
                <span className="speed">{formatSpeed(task.bytesPerSecond)}</span>
              )}
              {task.etaSeconds !== null && (
                <span className="eta">{formatEta(task.etaSeconds)}</span>
              )}
            </div>
          )}
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
          {onBrowse && (
            <button
              className="browse-btn"
              onClick={onBrowse}
              disabled={viewerLoading}
            >
              {viewerLoading ? 'Loading...' : 'Browse'}
            </button>
          )}
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
