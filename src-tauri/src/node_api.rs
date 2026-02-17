//! HTTP client for communicating with the archivist-node sidecar
//!
//! Based on the archivist-node OpenAPI spec, this module provides
//! a typed interface to the node's REST API.

use crate::error::{ArchivistError, Result};
use futures::StreamExt;
use reqwest::{header, Client};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::Duration;
use tokio::fs::File;
use tokio::io::AsyncWriteExt;
use tokio_util::io::ReaderStream;

/// Response from /api/archivist/v1/debug/info
/// Matches archivist-node v0.2.0 API format
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeInfo {
    /// Peer ID (e.g., "16Uiu2HAmXYZ...")
    pub id: String,
    /// Network addresses
    #[serde(default)]
    pub addrs: Vec<String>,
    /// Repository path
    #[serde(default)]
    pub repo: Option<String>,
    /// Signed Peer Record
    #[serde(default)]
    pub spr: Option<String>,
    /// Announce addresses
    #[serde(default, rename = "announceAddresses")]
    pub announce_addresses: Vec<String>,
    /// Ethereum address
    #[serde(default, rename = "ethAddress")]
    pub eth_address: Option<String>,
    /// Archivist version info
    #[serde(default)]
    pub archivist: Option<ArchivistInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchivistInfo {
    pub version: String,
    #[serde(default)]
    pub revision: Option<String>,
    #[serde(default)]
    pub contracts: Option<String>,
}

/// Response from GET /api/archivist/v1/space
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpaceInfo {
    pub total_blocks: u64,
    pub quota_max_bytes: u64,
    pub quota_used_bytes: u64,
    pub quota_reserved_bytes: u64,
}

/// Response from POST /api/archivist/v1/data (upload)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadResponse {
    pub cid: String,
}

