use crate::error::{ArchivistError, Result};
use crate::node_api::NodeApiClient;
use crate::services::manifest_server::{ManifestInfo, ManifestRegistry};
use chrono::{DateTime, Utc};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};
use uuid::Uuid;

/// Watched folder configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchedFolder {
    pub id: String,
    pub path: String,
    pub enabled: bool,
    pub file_count: u32,
    pub total_size_bytes: u64,
    pub last_synced: Option<DateTime<Utc>>,
    pub status: FolderStatus,
    // NEW: Manifest tracking fields
    pub manifest_cid: Option<String>,
    pub manifest_sequence: u64,
    pub manifest_updated_at: Option<DateTime<Utc>>,
    pub backup_synced_at: Option<DateTime<Utc>>,
    pub backup_ack_received: bool,
    pub pending_retry: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum FolderStatus {
    Idle,
    Scanning,
    Syncing,
    Error,
    Paused,
}

/// Sync state returned to frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncState {
    pub folders: Vec<WatchedFolder>,
    pub is_syncing: bool,
    pub queue_size: u32,
    pub total_files: u32,
    pub synced_files: u32,
    pub recent_uploads: Vec<String>,
}

/// File pending upload
#[derive(Debug, Clone)]
#[allow(dead_code)]
struct PendingFile {
    path: PathBuf,
    folder_id: String,
    added_at: DateTime<Utc>,
}

/// File CID mapping for manifest generation
#[derive(Debug, Clone, Serialize, Deserialize)]
struct FileCidMapping {
    path: PathBuf,
    cid: String,
    size_bytes: u64,
    mime_type: Option<String>,
    uploaded_at: DateTime<Utc>,
}

/// Manifest file structure (JSON) - Source of Truth for continuous sync
#[derive(Debug, Clone, Serialize, Deserialize)]
struct ManifestFile {
    version: String,
    folder_id: String,
    folder_path: String,
    source_peer_id: String,
    sequence_number: u64,
    last_updated: DateTime<Utc>,
    manifest_cid: Option<String>,
    files: Vec<ManifestFileEntry>,
    deleted_files: Vec<ManifestDeletedEntry>,
    stats: ManifestStats,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ManifestFileEntry {
    path: String,
    cid: String,
    size_bytes: u64,
    mime_type: Option<String>,
    uploaded_at: DateTime<Utc>,
}

/// Entry for a deleted file (tombstone)
#[derive(Debug, Clone, Serialize, Deserialize)]
struct ManifestDeletedEntry {
    path: String,
    cid: String,
    deleted_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ManifestStats {
    total_files: u32,
    total_size_bytes: u64,
}

/// Sync service with file system watching
pub struct SyncService {
    /// Watched folders
    folders: HashMap<String, WatchedFolder>,
    /// Files waiting to be uploaded
    upload_queue: Vec<PendingFile>,
    /// Recently uploaded file names
    recent_uploads: Vec<String>,
    /// Currently syncing
    is_syncing: bool,
    /// File watcher handle
    watcher: Option<RecommendedWatcher>,
    /// Channel for file events
    event_tx: Option<mpsc::UnboundedSender<SyncEvent>>,
    /// API client for uploads
    api_client: NodeApiClient,
    /// Files we've already synced (to avoid re-uploading)
    synced_files: HashSet<PathBuf>,
    /// NEW: Persistent mapping of file paths to CIDs (per folder)
    file_cid_mappings: HashMap<String, Vec<FileCidMapping>>,
    /// NEW: Track deleted files since last manifest (per folder)
    deleted_files: HashMap<String, Vec<ManifestDeletedEntry>>,
    /// NEW: Track changes since last manifest generation (per folder)
    changes_since_manifest: HashMap<String, u32>,
    /// NEW: Manifest update threshold (generate new manifest after N changes)
    #[allow(dead_code)]
    manifest_update_threshold: u32,
    /// Manifest registry for auto-registering manifests
    manifest_registry: Option<Arc<RwLock<ManifestRegistry>>>,
}

/// Internal sync events
#[derive(Debug)]
pub enum SyncEvent {
    FileCreated(PathBuf),
    FileModified(PathBuf),
    FileDeleted(PathBuf),
    ScanFolder(String),
}

impl SyncService {
    pub fn new() -> Self {
        Self {
            folders: HashMap::new(),
            upload_queue: Vec::new(),
            recent_uploads: Vec::new(),
            is_syncing: false,
            watcher: None,
            event_tx: None,
            api_client: NodeApiClient::new(8080),
            synced_files: HashSet::new(),
            file_cid_mappings: HashMap::new(),
            deleted_files: HashMap::new(),
            changes_since_manifest: HashMap::new(),
            manifest_update_threshold: 10, // Default: 10 changes
            manifest_registry: None,
        }
    }

