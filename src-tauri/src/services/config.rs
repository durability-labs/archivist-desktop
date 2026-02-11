use crate::error::{ArchivistError, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    // General settings
    pub theme: Theme,
    pub language: String,
    pub start_minimized: bool,
    pub start_on_boot: bool,

    // Node settings
    pub node: NodeSettings,

    // Sync settings
    pub sync: SyncSettings,

    // Notification settings
    pub notifications: NotificationSettings,

    // Backup server settings (Machine B - receives backups)
    pub backup_server: BackupServerSettings,

    // Manifest server settings (Machine A - exposes manifests)
    #[serde(default)]
    pub manifest_server: ManifestServerSettings,

    // Media download settings (yt-dlp integration)
    #[serde(default)]
    pub media_download: MediaDownloadSettings,

    // Media streaming server settings
    #[serde(default)]
    pub media_streaming: MediaStreamingSettings,

    // V2 Marketplace settings (optional)
    #[cfg(feature = "marketplace")]
    pub blockchain: Option<BlockchainSettings>,

    #[cfg(feature = "marketplace")]
    pub marketplace: Option<MarketplaceSettings>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Theme {
    Light,
    Dark,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeSettings {
    pub data_directory: String,
    pub api_port: u16,
    pub discovery_port: u16, // UDP port for DHT/mDNS discovery
    pub listen_port: u16,    // TCP port for P2P connections
    pub max_storage_gb: u32,
    pub auto_start: bool,
    pub log_level: String, // Log level: TRACE, DEBUG, INFO, NOTICE, WARN, ERROR, FATAL
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncSettings {
    pub auto_sync: bool,
    pub sync_interval_seconds: u32,
    pub bandwidth_limit_mbps: Option<u32>,
    pub exclude_patterns: Vec<String>,

    // NEW: Backup configuration
    pub backup_enabled: bool,
    pub backup_peer_address: Option<String>,
    pub backup_peer_nickname: Option<String>,
    pub backup_manifest_enabled: bool,
    pub backup_auto_notify: bool,
    /// Port for the backup server's HTTP trigger endpoint (default: 8086)
    #[serde(default = "default_trigger_port")]
    pub backup_trigger_port: u16,

    // NEW: Continuous sync settings
    pub manifest_update_threshold: u32,
    pub manifest_retry_interval_secs: u32,
    pub manifest_max_retries: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationSettings {
    pub sound_enabled: bool,
    pub sound_on_startup: bool,
    pub sound_on_peer_connect: bool,
    pub sound_on_download: bool,
    pub sound_volume: f32, // 0.0 to 1.0
    #[serde(default)]
    pub custom_startup_sound: Option<String>,
    #[serde(default)]
    pub custom_peer_connect_sound: Option<String>,
    #[serde(default)]
    pub custom_download_sound: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupServerSettings {
    pub enabled: bool,
    pub poll_interval_secs: u64,
    pub max_concurrent_downloads: u32,
    pub max_retries: u32,
    pub auto_delete_tombstones: bool,
    /// Port for receiving trigger notifications from source peers (default: 8086)
    #[serde(default = "default_trigger_port")]
    pub trigger_port: u16,
    /// Source peers to poll for manifests (list of host:port pairs)
    #[serde(default)]
    pub source_peers: Vec<SourcePeerConfig>,
}

fn default_trigger_port() -> u16 {
    8086
}

/// Configuration for a source peer to poll for manifests
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourcePeerConfig {
    /// Human-friendly name for this peer
    pub nickname: String,
    /// Host/IP address of the peer's manifest server
    pub host: String,
    /// Port of the manifest server (default: 8085)
    pub manifest_port: u16,
    /// Peer ID for P2P connections (optional, for verification)
    pub peer_id: Option<String>,
    /// Multiaddr for P2P connections (for fetching actual data)
    pub multiaddr: Option<String>,
    /// Whether this source is enabled
    pub enabled: bool,
}

/// Settings for the manifest discovery server (Machine A exposes this)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestServerSettings {
    /// Whether the manifest server is enabled
    pub enabled: bool,
    /// Port to listen on (default: 8085)
    pub port: u16,
    /// Whitelisted IP addresses that can query this server
    #[serde(default)]
    pub allowed_ips: Vec<String>,
}

/// Media download settings for yt-dlp integration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaDownloadSettings {
    pub max_concurrent_downloads: u32,
    pub default_video_format: String,
    pub default_audio_format: String,
}

impl Default for MediaDownloadSettings {
    fn default() -> Self {
        Self {
            max_concurrent_downloads: 3,
            default_video_format: "best".to_string(),
            default_audio_format: "mp3".to_string(),
        }
    }
}

/// Media streaming server settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaStreamingSettings {
    pub enabled: bool,
    pub port: u16,
    #[serde(default)]
    pub allowed_ips: Vec<String>,
}

impl Default for MediaStreamingSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            port: 8087,
            allowed_ips: Vec::new(),
        }
    }
}

