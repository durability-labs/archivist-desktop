use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::crypto::identity::PreKeyBundle;

// ── Wire protocol types ────────────────────────────────────────

/// Pre-key bundle exchange (sent during session establishment).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreKeyBundleExchange {
    pub sender_peer_id: String,
    pub bundle: PreKeyBundle,
    pub cert_fingerprint: String,
}

/// Message type indicator for Olm messages.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum OlmMessageType {
    PreKey,
    Normal,
}

/// Encrypted 1-to-1 chat message.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptedChatMessage {
    pub message_id: String,
    pub sender_peer_id: String,
    pub sender_identity_key: String,
    pub message_type: OlmMessageType,
    pub ciphertext: String,
    pub timestamp: DateTime<Utc>,
}

/// Plaintext message content (serialized before encryption).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessageContent {
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reply_to: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attachments: Vec<Attachment>,
}

/// File attachment shared via archivist-node CID.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub cid: String,
    pub filename: String,
    pub mime_type: String,
    pub size_bytes: u64,
}

/// Group invitation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupInvite {
    pub group_id: String,
    pub group_name: String,
    pub creator_peer_id: String,
    pub members: Vec<GroupMemberInfo>,
    /// Megolm session key, encrypted per-member via Olm.
    pub encrypted_session_key: String,
}

/// Basic group member info.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupMemberInfo {
    pub peer_id: String,
    pub identity_key: String,
}

/// Encrypted group message.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptedGroupMessage {
    pub message_id: String,
    pub group_id: String,
    pub sender_peer_id: String,
    pub sender_identity_key: String,
    pub ciphertext: String,
    pub session_id: String,
    pub message_index: u32,
    pub timestamp: DateTime<Utc>,
}

/// Reason for group rekey.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RekeyReason {
    MemberAdded,
    MemberRemoved,
    ScheduledRotation,
    Manual,
}

/// Group session rekey message.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupRekey {
    pub group_id: String,
    pub new_session_id: String,
    /// Per-member encrypted Megolm session key.
    pub encrypted_session_key: String,
    pub reason: RekeyReason,
}

/// Delivery acknowledgment.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryAck {
    pub message_id: String,
    pub status: DeliveryAckStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum DeliveryAckStatus {
    Delivered,
    Read,
    Failed,
}

/// Delivery status for the message store.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum DeliveryStatus {
    Sending,
    Delivered,
    Read,
    Failed,
}

// ── Stored types ───────────────────────────────────────────────

/// Conversation type.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ConversationType {
    Direct,
    Group,
}

/// A stored message in a conversation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredMessage {
    pub id: String,
    pub sender_peer_id: String,
    pub content: ChatMessageContent,
    pub timestamp: DateTime<Utc>,
    pub delivery_status: DeliveryStatus,
    pub is_outgoing: bool,
}

/// Summary of a conversation for listing.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSummary {
    pub id: String,
    pub conversation_type: ConversationType,
    pub display_name: String,
    pub last_message: Option<String>,
    pub last_message_at: Option<DateTime<Utc>>,
    pub unread_count: u32,
    pub members: Option<Vec<String>>,
}

/// Group info.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupInfo {
    pub group_id: String,
    pub group_name: String,
    pub creator_peer_id: String,
    pub members: Vec<GroupMemberInfo>,
    pub created_at: DateTime<Utc>,
}

/// Chat identity info for the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatIdentityInfo {
    pub peer_id: String,
    pub identity_key: String,
    pub signing_key: String,
    pub cert_fingerprint: String,
}

/// Safety number info.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SafetyNumberInfo {
    pub peer_id: String,
    pub safety_number: String,
    pub groups: Vec<String>,
    pub verified: bool,
}

/// Chat server status.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatServerStatus {
    pub running: bool,
    pub port: u16,
    pub total_unread: u32,
    pub conversation_count: u32,
}