    /// Create a new SyncService with a manifest registry for auto-registration
    pub fn with_manifest_registry(manifest_registry: Arc<RwLock<ManifestRegistry>>) -> Self {
        Self {
            folders: HashMap::new(),
            upload_queue: Vec::new(),
            recent_uploads: Vec::new(),
            is_syncing: false,
            watcher: None,
            event_tx: None,
            api_client: NodeApiClient::new(8080),
            synced_files: HashSet::new(),
            file_cid_mappings: HashMap::new(),
            deleted_files: HashMap::new(),
            changes_since_manifest: HashMap::new(),
            manifest_update_threshold: 10, // Default: 10 changes
            manifest_registry: Some(manifest_registry),
        }
    }

    /// Set API port for uploads (for config updates)
    #[allow(dead_code)]
    pub fn set_api_port(&mut self, port: u16) {
        self.api_client.set_port(port);
    }

    /// Get current sync state
    pub fn get_state(&self) -> SyncState {
        let folders: Vec<WatchedFolder> = self.folders.values().cloned().collect();
        let total_files: u32 = folders.iter().map(|f| f.file_count).sum();

        SyncState {
            folders,
            is_syncing: self.is_syncing,
            queue_size: self.upload_queue.len() as u32,
            total_files,
            synced_files: self.synced_files.len() as u32,
            recent_uploads: self.recent_uploads.clone(),
        }
    }

    /// Initialize the file watcher
    pub fn init_watcher(&mut self) -> Result<mpsc::UnboundedReceiver<SyncEvent>> {
        let (tx, rx) = mpsc::unbounded_channel();
        let tx_clone = tx.clone();

        let watcher =
            notify::recommended_watcher(move |res: std::result::Result<Event, notify::Error>| {
                if let Ok(event) = res {
                    match event.kind {
                        EventKind::Create(_) => {
                            for path in event.paths {
                                if path.is_file() {
                                    let _ = tx_clone.send(SyncEvent::FileCreated(path));
                                }
                            }
                        }
                        EventKind::Modify(_) => {
                            for path in event.paths {
                                if path.is_file() {
                                    let _ = tx_clone.send(SyncEvent::FileModified(path));
                                }
                            }
                        }
                        EventKind::Remove(_) => {
                            for path in event.paths {
                                let _ = tx_clone.send(SyncEvent::FileDeleted(path));
                            }
                        }
                        _ => {}
                    }
                }
            })
            .map_err(|e| ArchivistError::SyncError(format!("Failed to create watcher: {}", e)))?;

        self.watcher = Some(watcher);
        self.event_tx = Some(tx);

        Ok(rx)
    }

