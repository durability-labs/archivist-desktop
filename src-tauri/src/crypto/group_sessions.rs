use std::collections::HashMap;
use vodozemac::megolm::{
    GroupSession, GroupSessionPickle, InboundGroupSession, InboundGroupSessionPickle, SessionConfig,
};

use super::key_store::KeyStore;
use crate::error::{ArchivistError, Result};

/// Manages Megolm group sessions for efficient group encryption.
pub struct GroupSessionManager {
    /// Outbound session (our own, for sending)
    outbound: HashMap<String, GroupSession>,
    /// Inbound sessions (one per sender per group)
    inbound: HashMap<String, HashMap<String, InboundGroupSession>>,
}

impl Default for GroupSessionManager {
    fn default() -> Self {
        Self::new()
    }
}

impl GroupSessionManager {
    pub fn new() -> Self {
        Self {
            outbound: HashMap::new(),
            inbound: HashMap::new(),
        }
    }

    /// Create a new outbound group session, returning the exportable session key.
    pub fn create_group_session(&mut self, group_id: &str, key_store: &KeyStore) -> Result<String> {
        let session = GroupSession::new(SessionConfig::version_2());
        let session_key = session.session_key().to_base64();

        self.persist_outbound(group_id, &session, key_store)?;
        self.outbound.insert(group_id.to_string(), session);

        log::info!("Created new Megolm outbound session for group {}", group_id);
        Ok(session_key)
    }

    /// Add an inbound group session (from another sender).
    pub fn add_inbound_session(
        &mut self,
        group_id: &str,
        sender_key: &str,
        exported_session_key: &str,
        key_store: &KeyStore,
    ) -> Result<()> {
        let session_key = vodozemac::megolm::SessionKey::from_base64(exported_session_key)
            .map_err(|e| ArchivistError::CryptoError(format!("Parse Megolm session key: {}", e)))?;

        let session = InboundGroupSession::new(&session_key, SessionConfig::version_2());

        self.persist_inbound(group_id, sender_key, &session, key_store)?;
        self.inbound
            .entry(group_id.to_string())
            .or_default()
            .insert(sender_key.to_string(), session);

        log::info!(
            "Added inbound Megolm session for group {} from {}",
            group_id,
            sender_key
        );
        Ok(())
    }

    /// Encrypt a plaintext with the outbound group session.
    pub fn encrypt_group(
        &mut self,
        group_id: &str,
        plaintext: &[u8],
        key_store: &KeyStore,
    ) -> Result<(String, u32)> {
        let session = self.outbound.get_mut(group_id).ok_or_else(|| {
            ArchivistError::CryptoError(format!("No outbound group session for {}", group_id))
        })?;

        let message = session.encrypt(plaintext);
        let message_index = message.message_index();
        let ciphertext = message.to_base64();

        // Persist inline to avoid borrow conflict (session is borrowed from self.outbound)
        let pickle = session.pickle();
        let pickle_str = serde_json::to_string(&pickle).map_err(|e| {
            ArchivistError::CryptoError(format!("Group session pickle serialize: {}", e))
        })?;
        key_store.save_outbound_group_session(group_id, pickle_str.as_bytes())?;
        Ok((ciphertext, message_index))
    }

    /// Decrypt a message from a sender in a group.
    pub fn decrypt_group(
        &mut self,
        group_id: &str,
        sender_key: &str,
        ciphertext: &str,
        key_store: &KeyStore,
    ) -> Result<Vec<u8>> {
        let senders = self.inbound.get_mut(group_id).ok_or_else(|| {
            ArchivistError::CryptoError(format!("No inbound group sessions for {}", group_id))
        })?;

        let session = senders.get_mut(sender_key).ok_or_else(|| {
            ArchivistError::CryptoError(format!(
                "No inbound group session for sender {} in {}",
                sender_key, group_id
            ))
        })?;

        let message = vodozemac::megolm::MegolmMessage::from_base64(ciphertext)
            .map_err(|e| ArchivistError::CryptoError(format!("Parse Megolm message: {}", e)))?;

        let result = session
            .decrypt(&message)
            .map_err(|e| ArchivistError::CryptoError(format!("Megolm decrypt: {}", e)))?;

        // Persist inline to avoid borrow conflict (session is borrowed from self.inbound)
        let pickle = session.pickle();
        let pickle_str = serde_json::to_string(&pickle).map_err(|e| {
            ArchivistError::CryptoError(format!("Inbound group pickle serialize: {}", e))
        })?;
        key_store.save_inbound_group_session(group_id, sender_key, pickle_str.as_bytes())?;
        Ok(result.plaintext)
    }

    /// Rekey the outbound group session (e.g., on membership change).
    /// Returns the new session key to distribute.
    pub fn rekey_group(&mut self, group_id: &str, key_store: &KeyStore) -> Result<String> {
        // Create fresh session — old messages cannot be decrypted with new key
        self.create_group_session(group_id, key_store)
    }

    pub fn session_id(&self, group_id: &str) -> Option<String> {
        self.outbound
            .get(group_id)
            .map(|s| s.session_id().to_string())
    }

    pub fn has_outbound(&self, group_id: &str) -> bool {
        self.outbound.contains_key(group_id)
    }

    /// Load a persisted outbound session from disk.
    pub fn load_outbound_session(&mut self, group_id: &str, key_store: &KeyStore) -> Result<bool> {
        if self.outbound.contains_key(group_id) {
            return Ok(true);
        }
        if let Some(bytes) = key_store.load_outbound_group_session(group_id)? {
            let pickle_str = String::from_utf8(bytes).map_err(|e| {
                ArchivistError::CryptoError(format!("Group session pickle UTF-8: {}", e))
            })?;
            let pickle: GroupSessionPickle = serde_json::from_str(&pickle_str).map_err(|e| {
                ArchivistError::CryptoError(format!("Group session pickle JSON: {}", e))
            })?;
            let session = GroupSession::from_pickle(pickle);
            self.outbound.insert(group_id.to_string(), session);
            Ok(true)
        } else {
            Ok(false)
        }
    }

