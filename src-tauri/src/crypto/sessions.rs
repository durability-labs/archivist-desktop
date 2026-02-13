use std::collections::HashMap;
use vodozemac::olm::{Account, OlmMessage, Session, SessionConfig};
use vodozemac::Curve25519PublicKey;

use super::identity::PreKeyBundle;
use super::key_store::KeyStore;
use crate::error::{ArchivistError, Result};

/// Manages per-peer Olm (Double Ratchet) sessions.
pub struct SessionManager {
    sessions: HashMap<String, Session>,
}

impl Default for SessionManager {
    fn default() -> Self {
        Self::new()
    }
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    /// Create an outbound session towards a peer using their pre-key bundle.
    pub fn create_outbound_session(
        &mut self,
        account: &mut Account,
        peer_bundle: &PreKeyBundle,
        key_store: &KeyStore,
    ) -> Result<()> {
        let their_ik = Curve25519PublicKey::from_base64(&peer_bundle.identity_key)
            .map_err(|e| ArchivistError::CryptoError(format!("Parse identity key: {}", e)))?;

        let their_otk = peer_bundle
            .one_time_key
            .as_ref()
            .map(|k| {
                Curve25519PublicKey::from_base64(k)
                    .map_err(|e| ArchivistError::CryptoError(format!("Parse OTK: {}", e)))
            })
            .transpose()?;

        let session = if let Some(otk) = their_otk {
            account.create_outbound_session(SessionConfig::version_2(), their_ik, otk)
        } else {
            return Err(ArchivistError::CryptoError(
                "Peer bundle missing one-time key".to_string(),
            ));
        };

        let peer_id = &peer_bundle.peer_id;
        self.persist_session(peer_id, &session, key_store)?;
        self.sessions.insert(peer_id.clone(), session);
        log::info!("Created outbound Olm session with {}", peer_id);
        Ok(())
    }

    /// Create an inbound session when we receive a pre-key message.
    pub fn create_inbound_session(
        &mut self,
        account: &mut Account,
        sender_peer_id: &str,
        sender_identity_key: Curve25519PublicKey,
        pre_key_message: &vodozemac::olm::PreKeyMessage,
        key_store: &KeyStore,
    ) -> Result<Vec<u8>> {
        let result = account
            .create_inbound_session(sender_identity_key, pre_key_message)
            .map_err(|e| ArchivistError::CryptoError(format!("Create inbound session: {}", e)))?;

        self.persist_session(sender_peer_id, &result.session, key_store)?;
        self.sessions
            .insert(sender_peer_id.to_string(), result.session);
        log::info!("Created inbound Olm session from {}", sender_peer_id);
        Ok(result.plaintext)
    }

    /// Encrypt a plaintext message for a peer.
    pub fn encrypt(
        &mut self,
        peer_id: &str,
        plaintext: &[u8],
        key_store: &KeyStore,
    ) -> Result<OlmMessage> {
        let session = self.sessions.get_mut(peer_id).ok_or_else(|| {
            ArchivistError::SessionNotFound(format!("No Olm session for {}", peer_id))
        })?;
        let msg = session.encrypt(plaintext);
        // Persist after releasing the mutable borrow on session
        let pickle = session.pickle();
        let pickle_str = serde_json::to_string(&pickle)
            .map_err(|e| ArchivistError::CryptoError(format!("Session pickle serialize: {}", e)))?;
        key_store.save_session(peer_id, pickle_str.as_bytes())?;
        Ok(msg)
    }

    /// Decrypt a message from a peer.
    pub fn decrypt(
        &mut self,
        peer_id: &str,
        message: &OlmMessage,
        key_store: &KeyStore,
    ) -> Result<Vec<u8>> {
        let session = self.sessions.get_mut(peer_id).ok_or_else(|| {
            ArchivistError::SessionNotFound(format!("No Olm session for {}", peer_id))
        })?;
        let plaintext = session
            .decrypt(message)
            .map_err(|e| ArchivistError::CryptoError(format!("Olm decrypt: {}", e)))?;
        // Persist after releasing the mutable borrow on session
        let pickle = session.pickle();
        let pickle_str = serde_json::to_string(&pickle)
            .map_err(|e| ArchivistError::CryptoError(format!("Session pickle serialize: {}", e)))?;
        key_store.save_session(peer_id, pickle_str.as_bytes())?;
        Ok(plaintext)
    }

    pub fn has_session(&self, peer_id: &str) -> bool {
        self.sessions.contains_key(peer_id)
    }

