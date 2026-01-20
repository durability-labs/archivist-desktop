import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { useFeatures } from '../hooks/useFeatures';

interface NodeSettings {
  data_directory: string;
  api_port: number;
  discovery_port: number; // UDP port for DHT/mDNS discovery
  listen_port: number;    // TCP port for P2P connections
  max_storage_gb: number;
  auto_start: boolean;
  log_level: string;      // TRACE, DEBUG, INFO, NOTICE, WARN, ERROR, FATAL
}

interface SyncSettings {
  auto_sync: boolean;
  sync_interval_seconds: number;
  bandwidth_limit_mbps: number | null;
  exclude_patterns: string[];
  // Backup configuration
  backup_enabled: boolean;
  backup_peer_address: string | null;
  backup_peer_nickname: string | null;
  backup_manifest_enabled: boolean;
  backup_auto_notify: boolean;
}

interface NotificationSettings {
  sound_enabled: boolean;
  sound_on_startup: boolean;
  sound_on_peer_connect: boolean;
  sound_on_download: boolean;
  sound_volume: number; // 0.0 to 1.0
}

interface AppConfig {
  theme: 'light' | 'dark' | 'system';
  language: string;
  start_minimized: boolean;
  start_on_boot: boolean;
  node: NodeSettings;
  sync: SyncSettings;
  notifications: NotificationSettings;
}

const defaultConfig: AppConfig = {
  theme: 'system',
  language: 'en',
  start_minimized: false,
  start_on_boot: false,
  node: {
    data_directory: '',
    api_port: 8080,
    discovery_port: 8090,
    listen_port: 8070,
    max_storage_gb: 10,
    auto_start: true,
    log_level: 'DEBUG',
  },
  sync: {
    auto_sync: true,
    sync_interval_seconds: 300,
    bandwidth_limit_mbps: null,
    exclude_patterns: ['*.tmp', '*.temp', '.DS_Store', 'Thumbs.db'],
    backup_enabled: false,
    backup_peer_address: null,
    backup_peer_nickname: null,
    backup_manifest_enabled: true,
    backup_auto_notify: false,
  },
  notifications: {
    sound_enabled: true,
    sound_on_startup: true,
    sound_on_peer_connect: true,
    sound_on_download: true,
    sound_volume: 0.5,
  },
};

