//! Core chat orchestrator — ties together crypto, storage, delivery, and TOFU.

use chrono::Utc;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use vodozemac::olm::OlmMessage;

use super::chat_delivery_queue::{DeliveryQueue, PendingDelivery};
use super::chat_message_store::MessageStore;
use super::chat_server::ChatIncomingHandler;
use super::chat_tofu::TofuStore;
use super::chat_types::*;
use crate::crypto::group_sessions::GroupSessionManager;
use crate::crypto::identity::IdentityManager;
use crate::crypto::key_store::KeyStore;
use crate::crypto::safety_numbers;
use crate::crypto::sessions::SessionManager;
use crate::error::{ArchivistError, Result};

/// Core chat service.
pub struct ChatService {
    pub identity: IdentityManager,
    pub sessions: SessionManager,
    pub group_sessions: GroupSessionManager,
    pub tofu_store: TofuStore,
    pub key_store: Arc<KeyStore>,
    pub message_store: MessageStore,
    pub delivery_queue: DeliveryQueue,
    pub our_peer_id: String,
    pub our_cert_fingerprint: String,
    /// Group metadata
    groups: HashMap<String, GroupInfo>,
    /// Chat port for outgoing connections
    chat_port: u16,
    /// Tauri app handle for emitting events (set after construction)
    app_handle: Option<tauri::AppHandle>,
    /// Peer identity keys (peer_id → Curve25519 base64) for safety numbers
    peer_identity_keys: HashMap<String, String>,
    /// Max message size in bytes (from ChatSettings)
    max_message_size: usize,
    /// Whether to persist message history (from ChatSettings)
    store_history: bool,
    /// Whether to emit notification events (from ChatSettings)
    notify_on_message: bool,
}

impl ChatService {
    pub fn new(
        key_store: Arc<KeyStore>,
        peer_id: String,
        cert_fingerprint: String,
        chat_settings: &crate::services::config::ChatSettings,
    ) -> Result<Self> {
        let identity = IdentityManager::load_or_create(&key_store, &peer_id)?;
        let sessions = SessionManager::new();
        let group_sessions = GroupSessionManager::new();
        let tofu_store = TofuStore::new(key_store.base_dir())?;
        let message_store = MessageStore::new(key_store.base_dir())?;
        let delivery_queue = DeliveryQueue::new();

        Ok(Self {
            identity,
            sessions,
            group_sessions,
            tofu_store,
            key_store,
            message_store,
            delivery_queue,
            our_peer_id: peer_id,
            our_cert_fingerprint: cert_fingerprint,
            groups: HashMap::new(),
            chat_port: chat_settings.port,
            app_handle: None,
            peer_identity_keys: HashMap::new(),
            max_message_size: chat_settings.max_message_size,
            store_history: chat_settings.store_history,
            notify_on_message: chat_settings.notify_on_message,
        })
    }

    pub fn set_app_handle(&mut self, handle: tauri::AppHandle) {
        self.app_handle = Some(handle);
    }

    fn emit_event<S: serde::Serialize + Clone>(&self, event: &str, payload: &S) {
        if let Some(ref handle) = self.app_handle {
            use tauri::Emitter;
            let _ = handle.emit(event, payload.clone());
        }
    }

    /// Update the peer ID once the node has started and we know our real ID.
    pub fn update_peer_id(&mut self, peer_id: &str) {
        log::info!(
            "Updating chat peer ID from '{}' to '{}'",
            self.our_peer_id,
            peer_id
        );
        self.our_peer_id = peer_id.to_string();
        self.identity.set_peer_id(peer_id);
    }

    // ── Session Establishment ──────────────────────────────────

