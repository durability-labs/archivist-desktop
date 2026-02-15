use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Nonce};
use rand::RngCore;
use std::fs;
use std::path::{Path, PathBuf};
use zeroize::Zeroizing;

use crate::error::{ArchivistError, Result};

/// Manages encrypted key storage on disk.
///
/// Layout:
///   {base}/keys/master.secret           – 32-byte master key (file mode 0600)
///   {base}/keys/identity.pickle.enc     – vodozemac Account pickle
///   {base}/keys/sessions/{peer_id}.enc  – per-peer Olm sessions
///   {base}/keys/group_sessions/...      – Megolm group sessions
///   {base}/cert/chat.key.pem            – TLS private key
///   {base}/cert/chat.cert.pem           – TLS certificate
pub struct KeyStore {
    base_dir: PathBuf,
    master_key: Zeroizing<[u8; 32]>,
}

impl KeyStore {
    /// Initialise the key store, creating the master key if absent.
    pub fn new(base_dir: &Path) -> Result<Self> {
        let keys_dir = base_dir.join("keys");
        fs::create_dir_all(&keys_dir)
            .map_err(|e| ArchivistError::CryptoError(format!("create keys dir: {}", e)))?;
        fs::create_dir_all(keys_dir.join("sessions"))
            .map_err(|e| ArchivistError::CryptoError(format!("create sessions dir: {}", e)))?;
        fs::create_dir_all(keys_dir.join("group_sessions")).map_err(|e| {
            ArchivistError::CryptoError(format!("create group_sessions dir: {}", e))
        })?;
        fs::create_dir_all(base_dir.join("cert"))
            .map_err(|e| ArchivistError::CryptoError(format!("create cert dir: {}", e)))?;

        let secret_path = keys_dir.join("master.secret");
        let master_key = if secret_path.exists() {
            let bytes = fs::read(&secret_path)
                .map_err(|e| ArchivistError::CryptoError(format!("read master key: {}", e)))?;
            if bytes.len() != 32 {
                return Err(ArchivistError::CryptoError(
                    "Corrupt master key file".to_string(),
                ));
            }
            let mut key = [0u8; 32];
            key.copy_from_slice(&bytes);
            Zeroizing::new(key)
        } else {
            let mut key = [0u8; 32];
            OsRng.fill_bytes(&mut key);
            fs::write(&secret_path, key)
                .map_err(|e| ArchivistError::CryptoError(format!("write master key: {}", e)))?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&secret_path, fs::Permissions::from_mode(0o600))
                    .map_err(|e| ArchivistError::CryptoError(format!("chmod master key: {}", e)))?;
            }
            Zeroizing::new(key)
        };

        Ok(Self {
            base_dir: base_dir.to_path_buf(),
            master_key,
        })
    }

    // ── AES-256-GCM helpers ────────────────────────────────────

    #[allow(deprecated)]
    fn encrypt(&self, plaintext: &[u8]) -> Result<Vec<u8>> {
        let cipher = Aes256Gcm::new_from_slice(self.master_key.as_ref())
            .map_err(|e| ArchivistError::CryptoError(format!("AES init: {}", e)))?;
        let mut nonce_bytes = [0u8; 12];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);
        let ciphertext = cipher
            .encrypt(nonce, plaintext)
            .map_err(|e| ArchivistError::CryptoError(format!("AES encrypt: {}", e)))?;

        // nonce || ciphertext
        let mut out = Vec::with_capacity(12 + ciphertext.len());
        out.extend_from_slice(&nonce_bytes);
        out.extend_from_slice(&ciphertext);
        Ok(out)
    }

    #[allow(deprecated)]
    fn decrypt(&self, data: &[u8]) -> Result<Vec<u8>> {
        if data.len() < 12 {
            return Err(ArchivistError::CryptoError("Ciphertext too short".into()));
        }
        let (nonce_bytes, ciphertext) = data.split_at(12);
        let cipher = Aes256Gcm::new_from_slice(self.master_key.as_ref())
            .map_err(|e| ArchivistError::CryptoError(format!("AES init: {}", e)))?;
        let nonce = Nonce::from_slice(nonce_bytes);
        cipher
            .decrypt(nonce, ciphertext)
            .map_err(|e| ArchivistError::CryptoError(format!("AES decrypt: {}", e)))
    }

    fn save_encrypted(&self, path: &Path, plaintext: &[u8]) -> Result<()> {
        let enc = self.encrypt(plaintext)?;
        fs::write(path, enc)
            .map_err(|e| ArchivistError::CryptoError(format!("write encrypted: {}", e)))
    }

    fn load_encrypted(&self, path: &Path) -> Result<Option<Vec<u8>>> {
        if !path.exists() {
            return Ok(None);
        }
        let data = fs::read(path)
            .map_err(|e| ArchivistError::CryptoError(format!("read encrypted: {}", e)))?;
        Ok(Some(self.decrypt(&data)?))
    }

    // ── Identity ───────────────────────────────────────────────

    pub fn save_identity(&self, pickle: &[u8]) -> Result<()> {
        let path = self.base_dir.join("keys/identity.pickle.enc");
        self.save_encrypted(&path, pickle)
    }

    pub fn load_identity(&self) -> Result<Option<Vec<u8>>> {
        let path = self.base_dir.join("keys/identity.pickle.enc");
        self.load_encrypted(&path)
    }

    // ── Olm Sessions ──────────────────────────────────────────

    pub fn save_session(&self, peer_id: &str, pickle: &[u8]) -> Result<()> {
        let path = self
            .base_dir
            .join("keys/sessions")
            .join(format!("{}.enc", peer_id));
        self.save_encrypted(&path, pickle)
    }

    pub fn load_session(&self, peer_id: &str) -> Result<Option<Vec<u8>>> {
        let path = self
            .base_dir
            .join("keys/sessions")
            .join(format!("{}.enc", peer_id));
        self.load_encrypted(&path)
    }

    // ── Megolm Group Sessions ─────────────────────────────────

    pub fn save_outbound_group_session(&self, group_id: &str, pickle: &[u8]) -> Result<()> {
        let path = self
            .base_dir
            .join("keys/group_sessions")
            .join(format!("{}.outbound.enc", group_id));
        self.save_encrypted(&path, pickle)
    }

    pub fn load_outbound_group_session(&self, group_id: &str) -> Result<Option<Vec<u8>>> {
        let path = self
            .base_dir
            .join("keys/group_sessions")
            .join(format!("{}.outbound.enc", group_id));
        self.load_encrypted(&path)
    }

    pub fn save_inbound_group_session(
        &self,
        group_id: &str,
        sender: &str,
        pickle: &[u8],
    ) -> Result<()> {
        let path = self
            .base_dir
            .join("keys/group_sessions")
            .join(format!("{}.{}.inbound.enc", group_id, sender));
        self.save_encrypted(&path, pickle)
    }

    pub fn load_inbound_group_session(
        &self,
        group_id: &str,
        sender: &str,
    ) -> Result<Option<Vec<u8>>> {
        let path = self
            .base_dir
            .join("keys/group_sessions")
            .join(format!("{}.{}.inbound.enc", group_id, sender));
        self.load_encrypted(&path)
    }

    // ── TLS certificates ──────────────────────────────────────

    pub fn cert_dir(&self) -> PathBuf {
        self.base_dir.join("cert")
    }

    pub fn cert_path(&self) -> PathBuf {
        self.base_dir.join("cert/chat.cert.pem")
    }

    pub fn key_path(&self) -> PathBuf {
        self.base_dir.join("cert/chat.key.pem")
    }

    pub fn base_dir(&self) -> &Path {
        &self.base_dir
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let tmp = TempDir::new().unwrap();
        let ks = KeyStore::new(tmp.path()).unwrap();

        let plaintext = b"hello secret world";
        let enc = ks.encrypt(plaintext).unwrap();
        let dec = ks.decrypt(&enc).unwrap();
        assert_eq!(dec, plaintext);
    }

    #[test]
    fn test_identity_save_load() {
        let tmp = TempDir::new().unwrap();
        let ks = KeyStore::new(tmp.path()).unwrap();

        ks.save_identity(b"pickle-data").unwrap();
        let loaded = ks.load_identity().unwrap().unwrap();
        assert_eq!(loaded, b"pickle-data");
    }

    #[test]
    fn test_session_save_load() {
        let tmp = TempDir::new().unwrap();
        let ks = KeyStore::new(tmp.path()).unwrap();

        ks.save_session("peer123", b"session-pickle").unwrap();
        let loaded = ks.load_session("peer123").unwrap().unwrap();
        assert_eq!(loaded, b"session-pickle");

        // Non-existent session returns None
        assert!(ks.load_session("no-such-peer").unwrap().is_none());
    }

    #[test]
    fn test_group_session_save_load() {
        let tmp = TempDir::new().unwrap();
        let ks = KeyStore::new(tmp.path()).unwrap();

        ks.save_outbound_group_session("g1", b"outbound-data")
            .unwrap();
        assert_eq!(
            ks.load_outbound_group_session("g1").unwrap().unwrap(),
            b"outbound-data"
        );

        ks.save_inbound_group_session("g1", "sender-a", b"inbound-data")
            .unwrap();
        assert_eq!(
            ks.load_inbound_group_session("g1", "sender-a")
                .unwrap()
                .unwrap(),
            b"inbound-data"
        );
    }
}
