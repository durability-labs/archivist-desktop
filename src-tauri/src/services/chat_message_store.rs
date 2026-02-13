use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use super::chat_types::{ConversationSummary, ConversationType, DeliveryStatus, StoredMessage};
use crate::error::{ArchivistError, Result};

/// A conversation (direct or group).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: String,
    pub conversation_type: ConversationType,
    pub display_name: String,
    pub messages: Vec<StoredMessage>,
    pub unread_count: u32,
    pub last_message_at: Option<DateTime<Utc>>,
    /// Peer IDs of members (for groups)
    #[serde(default)]
    pub members: Vec<String>,
}

/// Manages conversations and messages on disk.
pub struct MessageStore {
    conversations: HashMap<String, Conversation>,
    base_dir: PathBuf,
}

impl MessageStore {
    pub fn new(base_dir: &Path) -> Result<Self> {
        let messages_dir = base_dir.join("messages");
        std::fs::create_dir_all(&messages_dir)
            .map_err(|e| ArchivistError::ChatError(format!("Create messages dir: {}", e)))?;

        let mut conversations = HashMap::new();

        // Load existing conversations
        if let Ok(entries) = std::fs::read_dir(&messages_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().is_some_and(|e| e == "json") {
                    match std::fs::read_to_string(&path) {
                        Ok(data) => match serde_json::from_str::<Conversation>(&data) {
                            Ok(conv) => {
                                conversations.insert(conv.id.clone(), conv);
                            }
                            Err(e) => {
                                log::warn!("Failed to parse conversation {:?}: {}", path, e);
                            }
                        },
                        Err(e) => {
                            log::warn!("Failed to read conversation {:?}: {}", path, e);
                        }
                    }
                }
            }
        }

