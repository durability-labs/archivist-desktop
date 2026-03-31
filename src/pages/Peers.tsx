import { useState } from 'react';
import { usePeers } from '../hooks/usePeers';
import SensitiveField from '../components/SensitiveField';

function Peers() {
  const {
    peerList,
    loading,
    error,
    connectPeer,
    disconnectPeer,
    removePeer,
    refreshPeers,
  } = usePeers();

  const [connectInput, setConnectInput] = useState('');

  const handleConnect = async () => {
    if (!connectInput.trim()) return;

    try {
      await connectPeer(connectInput.trim());
      setConnectInput('');
    } catch {
      // Error is handled by the hook
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const connectedPeers = peerList.peers.filter((p) => p.connected);
  const savedPeers = peerList.peers.filter((p) => !p.connected);

  return (
    <div className="page">
      <div className="page-header">
        <h2>Peers</h2>
        <button onClick={refreshPeers} disabled={loading}>
          Refresh
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* Local Node Info */}
      {peerList.localPeerId && (
        <div className="local-node-info">
          <h3>Your Node</h3>
          <div className="node-id">
            <span className="label">Peer ID:</span>
            <SensitiveField value={peerList.localPeerId!} copyable />
          </div>
          {peerList.localAddresses.length > 0 && (
            <div className="node-addresses">
              <span className="label">Share this multiaddr to connect:</span>
              <ul>
                {peerList.localAddresses.map((addr, i) => (
                  <li key={i}>
                    <code className="copyable" onClick={() => {
                      const fullAddr = `${addr}/p2p/${peerList.localPeerId}`;
                      navigator.clipboard.writeText(fullAddr);
                    }}>
                      {addr}/p2p/{peerList.localPeerId?.slice(0, 10)}...
                    </code>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Connect to Peer */}
      <div className="connect-peer">
        <h3>Connect to Peer</h3>
        <p className="help-text">
          Enter a multiaddr to connect: <code>/ip4/IP/tcp/PORT/p2p/PEER_ID</code>
        </p>
        <div className="input-group">
          <input
            type="text"
            placeholder="/ip4/192.168.1.100/tcp/8090/p2p/16Uiu2HAm..."
            value={connectInput}
            onChange={(e) => setConnectInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
          />
          <button onClick={handleConnect} disabled={loading || !connectInput.trim()}>
            Connect
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="peer-stats-grid">
        <div className="stat-card small">
          <h4>Connected</h4>
          <div className="stat-value">{peerList.stats.connectedPeers}</div>
        </div>
        <div className="stat-card small">
          <h4>Total Known</h4>
          <div className="stat-value">{peerList.stats.totalPeers}</div>
        </div>
        <div className="stat-card small">
          <h4>Sent</h4>
          <div className="stat-value">{formatBytes(peerList.stats.bytesSentTotal)}</div>
        </div>
        <div className="stat-card small">
          <h4>Received</h4>
          <div className="stat-value">{formatBytes(peerList.stats.bytesReceivedTotal)}</div>
        </div>
      </div>

      {/* Connected Peers */}
      <div className="peers-section">
        <h3>Connected Peers ({connectedPeers.length})</h3>
        {connectedPeers.length === 0 ? (
          <div className="empty-state">
            <p>No peers connected.</p>
            <p>Share your SPR with friends or enter their address to connect.</p>
          </div>
        ) : (
          <ul className="peer-list">
            {connectedPeers.map((peer) => (
              <li key={peer.id} className="peer-item connected">
                <div className="peer-info">
                  <span className="peer-id-display">
                    {peer.id.slice(0, 16)}...{peer.id.slice(-8)}
                  </span>
                  <span className="peer-addresses">
                    {peer.addresses.length} address{peer.addresses.length !== 1 ? 'es' : ''}
                  </span>
                  {peer.latencyMs && (
                    <span className="peer-latency">{peer.latencyMs}ms</span>
                  )}
                </div>
                <div className="peer-actions">
                  <button
                    className="small danger"
                    onClick={() => disconnectPeer(peer.id)}
                  >
                    Disconnect
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Saved/Known Peers */}
      {savedPeers.length > 0 && (
        <div className="peers-section">
          <h3>Saved Peers ({savedPeers.length})</h3>
          <ul className="peer-list">
            {savedPeers.map((peer) => (
              <li key={peer.id} className="peer-item offline">
                <div className="peer-info">
                  <span className="peer-id-display">
                    {peer.id.slice(0, 16)}...{peer.id.slice(-8)}
                  </span>
                  <span className="peer-status offline">Offline</span>
                </div>
                <div className="peer-actions">
                  <button
                    className="small"
                    onClick={() => connectPeer(peer.addresses[0] || peer.id)}
                    disabled={peer.addresses.length === 0}
                  >
                    Reconnect
                  </button>
                  <button
                    className="small danger"
                    onClick={() => removePeer(peer.id)}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default Peers;
