import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useMarketplace } from '../hooks/useMarketplace';
import { useWallet } from '../hooks/useWallet';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useToast } from '../contexts/ToastContext';
import InfoTooltip from '../components/InfoTooltip';
import CidDisplay from '../components/CidDisplay';
import UnitInput from '../components/UnitInput';
import '../styles/Marketplace.css';

interface FileItem {
  cid: string;
  manifest?: {
    filename?: string;
    mimetype?: string;
    datasetSize?: number;
  };
}

export default function Marketplace() {
  const {
    slots,
    availability,
    purchases,
    setAvailability,
    createStorageRequest,
    error,
    refresh,
  } = useMarketplace();
  const { wallet, loading: walletLoading } = useWallet();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const toast = useToast();
  const [simpleMode, setSimpleMode] = useState(true);

  // Provider form state — matches archivist-node main (ba37d61+) availability schema.
  // v0.2.0 fields `totalSize` and `totalCollateral` were removed by the upstream API.
  const [maximumDuration, setMaximumDuration] = useState('86400'); // 1 day in seconds
  const [minimumPricePerBytePerSecond, setMinimumPricePerBytePerSecond] = useState('1');
  const [maximumCollateralPerByte, setMaximumCollateralPerByte] = useState('1');
  const [availableUntil, setAvailableUntil] = useState('0'); // 0 = no restriction
  const [providerSubmitting, setProviderSubmitting] = useState(false);
  const [providerError, setProviderError] = useState<string | null>(null);

  // Client form state
  const [files, setFiles] = useState<FileItem[]>([]);
  const [selectedCid, setSelectedCid] = useState(searchParams.get('cid') || '');
  const [reqDuration, setReqDuration] = useState('950000');
  const [reqPrice, setReqPrice] = useState('1000');
  const [reqCollateral, setReqCollateral] = useState('1');
  const [reqNodes, setReqNodes] = useState(4);
  const [reqTolerance, setReqTolerance] = useState(2);
  const [reqProofProbability, setReqProofProbability] = useState('500');
  const [reqExpiry, setReqExpiry] = useState(2400);
  const [clientSubmitting, setClientSubmitting] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const [filesLoaded, setFilesLoaded] = useState(false);

  // Pre-fill CID from URL query param
  useEffect(() => {
    const cidParam = searchParams.get('cid');
    if (cidParam) {
      setSelectedCid(cidParam);
      loadFiles();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCidChange = (cid: string) => {
    setSelectedCid(cid);
  };

  // Load files for CID selector
  const loadFiles = async () => {
    if (filesLoaded) return;
    try {
      const result = await invoke<{ files: FileItem[] }>('list_files');
      setFiles(result.files || []);
      setFilesLoaded(true);
    } catch {
      // Files not available
    }
  };

  const handleSetAvailability = async (e: React.FormEvent) => {
    e.preventDefault();
    setProviderSubmitting(true);
    setProviderError(null);
    try {
      await setAvailability({
        maximumDuration,
        minimumPricePerBytePerSecond,
        maximumCollateralPerByte,
        availableUntil: Number(availableUntil) || 0,
      });
    } catch (err) {
      setProviderError(String(err));
    } finally {
      setProviderSubmitting(false);
    }
  };

  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCid) return;
    setClientSubmitting(true);
    setClientError(null);
    try {
      await createStorageRequest({
        cid: selectedCid,
        duration: reqDuration,
        proofProbability: reqProofProbability,
        pricePerBytePerSecond: reqPrice,
        collateralPerByte: reqCollateral,
        nodes: reqNodes,
        tolerance: reqTolerance,
        expiry: reqExpiry,
      });
      setSelectedCid('');
      toast.success('Storage request submitted successfully');
      navigate('/marketplace/deals');
    } catch (err) {
      setClientError(String(err));
    } finally {
      setClientSubmitting(false);
    }
  };

  return (
    <div className="marketplace-page">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h1 style={{ margin: 0 }}>Marketplace</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {!walletLoading && wallet?.hasKey && wallet?.marketplaceActive && (
            <span style={{ color: 'var(--color-success, #00ff41)', fontSize: '0.85rem' }}>Wallet Ready</span>
          )}
          {!walletLoading && wallet?.hasKey && !wallet?.marketplaceActive && (
            <span style={{ color: 'var(--color-warning, #ffaa00)', fontSize: '0.85rem' }}>Marketplace Inactive</span>
          )}
          {!walletLoading && !wallet?.hasKey && (
            <span style={{ color: 'var(--color-error, #ff4444)', fontSize: '0.85rem' }}>No Wallet</span>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={!simpleMode} onChange={(e) => setSimpleMode(!e.target.checked)} />
            Advanced Mode
          </label>
        </div>
      </div>

      {error && <div className="mp-error">{error}</div>}

      {/* Marketplace readiness banner — hide while wallet state is loading to avoid flash */}
      {!walletLoading && !wallet?.hasKey && (
        <div className="mp-section" style={{ background: 'rgba(255, 170, 0, 0.08)', borderColor: 'var(--color-warning, #ffaa00)' }}>
          <h2>Set up your wallet to get started</h2>
          <p style={{ color: 'var(--text-dim)', marginBottom: '0.75rem', fontSize: '0.85rem' }}>
            A wallet is required to offer or purchase storage on the marketplace. Generate or import a wallet to begin.
          </p>
          <button className="mp-submit-btn" onClick={() => navigate('/wallet')}>
            Go to Wallet Setup
          </button>
        </div>
      )}

      {!walletLoading && wallet?.hasKey && !wallet?.marketplaceActive && (
        <div className="mp-error" style={{ background: 'rgba(255, 170, 0, 0.1)', borderColor: 'var(--color-warning, #ffaa00)' }}>
          {wallet?.marketplaceUnavailable
            ? 'Marketplace contract not available on current network. Switch networks from the Wallet page.'
            : 'Wallet configured but marketplace not active. Unlock your wallet and restart the node from the Wallet page.'}
        </div>
      )}

      {/* ── Provider Section ─────────────────────────────────────── */}
      <div className="mp-section">
        <div className="mp-section-header">
          <h2>Offer Storage</h2>
          <button className="mp-refresh-btn" onClick={refresh}>Refresh</button>
        </div>

        <div className="mp-stats">
          <div className="mp-stat">
            <span className="mp-stat-label">Availability Offers</span>
            <span className="mp-stat-value">{availability.length}</span>
          </div>
          <div className="mp-stat">
            <span className="mp-stat-label">Active Slots</span>
            <span className="mp-stat-value">{slots.length}</span>
          </div>
        </div>

        {availability.length > 0 && (
          <>
            <h3>Current Availability</h3>
            <table className="mp-table">
              <thead>
                <tr>
                  <th>Max Duration</th>
                  <th>Min Price/Byte/s</th>
                  <th>Max Collateral/Byte</th>
                  <th>Available Until</th>
                </tr>
              </thead>
              <tbody>
                {availability.map((a, i) => (
                  <tr key={i}>
                    <td>{a.maximumDuration}</td>
                    <td>{a.minimumPricePerBytePerSecond}</td>
                    <td>{a.maximumCollateralPerByte}</td>
                    <td>{a.availableUntil === 0 ? 'Unlimited' : new Date(a.availableUntil * 1000).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <h3>Set Availability</h3>
        <form onSubmit={handleSetAvailability}>
          <div className="mp-form">
            <div className="mp-field">
              <UnitInput type="time" value={maximumDuration} onChange={setMaximumDuration} label="Max Duration" tooltip="The longest storage duration you'll accept for any single deal." />
            </div>
            <div className="mp-field">
              <label>Min Price per Byte/Second<InfoTooltip text="The minimum rate you'll accept for storing data. Higher = more selective but fewer deals." /></label>
              <input
                type="text"
                value={minimumPricePerBytePerSecond}
                onChange={(e) => setMinimumPricePerBytePerSecond(e.target.value)}
                placeholder="1"
              />
            </div>
            {!simpleMode && (
              <>
                <div className="mp-field">
                  <label>Max Collateral per Byte<InfoTooltip text="Maximum tokens a client may require you to lock per byte. Higher = more deals you qualify for, but more at risk." /></label>
                  <input
                    type="text"
                    value={maximumCollateralPerByte}
                    onChange={(e) => setMaximumCollateralPerByte(e.target.value)}
                    placeholder="1"
                  />
                </div>
                <div className="mp-field">
                  <label>Available Until (Unix timestamp, 0 = no limit)<InfoTooltip text="The latest time you're willing to host slots until. 0 means no time restriction." /></label>
                  <input
                    type="text"
                    value={availableUntil}
                    onChange={(e) => setAvailableUntil(e.target.value)}
                    placeholder="0"
                  />
                </div>
              </>
            )}
          </div>
          {providerError && <div className="mp-error">{providerError}</div>}
          <button type="submit" className="mp-submit-btn" disabled={providerSubmitting}>
            {providerSubmitting ? 'Publishing...' : 'Publish Availability'}
          </button>
        </form>

        {slots.length > 0 && (
          <>
            <h3 style={{ marginTop: '1.25rem' }}>Active Slots</h3>
            <table className="mp-table">
              <thead>
                <tr>
                  <th>Slot Index</th>
                  <th>CID</th>
                  <th>Slots</th>
                  <th>Duration</th>
                </tr>
              </thead>
              <tbody>
                {slots.map((s, i) => (
                  <tr key={i}>
                    <td>{s.slotIndex}</td>
                    <td><CidDisplay cid={s.request.content.cid} /></td>
                    <td>{s.request.ask.slots}</td>
                    <td>{s.request.ask.duration}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      {/* ── Client Section ───────────────────────────────────────── */}
      <div className="mp-section">
        <h2>Request Storage</h2>

        <form onSubmit={handleCreateRequest}>
          <div className="mp-form">
            <div className="mp-field full-width">
              <label>Content ID (CID)</label>
              <input
                type="text"
                value={selectedCid}
                onChange={(e) => handleCidChange(e.target.value)}
                onFocus={loadFiles}
                placeholder="Enter CID or select from stored files"
                list="cid-list"
              />
              <datalist id="cid-list">
                {files.map((f) => (
                  <option key={f.cid} value={f.cid}>
                    {f.manifest?.filename || f.cid}
                  </option>
                ))}
              </datalist>
            </div>
            <div className="mp-field">
              <UnitInput type="time" value={reqDuration} onChange={setReqDuration} label="Duration" tooltip="How long you want your data stored." />
            </div>
            <div className="mp-field">
              <label>Nodes<InfoTooltip text="Minimal number of storage provider nodes that will store your data. More nodes = more redundancy." /></label>
              <input
                type="number"
                value={reqNodes}
                onChange={(e) => setReqNodes(Number(e.target.value))}
                min={3}
                max={8}
              />
            </div>
            {!simpleMode && (
              <>
                <div className="mp-field">
                  <label>Price per Byte/Second<InfoTooltip text="How much you're willing to pay for storage per byte per second." /></label>
                  <input
                    type="text"
                    value={reqPrice}
                    onChange={(e) => setReqPrice(e.target.value)}
                    placeholder="2000"
                  />
                </div>
                <div className="mp-field">
                  <label>Proof Probability<InfoTooltip text="How often storage providers must prove they still have your data. Lower number = more frequent proofs = higher assurance but higher cost." /></label>
                  <input
                    type="text"
                    value={reqProofProbability}
                    onChange={(e) => setReqProofProbability(e.target.value)}
                    placeholder="200"
                  />
                </div>
                <div className="mp-field">
                  <label>Collateral per Byte<InfoTooltip text="Tokens the provider must lock per byte as a guarantee. Higher = stronger guarantee your data is safe." /></label>
                  <input
                    type="text"
                    value={reqCollateral}
                    onChange={(e) => setReqCollateral(e.target.value)}
                    placeholder="1"
                  />
                </div>
                <div className="mp-field">
                  <label>Tolerance<InfoTooltip text="Additional nodes on top of the minimum that can be lost before data becomes unrecoverable." /></label>
                  <input
                    type="number"
                    value={reqTolerance}
                    onChange={(e) => setReqTolerance(Number(e.target.value))}
                    min={1}
                  />
                </div>
                <div className="mp-field">
                  <UnitInput type="time" value={String(reqExpiry)} onChange={(v) => setReqExpiry(Number(v))} label="Expiry" tooltip="Time limit for providers to accept your storage request. After this, unfilled slots expire." />
                </div>
              </>
            )}
          </div>
          {clientError && <div className="mp-error">{clientError}</div>}
          {clientSubmitting && (
            <div className="mp-info">
              Submitting blockchain transaction... This may take several minutes while gas is estimated and the transaction is processed.
            </div>
          )}
          <button
            type="submit"
            className="mp-submit-btn"
            disabled={clientSubmitting || !selectedCid}
          >
            {clientSubmitting ? 'Submitting (please wait)...' : 'Create Storage Request'}
          </button>
        </form>

        {purchases.length > 0 && (
          <>
            <h3 style={{ marginTop: '1.25rem' }}>Recent Purchases</h3>
            <table className="mp-table">
              <thead>
                <tr>
                  <th>Purchase ID</th>
                </tr>
              </thead>
              <tbody>
                {purchases.map((id) => (
                  <tr key={id}>
                    <td><CidDisplay cid={id} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginTop: '0.5rem' }}>
              View full purchase details on the <Link to="/marketplace/deals" style={{ color: 'var(--color-link)' }}>Deals</Link> page.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
