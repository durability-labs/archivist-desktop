use crate::error::Result;
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