    /// Initiate a chat session with a peer (exchange pre-key bundles).
    /// `peer_address` is the IP of the peer's chat server.
    pub async fn initiate_session(&mut self, peer_id: &str, peer_address: &str) -> Result<String> {
        // Generate OTKs if needed
        self.identity
            .generate_one_time_keys_if_needed(&self.key_store)?;

        let our_bundle = self.identity.export_pre_key_bundle();
        let exchange = PreKeyBundleExchange {
            sender_peer_id: self.our_peer_id.clone(),
            bundle: our_bundle,
            cert_fingerprint: self.our_cert_fingerprint.clone(),
        };

        // POST to peer's /chat/prekey-bundle
        let client = reqwest::Client::builder()
            .danger_accept_invalid_certs(true)
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .map_err(|e| ArchivistError::ChatError(format!("HTTP client: {}", e)))?;

        let url = format!(
            "https://{}:{}/chat/prekey-bundle",
            peer_address, self.chat_port
        );

        let resp = client
            .post(&url)
            .json(&exchange)
            .send()
            .await
            .map_err(|e| ArchivistError::ChatError(format!("Pre-key exchange: {}", e)))?;

        if !resp.status().is_success() {
            return Err(ArchivistError::ChatError(format!(
                "Pre-key exchange failed: HTTP {}",
                resp.status()
            )));
        }

        let peer_exchange: PreKeyBundleExchange = resp
            .json()
            .await
            .map_err(|e| ArchivistError::ChatError(format!("Parse peer bundle: {}", e)))?;

        // TOFU: store peer's cert fingerprint
        let trusted = self
            .tofu_store
            .check_or_store(peer_id, &peer_exchange.cert_fingerprint)?;

        if !trusted {
            self.emit_event(
                "chat-identity-changed",
                &serde_json::json!({
                    "peerId": peer_id,
                    "oldFingerprint": self.tofu_store.get_entry(peer_id)
                        .and_then(|e| e.previous_fingerprint.as_ref()),
                    "newFingerprint": peer_exchange.cert_fingerprint,
                }),
            );
        }

        // Store peer's identity key for safety numbers
        self.peer_identity_keys.insert(
            peer_id.to_string(),
            peer_exchange.bundle.identity_key.clone(),
        );

        // Create outbound Olm session
        self.sessions.create_outbound_session(
            self.identity.account_mut(),
            &peer_exchange.bundle,
            &self.key_store,
        )?;

        self.identity.mark_keys_as_published();
        self.identity.persist(&self.key_store)?;

        // Ensure conversation exists
        let conv_id = format!("dm:{}", peer_id);
        self.message_store.get_or_create_direct(peer_id);

        self.emit_event(
            "chat-session-established",
            &serde_json::json!({
                "peerId": peer_id,
                "conversationId": conv_id,
            }),
        );

        log::info!("Chat session established with {}", peer_id);
        Ok(conv_id)
    }

    // ── 1-to-1 Messaging ──────────────────────────────────────

    /// Send a message to a peer.
    pub fn send_message(
        &mut self,
        conversation_id: &str,
        text: &str,
        reply_to: Option<String>,
        peer_address: &str,
    ) -> Result<StoredMessage> {
        // Enforce max message size
        if text.len() > self.max_message_size {
            return Err(ArchivistError::ChatError(format!(
                "Message too large: {} bytes (max {})",
                text.len(),
                self.max_message_size
            )));
        }

        // Extract peer_id from conversation_id (dm:{peer_id})
        let peer_id = conversation_id
            .strip_prefix("dm:")
            .ok_or_else(|| ArchivistError::ChatError("Invalid DM conversation ID".to_string()))?
            .to_string();

        // Try to load session from disk if not in memory
        self.sessions.load_session(&peer_id, &self.key_store)?;

        let content = ChatMessageContent {
            text: text.to_string(),
            reply_to,
            attachments: Vec::new(),
        };

        let plaintext = serde_json::to_vec(&content)
            .map_err(|e| ArchivistError::ChatError(format!("Serialize content: {}", e)))?;

        let olm_msg = self
            .sessions
            .encrypt(&peer_id, &plaintext, &self.key_store)?;

        let message_id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now();

        // Determine message type and serialize
        let (msg_type, ciphertext) = match &olm_msg {
            OlmMessage::PreKey(pk) => (OlmMessageType::PreKey, serde_json::to_string(pk).unwrap()),
            OlmMessage::Normal(n) => (OlmMessageType::Normal, serde_json::to_string(n).unwrap()),
        };

        let encrypted = EncryptedChatMessage {
            message_id: message_id.clone(),
            sender_peer_id: self.our_peer_id.clone(),
            sender_identity_key: self.identity.curve25519_key().to_base64(),
            message_type: msg_type,
            ciphertext,
            timestamp: now,
        };

        let payload = serde_json::to_string(&encrypted)
            .map_err(|e| ArchivistError::ChatError(format!("Serialize message: {}", e)))?;

        // Enqueue for delivery
        self.delivery_queue.enqueue(PendingDelivery {
            message_id: message_id.clone(),
            conversation_id: conversation_id.to_string(),
            target_peer_id: peer_id.clone(),
            target_address: peer_address.to_string(),
            target_port: self.chat_port,
            endpoint: "chat/message".to_string(),
            payload,
            retry_count: 0,
            max_retries: 100,
            last_attempt: None,
            created_at: now,
        });

        // Store locally
        let stored = StoredMessage {
            id: message_id,
            sender_peer_id: self.our_peer_id.clone(),
            content,
            timestamp: now,
            delivery_status: DeliveryStatus::Sending,
            is_outgoing: true,
        };

        if self.store_history {
            self.message_store
                .add_message(conversation_id, stored.clone())?;
        }

        Ok(stored)
    }

