import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePeers } from '../hooks/usePeers';
import '../styles/AddDevice.css';

type WizardStep = 'input' | 'connecting' | 'success' | 'error';

function AddDevice() {
  const navigate = useNavigate();
  const { connectPeer } = usePeers();

  const [step, setStep] = useState<WizardStep>('input');
  const [peerAddress, setPeerAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [connectedPeerId, setConnectedPeerId] = useState<string | null>(null);

  const handleConnect = useCallback(async () => {
    if (!peerAddress.trim()) {
      setError('Please enter a peer address');
      return;
    }

    setStep('connecting');
    setError(null);

    try {
      await connectPeer(peerAddress.trim());
      // Extract peer ID from address for display
      const peerIdMatch = peerAddress.match(/\/p2p\/([^/]+)/) || peerAddress.match(/([A-Za-z0-9]{52})/);
      setConnectedPeerId(peerIdMatch ? peerIdMatch[1] : 'Unknown');
      setStep('success');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep('error');
    }
  }, [peerAddress, connectPeer]);

  const handleRetry = useCallback(() => {
    setStep('input');
    setError(null);
  }, []);

  const handleDone = useCallback(() => {
    navigate('/devices');
  }, [navigate]);

  const renderInput = () => (
    <div className="wizard-step">
      <div className="wizard-icon">
        <svg viewBox="0 0 24 24" width="48" height="48">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
        </svg>
      </div>
      <h2>Add a Device</h2>
      <p className="wizard-description">
        Connect to another device running Archivist to sync files between them.
        You'll need the other device's SPR (Signed Peer Record) or multiaddr.
      </p>

      <div className="input-section">
        <label htmlFor="peer-address">Peer Address</label>
        <textarea
          id="peer-address"
          value={peerAddress}
          onChange={(e) => setPeerAddress(e.target.value)}
          placeholder="Paste SPR (spr:...) or multiaddr (/ip4/...)"
          rows={3}
        />
        <p className="input-hint">
          Get this from the other device: Devices → Copy SPR
        </p>
      </div>

      {error && (
        <div className="wizard-error">
          {error}
        </div>
      )}

      <div className="wizard-actions">
        <button className="secondary" onClick={() => navigate('/devices')}>
          Cancel
        </button>
        <button
          className="primary"
          onClick={handleConnect}
          disabled={!peerAddress.trim()}
        >
          Connect
        </button>
      </div>
    </div>
  );

  const renderConnecting = () => (
    <div className="wizard-step">
      <div className="wizard-icon connecting">
        <div className="spinner" />
      </div>
      <h2>Connecting...</h2>
      <p className="wizard-description">
        Establishing connection to the peer. This may take a moment.
      </p>
      <div className="connecting-address">
        <code>{peerAddress.length > 60 ? peerAddress.slice(0, 60) + '...' : peerAddress}</code>
      </div>
    </div>
  );

  const renderSuccess = () => (
    <div className="wizard-step">
      <div className="wizard-icon success">
        <svg viewBox="0 0 24 24" width="48" height="48">
          <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M8 12l3 3 5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h2>Device Connected!</h2>
      <p className="wizard-description">
        You're now connected to the other device. You can sync files between your devices.
      </p>
      {connectedPeerId && (
        <div className="connected-peer-info">
          <span className="peer-label">Peer ID:</span>
          <code>{connectedPeerId.slice(0, 20)}...{connectedPeerId.slice(-8)}</code>
        </div>
      )}
      <div className="wizard-actions">
        <button className="primary" onClick={handleDone}>
          Done
        </button>
      </div>
    </div>
  );

  const renderError = () => (
    <div className="wizard-step">
      <div className="wizard-icon error">
        <svg viewBox="0 0 24 24" width="48" height="48">
          <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M15 9l-6 6M9 9l6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
      <h2>Connection Failed</h2>
      <p className="wizard-description">
        Unable to connect to the peer. Please check the address and try again.
      </p>
      {error && (
        <div className="wizard-error">
          {error}
        </div>
      )}
      <div className="wizard-actions">
        <button className="secondary" onClick={() => navigate('/devices')}>
          Cancel
        </button>
        <button className="primary" onClick={handleRetry}>
          Try Again
        </button>
      </div>
    </div>
  );

  return (
    <div className="add-device-page">
      <div className="wizard-container">
        {step === 'input' && renderInput()}
        {step === 'connecting' && renderConnecting()}
        {step === 'success' && renderSuccess()}
        {step === 'error' && renderError()}
      </div>
    </div>
  );
}

export default AddDevice;
