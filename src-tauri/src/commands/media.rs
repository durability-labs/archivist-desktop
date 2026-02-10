use crate::error::Result;
use crate::services::binary_manager::BinaryStatus;
use crate::services::media_download::{DownloadOptions, DownloadQueueState, MediaMetadata};
use crate::state::AppState;
use tauri::{AppHandle, State};

/// Check if yt-dlp and ffmpeg binaries are available
#[tauri::command]
pub async fn check_media_binaries(state: State<'_, AppState>) -> Result<BinaryStatus> {
    let media = state.media.read().await;
    Ok(media.binary_manager().check_binaries().await)
}

/// Install yt-dlp binary (downloads from GitHub)
#[tauri::command]
pub async fn install_yt_dlp(
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<()> {
    let media = state.media.read().await;
    media.binary_manager().install_yt_dlp(&app_handle).await?;
    drop(media);

    // Refresh cached version
    let mut media = state.media.write().await;
    media.refresh_version().await;
    Ok(())
}

/// Install ffmpeg binary
#[tauri::command]
pub async fn install_ffmpeg(
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<()> {
    let media = state.media.read().await;
    media.binary_manager().install_ffmpeg(&app_handle).await
}

/// Fetch metadata for a URL (title, thumbnail, available formats)
#[tauri::command]
pub async fn fetch_media_metadata(
    state: State<'_, AppState>,
    url: String,
) -> Result<MediaMetadata> {
    let media = state.media.read().await;
    media.fetch_metadata(&url).await
}

/// Add a download to the queue
#[tauri::command]
pub async fn queue_media_download(
    state: State<'_, AppState>,
    options: DownloadOptions,
    title: String,
    thumbnail: Option<String>,
) -> Result<String> {
    let mut media = state.media.write().await;
    media.queue_download(options, title, thumbnail)
}

/// Cancel an active download
#[tauri::command]
pub async fn cancel_media_download(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<()> {
    let mut media = state.media.write().await;
    media.cancel_download(&task_id)
}

/// Remove a completed/failed/cancelled task from the queue
#[tauri::command]
pub async fn remove_media_task(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<()> {
    let mut media = state.media.write().await;
    media.remove_task(&task_id)
}

/// Clear all completed downloads from the queue
#[tauri::command]
pub async fn clear_completed_downloads(state: State<'_, AppState>) -> Result<()> {
    let mut media = state.media.write().await;
    media.clear_completed();
    Ok(())
}

/// Get current download queue state
#[tauri::command]
pub async fn get_download_queue(state: State<'_, AppState>) -> Result<DownloadQueueState> {
    let media = state.media.read().await;
    Ok(media.get_queue_state())
}

/// Update yt-dlp to the latest version
#[tauri::command]
pub async fn update_yt_dlp(
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<()> {
    // Re-download (overwrites existing)
    let media = state.media.read().await;
    media.binary_manager().install_yt_dlp(&app_handle).await?;
    drop(media);

    let mut media = state.media.write().await;
    media.refresh_version().await;
    Ok(())
}