    /// Receive and decrypt an incoming 1-to-1 message.
    pub fn receive_message(&mut self, encrypted: EncryptedChatMessage) -> Result<StoredMessage> {
        let peer_id = &encrypted.sender_peer_id;

        // Try to load existing session
        self.sessions.load_session(peer_id, &self.key_store)?;

        let plaintext = match encrypted.message_type {
            OlmMessageType::PreKey => {
                let pk_msg: vodozemac::olm::PreKeyMessage =
                    serde_json::from_str(&encrypted.ciphertext).map_err(|e| {
                        ArchivistError::CryptoError(format!("Parse PreKey message: {}", e))
                    })?;
                let sender_ik =
                    vodozemac::Curve25519PublicKey::from_base64(&encrypted.sender_identity_key)
                        .map_err(|e| {
                            ArchivistError::CryptoError(format!("Parse sender identity key: {}", e))
                        })?;
                self.sessions.create_inbound_session(
                    self.identity.account_mut(),
                    peer_id,
                    sender_ik,
                    &pk_msg,
                    &self.key_store,
                )?
            }
            OlmMessageType::Normal => {
                let normal_msg: vodozemac::olm::Message =
                    serde_json::from_str(&encrypted.ciphertext).map_err(|e| {
                        ArchivistError::CryptoError(format!("Parse Normal message: {}", e))
                    })?;
                self.sessions
                    .decrypt(peer_id, &OlmMessage::Normal(normal_msg), &self.key_store)?
            }
        };

        self.identity.persist(&self.key_store)?;

        let content: ChatMessageContent = serde_json::from_slice(&plaintext)
            .map_err(|e| ArchivistError::ChatError(format!("Parse message content: {}", e)))?;

        // Store peer's identity key if not already known
        if !self.peer_identity_keys.contains_key(peer_id) {
            self.peer_identity_keys
                .insert(peer_id.to_string(), encrypted.sender_identity_key.clone());
        }

        // Store
        let conv_id = format!("dm:{}", peer_id);
        self.message_store.get_or_create_direct(peer_id);

        let stored = StoredMessage {
            id: encrypted.message_id.clone(),
            sender_peer_id: peer_id.clone(),
            content,
            timestamp: encrypted.timestamp,
            delivery_status: DeliveryStatus::Delivered,
            is_outgoing: false,
        };

        if self.store_history {
            self.message_store.add_message(&conv_id, stored.clone())?;
        }

        if self.notify_on_message {
            self.emit_event(
                "chat-message-received",
                &serde_json::json!({
                    "conversationId": conv_id,
                    "message": stored,
                }),
            );
        }

        self.emit_unread_count();
        Ok(stored)
    }

    // ── Group Messaging ────────────────────────────────────────

