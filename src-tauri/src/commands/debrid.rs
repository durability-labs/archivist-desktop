use crate::error::Result;
use crate::services::debrid::{CacheCheckResult, DebridStatus, ResolvedStream};
use crate::services::stremio_client::StreamObject;
use crate::state::AppState;
use tauri::State;

/// Configure the active debrid provider
#[tauri::command]
pub async fn configure_debrid(
    state: State<'_, AppState>,
    provider: String,
    token: String,
) -> Result<()> {
    let mut service = state.debrid.write().await;
    match provider.as_str() {
        "real_debrid" => service.configure_real_debrid(&token),
        "premiumize" => service.configure_premiumize(&token),
        _ => {
            return Err(crate::error::ArchivistError::DebridError(format!(
                "Unknown provider: {}",
                provider
            )));
        }
    }

    // Persist to config
    let mut config = state.config.write().await;
    let mut app_config = config.get();
    app_config.debrid.provider = Some(provider);
    app_config.debrid.api_token = Some(token);
    config.update(app_config)?;

    Ok(())
}

/// Clear the debrid provider configuration
#[tauri::command]
pub async fn clear_debrid(state: State<'_, AppState>) -> Result<()> {
    let mut service = state.debrid.write().await;
    service.clear_provider();

    // Persist to config
    let mut config = state.config.write().await;
    let mut app_config = config.get();
    app_config.debrid.provider = None;
    app_config.debrid.api_token = None;
    config.update(app_config)?;

    Ok(())
}

/// Get the current debrid configuration status
#[tauri::command]
pub async fn get_debrid_status(state: State<'_, AppState>) -> Result<DebridStatus> {
    let service = state.debrid.read().await;
    Ok(service.get_status())
}

/// Validate the current debrid token
#[tauri::command]
pub async fn validate_debrid_token(state: State<'_, AppState>) -> Result<bool> {
    let service = state.debrid.read().await;
    service.validate_token().await
}

/// Resolve a Stremio stream object through the debrid provider
#[tauri::command]
pub async fn resolve_debrid_stream(
    state: State<'_, AppState>,
    stream: StreamObject,
) -> Result<ResolvedStream> {
    let service = state.debrid.read().await;
    service.resolve_stream(&stream).await
}

/// Check if info hashes are cached on the debrid provider
#[tauri::command]
pub async fn check_debrid_cache(
    state: State<'_, AppState>,
    info_hashes: Vec<String>,
) -> Result<Vec<CacheCheckResult>> {
    let service = state.debrid.read().await;
    service.check_cache(&info_hashes).await
}
