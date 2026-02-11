import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { save } from '@tauri-apps/plugin-dialog';
import { downloadDir } from '@tauri-apps/api/path';
import {
  useMediaDownload,
  MediaMetadata,
  DownloadTask,
} from '../hooks/useMediaDownload';
import '../styles/MediaDownload.css';

function formatDuration(seconds: number | null): string {
  if (!seconds) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function MediaDownload() {
  const navigate = useNavigate();
  const {
    queueState,
    binaryStatus,
    loading,
    installError,
    installingBinary,
    installProgress,
    fetchMetadata,
    queueDownload,
    cancelDownload,
    removeTask,
    clearCompleted,
    installYtDlp,
    installFfmpeg,
    updateYtDlp,
  } = useMediaDownload();

  const installButtonLabel = (binary: string, defaultLabel: string) => {
    if (installingBinary !== binary) return defaultLabel;
    if (installProgress && installProgress.total) {
      const pct = Math.round((installProgress.downloaded / installProgress.total) * 100);
      return `Installing... ${pct}%`;
    }
    if (installProgress) {
      return `Installing... ${formatBytes(installProgress.downloaded)}`;
    }
    return 'Installing...';
  };

  const [url, setUrl] = useState('');
  const [metadata, setMetadata] = useState<MediaMetadata | null>(null);
  const [fetchingMeta, setFetchingMeta] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selectedFormatId, setSelectedFormatId] = useState<string | null>(null);
  const [audioOnly, setAudioOnly] = useState(false);
  const [audioFormat, setAudioFormat] = useState('mp3');
  const [downloading, setDownloading] = useState(false);

  const handleFetch = useCallback(async () => {
    if (!url.trim()) return;
    setFetchingMeta(true);
    setFetchError(null);
    setMetadata(null);
    try {
      const meta = await fetchMetadata(url.trim());
      setMetadata(meta);
      // Auto-select best format
      const bestCombined = meta.formats.find(f => f.hasVideo && f.hasAudio);
      if (bestCombined) {
        setSelectedFormatId(bestCombined.formatId);
      }
    } catch (e) {
      setFetchError(typeof e === 'string' ? e : (e instanceof Error ? e.message : 'Failed to fetch metadata'));
    } finally {
      setFetchingMeta(false);
    }
  }, [url, fetchMetadata]);

  const handleDownload = useCallback(async () => {
    if (!metadata) return;

    setDownloading(true);
    try {
      // Get default download directory
      let outputDir: string;
      try {
        outputDir = await downloadDir();
      } catch {
        outputDir = '.';
      }

      // Optionally let user pick directory
      const selected = await save({
        title: 'Save media file',
        defaultPath: `${outputDir}/${metadata.title}`,
      });

      if (!selected) {
        setDownloading(false);
        return;
      }

      // Use the directory of the selected file
      const lastSlash = Math.max(selected.lastIndexOf('/'), selected.lastIndexOf('\\'));
      const dir = lastSlash >= 0 ? selected.substring(0, lastSlash) : outputDir;
      const filename = lastSlash >= 0 ? selected.substring(lastSlash + 1).replace(/\.[^.]+$/, '') : null;

      await queueDownload(
        {
          url: metadata.url,
          formatId: audioOnly ? null : selectedFormatId,
          audioOnly,
          audioFormat: audioOnly ? audioFormat : null,
          outputDirectory: dir,
          filename,
        },
        metadata.title,
        metadata.thumbnail,
      );

      // Clear metadata after queueing
      setMetadata(null);
      setUrl('');
    } catch (e) {
      setFetchError(typeof e === 'string' ? e : (e instanceof Error ? e.message : 'Failed to start download'));
    } finally {
      setDownloading(false);
    }
  }, [metadata, selectedFormatId, audioOnly, audioFormat, queueDownload]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !fetchingMeta) {
      handleFetch();
    }
  }, [handleFetch, fetchingMeta]);

  if (loading) {
    return (
      <div className="media-download-page">
        <h1>Media Download</h1>
        <div className="fetch-loading">
          <div className="spinner-small" />
          Loading...
        </div>
      </div>
    );
  }

  // Separate video and audio formats for the selector
  const videoFormats = metadata?.formats.filter(f => f.hasVideo) ?? [];
  const combinedFormats = videoFormats.filter(f => f.hasAudio);
  const videoOnlyFormats = videoFormats.filter(f => !f.hasAudio);

  return (
    <div className="media-download-page">
      <h1>Media Download</h1>

      {/* Setup banner if yt-dlp not installed */}
      {binaryStatus && !binaryStatus.ytDlpInstalled && (
        <div className="setup-banner">
          <h3>Setup Required</h3>
          <p>
            yt-dlp is needed to download media from websites. It supports YouTube
            and hundreds of other sites.
          </p>
          <div className="setup-actions">
            <button
              className="install-btn"
              onClick={installYtDlp}
              disabled={installingBinary === 'yt-dlp'}
            >
              {installButtonLabel('yt-dlp', 'Install yt-dlp')}
            </button>
          </div>
          {installError && installingBinary === null && (
            <p className="install-error">{installError}</p>
          )}
        </div>
      )}

      {/* ffmpeg recommendation */}
      {binaryStatus && binaryStatus.ytDlpInstalled && !binaryStatus.ffmpegInstalled && (
        <div className="setup-banner">
          <h3>Recommended: Install ffmpeg</h3>
          <p>
            ffmpeg enables audio extraction and format conversion. Without it,
            some download options will be limited.
          </p>
          <div className="setup-actions">
            <button
              className="install-btn"
              onClick={installFfmpeg}
              disabled={installingBinary === 'ffmpeg'}
            >
              {installButtonLabel('ffmpeg', 'Install ffmpeg')}
            </button>
            {binaryStatus.ytDlpVersion && (
              <span className="binary-info">yt-dlp {binaryStatus.ytDlpVersion}</span>
            )}
          </div>
          {installError && installingBinary === null && (
            <p className="install-error">{installError}</p>
          )}
        </div>
      )}

      {/* Binary status when all installed */}
      {binaryStatus && binaryStatus.ytDlpInstalled && binaryStatus.ffmpegInstalled && (
        <div style={{ marginBottom: '0.5rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <span className="binary-info" style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>
            yt-dlp {binaryStatus.ytDlpVersion} | ffmpeg {binaryStatus.ffmpegVersion}
          </span>
          <button
            onClick={updateYtDlp}
            disabled={installingBinary !== null}
            style={{
              background: 'transparent',
              color: 'var(--text-dim)',
              border: '1px solid var(--term-border)',
              padding: '0.2rem 0.5rem',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '0.7rem',
            }}
          >
            Update yt-dlp
          </button>
        </div>
      )}

      {/* URL Input */}
      <div className="url-input-section">
        <h3>Paste a URL to download</h3>
        <div className="url-input-row">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="https://www.youtube.com/watch?v=..."
            disabled={!binaryStatus?.ytDlpInstalled || fetchingMeta}
          />
          <button
            className="fetch-btn"
            onClick={handleFetch}
            disabled={!url.trim() || !binaryStatus?.ytDlpInstalled || fetchingMeta}
          >
            {fetchingMeta ? 'Fetching...' : 'Fetch Info'}
          </button>
        </div>

        {fetchingMeta && (
          <div className="fetch-loading">
            <div className="spinner-small" />
            Fetching video information...
          </div>
        )}

        {fetchError && (
          <div className="fetch-error">{fetchError}</div>
        )}
      </div>

      {/* Metadata Preview */}
      {metadata && (
        <div className="metadata-preview">
          <div className="metadata-header">
            {metadata.thumbnail && (
              <img
                src={metadata.thumbnail}
                alt=""
                className="metadata-thumbnail"
              />
            )}
            <div className="metadata-info">
              <h3>{metadata.title}</h3>
              {metadata.uploader && (
                <div className="meta-detail">{metadata.uploader}</div>
              )}
              {metadata.durationSeconds && (
                <div className="meta-detail">
                  Duration: {formatDuration(metadata.durationSeconds)}
                </div>
              )}
              <div className="meta-detail">
                {metadata.formats.length} formats available
              </div>
            </div>
          </div>

          <div className="format-selection">
            <label className="audio-only-toggle">
              <input
                type="checkbox"
                checked={audioOnly}
                onChange={(e) => setAudioOnly(e.target.checked)}
              />
              Audio only
            </label>

            {audioOnly ? (
              <div className="format-group">
                <label>Audio Format</label>
                <select
                  value={audioFormat}
                  onChange={(e) => setAudioFormat(e.target.value)}
                >
                  <option value="mp3">MP3</option>
                  <option value="m4a">M4A</option>
                  <option value="opus">OPUS</option>
                  <option value="wav">WAV</option>
                </select>
              </div>
            ) : (
              <div className="format-group">
                <label>Quality</label>
                <select
                  value={selectedFormatId ?? ''}
                  onChange={(e) => setSelectedFormatId(e.target.value || null)}
                >
                  {combinedFormats.length > 0 && (
                    <optgroup label="Video + Audio">
                      {combinedFormats.map((f) => (
                        <option key={f.formatId} value={f.formatId}>
                          {f.qualityLabel} ({f.ext})
                          {f.filesizeApprox ? ` ~${formatBytes(f.filesizeApprox)}` : ''}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {videoOnlyFormats.length > 0 && (
                    <optgroup label="Video Only (needs merge)">
                      {videoOnlyFormats.map((f) => (
                        <option key={f.formatId} value={f.formatId}>
                          {f.qualityLabel} ({f.ext})
                          {f.filesizeApprox ? ` ~${formatBytes(f.filesizeApprox)}` : ''}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>
            )}

            <div className="download-action">
              <button
                className="download-btn"
                onClick={handleDownload}
                disabled={downloading}
              >
                {downloading ? 'Starting...' : 'Download'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Download Queue */}
      <div className="download-queue">
        <div className="download-queue-header">
          <h3>
            Downloads
            {queueState && queueState.tasks.length > 0 && (
              <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>
                {' '}({queueState.activeCount} active, {queueState.queuedCount} queued)
              </span>
            )}
          </h3>
          {queueState && queueState.completedCount > 0 && (
            <button className="clear-btn" onClick={clearCompleted}>
              Clear completed
            </button>
          )}
        </div>

        {(!queueState || queueState.tasks.length === 0) ? (
          <div className="queue-empty">No downloads yet. Paste a URL above to get started.</div>
        ) : (
          queueState.tasks.map((task) => (
            <TaskItem
              key={task.id}
              task={task}
              onCancel={cancelDownload}
              onRemove={removeTask}
              onPlay={(id) => navigate(`/media/player/${id}`)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function TaskItem({
  task,
  onCancel,
  onRemove,
  onPlay,
}: {
  task: DownloadTask;
  onCancel: (id: string) => void;
  onRemove: (id: string) => void;
  onPlay: (id: string) => void;
}) {
  const isActive = task.state === 'downloading' || task.state === 'postProcessing';
  const isDone = task.state === 'completed' || task.state === 'failed' || task.state === 'cancelled';

  return (
    <div className={`task-item ${task.state}`}>
      {task.thumbnail && (
        <img src={task.thumbnail} alt="" className="task-thumbnail" />
      )}

      <div className="task-info">
        <div className="task-title">{task.title}</div>
        <div className="task-status">
          <span className={`task-state-badge ${task.state}`}>
            {task.state === 'postProcessing' ? 'processing' : task.state}
          </span>
          {isActive && task.speed && (
            <span className="task-speed">{task.speed}</span>
          )}
          {isActive && task.eta && (
            <span className="task-eta">ETA {task.eta}</span>
          )}
        </div>
        {task.error && <div className="task-error">{task.error}</div>}
      </div>

      {isActive && (
        <div className="task-progress-bar">
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: `${Math.min(task.progressPercent, 100)}%` }}
            />
          </div>
          <div className="progress-percent">{task.progressPercent.toFixed(1)}%</div>
        </div>
      )}

      <div className="task-actions">
        {task.state === 'completed' && task.outputPath && !task.options.audioOnly && (
          <button
            className="task-action-btn play"
            onClick={() => onPlay(task.id)}
            title="Play"
          >
            {'▶'}
          </button>
        )}
        {isActive && (
          <button
            className="task-action-btn cancel"
            onClick={() => onCancel(task.id)}
            title="Cancel"
          >
            X
          </button>
        )}
        {isDone && (
          <button
            className="task-action-btn"
            onClick={() => onRemove(task.id)}
            title="Remove"
          >
            X
          </button>
        )}
      </div>
    </div>
  );
}
