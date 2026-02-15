use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::error::{ArchivistError, Result};

/// Trust level for a peer's TLS certificate.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TrustLevel {
    /// Accepted on first use (default)
    FirstUse,
    /// Manually verified by user (e.g., via safety numbers)
    Verified,
    /// Certificate fingerprint changed — potential MITM
    Changed,
}

/// TOFU entry for a peer.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TofuEntry {
    pub cert_fingerprint: String,
    pub first_seen: DateTime<Utc>,
    pub last_seen: DateTime<Utc>,
    pub trust_level: TrustLevel,
    /// Previous fingerprint if changed
    pub previous_fingerprint: Option<String>,
}

/// Trust-on-first-use certificate store.
pub struct TofuStore {
    entries: HashMap<String, TofuEntry>,
    path: PathBuf,
}

impl TofuStore {
    /// Load from disk or create empty.
    pub fn new(base_dir: &Path) -> Result<Self> {
        let path = base_dir.join("tofu.json");
        let entries = if path.exists() {
            let data = std::fs::read_to_string(&path)
                .map_err(|e| ArchivistError::ChatError(format!("Read TOFU store: {}", e)))?;
            serde_json::from_str(&data)
                .map_err(|e| ArchivistError::ChatError(format!("Parse TOFU store: {}", e)))?
        } else {
            HashMap::new()
        };
        Ok(Self { entries, path })
    }

    /// Check or store a peer's certificate fingerprint.
    ///
    /// Returns `Ok(true)` if trusted, `Ok(false)` if fingerprint changed (need user confirmation).
    pub fn check_or_store(&mut self, peer_id: &str, fingerprint: &str) -> Result<bool> {
        let now = Utc::now();
        if let Some(entry) = self.entries.get_mut(peer_id) {
            if entry.cert_fingerprint == fingerprint {
                entry.last_seen = now;
                self.persist()?;
                return Ok(true);
            }
            // Fingerprint changed!
            log::warn!(
                "TOFU: Peer {} certificate fingerprint CHANGED from {} to {}",
                peer_id,
                entry.cert_fingerprint,
                fingerprint
            );
            entry.previous_fingerprint = Some(entry.cert_fingerprint.clone());
            entry.cert_fingerprint = fingerprint.to_string();
            entry.trust_level = TrustLevel::Changed;
            entry.last_seen = now;
            self.persist()?;
            Ok(false)
        } else {
            // First use — auto-trust
            self.entries.insert(
                peer_id.to_string(),
                TofuEntry {
                    cert_fingerprint: fingerprint.to_string(),
                    first_seen: now,
                    last_seen: now,
                    trust_level: TrustLevel::FirstUse,
                    previous_fingerprint: None,
                },
            );
            self.persist()?;
            log::info!(
                "TOFU: Stored first-use fingerprint for peer {}: {}",
                peer_id,
                fingerprint
            );
            Ok(true)
        }
    }

    /// Mark a peer as verified.
    pub fn verify_peer(&mut self, peer_id: &str) -> Result<()> {
        if let Some(entry) = self.entries.get_mut(peer_id) {
            entry.trust_level = TrustLevel::Verified;
            self.persist()?;
            log::info!("TOFU: Peer {} marked as verified", peer_id);
        }
        Ok(())
    }

    /// Accept a changed fingerprint (user confirmed).
    #[allow(dead_code)]
    pub fn accept_changed(&mut self, peer_id: &str) -> Result<()> {
        if let Some(entry) = self.entries.get_mut(peer_id) {
            if entry.trust_level == TrustLevel::Changed {
                entry.trust_level = TrustLevel::FirstUse;
                entry.previous_fingerprint = None;
                self.persist()?;
                log::info!("TOFU: Accepted changed fingerprint for peer {}", peer_id);
            }
        }
        Ok(())
    }

    pub fn get_entry(&self, peer_id: &str) -> Option<&TofuEntry> {
        self.entries.get(peer_id)
    }

    pub fn get_fingerprint(&self, peer_id: &str) -> Option<&str> {
        self.entries
            .get(peer_id)
            .map(|e| e.cert_fingerprint.as_str())
    }

    fn persist(&self) -> Result<()> {
        let data = serde_json::to_string_pretty(&self.entries)
            .map_err(|e| ArchivistError::ChatError(format!("Serialize TOFU store: {}", e)))?;
        std::fs::write(&self.path, data)
            .map_err(|e| ArchivistError::ChatError(format!("Write TOFU store: {}", e)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_first_use_trust() {
        let tmp = TempDir::new().unwrap();
        let mut store = TofuStore::new(tmp.path()).unwrap();

        let trusted = store.check_or_store("peer-a", "AA:BB:CC").unwrap();
        assert!(trusted);
        assert_eq!(
            store.get_entry("peer-a").unwrap().trust_level,
            TrustLevel::FirstUse
        );
    }

    #[test]
    fn test_same_fingerprint_accepted() {
        let tmp = TempDir::new().unwrap();
        let mut store = TofuStore::new(tmp.path()).unwrap();

        store.check_or_store("peer-a", "AA:BB:CC").unwrap();
        let trusted = store.check_or_store("peer-a", "AA:BB:CC").unwrap();
        assert!(trusted);
    }

    #[test]
    fn test_changed_fingerprint_detected() {
        let tmp = TempDir::new().unwrap();
        let mut store = TofuStore::new(tmp.path()).unwrap();

        store.check_or_store("peer-a", "AA:BB:CC").unwrap();
        let trusted = store.check_or_store("peer-a", "DD:EE:FF").unwrap();
        assert!(!trusted);
        assert_eq!(
            store.get_entry("peer-a").unwrap().trust_level,
            TrustLevel::Changed
        );
    }

    #[test]
    fn test_verify_peer() {
        let tmp = TempDir::new().unwrap();
        let mut store = TofuStore::new(tmp.path()).unwrap();

        store.check_or_store("peer-a", "AA:BB:CC").unwrap();
        store.verify_peer("peer-a").unwrap();
        assert_eq!(
            store.get_entry("peer-a").unwrap().trust_level,
            TrustLevel::Verified
        );
    }

    #[test]
    fn test_persistence() {
        let tmp = TempDir::new().unwrap();
        {
            let mut store = TofuStore::new(tmp.path()).unwrap();
            store.check_or_store("peer-a", "AA:BB:CC").unwrap();
        }
        // Reload
        let store = TofuStore::new(tmp.path()).unwrap();
        assert!(store.get_entry("peer-a").is_some());
    }
}