    /// Create a group chat and distribute Megolm session keys.
    pub fn create_group(
        &mut self,
        group_name: &str,
        member_peer_ids: Vec<String>,
        member_addresses: &HashMap<String, String>,
    ) -> Result<GroupInfo> {
        let group_id = uuid::Uuid::new_v4().to_string();

        let session_key = self
            .group_sessions
            .create_group_session(&group_id, &self.key_store)?;

        let members: Vec<GroupMemberInfo> = member_peer_ids
            .iter()
            .map(|pid| GroupMemberInfo {
                peer_id: pid.clone(),
                identity_key: String::new(), // Filled when sessions exist
            })
            .collect();

        let group_info = GroupInfo {
            group_id: group_id.clone(),
            group_name: group_name.to_string(),
            creator_peer_id: self.our_peer_id.clone(),
            members: members.clone(),
            created_at: Utc::now(),
        };

        self.groups.insert(group_id.clone(), group_info.clone());

        // Create conversation
        self.message_store
            .get_or_create_group(&group_id, group_name, member_peer_ids.clone());

        // Send invites to each member
        for peer_id in &member_peer_ids {
            if let Some(addr) = member_addresses.get(peer_id) {
                // Encrypt session key via Olm for this peer
                self.sessions.load_session(peer_id, &self.key_store)?;
                let encrypted_key = if self.sessions.has_session(peer_id) {
                    let msg =
                        self.sessions
                            .encrypt(peer_id, session_key.as_bytes(), &self.key_store)?;
                    match msg {
                        OlmMessage::PreKey(pk) => serde_json::to_string(&pk).unwrap(),
                        OlmMessage::Normal(n) => serde_json::to_string(&n).unwrap(),
                    }
                } else {
                    log::warn!("No Olm session with {} — cannot send group invite", peer_id);
                    continue;
                };

                let invite = GroupInvite {
                    group_id: group_id.clone(),
                    group_name: group_name.to_string(),
                    creator_peer_id: self.our_peer_id.clone(),
                    members: members.clone(),
                    encrypted_session_key: encrypted_key,
                };

                let payload = serde_json::to_string(&invite).unwrap();
                self.delivery_queue.enqueue(PendingDelivery {
                    message_id: format!("invite:{}:{}", group_id, peer_id),
                    conversation_id: group_id.clone(),
                    target_peer_id: peer_id.clone(),
                    target_address: addr.clone(),
                    target_port: self.chat_port,
                    endpoint: "chat/group/invite".to_string(),
                    payload,
                    retry_count: 0,
                    max_retries: 50,
                    last_attempt: None,
                    created_at: Utc::now(),
                });
            }
        }

        log::info!(
            "Created group '{}' ({}) with {} members",
            group_name,
            group_id,
            member_peer_ids.len()
        );
        Ok(group_info)
    }

    /// Send a message to a group.
    pub fn send_group_message(
        &mut self,
        group_id: &str,
        text: &str,
        reply_to: Option<String>,
        member_addresses: &HashMap<String, String>,
    ) -> Result<StoredMessage> {
        let content = ChatMessageContent {
            text: text.to_string(),
            reply_to,
            attachments: Vec::new(),
        };

        let plaintext = serde_json::to_vec(&content)
            .map_err(|e| ArchivistError::ChatError(format!("Serialize content: {}", e)))?;

        // Load outbound session if needed
        self.group_sessions
            .load_outbound_session(group_id, &self.key_store)?;

        let (ciphertext, message_index) =
            self.group_sessions
                .encrypt_group(group_id, &plaintext, &self.key_store)?;

        let session_id = self.group_sessions.session_id(group_id).unwrap_or_default();

        let message_id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now();

        let encrypted = EncryptedGroupMessage {
            message_id: message_id.clone(),
            group_id: group_id.to_string(),
            sender_peer_id: self.our_peer_id.clone(),
            sender_identity_key: self.identity.curve25519_key().to_base64(),
            ciphertext,
            session_id,
            message_index,
            timestamp: now,
        };

        let payload = serde_json::to_string(&encrypted).unwrap();

        // Send to all members
        if let Some(group) = self.groups.get(group_id) {
            for member in &group.members {
                if member.peer_id == self.our_peer_id {
                    continue;
                }
                if let Some(addr) = member_addresses.get(&member.peer_id) {
                    self.delivery_queue.enqueue(PendingDelivery {
                        message_id: format!("{}:{}", message_id, member.peer_id),
                        conversation_id: group_id.to_string(),
                        target_peer_id: member.peer_id.clone(),
                        target_address: addr.clone(),
                        target_port: self.chat_port,
                        endpoint: "chat/group/message".to_string(),
                        payload: payload.clone(),
                        retry_count: 0,
                        max_retries: 100,
                        last_attempt: None,
                        created_at: now,
                    });
                }
            }
        }

        let stored = StoredMessage {
            id: message_id,
            sender_peer_id: self.our_peer_id.clone(),
            content,
            timestamp: now,
            delivery_status: DeliveryStatus::Sending,
            is_outgoing: true,
        };

        self.message_store.add_message(group_id, stored.clone())?;

        Ok(stored)
    }