function Settings() {
  const [config, setConfig] = useState<AppConfig>(defaultConfig);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [appVersion, setAppVersion] = useState('');
  const [platform, setPlatform] = useState('');
  const [excludeInput, setExcludeInput] = useState('');
  const { marketplaceEnabled } = useFeatures();

  useEffect(() => {
    async function loadData() {
      try {
        const [configResult, version, plat] = await Promise.all([
          invoke<AppConfig>('get_config'),
          invoke<string>('get_app_version'),
          invoke<string>('get_platform'),
        ]);
        setConfig(configResult);
        setAppVersion(version);
        setPlatform(plat);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load settings');
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      await invoke('save_config', { config });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!confirm('Reset all settings to defaults? This cannot be undone.')) {
      return;
    }
    try {
      setError(null);
      await invoke('reset_config');
      const configResult = await invoke<AppConfig>('get_config');
      setConfig(configResult);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reset settings');
    }
  };

  const handleBrowseDataDir = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select Data Directory',
      });
      if (selected) {
        setConfig((prev) => ({
          ...prev,
          node: { ...prev.node, data_directory: selected as string },
        }));
      }
    } catch (e) {
      console.error('Failed to open directory picker:', e);
    }
  };

  const addExcludePattern = () => {
    const pattern = excludeInput.trim();
    if (pattern && !config.sync.exclude_patterns.includes(pattern)) {
      setConfig((prev) => ({
        ...prev,
        sync: {
          ...prev.sync,
          exclude_patterns: [...prev.sync.exclude_patterns, pattern],
        },
      }));
      setExcludeInput('');
    }
  };

  const removeExcludePattern = (pattern: string) => {
    setConfig((prev) => ({
      ...prev,
      sync: {
        ...prev.sync,
        exclude_patterns: prev.sync.exclude_patterns.filter((p) => p !== pattern),
      },
    }));
  };

  if (loading) {
    return <div className="page">Loading settings...</div>;
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2>Settings</h2>
        <div className="actions">
          <button onClick={handleReset} className="secondary">
            Reset to Defaults
          </button>
          <button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {success && <div className="success-banner">Settings saved successfully!</div>}

      {/* General Settings */}
      <div className="settings-section">
        <h3>General</h3>
        <div className="setting-item">
          <label>Theme</label>
          <select
            value={config.theme}
            onChange={(e) => setConfig((prev) => ({ ...prev, theme: e.target.value as AppConfig['theme'] }))}
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
        <div className="setting-item">
          <label>
            <input
              type="checkbox"
              checked={config.start_minimized}
              onChange={(e) => setConfig((prev) => ({ ...prev, start_minimized: e.target.checked }))}
            />
            Start minimized to system tray
          </label>
        </div>
        <div className="setting-item">
          <label>
            <input
              type="checkbox"
              checked={config.start_on_boot}
              onChange={(e) => setConfig((prev) => ({ ...prev, start_on_boot: e.target.checked }))}
            />
            Start automatically on system boot
          </label>
        </div>
      </div>

      {/* Node Settings */}
      <div className="settings-section">
        <h3>Node</h3>
        <div className="setting-item">
          <label>Data Directory</label>
          <div className="input-with-button">
            <input
              type="text"
              value={config.node.data_directory}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  node: { ...prev.node, data_directory: e.target.value },
                }))
              }
              placeholder="Default location"
            />
            <button onClick={handleBrowseDataDir} className="small secondary">
              Browse
            </button>
          </div>
          <span className="hint">Where to store node data and uploaded files</span>
        </div>
        <div className="setting-row">
          <div className="setting-item">
            <label>API Port</label>
            <input
              type="number"
              value={config.node.api_port}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  node: { ...prev.node, api_port: parseInt(e.target.value) || 8080 },
                }))
              }
              min={1024}
              max={65535}
            />
          </div>
          <div className="setting-item">
            <label>Discovery Port (UDP)</label>
            <input
              type="number"
              value={config.node.discovery_port}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  node: { ...prev.node, discovery_port: parseInt(e.target.value) || 8090 },
                }))
              }
              min={1024}
              max={65535}
            />
            <span className="hint">UDP port for DHT/mDNS peer discovery</span>
          </div>
          <div className="setting-item">
            <label>Listen Port (TCP)</label>
            <input
              type="number"
              value={config.node.listen_port}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  node: { ...prev.node, listen_port: parseInt(e.target.value) || 8070 },
                }))
              }
              min={1024}
              max={65535}
            />
            <span className="hint">TCP port for P2P connections. Open both ports in your firewall.</span>
          </div>
        </div>
        <div className="setting-item">
          <label>Max Storage (GB)</label>
          <input
            type="number"
            value={config.node.max_storage_gb}
            onChange={(e) =>
              setConfig((prev) => ({
                ...prev,
                node: { ...prev.node, max_storage_gb: parseInt(e.target.value) || 10 },
              }))
            }
            min={1}
            max={10000}
          />
          <span className="hint">Maximum disk space the node can use</span>
        </div>
        <div className="setting-item">
          <label>Log Level</label>
          <select
            value={config.node.log_level}
            onChange={(e) =>
              setConfig((prev) => ({
                ...prev,
                node: { ...prev.node, log_level: e.target.value },
              }))
            }
          >
            <option value="TRACE">TRACE - Most verbose (debugging)</option>
            <option value="DEBUG">DEBUG - Detailed (recommended)</option>
            <option value="INFO">INFO - Informational</option>
            <option value="NOTICE">NOTICE - Normal but significant</option>
            <option value="WARN">WARN - Warnings only</option>
            <option value="ERROR">ERROR - Errors only</option>
            <option value="FATAL">FATAL - Critical errors only</option>
          </select>
          <span className="hint">Verbosity of node logs. Restart node to apply changes.</span>
        </div>
        <div className="setting-item">
          <label>
            <input
              type="checkbox"
              checked={config.node.auto_start}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  node: { ...prev.node, auto_start: e.target.checked },
                }))
              }
            />
            Start node automatically with app
          </label>
        </div>
      </div>

      {/* Sync Settings */}
      <div className="settings-section">
        <h3>Sync</h3>
        <div className="setting-item">
          <label>
            <input
              type="checkbox"
              checked={config.sync.auto_sync}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  sync: { ...prev.sync, auto_sync: e.target.checked },
                }))
              }
            />
            Automatically sync watched folders
          </label>
        </div>
        <div className="setting-item">
          <label>Sync Interval (seconds)</label>
          <input
            type="number"
            value={config.sync.sync_interval_seconds}
            onChange={(e) =>
              setConfig((prev) => ({
                ...prev,
                sync: { ...prev.sync, sync_interval_seconds: parseInt(e.target.value) || 300 },
              }))
            }
            min={60}
            max={3600}
          />
          <span className="hint">How often to check for changes in watched folders</span>
        </div>
        <div className="setting-item">
          <label>Bandwidth Limit (Mbps)</label>
          <input
            type="number"
            value={config.sync.bandwidth_limit_mbps || ''}
            onChange={(e) =>
              setConfig((prev) => ({
                ...prev,
                sync: {
                  ...prev.sync,
                  bandwidth_limit_mbps: e.target.value ? parseInt(e.target.value) : null,
                },
              }))
            }
            placeholder="No limit"
            min={1}
            max={1000}
          />
          <span className="hint">Leave empty for unlimited bandwidth</span>
        </div>
        <div className="setting-item">
          <label>Exclude Patterns</label>
          <div className="input-with-button">
            <input
              type="text"
              value={excludeInput}
              onChange={(e) => setExcludeInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addExcludePattern()}
              placeholder="e.g., *.log, node_modules/"
            />
            <button onClick={addExcludePattern} className="small secondary">
              Add
            </button>
          </div>
          <span className="hint">Files matching these patterns will not be synced</span>
          {config.sync.exclude_patterns.length > 0 && (
            <div className="pattern-list">
              {config.sync.exclude_patterns.map((pattern) => (
                <span key={pattern} className="pattern-tag">
                  {pattern}
                  <button
                    className="pattern-remove"
                    onClick={() => removeExcludePattern(pattern)}
                    title="Remove pattern"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Backup to Peer */}
        <div className="setting-item">
          <h4>Backup to Peer</h4>
          <label>
            <input
              type="checkbox"
              checked={config.sync.backup_enabled}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  sync: { ...prev.sync, backup_enabled: e.target.checked },
                }))
              }
            />
            Enable automatic backup to designated peer
          </label>
          <span className="hint">
            Automatically notify a trusted peer (like your server) when files are synced
          </span>
        </div>

        {config.sync.backup_enabled && (
          <>
            <div className="setting-item">
              <label>Backup Peer Address</label>
              <input
                type="text"
                value={config.sync.backup_peer_address || ''}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    sync: { ...prev.sync, backup_peer_address: e.target.value || null },
                  }))
                }
                placeholder="spr:CiUI... or /ip4/.../tcp/.../p2p/..."
              />
              <span className="hint">
                SPR or multiaddr of your backup peer (e.g., your home server)
              </span>
            </div>

            <div className="setting-item">
              <label>Backup Peer Nickname (Optional)</label>
              <input
                type="text"
                value={config.sync.backup_peer_nickname || ''}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    sync: { ...prev.sync, backup_peer_nickname: e.target.value || null },
                  }))
                }
                placeholder="My Home Server"
              />
            </div>

            <div className="setting-item">
              <label>
                <input
                  type="checkbox"
                  checked={config.sync.backup_manifest_enabled}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      sync: { ...prev.sync, backup_manifest_enabled: e.target.checked },
                    }))
                  }
                />
                Generate manifest files
              </label>
              <span className="hint">
                Creates .archivist-manifest.json in watched folders with CID mappings
              </span>
            </div>

            <div className="setting-item">
              <label>
                <input
                  type="checkbox"
                  checked={config.sync.backup_auto_notify}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      sync: { ...prev.sync, backup_auto_notify: e.target.checked },
                    }))
                  }
                />
                Automatically notify backup peer
              </label>
              <span className="hint">
                Create storage request for manifest after each sync (requires peer to be online)
              </span>
            </div>
          </>
        )}
      </div>

      {/* Notification Settings */}
      <div className="settings-section">
        <h3>Notifications</h3>
        <div className="setting-item">
          <label>
            <input
              type="checkbox"
              checked={config.notifications.sound_enabled}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  notifications: { ...prev.notifications, sound_enabled: e.target.checked },
                }))
              }
            />
            Enable sound notifications
          </label>
        </div>
        <div className="setting-item">
          <label>
            <input
              type="checkbox"
              checked={config.notifications.sound_on_startup}
              disabled={!config.notifications.sound_enabled}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  notifications: { ...prev.notifications, sound_on_startup: e.target.checked },
                }))
              }
            />
            Play sound when node starts
          </label>
        </div>
        <div className="setting-item">
          <label>
            <input
              type="checkbox"
              checked={config.notifications.sound_on_peer_connect}
              disabled={!config.notifications.sound_enabled}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  notifications: { ...prev.notifications, sound_on_peer_connect: e.target.checked },
                }))
              }
            />
            Play sound when connecting to a peer
          </label>
        </div>
        <div className="setting-item">
          <label>
            <input
              type="checkbox"
              checked={config.notifications.sound_on_download}
              disabled={!config.notifications.sound_enabled}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  notifications: { ...prev.notifications, sound_on_download: e.target.checked },
                }))
              }
            />
            Play sound when downloading a file
          </label>
        </div>
        <div className="setting-item">
          <label>Volume</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <input
              type="range"
              min="0"
              max="100"
              value={config.notifications.sound_volume * 100}
              disabled={!config.notifications.sound_enabled}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  notifications: { ...prev.notifications, sound_volume: parseInt(e.target.value) / 100 },
                }))
              }
              style={{ flex: 1 }}
            />
            <span style={{ minWidth: '3rem' }}>{Math.round(config.notifications.sound_volume * 100)}%</span>
          </div>
          <span className="hint">Adjust notification sound volume</span>
        </div>
      </div>

      {/* V2 Marketplace Settings - Only shown when enabled */}
      {marketplaceEnabled && (
        <div className="settings-section">
          <h3>Marketplace (Coming Soon)</h3>
          <p className="hint">Marketplace features are not yet available in this version.</p>
        </div>
      )}

      {/* About */}
      <div className="settings-section">
        <h3>About</h3>
        <div className="about-info">
          <div className="about-row">
            <span className="about-label">Version</span>
            <span className="about-value">{appVersion}</span>
          </div>
          <div className="about-row">
            <span className="about-label">Platform</span>
            <span className="about-value">{platform}</span>
          </div>
          <div className="about-row">
            <span className="about-label">Website</span>
            <a
              href="https://github.com/basedmint/archivist"
              target="_blank"
              rel="noopener noreferrer"
              className="about-link"
            >
              github.com/basedmint/archivist
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Settings;
