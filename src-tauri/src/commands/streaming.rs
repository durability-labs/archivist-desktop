use crate::error::Result;
use crate::services::media_streaming::MediaLibraryItem;
use crate::state::AppState;
use tauri::State;

/// Get the streaming server URL if running
#[tauri::command]
pub async fn get_streaming_server_url(state: State<'_, AppState>) -> Result<Option<String>> {
    let server = state.media_streaming.read().await;
    Ok(server.get_url())
}

/// Start the media streaming server
#[tauri::command]
pub async fn start_streaming_server(state: State<'_, AppState>) -> Result<()> {
    let mut server = state.media_streaming.write().await;
    server.start().await
}

/// Stop the media streaming server
#[tauri::command]
pub async fn stop_streaming_server(state: State<'_, AppState>) -> Result<()> {
    let mut server = state.media_streaming.write().await;
    server.stop();
    Ok(())
}

/// Get the media library (completed downloads available for playback)
#[tauri::command]
pub async fn get_media_library(state: State<'_, AppState>) -> Result<Vec<MediaLibraryItem>> {
    let server = state.media_streaming.read().await;
    Ok(server.get_library().await)
}