    /// Receive and decrypt an incoming group message.
    pub fn receive_group_message(
        &mut self,
        encrypted: EncryptedGroupMessage,
    ) -> Result<StoredMessage> {
        let peer_id = &encrypted.sender_peer_id;
        let group_id = &encrypted.group_id;

        self.group_sessions
            .load_inbound_session(group_id, peer_id, &self.key_store)?;

        let plaintext = self.group_sessions.decrypt_group(
            group_id,
            peer_id,
            &encrypted.ciphertext,
            &self.key_store,
        )?;

        let content: ChatMessageContent = serde_json::from_slice(&plaintext)
            .map_err(|e| ArchivistError::ChatError(format!("Parse group message: {}", e)))?;

        let stored = StoredMessage {
            id: encrypted.message_id.clone(),
            sender_peer_id: peer_id.clone(),
            content,
            timestamp: encrypted.timestamp,
            delivery_status: DeliveryStatus::Delivered,
            is_outgoing: false,
        };

        self.message_store.add_message(group_id, stored.clone())?;

        self.emit_event(
            "chat-message-received",
            &serde_json::json!({
                "conversationId": group_id,
                "message": stored,
            }),
        );

        self.emit_unread_count();
        Ok(stored)
    }

    /// Handle a group invite.
    pub fn handle_group_invite(&mut self, invite: GroupInvite) -> Result<()> {
        let peer_id = &invite.creator_peer_id;

        // Decrypt session key via our Olm session
        self.sessions.load_session(peer_id, &self.key_store)?;

        // Try to parse as pre-key or normal message
        let session_key_bytes = if let Ok(pk_msg) =
            serde_json::from_str::<vodozemac::olm::PreKeyMessage>(&invite.encrypted_session_key)
        {
            let sender_ik = pk_msg.identity_key();
            self.sessions.create_inbound_session(
                self.identity.account_mut(),
                peer_id,
                sender_ik,
                &pk_msg,
                &self.key_store,
            )?
        } else if let Ok(normal_msg) =
            serde_json::from_str::<vodozemac::olm::Message>(&invite.encrypted_session_key)
        {
            self.sessions
                .decrypt(peer_id, &OlmMessage::Normal(normal_msg), &self.key_store)?
        } else {
            return Err(ArchivistError::CryptoError(
                "Cannot decrypt group session key".to_string(),
            ));
        };

        self.identity.persist(&self.key_store)?;

        let session_key = String::from_utf8(session_key_bytes)
            .map_err(|e| ArchivistError::CryptoError(format!("Session key UTF-8: {}", e)))?;

        self.group_sessions.add_inbound_session(
            &invite.group_id,
            peer_id,
            &session_key,
            &self.key_store,
        )?;

        // Store group info
        let group_info = GroupInfo {
            group_id: invite.group_id.clone(),
            group_name: invite.group_name.clone(),
            creator_peer_id: invite.creator_peer_id.clone(),
            members: invite.members.clone(),
            created_at: Utc::now(),
        };
        self.groups.insert(invite.group_id.clone(), group_info);

        // Create conversation
        let member_ids: Vec<String> = invite.members.iter().map(|m| m.peer_id.clone()).collect();
        self.message_store
            .get_or_create_group(&invite.group_id, &invite.group_name, member_ids);

        self.emit_event(
            "chat-group-invite",
            &serde_json::json!({
                "groupId": invite.group_id,
                "groupName": invite.group_name,
                "inviterPeerId": invite.creator_peer_id,
            }),
        );

        log::info!(
            "Joined group '{}' ({}) invited by {}",
            invite.group_name,
            invite.group_id,
            invite.creator_peer_id
        );
        Ok(())
    }