impl Default for ManifestServerSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            port: 8085,
            allowed_ips: Vec::new(),
        }
    }
}

#[cfg(feature = "marketplace")]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockchainSettings {
    pub network: String,
    pub rpc_url: String,
    pub wallet_address: Option<String>,
}

#[cfg(feature = "marketplace")]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketplaceSettings {
    pub enabled: bool,
    pub auto_renew_storage: bool,
    pub max_price_per_gb: Option<f64>,
}

impl Default for AppConfig {
    fn default() -> Self {
        let data_dir = dirs::data_dir()
            .map(|p| p.join("archivist"))
            .unwrap_or_else(|| std::path::PathBuf::from(".archivist"))
            .to_string_lossy()
            .to_string();

        Self {
            theme: Theme::System,
            language: "en".to_string(),
            start_minimized: false,
            start_on_boot: false,
            node: NodeSettings {
                data_directory: data_dir,
                api_port: 8080,       // Default archivist-node API port
                discovery_port: 8090, // Default UDP port for DHT/mDNS discovery
                listen_port: 8070,    // Default TCP port for P2P connections
                max_storage_gb: 10,
                auto_start: true,
                log_level: "DEBUG".to_string(), // Good balance of verbosity for debugging
            },
            sync: SyncSettings {
                auto_sync: true,
                sync_interval_seconds: 300,
                bandwidth_limit_mbps: None,
                exclude_patterns: vec![
                    "*.tmp".to_string(),
                    "*.temp".to_string(),
                    ".DS_Store".to_string(),
                    "Thumbs.db".to_string(),
                ],
                backup_enabled: false,
                backup_peer_address: None,
                backup_peer_nickname: None,
                backup_manifest_enabled: true,
                backup_auto_notify: false,
                backup_trigger_port: 8086,
                manifest_update_threshold: 1,
                manifest_retry_interval_secs: 300,
                manifest_max_retries: 5,
            },
            notifications: NotificationSettings {
                sound_enabled: true,
                sound_on_startup: true,
                sound_on_peer_connect: true,
                sound_on_download: true,
                sound_volume: 0.5,
                custom_startup_sound: None,
                custom_peer_connect_sound: None,
                custom_download_sound: None,
            },
            backup_server: BackupServerSettings {
                enabled: false,
                poll_interval_secs: 30,
                max_concurrent_downloads: 3,
                max_retries: 3,
                auto_delete_tombstones: true,
                trigger_port: 8086,
                source_peers: Vec::new(),
            },
            manifest_server: ManifestServerSettings::default(),
            media_download: MediaDownloadSettings::default(),
            media_streaming: MediaStreamingSettings::default(),
            #[cfg(feature = "marketplace")]
            blockchain: None,
            #[cfg(feature = "marketplace")]
            marketplace: None,
        }
    }
}

pub struct ConfigService {
    config: AppConfig,
    config_path: std::path::PathBuf,
}

impl ConfigService {
    pub fn new() -> Self {
        let config_path = dirs::config_dir()
            .map(|p| p.join("archivist").join("config.toml"))
            .unwrap_or_else(|| std::path::PathBuf::from("config.toml"));

        let config = Self::load_from_file(&config_path).unwrap_or_default();

        Self {
            config,
            config_path,
        }
    }

    fn load_from_file(path: &std::path::Path) -> Result<AppConfig> {
        if !path.exists() {
            return Ok(AppConfig::default());
        }

        let contents = std::fs::read_to_string(path)
            .map_err(|e| ArchivistError::ConfigError(e.to_string()))?;

        toml::from_str(&contents).map_err(|e| ArchivistError::ConfigError(e.to_string()))
    }

    pub fn get(&self) -> AppConfig {
        self.config.clone()
    }

    pub fn update(&mut self, config: AppConfig) -> Result<()> {
        self.config = config;
        self.save()
    }

    pub fn save(&self) -> Result<()> {
        // Ensure parent directory exists
        if let Some(parent) = self.config_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| ArchivistError::ConfigError(e.to_string()))?;
        }

        let contents = toml::to_string_pretty(&self.config)
            .map_err(|e| ArchivistError::ConfigError(e.to_string()))?;

        std::fs::write(&self.config_path, contents)
            .map_err(|e| ArchivistError::ConfigError(e.to_string()))?;

        log::info!("Configuration saved to {:?}", self.config_path);
        Ok(())
    }

    pub fn reset_to_defaults(&mut self) -> Result<()> {
        self.config = AppConfig::default();
        self.save()
    }
}

impl Default for ConfigService {
    fn default() -> Self {
        Self::new()
    }
}
