use crate::error::{ArchivistError, Result};
use crate::services::backup_daemon::DaemonState;
use crate::services::sync::{SyncState, WatchedFolder};
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn get_sync_status(state: State<'_, AppState>) -> Result<SyncState> {
    let sync = state.sync.read().await;
    Ok(sync.get_state())
}

#[tauri::command]
pub async fn add_watch_folder(state: State<'_, AppState>, path: String) -> Result<WatchedFolder> {
    let mut sync = state.sync.write().await;
    sync.add_folder(&path).await
}

#[tauri::command]
pub async fn remove_watch_folder(state: State<'_, AppState>, folder_id: String) -> Result<()> {
    let mut sync = state.sync.write().await;
    sync.remove_folder(&folder_id).await
}

#[tauri::command]
pub async fn toggle_watch_folder(
    state: State<'_, AppState>,
    folder_id: String,
    enabled: bool,
) -> Result<()> {
    let mut sync = state.sync.write().await;
    sync.toggle_folder(&folder_id, enabled).await
}

#[tauri::command]
pub async fn sync_now(state: State<'_, AppState>) -> Result<()> {
    let mut sync = state.sync.write().await;
    sync.sync_now().await
}

#[tauri::command]
pub async fn pause_sync(state: State<'_, AppState>) -> Result<()> {
    let mut sync = state.sync.write().await;
    sync.pause_sync().await
}

#[tauri::command]
pub async fn generate_folder_manifest(
    state: State<'_, AppState>,
    folder_id: String,
) -> Result<String> {
    let mut sync = state.sync.write().await;
    let manifest_cid = sync.upload_manifest(&folder_id).await?;
    Ok(manifest_cid)
}

#[tauri::command]
pub async fn notify_backup_peer(state: State<'_, AppState>, folder_id: String) -> Result<()> {
    // Get manifest CID for folder
    let sync = state.sync.read().await;
    let folder = sync
        .get_folder(&folder_id)
        .ok_or_else(|| ArchivistError::SyncError("Folder not found".into()))?;

    let manifest_cid = folder
        .manifest_cid
        .clone()
        .ok_or_else(|| ArchivistError::SyncError("No manifest generated yet".into()))?;

    drop(sync);

    // Get backup peer address from config
    let config = state.config.read().await;
    let app_config = config.get();
    let backup_addr = app_config
        .sync
        .backup_peer_address
        .ok_or_else(|| ArchivistError::ConfigError("No backup peer configured".into()))?;

    drop(config);

    // Notify backup peer
    let backup = state.backup.read().await;
    backup
        .notify_backup_peer(&manifest_cid, &backup_addr)
        .await?;

    Ok(())
}

#[tauri::command]
pub async fn test_backup_peer_connection(
    state: State<'_, AppState>,
    peer_address: String,
) -> Result<bool> {
    let mut peers = state.peers.write().await;
    match peers.connect_peer(&peer_address).await {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
    }
}

// ========== Backup Daemon Commands ==========

#[tauri::command]
pub async fn get_backup_daemon_state(state: State<'_, AppState>) -> Result<DaemonState> {
    let daemon_state = state.backup_daemon.get_state().await;
    Ok(daemon_state)
}

#[tauri::command]
pub async fn enable_backup_daemon(state: State<'_, AppState>) -> Result<()> {
    state.backup_daemon.enable();
    log::info!("Backup daemon enabled");
    Ok(())
}

#[tauri::command]
pub async fn disable_backup_daemon(state: State<'_, AppState>) -> Result<()> {
    state.backup_daemon.disable();
    log::info!("Backup daemon disabled");
    Ok(())
}

#[tauri::command]
pub async fn pause_backup_daemon(state: State<'_, AppState>) -> Result<()> {
    state.backup_daemon.pause().await?;
    log::info!("Backup daemon paused");
    Ok(())
}

#[tauri::command]
pub async fn resume_backup_daemon(state: State<'_, AppState>) -> Result<()> {
    state.backup_daemon.resume().await?;
    log::info!("Backup daemon resumed");
    Ok(())
}

#[tauri::command]
pub async fn retry_failed_manifest(state: State<'_, AppState>, manifest_cid: String) -> Result<()> {
    state.backup_daemon.retry_manifest(&manifest_cid).await?;
    log::info!("Retrying failed manifest: {}", manifest_cid);
    Ok(())
}