    /// Handle a group rekey.
    pub fn handle_group_rekey(&mut self, rekey: GroupRekey) -> Result<()> {
        // The encrypted_session_key is Olm-encrypted from the sender
        // For simplicity, we expect the sender to have an active Olm session
        // The new session key was encrypted specifically for us
        let group = self.groups.get(&rekey.group_id).cloned();
        let sender_peer_id = group
            .as_ref()
            .map(|g| g.creator_peer_id.clone())
            .unwrap_or_default();

        if !sender_peer_id.is_empty() {
            self.sessions
                .load_session(&sender_peer_id, &self.key_store)?;

            let session_key_bytes = if let Ok(normal_msg) =
                serde_json::from_str::<vodozemac::olm::Message>(&rekey.encrypted_session_key)
            {
                self.sessions.decrypt(
                    &sender_peer_id,
                    &OlmMessage::Normal(normal_msg),
                    &self.key_store,
                )?
            } else {
                return Err(ArchivistError::CryptoError(
                    "Cannot decrypt rekey session key".to_string(),
                ));
            };

            let session_key = String::from_utf8(session_key_bytes)
                .map_err(|e| ArchivistError::CryptoError(format!("Rekey UTF-8: {}", e)))?;

            self.group_sessions.add_inbound_session(
                &rekey.group_id,
                &sender_peer_id,
                &session_key,
                &self.key_store,
            )?;
        }

        self.emit_event(
            "chat-group-rekey",
            &serde_json::json!({
                "groupId": rekey.group_id,
                "reason": rekey.reason,
            }),
        );

        Ok(())
    }

    /// Add a member to a group and rekey.
    pub fn add_group_member(
        &mut self,
        group_id: &str,
        peer_id: &str,
        member_addresses: &HashMap<String, String>,
    ) -> Result<()> {
        // Rekey — new member can't read old messages
        let new_session_key = self.group_sessions.rekey_group(group_id, &self.key_store)?;

        // Add to group metadata
        if let Some(group) = self.groups.get_mut(group_id) {
            group.members.push(GroupMemberInfo {
                peer_id: peer_id.to_string(),
                identity_key: String::new(),
            });
        }

        self.message_store.add_group_member(group_id, peer_id)?;

        // Distribute new key to all members (including new one) via Olm
        self.distribute_group_key(
            group_id,
            &new_session_key,
            RekeyReason::MemberAdded,
            member_addresses,
        )?;

        Ok(())
    }

    /// Remove a member from a group and rekey.
    pub fn remove_group_member(
        &mut self,
        group_id: &str,
        peer_id: &str,
        member_addresses: &HashMap<String, String>,
    ) -> Result<()> {
        // Remove from group metadata first
        if let Some(group) = self.groups.get_mut(group_id) {
            group.members.retain(|m| m.peer_id != peer_id);
        }

        self.message_store.remove_group_member(group_id, peer_id)?;

        // Rekey — removed member can't read future messages
        let new_session_key = self.group_sessions.rekey_group(group_id, &self.key_store)?;

        // Distribute to remaining members only
        self.distribute_group_key(
            group_id,
            &new_session_key,
            RekeyReason::MemberRemoved,
            member_addresses,
        )?;

        Ok(())
    }

    fn distribute_group_key(
        &mut self,
        group_id: &str,
        session_key: &str,
        reason: RekeyReason,
        member_addresses: &HashMap<String, String>,
    ) -> Result<()> {
        let members = self
            .groups
            .get(group_id)
            .map(|g| g.members.clone())
            .unwrap_or_default();

        for member in &members {
            if member.peer_id == self.our_peer_id {
                continue;
            }
            if let Some(addr) = member_addresses.get(&member.peer_id) {
                self.sessions
                    .load_session(&member.peer_id, &self.key_store)?;

                if self.sessions.has_session(&member.peer_id) {
                    let msg = self.sessions.encrypt(
                        &member.peer_id,
                        session_key.as_bytes(),
                        &self.key_store,
                    )?;
                    let encrypted_key = match msg {
                        OlmMessage::PreKey(pk) => serde_json::to_string(&pk).unwrap(),
                        OlmMessage::Normal(n) => serde_json::to_string(&n).unwrap(),
                    };

                    let session_id = self.group_sessions.session_id(group_id).unwrap_or_default();

                    let rekey = GroupRekey {
                        group_id: group_id.to_string(),
                        new_session_id: session_id,
                        encrypted_session_key: encrypted_key,
                        reason: reason.clone(),
                    };

                    let payload = serde_json::to_string(&rekey).unwrap();
                    self.delivery_queue.enqueue(PendingDelivery {
                        message_id: format!("rekey:{}:{}", group_id, member.peer_id),
                        conversation_id: group_id.to_string(),
                        target_peer_id: member.peer_id.clone(),
                        target_address: addr.clone(),
                        target_port: self.chat_port,
                        endpoint: "chat/group/rekey".to_string(),
                        payload,
                        retry_count: 0,
                        max_retries: 50,
                        last_attempt: None,
                        created_at: Utc::now(),
                    });
                }
            }
        }

        Ok(())
    }

