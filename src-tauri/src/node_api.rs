//! HTTP client for communicating with the archivist-node sidecar
//!
//! Based on the archivist-node OpenAPI spec, this module provides
//! a typed interface to the node's REST API.

use crate::error::{ArchivistError, Result};
use reqwest::{header, Client};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::Duration;
use tokio::fs::File;
use tokio::io::AsyncReadExt;

/// Response from /api/archivist/v1/debug/info
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeInfo {
    pub version: String,
    #[serde(default)]
    pub local_node: Option<LocalNodeInfo>,
    #[serde(default)]
    pub codex: Option<CodexInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalNodeInfo {
    pub peer_id: String,
    #[serde(default)]
    pub addrs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexInfo {
    #[serde(default)]
    pub storage: Option<StorageInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub available_bytes: u64,
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

/// HTTP client for the archivist-node API
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

    /// Upload a file to the node
    ///
    /// The archivist-node API expects raw binary data with:
    /// - Content-Type header set to the file's MIME type
    /// - Content-Disposition header with the filename
    pub async fn upload_file(&self, file_path: &Path) -> Result<UploadResponse> {
        let url = format!("{}/api/archivist/v1/data", self.base_url);

        // Read file contents
        let mut file = File::open(file_path).await.map_err(|e| {
            ArchivistError::FileOperationFailed(format!("Failed to open file: {}", e))
        })?;

        let mut contents = Vec::new();
        file.read_to_end(&mut contents).await.map_err(|e| {
            ArchivistError::FileOperationFailed(format!("Failed to read file: {}", e))
        })?;

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

        let response = self
            .client
            .post(&url)
            .header(header::CONTENT_TYPE, &mime_type)
            .header(header::CONTENT_DISPOSITION, &content_disposition)
            .body(contents)
            .timeout(Duration::from_secs(300)) // 5 min timeout for large files
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

    /// Download a file by CID (from local storage)
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

    /// Download a file by CID from the network (if not available locally)
    ///
    /// This uses POST to request the network download, which fetches the file
    /// from connected peers and stores it locally. Then we download from local.
    pub async fn download_file_network(&self, cid: &str) -> Result<Vec<u8>> {
        // First, request the file from the network (POST triggers async download)
        let request_url = format!("{}/api/archivist/v1/data/{}/network", self.base_url, cid);

        let response = self
            .client
            .post(&request_url)
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

        // Now download from local storage (the POST should have fetched it)
        self.download_file(cid).await
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

        let response =
            self.client.get(&url).send().await.map_err(|e| {
                ArchivistError::ApiError(format!("Failed to connect to peer: {}", e))
            })?;

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
}

impl Default for NodeApiClient {
    fn default() -> Self {
        Self::new(8080)
    }
}
