use crate::error::{ArchivistError, Result};
use crate::node_api::NodeApiClient;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

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

/// Saved peer for persistence and connection tracking
#[derive(Debug, Clone, Serialize, Deserialize)]
struct SavedPeer {
    peer_id: String,
    addresses: Vec<String>,
    nickname: Option<String>,
    added_at: DateTime<Utc>,
    /// Whether we successfully connected to this peer
    connected: bool,
    /// When the connection was established
    connected_at: Option<DateTime<Utc>>,
    /// Last time we successfully communicated with this peer
    last_seen: Option<DateTime<Utc>>,
}

impl PeerService {
    pub fn new() -> Self {
        Self {
            api_client: NodeApiClient::new(8080), // Default archivist-node API port
            saved_peers: Vec::new(),
        }
    }

    /// Set the API port (for config updates)
    #[allow(dead_code)]
    pub fn set_api_port(&mut self, port: u16) {
        self.api_client.set_port(port);
    }

    /// Get all peers (from node API + saved peers)
    ///
    /// Since the /peers endpoint doesn't exist in archivist-node v0.1.0,
    /// we track connection state locally based on successful connect_peer calls.
    pub async fn get_peers(&self) -> Result<PeerList> {
        // Get local node info
        let (local_peer_id, local_addresses) = match self.api_client.get_info().await {
            Ok(info) => {
                let peer_id = Some(info.id.clone());
                let addrs = info.addrs;
                (peer_id, addrs)
            }
            Err(_) => (None, Vec::new()),
        };

        // Get SPR for sharing
        let spr = self.api_client.get_spr().await.ok();

        // Build peer list from our locally tracked peers
        // Connection state is tracked when connect_peer succeeds
        let peers: Vec<PeerInfo> = self
            .saved_peers
            .iter()
            .map(|saved| PeerInfo {
                id: saved.peer_id.clone(),
                addresses: saved.addresses.clone(),
                connected: saved.connected,
                latency_ms: None,
                bytes_sent: 0,
                bytes_received: 0,
                connected_at: saved.connected_at,
                last_seen: saved.last_seen,
                agent_version: None,
            })
            .collect();

        let connected_count = peers.iter().filter(|p| p.connected).count() as u32;

        Ok(PeerList {
            stats: PeerStats {
                total_peers: peers.len() as u32,
                connected_peers: connected_count,
                bytes_sent_total: 0,
                bytes_received_total: 0,
            },
            peers,
            local_peer_id,
            local_addresses,
            spr,
        })
    }

    /// Connect to a peer by multiaddr string or SPR
    /// Format: /ip4/x.x.x.x/tcp/port/p2p/peerId
    /// Or: spr:CiUI...
    pub async fn connect_peer(&mut self, address: &str) -> Result<PeerInfo> {
        log::info!("connect_peer called with address: {}", address);

        // Parse input to extract peer ID
        let peer_id = self.extract_peer_id(address)?;
        log::info!("Extracted peer ID: {}", peer_id);

        // Determine the address to use for connection
        let connect_address = if address.starts_with("spr:") {
            // Extract addresses from SPR and use the first TCP address
            let addresses = self.extract_spr_addresses(address)?;
            addresses
                .into_iter()
                .find(|a| a.contains("/tcp/"))
                .ok_or_else(|| {
                    ArchivistError::PeerConnectionFailed("No TCP address found in SPR".to_string())
                })?
        } else if address.contains("/p2p/") {
            // Already a full multiaddr, extract the address part before /p2p/
            address.split("/p2p/").next().unwrap_or(address).to_string()
        } else {
            // Just a peer ID, try to connect without address (uses peer discovery)
            String::new()
        };

        log::info!(
            "Calling node API to connect to peer {} via address: {}",
            peer_id,
            connect_address
        );

        // Connect via node API
        self.api_client
            .connect_peer(&peer_id, &connect_address)
            .await?;

        log::info!("Connected to peer: {} via {}", peer_id, connect_address);

        // Save peer for future reconnection and track connection state
        let peer_addresses = if address.starts_with("spr:") {
            self.extract_spr_addresses(address)
                .unwrap_or_else(|_| vec![address.to_string()])
        } else {
            vec![address.to_string()]
        };

        let now = Utc::now();

        // Update existing peer or add new one
        if let Some(existing) = self.saved_peers.iter_mut().find(|p| p.peer_id == peer_id) {
            // Update existing peer's connection state
            existing.connected = true;
            existing.connected_at = Some(now);
            existing.last_seen = Some(now);
            // Update addresses if we have new ones
            if !peer_addresses.is_empty() {
                existing.addresses = peer_addresses.clone();
            }
        } else {
            // Add new peer
            self.saved_peers.push(SavedPeer {
                peer_id: peer_id.clone(),
                addresses: peer_addresses.clone(),
                nickname: None,
                added_at: now,
                connected: true,
                connected_at: Some(now),
                last_seen: Some(now),
            });
        }

        Ok(PeerInfo {
            id: peer_id,
            addresses: peer_addresses,
            connected: true,
            latency_ms: None,
            bytes_sent: 0,
            bytes_received: 0,
            connected_at: Some(now),
            last_seen: Some(now),
            agent_version: None,
        })
    }