    // ── Queries ────────────────────────────────────────────────

    pub fn get_conversations(&self) -> Vec<ConversationSummary> {
        self.message_store.get_conversation_summaries()
    }

    pub fn get_messages(
        &self,
        conversation_id: &str,
        limit: usize,
        before: Option<chrono::DateTime<Utc>>,
    ) -> Vec<StoredMessage> {
        self.message_store
            .get_messages(conversation_id, limit, before)
    }

    pub fn mark_read(&mut self, conversation_id: &str) -> Result<()> {
        self.message_store.mark_read(conversation_id)?;
        self.emit_unread_count();
        Ok(())
    }

    pub fn delete_conversation(&mut self, conversation_id: &str) -> Result<()> {
        self.message_store.delete_conversation(conversation_id)
    }

    pub fn get_identity_info(&self) -> ChatIdentityInfo {
        ChatIdentityInfo {
            peer_id: self.our_peer_id.clone(),
            identity_key: self.identity.curve25519_key().to_base64(),
            signing_key: self.identity.ed25519_key().to_base64(),
            cert_fingerprint: self.our_cert_fingerprint.clone(),
        }
    }

    pub fn get_safety_number(&self, peer_id: &str) -> Result<SafetyNumberInfo> {
        let our_ik = self.identity.curve25519_key().to_base64();

        // Look up peer's Curve25519 identity key (stored during session establishment)
        // Fall back to TOFU cert fingerprint if identity key not yet known
        let their_ik = self
            .peer_identity_keys
            .get(peer_id)
            .cloned()
            .unwrap_or_else(|| {
                self.tofu_store
                    .get_fingerprint(peer_id)
                    .unwrap_or("unknown")
                    .to_string()
            });

        let safety_number = safety_numbers::compute_safety_number(&our_ik, &their_ik);
        let groups = safety_numbers::format_safety_number(&safety_number);
        let verified = self
            .tofu_store
            .get_entry(peer_id)
            .is_some_and(|e| e.trust_level == super::chat_tofu::TrustLevel::Verified);

        Ok(SafetyNumberInfo {
            peer_id: peer_id.to_string(),
            safety_number,
            groups,
            verified,
        })
    }

    pub fn verify_peer(&mut self, peer_id: &str) -> Result<()> {
        self.tofu_store.verify_peer(peer_id)
    }

    pub fn get_server_status(&self, running: bool) -> ChatServerStatus {
        ChatServerStatus {
            running,
            port: self.chat_port,
            total_unread: self.message_store.total_unread(),
            conversation_count: self.message_store.conversation_count(),
        }
    }

    pub fn get_group_info(&self, group_id: &str) -> Option<GroupInfo> {
        self.groups.get(group_id).cloned()
    }

    /// Process delivery queue — called from background loop.
    pub async fn process_delivery_queue(&mut self) {
        let (delivered, failed) = self.delivery_queue.process().await;

        for (msg_id, conv_id) in delivered {
            let _ = self.message_store.update_delivery_status(
                &conv_id,
                &msg_id,
                DeliveryStatus::Delivered,
            );
            self.emit_event(
                "chat-message-delivered",
                &serde_json::json!({
                    "messageId": msg_id,
                    "conversationId": conv_id,
                }),
            );
        }

        for (msg_id, conv_id, error) in failed {
            let _ = self.message_store.update_delivery_status(
                &conv_id,
                &msg_id,
                DeliveryStatus::Failed,
            );
            self.emit_event(
                "chat-delivery-failed",
                &serde_json::json!({
                    "messageId": msg_id,
                    "conversationId": conv_id,
                    "error": error,
                }),
            );
        }
    }

