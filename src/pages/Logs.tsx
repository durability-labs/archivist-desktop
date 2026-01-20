import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import '../styles/Logs.css';

// LocalStorage keys for persisting settings
const STORAGE_KEYS = {
  AUTO_REFRESH: 'logs_auto_refresh',
  AUTO_SCROLL: 'logs_auto_scroll',
  LINE_COUNT: 'logs_line_count',
};

// Load setting from localStorage with fallback
function loadSetting<T>(key: string, defaultValue: T): T {
  try {
    const stored = localStorage.getItem(key);
    if (stored === null) return defaultValue;
    return JSON.parse(stored) as T;
  } catch {
    return defaultValue;
  }
}

// Save setting to localStorage
function saveSetting<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error('Failed to save setting to localStorage:', error);
  }
}

function Logs() {
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [logPath, setLogPath] = useState<string>('');

  // Load settings from localStorage on mount
  const [autoRefresh, setAutoRefresh] = useState(() => loadSetting(STORAGE_KEYS.AUTO_REFRESH, true));
  const [autoScroll, setAutoScroll] = useState(() => loadSetting(STORAGE_KEYS.AUTO_SCROLL, true));
  const [lineCount, setLineCount] = useState(() => loadSetting(STORAGE_KEYS.LINE_COUNT, 500));

  const logsEndRef = useRef<HTMLDivElement>(null);
  const logsViewerRef = useRef<HTMLDivElement>(null);

  const fetchLogs = useCallback(async () => {
    try {
      setError(null);
      const logLines = await invoke<string[]>('get_node_logs', { lines: lineCount });
      setLogs(logLines);
    } catch (e) {
      const msg = typeof e === 'string' ? e : (e instanceof Error ? e.message : 'Failed to fetch logs');
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [lineCount]);

  const fetchLogPath = async () => {
    try {
      const path = await invoke<string>('get_node_log_path');
      setLogPath(path);
    } catch (e) {
      console.error('Failed to fetch log path:', e);
    }
  };

  // Persist settings to localStorage when they change
  useEffect(() => {
    saveSetting(STORAGE_KEYS.AUTO_REFRESH, autoRefresh);
  }, [autoRefresh]);

  useEffect(() => {
    saveSetting(STORAGE_KEYS.AUTO_SCROLL, autoScroll);
  }, [autoScroll]);

  useEffect(() => {
    saveSetting(STORAGE_KEYS.LINE_COUNT, lineCount);
  }, [lineCount]);

  useEffect(() => {
    fetchLogs();
    fetchLogPath();
  }, [fetchLogs]);

  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      fetchLogs();
    }, 2000); // Refresh every 2 seconds

    return () => clearInterval(interval);
  }, [autoRefresh, fetchLogs]);

  // Auto-scroll to bottom when logs change and auto-scroll is enabled
  useEffect(() => {
    if (autoScroll && !loading) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll, loading]);

  // Detect manual scroll and disable auto-scroll if user scrolls up
  useEffect(() => {
    const logsViewer = logsViewerRef.current;
    if (!logsViewer) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = logsViewer;
      const isAtBottom = Math.abs(scrollHeight - clientHeight - scrollTop) < 50;

      // If user scrolls away from bottom, disable auto-scroll
      // If user scrolls back to bottom, re-enable it
      if (!isAtBottom && autoScroll) {
        setAutoScroll(false);
      } else if (isAtBottom && !autoScroll && autoRefresh) {
        setAutoScroll(true);
      }
    };

    logsViewer.addEventListener('scroll', handleScroll);
    return () => logsViewer.removeEventListener('scroll', handleScroll);
  }, [autoScroll, autoRefresh]);

  const scrollToBottom = () => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setAutoScroll(true); // Re-enable auto-scroll when manually scrolling to bottom
  };

  const clearLogs = () => {
    setLogs([]);
  };

  const copyAllLogs = () => {
    const allLogs = logs.join('\n');
    navigator.clipboard.writeText(allLogs);
  };

  return (
    <div className="logs-container">
      <header className="logs-header">
        <div>
          <h1>Node Logs</h1>
          <p className="log-path">Log file: {logPath || 'Loading...'}</p>
        </div>
        <div className="logs-controls">
          <label className="control-item">
            <span>Lines:</span>
            <select
              value={lineCount}
              onChange={(e) => setLineCount(Number(e.target.value))}
            >
              <option value={100}>100</option>
              <option value={500}>500</option>
              <option value={1000}>1000</option>
              <option value={5000}>5000</option>
            </select>
          </label>
          <label className="control-item checkbox">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            <span>Auto-refresh</span>
          </label>
          <label className="control-item checkbox">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            <span>Auto-scroll</span>
          </label>
          <button onClick={fetchLogs} disabled={loading} className="btn-secondary">
            Refresh
          </button>
          <button onClick={scrollToBottom} className="btn-secondary">
            Scroll to Bottom
          </button>
          <button onClick={copyAllLogs} disabled={logs.length === 0} className="btn-secondary">
            Copy All
          </button>
          <button onClick={clearLogs} disabled={logs.length === 0} className="btn-danger">
            Clear Display
          </button>
        </div>
      </header>

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      {loading ? (
        <div className="loading">Loading logs...</div>
      ) : (
        <div className="logs-viewer" ref={logsViewerRef}>
          {logs.length === 0 ? (
            <div className="empty-logs">No logs available. Start the node to generate logs.</div>
          ) : (
            logs.map((line, index) => (
              <div key={index} className="log-line">
                <span className="log-line-number">{index + 1}</span>
                <span className="log-line-content">{line}</span>
              </div>
            ))
          )}
          <div ref={logsEndRef} />
        </div>
      )}
    </div>
  );
}

export default Logs;
