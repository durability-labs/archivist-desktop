import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useMarketplace } from '../hooks/useMarketplace';
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
    loading,
    error,
    refresh,
  } = useMarketplace();

  // Provider form state
  const [totalSize, setTotalSize] = useState('1073741824'); // 1 GB
  const [duration, setDuration] = useState('86400'); // 1 day in seconds
  const [minPrice, setMinPrice] = useState('1');
  const [maxCollateral, setMaxCollateral] = useState('1');
  const [providerSubmitting, setProviderSubmitting] = useState(false);
  const [providerError, setProviderError] = useState<string | null>(null);

  // Client form state
  const [files, setFiles] = useState<FileItem[]>([]);
  const [selectedCid, setSelectedCid] = useState('');
  const [reqDuration, setReqDuration] = useState('86400');
  const [reqPrice, setReqPrice] = useState('1');
  const [reqCollateral, setReqCollateral] = useState('1');
  const [reqSlots, setReqSlots] = useState(3);
  const [reqSlotSize, setReqSlotSize] = useState(0);
  const [reqMaxSlotLoss, setReqMaxSlotLoss] = useState(1);
  const [reqExpiry, setReqExpiry] = useState(3600);
  const [clientSubmitting, setClientSubmitting] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const [filesLoaded, setFilesLoaded] = useState(false);

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
      await setAvailability({ totalSize, duration, minPrice, maxCollateral });
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

  if (loading) {
    return (
      <div className="marketplace-page">
        <h1>Marketplace</h1>
        <div className="mp-empty">Loading marketplace data...</div>
      </div>
    );
  }

  return (
    <div className="marketplace-page">
      <h1>Marketplace</h1>

      {error && <div className="mp-error">{error}</div>}

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
                  <th>Min Price</th>
                  <th>Max Collateral</th>
                </tr>
              </thead>
              <tbody>
                {availability.map((a) => (
                  <tr key={a.id}>
                    <td title={a.id}>{a.id.slice(0, 8)}...</td>
                    <td>{a.totalSize}</td>
                    <td>{a.freeSize}</td>
                    <td>{a.duration}</td>
                    <td>{a.minPrice}</td>
                    <td>{a.maxCollateral}</td>
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
              <label>Duration (seconds)</label>
              <input
                type="text"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="86400"
              />
            </div>
            <div className="mp-field">
              <label>Min Price</label>
              <input
                type="text"
                value={minPrice}
                onChange={(e) => setMinPrice(e.target.value)}
                placeholder="1"
              />
            </div>
            <div className="mp-field">
              <label>Max Collateral</label>
              <input
                type="text"
                value={maxCollateral}
                onChange={(e) => setMaxCollateral(e.target.value)}
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
                onChange={(e) => setSelectedCid(e.target.value)}
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
              <label>Duration (seconds)</label>
              <input
                type="text"
                value={reqDuration}
                onChange={(e) => setReqDuration(e.target.value)}
                placeholder="86400"
              />
            </div>
            <div className="mp-field">
              <label>Price per Byte/Second</label>
              <input
                type="text"
                value={reqPrice}
                onChange={(e) => setReqPrice(e.target.value)}
                placeholder="1"
              />
            </div>
            <div className="mp-field">
              <label>Collateral per Byte</label>
              <input
                type="text"
                value={reqCollateral}
                onChange={(e) => setReqCollateral(e.target.value)}
                placeholder="1"
              />
            </div>
            <div className="mp-field">
              <label>Slots</label>
              <input
                type="number"
                value={reqSlots}
                onChange={(e) => setReqSlots(Number(e.target.value))}
                min={1}
              />
            </div>
            <div className="mp-field">
              <label>Slot Size (bytes, 0 = auto)</label>
              <input
                type="number"
                value={reqSlotSize}
                onChange={(e) => setReqSlotSize(Number(e.target.value))}
                min={0}
              />
            </div>
            <div className="mp-field">
              <label>Max Slot Loss</label>
              <input
                type="number"
                value={reqMaxSlotLoss}
                onChange={(e) => setReqMaxSlotLoss(Number(e.target.value))}
                min={0}
              />
            </div>
            <div className="mp-field">
              <label>Expiry (seconds)</label>
              <input
                type="number"
                value={reqExpiry}
                onChange={(e) => setReqExpiry(Number(e.target.value))}
                min={0}
              />
            </div>
          </div>
          {clientError && <div className="mp-error">{clientError}</div>}
          <button
            type="submit"
            className="mp-submit-btn"
            disabled={clientSubmitting || !selectedCid}
          >
            {clientSubmitting ? 'Submitting...' : 'Create Storage Request'}
          </button>
        </form>

        {purchases.length > 0 && (
          <>
            <h3 style={{ marginTop: '1.25rem' }}>Recent Purchases</h3>
            <table className="mp-table">
              <thead>
                <tr>
                  <th>Request ID</th>
                  <th>CID</th>
                  <th>State</th>
                  <th>Slots</th>
                  <th>Duration</th>
                </tr>
              </thead>
              <tbody>
                {purchases.map((p) => (
                  <tr key={p.requestId}>
                    <td title={p.requestId}>{p.requestId.slice(0, 8)}...</td>
                    <td title={p.request?.content.cid}>
                      {p.request?.content.cid.slice(0, 12) || 'N/A'}...
                    </td>
                    <td>
                      <span className={`mp-state-badge ${p.state}`}>{p.state}</span>
                    </td>
                    <td>{p.request?.ask.slots || '-'}</td>
                    <td>{p.request?.ask.duration || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
