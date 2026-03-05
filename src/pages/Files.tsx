import { useState, useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open, save } from '@tauri-apps/plugin-dialog';
import { validateCid, type CidValidationResult } from '../lib/cidValidation';
import { sanitizeFilename } from '../lib/sanitizeFilename';

interface UploadProgressEvent {
  filename: string;
  bytesSent: number;
  totalBytes: number;
  percent: number;
}

interface DownloadProgressEvent {
  cid: string;
  phase: 'network' | 'saving' | 'complete';
  bytesReceived: number;
  totalBytes: number | null;
  percent: number | null;
}

interface FileInfo {
  cid: string;
  name: string;
  sizeBytes: number;
  mimeType: string | null;
  uploadedAt: string;
  isPinned: boolean;
  isLocal: boolean;
}

interface FileList {
  files: FileInfo[];
  totalCount: number;
  totalSizeBytes: number;
}

interface UploadResult {
  cid: string;
  name: string;
  sizeBytes: number;
}

function Files() {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [totalSize, setTotalSize] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [nodeConnected, setNodeConnected] = useState(false);
  const [downloadCid, setDownloadCid] = useState('');
  const [downloadStatus, setDownloadStatus] = useState<string | null>(null);
  const [cidValidation, setCidValidation] = useState<CidValidationResult | null>(null);
  const [autoDownloadPending, setAutoDownloadPending] = useState(false);
  const autoDownloadTimerRef = useRef<number | null>(null);
  const [uploadProgressData, setUploadProgressData] = useState<UploadProgressEvent | null>(null);
  const [downloadProgressData, setDownloadProgressData] = useState<DownloadProgressEvent | null>(null);

  const checkNodeConnection = useCallback(async () => {
    try {
      const connected = await invoke<boolean>('check_node_connection');
      setNodeConnected(connected);
    } catch {
      setNodeConnected(false);
    }
  }, []);

  const loadFiles = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await invoke<FileList>('list_files');
      setFiles(result.files);
      setTotalSize(result.totalSizeBytes);
    } catch (e) {
      const msg = typeof e === 'string' ? e : (e instanceof Error ? e.message : 'Failed to load files');
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkNodeConnection();
    loadFiles();

    // Poll for updates every 10 seconds
    const interval = setInterval(() => {
      checkNodeConnection();
    }, 10000);

    return () => clearInterval(interval);
  }, [checkNodeConnection, loadFiles]);

  // Listen for upload progress events
  useEffect(() => {
    const unlisten = listen<UploadProgressEvent>('upload-progress', (event) => {
      setUploadProgressData(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Listen for download progress events
  useEffect(() => {
    const unlisten = listen<DownloadProgressEvent>('download-progress', (event) => {
      if (event.payload.phase === 'complete') {
        // Keep the complete state briefly visible, then clear
        setDownloadProgressData(event.payload);
        setTimeout(() => setDownloadProgressData(null), 500);
      } else {
        setDownloadProgressData(event.payload);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Cleanup auto-download timer on unmount
  useEffect(() => {
    return () => {
      if (autoDownloadTimerRef.current) {
        window.clearTimeout(autoDownloadTimerRef.current);
      }
    };
  }, []);

  const handleUpload = async () => {
    try {
      const selected = await open({
        multiple: true,
        title: 'Select files to upload',
      });

      if (!selected) return;

      const paths = Array.isArray(selected) ? selected : [selected];
      setError(null);

      for (const path of paths) {
        const filename = path.split(/[/\\]/).pop() || path;
        setUploadProgress(`Uploading ${filename}...`);

        try {
          const result = await invoke<UploadResult>('upload_file', { path });
          console.log('Upload successful:', result);
        } catch (e) {
          const msg = typeof e === 'string' ? e : (e instanceof Error ? e.message : 'Upload failed');
          setError(`Failed to upload ${filename}: ${msg}`);
        }
      }

      setUploadProgress(null);
      setUploadProgressData(null);
      await loadFiles();
    } catch (e) {
      const msg = typeof e === 'string' ? e : (e instanceof Error ? e.message : 'Failed to upload file');
      setError(msg);
      setUploadProgress(null);
      setUploadProgressData(null);
    }
  };

  const handleDownload = async (cid: string, filename: string) => {
    try {
      const savePath = await save({
        title: 'Save file as',
        defaultPath: sanitizeFilename(filename),
      });

      if (!savePath) return;

      setLoading(true);
      setError(null);
      await invoke('download_file', { cid, destination: savePath });
    } catch (e) {
      const msg = typeof e === 'string' ? e : (e instanceof Error ? e.message : 'Failed to download file');
      setError(msg);
      setDownloadProgressData(null);
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadByCid = useCallback(async () => {
    // Prevent double-trigger
    if (loading) {
      return;
    }

    if (!downloadCid.trim()) {
      setError('Please enter a CID');
      return;
    }

    // Clear pending state
    setAutoDownloadPending(false);

    const cid = downloadCid.trim();

    try {
      setLoading(true);
      setError(null);
      setDownloadStatus('Fetching file info...');

      // Try to get file metadata (filename, mimetype) from the network
      let defaultFilename = `downloaded-${cid.slice(0, 12)}`;
      try {
        const fileInfo = await invoke<{ filename?: string; mimetype?: string } | null>(
          'get_file_info_by_cid',
          { cid }
        );
        if (fileInfo?.filename) {
          defaultFilename = sanitizeFilename(fileInfo.filename);
        }
      } catch {
        // If we can't get file info, use the default filename
        console.log('Could not fetch file info, using default filename');
      }

      const savePath = await save({
        title: 'Save downloaded file as',
        defaultPath: defaultFilename,
      });

      if (!savePath) {
        setLoading(false);
        setDownloadStatus(null);
        return;
      }

      setDownloadStatus(`Downloading ${defaultFilename}...`);

      await invoke('download_file', { cid, destination: savePath });

      setDownloadStatus(`Downloaded: ${defaultFilename}`);
      setDownloadCid('');
      setCidValidation(null);
      await loadFiles();

      // Clear success message after 3 seconds
      setTimeout(() => setDownloadStatus(null), 3000);
    } catch (e) {
      const msg = typeof e === 'string' ? e : (e instanceof Error ? e.message : 'Failed to download file');
      setError(`Download failed: ${msg}`);
      setDownloadStatus(null);
      setDownloadProgressData(null);
    } finally {
      setLoading(false);
    }
  }, [downloadCid, loading, loadFiles]);

  const handleCidPaste = useCallback(
    async (e: React.ClipboardEvent<HTMLInputElement>) => {
      // Clear any pending auto-download
      if (autoDownloadTimerRef.current) {
        window.clearTimeout(autoDownloadTimerRef.current);
        autoDownloadTimerRef.current = null;
      }

      const pastedText = e.clipboardData.getData('text');
      const validation = validateCid(pastedText);
      setCidValidation(validation);

      if (!validation.valid) {
        return; // Don't auto-trigger on invalid CID
      }

      if (!nodeConnected) {
        setError('Node is not connected. Start the node to download files.');
        return;
      }

      // Update the CID in state immediately (before onChange fires)
      setDownloadCid(pastedText);

      // Schedule auto-download after short delay
      setAutoDownloadPending(true);
      autoDownloadTimerRef.current = window.setTimeout(async () => {
        setAutoDownloadPending(false);
        // Trigger download - no need to check CID since we just set it
        await handleDownloadByCid();
        autoDownloadTimerRef.current = null;
      }, 300); // 300ms delay
    },
    [nodeConnected, handleDownloadByCid]
  );

  const handleCidChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setDownloadCid(value);

    // Cancel pending auto-download if user edits
    if (autoDownloadTimerRef.current) {
      window.clearTimeout(autoDownloadTimerRef.current);
      autoDownloadTimerRef.current = null;
      setAutoDownloadPending(false);
    }

    // Validate for visual feedback
    if (value.trim().length > 0) {
      setCidValidation(validateCid(value));
    } else {
      setCidValidation(null);
    }
  }, []);

  const handleDeleteAll = async () => {
    if (!confirm(`Delete all ${files.length} files? This cannot be undone.`)) return;

    try {
      setError(null);
      setLoading(true);
      const count = await invoke<number>('delete_all_files');
      console.log(`Deleted ${count} files`);
      await loadFiles();
    } catch (e) {
      const msg = typeof e === 'string' ? e : (e instanceof Error ? e.message : 'Failed to delete files');
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (cid: string) => {
    if (!confirm('Remove this file from your local cache?')) return;

    try {
      setError(null);
      await invoke('delete_file', { cid });
      await loadFiles();
    } catch (e) {
      const msg = typeof e === 'string' ? e : (e instanceof Error ? e.message : 'Failed to delete file');
      setError(msg);
    }
  };

  const handleCopyCid = async (cid: string) => {
    try {
      await navigator.clipboard.writeText(cid);
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = cid;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleString();
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h2>Files</h2>
        <div className="actions">
          <button onClick={handleUpload} disabled={loading || !nodeConnected}>
            Upload Files
          </button>
          <button onClick={loadFiles} disabled={loading}>
            Refresh
          </button>
        </div>
      </div>

      {!nodeConnected && (
        <div className="info-banner">
          Node is not connected. Start the node to upload/download files.
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}
      {uploadProgress && <div className="info-banner">{uploadProgress}</div>}
      {uploadProgressData && (
        <div className="info-banner">
          <div>Uploading {uploadProgressData.filename}: {uploadProgressData.percent}% ({formatBytes(uploadProgressData.bytesSent)} / {formatBytes(uploadProgressData.totalBytes)})</div>
          <div style={{ width: '100%', height: '6px', backgroundColor: 'var(--color-bg-tertiary, #333)', borderRadius: '3px', marginTop: '6px' }}>
            <div style={{ width: `${uploadProgressData.percent}%`, height: '100%', backgroundColor: 'var(--color-accent, #0f0)', borderRadius: '3px', transition: 'width 0.2s' }} />
          </div>
        </div>
      )}

      {/* Download by CID section */}
      <div className="download-by-cid">
        <h3>Download by CID</h3>
        <p>Enter a CID to download a file from the P2P network:</p>
        <div className="cid-input-row">
          <input
            type="text"
            value={downloadCid}
            onChange={handleCidChange}
            onPaste={handleCidPaste}
            placeholder="zDvZRwzm... (paste CID to auto-download)"
            disabled={loading || !nodeConnected || autoDownloadPending}
            className={
              cidValidation
                ? cidValidation.valid ? 'cid-input-valid' : 'cid-input-invalid'
                : ''
            }
          />
          <button
            onClick={handleDownloadByCid}
            disabled={loading || !nodeConnected || !downloadCid.trim() || autoDownloadPending}
          >
            {autoDownloadPending ? 'Preparing...' : 'Download'}
          </button>
        </div>
        {cidValidation && !cidValidation.valid && (
          <div className="cid-validation-error">{cidValidation.error}</div>
        )}
        {downloadProgressData && downloadProgressData.phase !== 'complete' && (
          <div className="download-progress-container">
            <div className="download-progress-text">
              {downloadProgressData.phase === 'network' && 'Fetching from P2P network...'}
              {downloadProgressData.phase === 'saving' && downloadProgressData.percent != null && downloadProgressData.totalBytes != null
                ? `Saving to disk: ${downloadProgressData.percent}% (${formatBytes(downloadProgressData.bytesReceived)} / ${formatBytes(downloadProgressData.totalBytes)})`
                : downloadProgressData.phase === 'saving' && downloadProgressData.bytesReceived > 0
                  ? `Saving to disk: ${formatBytes(downloadProgressData.bytesReceived)} received...`
                  : downloadProgressData.phase === 'saving'
                    ? 'Saving to disk...'
                    : ''}
            </div>
            <div className="download-progress-bar">
              <div
                className={`download-progress-fill${downloadProgressData.phase === 'network' || downloadProgressData.percent == null ? ' indeterminate' : ''}`}
                style={downloadProgressData.percent != null && downloadProgressData.phase === 'saving'
                  ? { width: `${downloadProgressData.percent}%` }
                  : undefined}
              />
            </div>
          </div>
        )}
        {downloadStatus && !downloadProgressData && <div className="info-banner">{downloadStatus}</div>}
      </div>

      <div className="file-stats">
        <span>{files.length} files</span>
        <span>{formatBytes(totalSize)} total</span>
        {files.length > 0 && (
          <button
            className="small danger"
            onClick={handleDeleteAll}
            disabled={loading || !nodeConnected}
          >
            Delete All
          </button>
        )}
      </div>

      <div className="files-table">
        <table>
          <colgroup>
            <col style={{ width: '25%' }} />
            <col style={{ width: '28%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '15%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>Name</th>
              <th>CID</th>
              <th>Size</th>
              <th>Type</th>
              <th>Uploaded</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {files.length === 0 ? (
              <tr>
                <td colSpan={6} className="empty-state">
                  {nodeConnected
                    ? 'No files yet. Upload some files to get started.'
                    : 'Start the node to see your files.'}
                </td>
              </tr>
            ) : (
              files.map((file) => (
                <tr key={file.cid}>
                  <td>
                    <span className="file-name">{file.name}</span>
                    {file.isPinned && <span className="pin-badge" title="Pinned">📌</span>}
                  </td>
                  <td className="cid-cell">
                    <code className="cid" title={`Click to copy: ${file.cid}`} onClick={() => handleCopyCid(file.cid)}>
                      {file.cid}
                    </code>
                  </td>
                  <td>{formatBytes(file.sizeBytes)}</td>
                  <td className="mime-type">{file.mimeType || '-'}</td>
                  <td>{formatDate(file.uploadedAt)}</td>
                  <td className="actions-cell">
                    <button
                      className="small"
                      onClick={() => handleDownload(file.cid, file.name)}
                      disabled={!nodeConnected}
                      title="Download file"
                    >
                      Download
                    </button>
                    <button
                      className="small"
                      onClick={() => handleCopyCid(file.cid)}
                      title="Copy CID to clipboard"
                    >
                      Copy CID
                    </button>
                    <button
                      className="small danger"
                      onClick={() => handleDelete(file.cid)}
                      title="Remove from local cache"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default Files;
