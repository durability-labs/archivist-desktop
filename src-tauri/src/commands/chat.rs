use crate::error::{ArchivistError, Result};
use crate::services::chat_types::*;
use crate::state::AppState;
use tauri::State;

// ── 1-to-1 Commands ───────────────────────────────────────────

#[tauri::command]
pub async fn initiate_chat_session(
    state: State<'_, AppState>,
    peer_id: String,
    peer_address: String,
) -> Result<String> {
    let mut chat = state.chat.write().await;
    chat.initiate_session(&peer_id, &peer_address).await
}

#[tauri::command]
pub async fn send_chat_message(
    state: State<'_, AppState>,
    conversation_id: String,
    text: String,
    reply_to: Option<String>,
) -> Result<StoredMessage> {
    // Resolve peer address from PeerService
    let peer_id = conversation_id
        .strip_prefix("dm:")
        .ok_or_else(|| ArchivistError::ChatError("Invalid DM conversation ID".to_string()))?
        .to_string();

    let peers = state.peers.read().await;
    let peer_address = peers.get_peer_chat_address(&peer_id).unwrap_or_default();
    drop(peers);

    let mut chat = state.chat.write().await;
    chat.send_message(&conversation_id, &text, reply_to, &peer_address)
}

#[tauri::command]
pub async fn get_conversations(state: State<'_, AppState>) -> Result<Vec<ConversationSummary>> {
    let chat = state.chat.read().await;
    Ok(chat.get_conversations())
}

#[tauri::command]
pub async fn get_conversation_messages(
    state: State<'_, AppState>,
    conversation_id: String,
    limit: Option<usize>,
    before: Option<String>,
) -> Result<Vec<StoredMessage>> {
    let chat = state.chat.read().await;
    let before_dt = before.and_then(|s| {
        chrono::DateTime::parse_from_rfc3339(&s)
            .ok()
            .map(|d| d.with_timezone(&chrono::Utc))
    });
    Ok(chat.get_messages(&conversation_id, limit.unwrap_or(50), before_dt))
}

#[tauri::command]
pub async fn mark_messages_read(state: State<'_, AppState>, conversation_id: String) -> Result<()> {
    let mut chat = state.chat.write().await;
    chat.mark_read(&conversation_id)
}

#[tauri::command]
pub async fn delete_conversation(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<()> {
    let mut chat = state.chat.write().await;
    chat.delete_conversation(&conversation_id)
}

#[tauri::command]
pub async fn get_chat_identity(state: State<'_, AppState>) -> Result<ChatIdentityInfo> {
    let chat = state.chat.read().await;
    Ok(chat.get_identity_info())
}

#[tauri::command]
pub async fn get_safety_number(
    state: State<'_, AppState>,
    peer_id: String,
) -> Result<SafetyNumberInfo> {
    let chat = state.chat.read().await;
    chat.get_safety_number(&peer_id)
}

#[tauri::command]
pub async fn verify_peer_identity(state: State<'_, AppState>, peer_id: String) -> Result<()> {
    let mut chat = state.chat.write().await;
    chat.verify_peer(&peer_id)
}

#[tauri::command]
pub async fn get_chat_server_status(state: State<'_, AppState>) -> Result<ChatServerStatus> {
    let chat = state.chat.read().await;
    let server = state.chat_server.read().await;
    Ok(chat.get_server_status(server.is_running()))
}

// ── Group Commands ────────────────────────────────────────────

#[tauri::command]
pub async fn create_chat_group(
    state: State<'_, AppState>,
    name: String,
    member_peer_ids: Vec<String>,
) -> Result<GroupInfo> {
    let peers = state.peers.read().await;
    let member_addresses = peers.get_peer_chat_addresses(&member_peer_ids);
    drop(peers);

    let mut chat = state.chat.write().await;
    chat.create_group(&name, member_peer_ids, &member_addresses)
}

#[tauri::command]
pub async fn send_group_message(
    state: State<'_, AppState>,
    group_id: String,
    text: String,
    reply_to: Option<String>,
) -> Result<StoredMessage> {
    // Get group member IDs, then resolve their addresses
    let chat = state.chat.read().await;
    let member_ids: Vec<String> = chat
        .get_group_info(&group_id)
        .map(|g| g.members.iter().map(|m| m.peer_id.clone()).collect())
        .unwrap_or_default();
    drop(chat);

    let peers = state.peers.read().await;
    let member_addresses = peers.get_peer_chat_addresses(&member_ids);
    drop(peers);

    let mut chat = state.chat.write().await;
    chat.send_group_message(&group_id, &text, reply_to, &member_addresses)
}

#[tauri::command]
pub async fn add_group_member(
    state: State<'_, AppState>,
    group_id: String,
    peer_id: String,
) -> Result<()> {
    // Resolve addresses for all members (existing + new)
    let chat = state.chat.read().await;
    let mut member_ids: Vec<String> = chat
        .get_group_info(&group_id)
        .map(|g| g.members.iter().map(|m| m.peer_id.clone()).collect())
        .unwrap_or_default();
    drop(chat);

    if !member_ids.contains(&peer_id) {
        member_ids.push(peer_id.clone());
    }

    let peers = state.peers.read().await;
    let member_addresses = peers.get_peer_chat_addresses(&member_ids);
    drop(peers);

    let mut chat = state.chat.write().await;
    chat.add_group_member(&group_id, &peer_id, &member_addresses)
}

#[tauri::command]
pub async fn remove_group_member(
    state: State<'_, AppState>,
    group_id: String,
    peer_id: String,
) -> Result<()> {
    let chat = state.chat.read().await;
    let member_ids: Vec<String> = chat
        .get_group_info(&group_id)
        .map(|g| g.members.iter().map(|m| m.peer_id.clone()).collect())
        .unwrap_or_default();
    drop(chat);

    let peers = state.peers.read().await;
    let member_addresses = peers.get_peer_chat_addresses(&member_ids);
    drop(peers);

    let mut chat = state.chat.write().await;
    chat.remove_group_member(&group_id, &peer_id, &member_addresses)
}

#[tauri::command]
pub async fn leave_group(state: State<'_, AppState>, group_id: String) -> Result<()> {
    let mut chat = state.chat.write().await;
    chat.delete_conversation(&group_id)
}

#[tauri::command]
pub async fn get_group_info(
    state: State<'_, AppState>,
    group_id: String,
) -> Result<Option<GroupInfo>> {
    let chat = state.chat.read().await;
    Ok(chat.get_group_info(&group_id))
}
