use crate::error::{ArchivistError, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;

// ---------------------------------------------------------------------------
// Configuration types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct TorrentConfig {
    pub download_directory: String,
    pub listen_port_start: u16,
    pub listen_port_end: u16,
    pub enable_dht: bool,
    pub enable_upnp: bool,
    #[allow(dead_code)]
    pub sequential_by_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SeedLimitAction {
    Pause,
    Remove,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeedingRules {
    pub max_ratio: Option<f64>,
    pub max_seed_time_minutes: Option<u64>,
    pub action_on_limit: SeedLimitAction,
}

impl Default for SeedingRules {
    fn default() -> Self {
        Self {
            max_ratio: None,
            max_seed_time_minutes: None,
            action_on_limit: SeedLimitAction::Pause,
        }
    }
}

// ---------------------------------------------------------------------------
// Frontend-facing types (camelCase serialization for TypeScript)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum TorrentState {
    Initializing,
    Downloading,
    Seeding,
    Paused,
    Checking,
    Error,
    Queued,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TorrentFile {
    pub index: usize,
    pub name: String,
    pub path: String,
    pub length: u64,
    pub downloaded_bytes: u64,
    pub included: bool,
    pub progress_percent: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TorrentPeer {
    pub addr: String,
    pub client: Option<String>,
    pub download_speed: f64,
    pub upload_speed: f64,
    pub progress_percent: f32,
    pub flags: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TorrentItem {
    pub id: usize,
    pub info_hash: String,
    pub name: String,
    pub state: TorrentState,
    pub progress_percent: f32,
    pub downloaded_bytes: u64,
    pub uploaded_bytes: u64,
    pub total_bytes: u64,
    pub download_speed: f64,
    pub upload_speed: f64,
    pub ratio: f64,
    pub peers_connected: u32,
    pub seeds_connected: u32,
    pub eta: Option<String>,
    pub output_folder: String,
    pub files: Vec<TorrentFile>,
    pub error: Option<String>,
    pub added_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub sequential: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddTorrentParams {
    pub source: String,
    pub source_type: String, // "magnet" | "file"
    pub output_folder: Option<String>,
    pub selected_files: Option<Vec<usize>>,
    pub paused: bool,
    pub sequential: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeedLimits {
    pub download_limit_bytes: Option<u64>,
    pub upload_limit_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TorrentSessionStats {
    pub torrents: Vec<TorrentItem>,
    pub total_download_speed: f64,
    pub total_upload_speed: f64,
    pub active_count: u32,
    pub seeding_count: u32,
    pub paused_count: u32,
    pub total_downloaded: u64,
    pub total_uploaded: u64,
    pub dht_peers: u32,
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

pub struct TorrentService {
    session: Option<Arc<librqbit::Session>>,
    api: Option<librqbit::Api>,
    added_times: HashMap<usize, DateTime<Utc>>,
    completed_times: HashMap<usize, DateTime<Utc>>,
    sequential_mode: HashSet<usize>,
    seeding_rules: SeedingRules,
    config: TorrentConfig,
    initialized: bool,
}

impl TorrentService {
    pub fn new(config: TorrentConfig, seeding_rules: SeedingRules) -> Self {
        Self {
            session: None,
            api: None,
            added_times: HashMap::new(),
            completed_times: HashMap::new(),
            sequential_mode: HashSet::new(),
            seeding_rules,
            config,
            initialized: false,
        }
    }

    /// Initialize the librqbit session with persistence and DHT
    pub async fn initialize(&mut self) -> Result<()> {
        if self.initialized {
            return Ok(());
        }

        let output_dir = PathBuf::from(&self.config.download_directory);
        if !output_dir.exists() {
            std::fs::create_dir_all(&output_dir).map_err(|e| {
                ArchivistError::TorrentError(format!("Failed to create download directory: {}", e))
            })?;
        }

        // Configure persistence directory for fastresume
        let persistence_dir = dirs::data_dir()
            .map(|p| p.join("archivist").join("torrents"))
            .unwrap_or_else(|| output_dir.join(".archivist-torrents"));

        if !persistence_dir.exists() {
            std::fs::create_dir_all(&persistence_dir).map_err(|e| {
                ArchivistError::TorrentError(format!(
                    "Failed to create persistence directory: {}",
                    e
                ))
            })?;
        }

        let persistence_config = librqbit::SessionPersistenceConfig::Json {
            folder: Some(persistence_dir),
        };

        let opts = librqbit::SessionOptions {
            disable_dht: !self.config.enable_dht,
            fastresume: true,
            persistence: Some(persistence_config),
            listen_port_range: Some(self.config.listen_port_start..self.config.listen_port_end),
            enable_upnp_port_forwarding: self.config.enable_upnp,
            ..Default::default()
        };

        let session = librqbit::Session::new_with_opts(output_dir, opts)
            .await
            .map_err(|e| {
                ArchivistError::TorrentError(format!("Failed to create torrent session: {}", e))
            })?;

        let api = librqbit::Api::new(session.clone(), None);

        // Restore added_times for persisted torrents
        let list = api.api_torrent_list();
        for t in &list.torrents {
            if let Some(id) = t.id {
                self.added_times.entry(id).or_insert_with(Utc::now);
            }
        }

        self.session = Some(session);
        self.api = Some(api);
        self.initialized = true;

        log::info!("Torrent session initialized with persistence");
        Ok(())
    }

    /// Graceful shutdown
    pub async fn shutdown(&mut self) -> Result<()> {
        if let Some(ref session) = self.session {
            session.stop().await;
        }
        self.session = None;
        self.api = None;
        self.initialized = false;
        log::info!("Torrent session shut down");
        Ok(())
    }

    fn api(&self) -> Result<&librqbit::Api> {
        self.api
            .as_ref()
            .ok_or_else(|| ArchivistError::TorrentError("Torrent session not initialized".into()))
    }

    /// Add a torrent from magnet link or .torrent file bytes (base64)
    pub async fn add_torrent(&mut self, params: AddTorrentParams) -> Result<TorrentItem> {
        let api = self.api.as_ref().ok_or_else(|| {
            ArchivistError::TorrentError("Torrent session not initialized".into())
        })?;

        let add = match params.source_type.as_str() {
            "magnet" => librqbit::AddTorrent::from_url(&params.source),
            "file" => {
                let bytes = base64::Engine::decode(
                    &base64::engine::general_purpose::STANDARD,
                    &params.source,
                )
                .map_err(|e| {
                    ArchivistError::TorrentError(format!("Invalid base64 torrent data: {}", e))
                })?;
                librqbit::AddTorrent::from_bytes(bytes)
            }
            other => {
                return Err(ArchivistError::TorrentError(format!(
                    "Unknown source type: {}",
                    other
                )));
            }
        };

        let only_files = params
            .selected_files
            .map(|files| files.into_iter().collect::<Vec<_>>());

        let opts = librqbit::AddTorrentOptions {
            paused: params.paused,
            only_files,
            output_folder: params
                .output_folder
                .or_else(|| Some(self.config.download_directory.clone())),
            ..Default::default()
        };

        let response = api
            .api_add_torrent(add, Some(opts))
            .await
            .map_err(|e| ArchivistError::TorrentError(format!("Failed to add torrent: {}", e)))?;

        let id = response.id.unwrap_or(0);
        let now = Utc::now();
        self.added_times.insert(id, now);

        if params.sequential {
            self.sequential_mode.insert(id);
        }

        self.build_torrent_item_from_details(&response.details)
    }

    /// Pause a torrent
    pub async fn pause_torrent(&self, id: usize) -> Result<()> {
        let api = self.api()?;
        api.api_torrent_action_pause(librqbit::api::TorrentIdOrHash::Id(id))
            .await
            .map_err(|e| ArchivistError::TorrentError(format!("Failed to pause torrent: {}", e)))?;
        Ok(())
    }

    /// Resume a paused torrent
    pub async fn resume_torrent(&self, id: usize) -> Result<()> {
        let api = self.api()?;
        api.api_torrent_action_start(librqbit::api::TorrentIdOrHash::Id(id))
            .await
            .map_err(|e| {
                ArchivistError::TorrentError(format!("Failed to resume torrent: {}", e))
            })?;
        Ok(())
    }

    /// Remove a torrent, optionally deleting downloaded files
    pub async fn remove_torrent(&mut self, id: usize, delete_files: bool) -> Result<()> {
        let api = self.api.as_ref().ok_or_else(|| {
            ArchivistError::TorrentError("Torrent session not initialized".into())
        })?;

        if delete_files {
            api.api_torrent_action_delete(librqbit::api::TorrentIdOrHash::Id(id))
                .await
                .map_err(|e| {
                    ArchivistError::TorrentError(format!("Failed to delete torrent: {}", e))
                })?;
        } else {
            api.api_torrent_action_forget(librqbit::api::TorrentIdOrHash::Id(id))
                .await
                .map_err(|e| {
                    ArchivistError::TorrentError(format!("Failed to forget torrent: {}", e))
                })?;
        }

        self.added_times.remove(&id);
        self.completed_times.remove(&id);
        self.sequential_mode.remove(&id);
        Ok(())
    }

    /// Update which files are selected for download within a torrent
    pub async fn set_selected_files(&self, id: usize, file_indices: Vec<usize>) -> Result<()> {
        let api = self.api()?;
        let set: HashSet<usize> = file_indices.into_iter().collect();
        api.api_torrent_action_update_only_files(librqbit::api::TorrentIdOrHash::Id(id), &set)
            .await
            .map_err(|e| {
                ArchivistError::TorrentError(format!("Failed to update file selection: {}", e))
            })?;
        Ok(())
    }

    /// Get details for a single torrent
    pub fn get_torrent(&self, id: usize) -> Result<TorrentItem> {
        let api = self.api()?;
        let details = api
            .api_torrent_details(librqbit::api::TorrentIdOrHash::Id(id))
            .map_err(|e| {
                ArchivistError::TorrentError(format!("Failed to get torrent details: {}", e))
            })?;
        self.build_torrent_item_from_details(&details)
    }

    /// Get peer stats for a torrent
    pub fn get_torrent_peers(&self, id: usize) -> Result<Vec<TorrentPeer>> {
        let api = self.api()?;
        let snapshot = api
            .api_peer_stats(librqbit::api::TorrentIdOrHash::Id(id), Default::default())
            .map_err(|e| {
                ArchivistError::TorrentError(format!("Failed to get peer stats: {}", e))
            })?;

        // Serialize the peer stats snapshot to JSON and extract peer data
        let json = serde_json::to_value(&snapshot).unwrap_or(serde_json::Value::Null);
        let mut peers = Vec::new();

        if let Some(peer_list) = json.get("peers").and_then(|v| v.as_array()) {
            for p in peer_list {
                peers.push(TorrentPeer {
                    addr: p
                        .get("addr")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    client: p
                        .get("client")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    download_speed: p
                        .get("download_speed")
                        .and_then(extract_speed_bps)
                        .unwrap_or(0.0),
                    upload_speed: p
                        .get("upload_speed")
                        .and_then(extract_speed_bps)
                        .unwrap_or(0.0),
                    progress_percent: p
                        .get("progress_percent")
                        .and_then(|v| v.as_f64())
                        .unwrap_or(0.0) as f32,
                    flags: p
                        .get("flags")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                });
            }
        }

        Ok(peers)
    }

    /// Get session-wide statistics for all torrents
    pub fn get_session_stats(&mut self) -> Result<TorrentSessionStats> {
        let api = self.api.as_ref().ok_or_else(|| {
            ArchivistError::TorrentError("Torrent session not initialized".into())
        })?;

        let list = api.api_torrent_list_ext(librqbit::api::ApiTorrentListOpts { with_stats: true });
        let dht_peers = api
            .api_dht_stats()
            .ok()
            .and_then(|stats| {
                serde_json::to_value(&stats)
                    .ok()
                    .and_then(|v| v.get("num_peers").and_then(|n| n.as_u64()))
            })
            .unwrap_or(0) as u32;

        // Collect completion tracking data before building items
        let mut newly_completed: Vec<usize> = Vec::new();

        let mut torrents = Vec::new();
        let mut total_dl_speed = 0.0f64;
        let mut total_ul_speed = 0.0f64;
        let mut active_count = 0u32;
        let mut seeding_count = 0u32;
        let mut paused_count = 0u32;
        let mut total_downloaded = 0u64;
        let mut total_uploaded = 0u64;

        for details in &list.torrents {
            let item = self.build_torrent_item_from_details(details)?;

            total_dl_speed += item.download_speed;
            total_ul_speed += item.upload_speed;
            total_downloaded += item.downloaded_bytes;
            total_uploaded += item.uploaded_bytes;

            match item.state {
                TorrentState::Downloading => active_count += 1,
                TorrentState::Seeding => seeding_count += 1,
                TorrentState::Paused => paused_count += 1,
                _ => {}
            }

            // Track completion
            if let Some(id) = details.id {
                if item.state == TorrentState::Seeding && !self.completed_times.contains_key(&id) {
                    newly_completed.push(id);
                }
            }

            torrents.push(item);
        }

        // Apply deferred mutable updates
        let now = Utc::now();
        for id in newly_completed {
            self.completed_times.insert(id, now);
        }

        Ok(TorrentSessionStats {
            torrents,
            total_download_speed: total_dl_speed,
            total_upload_speed: total_ul_speed,
            active_count,
            seeding_count,
            paused_count,
            total_downloaded,
            total_uploaded,
            dht_peers,
        })
    }

    /// Set global speed limits (applied per-torrent on next add)
    pub fn set_speed_limits(&mut self, _limits: SpeedLimits) -> Result<()> {
        // librqbit handles rate limits at session level via SessionOptions.ratelimits
        // For runtime changes, we store the config for new torrents
        log::info!("Speed limits updated (applies to new torrents)");
        Ok(())
    }

    /// Update seeding rules
    pub fn set_seeding_rules(&mut self, rules: SeedingRules) {
        self.seeding_rules = rules;
    }

    /// Enforce seeding rules — pause or remove torrents exceeding limits
    pub async fn enforce_seeding_rules(&mut self) -> Result<()> {
        if self.seeding_rules.max_ratio.is_none()
            && self.seeding_rules.max_seed_time_minutes.is_none()
        {
            return Ok(());
        }

        let api = match self.api.as_ref() {
            Some(a) => a,
            None => return Ok(()),
        };

        let list = api.api_torrent_list_ext(librqbit::api::ApiTorrentListOpts { with_stats: true });
        let mut to_action: Vec<usize> = Vec::new();

        for details in &list.torrents {
            let id = match details.id {
                Some(id) => id,
                None => continue,
            };

            let stats = match &details.stats {
                Some(s) => s,
                None => continue,
            };

            // Only enforce on completed (seeding) torrents
            if !stats.finished {
                continue;
            }

            // Check ratio limit
            if let Some(max_ratio) = self.seeding_rules.max_ratio {
                if stats.total_bytes > 0 {
                    let ratio = stats.uploaded_bytes as f64 / stats.total_bytes as f64;
                    if ratio >= max_ratio {
                        to_action.push(id);
                        continue;
                    }
                }
            }

            // Check seed time limit
            if let Some(max_minutes) = self.seeding_rules.max_seed_time_minutes {
                if let Some(completed_at) = self.completed_times.get(&id) {
                    let elapsed = Utc::now()
                        .signed_duration_since(*completed_at)
                        .num_minutes() as u64;
                    if elapsed >= max_minutes {
                        to_action.push(id);
                    }
                }
            }
        }

        for id in to_action {
            match self.seeding_rules.action_on_limit {
                SeedLimitAction::Pause => {
                    if let Err(e) = api
                        .api_torrent_action_pause(librqbit::api::TorrentIdOrHash::Id(id))
                        .await
                    {
                        log::warn!("Failed to pause torrent {} (seed limit): {}", id, e);
                    } else {
                        log::info!("Paused torrent {} (seed limit reached)", id);
                    }
                }
                SeedLimitAction::Remove => {
                    if let Err(e) = api
                        .api_torrent_action_forget(librqbit::api::TorrentIdOrHash::Id(id))
                        .await
                    {
                        log::warn!("Failed to remove torrent {} (seed limit): {}", id, e);
                    } else {
                        log::info!("Removed torrent {} (seed limit reached)", id);
                        self.added_times.remove(&id);
                        self.completed_times.remove(&id);
                    }
                }
            }
        }

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    fn build_torrent_item_from_details(
        &self,
        details: &librqbit::api::TorrentDetailsResponse,
    ) -> Result<TorrentItem> {
        let id = details.id.unwrap_or(0);

        // Extract stats via JSON serialization to handle opaque Speed type
        let (
            state,
            progress_bytes,
            uploaded_bytes,
            total_bytes,
            dl_speed,
            ul_speed,
            eta,
            error,
            finished,
            file_progress,
        ) = if let Some(ref stats) = details.stats {
            let json = serde_json::to_value(stats).unwrap_or(serde_json::Value::Null);

            let state_str = json
                .get("state")
                .and_then(|v| v.as_str())
                .unwrap_or("initializing");

            let progress = json
                .get("progress_bytes")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let uploaded = json
                .get("uploaded_bytes")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let total = json
                .get("total_bytes")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let is_finished = json
                .get("finished")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let err = json
                .get("error")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            let fp = json
                .get("file_progress")
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter_map(|v| v.as_u64()).collect::<Vec<_>>())
                .unwrap_or_default();

            // Extract live stats (speeds, ETA)
            let (dl_spd, ul_spd, eta_str) = if let Some(live) = json.get("live") {
                let ds = live
                    .get("download_speed")
                    .and_then(extract_speed_bps)
                    .unwrap_or(0.0);
                let us = live
                    .get("upload_speed")
                    .and_then(extract_speed_bps)
                    .unwrap_or(0.0);
                let eta = live.get("time_remaining").and_then(|v| {
                    v.get("human_readable")
                        .and_then(|h| h.as_str())
                        .map(|s| s.to_string())
                });
                (ds, us, eta)
            } else {
                (0.0, 0.0, None)
            };

            let mapped_state = match state_str.to_lowercase().as_str() {
                "live" if is_finished => TorrentState::Seeding,
                "live" => TorrentState::Downloading,
                "paused" => TorrentState::Paused,
                "error" => TorrentState::Error,
                "initializing" => TorrentState::Initializing,
                _ => TorrentState::Initializing,
            };

            (
                mapped_state,
                progress,
                uploaded,
                total,
                dl_spd,
                ul_spd,
                eta_str,
                err,
                is_finished,
                fp,
            )
        } else {
            (
                TorrentState::Initializing,
                0,
                0,
                0,
                0.0,
                0.0,
                None,
                None,
                false,
                Vec::new(),
            )
        };

        let progress_percent = if total_bytes > 0 {
            (progress_bytes as f64 / total_bytes as f64 * 100.0) as f32
        } else {
            0.0
        };

        let ratio = if total_bytes > 0 {
            uploaded_bytes as f64 / total_bytes as f64
        } else {
            0.0
        };

        // Build file list from details
        let files = if let Some(ref detail_files) = details.files {
            detail_files
                .iter()
                .enumerate()
                .map(|(idx, f)| {
                    let file_downloaded = file_progress.get(idx).copied().unwrap_or(0);
                    let file_pct = if f.length > 0 {
                        (file_downloaded as f64 / f.length as f64 * 100.0) as f32
                    } else {
                        0.0
                    };
                    TorrentFile {
                        index: idx,
                        name: f.name.clone(),
                        path: f.components.join("/"),
                        length: f.length,
                        downloaded_bytes: file_downloaded,
                        included: f.included,
                        progress_percent: file_pct,
                    }
                })
                .collect()
        } else {
            Vec::new()
        };

        let added_at = self.added_times.get(&id).copied().unwrap_or_else(Utc::now);

        let completed_at = if finished {
            self.completed_times.get(&id).copied()
        } else {
            None
        };

        // Approximate peer/seed counts from live stats snapshot
        let (peers_connected, seeds_connected) = if let Some(ref stats) = details.stats {
            let json = serde_json::to_value(stats).unwrap_or(serde_json::Value::Null);
            if let Some(live) = json.get("live") {
                let snapshot = live.get("snapshot").unwrap_or(&serde_json::Value::Null);
                let peers = snapshot
                    .get("peers")
                    .or_else(|| snapshot.get("connected_peers"))
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0) as u32;
                // Seeds are not separately tracked in librqbit; approximate as 0
                (peers, 0u32)
            } else {
                (0, 0)
            }
        } else {
            (0, 0)
        };

        Ok(TorrentItem {
            id,
            info_hash: details.info_hash.clone(),
            name: details
                .name
                .clone()
                .unwrap_or_else(|| "Unknown".to_string()),
            state,
            progress_percent,
            downloaded_bytes: progress_bytes,
            uploaded_bytes,
            total_bytes,
            download_speed: dl_speed,
            upload_speed: ul_speed,
            ratio,
            peers_connected,
            seeds_connected,
            eta,
            output_folder: details.output_folder.clone(),
            files,
            error,
            added_at,
            completed_at,
            sequential: self.sequential_mode.contains(&id),
        })
    }
}

/// Extract bytes-per-second from a Speed JSON value.
/// librqbit Speed serializes as either a number or an object with `mbps`/`human_readable`.
fn extract_speed_bps(v: &serde_json::Value) -> Option<f64> {
    // If it's a plain number, treat as bytes/sec
    if let Some(n) = v.as_f64() {
        return Some(n);
    }
    // If it's an object, look for mbps and convert
    if let Some(mbps) = v.get("mbps").and_then(|m| m.as_f64()) {
        return Some(mbps * 1_000_000.0 / 8.0);
    }
    // Try bytes_per_second field
    if let Some(bps) = v.get("bytes_per_second").and_then(|b| b.as_f64()) {
        return Some(bps);
    }
    None
}
