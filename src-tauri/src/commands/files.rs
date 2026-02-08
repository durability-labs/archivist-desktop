use crate::error::Result;
use crate::services::files::{FileInfo, FileList, UploadResult};
use crate::state::AppState;
use tauri::{AppHandle, Emitter, State};

/// List all files from the node
#[tauri::command]
pub async fn list_files(state: State<'_, AppState>) -> Result<FileList> {
    let mut files = state.files.write().await;
    files.list_files().await
}

/// Upload a file to the node (streams file to avoid buffering in RAM)
#[tauri::command]
pub async fn upload_file(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<UploadResult> {
    let mut files = state.files.write().await;
    files
        .upload_file_with_progress(&path, Some(&app_handle))
        .await
}

/// Download a file by CID to a destination path
#[tauri::command]
pub async fn download_file(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    cid: String,
    destination: String,
) -> Result<()> {
    let files = state.files.read().await;
    files.download_file(&cid, &destination).await?;

    // Emit event for sound notification
    let _ = app_handle.emit("file-downloaded", &cid);

    Ok(())
}

/// Delete a file from local cache
#[tauri::command]
pub async fn delete_file(state: State<'_, AppState>, cid: String) -> Result<()> {
    let mut files = state.files.write().await;
    files.delete_file(&cid).await
}

/// Delete all files from the node
#[tauri::command]
pub async fn delete_all_files(state: State<'_, AppState>) -> Result<u64> {
    let mut files = state.files.write().await;
    files.delete_all_files().await
}

/// Pin or unpin a file
#[tauri::command]
pub async fn pin_file(state: State<'_, AppState>, cid: String, pinned: bool) -> Result<()> {
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

/// Get file info by CID from the node (for Download by CID feature)
/// Returns filename and mimetype if available
#[tauri::command]
pub async fn get_file_info_by_cid(
    state: State<'_, AppState>,
    cid: String,
) -> Result<Option<FileMetadata>> {
    let files = state.files.read().await;
    files.get_file_info_by_cid(&cid).await
}

/// File metadata returned from get_file_info_by_cid
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMetadata {
    pub filename: Option<String>,
    pub mimetype: Option<String>,
}
