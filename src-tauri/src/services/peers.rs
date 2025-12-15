use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use crate::error::{ArchivistError, Result};
use crate::node_api::NodeApiClient;

/// Peer information for frontend display
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerInfo {
    pub id: String,
    pub addresses: Vec<String>,
    pub connected: bool,
    pub latency_ms: Option<u32>,
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub connected_at: Option<DateTime<Utc>>,
    pub last_seen: Option<DateTime<Utc>>,
    pub agent_version: Option<String>,
}

/// Aggregated peer statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerStats {
    pub total_peers: u32,
    pub connected_peers: u32,
    pub bytes_sent_total: u64,
    pub bytes_received_total: u64,
}

/// Response containing peers and stats
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerList {
    pub peers: Vec<PeerInfo>,
    pub stats: PeerStats,
    pub local_peer_id: Option<String>,
    pub local_addresses: Vec<String>,
    pub spr: Option<String>,
}

/// Peer service that communicates with node API
pub struct PeerService {
    /// API client for node communication
    api_client: NodeApiClient,
    /// Locally saved peers (for reconnection)
    saved_peers: Vec<SavedPeer>,
}

/// Saved peer for persistence
#[derive(Debug, Clone, Serialize, Deserialize)]
struct SavedPeer {
    peer_id: String,
    addresses: Vec<String>,
    nickname: Option<String>,
    added_at: DateTime<Utc>,
}

impl PeerService {
    pub fn new() -> Self {
        Self {
            api_client: NodeApiClient::new(5001),
            saved_peers: Vec::new(),
        }
    }

    /// Set the API port (for config updates)
    #[allow(dead_code)]
    pub fn set_api_port(&mut self, port: u16) {
        self.api_client.set_port(port);
    }

    /// Get all peers (from node API + saved peers)
    pub async fn get_peers(&self) -> Result<PeerList> {
        // Get connected peers from node
        let connected_peers = match self.api_client.list_peers().await {
            Ok(peers) => peers,
            Err(e) => {
                log::warn!("Failed to get peers from node: {}", e);
                Vec::new()
            }
        };

        // Get local node info
        let (local_peer_id, local_addresses) = match self.api_client.get_info().await {
            Ok(info) => {
                let peer_id = info.local_node.as_ref().map(|n| n.peer_id.clone());
                let addrs = info.local_node.map(|n| n.addrs).unwrap_or_default();
                (peer_id, addrs)
            }
            Err(_) => (None, Vec::new()),
        };

        // Get SPR for sharing
        let spr = self.api_client.get_spr().await.ok();

        // Convert to our PeerInfo format
        let mut peers: Vec<PeerInfo> = connected_peers
            .into_iter()
            .map(|p| PeerInfo {
                id: p.peer_id,
                addresses: p.addresses,
                connected: true,
                latency_ms: None, // Would need ping endpoint
                bytes_sent: 0,
                bytes_received: 0,
                connected_at: Some(Utc::now()),
                last_seen: Some(Utc::now()),
                agent_version: None,
            })
            .collect();

        // Add saved peers that aren't connected
        for saved in &self.saved_peers {
            if !peers.iter().any(|p| p.id == saved.peer_id) {
                peers.push(PeerInfo {
                    id: saved.peer_id.clone(),
                    addresses: saved.addresses.clone(),
                    connected: false,
                    latency_ms: None,
                    bytes_sent: 0,
                    bytes_received: 0,
                    connected_at: None,
                    last_seen: None,
                    agent_version: None,
                });
            }
        }

        let connected_count = peers.iter().filter(|p| p.connected).count() as u32;
        let bytes_sent: u64 = peers.iter().map(|p| p.bytes_sent).sum();
        let bytes_recv: u64 = peers.iter().map(|p| p.bytes_received).sum();

        Ok(PeerList {
            stats: PeerStats {
                total_peers: peers.len() as u32,
                connected_peers: connected_count,
                bytes_sent_total: bytes_sent,
                bytes_received_total: bytes_recv,
            },
            peers,
            local_peer_id,
            local_addresses,
            spr,
        })
    }

    /// Connect to a peer by multiaddr string
    /// Format: /ip4/x.x.x.x/tcp/port/p2p/peerId
    pub async fn connect_peer(&mut self, address: &str) -> Result<PeerInfo> {
        // Parse multiaddr to extract peer ID
        let peer_id = self.extract_peer_id(address)?;

        // Connect via node API
        self.api_client.connect_peer(&peer_id, address).await?;

        log::info!("Connected to peer: {}", peer_id);

        // Save peer for future reconnection
        if !self.saved_peers.iter().any(|p| p.peer_id == peer_id) {
            self.saved_peers.push(SavedPeer {
                peer_id: peer_id.clone(),
                addresses: vec![address.to_string()],
                nickname: None,
                added_at: Utc::now(),
            });
        }

        Ok(PeerInfo {
            id: peer_id,
            addresses: vec![address.to_string()],
            connected: true,
            latency_ms: None,
            bytes_sent: 0,
            bytes_received: 0,
            connected_at: Some(Utc::now()),
            last_seen: Some(Utc::now()),
            agent_version: None,
        })
    }

    /// Disconnect from a peer
    pub async fn disconnect_peer(&mut self, peer_id: &str) -> Result<()> {
        // Note: The node API may not support disconnect, so we just mark locally
        log::info!("Disconnect requested for peer: {}", peer_id);

        // For now, we don't have a disconnect endpoint, so just log it
        // In a real implementation, you'd call an API endpoint

        Ok(())
    }

    /// Remove a saved peer
    pub async fn remove_peer(&mut self, peer_id: &str) -> Result<()> {
        if let Some(pos) = self.saved_peers.iter().position(|p| p.peer_id == peer_id) {
            self.saved_peers.remove(pos);
            log::info!("Removed saved peer: {}", peer_id);
        }

        Ok(())
    }

    /// Check if node API is reachable
    #[allow(dead_code)]
    pub async fn check_connection(&self) -> bool {
        self.api_client.health_check().await.unwrap_or(false)
    }

    /// Extract peer ID from multiaddr
    fn extract_peer_id(&self, address: &str) -> Result<String> {
        // Multiaddr format: /ip4/x.x.x.x/tcp/port/p2p/QmPeerId...
        // Or SPR format which we'd need to decode

        if address.contains("/p2p/") {
            let parts: Vec<&str> = address.split("/p2p/").collect();
            if parts.len() >= 2 {
                return Ok(parts[1].to_string());
            }
        }

        // If it looks like an SPR (starts with spr:), try to extract peer ID
        if address.starts_with("spr:") {
            // SPR parsing would require additional logic
            // For now, use the whole thing as an identifier
            return Ok(address.to_string());
        }

        // If it's just a peer ID by itself
        if address.starts_with("Qm") || address.starts_with("12D3") {
            return Ok(address.to_string());
        }

        Err(ArchivistError::PeerConnectionFailed(
            "Invalid multiaddr format. Expected /ip4/.../p2p/PeerId".to_string()
        ))
    }
}

impl Default for PeerService {
    fn default() -> Self {
        Self::new()
    }
}
