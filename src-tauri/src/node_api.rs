//! HTTP client for communicating with the archivist-node sidecar
//!
//! Based on the archivist-node OpenAPI spec, this module provides
//! a typed interface to the node's REST API.

use crate::error::{ArchivistError, Result};
use futures::StreamExt;
use reqwest::{header, Client};
use serde::{Deserialize, Serialize};
use std::error::Error as StdError;
use std::path::Path;
use std::time::Duration;
use tokio::fs::File;
use tokio::io::AsyncWriteExt;
use tokio_util::io::ReaderStream;

/// Build a detailed error description from a reqwest error by walking the source chain.
///
/// `format!("{}", e)` on reqwest errors only shows the top-level message, losing the
/// actual root cause (connection refused, timed out, connection reset, etc.). This
/// function classifies the error and appends the full `.source()` chain.
fn describe_reqwest_error(e: &reqwest::Error) -> String {
    let mut desc = format!("{}", e);

    // Classify the error type
    let classification = if e.is_timeout() {
        "timed out"
    } else if e.is_connect() {
        "connection failed"
    } else if e.is_body() {
        "body error"
    } else if e.is_request() {
        "request error"
    } else if e.is_decode() {
        "decode error"
    } else {
        "unknown"
    };

    // Walk the source chain for the root cause
    let mut causes = Vec::new();
    let mut current: Option<&dyn StdError> = e.source();
    while let Some(cause) = current {
        causes.push(format!("{}", cause));
        current = cause.source();
    }

    if !causes.is_empty() {
        desc = format!("{} ({}: {})", desc, classification, causes.join(": "));
    } else {
        desc = format!("{} ({})", desc, classification);
    }

    desc
}

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
    /// Whether this is a verifiable erasure-coded copy created for a storage request.
    #[serde(default)]
    pub verifiable: Option<bool>,
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
    #[serde(default, deserialize_with = "deserialize_string_or_u64")]
    pub slots: u64,
    #[serde(default, deserialize_with = "deserialize_string_or_u64")]
    pub slot_size: u64,
    #[serde(deserialize_with = "deserialize_string_or_u64")]
    pub duration: u64,
    #[serde(default)]
    pub proof_probability: String,
    #[serde(default, rename = "pricePerBytePerSecond")]
    pub price_per_byte_per_second: String,
    #[serde(default, rename = "collateralPerByte")]
    pub collateral_per_byte: String,
    #[serde(default, deserialize_with = "deserialize_string_or_u64")]
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
    #[serde(default, deserialize_with = "deserialize_string_or_u64")]
    pub expiry: u64,
    #[serde(default)]
    pub nonce: String,
}

/// A provider's active sales slot
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SalesSlot {
    pub request: StorageRequest,
    #[serde(default, deserialize_with = "deserialize_string_or_u64")]
    pub slot_index: u64,
}

/// Deserialize a JSON value that may be a string or number into a u64.
/// The devnet sidecar returns some numeric fields as strings (e.g., "2592000").
fn deserialize_string_or_u64<'de, D>(deserializer: D) -> std::result::Result<u64, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    match value {
        serde_json::Value::Number(n) => n
            .as_u64()
            .ok_or_else(|| serde::de::Error::custom("expected u64")),
        serde_json::Value::String(s) => s
            .parse::<u64>()
            .map_err(|_| serde::de::Error::custom(format!("cannot parse '{}' as u64", s))),
        serde_json::Value::Null => Ok(0),
        other => Err(serde::de::Error::custom(format!(
            "expected number or string, got {}",
            other
        ))),
    }
}

/// Deserialize a JSON value that may be a number or string into a String.
/// The sidecar returns integers for some fields that could also be strings.
fn deserialize_number_or_string<'de, D>(deserializer: D) -> std::result::Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    match value {
        serde_json::Value::String(s) => Ok(s),
        serde_json::Value::Number(n) => Ok(n.to_string()),
        serde_json::Value::Null => Ok(String::new()),
        other => Ok(other.to_string()),
    }
}

