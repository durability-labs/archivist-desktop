use tauri::State;
use crate::error::Result;
use crate::state::AppState;
use crate::services::files::{FileInfo, FileList, UploadResult};

/// List all files from the node
#[tauri::command]
pub async fn list_files(state: State<'_, AppState>) -> Result<FileList> {
    let mut files = state.files.write().await;
    files.list_files().await
}

/// Upload a file to the node
#[tauri::command]
pub async fn upload_file(state: State<'_, AppState>, path: String) -> Result<UploadResult> {
    let mut files = state.files.write().await;
    files.upload_file(&path).await
}

/// Download a file by CID to a destination path
#[tauri::command]
pub async fn download_file(
    state: State<'_, AppState>,
    cid: String,
    destination: String,
) -> Result<()> {
    let files = state.files.read().await;
    files.download_file(&cid, &destination).await
}

/// Delete a file from local cache
#[tauri::command]
pub async fn delete_file(state: State<'_, AppState>, cid: String) -> Result<()> {
    let mut files = state.files.write().await;
    files.delete_file(&cid).await
}

/// Pin or unpin a file
#[tauri::command]
pub async fn pin_file(
    state: State<'_, AppState>,
    cid: String,
    pinned: bool,
) -> Result<()> {
    let mut files = state.files.write().await;
    files.pin_file(&cid, pinned).await
}

/// Get a specific file by CID
#[tauri::command]
pub async fn get_file(state: State<'_, AppState>, cid: String) -> Result<Option<FileInfo>> {
    let files = state.files.read().await;
    Ok(files.get_file(&cid).cloned())
}

/// Check if the node is reachable
#[tauri::command]
pub async fn check_node_connection(state: State<'_, AppState>) -> Result<bool> {
    let files = state.files.read().await;
    Ok(files.check_node_connection().await)
}
