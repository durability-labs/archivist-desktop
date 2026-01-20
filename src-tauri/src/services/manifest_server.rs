//! Manifest Discovery Server
//!
//! Exposes a minimal HTTP API for backup peers to discover the latest manifest CIDs.
//! This allows Machine B to query Machine A for manifest information, then fetch
//! the actual data over the P2P network.
//!
//! Security: Only whitelisted IPs can access this endpoint.

use crate::error::{ArchivistError, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::net::IpAddr;
use std::sync::Arc;
use tokio::sync::RwLock;
use warp::Filter;

/// Information about a manifest for a watched folder
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestInfo {
    pub folder_id: String,
    pub folder_path: String,
    pub manifest_cid: String,
    pub sequence_number: u64,
    pub updated_at: String,
    pub file_count: u32,
    pub total_size_bytes: u64,
}

/// Response from the manifest discovery endpoint
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestDiscoveryResponse {
    pub peer_id: String,
    pub manifests: Vec<ManifestInfo>,
    pub timestamp: String,
}

/// Registry that tracks the latest manifest CID for each folder
#[derive(Debug, Clone, Default)]
pub struct ManifestRegistry {
    /// Map of folder_id -> ManifestInfo
    manifests: std::collections::HashMap<String, ManifestInfo>,
    /// This node's peer ID
    peer_id: Option<String>,
}

impl ManifestRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Set the peer ID for this node
    pub fn set_peer_id(&mut self, peer_id: String) {
        self.peer_id = Some(peer_id);
    }

    /// Register or update a manifest for a folder
    pub fn register_manifest(&mut self, info: ManifestInfo) {
        log::info!(
            "Registering manifest for folder {}: CID={}, seq={}",
            info.folder_id,
            info.manifest_cid,
            info.sequence_number
        );
        self.manifests.insert(info.folder_id.clone(), info);
    }

    /// Get all registered manifests
    pub fn get_all_manifests(&self) -> Vec<ManifestInfo> {
        self.manifests.values().cloned().collect()
    }

    /// Get manifest for a specific folder
    pub fn get_manifest(&self, folder_id: &str) -> Option<ManifestInfo> {
        self.manifests.get(folder_id).cloned()
    }

    /// Get the discovery response
    pub fn get_discovery_response(&self) -> ManifestDiscoveryResponse {
        ManifestDiscoveryResponse {
            peer_id: self.peer_id.clone().unwrap_or_else(|| "unknown".to_string()),
            manifests: self.get_all_manifests(),
            timestamp: chrono::Utc::now().to_rfc3339(),
        }
    }
}

/// Configuration for the manifest server
#[derive(Debug, Clone)]
pub struct ManifestServerConfig {
    /// Port to listen on (default: 8085)
    pub port: u16,
    /// Whether the server is enabled
    pub enabled: bool,
    /// Whitelisted IP addresses that can access the API
    pub allowed_ips: HashSet<IpAddr>,
}

impl Default for ManifestServerConfig {
    fn default() -> Self {
        Self {
            port: 8085,
            enabled: false,
            allowed_ips: HashSet::new(),
        }
    }
}

/// Manifest Discovery Server
pub struct ManifestServer {
    registry: Arc<RwLock<ManifestRegistry>>,
    config: Arc<RwLock<ManifestServerConfig>>,
    shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
}

impl ManifestServer {
    pub fn new(registry: Arc<RwLock<ManifestRegistry>>) -> Self {
        Self {
            registry,
            config: Arc::new(RwLock::new(ManifestServerConfig::default())),
            shutdown_tx: None,
        }
    }

    /// Update server configuration
    pub async fn update_config(&self, config: ManifestServerConfig) {
        let mut cfg = self.config.write().await;
        *cfg = config;
    }

    /// Add an allowed IP address
    pub async fn add_allowed_ip(&self, ip: IpAddr) {
        let mut cfg = self.config.write().await;
        cfg.allowed_ips.insert(ip);
        log::info!("Added allowed IP for manifest server: {}", ip);
    }

    /// Remove an allowed IP address
    pub async fn remove_allowed_ip(&self, ip: &IpAddr) {
        let mut cfg = self.config.write().await;
        cfg.allowed_ips.remove(ip);
        log::info!("Removed allowed IP from manifest server: {}", ip);
    }

