use tauri::{Emitter, State};

use crate::error::Result;
use crate::services::irc::{IrcMessage, IrcService, IrcStatus};
use crate::state::AppState;

#[tauri::command]
pub async fn irc_connect(state: State<'_, AppState>, app_handle: tauri::AppHandle) -> Result<()> {
    log::info!("IRC connect command received from frontend");
    IrcService::connect_if_idle(state.irc.clone(), app_handle).await;
    Ok(())
}

#[tauri::command]
pub async fn irc_disconnect(state: State<'_, AppState>) -> Result<()> {
    let mut irc = state.irc.write().await;
    irc.disconnect();
    Ok(())
}

#[tauri::command]
pub async fn irc_send_message(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
    message: String,
) -> Result<()> {
    let irc = state.irc.read().await;
    irc.send_message(&message)
        .map_err(crate::error::ArchivistError::IrcError)?;

    // Also push our own message to history and emit
    drop(irc);
    let mut irc = state.irc.write().await;
    let status = irc.get_status();
    let msg = crate::services::irc::IrcMessage {
        id: uuid::Uuid::new_v4().to_string(),
        timestamp: chrono::Utc::now().to_rfc3339(),
        kind: crate::services::irc::IrcMessageKind::Chat,
        sender: Some(status.nickname),
        content: message,
    };
    // Push to history via direct field access through a helper
    let _ = app_handle.emit("irc-message", &msg);
    irc.push_message(msg);
    Ok(())
}

#[tauri::command]
pub async fn irc_get_status(state: State<'_, AppState>) -> Result<IrcStatus> {
    let irc = state.irc.read().await;
    Ok(irc.get_status())
}

#[tauri::command]
pub async fn irc_get_history(state: State<'_, AppState>) -> Result<Vec<IrcMessage>> {
    let irc = state.irc.read().await;
    Ok(irc.get_history())
}

#[tauri::command]
pub async fn irc_get_users(state: State<'_, AppState>) -> Result<Vec<String>> {
    let irc = state.irc.read().await;
    Ok(irc.get_users())
}
