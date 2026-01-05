use crate::error::{ArchivistError, Result};
use crate::node_api::NodeApiClient;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

/// File information stored locally and synced with node
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub cid: String,
    pub name: String,
    pub size_bytes: u64,
    pub mime_type: Option<String>,
    pub uploaded_at: DateTime<Utc>,
    pub is_pinned: bool,
    pub is_local: bool,
}

/// Response for file list
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileList {
    pub files: Vec<FileInfo>,
    pub total_count: u64,
    pub total_size_bytes: u64,
}

/// Upload result
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadResult {
    pub cid: String,
    pub name: String,
    pub size_bytes: u64,
}

/// File service that manages files through the node API
pub struct FileService {
    /// Local cache of file metadata (CID -> FileInfo)
    files: HashMap<String, FileInfo>,
    /// API client for node communication
    api_client: NodeApiClient,
    /// Port the node API is running on (for config updates)
    #[allow(dead_code)]
    api_port: u16,
}

impl FileService {
    pub fn new() -> Self {
        Self {
            files: HashMap::new(),
            api_client: NodeApiClient::new(8080),
            api_port: 8080,
        }
    }

    /// Set the API port (called when node config changes)
    #[allow(dead_code)]
    pub fn set_api_port(&mut self, port: u16) {
        self.api_port = port;
        self.api_client.set_port(port);
    }

    /// Refresh file list from node
    pub async fn refresh_from_node(&mut self) -> Result<()> {
        match self.api_client.list_data().await {
            Ok(response) => {
                // Update local cache with data from node
                for item in response.content {
                    if let std::collections::hash_map::Entry::Vacant(e) =
                        self.files.entry(item.cid.clone())
                    {
                        let file_info = FileInfo {
                            cid: item.cid.clone(),
                            name: item
                                .manifest
                                .as_ref()
                                .and_then(|m| m.filename.clone())
                                .unwrap_or_else(|| format!("file-{}", &item.cid[..8])),
                            size_bytes: item
                                .manifest
                                .as_ref()
                                .and_then(|m| m.upload_bytes)
                                .unwrap_or(0),
                            mime_type: item.manifest.as_ref().and_then(|m| m.mimetype.clone()),
                            uploaded_at: Utc::now(),
                            is_pinned: item
                                .manifest
                                .as_ref()
                                .and_then(|m| m.protected)
                                .unwrap_or(false),
                            is_local: true,
                        };
                        e.insert(file_info);
                    }
                }
                Ok(())
            }
            Err(e) => {
                log::warn!("Failed to refresh files from node: {}", e);
                // Don't fail - just use cached data
                Ok(())
            }
        }
    }

    /// List all files (from cache, optionally refreshing from node)
    pub async fn list_files(&mut self) -> Result<FileList> {
        // Try to refresh from node
        let _ = self.refresh_from_node().await;

        let files: Vec<FileInfo> = self.files.values().cloned().collect();
        let total_size: u64 = files.iter().map(|f| f.size_bytes).sum();

        Ok(FileList {
            total_count: files.len() as u64,
            total_size_bytes: total_size,
            files,
        })
    }

    /// Upload a file to the node
    pub async fn upload_file(&mut self, path: &str) -> Result<UploadResult> {
        let path = Path::new(path);

        if !path.exists() {
            return Err(ArchivistError::FileNotFound(
                path.to_string_lossy().to_string(),
            ));
        }

        let metadata = std::fs::metadata(path).map_err(|e| {
            ArchivistError::FileOperationFailed(format!("Failed to read file metadata: {}", e))
        })?;

        let filename = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "unknown".to_string());

        log::info!("Uploading file: {} ({} bytes)", filename, metadata.len());

        // Upload to node
        let response = self.api_client.upload_file(path).await?;

        // Store in local cache
        let file_info = FileInfo {
            cid: response.cid.clone(),
            name: filename.clone(),
            size_bytes: metadata.len(),
            mime_type: mime_guess::from_path(path).first().map(|m| m.to_string()),
            uploaded_at: Utc::now(),
            is_pinned: true,
            is_local: true,
        };

        self.files.insert(response.cid.clone(), file_info);

        log::info!(
            "File uploaded successfully: {} -> {}",
            filename,
            response.cid
        );

        Ok(UploadResult {
            cid: response.cid,
            name: filename,
            size_bytes: metadata.len(),
        })
    }

    /// Download a file by CID to a destination path
    pub async fn download_file(&self, cid: &str, destination: &str) -> Result<()> {
        log::info!("Downloading file {} to {}", cid, destination);

        // Try local first, then network
        let data = match self.api_client.download_file(cid).await {
            Ok(data) => data,
            Err(_) => {
                log::info!("File not found locally, fetching from network...");
                self.api_client.download_file_network(cid).await?
            }
        };

        // Write to destination
        tokio::fs::write(destination, &data).await.map_err(|e| {
            ArchivistError::FileOperationFailed(format!("Failed to write file: {}", e))
        })?;

        log::info!("Downloaded {} bytes to {}", data.len(), destination);
        Ok(())
    }

    /// Delete a file from local cache (note: CIDs can't be deleted from network)
    pub async fn delete_file(&mut self, cid: &str) -> Result<()> {
        if self.files.remove(cid).is_some() {
            log::info!("Removed file from local cache: {}", cid);
            Ok(())
        } else {
            Err(ArchivistError::FileNotFound(cid.to_string()))
        }
    }

    /// Pin/unpin a file (marks as protected in local cache)
    pub async fn pin_file(&mut self, cid: &str, pinned: bool) -> Result<()> {
        if let Some(file) = self.files.get_mut(cid) {
            file.is_pinned = pinned;
            log::info!("File {} pinned: {}", cid, pinned);
            Ok(())
        } else {
            Err(ArchivistError::FileNotFound(cid.to_string()))
        }
    }

    /// Get a specific file by CID
    pub fn get_file(&self, cid: &str) -> Option<&FileInfo> {
        self.files.get(cid)
    }

    /// Check if node API is reachable
    pub async fn check_node_connection(&self) -> bool {
        self.api_client.health_check().await.unwrap_or(false)
    }
}

impl Default for FileService {
    fn default() -> Self {
        Self::new()
    }
}