        log::info!("Loaded {} conversations from disk", conversations.len());
        Ok(Self {
            conversations,
            base_dir: base_dir.to_path_buf(),
        })
    }

    /// Get or create a direct conversation with a peer.
    pub fn get_or_create_direct(&mut self, peer_id: &str) -> &mut Conversation {
        let conv_id = format!("dm:{}", peer_id);
        self.conversations
            .entry(conv_id.clone())
            .or_insert_with(|| Conversation {
                id: conv_id,
                conversation_type: ConversationType::Direct,
                display_name: short_peer_id(peer_id),
                messages: Vec::new(),
                unread_count: 0,
                last_message_at: None,
                members: vec![peer_id.to_string()],
            })
    }

    /// Get or create a group conversation.
    pub fn get_or_create_group(
        &mut self,
        group_id: &str,
        group_name: &str,
        members: Vec<String>,
    ) -> &mut Conversation {
        self.conversations
            .entry(group_id.to_string())
            .or_insert_with(|| Conversation {
                id: group_id.to_string(),
                conversation_type: ConversationType::Group,
                display_name: group_name.to_string(),
                messages: Vec::new(),
                unread_count: 0,
                last_message_at: None,
                members,
            })
    }

    /// Add a message to a conversation.
    pub fn add_message(&mut self, conversation_id: &str, message: StoredMessage) -> Result<()> {
        if let Some(conv) = self.conversations.get_mut(conversation_id) {
            conv.last_message_at = Some(message.timestamp);
            if !message.is_outgoing {
                conv.unread_count += 1;
            }
            conv.messages.push(message);
            self.persist_conversation(conversation_id)?;
        }
        Ok(())
    }

    /// Update delivery status for a message.
    pub fn update_delivery_status(
        &mut self,
        conversation_id: &str,
        message_id: &str,
        status: DeliveryStatus,
    ) -> Result<()> {
        if let Some(conv) = self.conversations.get_mut(conversation_id) {
            if let Some(msg) = conv.messages.iter_mut().find(|m| m.id == message_id) {
                msg.delivery_status = status;
            }
            self.persist_conversation(conversation_id)?;
        }
        Ok(())
    }

    /// Mark all messages in a conversation as read.
    pub fn mark_read(&mut self, conversation_id: &str) -> Result<()> {
        if let Some(conv) = self.conversations.get_mut(conversation_id) {
            conv.unread_count = 0;
            self.persist_conversation(conversation_id)?;
        }
        Ok(())
    }

    /// Get conversation summaries sorted by last message time.
    pub fn get_conversation_summaries(&self) -> Vec<ConversationSummary> {
        let mut summaries: Vec<ConversationSummary> = self
            .conversations
            .values()
            .map(|conv| {
                let last_msg = conv.messages.last().map(|m| m.content.text.clone());
                ConversationSummary {
                    id: conv.id.clone(),
                    conversation_type: conv.conversation_type.clone(),
                    display_name: conv.display_name.clone(),
                    last_message: last_msg,
                    last_message_at: conv.last_message_at,
                    unread_count: conv.unread_count,
                    members: if conv.conversation_type == ConversationType::Group {
                        Some(conv.members.clone())
                    } else {
                        None
                    },
                }
            })
            .collect();

        summaries.sort_by(|a, b| b.last_message_at.cmp(&a.last_message_at));
        summaries
    }

    /// Get paginated messages for a conversation.
    pub fn get_messages(
        &self,
        conversation_id: &str,
        limit: usize,
        before: Option<DateTime<Utc>>,
    ) -> Vec<StoredMessage> {
        if let Some(conv) = self.conversations.get(conversation_id) {
            let iter = conv.messages.iter().rev();
            let filtered: Vec<_> = if let Some(before_ts) = before {
                iter.filter(|m| m.timestamp < before_ts)
                    .take(limit)
                    .cloned()
                    .collect()
            } else {
                iter.take(limit).cloned().collect()
            };
            // Reverse to chronological order
            filtered.into_iter().rev().collect()
        } else {
            Vec::new()
        }
    }

    /// Delete a conversation and its messages.
    pub fn delete_conversation(&mut self, conversation_id: &str) -> Result<()> {
        self.conversations.remove(conversation_id);
        let path = self
            .base_dir
            .join("messages")
            .join(format!("{}.json", sanitize_filename(conversation_id)));
        if path.exists() {
            std::fs::remove_file(&path)
                .map_err(|e| ArchivistError::ChatError(format!("Delete conversation: {}", e)))?;
        }
        Ok(())
    }

    /// Get total unread count across all conversations.
    pub fn total_unread(&self) -> u32 {
        self.conversations.values().map(|c| c.unread_count).sum()
    }

    /// Get unread count per conversation.
    pub fn unread_by_conversation(&self) -> HashMap<String, u32> {
        self.conversations
            .iter()
            .filter(|(_, c)| c.unread_count > 0)
            .map(|(id, c)| (id.clone(), c.unread_count))
            .collect()
    }

    pub fn conversation_count(&self) -> u32 {
        self.conversations.len() as u32
    }

    /// Find conversation ID for a direct message peer.
    #[allow(dead_code)]
    pub fn find_dm_conversation(&self, peer_id: &str) -> Option<String> {
        let conv_id = format!("dm:{}", peer_id);
        if self.conversations.contains_key(&conv_id) {
            Some(conv_id)
        } else {
            None
        }
    }

    /// Add a member to a group conversation.
    pub fn add_group_member(&mut self, group_id: &str, peer_id: &str) -> Result<()> {
        if let Some(conv) = self.conversations.get_mut(group_id) {
            if !conv.members.contains(&peer_id.to_string()) {
                conv.members.push(peer_id.to_string());
                self.persist_conversation(group_id)?;
            }
        }
        Ok(())
    }

    /// Remove a member from a group conversation.
    pub fn remove_group_member(&mut self, group_id: &str, peer_id: &str) -> Result<()> {
        if let Some(conv) = self.conversations.get_mut(group_id) {
            conv.members.retain(|m| m != peer_id);
            self.persist_conversation(group_id)?;
        }
        Ok(())
    }

    fn persist_conversation(&self, conversation_id: &str) -> Result<()> {
        if let Some(conv) = self.conversations.get(conversation_id) {
            let path = self
                .base_dir
                .join("messages")
                .join(format!("{}.json", sanitize_filename(conversation_id)));
            let data = serde_json::to_string_pretty(conv)
                .map_err(|e| ArchivistError::ChatError(format!("Serialize conversation: {}", e)))?;
            std::fs::write(&path, data)
                .map_err(|e| ArchivistError::ChatError(format!("Write conversation: {}", e)))?;
        }
        Ok(())
    }
}

fn short_peer_id(peer_id: &str) -> String {
    if peer_id.len() > 12 {
        format!("{}..{}", &peer_id[..6], &peer_id[peer_id.len() - 4..])
    } else {
        peer_id.to_string()
    }
}

fn sanitize_filename(name: &str) -> String {
    name.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_")
}