    /// Load a persisted inbound session.
    pub fn load_inbound_session(
        &mut self,
        group_id: &str,
        sender_key: &str,
        key_store: &KeyStore,
    ) -> Result<bool> {
        if self
            .inbound
            .get(group_id)
            .is_some_and(|m| m.contains_key(sender_key))
        {
            return Ok(true);
        }
        if let Some(bytes) = key_store.load_inbound_group_session(group_id, sender_key)? {
            let pickle_str = String::from_utf8(bytes).map_err(|e| {
                ArchivistError::CryptoError(format!("Inbound group pickle UTF-8: {}", e))
            })?;
            let pickle: InboundGroupSessionPickle =
                serde_json::from_str(&pickle_str).map_err(|e| {
                    ArchivistError::CryptoError(format!("Inbound group pickle JSON: {}", e))
                })?;
            let session = InboundGroupSession::from_pickle(pickle);
            self.inbound
                .entry(group_id.to_string())
                .or_default()
                .insert(sender_key.to_string(), session);
            Ok(true)
        } else {
            Ok(false)
        }
    }

    fn persist_outbound(
        &self,
        group_id: &str,
        session: &GroupSession,
        key_store: &KeyStore,
    ) -> Result<()> {
        let pickle = session.pickle();
        let pickle_str = serde_json::to_string(&pickle).map_err(|e| {
            ArchivistError::CryptoError(format!("Group session pickle serialize: {}", e))
        })?;
        key_store.save_outbound_group_session(group_id, pickle_str.as_bytes())
    }

    fn persist_inbound(
        &self,
        group_id: &str,
        sender_key: &str,
        session: &InboundGroupSession,
        key_store: &KeyStore,
    ) -> Result<()> {
        let pickle = session.pickle();
        let pickle_str = serde_json::to_string(&pickle).map_err(|e| {
            ArchivistError::CryptoError(format!("Inbound group pickle serialize: {}", e))
        })?;
        key_store.save_inbound_group_session(group_id, sender_key, pickle_str.as_bytes())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn make_ks() -> (KeyStore, TempDir) {
        let tmp = TempDir::new().unwrap();
        let ks = KeyStore::new(tmp.path()).unwrap();
        (ks, tmp)
    }

    #[test]
    fn test_group_encrypt_decrypt() {
        let (ks_a, _ta) = make_ks();
        let (ks_b, _tb) = make_ks();

        let mut alice_gsm = GroupSessionManager::new();
        let session_key = alice_gsm.create_group_session("g1", &ks_a).unwrap();

        // Bob receives the session key and creates inbound
        let mut bob_gsm = GroupSessionManager::new();
        bob_gsm
            .add_inbound_session("g1", "alice", &session_key, &ks_b)
            .unwrap();

        // Alice encrypts
        let (ct, _idx) = alice_gsm
            .encrypt_group("g1", b"group hello", &ks_a)
            .unwrap();

        // Bob decrypts
        let pt = bob_gsm.decrypt_group("g1", "alice", &ct, &ks_b).unwrap();
        assert_eq!(pt, b"group hello");
    }

    #[test]
    fn test_rekey_prevents_old_session_decrypt() {
        let (ks_a, _ta) = make_ks();
        let (ks_b, _tb) = make_ks();

        let mut alice_gsm = GroupSessionManager::new();
        let key1 = alice_gsm.create_group_session("g1", &ks_a).unwrap();

        let mut bob_gsm = GroupSessionManager::new();
        bob_gsm
            .add_inbound_session("g1", "alice", &key1, &ks_b)
            .unwrap();

        // Rekey
        let key2 = alice_gsm.rekey_group("g1", &ks_a).unwrap();
        assert_ne!(key1, key2);

        // Encrypt with new session
        let (ct, _) = alice_gsm
            .encrypt_group("g1", b"after rekey", &ks_a)
            .unwrap();

        // Bob's old inbound session should fail
        let result = bob_gsm.decrypt_group("g1", "alice", &ct, &ks_b);
        assert!(result.is_err());
    }

    #[test]
    fn test_multiple_senders() {
        let (ks_a, _ta) = make_ks();
        let (ks_b, _tb) = make_ks();
        let (ks_c, _tc) = make_ks();

        // Alice creates group
        let mut alice_gsm = GroupSessionManager::new();
        let alice_key = alice_gsm.create_group_session("g1", &ks_a).unwrap();

        // Bob creates group
        let mut bob_gsm = GroupSessionManager::new();
        let bob_key = bob_gsm.create_group_session("g1", &ks_b).unwrap();

        // Carol has inbound for both
        let mut carol_gsm = GroupSessionManager::new();
        carol_gsm
            .add_inbound_session("g1", "alice", &alice_key, &ks_c)
            .unwrap();
        carol_gsm
            .add_inbound_session("g1", "bob", &bob_key, &ks_c)
            .unwrap();

        let (ct_a, _) = alice_gsm.encrypt_group("g1", b"from alice", &ks_a).unwrap();
        let (ct_b, _) = bob_gsm.encrypt_group("g1", b"from bob", &ks_b).unwrap();

        assert_eq!(
            carol_gsm
                .decrypt_group("g1", "alice", &ct_a, &ks_c)
                .unwrap(),
            b"from alice"
        );
        assert_eq!(
            carol_gsm.decrypt_group("g1", "bob", &ct_b, &ks_c).unwrap(),
            b"from bob"
        );
    }
}