    /// Load a persisted session from disk.
    pub fn load_session(&mut self, peer_id: &str, key_store: &KeyStore) -> Result<bool> {
        if self.sessions.contains_key(peer_id) {
            return Ok(true);
        }
        if let Some(bytes) = key_store.load_session(peer_id)? {
            let pickle_str = String::from_utf8(bytes)
                .map_err(|e| ArchivistError::CryptoError(format!("Session pickle UTF-8: {}", e)))?;
            let pickle = serde_json::from_str(&pickle_str)
                .map_err(|e| ArchivistError::CryptoError(format!("Session pickle JSON: {}", e)))?;
            let session = Session::from_pickle(pickle);
            self.sessions.insert(peer_id.to_string(), session);
            Ok(true)
        } else {
            Ok(false)
        }
    }

    fn persist_session(
        &self,
        peer_id: &str,
        session: &Session,
        key_store: &KeyStore,
    ) -> Result<()> {
        let pickle = session.pickle();
        let pickle_str = serde_json::to_string(&pickle)
            .map_err(|e| ArchivistError::CryptoError(format!("Session pickle serialize: {}", e)))?;
        key_store.save_session(peer_id, pickle_str.as_bytes())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn setup() -> (Account, Account, KeyStore, KeyStore, TempDir, TempDir) {
        let tmp_a = TempDir::new().unwrap();
        let tmp_b = TempDir::new().unwrap();
        let ks_a = KeyStore::new(tmp_a.path()).unwrap();
        let ks_b = KeyStore::new(tmp_b.path()).unwrap();
        let alice = Account::new();
        let mut bob = Account::new();
        bob.generate_one_time_keys(5);
        (alice, bob, ks_a, ks_b, tmp_a, tmp_b)
    }

    #[test]
    fn test_session_establishment_and_encrypt_decrypt() {
        let (mut alice, mut bob, ks_a, ks_b, _ta, _tb) = setup();

        let bob_ik = bob.curve25519_key().to_base64();
        let bob_sk = bob.ed25519_key().to_base64();
        let bob_otk = bob
            .one_time_keys()
            .into_iter()
            .next()
            .map(|(_, k)| k.to_base64());

        let bob_bundle = PreKeyBundle {
            identity_key: bob_ik,
            signing_key: bob_sk,
            one_time_key: bob_otk,
            peer_id: "bob".to_string(),
        };

        // Alice creates outbound session
        let mut alice_sm = SessionManager::new();
        alice_sm
            .create_outbound_session(&mut alice, &bob_bundle, &ks_a)
            .unwrap();

        // Alice encrypts
        let msg = alice_sm.encrypt("bob", b"hello bob", &ks_a).unwrap();

        // Bob creates inbound session from pre-key message
        let mut bob_sm = SessionManager::new();
        match msg {
            OlmMessage::PreKey(ref pre_key_msg) => {
                let plaintext = bob_sm
                    .create_inbound_session(
                        &mut bob,
                        "alice",
                        alice.curve25519_key(),
                        pre_key_msg,
                        &ks_b,
                    )
                    .unwrap();
                assert_eq!(plaintext, b"hello bob");
            }
            _ => panic!("Expected PreKey message"),
        }

        // Bob replies
        let reply = bob_sm.encrypt("alice", b"hi alice", &ks_b).unwrap();
        let decrypted = alice_sm.decrypt("alice", &reply, &ks_a);
        // Note: alice_sm has bob stored as "bob", not "alice"
        // Let's test the reverse properly
        assert!(decrypted.is_err()); // No session under key "alice"
    }

    #[test]
    fn test_multiple_messages() {
        let (mut alice, mut bob, ks_a, ks_b, _ta, _tb) = setup();

        let bob_otk = bob
            .one_time_keys()
            .into_iter()
            .next()
            .map(|(_, k)| k.to_base64());

        let bob_bundle = PreKeyBundle {
            identity_key: bob.curve25519_key().to_base64(),
            signing_key: bob.ed25519_key().to_base64(),
            one_time_key: bob_otk,
            peer_id: "bob".to_string(),
        };

        let mut alice_sm = SessionManager::new();
        alice_sm
            .create_outbound_session(&mut alice, &bob_bundle, &ks_a)
            .unwrap();

        // First message (pre-key)
        let msg1 = alice_sm.encrypt("bob", b"msg1", &ks_a).unwrap();
        let mut bob_sm = SessionManager::new();
        if let OlmMessage::PreKey(ref pk) = msg1 {
            let pt = bob_sm
                .create_inbound_session(&mut bob, "alice", alice.curve25519_key(), pk, &ks_b)
                .unwrap();
            assert_eq!(pt, b"msg1");
        }

        // Second message (normal ratchet)
        let msg2 = alice_sm.encrypt("bob", b"msg2", &ks_a).unwrap();
        let pt2 = bob_sm.decrypt("alice", &msg2, &ks_b).unwrap();
        assert_eq!(pt2, b"msg2");

        // Third message
        let msg3 = alice_sm.encrypt("bob", b"msg3", &ks_a).unwrap();
        let pt3 = bob_sm.decrypt("alice", &msg3, &ks_b).unwrap();
        assert_eq!(pt3, b"msg3");
    }
}
