//! Backup server daemon for automatic manifest processing
//!
//! This daemon automatically:
//! - Polls source peers for new manifest CIDs via HTTP
//! - Downloads manifests from the P2P network
//! - Parses manifests to extract file lists and deletions
//! - Downloads missing files from the network
//! - Enforces deletions based on tombstones
//! - Tracks processing state with sequence numbers
//! - Accepts trigger notifications from source peers via HTTP

use crate::error::{ArchivistError, Result};
use crate::node_api::NodeApiClient;
use crate::services::config::SourcePeerConfig;
use crate::services::manifest_server::ManifestClient;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};
use tokio::time::Duration;
use warp::Filter;

/// Persistent state for backup daemon (stored in daemon-state.json)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DaemonState {
    /// Manifests that have been fully processed
    pub processed_manifests: HashMap<String, ProcessedManifest>,

    /// Manifests currently being processed (in-flight)
    pub in_progress_manifests: HashMap<String, InProgressManifest>,

    /// Manifests that failed processing (need retry)
    pub failed_manifests: Vec<FailedManifest>,

    /// Last time we polled for new manifests
    pub last_poll_time: DateTime<Utc>,

    /// Statistics
    pub stats: DaemonStats,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessedManifest {
    pub manifest_cid: String,
    pub source_peer_id: String,
    pub sequence_number: u64,
    pub folder_id: String,
    pub processed_at: DateTime<Utc>,
    pub file_count: u32,
    pub total_size_bytes: u64,
    pub deleted_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InProgressManifest {
    pub manifest_cid: String,
    pub source_peer_id: String,
    pub sequence_number: u64,
    pub started_at: DateTime<Utc>,
    pub total_files: u32,
    pub files_downloaded: u32,
    pub files_failed: u32,
    pub current_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FailedManifest {
    pub manifest_cid: String,
    pub source_peer_id: String,
    pub failed_at: DateTime<Utc>,
    pub error_message: String,
    pub retry_count: u32,
    #[serde(default)]
    pub multiaddr: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DaemonStats {
    pub total_manifests_processed: u64,
    pub total_files_downloaded: u64,
    pub total_bytes_downloaded: u64,
    pub total_files_deleted: u64,
    pub last_activity_at: Option<DateTime<Utc>>,
}

impl Default for DaemonState {
    fn default() -> Self {
        Self {
            processed_manifests: HashMap::new(),
            in_progress_manifests: HashMap::new(),
            failed_manifests: Vec::new(),
            last_poll_time: Utc::now(),
            stats: DaemonStats::default(),
        }
    }
}

/// Manifest file structure (JSON) - must match primary peer's ManifestFile
#[derive(Debug, Clone, Serialize, Deserialize)]
struct ManifestFile {
    pub version: String,
    pub folder_id: String,
    pub folder_path: String,
    pub source_peer_id: String,
    pub sequence_number: u64,
    pub last_updated: DateTime<Utc>,
    pub manifest_cid: Option<String>,
    pub files: Vec<ManifestFileEntry>,
    pub deleted_files: Vec<ManifestDeletedEntry>,
    pub stats: ManifestStats,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ManifestFileEntry {
    pub path: String,
    pub cid: String,
    pub size_bytes: u64,
    pub mime_type: Option<String>,
    pub uploaded_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ManifestDeletedEntry {
    pub path: String,
    pub cid: String,
    pub deleted_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ManifestStats {
    pub total_files: u32,
    pub total_size_bytes: u64,
}

/// Manifest CID discovered from source peer
#[derive(Debug, Clone)]
#[allow(dead_code)]
struct DiscoveredManifest {
    pub cid: String,
    pub folder_id: String,
    pub sequence_number: u64,
    pub source_peer_id: String,
    pub source_host: String,
    pub multiaddr: Option<String>,
}

/// Result of file download operations
#[derive(Debug)]
#[allow(dead_code)]
struct DownloadResult {
    pub downloaded: u32,
    pub failed: u32,
    pub skipped_existing: u32,
}

/// Result of deletion operations
#[derive(Debug)]
#[allow(dead_code)]
struct DeletionResult {
    pub deleted: u32,
    pub failed: u32,
    pub not_found: u32,
}

/// Backup daemon for automatic manifest processing
pub struct BackupDaemon {
    api_client: NodeApiClient,
    manifest_client: ManifestClient,
    state: Arc<RwLock<DaemonState>>,
    state_file_path: PathBuf,
    enabled: Arc<AtomicBool>,
    poll_interval_secs: u64,
    max_concurrent_downloads: u32,
    max_retries: u32,
    auto_delete_tombstones: bool,
    /// Source peers to poll for manifests
    source_peers: Arc<RwLock<Vec<SourcePeerConfig>>>,
    /// Port for HTTP trigger server
    trigger_port: u16,
    /// Channel to send trigger signals to the main loop
    trigger_tx: mpsc::Sender<()>,
    /// Channel to receive trigger signals (held by main loop)
    trigger_rx: Arc<RwLock<mpsc::Receiver<()>>>,
}

impl BackupDaemon {
    /// Create a new backup daemon
    pub fn new(
        api_client: NodeApiClient,
        enabled: bool,
        poll_interval_secs: u64,
        max_concurrent_downloads: u32,
        max_retries: u32,
        auto_delete_tombstones: bool,
        trigger_port: u16,
    ) -> Self {
        let state_path = dirs::data_dir()
            .map(|p| p.join("archivist").join("backup-daemon-state.json"))
            .unwrap_or_else(|| PathBuf::from("backup-daemon-state.json"));

        let state = Self::load_state(&state_path).unwrap_or_default();

        // Create trigger channel (buffer of 10 to avoid blocking)
        let (trigger_tx, trigger_rx) = mpsc::channel(10);

        Self {
            api_client,
            manifest_client: ManifestClient::new(),
            state: Arc::new(RwLock::new(state)),
            state_file_path: state_path,
            enabled: Arc::new(AtomicBool::new(enabled)),
            poll_interval_secs,
            max_concurrent_downloads,
            max_retries,
            auto_delete_tombstones,
            source_peers: Arc::new(RwLock::new(Vec::new())),
            trigger_port,
            trigger_tx,
            trigger_rx: Arc::new(RwLock::new(trigger_rx)),
        }
    }

    /// Update source peers configuration
    pub async fn set_source_peers(&self, peers: Vec<SourcePeerConfig>) {
        let mut source_peers = self.source_peers.write().await;
        *source_peers = peers;
        log::info!("Updated source peers: {} configured", source_peers.len());
    }

    /// Add a source peer
    #[allow(dead_code)]
    pub async fn add_source_peer(&self, peer: SourcePeerConfig) {
        let mut source_peers = self.source_peers.write().await;
        source_peers.push(peer);
        log::info!("Added source peer, now {} configured", source_peers.len());
    }

    /// Load state from disk
    fn load_state(path: &Path) -> Result<DaemonState> {
        if !path.exists() {
            log::info!("No existing daemon state found, starting fresh");
            return Ok(DaemonState::default());
        }

        let contents = std::fs::read_to_string(path).map_err(|e| {
            ArchivistError::FileOperationFailed(format!("Failed to read daemon state: {}", e))
        })?;

        let state: DaemonState =
            serde_json::from_str(&contents).map_err(ArchivistError::SerializationError)?;

        log::info!(
            "Loaded daemon state: {} processed, {} in-progress, {} failed",
            state.processed_manifests.len(),
            state.in_progress_manifests.len(),
            state.failed_manifests.len()
        );

        Ok(state)
    }

    /// Save state to disk
    async fn save_state(&self) -> Result<()> {
        let state = self.state.read().await;

        // Ensure parent directory exists
        if let Some(parent) = self.state_file_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                ArchivistError::FileOperationFailed(format!(
                    "Failed to create state directory: {}",
                    e
                ))
            })?;
        }

        let json =
            serde_json::to_string_pretty(&*state).map_err(ArchivistError::SerializationError)?;

        std::fs::write(&self.state_file_path, json).map_err(|e| {
            ArchivistError::FileOperationFailed(format!("Failed to write daemon state: {}", e))
        })?;

        Ok(())
    }

    /// Get current daemon state (for UI)
    pub async fn get_state(&self) -> DaemonState {
        self.state.read().await.clone()
    }

    /// Enable the daemon
    pub fn enable(&self) {
        self.enabled.store(true, Ordering::Relaxed);
        log::info!("Backup daemon enabled");
    }

    /// Disable the daemon
    pub fn disable(&self) {
        self.enabled.store(false, Ordering::Relaxed);
        log::info!("Backup daemon disabled");
    }

    /// Check if daemon is enabled
    pub fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::Relaxed)
    }

    /// Get the trigger port
    pub fn get_trigger_port(&self) -> u16 {
        self.trigger_port
    }

    /// Trigger an immediate poll cycle
    pub async fn trigger_poll(&self) -> Result<()> {
        log::info!("Received trigger to poll immediately");
        self.trigger_tx
            .send(())
            .await
            .map_err(|e| ArchivistError::SyncError(format!("Failed to send trigger: {}", e)))?;
        Ok(())
    }

    /// Start the HTTP trigger server (runs in background)
    pub async fn start_trigger_server(self: Arc<Self>) {
        let port = self.trigger_port;
        let daemon = self.clone();

        // POST /trigger - triggers immediate poll
        let trigger_route = warp::path("trigger")
            .and(warp::post())
            .and(warp::any().map(move || daemon.clone()))
            .and_then(|daemon: Arc<BackupDaemon>| async move {
                match daemon.trigger_poll().await {
                    Ok(_) => {
                        log::info!("Trigger request received and processed");
                        Ok::<_, warp::Rejection>(warp::reply::json(&serde_json::json!({
                            "status": "ok",
                            "message": "Poll triggered"
                        })))
                    }
                    Err(e) => {
                        log::error!("Trigger request failed: {}", e);
                        Ok(warp::reply::json(&serde_json::json!({
                            "status": "error",
                            "message": format!("{}", e)
                        })))
                    }
                }
            });

        // GET /health - health check
        let health_route = warp::path("health")
            .and(warp::get())
            .map(|| warp::reply::json(&serde_json::json!({"status": "ok"})));

        let routes = trigger_route.or(health_route);

        log::info!("Starting backup daemon trigger server on port {}", port);

        // Run server (this blocks, so it should be spawned)
        warp::serve(routes).run(([0, 0, 0, 0], port)).await;
    }

    /// Discover new manifests by polling source peers
    async fn discover_manifests(&self) -> Result<Vec<DiscoveredManifest>> {
        log::debug!("Polling source peers for manifests");

        let source_peers = self.source_peers.read().await;
        let mut discovered = Vec::new();

        for peer in source_peers.iter() {
            if !peer.enabled {
                continue;
            }

            log::debug!(
                "Polling source peer: {} ({}:{})",
                peer.nickname,
                peer.host,
                peer.manifest_port
            );

            match self
                .manifest_client
                .fetch_manifests(&peer.host, peer.manifest_port)
                .await
            {
                Ok(response) => {
                    log::info!(
                        "Received {} manifests from {} (peer {})",
                        response.manifests.len(),
                        peer.nickname,
                        response.peer_id
                    );

                    for manifest in response.manifests {
                        discovered.push(DiscoveredManifest {
                            cid: manifest.manifest_cid,
                            folder_id: manifest.folder_id,
                            sequence_number: manifest.sequence_number,
                            source_peer_id: response.peer_id.clone(),
                            source_host: peer.host.clone(),
                            multiaddr: peer.multiaddr.clone(),
                        });
                    }
                }
                Err(e) => {
                    log::warn!(
                        "Failed to poll source peer {} ({}:{}): {}",
                        peer.nickname,
                        peer.host,
                        peer.manifest_port,
                        e
                    );
                }
            }
        }

        log::debug!(
            "Discovered {} manifests from source peers",
            discovered.len()
        );
        Ok(discovered)
    }

    /// Filter manifests to only those not yet processed
    async fn filter_unprocessed(
        &self,
        manifests: Vec<DiscoveredManifest>,
    ) -> Vec<DiscoveredManifest> {
        let state = self.state.read().await;
        manifests
            .into_iter()
            .filter(|m| !state.processed_manifests.contains_key(&m.cid))
            .filter(|m| !state.in_progress_manifests.contains_key(&m.cid))
            .collect()
    }

    /// Process a single manifest (download from network if needed)
    async fn process_manifest(
        &self,
        manifest_cid: &str,
        peer_id: Option<&str>,
        multiaddr: Option<&str>,
    ) -> Result<()> {
        log::info!("Processing manifest: {}", manifest_cid);

        // 0. Connect to source peer if multiaddr is provided (required for network download)
        if let (Some(pid), Some(addr)) = (peer_id, multiaddr) {
            log::info!(
                "Connecting to source peer {} at {} before network download",
                pid,
                addr
            );
            if let Err(e) = self.api_client.connect_peer(pid, addr).await {
                log::warn!(
                    "Failed to connect to peer {}: {} (will try download anyway)",
                    pid,
                    e
                );
            } else {
                log::info!("Successfully connected to source peer {}", pid);
            }
        }

        // 1. Try to download manifest from local storage first, then from network
        let manifest_bytes = match self.api_client.download_file(manifest_cid).await {
            Ok(bytes) => {
                log::debug!("Manifest {} found in local storage", manifest_cid);
                bytes
            }
            Err(_) => {
                log::info!(
                    "Manifest {} not in local storage, fetching from network",
                    manifest_cid
                );
                self.api_client
                    .request_network_download(manifest_cid)
                    .await?;
                self.api_client.download_file(manifest_cid).await?
            }
        };

        let manifest_json = String::from_utf8(manifest_bytes)
            .map_err(|e| ArchivistError::SyncError(format!("Invalid UTF-8 in manifest: {}", e)))?;
        let manifest: ManifestFile = serde_json::from_str(&manifest_json)?;

        log::info!(
            "Manifest from peer {} folder {} sequence {} with {} files",
            manifest.source_peer_id,
            manifest.folder_id,
            manifest.sequence_number,
            manifest.files.len()
        );

        // 2. Validate sequence number (check for gaps)
        self.validate_sequence_number(&manifest).await?;

        // 3. Mark as in-progress
        {
            let mut state = self.state.write().await;
            state.in_progress_manifests.insert(
                manifest_cid.to_string(),
                InProgressManifest {
                    manifest_cid: manifest_cid.to_string(),
                    source_peer_id: manifest.source_peer_id.clone(),
                    sequence_number: manifest.sequence_number,
                    started_at: Utc::now(),
                    total_files: manifest.files.len() as u32,
                    files_downloaded: 0,
                    files_failed: 0,
                    current_status: "Downloading files".to_string(),
                },
            );
        }
        self.save_state().await?;

        // 4. Download all files
        let download_result = self.download_manifest_files(&manifest).await;

        // 5. Enforce deletions (if enabled)
        let deletion_result = if self.auto_delete_tombstones {
            self.enforce_deletions(&manifest).await
        } else {
            Ok(DeletionResult {
                deleted: 0,
                failed: 0,
                not_found: 0,
            })
        };

        // 6. Mark as processed (or failed)
        self.finalize_manifest_processing(
            manifest_cid,
            &manifest,
            download_result,
            deletion_result,
            multiaddr,
        )
        .await?;

        Ok(())
    }

    /// Validate sequence number to detect gaps
    async fn validate_sequence_number(&self, manifest: &ManifestFile) -> Result<()> {
        let state = self.state.read().await;

        // Find last processed manifest from this source peer + folder
        let last_seq = state
            .processed_manifests
            .values()
            .filter(|m| m.source_peer_id == manifest.source_peer_id)
            .filter(|m| m.folder_id == manifest.folder_id)
            .map(|m| m.sequence_number)
            .max();

        if let Some(last) = last_seq {
            let expected = last + 1;
            if manifest.sequence_number > expected {
                log::warn!(
                    "Sequence gap detected for peer {} folder {}: expected {}, got {} (gap of {})",
                    manifest.source_peer_id,
                    manifest.folder_id,
                    expected,
                    manifest.sequence_number,
                    manifest.sequence_number - expected
                );
                // Log warning but continue (eventually consistent)
            }
        }

        Ok(())
    }

    /// Download all files referenced in manifest
    async fn download_manifest_files(&self, manifest: &ManifestFile) -> Result<DownloadResult> {
        let mut downloaded = 0;
        let mut failed = 0;
        let mut skipped_existing = 0;

        log::info!("Downloading {} files from manifest", manifest.files.len());

        // Process files in batches (respect max_concurrent_downloads)
        for (batch_num, chunk) in manifest
            .files
            .chunks(self.max_concurrent_downloads as usize)
            .enumerate()
        {
            log::debug!("Processing batch {} ({} files)", batch_num + 1, chunk.len());

            let mut tasks = Vec::new();

            for file in chunk {
                // Check if file already exists locally
                let exists = self.check_file_exists(&file.cid).await;

                if exists {
                    skipped_existing += 1;
                    log::debug!("File already exists: {} ({})", file.path, file.cid);
                    continue;
                }

                // Download from network
                let api_client = self.api_client.clone();
                let cid = file.cid.clone();
                let path = file.path.clone();

                let task = tokio::spawn(async move {
                    match api_client.request_network_download(&cid).await {
                        Ok(()) => {
                            log::info!("Downloaded: {} ({})", path, cid);
                            Ok(())
                        }
                        Err(e) => {
                            log::error!("Failed to download {} ({}): {}", path, cid, e);
                            Err(e)
                        }
                    }
                });

                tasks.push(task);
            }

            // Wait for batch to complete
            for task in tasks {
                match task.await {
                    Ok(Ok(())) => downloaded += 1,
                    Ok(Err(_)) | Err(_) => failed += 1,
                }
            }

            // Update progress
            {
                let mut state = self.state.write().await;
                if let Some(manifest_cid_str) = &manifest.manifest_cid {
                    if let Some(progress) = state.in_progress_manifests.get_mut(manifest_cid_str) {
                        progress.files_downloaded = downloaded + skipped_existing;
                        progress.files_failed = failed;
                    }
                }
            }
            self.save_state().await?;
        }

        log::info!(
            "Download complete: {} downloaded, {} skipped (existing), {} failed",
            downloaded,
            skipped_existing,
            failed
        );

        Ok(DownloadResult {
            downloaded,
            failed,
            skipped_existing,
        })
    }

    /// Check if a file CID exists in local storage
    async fn check_file_exists(&self, cid: &str) -> bool {
        match self.api_client.list_data().await {
            Ok(data_list) => data_list.content.iter().any(|item| item.cid == cid),
            Err(e) => {
                log::warn!("Failed to check file existence for {}: {}", cid, e);
                false
            }
        }
    }

    /// Enforce deletions from manifest tombstones
    async fn enforce_deletions(&self, manifest: &ManifestFile) -> Result<DeletionResult> {
        let mut deleted = 0;
        let mut failed = 0;
        let mut not_found = 0;

        if manifest.deleted_files.is_empty() {
            log::debug!("No deletions to enforce");
            return Ok(DeletionResult {
                deleted,
                failed,
                not_found,
            });
        }

        log::info!(
            "Enforcing {} deletions from manifest",
            manifest.deleted_files.len()
        );

        for tombstone in &manifest.deleted_files {
            log::info!(
                "Processing deletion: {} ({})",
                tombstone.path,
                tombstone.cid
            );

            // Check if file exists locally
            let exists = self.check_file_exists(&tombstone.cid).await;

            if !exists {
                not_found += 1;
                log::debug!("File not found (already deleted?): {}", tombstone.cid);
                continue;
            }

            // Delete file
            match self.api_client.delete_file(&tombstone.cid).await {
                Ok(_) => {
                    deleted += 1;
                    log::info!("Deleted: {} ({})", tombstone.path, tombstone.cid);
                }
                Err(e) => {
                    failed += 1;
                    log::error!(
                        "Failed to delete {} ({}): {}",
                        tombstone.path,
                        tombstone.cid,
                        e
                    );
                }
            }
        }

        log::info!(
            "Deletion complete: {} deleted, {} not found, {} failed",
            deleted,
            not_found,
            failed
        );

        Ok(DeletionResult {
            deleted,
            failed,
            not_found,
        })
    }

    /// Finalize manifest processing (success or failure)
    async fn finalize_manifest_processing(
        &self,
        manifest_cid: &str,
        manifest: &ManifestFile,
        download_result: Result<DownloadResult>,
        deletion_result: Result<DeletionResult>,
        multiaddr: Option<&str>,
    ) -> Result<()> {
        let mut state = self.state.write().await;

        // Remove from in-progress
        state.in_progress_manifests.remove(manifest_cid);

        match (download_result, deletion_result) {
            (Ok(dl), Ok(del)) => {
                // Success - mark as processed
                state.processed_manifests.insert(
                    manifest_cid.to_string(),
                    ProcessedManifest {
                        manifest_cid: manifest_cid.to_string(),
                        source_peer_id: manifest.source_peer_id.clone(),
                        sequence_number: manifest.sequence_number,
                        folder_id: manifest.folder_id.clone(),
                        processed_at: Utc::now(),
                        file_count: dl.downloaded + dl.skipped_existing,
                        total_size_bytes: manifest.stats.total_size_bytes,
                        deleted_count: del.deleted,
                    },
                );

                // Update stats
                state.stats.total_manifests_processed += 1;
                state.stats.total_files_downloaded += dl.downloaded as u64;
                state.stats.total_files_deleted += del.deleted as u64;
                state.stats.last_activity_at = Some(Utc::now());

                log::info!(
                    "Manifest processed successfully: {} (seq {}, {} files, {} deleted)",
                    manifest_cid,
                    manifest.sequence_number,
                    dl.downloaded + dl.skipped_existing,
                    del.deleted
                );
            }
            (Err(e), _) | (_, Err(e)) => {
                // Failure - mark for retry
                state.failed_manifests.push(FailedManifest {
                    manifest_cid: manifest_cid.to_string(),
                    source_peer_id: manifest.source_peer_id.clone(),
                    failed_at: Utc::now(),
                    error_message: e.to_string(),
                    retry_count: 0,
                    multiaddr: multiaddr.map(|s| s.to_string()),
                });

                log::error!("Manifest processing failed: {} - {}", manifest_cid, e);
            }
        }

        drop(state);
        self.save_state().await?;
        Ok(())
    }

    /// Start the backup daemon background loop
    pub async fn start(self: Arc<Self>) {
        log::info!(
            "Starting backup daemon (poll interval: {}s, max concurrent downloads: {}, trigger port: {})",
            self.poll_interval_secs,
            self.max_concurrent_downloads,
            self.trigger_port
        );

        loop {
            // Check if daemon is enabled
            if !self.is_enabled() {
                tokio::time::sleep(Duration::from_secs(10)).await;
                continue;
            }

            // Main processing cycle
            match self.run_cycle().await {
                Ok(processed_count) => {
                    if processed_count > 0 {
                        log::info!("Processed {} manifests this cycle", processed_count);
                    }
                }
                Err(e) => {
                    log::error!("Daemon cycle error: {}", e);
                }
            }

            // Wait for next cycle OR trigger signal
            let poll_interval = Duration::from_secs(self.poll_interval_secs);
            let mut trigger_rx = self.trigger_rx.write().await;

            tokio::select! {
                _ = tokio::time::sleep(poll_interval) => {
                    // Normal poll interval elapsed
                    log::debug!("Poll interval elapsed, running cycle");
                }
                Some(_) = trigger_rx.recv() => {
                    // Trigger received - run immediately
                    log::info!("Trigger received, running cycle immediately");
                }
            }
        }
    }

    /// Run one processing cycle
    async fn run_cycle(&self) -> Result<u32> {
        // 1. Discover manifests
        let all_manifests = self.discover_manifests().await?;

        // 2. Filter unprocessed
        let unprocessed = self.filter_unprocessed(all_manifests).await;

        if unprocessed.is_empty() {
            log::debug!("No new manifests to process");
        } else {
            log::info!("Found {} unprocessed manifests", unprocessed.len());
        }

        // 3. Process each manifest
        for manifest in &unprocessed {
            match self
                .process_manifest(
                    &manifest.cid,
                    Some(&manifest.source_peer_id),
                    manifest.multiaddr.as_deref(),
                )
                .await
            {
                Ok(_) => {
                    log::info!("Successfully processed manifest: {}", manifest.cid);
                }
                Err(e) => {
                    log::error!("Failed to process manifest {}: {}", manifest.cid, e);
                    // Store as failed with multiaddr for retry
                    let mut state = self.state.write().await;
                    state.failed_manifests.push(FailedManifest {
                        manifest_cid: manifest.cid.clone(),
                        source_peer_id: manifest.source_peer_id.clone(),
                        failed_at: Utc::now(),
                        error_message: e.to_string(),
                        retry_count: 0,
                        multiaddr: manifest.multiaddr.clone(),
                    });
                }
            }
        }

        // 4. Retry failed manifests (if retry count < max)
        self.retry_failed_manifests().await?;

        // 5. Update last poll time
        {
            let mut state = self.state.write().await;
            state.last_poll_time = Utc::now();
        }
        self.save_state().await?;

        Ok(unprocessed.len() as u32)
    }

    /// Retry manifests that previously failed
    async fn retry_failed_manifests(&self) -> Result<()> {
        let mut state = self.state.write().await;
        let mut to_retry = Vec::new();

        // Find manifests eligible for retry (retry_count < max_retries)
        state.failed_manifests.retain(|m| {
            if m.retry_count < self.max_retries {
                to_retry.push(m.clone());
                false // Remove from failed list
            } else {
                log::warn!(
                    "Manifest {} exceeded max retries ({}), giving up",
                    m.manifest_cid,
                    self.max_retries
                );
                true // Keep (exceeded max retries)
            }
        });

        drop(state);

        if !to_retry.is_empty() {
            log::info!("Retrying {} failed manifests", to_retry.len());
        }

        // Retry each
        for mut failed in to_retry {
            log::info!(
                "Retrying failed manifest: {} (attempt {}/{})",
                failed.manifest_cid,
                failed.retry_count + 1,
                self.max_retries
            );

            match self
                .process_manifest(
                    &failed.manifest_cid,
                    Some(&failed.source_peer_id),
                    failed.multiaddr.as_deref(),
                )
                .await
            {
                Ok(_) => {
                    // Success - already marked as processed in finalize_manifest_processing
                    log::info!("Retry succeeded for manifest: {}", failed.manifest_cid);
                }
                Err(e) => {
                    // Failed again - increment retry count
                    failed.retry_count += 1;
                    failed.error_message = e.to_string();
                    failed.failed_at = Utc::now();

                    let mut state = self.state.write().await;
                    state.failed_manifests.push(failed);
                }
            }
        }

        self.save_state().await?;
        Ok(())
    }

    /// Manually retry a specific failed manifest
    pub async fn retry_manifest(&self, manifest_cid: &str) -> Result<()> {
        log::info!("Manual retry requested for manifest: {}", manifest_cid);

        // Find and remove from failed list, capturing peer info
        let mut state = self.state.write().await;
        let failed_info = state
            .failed_manifests
            .iter()
            .find(|m| m.manifest_cid == manifest_cid)
            .map(|m| (m.source_peer_id.clone(), m.multiaddr.clone()));
        state
            .failed_manifests
            .retain(|m| m.manifest_cid != manifest_cid);
        drop(state);

        // Process manifest with peer info if available
        let (peer_id, multiaddr) = failed_info.unwrap_or_default();
        self.process_manifest(
            manifest_cid,
            if peer_id.is_empty() {
                None
            } else {
                Some(peer_id.as_str())
            },
            multiaddr.as_deref(),
        )
        .await?;

        Ok(())
    }

    /// Pause the daemon (disable processing)
    pub async fn pause(&self) -> Result<()> {
        self.disable();
        log::info!("Backup daemon paused");
        Ok(())
    }

    /// Resume the daemon (enable processing)
    pub async fn resume(&self) -> Result<()> {
        self.enable();
        log::info!("Backup daemon resumed");
        Ok(())
    }
}
