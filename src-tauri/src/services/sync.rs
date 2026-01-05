use crate::error::{ArchivistError, Result};
use crate::node_api::NodeApiClient;
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
                // Remove from synced files
                self.synced_files.remove(&path);
                // Remove from queue
                self.upload_queue.retain(|p| p.path != path);
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
            return Ok(0);
        }

        let mut uploaded = 0;
        let batch_size = 5; // Process 5 files at a time

        for _ in 0..batch_size {
            if let Some(pending) = self.upload_queue.pop() {
                if pending.path.exists() && !self.synced_files.contains(&pending.path) {
                    match self.upload_file(&pending.path).await {
                        Ok(cid) => {
                            self.synced_files.insert(pending.path.clone());

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

    /// Upload a file to the node
    async fn upload_file(&self, path: &Path) -> Result<String> {
        let response = self.api_client.upload_file(path).await?;
        Ok(response.cid)
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
        let files = self.collect_files(path)?;

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
    fn collect_files(&self, dir: &Path) -> Result<Vec<PathBuf>> {
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
                files.extend(self.collect_files(&path)?);
            } else if path.is_file() {
                files.push(path);
            }
        }

        Ok(files)
    }

    /// Get folder stats
    fn scan_folder_stats(&self, path: &Path) -> Result<(u32, u64)> {
        let files = self.collect_files(path)?;
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
