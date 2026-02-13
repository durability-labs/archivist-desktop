use crate::error::Result;
use crate::services::iptv::{IptvChannel, IptvPlaylistSummary};
use crate::state::AppState;
use tauri::State;

/// Add an IPTV playlist from a URL
#[tauri::command]
pub async fn add_iptv_playlist(
    state: State<'_, AppState>,
    url: String,
    name: String,
) -> Result<IptvPlaylistSummary> {
    let mut service = state.iptv.write().await;
    let summary = service.add_playlist_from_url(&url, &name).await?;

    // Persist to config
    let mut config = state.config.write().await;
    let mut app_config = config.get();
    app_config
        .iptv
        .playlists
        .push(crate::services::config::IptvPlaylistConfig {
            id: summary.id.clone(),
            name: summary.name.clone(),
            url: Some(url),
        });
    config.update(app_config)?;

    Ok(summary)
}

/// Add an IPTV playlist from raw M3U content
#[tauri::command]
pub async fn add_iptv_playlist_content(
    state: State<'_, AppState>,
    content: String,
    name: String,
) -> Result<IptvPlaylistSummary> {
    let mut service = state.iptv.write().await;
    let summary = service.add_playlist_from_content(&content, &name)?;

    // Persist to config
    let mut config = state.config.write().await;
    let mut app_config = config.get();
    app_config
        .iptv
        .playlists
        .push(crate::services::config::IptvPlaylistConfig {
            id: summary.id.clone(),
            name: summary.name.clone(),
            url: None,
        });
    config.update(app_config)?;

    Ok(summary)
}

/// Remove an IPTV playlist
#[tauri::command]
pub async fn remove_iptv_playlist(state: State<'_, AppState>, id: String) -> Result<()> {
    let mut service = state.iptv.write().await;
    service.remove_playlist(&id);

    // Persist to config
    let mut config = state.config.write().await;
    let mut app_config = config.get();
    app_config.iptv.playlists.retain(|p| p.id != id);
    config.update(app_config)?;

    Ok(())
}

/// Refresh an IPTV playlist (re-fetch from URL)
#[tauri::command]
pub async fn refresh_iptv_playlist(
    state: State<'_, AppState>,
    id: String,
) -> Result<IptvPlaylistSummary> {
    let mut service = state.iptv.write().await;
    service.refresh_playlist(&id).await
}

/// List all IPTV playlists
#[tauri::command]
pub async fn list_iptv_playlists(state: State<'_, AppState>) -> Result<Vec<IptvPlaylistSummary>> {
    let service = state.iptv.read().await;
    Ok(service.list_playlists())
}

/// Get channels from a playlist with optional filters
#[tauri::command]
pub async fn get_iptv_channels(
    state: State<'_, AppState>,
    playlist_id: String,
    group: Option<String>,
    search: Option<String>,
) -> Result<Vec<IptvChannel>> {
    let service = state.iptv.read().await;
    service.get_channels(&playlist_id, group.as_deref(), search.as_deref())
}