/// Response from GET /api/archivist/v1/data (list local data)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataListResponse {
    pub content: Vec<DataItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataItem {
    pub cid: String,
    #[serde(default)]
    pub manifest: Option<ManifestInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestInfo {
    #[serde(default)]
    pub filename: Option<String>,
    #[serde(default)]
    pub mimetype: Option<String>,
    #[serde(default)]
    pub dataset_size: Option<u64>,
    #[serde(default)]
    pub protected: Option<bool>,
}

/// Peer information from /api/archivist/v1/peers
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerInfo {
    pub peer_id: String,
    #[serde(default)]
    pub addresses: Vec<String>,
}

// ── Marketplace / Storage types ──────────────────────────────────────────────

/// Storage ask parameters in a storage request
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageAsk {
    pub slots: u64,
    #[serde(default)]
    pub slot_size: u64,
    pub duration: u64,
    #[serde(default)]
    pub proof_probability: String,
    #[serde(default, rename = "pricePerBytePerSecond")]
    pub price_per_byte_per_second: String,
    #[serde(default, rename = "collateralPerByte")]
    pub collateral_per_byte: String,
    #[serde(default)]
    pub max_slot_loss: u64,
}

/// Storage content reference
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageContent {
    pub cid: String,
    #[serde(default)]
    pub merkle_root: String,
}

/// A full storage request
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageRequest {
    #[serde(default)]
    pub client: String,
    pub ask: StorageAsk,
    pub content: StorageContent,
    #[serde(default)]
    pub expiry: String,
    #[serde(default)]
    pub nonce: String,
}

/// A provider's active sales slot
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SalesSlot {
    pub request: StorageRequest,
    #[serde(default)]
    pub slot_index: u64,
}

/// Provider availability offer
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Availability {
    pub id: String,
    #[serde(default)]
    pub total_size: String,
    #[serde(default)]
    pub free_size: String,
    #[serde(default)]
    pub duration: String,
    #[serde(default)]
    pub min_price: String,
    #[serde(default)]
    pub max_collateral: String,
}

/// Request body for creating an availability offer
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailabilityRequest {
    pub total_size: String,
    pub duration: String,
    pub min_price: String,
    pub max_collateral: String,
}

/// Request body for creating a storage request
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageRequestParams {
    pub duration: String,
    #[serde(rename = "pricePerBytePerSecond")]
    pub price_per_byte_per_second: String,
    #[serde(rename = "collateralPerByte")]
    pub collateral_per_byte: String,
    pub slots: u64,
    #[serde(default)]
    pub slot_size: u64,
    #[serde(default)]
    pub max_slot_loss: u64,
    #[serde(default)]
    pub expiry: u64,
}

/// A client's storage purchase
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Purchase {
    pub state: String,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub request: Option<StorageRequest>,
    #[serde(default)]
    pub request_id: String,
}

// ── HTTP Client ─────────────────────────────────────────────────────────────

/// HTTP client for the archivist-node API
#[derive(Clone)]
pub struct NodeApiClient {
    client: Client,
    base_url: String,
}

impl NodeApiClient {
    /// Create a new API client
    pub fn new(api_port: u16) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .expect("Failed to create HTTP client");

        Self {
            client,
            base_url: format!("http://127.0.0.1:{}", api_port),
        }
    }

    /// Update the API port (used when node config changes)
    pub fn set_port(&mut self, port: u16) {
        self.base_url = format!("http://127.0.0.1:{}", port);
    }

    /// Get node debug info
    pub async fn get_info(&self) -> Result<NodeInfo> {
        let url = format!("{}/api/archivist/v1/debug/info", self.base_url);

        let response =
            self.client.get(&url).send().await.map_err(|e| {
                ArchivistError::ApiError(format!("Failed to connect to node: {}", e))
            })?;

        if !response.status().is_success() {
            return Err(ArchivistError::ApiError(format!(
                "Node API error: HTTP {}",
                response.status()
            )));
        }

        response
            .json::<NodeInfo>()
            .await
            .map_err(|e| ArchivistError::ApiError(format!("Failed to parse node info: {}", e)))
    }

    /// Check if node is healthy (simple ping)
    pub async fn health_check(&self) -> Result<bool> {
        let url = format!("{}/api/archivist/v1/debug/info", self.base_url);

        match self
            .client
            .get(&url)
            .timeout(Duration::from_secs(5))
            .send()
            .await
        {
            Ok(response) => Ok(response.status().is_success()),
            Err(_) => Ok(false),
        }
    }

    /// List local data (CIDs stored on this node)
    pub async fn list_data(&self) -> Result<DataListResponse> {
        let url = format!("{}/api/archivist/v1/data", self.base_url);

        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| ArchivistError::ApiError(format!("Failed to list data: {}", e)))?;

        if !response.status().is_success() {
            return Err(ArchivistError::ApiError(format!(
                "Failed to list data: HTTP {}",
                response.status()
            )));
        }

        response
            .json::<DataListResponse>()
            .await
            .map_err(|e| ArchivistError::ApiError(format!("Failed to parse data list: {}", e)))
    }

    /// Get file info by CID (looks up in local data list)
    /// Returns the manifest info if the file exists locally
    pub async fn get_file_info(&self, cid: &str) -> Result<Option<ManifestInfo>> {
        let data = self.list_data().await?;

        for item in data.content {
            if item.cid == cid {
                return Ok(item.manifest);
            }
        }

        Ok(None)
    }

    /// Upload a file to the node using streaming (constant memory usage).
    ///
    /// The archivist-node API expects raw binary data with:
    /// - Content-Type header set to the file's MIME type
    /// - Content-Disposition header with the filename
    pub async fn upload_file(&self, file_path: &Path) -> Result<UploadResponse> {
        self.upload_file_with_progress(file_path, None).await
    }

    /// Upload a file to the node with optional progress reporting via Tauri events.
    ///
    /// Streams the file to avoid buffering the entire file in RAM.
    /// If `app_handle` is provided, emits `upload-progress` events.
    pub async fn upload_file_with_progress(
        &self,
        file_path: &Path,
        app_handle: Option<&tauri::AppHandle>,
    ) -> Result<UploadResponse> {
        let url = format!("{}/api/archivist/v1/data", self.base_url);

        let file = File::open(file_path).await.map_err(|e| {
            ArchivistError::FileOperationFailed(format!("Failed to open file: {}", e))
        })?;

        let file_meta = file.metadata().await.map_err(|e| {
            ArchivistError::FileOperationFailed(format!("Failed to read file metadata: {}", e))
        })?;
        let file_size = file_meta.len();

        let filename = file_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "file".to_string());

        // Determine MIME type
        let mime_type = mime_guess::from_path(file_path)
            .first()
            .map(|m| m.to_string())
            .unwrap_or_else(|| "application/octet-stream".to_string());

        // Build Content-Disposition header for filename
        let content_disposition = format!("attachment; filename=\"{}\"", filename);

        // Stream the file instead of reading it all into memory
        let reader_stream = ReaderStream::new(file);

        // Wrap with progress tracking if app_handle is provided
        let body = if let Some(handle) = app_handle {
            use tauri::Emitter;
            let handle = handle.clone();
            let fname = filename.clone();
            let total = file_size;
            let bytes_sent = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
            let last_reported = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));

            let progress_stream = reader_stream.map(move |chunk| {
                if let Ok(ref data) = chunk {
                    let sent = bytes_sent
                        .fetch_add(data.len() as u64, std::sync::atomic::Ordering::Relaxed)
                        + data.len() as u64;
                    let percent = if total > 0 {
                        (sent as f64 / total as f64 * 100.0) as u64
                    } else {
                        0
                    };

                    // Report every 1% or every 1MB, whichever is less frequent
                    let last = last_reported.load(std::sync::atomic::Ordering::Relaxed);
                    let mb_threshold = 1_048_576u64; // 1MB
                    if percent > last || sent.saturating_sub(last * total / 100) > mb_threshold {
                        last_reported.store(percent, std::sync::atomic::Ordering::Relaxed);
                        let _ = handle.emit(
                            "upload-progress",
                            serde_json::json!({
                                "filename": fname,
                                "bytesSent": sent,
                                "totalBytes": total,
                                "percent": percent
                            }),
                        );
                    }
                }
                chunk
            });

            reqwest::Body::wrap_stream(progress_stream)
        } else {
            reqwest::Body::wrap_stream(reader_stream)
        };

        // Dynamic timeout: at least 300s, or file_size / 10MB/s
        let timeout_secs = std::cmp::max(300, file_size / (10 * 1024 * 1024));

        let response = self
            .client
            .post(&url)
            .header(header::CONTENT_TYPE, &mime_type)
            .header(header::CONTENT_DISPOSITION, &content_disposition)
            .header(header::CONTENT_LENGTH, file_size)
            .body(body)
            .timeout(Duration::from_secs(timeout_secs))
            .send()
            .await
            .map_err(|e| ArchivistError::ApiError(format!("Upload failed: {}", e)))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(ArchivistError::ApiError(format!(
                "Upload failed: HTTP {} - {}",
                status, body
            )));
        }

        // archivist-node returns the CID as plain text, not JSON
        let cid = response.text().await.map_err(|e| {
            ArchivistError::ApiError(format!("Failed to read upload response: {}", e))
        })?;

        Ok(UploadResponse {
            cid: cid.trim().to_string(),
        })
    }

    /// Download a file by CID into memory (from local storage).
    /// Use `download_file_to_path` for large files to avoid memory issues.
    pub async fn download_file(&self, cid: &str) -> Result<Vec<u8>> {
        let url = format!("{}/api/archivist/v1/data/{}", self.base_url, cid);

        let response = self
            .client
            .get(&url)
            .timeout(Duration::from_secs(300))
            .send()
            .await
            .map_err(|e| ArchivistError::ApiError(format!("Download failed: {}", e)))?;

        if !response.status().is_success() {
            return Err(ArchivistError::ApiError(format!(
                "Download failed: HTTP {}",
                response.status()
            )));
        }

        response
            .bytes()
            .await
            .map(|b| b.to_vec())
            .map_err(|e| ArchivistError::ApiError(format!("Failed to read download: {}", e)))
    }

    /// Download a file by CID directly to a file path using streaming (constant memory).
    pub async fn download_file_to_path(&self, cid: &str, dest: &Path) -> Result<()> {
        let url = format!("{}/api/archivist/v1/data/{}", self.base_url, cid);

        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| ArchivistError::ApiError(format!("Download failed: {}", e)))?;

        if !response.status().is_success() {
            return Err(ArchivistError::ApiError(format!(
                "Download failed: HTTP {}",
                response.status()
            )));
        }

        let mut file = File::create(dest).await.map_err(|e| {
            ArchivistError::FileOperationFailed(format!("Failed to create file: {}", e))
        })?;

        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let data = chunk.map_err(|e| {
                ArchivistError::ApiError(format!("Failed to read download stream: {}", e))
            })?;
            file.write_all(&data).await.map_err(|e| {
                ArchivistError::FileOperationFailed(format!("Failed to write to file: {}", e))
            })?;
        }

        file.flush().await.map_err(|e| {
            ArchivistError::FileOperationFailed(format!("Failed to flush file: {}", e))
        })?;

        Ok(())
    }

    /// Trigger the sidecar to fetch a CID from the P2P network.
    /// Does NOT download the file content — just tells the sidecar to store it locally.
    pub async fn request_network_download(&self, cid: &str) -> Result<()> {
        let url = format!("{}/api/archivist/v1/data/{}/network", self.base_url, cid);

        let response = self
            .client
            .post(&url)
            .timeout(Duration::from_secs(600)) // 10 min for network downloads
            .send()
            .await
            .map_err(|e| {
                ArchivistError::ApiError(format!("Network download request failed: {}", e))
            })?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(ArchivistError::ApiError(format!(
                "Network download failed: HTTP {} - {}",
                status, body
            )));
        }

        Ok(())
    }

    /// Get the Signed Peer Record for this node
    pub async fn get_spr(&self) -> Result<String> {
        let url = format!("{}/api/archivist/v1/spr", self.base_url);

        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| ArchivistError::ApiError(format!("Failed to get SPR: {}", e)))?;

        if !response.status().is_success() {
            return Err(ArchivistError::ApiError(format!(
                "Failed to get SPR: HTTP {}",
                response.status()
            )));
        }

        response
            .text()
            .await
            .map_err(|e| ArchivistError::ApiError(format!("Failed to read SPR: {}", e)))
    }

    /// List connected peers
    pub async fn list_peers(&self) -> Result<Vec<PeerInfo>> {
        let url = format!("{}/api/archivist/v1/peers", self.base_url);

        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| ArchivistError::ApiError(format!("Failed to list peers: {}", e)))?;

        if !response.status().is_success() {
            return Err(ArchivistError::ApiError(format!(
                "Failed to list peers: HTTP {}",
                response.status()
            )));
        }

        response
            .json::<Vec<PeerInfo>>()
            .await
            .map_err(|e| ArchivistError::ApiError(format!("Failed to parse peers: {}", e)))
    }

    /// Get storage space information
    pub async fn get_space(&self) -> Result<SpaceInfo> {
        let url = format!("{}/api/archivist/v1/space", self.base_url);

        let response = self
            .client
            .get(&url)
            .timeout(Duration::from_secs(5))
            .send()
            .await
            .map_err(|e| ArchivistError::ApiError(format!("Failed to get space info: {}", e)))?;

        if !response.status().is_success() {
            return Err(ArchivistError::ApiError(format!(
                "Failed to get space info: HTTP {}",
                response.status()
            )));
        }

        response
            .json::<SpaceInfo>()
            .await
            .map_err(|e| ArchivistError::ApiError(format!("Failed to parse space info: {}", e)))
    }

    /// Connect to a peer by multiaddr
    ///
    /// Note: The archivist-node API uses GET for the connect endpoint.
    /// If addrs is provided, it will be used to dial the peer directly.
    /// Otherwise, peer discovery will be used to find the peer.
    pub async fn connect_peer(&self, peer_id: &str, multiaddr: &str) -> Result<()> {
        let url = format!(
            "{}/api/archivist/v1/connect/{}?addrs={}",
            self.base_url,
            peer_id,
            urlencoding::encode(multiaddr)
        );

        log::info!("Sending GET request to: {}", url);

        let response = self
            .client
            .get(&url)
            .timeout(Duration::from_secs(30)) // 30 second timeout for peer connection
            .send()
            .await
            .map_err(|e| {
                log::error!("HTTP request failed: {}", e);
                if e.is_timeout() {
                    ArchivistError::ApiError(
                        "Connection attempt timed out after 30 seconds. The peer may be unreachable or the node may be busy.".to_string()
                    )
                } else {
                    ArchivistError::ApiError(format!("Failed to connect to peer: {}", e))
                }
            })?;

        log::info!("Received response with status: {}", response.status());

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(ArchivistError::ApiError(format!(
                "Failed to connect to peer: HTTP {} - {}",
                status, body
            )));
        }

        Ok(())
    }

    /// Delete a file by CID from the node's storage
    pub async fn delete_file(&self, cid: &str) -> Result<()> {
        let url = format!("{}/api/archivist/v1/data/{}", self.base_url, cid);

        let response = self
            .client
            .delete(&url)
            .timeout(Duration::from_secs(30))
            .send()
            .await
            .map_err(|e| ArchivistError::ApiError(format!("Delete failed: {}", e)))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(ArchivistError::ApiError(format!(
                "Delete failed: HTTP {} - {}",
                status, body
            )));
        }

        Ok(())
    }

    /// Create a storage request for a CID (simple version — just triggers network fetch)
    pub async fn request_storage(&self, cid: &str) -> Result<()> {
        let url = format!("{}/api/archivist/v1/storage/request/{}", self.base_url, cid);

        let response = self
            .client
            .post(&url)
            .timeout(Duration::from_secs(60))
            .send()
            .await
            .map_err(|e| ArchivistError::ApiError(format!("Storage request failed: {}", e)))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(ArchivistError::ApiError(format!(
                "Storage request failed: HTTP {} - {}",
                status, body
            )));
        }

        log::info!("Storage request created for CID: {}", cid);
        Ok(())
    }

    // ── Marketplace API methods ─────────────────────────────────────────

    /// List provider's active sales slots
    pub async fn get_sales_slots(&self) -> Result<Vec<SalesSlot>> {
        let url = format!("{}/api/archivist/v1/sales/slots", self.base_url);

        let response =
            self.client.get(&url).send().await.map_err(|e| {
                ArchivistError::ApiError(format!("Failed to get sales slots: {}", e))
            })?;

        if !response.status().is_success() {
            return Err(ArchivistError::ApiError(format!(
                "Failed to get sales slots: HTTP {}",
                response.status()
            )));
        }

        response
            .json::<Vec<SalesSlot>>()
            .await
            .map_err(|e| ArchivistError::ApiError(format!("Failed to parse sales slots: {}", e)))
    }

    /// Get a specific sales slot by ID
    pub async fn get_sales_slot(&self, slot_id: &str) -> Result<SalesSlot> {
        let url = format!("{}/api/archivist/v1/sales/slots/{}", self.base_url, slot_id);

        let response =
            self.client.get(&url).send().await.map_err(|e| {
                ArchivistError::ApiError(format!("Failed to get sales slot: {}", e))
            })?;

        if !response.status().is_success() {
            return Err(ArchivistError::ApiError(format!(
                "Failed to get sales slot: HTTP {}",
                response.status()
            )));
        }

        response
            .json::<SalesSlot>()
            .await
            .map_err(|e| ArchivistError::ApiError(format!("Failed to parse sales slot: {}", e)))
    }

    /// Get provider's availability offers
    pub async fn get_availability(&self) -> Result<Vec<Availability>> {
        let url = format!("{}/api/archivist/v1/sales/availability", self.base_url);

        let response =
            self.client.get(&url).send().await.map_err(|e| {
                ArchivistError::ApiError(format!("Failed to get availability: {}", e))
            })?;

        if !response.status().is_success() {
            return Err(ArchivistError::ApiError(format!(
                "Failed to get availability: HTTP {}",
                response.status()
            )));
        }

        response
            .json::<Vec<Availability>>()
            .await
            .map_err(|e| ArchivistError::ApiError(format!("Failed to parse availability: {}", e)))
    }

    /// Create a new availability offer (provider)
    pub async fn post_availability(&self, avail: &AvailabilityRequest) -> Result<Availability> {
        let url = format!("{}/api/archivist/v1/sales/availability", self.base_url);

        let response = self
            .client
            .post(&url)
            .json(avail)
            .send()
            .await
            .map_err(|e| ArchivistError::ApiError(format!("Failed to post availability: {}", e)))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(ArchivistError::ApiError(format!(
                "Failed to post availability: HTTP {} - {}",
                status, body
            )));
        }

        response.json::<Availability>().await.map_err(|e| {
            ArchivistError::ApiError(format!("Failed to parse availability response: {}", e))
        })
    }

    /// Create a storage request with full marketplace parameters
    pub async fn create_storage_request(
        &self,
        cid: &str,
        params: &StorageRequestParams,
    ) -> Result<Purchase> {
        let url = format!("{}/api/archivist/v1/storage/request/{}", self.base_url, cid);

        let response = self
            .client
            .post(&url)
            .json(params)
            .timeout(Duration::from_secs(60))
            .send()
            .await
            .map_err(|e| ArchivistError::ApiError(format!("Storage request failed: {}", e)))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(ArchivistError::ApiError(format!(
                "Storage request failed: HTTP {} - {}",
                status, body
            )));
        }

        response.json::<Purchase>().await.map_err(|e| {
            ArchivistError::ApiError(format!("Failed to parse purchase response: {}", e))
        })
    }

    /// List client's storage purchases
    pub async fn get_purchases(&self) -> Result<Vec<Purchase>> {
        let url = format!("{}/api/archivist/v1/storage/purchases", self.base_url);

        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| ArchivistError::ApiError(format!("Failed to get purchases: {}", e)))?;

        if !response.status().is_success() {
            return Err(ArchivistError::ApiError(format!(
                "Failed to get purchases: HTTP {}",
                response.status()
            )));
        }

        response
            .json::<Vec<Purchase>>()
            .await
            .map_err(|e| ArchivistError::ApiError(format!("Failed to parse purchases: {}", e)))
    }

    /// Get a specific purchase by ID
    pub async fn get_purchase(&self, id: &str) -> Result<Purchase> {
        let url = format!(
            "{}/api/archivist/v1/storage/purchases/{}",
            self.base_url, id
        );

        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| ArchivistError::ApiError(format!("Failed to get purchase: {}", e)))?;

        if !response.status().is_success() {
            return Err(ArchivistError::ApiError(format!(
                "Failed to get purchase: HTTP {}",
                response.status()
            )));
        }

        response
            .json::<Purchase>()
            .await
            .map_err(|e| ArchivistError::ApiError(format!("Failed to parse purchase: {}", e)))
    }
}

impl Default for NodeApiClient {
    fn default() -> Self {
        Self::new(8080)
    }
}
