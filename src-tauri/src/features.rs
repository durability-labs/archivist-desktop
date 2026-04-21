use serde::{Deserialize, Serialize};

/// Runtime feature flags that can be queried by the frontend.
///
/// Some flags are always-on (marketplace, torrent), while others are
/// compile-time gated via Cargo features:
///
/// - `zk-proofs`: Enables zero-knowledge proof verification for storage
///   proofs. Compile with `cargo build --features zk-proofs` to enable.
///   Currently a placeholder for future ZK verification of storage proofs.
///
/// - `marketplace`: Marketplace/wallet features via the `ethers`/`alloy`
///   crates. Always enabled in the default build.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Features {
    /// Marketplace features (wallet, contracts, listings)
    pub marketplace: bool,
    /// Zero-knowledge proof verification (compile with --features zk-proofs)
    pub zk_proofs: bool,
    /// Advanced analytics dashboard (reserved for future use)
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
