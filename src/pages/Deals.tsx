import { useState } from 'react';
import { useMarketplace, type Purchase, type SalesSlot } from '../hooks/useMarketplace';
import '../styles/Marketplace.css';

export default function Deals() {
  const { slots, purchases, getPurchase, error, refresh } = useMarketplace();
  const [expandedPurchase, setExpandedPurchase] = useState<string | null>(null);
  const [expandedSlot, setExpandedSlot] = useState<number | null>(null);
  const [purchaseDetails, setPurchaseDetails] = useState<Record<string, Purchase>>({});
  const [detailLoading, setDetailLoading] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const handleExpandPurchase = async (id: string) => {
    if (expandedPurchase === id) {
      setExpandedPurchase(null);
      return;
    }
    setExpandedPurchase(id);
    if (!purchaseDetails[id]) {
      setDetailLoading(id);
      setDetailError(null);
      try {
        const detail = await getPurchase(id);
        setPurchaseDetails((prev) => ({ ...prev, [id]: detail }));
      } catch (e) {
        setDetailError(String(e));
      } finally {
        setDetailLoading(null);
      }
    }
  };

  return (
    <div className="deals-page">
      <h1>My Deals</h1>

      {error && <div className="mp-error">{error}</div>}

      {/* ── Purchases (client side) ──────────────────────────────── */}
      <div className="mp-section">
        <div className="mp-section-header">
          <h2>My Purchases</h2>
          <button className="mp-refresh-btn" onClick={refresh}>Refresh</button>
        </div>

        {purchases.length === 0 ? (
          <div className="mp-empty">No purchases yet. Request storage from the Marketplace page.</div>
        ) : (
          <table className="mp-table">
            <thead>
              <tr>
                <th>Purchase ID</th>
              </tr>
            </thead>
            <tbody>
              {purchases.map((id: string) => (
                <>
                  <tr
                    key={id}
                    onClick={() => handleExpandPurchase(id)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td title={id}>{id.slice(0, 16)}...</td>
                  </tr>
                  {expandedPurchase === id && (
                    <tr key={`${id}-detail`}>
                      <td colSpan={1} style={{ background: 'var(--term-dark)', padding: '1rem' }}>
                        {detailLoading === id && <div>Loading details...</div>}
                        {detailError && expandedPurchase === id && <div className="mp-error">{detailError}</div>}
                        {purchaseDetails[id] && <PurchaseDetail purchase={purchaseDetails[id]} />}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Slots (provider side) ────────────────────────────────── */}
      <div className="mp-section">
        <h2>My Slots</h2>

        {slots.length === 0 ? (
          <div className="mp-empty">No active slots. Offer storage availability from the Marketplace page.</div>
        ) : (
          <table className="mp-table">
            <thead>
              <tr>
                <th>Slot Index</th>
                <th>CID</th>
                <th>Slots</th>
                <th>Duration</th>
                <th>Client</th>
              </tr>
            </thead>
            <tbody>
              {slots.map((s: SalesSlot, i: number) => (
                <>
                  <tr
                    key={i}
                    onClick={() => setExpandedSlot(expandedSlot === i ? null : i)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td>{s.slotIndex}</td>
                    <td title={s.request.content.cid}>{s.request.content.cid.slice(0, 12)}...</td>
                    <td>{s.request.ask.slots}</td>
                    <td>{s.request.ask.duration}</td>
                    <td title={s.request.client}>{s.request.client.slice(0, 12) || '-'}...</td>
                  </tr>
                  {expandedSlot === i && (
                    <tr key={`slot-${i}-detail`}>
                      <td colSpan={5} style={{ background: 'var(--term-dark)', padding: '1rem' }}>
                        <SlotDetail slot={s} />
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function PurchaseDetail({ purchase }: { purchase: Purchase }) {
  return (
    <div style={{ fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
      <div><strong>Request ID:</strong> {purchase.requestId}</div>
      <div><strong>State:</strong> {purchase.state}</div>
      {purchase.error && (
        <div style={{ color: 'var(--color-error)' }}><strong>Error:</strong> {purchase.error}</div>
      )}
      {purchase.request && (
        <>
          <div><strong>CID:</strong> {purchase.request.content.cid}</div>
          <div><strong>Merkle Root:</strong> {purchase.request.content.merkleRoot || 'N/A'}</div>
          <div><strong>Client:</strong> {purchase.request.client}</div>
          <div><strong>Slots:</strong> {purchase.request.ask.slots}</div>
          <div><strong>Slot Size:</strong> {purchase.request.ask.slotSize}</div>
          <div><strong>Duration:</strong> {purchase.request.ask.duration}s</div>
          <div><strong>Price/Byte/s:</strong> {purchase.request.ask.pricePerBytePerSecond}</div>
          <div><strong>Collateral/Byte:</strong> {purchase.request.ask.collateralPerByte}</div>
          <div><strong>Max Slot Loss:</strong> {purchase.request.ask.maxSlotLoss}</div>
          <div><strong>Expiry:</strong> {purchase.request.expiry}</div>
          <div><strong>Nonce:</strong> {purchase.request.nonce || 'N/A'}</div>
        </>
      )}
    </div>
  );
}

function SlotDetail({ slot }: { slot: SalesSlot }) {
  return (
    <div style={{ fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
      <div><strong>Slot Index:</strong> {slot.slotIndex}</div>
      <div><strong>CID:</strong> {slot.request.content.cid}</div>
      <div><strong>Merkle Root:</strong> {slot.request.content.merkleRoot || 'N/A'}</div>
      <div><strong>Client:</strong> {slot.request.client}</div>
      <div><strong>Slots:</strong> {slot.request.ask.slots}</div>
      <div><strong>Duration:</strong> {slot.request.ask.duration}s</div>
      <div><strong>Price/Byte/s:</strong> {slot.request.ask.pricePerBytePerSecond}</div>
      <div><strong>Collateral/Byte:</strong> {slot.request.ask.collateralPerByte}</div>
    </div>
  );
}
