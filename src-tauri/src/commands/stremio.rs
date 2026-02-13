use crate::error::Result;
use crate::services::stremio_client::{InstalledAddon, MetaItem, StreamWithAddon, SubtitleObject};
use crate::state::AppState;
use tauri::State;

/// Install a Stremio-compatible addon from a manifest URL
#[tauri::command]
pub async fn install_stremio_addon(
    state: State<'_, AppState>,
    url: String,
) -> Result<InstalledAddon> {
    let mut service = state.stremio.write().await;
    let addon = service.install_addon(&url).await?;

    // Persist to config
    let mut config = state.config.write().await;
    let mut app_config = config.get();
    app_config
        .stremio
        .installed_addons
        .push(crate::services::config::InstalledAddonConfig {
            base_url: addon.base_url.clone(),
            addon_id: addon.manifest.id.clone(),
            enabled: addon.enabled,
        });
    config.update(app_config)?;

    Ok(addon)
}

/// Remove an installed addon
#[tauri::command]
pub async fn remove_stremio_addon(state: State<'_, AppState>, addon_id: String) -> Result<()> {
    let mut service = state.stremio.write().await;
    service.remove_addon(&addon_id);

    // Persist to config
    let mut config = state.config.write().await;
    let mut app_config = config.get();
    app_config
        .stremio
        .installed_addons
        .retain(|a| a.addon_id != addon_id);
    config.update(app_config)?;

    Ok(())
}

/// Toggle an addon's enabled state
#[tauri::command]
pub async fn toggle_stremio_addon(
    state: State<'_, AppState>,
    addon_id: String,
    enabled: bool,
) -> Result<()> {
    let mut service = state.stremio.write().await;
    service.toggle_addon(&addon_id, enabled);

    // Persist to config
    let mut config = state.config.write().await;
    let mut app_config = config.get();
    if let Some(addon_config) = app_config
        .stremio
        .installed_addons
        .iter_mut()
        .find(|a| a.addon_id == addon_id)
    {
        addon_config.enabled = enabled;
    }
    config.update(app_config)?;

    Ok(())
}

/// List all installed addons
#[tauri::command]
pub async fn list_stremio_addons(state: State<'_, AppState>) -> Result<Vec<InstalledAddon>> {
    let service = state.stremio.read().await;
    Ok(service.list_addons().to_vec())
}

/// Browse a catalog from a specific addon
#[tauri::command]
pub async fn get_stremio_catalog(
    state: State<'_, AppState>,
    addon_id: String,
    content_type: String,
    catalog_id: String,
    extra: Option<String>,
) -> Result<Vec<MetaItem>> {
    let service = state.stremio.read().await;
    service
        .get_catalog(&addon_id, &content_type, &catalog_id, extra.as_deref())
        .await
}

/// Get content metadata
#[tauri::command]
pub async fn get_stremio_meta(
    state: State<'_, AppState>,
    content_type: String,
    id: String,
) -> Result<MetaItem> {
    let service = state.stremio.read().await;
    service.get_meta(&content_type, &id).await
}

/// Get streams from all enabled addons
#[tauri::command]
pub async fn get_stremio_streams(
    state: State<'_, AppState>,
    content_type: String,
    video_id: String,
) -> Result<Vec<StreamWithAddon>> {
    let service = state.stremio.read().await;
    service.get_streams(&content_type, &video_id).await
}

/// Get subtitles from all subtitle-capable addons
#[tauri::command]
pub async fn get_stremio_subtitles(
    state: State<'_, AppState>,
    content_type: String,
    video_id: String,
) -> Result<Vec<SubtitleObject>> {
    let service = state.stremio.read().await;
    service.get_subtitles(&content_type, &video_id).await
}