    /// Add a folder to watch
    pub async fn add_folder(&mut self, path: &str) -> Result<WatchedFolder> {
        let path_buf = Path::new(path);

        if !path_buf.exists() || !path_buf.is_dir() {
            return Err(ArchivistError::FileNotFound(path.to_string()));
        }

        // Check if already watching
        if self.folders.values().any(|f| f.path == path) {
            return Err(ArchivistError::SyncError(
                "Folder already being watched".to_string(),
            ));
        }

        let id = Uuid::new_v4().to_string();

        // Count files in folder
        let (file_count, total_size) = self.scan_folder_stats(path_buf)?;

        let folder = WatchedFolder {
            id: id.clone(),
            path: path.to_string(),
            enabled: true,
            file_count,
            total_size_bytes: total_size,
            last_synced: None,
            status: FolderStatus::Idle,
            manifest_cid: None,
            manifest_sequence: 0,
            manifest_updated_at: None,
            backup_synced_at: None,
            backup_ack_received: false,
            pending_retry: false,
        };

        // Add to watcher if available
        if let Some(ref mut watcher) = self.watcher {
            watcher
                .watch(path_buf, RecursiveMode::Recursive)
                .map_err(|e| ArchivistError::SyncError(format!("Failed to watch folder: {}", e)))?;
        }

        self.folders.insert(id, folder.clone());
        log::info!(
            "Added watched folder: {} ({} files, {} bytes)",
            path,
            file_count,
            total_size
        );

        // Queue initial scan
        if let Some(ref tx) = self.event_tx {
            let _ = tx.send(SyncEvent::ScanFolder(folder.id.clone()));
        }

        Ok(folder)
    }

    /// Remove a watched folder
    pub async fn remove_folder(&mut self, folder_id: &str) -> Result<()> {
        let folder = self
            .folders
            .remove(folder_id)
            .ok_or_else(|| ArchivistError::FileNotFound(folder_id.to_string()))?;

        // Remove from watcher
        if let Some(ref mut watcher) = self.watcher {
            let _ = watcher.unwatch(Path::new(&folder.path));
        }

        // Remove from synced files
        self.synced_files.retain(|p| !p.starts_with(&folder.path));

        log::info!("Removed watched folder: {}", folder.path);
        Ok(())
    }

    /// Toggle folder enabled state
    pub async fn toggle_folder(&mut self, folder_id: &str, enabled: bool) -> Result<()> {
        let folder = self
            .folders
            .get_mut(folder_id)
            .ok_or_else(|| ArchivistError::FileNotFound(folder_id.to_string()))?;

        folder.enabled = enabled;
        folder.status = if enabled {
            FolderStatus::Idle
        } else {
            FolderStatus::Paused
        };

        log::info!("Folder {} enabled: {}", folder.path, enabled);
        Ok(())
    }

    /// Trigger manual sync
    pub async fn sync_now(&mut self) -> Result<()> {
        if self.is_syncing {
            return Ok(());
        }

        self.is_syncing = true;

        // Queue all files from enabled folders
        for folder in self.folders.values_mut() {
            if folder.enabled {
                folder.status = FolderStatus::Scanning;
                if let Some(ref tx) = self.event_tx {
                    let _ = tx.send(SyncEvent::ScanFolder(folder.id.clone()));
                }
            }
        }

        log::info!("Manual sync triggered");
        Ok(())
    }

    /// Pause sync operations
    pub async fn pause_sync(&mut self) -> Result<()> {
        self.is_syncing = false;
        self.upload_queue.clear();

        for folder in self.folders.values_mut() {
            if matches!(
                folder.status,
                FolderStatus::Syncing | FolderStatus::Scanning
            ) {
                folder.status = FolderStatus::Paused;
            }
        }

        log::info!("Sync paused");
        Ok(())
    }

