use serde::{Deserialize, Serialize};
use vodozemac::olm::Account;
use vodozemac::{Curve25519PublicKey, Ed25519PublicKey};

use super::key_store::KeyStore;
use crate::error::{ArchivistError, Result};

/// Pre-key bundle shared with peers during session establishment
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreKeyBundle {
    /// Curve25519 identity key (for key agreement)
    pub identity_key: String,
    /// Ed25519 signing key (for signatures)
    pub signing_key: String,
    /// One-time pre-key (consumed on use)
    pub one_time_key: Option<String>,
    /// This peer's ID
    pub peer_id: String,
}

/// Manages the local vodozemac identity (Account).
pub struct IdentityManager {
    account: Account,
    peer_id: String,
}

impl IdentityManager {
    /// Create a new identity or load from encrypted storage.
    pub fn load_or_create(key_store: &KeyStore, peer_id: &str) -> Result<Self> {
        if let Some(pickle_bytes) = key_store.load_identity()? {
            let pickle_str = String::from_utf8(pickle_bytes)
                .map_err(|e| ArchivistError::CryptoError(format!("Invalid pickle UTF-8: {}", e)))?;
            let pickle = serde_json::from_str(&pickle_str)
                .map_err(|e| ArchivistError::CryptoError(format!("Invalid pickle JSON: {}", e)))?;
            let account = Account::from_pickle(pickle);
            log::info!("Loaded existing chat identity for peer {}", peer_id);
            Ok(Self {
                account,
                peer_id: peer_id.to_string(),
            })
        } else {
            let account = Account::new();
            let mgr = Self {
                account,
                peer_id: peer_id.to_string(),
            };
            mgr.persist(key_store)?;
            log::info!("Created new chat identity for peer {}", peer_id);
            Ok(mgr)
        }
    }

    /// Persist the account to encrypted storage.
    pub fn persist(&self, key_store: &KeyStore) -> Result<()> {
        let pickle = self.account.pickle();
        let pickle_str = serde_json::to_string(&pickle)
            .map_err(|e| ArchivistError::CryptoError(format!("Pickle serialize: {}", e)))?;
        key_store.save_identity(pickle_str.as_bytes())?;
        Ok(())
    }

    /// Generate one-time pre-keys if we're running low.
    pub fn generate_one_time_keys_if_needed(&mut self, key_store: &KeyStore) -> Result<()> {
        let count = self.account.one_time_keys().len();
        if count < 5 {
            self.account.generate_one_time_keys(10 - count);
            self.persist(key_store)?;
            log::info!("Generated {} new one-time pre-keys", 10 - count);
        }
        Ok(())
    }

    /// Export a pre-key bundle for sharing with a peer.
    pub fn export_pre_key_bundle(&self) -> PreKeyBundle {
        let identity_key = self.account.curve25519_key();
        let signing_key = self.account.ed25519_key();
        let otk = self
            .account
            .one_time_keys()
            .into_iter()
            .next()
            .map(|(_, key)| key.to_base64());

        PreKeyBundle {
            identity_key: identity_key.to_base64(),
            signing_key: signing_key.to_base64(),
            one_time_key: otk,
            peer_id: self.peer_id.clone(),
        }
    }

    /// Mark a one-time key as published (consumed).
    pub fn mark_keys_as_published(&mut self) {
        self.account.mark_keys_as_published();
    }

    pub fn curve25519_key(&self) -> Curve25519PublicKey {
        self.account.curve25519_key()
    }

    pub fn ed25519_key(&self) -> Ed25519PublicKey {
        self.account.ed25519_key()
    }

    /// Access the underlying account (for session creation).
    pub fn account_mut(&mut self) -> &mut Account {
        &mut self.account
    }

    pub fn peer_id(&self) -> &str {
        &self.peer_id
    }

    pub fn set_peer_id(&mut self, peer_id: &str) {
        self.peer_id = peer_id.to_string();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn make_key_store() -> (KeyStore, TempDir) {
        let tmp = TempDir::new().unwrap();
        let ks = KeyStore::new(tmp.path()).unwrap();
        (ks, tmp)
    }

    #[test]
    fn test_create_identity() {
        let (ks, _tmp) = make_key_store();
        let mgr = IdentityManager::load_or_create(&ks, "peer-abc").unwrap();
        let bundle = mgr.export_pre_key_bundle();
        assert_eq!(bundle.peer_id, "peer-abc");
        assert!(!bundle.identity_key.is_empty());
        assert!(!bundle.signing_key.is_empty());
    }

    #[test]
    fn test_persist_roundtrip() {
        let (ks, _tmp) = make_key_store();
        let mgr = IdentityManager::load_or_create(&ks, "peer-xyz").unwrap();
        let ik = mgr.curve25519_key().to_base64();

        // Reload should return the same identity key
        let mgr2 = IdentityManager::load_or_create(&ks, "peer-xyz").unwrap();
        assert_eq!(mgr2.curve25519_key().to_base64(), ik);
    }

    #[test]
    fn test_one_time_key_generation() {
        let (ks, _tmp) = make_key_store();
        let mut mgr = IdentityManager::load_or_create(&ks, "peer-otk").unwrap();
        mgr.generate_one_time_keys_if_needed(&ks).unwrap();
        let bundle = mgr.export_pre_key_bundle();
        assert!(bundle.one_time_key.is_some());
    }
}