    /// Check if an IP is allowed
    async fn is_ip_allowed(&self, ip: IpAddr) -> bool {
        let cfg = self.config.read().await;

        // If no IPs are whitelisted, deny all (secure by default)
        if cfg.allowed_ips.is_empty() {
            log::warn!("Manifest server request from {} denied: no IPs whitelisted", ip);
            return false;
        }

        let allowed = cfg.allowed_ips.contains(&ip);
        if !allowed {
            log::warn!("Manifest server request from {} denied: not in whitelist", ip);
        }
        allowed
    }

    /// Start the HTTP server
    pub async fn start(&mut self) -> Result<()> {
        let config = self.config.read().await;
        if !config.enabled {
            log::info!("Manifest server is disabled");
            return Ok(());
        }
        let port = config.port;
        drop(config);

        let registry = self.registry.clone();
        let config_for_filter = self.config.clone();

        // Create IP whitelist filter
        let ip_filter = warp::addr::remote()
            .and(warp::any().map(move || config_for_filter.clone()))
            .and_then(
                |addr: Option<std::net::SocketAddr>, config: Arc<RwLock<ManifestServerConfig>>| async move {
                    let ip = addr.map(|a| a.ip()).unwrap_or(IpAddr::from([0, 0, 0, 0]));
                    let cfg = config.read().await;

                    // If no IPs whitelisted, deny
                    if cfg.allowed_ips.is_empty() {
                        log::warn!("Manifest request from {} denied: no IPs whitelisted", ip);
                        return Err(warp::reject::custom(UnauthorizedError));
                    }

                    if !cfg.allowed_ips.contains(&ip) {
                        log::warn!("Manifest request from {} denied: not in whitelist", ip);
                        return Err(warp::reject::custom(UnauthorizedError));
                    }

                    Ok(())
                },
            )
            .untuple_one();

        // GET /manifests - Get all manifest CIDs
        let manifests_route = warp::path("manifests")
            .and(warp::get())
            .and(ip_filter.clone())
            .and(warp::any().map(move || registry.clone()))
            .and_then(handle_get_manifests);

        // Health check (no auth required)
        let health_route = warp::path("health")
            .and(warp::get())
            .map(|| warp::reply::json(&serde_json::json!({"status": "ok"})));

        let routes = manifests_route
            .or(health_route)
            .with(warp::log("manifest_server"));

        // Create shutdown channel
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.shutdown_tx = Some(tx);

        let (_, server) = warp::serve(routes)
            .bind_with_graceful_shutdown(([0, 0, 0, 0], port), async {
                rx.await.ok();
            });

        log::info!("Manifest discovery server starting on port {}", port);

        tokio::spawn(server);

        Ok(())
    }

    /// Stop the server
    pub fn stop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
            log::info!("Manifest discovery server stopped");
        }
    }
}

// Custom rejection for unauthorized access
#[derive(Debug)]
struct UnauthorizedError;
impl warp::reject::Reject for UnauthorizedError {}

async fn handle_get_manifests(
    registry: Arc<RwLock<ManifestRegistry>>,
) -> std::result::Result<impl warp::Reply, warp::Rejection> {
    let reg = registry.read().await;
    let response = reg.get_discovery_response();
    Ok(warp::reply::json(&response))
}

/// Client for querying a remote manifest server
pub struct ManifestClient {
    client: reqwest::Client,
}

impl ManifestClient {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                .build()
                .expect("Failed to create HTTP client"),
        }
    }

    /// Fetch manifests from a remote peer's manifest server
    pub async fn fetch_manifests(&self, host: &str, port: u16) -> Result<ManifestDiscoveryResponse> {
        let url = format!("http://{}:{}/manifests", host, port);

        log::info!("Fetching manifests from {}", url);

        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| ArchivistError::ApiError(format!("Failed to fetch manifests: {}", e)))?;

        if !response.status().is_success() {
            return Err(ArchivistError::ApiError(format!(
                "Manifest server returned error: HTTP {}",
                response.status()
            )));
        }

        response
            .json::<ManifestDiscoveryResponse>()
            .await
            .map_err(|e| ArchivistError::ApiError(format!("Failed to parse manifest response: {}", e)))
    }
}

impl Default for ManifestClient {
    fn default() -> Self {
        Self::new()
    }
}