    /// Handle a sync event
    pub async fn handle_event(&mut self, event: SyncEvent) -> Result<()> {
        match event {
            SyncEvent::FileCreated(path) | SyncEvent::FileModified(path) => {
                // Find which folder this belongs to
                if let Some(folder_id) = self.find_folder_for_path(&path) {
                    let folder = self.folders.get(&folder_id);
                    if folder.map(|f| f.enabled).unwrap_or(false) {
                        self.queue_file(path, folder_id);
                    }
                }
            }
            SyncEvent::FileDeleted(path) => {
                // Find which folder this belongs to
                if let Some(folder_id) = self.find_folder_for_path(&path) {
                    // Find CID for this file from mappings
                    if let Some(mappings) = self.file_cid_mappings.get(&folder_id) {
                        if let Some(mapping) = mappings.iter().find(|m| m.path == path) {
                            // Add to deleted files tracking
                            let deleted_entry = ManifestDeletedEntry {
                                path: path
                                    .strip_prefix(&self.folders[&folder_id].path)
                                    .unwrap_or(&path)
                                    .to_string_lossy()
                                    .to_string(),
                                cid: mapping.cid.clone(),
                                deleted_at: Utc::now(),
                            };

                            self.deleted_files
                                .entry(folder_id.clone())
                                .or_default()
                                .push(deleted_entry);

                            // Increment change counter
                            *self.changes_since_manifest.entry(folder_id).or_insert(0) += 1;
                        }
                    }
                }

                // Remove from synced files
                self.synced_files.remove(&path);
                // Remove from queue
                self.upload_queue.retain(|p| p.path != path);
                // Remove from CID mappings
                for mappings in self.file_cid_mappings.values_mut() {
                    mappings.retain(|m| m.path != path);
                }
            }
            SyncEvent::ScanFolder(folder_id) => {
                self.scan_folder(&folder_id).await?;
            }
        }
        Ok(())
    }

    /// Process the upload queue (call periodically)
    pub async fn process_queue(&mut self) -> Result<u32> {
        if self.upload_queue.is_empty() || !self.is_syncing {
            // Update folder statuses
            for folder in self.folders.values_mut() {
                if folder.status == FolderStatus::Syncing {
                    folder.status = FolderStatus::Idle;
                    folder.last_synced = Some(Utc::now());
                }
            }
            self.is_syncing = false;

            // Check if any folders need manifest generation (threshold reached)
            let folders_needing_manifest: Vec<String> = self
                .folders
                .iter()
                .filter_map(|(id, _)| {
                    let changes = self.changes_since_manifest.get(id).copied().unwrap_or(0);
                    if changes >= self.manifest_update_threshold {
                        Some(id.clone())
                    } else {
                        None
                    }
                })
                .collect();

            // Generate manifests for folders that reached threshold
            for folder_id in folders_needing_manifest {
                log::info!(
                    "Threshold reached for folder {}, generating manifest",
                    folder_id
                );
                match self.upload_manifest(&folder_id).await {
                    Ok(manifest_cid) => {
                        log::info!(
                            "Manifest generated and uploaded for folder {}: {}",
                            folder_id,
                            manifest_cid
                        );

                        // Register manifest with the discovery server's registry
                        if let Some(registry) = &self.manifest_registry {
                            if let Some(folder) = self.folders.get(&folder_id) {
                                let manifest_info = ManifestInfo {
                                    folder_id: folder_id.clone(),
                                    folder_path: folder.path.clone(),
                                    manifest_cid: manifest_cid.clone(),
                                    sequence_number: folder.manifest_sequence,
                                    updated_at: Utc::now().to_rfc3339(),
                                    file_count: folder.file_count,
                                    total_size_bytes: folder.total_size_bytes,
                                };
                                let mut reg = registry.write().await;
                                reg.register_manifest(manifest_info);
                                log::info!(
                                    "Auto-registered manifest {} for folder {}",
                                    manifest_cid,
                                    folder_id
                                );
                            }
                        }
                    }
                    Err(e) => {
                        log::error!(
                            "Failed to generate manifest for folder {}: {}",
                            folder_id,
                            e
                        );
                    }
                }
            }

            return Ok(0);
        }

        let mut uploaded = 0;
        let batch_size = 5; // Process 5 files at a time

        for _ in 0..batch_size {
            if let Some(pending) = self.upload_queue.pop() {
                if pending.path.exists() && !self.synced_files.contains(&pending.path) {
                    match self.upload_file(&pending.path).await {
                        Ok((cid, size, mime_type)) => {
                            self.synced_files.insert(pending.path.clone());

                            // Store CID mapping for manifest generation
                            self.store_cid_mapping(
                                &pending.folder_id,
                                pending.path.clone(),
                                cid.clone(),
                                size,
                                mime_type,
                            );

                            // Track recent uploads
                            let filename = pending
                                .path
                                .file_name()
                                .map(|n| n.to_string_lossy().to_string())
                                .unwrap_or_else(|| "unknown".to_string());
                            self.recent_uploads.insert(0, filename);
                            if self.recent_uploads.len() > 10 {
                                self.recent_uploads.truncate(10);
                            }

                            log::info!("Uploaded {} -> {}", pending.path.display(), cid);
                            uploaded += 1;
                        }
                        Err(e) => {
                            log::error!("Failed to upload {}: {}", pending.path.display(), e);
                            // Don't re-queue failed files for now
                        }
                    }
                }
            }
        }

        Ok(uploaded)
    }

