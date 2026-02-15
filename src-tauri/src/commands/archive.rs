use crate::error::Result;
use crate::services::archive_viewer::ViewerStatus;
use crate::services::web_archive::{ArchiveOptions, ArchiveQueueState, ArchivedSite};
use crate::state::AppState;
use tauri::State;

/// Queue a new web archive task
#[tauri::command]
pub async fn queue_web_archive(
    state: State<'_, AppState>,
    options: ArchiveOptions,
) -> Result<String> {
    let mut archive = state.web_archive.write().await;
    archive.queue_archive(options)
}

/// Get the current archive queue state
#[tauri::command]
pub async fn get_archive_queue(state: State<'_, AppState>) -> Result<ArchiveQueueState> {
    let archive = state.web_archive.read().await;
    Ok(archive.get_queue_state())
}

/// Cancel an active archive task
#[tauri::command]
pub async fn cancel_web_archive(state: State<'_, AppState>, task_id: String) -> Result<()> {
    let mut archive = state.web_archive.write().await;
    archive.cancel_archive(&task_id)
}

/// Remove a completed/failed/cancelled task from the queue
#[tauri::command]
pub async fn remove_archive_task(state: State<'_, AppState>, task_id: String) -> Result<()> {
    let mut archive = state.web_archive.write().await;
    archive.remove_task(&task_id)
}

/// Clear all completed/failed/cancelled archive tasks
#[tauri::command]
pub async fn clear_completed_archives(state: State<'_, AppState>) -> Result<()> {
    let mut archive = state.web_archive.write().await;
    archive.clear_completed();
    Ok(())
}

/// Get list of archived sites
#[tauri::command]
pub async fn get_archived_sites(state: State<'_, AppState>) -> Result<Vec<ArchivedSite>> {
    let archive = state.web_archive.read().await;
    Ok(archive.get_archived_sites())
}

/// Open the archive viewer for a given CID. Downloads ZIP, extracts, starts server.
/// Returns the viewer base URL.
#[tauri::command]
pub async fn open_archive_viewer(state: State<'_, AppState>, cid: String) -> Result<String> {
    let mut viewer = state.archive_viewer.write().await;
    viewer.open_archive(&cid).await
}

/// Close the archive viewer and clean up extracted files.
#[tauri::command]
pub async fn close_archive_viewer(state: State<'_, AppState>) -> Result<()> {
    let mut viewer = state.archive_viewer.write().await;
    viewer.close_archive();
    Ok(())
}

/// Get the current archive viewer status.
#[tauri::command]
pub async fn get_archive_viewer_status(state: State<'_, AppState>) -> Result<Option<ViewerStatus>> {
    let viewer = state.archive_viewer.read().await;
    let status = viewer.get_status();
    if status.running {
        Ok(Some(status))
    } else {
        Ok(None)
    }
}
