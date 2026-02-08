use crate::error::{ArchivistError, Result};
use crate::node_api::NodeApiClient;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

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

    /// Validate and sanitize a file path to prevent path traversal attacks.
    /// Returns the canonicalized path if valid, or an error if the path is suspicious.
    fn validate_path(path_str: &str) -> Result<PathBuf> {
        let path = Path::new(path_str);

        // Check for obvious path traversal attempts
        let path_string = path_str.to_lowercase();
        if path_string.contains("..") {
            return Err(ArchivistError::FileOperationFailed(
                "Path traversal detected: '..' not allowed".to_string(),
            ));
        }

        // Reject paths with null bytes (potential attack vector)
        if path_str.contains('\0') {
            return Err(ArchivistError::FileOperationFailed(
                "Invalid path: null bytes not allowed".to_string(),
            ));
        }

        // Path must be absolute
        if !path.is_absolute() {
            return Err(ArchivistError::FileOperationFailed(
                "Path must be absolute".to_string(),
            ));
        }

        // Canonicalize the path to resolve any symlinks and normalize
        let canonical = path.canonicalize().map_err(|e| {
            ArchivistError::FileOperationFailed(format!("Failed to canonicalize path: {}", e))
        })?;

        // Verify the canonical path doesn't escape via symlinks
        // The canonical path should still be under a reasonable location
        // (This is a basic check - Tauri's fs scope provides additional protection)
        let canonical_str = canonical.to_string_lossy().to_lowercase();

        // Block access to sensitive system directories
        let blocked_prefixes = [
            "/etc",
            "/var",
            "/usr",
            "/bin",
            "/sbin",
            "/lib",
            "/boot",
            "/root",
            "/proc",
            "/sys",
            "/dev",
            "c:\\windows",
            "c:\\program files",
            "c:\\programdata",
        ];

        for prefix in blocked_prefixes {
            if canonical_str.starts_with(prefix) {
                return Err(ArchivistError::FileOperationFailed(format!(
                    "Access denied: cannot access system directory '{}'",
                    prefix
                )));
            }
        }

        Ok(canonical)
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
                                .and_then(|m| m.dataset_size)
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
    #[allow(dead_code)]
    pub async fn upload_file(&mut self, path: &str) -> Result<UploadResult> {
        self.upload_file_with_progress(path, None).await
    }

    /// Upload a file to the node with optional progress reporting
    pub async fn upload_file_with_progress(
        &mut self,
        path: &str,
        app_handle: Option<&tauri::AppHandle>,
    ) -> Result<UploadResult> {
        // Validate and sanitize the path first
        let path = Self::validate_path(path)?;

        if !path.exists() {
            return Err(ArchivistError::FileNotFound(
                path.to_string_lossy().to_string(),
            ));
        }

        // Ensure it's a file, not a directory
        if !path.is_file() {
            return Err(ArchivistError::FileOperationFailed(
                "Path must be a file, not a directory".to_string(),
            ));
        }

        let metadata = std::fs::metadata(&path).map_err(|e| {
            ArchivistError::FileOperationFailed(format!("Failed to read file metadata: {}", e))
        })?;

        let filename = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "unknown".to_string());

        log::info!("Uploading file: {} ({} bytes)", filename, metadata.len());

        // Upload to node with streaming
        let response = self
            .api_client
            .upload_file_with_progress(&path, app_handle)
            .await?;

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
        // Validate CID format (basic check - should be alphanumeric with some special chars)
        if cid.is_empty() || cid.len() > 100 {
            return Err(ArchivistError::FileOperationFailed(
                "Invalid CID format".to_string(),
            ));
        }

        // For download destination, we need to validate the parent directory exists
        // since the file doesn't exist yet
        let dest_path = Path::new(destination);

        // Check for path traversal in destination
        let dest_string = destination.to_lowercase();
        if dest_string.contains("..") {
            return Err(ArchivistError::FileOperationFailed(
                "Path traversal detected: '..' not allowed in destination".to_string(),
            ));
        }

        if destination.contains('\0') {
            return Err(ArchivistError::FileOperationFailed(
                "Invalid path: null bytes not allowed".to_string(),
            ));
        }

        if !dest_path.is_absolute() {
            return Err(ArchivistError::FileOperationFailed(
                "Destination path must be absolute".to_string(),
            ));
        }

        // Validate parent directory exists and is writable
        let parent = dest_path.parent().ok_or_else(|| {
            ArchivistError::FileOperationFailed("Invalid destination path".to_string())
        })?;

        if !parent.exists() {
            return Err(ArchivistError::FileOperationFailed(
                "Destination directory does not exist".to_string(),
            ));
        }

        // Check parent is not a system directory
        let parent_canonical = parent.canonicalize().map_err(|e| {
            ArchivistError::FileOperationFailed(format!("Failed to resolve destination: {}", e))
        })?;
        let parent_str = parent_canonical.to_string_lossy().to_lowercase();

        let blocked_prefixes = [
            "/etc",
            "/var",
            "/usr",
            "/bin",
            "/sbin",
            "/lib",
            "/boot",
            "/root",
            "/proc",
            "/sys",
            "/dev",
            "c:\\windows",
            "c:\\program files",
            "c:\\programdata",
        ];

        for prefix in blocked_prefixes {
            if parent_str.starts_with(prefix) {
                return Err(ArchivistError::FileOperationFailed(format!(
                    "Access denied: cannot write to system directory '{}'",
                    prefix
                )));
            }
        }

        log::info!("Downloading file {} to {}", cid, destination);

        // Try streaming download (local first, then network fallback)
        let dest = std::path::Path::new(destination);
        match self.api_client.download_file_to_path(cid, dest).await {
            Ok(()) => {
                log::info!("Downloaded file {} to {}", cid, destination);
            }
            Err(_) => {
                log::info!("File not found locally, fetching from network...");
                // Network download: trigger fetch via POST then stream from local to file
                self.api_client.request_network_download(cid).await?;
                self.api_client.download_file_to_path(cid, dest).await?;
                log::info!("Downloaded file {} from network to {}", cid, destination);
            }
        }

        Ok(())
    }

    /// Delete a file from node storage and local cache
    pub async fn delete_file(&mut self, cid: &str) -> Result<()> {
        // First, delete from the archivist-node storage via API
        self.api_client.delete_file(cid).await?;
        log::info!("Deleted file from node storage: {}", cid);

        // Then remove from local cache
        if self.files.remove(cid).is_some() {
            log::info!("Removed file from local cache: {}", cid);
            Ok(())
        } else {
            // File was deleted from node but wasn't in cache - still success
            log::warn!(
                "File {} was not in local cache but was deleted from node",
                cid
            );
            Ok(())
        }
    }

    /// Delete all files from node storage and local cache
    pub async fn delete_all_files(&mut self) -> Result<u64> {
        let data_list = self.api_client.list_data().await?;
        let total = data_list.content.len() as u64;

        for item in &data_list.content {
            if let Err(e) = self.api_client.delete_file(&item.cid).await {
                log::warn!("Failed to delete {}: {}", item.cid, e);
            }
        }

        self.files.clear();
        log::info!("Deleted all files ({} total)", total);

        Ok(total)
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

    /// Get file info by CID from the node API
    /// Used for Download by CID to get original filename/mimetype
    pub async fn get_file_info_by_cid(
        &self,
        cid: &str,
    ) -> Result<Option<crate::commands::files::FileMetadata>> {
        match self.api_client.get_file_info(cid).await {
            Ok(Some(manifest)) => Ok(Some(crate::commands::files::FileMetadata {
                filename: manifest.filename,
                mimetype: manifest.mimetype,
            })),
            Ok(None) => Ok(None),
            Err(e) => {
                log::warn!("Failed to get file info for CID {}: {}", cid, e);
                Ok(None)
            }
        }
    }
}

impl Default for FileService {
    fn default() -> Self {
        Self::new()
    }
}