    /// Queue a file for upload
    fn queue_file(&mut self, path: PathBuf, folder_id: String) {
        // Skip if already synced or queued
        if self.synced_files.contains(&path) {
            return;
        }
        if self.upload_queue.iter().any(|p| p.path == path) {
            return;
        }

        // Skip hidden files and common ignore patterns
        if let Some(filename) = path.file_name().and_then(|n| n.to_str()) {
            if filename.starts_with('.') || filename.ends_with(".tmp") || filename.ends_with("~") {
                return;
            }
        }

        self.upload_queue.push(PendingFile {
            path,
            folder_id: folder_id.clone(),
            added_at: Utc::now(),
        });

        // Update folder status
        if let Some(folder) = self.folders.get_mut(&folder_id) {
            if folder.status == FolderStatus::Idle {
                folder.status = FolderStatus::Syncing;
            }
        }
    }

    /// Upload a file to the node and return CID with metadata
    async fn upload_file(&self, path: &Path) -> Result<(String, u64, Option<String>)> {
        let response = self.api_client.upload_file(path).await?;
        let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
        let mime_type = mime_guess::from_path(path).first().map(|m| m.to_string());
        Ok((response.cid, size, mime_type))
    }

    /// Store CID mapping after successful upload
    fn store_cid_mapping(
        &mut self,
        folder_id: &str,
        path: PathBuf,
        cid: String,
        size_bytes: u64,
        mime_type: Option<String>,
    ) {
        let mapping = FileCidMapping {
            path,
            cid,
            size_bytes,
            mime_type,
            uploaded_at: Utc::now(),
        };

        self.file_cid_mappings
            .entry(folder_id.to_string())
            .or_default()
            .push(mapping);

        // Increment change counter
        *self
            .changes_since_manifest
            .entry(folder_id.to_string())
            .or_insert(0) += 1;
    }

    /// Scan folder for files to sync
    async fn scan_folder(&mut self, folder_id: &str) -> Result<()> {
        let folder = self
            .folders
            .get(folder_id)
            .ok_or_else(|| ArchivistError::FileNotFound(folder_id.to_string()))?
            .clone();

        if !folder.enabled {
            return Ok(());
        }

        log::info!("Scanning folder: {}", folder.path);

        let path = Path::new(&folder.path);
        let files = Self::collect_files(path)?;

        // Update folder stats
        if let Some(f) = self.folders.get_mut(folder_id) {
            f.file_count = files.len() as u32;
            f.status = FolderStatus::Syncing;
        }

        // Queue files that haven't been synced
        for file_path in files {
            self.queue_file(file_path, folder_id.to_string());
        }

        self.is_syncing = !self.upload_queue.is_empty();

        Ok(())
    }