    fn emit_unread_count(&self) {
        let total = self.message_store.total_unread();
        let by_conversation = self.message_store.unread_by_conversation();
        self.emit_event(
            "chat-unread-count",
            &serde_json::json!({
                "total": total,
                "byConversation": by_conversation,
            }),
        );
    }
}

/// Wrapper to implement ChatIncomingHandler for Arc<RwLock<ChatService>>.
pub struct ChatIncomingAdapter {
    chat: Arc<RwLock<ChatService>>,
}

impl ChatIncomingAdapter {
    pub fn new(chat: Arc<RwLock<ChatService>>) -> Self {
        Self { chat }
    }
}

#[async_trait::async_trait]
impl ChatIncomingHandler for ChatIncomingAdapter {
    async fn handle_prekey_bundle(
        &self,
        exchange: PreKeyBundleExchange,
    ) -> std::result::Result<PreKeyBundleExchange, String> {
        let mut chat = self.chat.write().await;

        // Store TOFU
        let _trusted = chat
            .tofu_store
            .check_or_store(&exchange.sender_peer_id, &exchange.cert_fingerprint)
            .map_err(|e| e.to_string())?;

        // Store peer's identity key for safety numbers
        chat.peer_identity_keys.insert(
            exchange.sender_peer_id.clone(),
            exchange.bundle.identity_key.clone(),
        );

        // Destructure to get disjoint field borrows (avoids borrow checker conflicts)
        let ChatService {
            ref mut identity,
            ref mut sessions,
            ref key_store,
            ..
        } = *chat;

        // Generate OTKs
        identity
            .generate_one_time_keys_if_needed(key_store)
            .map_err(|e| e.to_string())?;

        let our_bundle = identity.export_pre_key_bundle();

        // Create outbound session with peer's bundle
        sessions
            .create_outbound_session(identity.account_mut(), &exchange.bundle, key_store)
            .map_err(|e| e.to_string())?;

        identity.mark_keys_as_published();
        identity.persist(key_store).map_err(|e| e.to_string())?;

        // Ensure conversation exists
        chat.message_store
            .get_or_create_direct(&exchange.sender_peer_id);

        Ok(PreKeyBundleExchange {
            sender_peer_id: chat.our_peer_id.clone(),
            bundle: our_bundle,
            cert_fingerprint: chat.our_cert_fingerprint.clone(),
        })
    }

    async fn handle_message(&self, msg: EncryptedChatMessage) -> std::result::Result<(), String> {
        let mut chat = self.chat.write().await;
        chat.receive_message(msg).map_err(|e| e.to_string())?;
        Ok(())
    }

    async fn handle_group_invite(&self, invite: GroupInvite) -> std::result::Result<(), String> {
        let mut chat = self.chat.write().await;
        chat.handle_group_invite(invite)
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    async fn handle_group_message(
        &self,
        msg: EncryptedGroupMessage,
    ) -> std::result::Result<(), String> {
        let mut chat = self.chat.write().await;
        chat.receive_group_message(msg).map_err(|e| e.to_string())?;
        Ok(())
    }

    async fn handle_group_rekey(&self, rekey: GroupRekey) -> std::result::Result<(), String> {
        let mut chat = self.chat.write().await;
        chat.handle_group_rekey(rekey).map_err(|e| e.to_string())?;
        Ok(())
    }

    async fn handle_ack(&self, ack: DeliveryAck) -> std::result::Result<(), String> {
        let mut chat = self.chat.write().await;
        // Find which conversation this message belongs to
        let convs = chat.message_store.get_conversation_summaries();
        for conv in convs {
            let status = match ack.status {
                DeliveryAckStatus::Delivered => DeliveryStatus::Delivered,
                DeliveryAckStatus::Read => DeliveryStatus::Read,
                DeliveryAckStatus::Failed => DeliveryStatus::Failed,
            };
            let _ = chat
                .message_store
                .update_delivery_status(&conv.id, &ack.message_id, status);
        }
        Ok(())
    }
}