    /// Disconnect from a peer
    pub async fn disconnect_peer(&mut self, peer_id: &str) -> Result<()> {
        log::info!("Disconnect requested for peer: {}", peer_id);

        // Mark the peer as disconnected in our local state
        if let Some(peer) = self.saved_peers.iter_mut().find(|p| p.peer_id == peer_id) {
            peer.connected = false;
            log::info!("Marked peer {} as disconnected", peer_id);
        }

        // Note: The node API may not support disconnect, so we just mark locally
        // In a real implementation, you'd also call an API endpoint

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

    /// Extract peer ID from multiaddr or SPR
    fn extract_peer_id(&self, address: &str) -> Result<String> {
        // Multiaddr format: /ip4/x.x.x.x/tcp/port/p2p/QmPeerId...
        // Or SPR format which we need to decode

        if address.contains("/p2p/") {
            let parts: Vec<&str> = address.split("/p2p/").collect();
            if parts.len() >= 2 {
                return Ok(parts[1].to_string());
            }
        }

        // If it looks like an SPR (starts with spr:), decode it to extract peer ID
        if address.starts_with("spr:") {
            return self.decode_spr_peer_id(address);
        }

        // If it's just a peer ID by itself (various libp2p formats)
        // - Qm... (legacy base58 CIDv0)
        // - 12D3... (base58 Ed25519)
        // - 16Uiu2HAm... (base58 secp256k1, used by archivist-node)
        if address.starts_with("Qm") || address.starts_with("12D3") || address.starts_with("16Uiu")
        {
            return Ok(address.to_string());
        }

        Err(ArchivistError::PeerConnectionFailed(
            "Invalid multiaddr format. Expected /ip4/.../p2p/PeerId or spr:...".to_string(),
        ))
    }

    /// Decode SPR (Signed Peer Record) to extract peer ID
    /// SPR format: spr:<base64-encoded-protobuf>
    ///
    /// The SPR protobuf structure starts with:
    /// - 0x0a 0x25 (field 1, length 37) - the protobuf-encoded public key
    /// - 0x08 0x02 (field 1 = 2, secp256k1 key type)
    /// - 0x12 0x21 (field 2, length 33) - the 33-byte compressed public key
    /// - 33 bytes of secp256k1 compressed public key
    ///
    /// The libp2p peer ID is the identity multihash of the protobuf-encoded public key:
    /// - 0x00 (identity hash function)
    /// - 0x25 (37 byte length)
    /// - bytes 2-39 from the SPR (the protobuf-encoded public key)
    fn decode_spr_peer_id(&self, spr: &str) -> Result<String> {
        let base64_data = spr.strip_prefix("spr:").ok_or_else(|| {
            ArchivistError::PeerConnectionFailed("Invalid SPR format".to_string())
        })?;

        let decoded = URL_SAFE_NO_PAD.decode(base64_data).map_err(|e| {
            ArchivistError::PeerConnectionFailed(format!("Failed to decode SPR: {}", e))
        })?;

        // Verify SPR has expected structure
        if decoded.len() < 40 {
            return Err(ArchivistError::PeerConnectionFailed(
                "SPR too short to contain peer ID".to_string(),
            ));
        }

        // Check for expected protobuf structure: 0x0a 0x25 0x08 0x02 0x12 0x21
        if decoded[0] != 0x0a || decoded[1] != 0x25 {
            return Err(ArchivistError::PeerConnectionFailed(
                "SPR has unexpected format (expected protobuf field 1 with 37 bytes)".to_string(),
            ));
        }

        // Extract the protobuf-encoded public key (bytes 2-39)
        // This is: 08 02 12 21 + 33-byte pubkey = 37 bytes
        let protobuf_pubkey = &decoded[2..39];

        // Build peer ID: identity multihash (0x00) + length (0x25 = 37) + protobuf pubkey
        let mut peer_id_bytes = vec![0x00, 0x25];
        peer_id_bytes.extend_from_slice(protobuf_pubkey);

        let peer_id = bs58::encode(&peer_id_bytes).into_string();

        // Verify it looks like a valid peer ID (starts with expected prefixes for secp256k1)
        if peer_id.starts_with("16Uiu") || peer_id.starts_with("12D3") {
            log::info!("Decoded peer ID from SPR: {}", peer_id);
            Ok(peer_id)
        } else {
            Err(ArchivistError::PeerConnectionFailed(format!(
                "Decoded peer ID has unexpected format: {}. Try using multiaddr format instead.",
                peer_id
            )))
        }
    }

    /// Extract addresses from SPR for connection
    /// Returns a multiaddr string that can be used with the connect API
    ///
    /// Note: The SPR (Signed Peer Record) from discv5 discovery typically contains
    /// UDP addresses for the discovery protocol, not TCP addresses for libp2p.
    /// This function extracts whatever addresses are present.
    fn extract_spr_addresses(&self, spr: &str) -> Result<Vec<String>> {
        let base64_data = spr.strip_prefix("spr:").ok_or_else(|| {
            ArchivistError::PeerConnectionFailed("Invalid SPR format".to_string())
        })?;

        let decoded = URL_SAFE_NO_PAD.decode(base64_data).map_err(|e| {
            ArchivistError::PeerConnectionFailed(format!("Failed to decode SPR: {}", e))
        })?;

        let mut tcp_addresses = Vec::new();
        let mut udp_addresses = Vec::new();

        // Look for IP addresses in the decoded data
        // IPv4 addresses are encoded as: 0x04 <4-bytes-ip>
        // Port is encoded as: 0x06 <2-bytes-port-big-endian> (for TCP)
        // or 0x91 0x02 <2-bytes-port> for UDP port encoding in multiaddr

        let mut i = 0;
        while i < decoded.len().saturating_sub(6) {
            // Look for IPv4 marker (0x04) followed by 4 bytes
            if decoded[i] == 0x04 && i + 5 < decoded.len() {
                let ip = format!(
                    "{}.{}.{}.{}",
                    decoded[i + 1],
                    decoded[i + 2],
                    decoded[i + 3],
                    decoded[i + 4]
                );

                // Skip localhost for remote connections
                let is_localhost = decoded[i + 1] == 127;

                // Look for port after IP (usually 0x06 for TCP or 0x91 0x02 for UDP)
                let port_offset = i + 5;
                if port_offset + 2 < decoded.len() {
                    if decoded[port_offset] == 0x06 {
                        // TCP port - preferred for connection
                        let port = u16::from_be_bytes([
                            decoded[port_offset + 1],
                            decoded[port_offset + 2],
                        ]);
                        let addr = format!("/ip4/{}/tcp/{}", ip, port);
                        if !is_localhost {
                            tcp_addresses.insert(0, addr); // Non-localhost first
                        } else {
                            tcp_addresses.push(addr);
                        }
                    } else if decoded[port_offset] == 0x91 && port_offset + 3 < decoded.len() {
                        // UDP port (varint encoded) - used for discovery, not direct connection
                        let port = u16::from_be_bytes([
                            decoded[port_offset + 2],
                            decoded[port_offset + 3],
                        ]);
                        let addr = format!("/ip4/{}/udp/{}", ip, port);
                        if !is_localhost {
                            udp_addresses.insert(0, addr);
                        } else {
                            udp_addresses.push(addr);
                        }
                    }
                }
            }
            i += 1;
        }

        // Prefer TCP addresses, fall back to UDP if no TCP available
        if !tcp_addresses.is_empty() {
            log::info!("Extracted TCP addresses from SPR: {:?}", tcp_addresses);
            return Ok(tcp_addresses);
        }

        if !udp_addresses.is_empty() {
            // UDP addresses are for discovery, not direct connection
            // Log a warning but return them anyway as the caller may want to try
            log::warn!(
                "SPR only contains UDP discovery addresses, not TCP addresses: {:?}. \
                 For direct connection, use multiaddr format instead: /ip4/<ip>/tcp/<port>/p2p/<peerId>",
                udp_addresses
            );
            return Err(ArchivistError::PeerConnectionFailed(
                "SPR only contains UDP discovery addresses. Please use multiaddr format: /ip4/<ip>/tcp/<port>/p2p/<peerId>".to_string(),
            ));
        }

        Err(ArchivistError::PeerConnectionFailed(
            "Could not extract addresses from SPR".to_string(),
        ))
    }

    /// Extract IP address from a multiaddr string (e.g., "/ip4/192.168.1.5/tcp/8070/p2p/16Uiu...")
    pub fn extract_ip_from_multiaddr(multiaddr: &str) -> Option<String> {
        let parts: Vec<&str> = multiaddr.split('/').collect();
        for (i, part) in parts.iter().enumerate() {
            if *part == "ip4" {
                if let Some(ip) = parts.get(i + 1) {
                    return Some(ip.to_string());
                }
            }
        }
        None
    }

    /// Get the chat-reachable IP address for a peer from saved peer addresses.
    pub fn get_peer_chat_address(&self, peer_id: &str) -> Option<String> {
        self.saved_peers
            .iter()
            .find(|p| p.peer_id == peer_id && p.connected)
            .and_then(|p| {
                p.addresses
                    .iter()
                    .find_map(|addr| Self::extract_ip_from_multiaddr(addr))
            })
    }

    /// Bulk lookup of chat addresses for multiple peers.
    pub fn get_peer_chat_addresses(
        &self,
        peer_ids: &[String],
    ) -> std::collections::HashMap<String, String> {
        let mut result = std::collections::HashMap::new();
        for pid in peer_ids {
            if let Some(addr) = self.get_peer_chat_address(pid) {
                result.insert(pid.clone(), addr);
            }
        }
        result
    }
}

impl Default for PeerService {
    fn default() -> Self {
        Self::new()
    }
}