    /// Collect all files in a directory recursively
    fn collect_files(dir: &Path) -> Result<Vec<PathBuf>> {
        let mut files = Vec::new();

        if !dir.is_dir() {
            return Ok(files);
        }

        for entry in std::fs::read_dir(dir).map_err(|e| {
            ArchivistError::FileOperationFailed(format!("Failed to read dir: {}", e))
        })? {
            let entry = entry.map_err(|e| {
                ArchivistError::FileOperationFailed(format!("Failed to read entry: {}", e))
            })?;
            let path = entry.path();

            // Skip hidden files/folders
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if name.starts_with('.') {
                    continue;
                }
            }

            if path.is_dir() {
                files.extend(Self::collect_files(&path)?);
            } else if path.is_file() {
                files.push(path);
            }
        }

        Ok(files)
    }

    /// Get folder stats
    fn scan_folder_stats(&self, path: &Path) -> Result<(u32, u64)> {
        let files = Self::collect_files(path)?;
        let total_size: u64 = files
            .iter()
            .filter_map(|p| std::fs::metadata(p).ok())
            .map(|m| m.len())
            .sum();
        Ok((files.len() as u32, total_size))
    }

    /// Find which watched folder contains a path
    fn find_folder_for_path(&self, path: &Path) -> Option<String> {
        for (id, folder) in &self.folders {
            if path.starts_with(&folder.path) {
                return Some(id.clone());
            }
        }
        None
    }

    /// Get a folder by ID (public for commands)
    pub fn get_folder(&self, folder_id: &str) -> Option<&WatchedFolder> {
        self.folders.get(folder_id)
    }

    /// Generate manifest file for a watched folder (source of truth)
    pub async fn generate_manifest(&mut self, folder_id: &str) -> Result<PathBuf> {
        // 1. Get folder info
        let folder = self
            .folders
            .get_mut(folder_id)
            .ok_or_else(|| ArchivistError::FileNotFound("Folder not found".into()))?;

        // 2. Get source peer ID from node API
        let node_info = self.api_client.get_info().await?;
        let source_peer_id = node_info.id.clone();

        // 3. Increment sequence number
        folder.manifest_sequence += 1;
        let sequence_number = folder.manifest_sequence;
        let folder_path = folder.path.clone();

        // 4. Get file mappings for this folder (current state)
        let mappings = self
            .file_cid_mappings
            .get(folder_id)
            .cloned()
            .unwrap_or_default();

        // 5. Get deleted files since last manifest (tombstones)
        let deleted = self
            .deleted_files
            .get(folder_id)
            .cloned()
            .unwrap_or_default();

        // 6. Build ManifestFile struct
        let manifest = ManifestFile {
            version: "1.0".to_string(),
            folder_id: folder_id.to_string(),
            folder_path: folder_path.clone(),
            source_peer_id: source_peer_id.clone(),
            sequence_number,
            last_updated: Utc::now(),
            manifest_cid: None,
            files: mappings
                .iter()
                .map(|m| ManifestFileEntry {
                    path: m
                        .path
                        .strip_prefix(&folder_path)
                        .unwrap_or(&m.path)
                        .to_string_lossy()
                        .to_string(),
                    cid: m.cid.clone(),
                    size_bytes: m.size_bytes,
                    mime_type: m.mime_type.clone(),
                    uploaded_at: m.uploaded_at,
                })
                .collect(),
            deleted_files: deleted,
            stats: ManifestStats {
                total_files: mappings.len() as u32,
                total_size_bytes: mappings.iter().map(|m| m.size_bytes).sum(),
            },
        };

        // 7. Write to .archivist-manifest-{peer_id}.json
        let peer_id_short = &source_peer_id[..12.min(source_peer_id.len())];
        let manifest_filename = format!(".archivist-manifest-{}.json", peer_id_short);
        let manifest_path = PathBuf::from(&folder_path).join(manifest_filename);

        let json = serde_json::to_string_pretty(&manifest).map_err(|e| {
            ArchivistError::SyncError(format!("Failed to serialize manifest: {}", e))
        })?;
        std::fs::write(&manifest_path, json).map_err(|e| {
            ArchivistError::FileOperationFailed(format!("Failed to write manifest: {}", e))
        })?;

        // 8. Clear deleted files tracking
        self.deleted_files.insert(folder_id.to_string(), Vec::new());

        // 9. Reset change counter
        self.changes_since_manifest.insert(folder_id.to_string(), 0);

        log::info!(
            "Generated manifest v{} for folder {} at {:?}",
            sequence_number,
            folder_id,
            manifest_path
        );
        Ok(manifest_path)
    }

