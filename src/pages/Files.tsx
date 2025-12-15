import { useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';

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
      await loadFiles();
    } catch (e) {
      const msg = typeof e === 'string' ? e : (e instanceof Error ? e.message : 'Failed to upload file');
      setError(msg);
      setUploadProgress(null);
    }
  };

  const handleDownload = async (cid: string, filename: string) => {
    try {
      const savePath = await save({
        title: 'Save file as',
        defaultPath: filename,
      });

      if (!savePath) return;

      setLoading(true);
      setError(null);
      await invoke('download_file', { cid, destination: savePath });
    } catch (e) {
      const msg = typeof e === 'string' ? e : (e instanceof Error ? e.message : 'Failed to download file');
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

      <div className="file-stats">
        <span>{files.length} files</span>
        <span>{formatBytes(totalSize)} total</span>
      </div>

      <div className="files-table">
        <table>
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
                  <td>
                    <code className="cid" title={file.cid}>
                      {file.cid.length > 20 ? `${file.cid.slice(0, 20)}...` : file.cid}
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
