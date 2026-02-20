use serde::{Deserialize, Serialize};

/// Runtime feature flags that can be queried by the frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Features {
    /// Marketplace features (wallet, contracts, listings)
    pub marketplace: bool,
    /// Zero-knowledge proof verification
    pub zk_proofs: bool,
    /// Advanced analytics dashboard
    pub analytics: bool,
    /// BitTorrent client (librqbit)
    pub torrent: bool,
}

impl Default for Features {
    fn default() -> Self {
        Self {
            marketplace: true,
            zk_proofs: cfg!(feature = "zk-proofs"),
            analytics: false,
            torrent: true,
        }
    }
}

impl Features {
    pub fn new() -> Self {
        Self::default()
    }

    /// Check if any V2 features are enabled
    #[allow(dead_code)]
    pub fn has_v2_features(&self) -> bool {
        self.marketplace || self.zk_proofs
    }
}

/// Get current feature flags
#[tauri::command]
pub fn get_features() -> Features {
    Features::new()
}
