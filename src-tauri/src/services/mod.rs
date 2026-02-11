// Service layer - trait-based abstractions for V2 extensibility

pub mod backup;
pub mod backup_daemon;
pub mod binary_manager;
pub mod config;
pub mod files;
pub mod manifest_server;
pub mod media_download;
pub mod media_streaming;
pub mod node;
pub mod peers;
pub mod sync;

pub use backup::BackupService;
pub use backup_daemon::BackupDaemon;
pub use config::ConfigService;
pub use files::FileService;
pub use manifest_server::{ManifestRegistry, ManifestServer, ManifestServerConfig};
pub use media_download::MediaDownloadService;
pub use media_streaming::{MediaStreamingConfig, MediaStreamingServer};
pub use node::NodeService;
pub use peers::PeerService;
pub use sync::SyncService;

// V2 Marketplace services (conditionally compiled)
#[cfg(feature = "marketplace")]
mod marketplace;
#[cfg(feature = "marketplace")]
mod wallet;

#[allow(unused_imports)]
#[cfg(feature = "marketplace")]
pub use marketplace::MarketplaceService;
#[allow(unused_imports)]
#[cfg(feature = "marketplace")]
pub use wallet::WalletService;