    /// Upload manifest to local node and return CID
    pub async fn upload_manifest(&mut self, folder_id: &str) -> Result<String> {
        let manifest_path = self.generate_manifest(folder_id).await?;
        let (cid, _, _) = self.upload_file(&manifest_path).await?;

        // Update folder metadata
        if let Some(folder) = self.folders.get_mut(folder_id) {
            folder.manifest_cid = Some(cid.clone());
            folder.manifest_updated_at = Some(Utc::now());
            folder.backup_ack_received = false;
            folder.pending_retry = true;
        }

        Ok(cid)
    }

    /// Mark manifest as acknowledged by backup server
    #[allow(dead_code)]
    pub fn acknowledge_manifest(&mut self, folder_id: &str) -> Result<()> {
        if let Some(folder) = self.folders.get_mut(folder_id) {
            folder.backup_ack_received = true;
            folder.pending_retry = false;
            folder.backup_synced_at = Some(Utc::now());
            log::info!("Manifest acknowledged for folder {}", folder_id);
        }
        Ok(())
    }

    /// Set manifest update threshold (configurable from settings)
    #[allow(dead_code)]
    pub fn set_manifest_threshold(&mut self, threshold: u32) {
        self.manifest_update_threshold = threshold;
    }
}

impl Default for SyncService {
    fn default() -> Self {
        Self::new()
    }
}

/// Sync manager for background processing
pub struct SyncManager {
    sync_service: Arc<RwLock<SyncService>>,
}

impl SyncManager {
    pub fn new(sync_service: Arc<RwLock<SyncService>>) -> Self {
        Self { sync_service }
    }

    /// Get list of folders that need manifest retry
    /// Used by backup notification background task
    #[allow(dead_code)]
    pub async fn get_pending_manifests(&self) -> Vec<(String, String)> {
        let sync = self.sync_service.read().await;
        let mut pending = Vec::new();

        for (folder_id, folder) in sync.folders.iter() {
            if folder.pending_retry {
                if let Some(manifest_cid) = &folder.manifest_cid {
                    pending.push((folder_id.clone(), manifest_cid.clone()));
                }
            }
        }

        pending
    }

    /// Mark manifest as successfully notified (clear pending_retry)
    #[allow(dead_code)]
    pub async fn mark_manifest_notified(&self, folder_id: &str) -> Result<()> {
        let mut sync = self.sync_service.write().await;
        sync.acknowledge_manifest(folder_id)
    }

    /// Start background sync processing
    pub async fn start_processing(self) {
        log::info!("Sync manager started");

        // Initialize watcher
        let rx = {
            let mut sync = self.sync_service.write().await;
            match sync.init_watcher() {
                Ok(rx) => Some(rx),
                Err(e) => {
                    log::error!("Failed to initialize file watcher: {}", e);
                    None
                }
            }
        };

        if let Some(mut rx) = rx {
            // Spawn event handler
            let sync_clone = self.sync_service.clone();
            tokio::spawn(async move {
                while let Some(event) = rx.recv().await {
                    let mut sync = sync_clone.write().await;
                    if let Err(e) = sync.handle_event(event).await {
                        log::error!("Error handling sync event: {}", e);
                    }
                }
            });
        }

        // Process queue periodically
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;

            let mut sync = self.sync_service.write().await;
            match sync.process_queue().await {
                Ok(count) => {
                    if count > 0 {
                        log::debug!("Processed {} files from queue", count);
                    }
                }
                Err(e) => {
                    log::error!("Error processing sync queue: {}", e);
                }
            }
        }
    }
}
