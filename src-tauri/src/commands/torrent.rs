use crate::error::Result;
use crate::services::torrent::{
    AddTorrentParams, SeedingRules, SpeedLimits, TorrentItem, TorrentPeer, TorrentSessionStats,
};
use crate::state::AppState;
use tauri::State;

/// Get session-wide torrent statistics and full torrent list
#[tauri::command]
pub async fn get_torrent_session_stats(state: State<'_, AppState>) -> Result<TorrentSessionStats> {
    let mut torrent = state.torrent.write().await;
    torrent.get_session_stats()
}

/// Add a torrent from magnet link or .torrent file bytes
#[tauri::command]
pub async fn add_torrent(
    state: State<'_, AppState>,
    params: AddTorrentParams,
) -> Result<TorrentItem> {
    let mut torrent = state.torrent.write().await;
    torrent.add_torrent(params).await
}

/// Pause a torrent
#[tauri::command]
pub async fn pause_torrent(state: State<'_, AppState>, id: usize) -> Result<()> {
    let torrent = state.torrent.read().await;
    torrent.pause_torrent(id).await
}

/// Resume a paused torrent
#[tauri::command]
pub async fn resume_torrent(state: State<'_, AppState>, id: usize) -> Result<()> {
    let torrent = state.torrent.read().await;
    torrent.resume_torrent(id).await
}

/// Remove a torrent, optionally deleting downloaded files
#[tauri::command]
pub async fn remove_torrent(
    state: State<'_, AppState>,
    id: usize,
    delete_files: bool,
) -> Result<()> {
    let mut torrent = state.torrent.write().await;
    torrent.remove_torrent(id, delete_files).await
}

/// Update which files are selected for download within a torrent
#[tauri::command]
pub async fn set_torrent_files(
    state: State<'_, AppState>,
    id: usize,
    file_indices: Vec<usize>,
) -> Result<()> {
    let torrent = state.torrent.read().await;
    torrent.set_selected_files(id, file_indices).await
}

/// Get peer connection details for a torrent
#[tauri::command]
pub async fn get_torrent_peers(state: State<'_, AppState>, id: usize) -> Result<Vec<TorrentPeer>> {
    let torrent = state.torrent.read().await;
    torrent.get_torrent_peers(id)
}

/// Get details for a single torrent
#[tauri::command]
pub async fn get_torrent_details(state: State<'_, AppState>, id: usize) -> Result<TorrentItem> {
    let torrent = state.torrent.read().await;
    torrent.get_torrent(id)
}

/// Set global speed limits
#[tauri::command]
pub async fn set_torrent_speed_limits(
    state: State<'_, AppState>,
    limits: SpeedLimits,
) -> Result<()> {
    let mut torrent = state.torrent.write().await;
    torrent.set_speed_limits(limits)
}

/// Set seeding rules (ratio/time limits and action)
#[tauri::command]
pub async fn set_torrent_seeding_rules(
    state: State<'_, AppState>,
    rules: SeedingRules,
) -> Result<()> {
    let mut torrent = state.torrent.write().await;
    torrent.set_seeding_rules(rules);
    Ok(())
}
