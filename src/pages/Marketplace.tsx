import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useMarketplace } from '../hooks/useMarketplace';
import { useWallet } from '../hooks/useWallet';
import { useNavigate, Link } from 'react-router-dom';
import InfoTooltip from '../components/InfoTooltip';
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

  // Provider form state
  const [totalSize, setTotalSize] = useState('1073741824'); // 1 GB
  const [duration, setDuration] = useState('86400'); // 1 day in seconds
  const [minPricePerBytePerSecond, setMinPricePerBytePerSecond] = useState('1');
  const [maxCollateralPerByte, setMaxCollateralPerByte] = useState('1');
  const [totalCollateral, setTotalCollateral] = useState('1');
  const [providerSubmitting, setProviderSubmitting] = useState(false);
  const [providerError, setProviderError] = useState<string | null>(null);

  // Client form state
  const [files, setFiles] = useState<FileItem[]>([]);
  const [selectedCid, setSelectedCid] = useState('');
  const [reqDuration, setReqDuration] = useState('2592000');
  const [reqPrice, setReqPrice] = useState('2000');
  const [reqCollateral, setReqCollateral] = useState('1');
  const [reqSlots, setReqSlots] = useState(4);
  const [reqSlotSize, setReqSlotSize] = useState(0);
  const [reqMaxSlotLoss, setReqMaxSlotLoss] = useState(2);
  const [reqProofProbability, setReqProofProbability] = useState('200');
  const [reqExpiry, setReqExpiry] = useState(3600);
  const [clientSubmitting, setClientSubmitting] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const [filesLoaded, setFilesLoaded] = useState(false);

  // Auto-calculate slot size from CID's dataset size and number of slots
  const computeSlotSize = (cid: string, slots: number, fileList: FileItem[]) => {
    const file = fileList.find((f) => f.cid === cid);
    if (file?.manifest?.datasetSize && slots > 0) {
      setReqSlotSize(Math.ceil(file.manifest.datasetSize / slots));
    } else {
      setReqSlotSize(0);
    }
  };

  const handleCidChange = (cid: string) => {
    setSelectedCid(cid);
    computeSlotSize(cid, reqSlots, files);
  };

  const handleSlotsChange = (slots: number) => {
    setReqSlots(slots);
    computeSlotSize(selectedCid, slots, files);
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
      await setAvailability({ totalSize, duration, minPricePerBytePerSecond, maxCollateralPerByte, totalCollateral });
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
        slots: reqSlots,
        slotSize: reqSlotSize,
        maxSlotLoss: reqMaxSlotLoss,
        expiry: reqExpiry,
      });
      setSelectedCid('');
    } catch (err) {
      setClientError(String(err));
    } finally {
      setClientSubmitting(false);
    }
  };

  return (
    <div className="marketplace-page">
      <h1>Marketplace</h1>

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
                  <th>ID</th>
                  <th>Total Size</th>
                  <th>Free Size</th>
                  <th>Duration</th>
                  <th>Min Price/Byte/s</th>
                  <th>Total Collateral</th>
                </tr>
              </thead>
              <tbody>
                {availability.map((a) => (
                  <tr key={a.id}>
                    <td title={a.id}>{a.id.slice(0, 8)}...</td>
                    <td>{a.totalSize}</td>
                    <td>{a.freeSize}</td>
                    <td>{a.duration}</td>
                    <td>{a.minPricePerBytePerSecond}</td>
                    <td>{a.totalCollateral}</td>
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
              <label>Total Size (bytes)</label>
              <input
                type="text"
                value={totalSize}
                onChange={(e) => setTotalSize(e.target.value)}
                placeholder="1073741824"
              />
            </div>
            <div className="mp-field">
              <label>Duration (seconds)<InfoTooltip text="How long you're offering to store data. Measured in seconds (86400 = 1 day)." /></label>
              <input
                type="text"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="86400"
              />
            </div>
            <div className="mp-field">
              <label>Min Price per Byte/Second<InfoTooltip text="The minimum rate you'll accept for storing data. Higher = more selective but fewer deals." /></label>
              <input
                type="text"
                value={minPricePerBytePerSecond}
                onChange={(e) => setMinPricePerBytePerSecond(e.target.value)}
                placeholder="1"
              />
            </div>
            <div className="mp-field">
              <label>Max Collateral per Byte<InfoTooltip text="Maximum tokens you're willing to lock as a guarantee per byte stored. You lose this if you fail to store the data." /></label>
              <input
                type="text"
                value={maxCollateralPerByte}
                onChange={(e) => setMaxCollateralPerByte(e.target.value)}
                placeholder="1"
              />
            </div>
            <div className="mp-field">
              <label>Total Collateral<InfoTooltip text="Total tokens locked as a guarantee for your storage commitment. Returned when you fulfill the storage deal." /></label>
              <input
                type="text"
                value={totalCollateral}
                onChange={(e) => setTotalCollateral(e.target.value)}
                placeholder="1"
              />
            </div>
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
                    <td title={s.request.content.cid}>{s.request.content.cid.slice(0, 12)}...</td>
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
              <label>CID</label>
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
              <label>Duration (seconds)<InfoTooltip text="How long you want your data stored. Measured in seconds (2592000 = 30 days)." /></label>
              <input
                type="text"
                value={reqDuration}
                onChange={(e) => setReqDuration(e.target.value)}
                placeholder="2592000"
              />
            </div>
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
              <label>Slots<InfoTooltip text="Number of storage providers that will each store a copy of your data. More slots = more redundancy." /></label>
              <input
                type="number"
                value={reqSlots}
                onChange={(e) => handleSlotsChange(Number(e.target.value))}
                min={1}
              />
            </div>
            <div className="mp-field">
              <label>Slot Size (bytes, 0 = auto)<InfoTooltip text="Size of each data chunk distributed to providers. Set to 0 for automatic calculation based on file size and slot count." /></label>
              <input
                type="number"
                value={reqSlotSize}
                onChange={(e) => setReqSlotSize(Number(e.target.value))}
                min={0}
              />
            </div>
            <div className="mp-field">
              <label>Max Slot Loss<InfoTooltip text="Maximum number of storage slots that can fail before your data becomes unrecoverable. Must be less than total slots." /></label>
              <input
                type="number"
                value={reqMaxSlotLoss}
                onChange={(e) => setReqMaxSlotLoss(Number(e.target.value))}
                min={0}
              />
            </div>
            <div className="mp-field">
              <label>Expiry (seconds)<InfoTooltip text="Time limit for providers to accept your storage request. After this, unfilled slots expire." /></label>
              <input
                type="number"
                value={reqExpiry}
                onChange={(e) => setReqExpiry(Number(e.target.value))}
                min={0}
              />
            </div>
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
                    <td title={id}>{id.slice(0, 16)}...</td>
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
