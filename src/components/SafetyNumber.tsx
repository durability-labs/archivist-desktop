import { useState, useEffect } from 'react';
import type { SafetyNumberInfo } from '../lib/chatTypes';

interface SafetyNumberProps {
  peerId: string;
  getSafetyNumber: (peerId: string) => Promise<SafetyNumberInfo>;
  onVerify: (peerId: string) => Promise<void>;
  onClose: () => void;
}

export default function SafetyNumber({ peerId, getSafetyNumber, onVerify, onClose }: SafetyNumberProps) {
  const [info, setInfo] = useState<SafetyNumberInfo | null>(null);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    getSafetyNumber(peerId).then(setInfo).catch(console.error);
  }, [peerId, getSafetyNumber]);

  const handleVerify = async () => {
    setVerifying(true);
    try {
      await onVerify(peerId);
      const updated = await getSafetyNumber(peerId);
      setInfo(updated);
    } catch (e) {
      console.error('Verify failed:', e);
    } finally {
      setVerifying(false);
    }
  };

  if (!info) {
    return <div className="safety-number-modal"><div className="loading-spinner" /></div>;
  }

  return (
    <div className="safety-number-modal" onClick={onClose}>
      <div className="safety-number-content" onClick={e => e.stopPropagation()}>
        <h3>Safety Number</h3>
        <p className="safety-number-description">
          Compare these numbers with your contact on another channel to verify their identity.
          If the numbers match, click Verify.
        </p>
        <div className="safety-number-grid">
          {info.groups.map((group, i) => (
            <span key={i} className="safety-number-group">{group}</span>
          ))}
        </div>
        <div className="safety-number-peer">
          Peer: <code>{peerId.length > 20 ? `${peerId.slice(0, 10)}...${peerId.slice(-6)}` : peerId}</code>
        </div>
        {info.verified ? (
          <div className="safety-number-verified">Verified</div>
        ) : (
          <button
            className="btn btn-primary"
            onClick={handleVerify}
            disabled={verifying}
          >
            {verifying ? 'Verifying...' : 'Mark as Verified'}
          </button>
        )}
        <button className="btn btn-secondary" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
