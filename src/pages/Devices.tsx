import { useState } from 'react';
import { useNode } from '../hooks/useNode';
import { usePeers, PeerInfo } from '../hooks/usePeers';
import { Link } from 'react-router-dom';
import '../styles/Devices.css';

function Devices() {
  const { status, isRunning } = useNode();
  const {
    peerList,
    loading,
    connectPeer,
    disconnectPeer,
    removePeer,
    refreshPeers
  } = usePeers();
  const [copied, setCopied] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleDisconnect = async (peerId: string) => {
    setActionInProgress(`disconnect-${peerId}`);
    try {
      await disconnectPeer(peerId);
    } catch (err) {
      console.error('Failed to disconnect:', err);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleReconnect = async (peer: PeerInfo) => {
    const address = peer.addresses[0] || peer.id;
    setActionInProgress(`reconnect-${peer.id}`);
    try {
      await connectPeer(address);
    } catch (err) {
      console.error('Failed to reconnect:', err);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleRemove = async (peerId: string) => {
    setActionInProgress(`remove-${peerId}`);
    try {
      await removePeer(peerId);
    } catch (err) {
      console.error('Failed to remove:', err);
    } finally {
      setActionInProgress(null);
    }
  };

  // Get connected and saved (offline) peers
  const connectedPeers = peerList.peers.filter((p: PeerInfo) => p.connected);
  const savedPeers = peerList.peers.filter((p: PeerInfo) => !p.connected);

  return (
    <div className="page devices-page">
      <div className="page-header">
        <h2>Devices</h2>
        <div className="header-actions">
          <button
            className="btn-secondary"
            onClick={refreshPeers}
            disabled={loading}
          >
            Refresh
          </button>
          <Link to="/devices/add" className="btn-primary">
            Add Device
          </Link>
        </div>
      </div>

      {/* This Device */}
      <section className="device-section">
        <h3>This Device</h3>
        {isRunning && status ? (
          <div className="device-card this-device">
            <div className="device-icon">
              <svg viewBox="0 0 24 24" width="32" height="32">
                <rect x="2" y="3" width="20" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
                <path d="M8 21h8M12 17v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div className="device-info">
              <div className="device-name">
                {status.peerId ? `${status.peerId.slice(0, 8)}...${status.peerId.slice(-6)}` : 'Local Node'}
                <span className="device-badge online">Online</span>
              </div>
              <div className="device-meta">
                <span>{formatBytes(status.storageUsedBytes)} / {formatBytes(status.storageUsedBytes + status.storageAvailableBytes)}</span>
              </div>
            </div>
            <div className="device-actions">
              {status.peerId && (
                <button
                  className="btn-small"
                  onClick={() => copyToClipboard(status.peerId!, 'peerId')}
                >
                  {copied === 'peerId' ? 'Copied!' : 'Copy Peer ID'}
                </button>
              )}
              {status.spr && (
                <button
                  className="btn-small secondary"
                  onClick={() => copyToClipboard(status.spr!, 'spr')}
                >
                  {copied === 'spr' ? 'Copied!' : 'Copy SPR'}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="device-card offline">
            <div className="device-icon muted">
              <svg viewBox="0 0 24 24" width="32" height="32">
                <rect x="2" y="3" width="20" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
                <path d="M8 21h8M12 17v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div className="device-info">
              <div className="device-name">
                Local Node
                <span className="device-badge offline">Offline</span>
              </div>
              <div className="device-meta">
                <span>Node not running</span>
              </div>
            </div>
            <div className="device-actions">
              <Link to="/" className="btn-small">
                Go to Dashboard
              </Link>
            </div>
          </div>
        )}

        {/* Network Addresses */}
        {isRunning && status?.addresses && status.addresses.length > 0 && (
          <div className="device-addresses">
            <h4>Network Addresses</h4>
            <div className="address-list">
              {status.addresses.map((addr, i) => (
                <div key={i} className="address-item">
                  <code>{addr}</code>
                  <button
                    className="btn-icon"
                    onClick={() => copyToClipboard(addr, `addr-${i}`)}
                    title="Copy address"
                  >
                    {copied === `addr-${i}` ? (
                      <svg viewBox="0 0 24 24" width="16" height="16">
                        <path d="M5 12l5 5L20 7" stroke="currentColor" strokeWidth="2" fill="none" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" width="16" height="16">
                        <rect x="9" y="9" width="13" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
                        <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" fill="none" stroke="currentColor" strokeWidth="2" />
                      </svg>
                    )}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Connected Devices */}
      <section className="device-section">
        <h3>Connected Devices ({connectedPeers.length})</h3>
        {connectedPeers.length > 0 ? (
          <div className="device-list">
            {connectedPeers.map((peer: PeerInfo) => (
              <div key={peer.id} className="device-card peer">
                <div className="device-icon">
                  <svg viewBox="0 0 24 24" width="32" height="32">
                    <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
                    <circle cx="12" cy="12" r="3" fill="currentColor" />
                  </svg>
                </div>
                <div className="device-info">
                  <div className="device-name">
                    {peer.id.slice(0, 8)}...{peer.id.slice(-6)}
                    <span className="device-badge online">Connected</span>
                  </div>
                  <div className="device-meta">
                    {peer.addresses && peer.addresses.length > 0 && (
                      <span>{peer.addresses[0]}</span>
                    )}
                    {peer.latencyMs && (
                      <span className="latency">{peer.latencyMs}ms</span>
                    )}
                  </div>
                </div>
                <div className="device-actions">
                  <button
                    className="btn-small secondary"
                    onClick={() => copyToClipboard(peer.id, `peer-${peer.id}`)}
                  >
                    {copied === `peer-${peer.id}` ? 'Copied!' : 'Copy ID'}
                  </button>
                  <button
                    className="btn-small danger"
                    onClick={() => handleDisconnect(peer.id)}
                    disabled={actionInProgress === `disconnect-${peer.id}`}
                  >
                    {actionInProgress === `disconnect-${peer.id}` ? 'Disconnecting...' : 'Disconnect'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <p>No devices connected yet.</p>
            <Link to="/devices/add" className="btn-primary">
              Add Your First Device
            </Link>
          </div>
        )}
      </section>

      {/* Saved Devices (Offline) */}
      {savedPeers.length > 0 && (
        <section className="device-section">
          <h3>Saved Devices ({savedPeers.length})</h3>
          <div className="device-list">
            {savedPeers.map((peer: PeerInfo) => (
              <div key={peer.id} className="device-card peer offline">
                <div className="device-icon muted">
                  <svg viewBox="0 0 24 24" width="32" height="32">
                    <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
                    <circle cx="12" cy="12" r="3" fill="currentColor" />
                  </svg>
                </div>
                <div className="device-info">
                  <div className="device-name">
                    {peer.id.slice(0, 8)}...{peer.id.slice(-6)}
                    <span className="device-badge offline">Offline</span>
                  </div>
                  <div className="device-meta">
                    {peer.lastSeen && (
                      <span>Last seen: {new Date(peer.lastSeen).toLocaleDateString()}</span>
                    )}
                  </div>
                </div>
                <div className="device-actions">
                  <button
                    className="btn-small"
                    onClick={() => handleReconnect(peer)}
                    disabled={actionInProgress === `reconnect-${peer.id}` || peer.addresses.length === 0}
                  >
                    {actionInProgress === `reconnect-${peer.id}` ? 'Connecting...' : 'Reconnect'}
                  </button>
                  <button
                    className="btn-small danger"
                    onClick={() => handleRemove(peer.id)}
                    disabled={actionInProgress === `remove-${peer.id}`}
                  >
                    {actionInProgress === `remove-${peer.id}` ? 'Removing...' : 'Remove'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export default Devices;
