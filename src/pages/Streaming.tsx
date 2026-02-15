import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStremioAddons } from '../hooks/useStremioAddons';
import { useCatalog } from '../hooks/useCatalog';
import { useDebrid } from '../hooks/useDebrid';
import AddonManager from './AddonManager';
import IPTVBrowser from './IPTVBrowser';
import type { MetaItem, InstalledAddon } from '../lib/stremioTypes';
import '../styles/Streaming.css';

type StreamingTab = 'discover' | 'iptv' | 'addons' | 'settings';

export default function Streaming() {
  const [activeTab, setActiveTab] = useState<StreamingTab>('discover');

  return (
    <div className="streaming-page">
      <h1>Streaming TV</h1>

      <div className="streaming-tabs">
        <button
          className={`streaming-tab ${activeTab === 'discover' ? 'active' : ''}`}
          data-tab="discover"
          onClick={() => setActiveTab('discover')}
        >
          Discover
        </button>
        <button
          className={`streaming-tab ${activeTab === 'iptv' ? 'active' : ''}`}
          data-tab="iptv"
          onClick={() => setActiveTab('iptv')}
        >
          IPTV
        </button>
        <button
          className={`streaming-tab ${activeTab === 'addons' ? 'active' : ''}`}
          data-tab="addons"
          onClick={() => setActiveTab('addons')}
        >
          Addons
        </button>
        <button
          className={`streaming-tab ${activeTab === 'settings' ? 'active' : ''}`}
          data-tab="settings"
          onClick={() => setActiveTab('settings')}
        >
          Settings
        </button>
      </div>

      <div className="streaming-content">
        {activeTab === 'discover' && <DiscoverTab />}
        {activeTab === 'iptv' && <IPTVBrowser />}
        {activeTab === 'addons' && <AddonManager />}
        {activeTab === 'settings' && <SettingsTab />}
      </div>
    </div>
  );
}

function DiscoverTab() {
  const navigate = useNavigate();
  const { addons } = useStremioAddons();
  const { items, loading, selectedType, loadCatalog, setSelectedType } = useCatalog();
  const [activeAddon, setActiveAddon] = useState<InstalledAddon | null>(null);

  const enabledAddons = addons.filter(a => a.enabled);

  // Auto-load first catalog when addons are available
  useEffect(() => {
    if (enabledAddons.length > 0 && !activeAddon) {
      const addon = enabledAddons[0];
      setActiveAddon(addon);
      if (addon.manifest.catalogs.length > 0) {
        const catalog = addon.manifest.catalogs[0];
        loadCatalog(addon.manifest.id, catalog.type, catalog.id);
      }
    }
  }, [enabledAddons.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTypeChange = useCallback((type: string) => {
    setSelectedType(type);
    if (activeAddon) {
      // Find a catalog for this type
      const catalog = activeAddon.manifest.catalogs.find(c => c.type === type);
      if (catalog) {
        loadCatalog(activeAddon.manifest.id, type, catalog.id);
      }
    }
  }, [activeAddon, loadCatalog, setSelectedType]);

  const handleCardClick = useCallback((item: MetaItem) => {
    navigate(`/streaming/content/${item.type}/${item.id}`);
  }, [navigate]);

  if (enabledAddons.length === 0) {
    return (
      <div className="catalog-empty">
        <div className="empty-icon">[ ]</div>
        <h3>No Content Available</h3>
        <p>Install Stremio-compatible addons to browse movies, series, and more.</p>
        <p className="empty-hint">Go to the Addons tab to get started.</p>
      </div>
    );
  }

  // Get available types from active addon
  const types = activeAddon?.manifest.types || [];

  return (
    <div>
      {/* Type filter */}
      {types.length > 1 && (
        <div className="catalog-type-filter">
          {types.map(t => (
            <button
              key={t}
              className={`catalog-type-btn ${selectedType === t ? 'active' : ''}`}
              onClick={() => handleTypeChange(t)}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {/* Catalog grid */}
      {loading ? (
        <div className="catalog-loading">Loading catalog...</div>
      ) : items.length === 0 ? (
        <div className="catalog-empty-inline">No items found.</div>
      ) : (
        <div className="catalog-grid">
          {items.map(item => (
            <button
              key={item.id}
              className="catalog-card"
              onClick={() => handleCardClick(item)}
            >
              {item.poster ? (
                <img src={item.poster} alt={item.name} className="catalog-card-poster" />
              ) : (
                <div className="catalog-card-poster placeholder">{item.name[0]}</div>
              )}
              <div className="catalog-card-title">{item.name}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SettingsTab() {
  const {
    configured,
    providerType,
    loading,
    configureRealDebrid,
    configurePremiumize,
    clearProvider,
    validateToken,
  } = useDebrid();

  const [selectedProvider, setSelectedProvider] = useState(providerType || '');
  const [token, setToken] = useState('');
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<boolean | null>(null);

  useEffect(() => {
    if (providerType) {
      setSelectedProvider(providerType);
    }
  }, [providerType]);

  const handleConfigure = async () => {
    if (!token.trim() || !selectedProvider) return;
    if (selectedProvider === 'real_debrid') {
      await configureRealDebrid(token.trim());
    } else if (selectedProvider === 'premiumize') {
      await configurePremiumize(token.trim());
    }
    setToken('');
  };

  const handleValidate = async () => {
    setValidating(true);
    const valid = await validateToken();
    setValidationResult(valid);
    setValidating(false);
  };

  return (
    <div className="streaming-settings">
      <h3>Debrid Service</h3>
      <p className="settings-description">
        Configure a debrid service to resolve torrent-based streams into direct links.
      </p>

      <div className="debrid-config-form">
        <div className="debrid-field">
          <label>Provider</label>
          <select
            className="debrid-provider-select"
            value={selectedProvider}
            onChange={e => setSelectedProvider(e.target.value)}
            disabled={configured}
          >
            <option value="">None</option>
            <option value="real_debrid">Real-Debrid</option>
            <option value="premiumize">Premiumize</option>
          </select>
        </div>

        {!configured && selectedProvider && (
          <div className="debrid-field">
            <label>API Token</label>
            <div className="debrid-token-input">
              <input
                type="password"
                placeholder="Enter API token..."
                value={token}
                onChange={e => setToken(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleConfigure()}
              />
            </div>
            <button
              className="debrid-validate-btn"
              onClick={handleConfigure}
              disabled={!token.trim() || loading}
            >
              Configure
            </button>
          </div>
        )}

        {configured && (
          <div className="debrid-configured">
            <div className="debrid-status configured">
              Provider: {providerType === 'real_debrid' ? 'Real-Debrid' : 'Premiumize'} - Configured
            </div>
            <div className="debrid-actions">
              <button
                className="debrid-validate-btn"
                onClick={handleValidate}
                disabled={validating}
              >
                {validating ? 'Validating...' : 'Validate Token'}
              </button>
              <button className="debrid-clear-btn" onClick={clearProvider}>
                Clear
              </button>
            </div>
            {validationResult !== null && (
              <div className={`debrid-status ${validationResult ? 'configured' : 'not-configured'}`}>
                {validationResult ? 'Token is valid' : 'Token is invalid or expired'}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