fn deserialize_number_or_string_opt<'de, D>(
    deserializer: D,
) -> std::result::Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    match value {
        serde_json::Value::Null => Ok(None),
        serde_json::Value::String(s) => Ok(Some(s)),
        serde_json::Value::Number(n) => Ok(Some(n.to_string())),
        other => Ok(Some(other.to_string())),
    }
}

/// Provider availability offer
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Availability {
    pub id: String,
    #[serde(default, deserialize_with = "deserialize_number_or_string")]
    pub total_size: String,
    #[serde(default, deserialize_with = "deserialize_number_or_string")]
    pub free_size: String,
    #[serde(default, deserialize_with = "deserialize_number_or_string")]
    pub duration: String,
    #[serde(default, rename = "minPricePerBytePerSecond")]
    pub min_price_per_byte_per_second: String,
    #[serde(default, rename = "maxCollateralPerByte")]
    pub max_collateral_per_byte: Option<String>,
    #[serde(default)]
    pub total_collateral: String,
    #[serde(default)]
    pub total_remaining_collateral: Option<String>,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default, deserialize_with = "deserialize_number_or_string_opt")]
    pub until: Option<String>,
}

/// Request body for creating an availability offer
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailabilityRequest {
    pub total_size: String,
    pub duration: String,
    #[serde(rename = "minPricePerBytePerSecond")]
    pub min_price_per_byte_per_second: String,
    #[serde(rename = "maxCollateralPerByte")]
    pub max_collateral_per_byte: String,
    pub total_collateral: String,
}

