import { useState } from 'react';
import { useStremioAddons } from '../hooks/useStremioAddons';
import '../styles/AddonManager.css';

const SUGGESTED_ADDONS = [
  {
    name: 'Cinemeta',
    url: 'https://v3-cinemeta.strem.io',
    description: 'The official catalog for movies and series metadata',
  },
  {
    name: 'Torrentio',
    url: 'https://torrentio.strem.fun',
    description: 'Torrent streams from various indexers',
  },
  {
    name: 'OpenSubtitles',
    url: 'https://opensubtitles-v3.strem.io',
    description: 'Subtitles from OpenSubtitles.org',
  },
];

export default function AddonManager() {
  const { addons, loading, error, installAddon, removeAddon, toggleAddon } = useStremioAddons();
  const [addonUrl, setAddonUrl] = useState('');
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);

  const handleInstall = async () => {
    if (!addonUrl.trim()) return;
    setInstalling(true);
    setInstallError(null);
    try {
      await installAddon(addonUrl.trim());
      setAddonUrl('');
    } catch (e) {
      setInstallError(String(e));
    } finally {
      setInstalling(false);
    }
  };

  const handleInstallSuggested = async (url: string) => {
    setInstalling(true);
    setInstallError(null);
    try {
      await installAddon(url);
    } catch (e) {
      setInstallError(String(e));
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="addon-manager">
      {/* Install from URL */}
      <div className="addon-url-input">
        <h3>Install Addon</h3>
        <div className="addon-input-row">
          <input
            type="text"
            placeholder="Paste addon manifest URL..."
            value={addonUrl}
            onChange={e => setAddonUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleInstall()}
            disabled={installing}
          />
          <button
            className="addon-install-btn"
            onClick={handleInstall}
            disabled={installing || !addonUrl.trim()}
          >
            {installing ? 'Installing...' : 'Install'}
          </button>
        </div>
        {installError && <div className="addon-install-error">{installError}</div>}
        {error && <div className="addon-install-error">{error}</div>}
      </div>

      {/* Installed addons */}
      <div className="addon-section">
        <h3>Installed Addons ({addons.length})</h3>
        {loading && addons.length === 0 ? (
          <div className="addon-loading">Loading addons...</div>
        ) : addons.length === 0 ? (
          <div className="addon-empty">No addons installed yet.</div>
        ) : (
          <div className="addon-list">
            {addons.map(addon => (
              <div key={addon.manifest.id} className={`addon-item ${!addon.enabled ? 'disabled' : ''}`}>
                {addon.manifest.logo && (
                  <img src={addon.manifest.logo} alt="" className="addon-logo" />
                )}
                <div className="addon-info">
                  <div className="addon-name">{addon.manifest.name}</div>
                  <div className="addon-desc">{addon.manifest.description}</div>
                  <div className="addon-types">
                    {addon.manifest.types.join(', ')}
                  </div>
                </div>
                <div className="addon-actions">
                  <label className="addon-toggle">
                    <input
                      type="checkbox"
                      checked={addon.enabled}
                      onChange={e => toggleAddon(addon.manifest.id, e.target.checked)}
                    />
                    {addon.enabled ? 'On' : 'Off'}
                  </label>
                  <button
                    className="addon-remove-btn"
                    onClick={() => removeAddon(addon.manifest.id)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Suggested addons */}
      <div className="addon-section addon-suggestions">
        <h3>Suggested Addons</h3>
        <div className="addon-list">
          {SUGGESTED_ADDONS.filter(
            s => !addons.some(a => a.base_url.includes(new URL(s.url).hostname))
          ).map(suggested => (
            <div key={suggested.url} className="addon-item suggested">
              <div className="addon-info">
                <div className="addon-name">{suggested.name}</div>
                <div className="addon-desc">{suggested.description}</div>
              </div>
              <button
                className="addon-install-btn"
                onClick={() => handleInstallSuggested(suggested.url)}
                disabled={installing}
              >
                Install
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
