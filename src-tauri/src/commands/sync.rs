use crate::error::{ArchivistError, Result};
use crate::services::backup_daemon::DaemonState;
use crate::services::manifest_server::ManifestInfo;
use crate::services::sync::{SyncState, WatchedFolder};
use crate::state::AppState;
use chrono::Utc;
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

    // Get folder info for registry
    let folder = sync
        .get_folder(&folder_id)
        .ok_or_else(|| ArchivistError::SyncError("Folder not found".into()))?;

    let manifest_info = ManifestInfo {
        folder_id: folder_id.clone(),
        folder_path: folder.path.clone(),
        manifest_cid: manifest_cid.clone(),
        sequence_number: folder.manifest_sequence,
        updated_at: Utc::now().to_rfc3339(),
        file_count: folder.file_count,
        total_size_bytes: folder.total_size_bytes,
    };

    drop(sync);

    // Register manifest with the discovery server's registry
    let mut registry = state.manifest_registry.write().await;
    registry.register_manifest(manifest_info);

    log::info!(
        "Manifest {} registered for folder {}",
        manifest_cid,
        folder_id
    );

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

    // 1. Verify manifest is registered with ManifestRegistry
    let registry = state.manifest_registry.read().await;
    let is_registered = registry
        .get_all_manifests()
        .iter()
        .any(|m| m.manifest_cid == manifest_cid);
    drop(registry);

    if !is_registered {
        log::warn!(
            "Manifest {} not registered, registering now before notifying backup peer",
            manifest_cid
        );
        // Re-register if somehow not in registry
        let sync = state.sync.read().await;
        if let Some(folder) = sync.get_folder(&folder_id) {
            let manifest_info = ManifestInfo {
                folder_id: folder_id.clone(),
                folder_path: folder.path.clone(),
                manifest_cid: manifest_cid.clone(),
                sequence_number: folder.manifest_sequence,
                updated_at: Utc::now().to_rfc3339(),
                file_count: folder.file_count,
                total_size_bytes: folder.total_size_bytes,
            };
            drop(sync);
            let mut registry = state.manifest_registry.write().await;
            registry.register_manifest(manifest_info);
        }
    }

    log::info!(
        "Manifest {} verified in registry, proceeding with backup notification",
        manifest_cid
    );

    // 2. Get backup peer address and trigger port from config
    let config = state.config.read().await;
    let app_config = config.get();
    let backup_addr = app_config
        .sync
        .backup_peer_address
        .clone()
        .ok_or_else(|| ArchivistError::ConfigError("No backup peer configured".into()))?;
    let trigger_port = app_config.sync.backup_trigger_port;
    drop(config);

    // 3. Notify backup peer via HTTP trigger
    let backup = state.backup.read().await;
    backup
        .notify_backup_peer(&manifest_cid, &backup_addr, trigger_port)
        .await?;

    log::info!(
        "Successfully notified backup peer to poll for manifest: {}",
        manifest_cid
    );

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
    // Enable in-memory flag
    state.backup_daemon.enable();

    // Persist to config file
    let mut config_service = state.config.write().await;
    let mut config = config_service.get();
    config.backup_server.enabled = true;
    config_service.update(config)?;

    log::info!("Backup daemon enabled");
    Ok(())
}

#[tauri::command]
pub async fn disable_backup_daemon(state: State<'_, AppState>) -> Result<()> {
    // Disable in-memory flag
    state.backup_daemon.disable();

    // Persist to config file
    let mut config_service = state.config.write().await;
    let mut config = config_service.get();
    config.backup_server.enabled = false;
    config_service.update(config)?;

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

// ========== Onboarding Commands ==========

/// Create a quickstart folder for first-run onboarding
/// Creates ~/Documents/Archivist Quickstart/ with a sample welcome.txt file
#[tauri::command]
pub async fn create_quickstart_folder() -> Result<String> {
    // Get the user's Documents directory
    let documents_dir = dirs::document_dir()
        .ok_or_else(|| ArchivistError::SyncError("Could not find Documents directory".into()))?;

    let quickstart_path = documents_dir.join("Archivist Quickstart");

    // Create the folder if it doesn't exist
    if !quickstart_path.exists() {
        std::fs::create_dir_all(&quickstart_path).map_err(|e| {
            ArchivistError::SyncError(format!("Failed to create quickstart folder: {}", e))
        })?;
        log::info!("Created quickstart folder: {:?}", quickstart_path);
    }

    // Create a sample welcome.txt file
    let welcome_file = quickstart_path.join("welcome.txt");
    if !welcome_file.exists() {
        let welcome_content = r#"Welcome to Archivist!
======================

This folder is being backed up to the decentralized network.

How it works:
1. Any files you add to this folder will be automatically synced
2. Each file gets a unique Content ID (CID) - like a fingerprint
3. Your files are stored across the P2P network for durability

Try it out:
- Add a photo, document, or any file to this folder
- Watch the sync progress in the Archivist app
- Your files are now backed up!

Next steps:
- Add more folders to backup in the Backups section
- Connect another device to access your files anywhere
- Explore the Dashboard to see your storage usage

Happy archiving!
"#;
        std::fs::write(&welcome_file, welcome_content).map_err(|e| {
            ArchivistError::SyncError(format!("Failed to create welcome file: {}", e))
        })?;
        log::info!("Created welcome file: {:?}", welcome_file);
    }

    Ok(quickstart_path.to_string_lossy().to_string())
}