/// Request body for creating a storage request
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageRequestParams {
    pub duration: String,
    pub proof_probability: String,
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
            if body.contains("Unable to store block") {
                return Err(ArchivistError::ApiError(
                    "Storage quota full. Increase 'Max Storage' in Settings or delete files, then restart the node.".to_string()
                ));
            }
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

    /// Download a file by CID directly to a file path with progress reporting via Tauri events.
    ///
    /// Reads `content-length` from the response and emits `download-progress` events
    /// as chunks are written to disk. If `app_handle` is `None`, behaves identically
    /// to `download_file_to_path`.
    pub async fn download_file_to_path_with_progress(
        &self,
        cid: &str,
        dest: &Path,
        app_handle: Option<&tauri::AppHandle>,
    ) -> Result<()> {
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

        let total_bytes = response.content_length();

        let mut file = File::create(dest).await.map_err(|e| {
            ArchivistError::FileOperationFailed(format!("Failed to create file: {}", e))
        })?;

        let mut stream = response.bytes_stream();
        let mut bytes_received: u64 = 0;
        let mut last_reported_percent: u64 = 0;

        while let Some(chunk) = stream.next().await {
            let data = chunk.map_err(|e| {
                ArchivistError::ApiError(format!("Failed to read download stream: {}", e))
            })?;
            file.write_all(&data).await.map_err(|e| {
                ArchivistError::FileOperationFailed(format!("Failed to write to file: {}", e))
            })?;

            bytes_received += data.len() as u64;

            if let Some(handle) = app_handle {
                use tauri::Emitter;
                let percent = total_bytes.map(|total| {
                    if total > 0 {
                        (bytes_received as f64 / total as f64 * 100.0) as u64
                    } else {
                        0
                    }
                });

                // Throttle: report every 1% or every 1MB
                let should_report = match percent {
                    Some(p) => p > last_reported_percent,
                    None => {
                        bytes_received.saturating_sub(last_reported_percent * 1_048_576)
                            >= 1_048_576
                    }
                };

                if should_report {
                    last_reported_percent = percent.unwrap_or(bytes_received / 1_048_576);
                    let _ = handle.emit(
                        "download-progress",
                        serde_json::json!({
                            "cid": cid,
                            "phase": "saving",
                            "bytesReceived": bytes_received,
                            "totalBytes": total_bytes,
                            "percent": percent
                        }),
                    );
                }
            }
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
                ArchivistError::ApiError(format!(
                    "Network download request failed: {}",
                    describe_reqwest_error(&e)
                ))
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

        let body = response.text().await.map_err(|e| {
            ArchivistError::ApiError(format!("Failed to read availability response body: {}", e))
        })?;
        log::debug!("Availability GET response body: {}", body);
        serde_json::from_str::<Vec<Availability>>(&body).map_err(|e| {
            log::error!("Failed to parse availability: {} — body: {}", e, body);
            ArchivistError::ApiError(format!(
                "Failed to parse availability: {} — body: {}",
                e, body
            ))
        })
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

        let body = response.text().await.map_err(|e| {
            ArchivistError::ApiError(format!("Failed to read availability response body: {}", e))
        })?;
        log::debug!("Availability POST response body: {}", body);
        serde_json::from_str::<Availability>(&body).map_err(|e| {
            log::error!(
                "Failed to parse availability response: {} — body: {}",
                e,
                body
            );
            ArchivistError::ApiError(format!(
                "Failed to parse availability response: {} — body: {}",
                e, body
            ))
        })
    }

    /// Create a storage request with full marketplace parameters.
    ///
    /// Retries once on transient connection or timeout errors, since blockchain
    /// operations (gas estimation, tx submission) can be slow and the sidecar may
    /// momentarily drop connections under load.
    pub async fn create_storage_request(
        &self,
        cid: &str,
        params: &StorageRequestParams,
    ) -> Result<String> {
        let url = format!("{}/api/archivist/v1/storage/request/{}", self.base_url, cid);

        let send_request = || {
            self.client
                .post(&url)
                .json(params)
                .timeout(Duration::from_secs(300)) // 5 min for blockchain ops
                .send()
        };

        // First attempt
        let response = match send_request().await {
            Ok(resp) => resp,
            Err(e) => {
                let detail = describe_reqwest_error(&e);

                if e.is_connect() || e.is_timeout() {
                    // Connection or timeout error — retry once after a short delay
                    let kind = if e.is_timeout() {
                        "timed out"
                    } else {
                        "connection failed"
                    };
                    log::warn!("Storage request {} ({}), retrying in 2s...", kind, detail);
                    tokio::time::sleep(Duration::from_secs(2)).await;

                    match send_request().await {
                        Ok(resp) => resp,
                        Err(retry_err) => {
                            let retry_detail = describe_reqwest_error(&retry_err);
                            log::error!("Storage request failed after retry: {}", retry_detail);
                            return Err(ArchivistError::ApiError(format!(
                                "Storage request failed after retry: {}",
                                retry_detail
                            )));
                        }
                    }
                } else {
                    // Other error (body parse, redirect, etc.) — fail immediately
                    log::error!("Storage request failed: {}", detail);
                    return Err(ArchivistError::ApiError(format!(
                        "Storage request failed: {}",
                        detail
                    )));
                }
            }
        };

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(ArchivistError::ApiError(format!(
                "Storage request failed: HTTP {} - {}",
                status, body
            )));
        }

        let body = response.text().await.map_err(|e| {
            ArchivistError::ApiError(format!(
                "Failed to read storage request response body: {}",
                e
            ))
        })?;
        let request_id = body.trim().trim_matches('"').to_string();
        log::info!("Storage request created: {}", request_id);
        Ok(request_id)
    }

    /// List client's storage purchases (returns list of purchase ID strings)
    pub async fn get_purchases(&self) -> Result<Vec<String>> {
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
            .json::<Vec<String>>()
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

        let body = response.text().await.map_err(|e| {
            ArchivistError::ApiError(format!("Failed to read purchase response body: {}", e))
        })?;
        log::debug!("Purchase response body: {}", body);
        serde_json::from_str::<Purchase>(&body).map_err(|e| {
            log::error!("Failed to parse purchase: {} — body: {}", e, body);
            ArchivistError::ApiError(format!("Failed to parse purchase: {} — body: {}", e, body))
        })
    }
}

impl Default for NodeApiClient {
    fn default() -> Self {
        Self::new(8080)
    }
}
