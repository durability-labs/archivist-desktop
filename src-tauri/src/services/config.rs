use crate::error::{ArchivistError, Result};
use serde::{Deserialize, Serialize};

/// Archivist network environment (devnet vs testnet)
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ArchivistNetwork {
    #[default]
    Devnet,
    Testnet,
}

impl ArchivistNetwork {
    pub fn rpc_url(&self) -> &'static str {
        match self {
            Self::Devnet => "https://rpc.devnet.archivist.storage",
            Self::Testnet => "https://rpc.testnet.archivist.storage",
        }
    }

    pub fn config_base_url(&self) -> &'static str {
        match self {
            Self::Devnet => "https://config.archivist.storage/devnet",
            Self::Testnet => "https://config.archivist.storage/testnet",
        }
    }

    pub fn default_marketplace_contract(&self) -> &'static str {
        match self {
            Self::Devnet => "0x766e6E608E1FeB762b429155574016D1106b8D04",
            Self::Testnet => "0x9A110Ae7DC8916Fa741e38caAf204c3ace3eAB0c",
        }
    }

    pub fn default_token_contract(&self) -> &'static str {
        match self {
            Self::Devnet => "0xe2566cc08913e2d8ece3517e635335880c1c400a",
            Self::Testnet => "0x3b7412Ee1144b9801341A4F391490eB735DDc005",
        }
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            Self::Devnet => "Devnet",
            Self::Testnet => "Testnet",
        }
    }

    pub fn from_str_loose(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "devnet" => Some(Self::Devnet),
            "testnet" => Some(Self::Testnet),
            _ => None,
        }
    }
}

/// Fetch the token contract address from a marketplace contract via its `token()` view function.
/// Returns `None` on any failure (network error, bad response, etc.).
pub async fn fetch_token_from_marketplace(rpc_url: &str, marketplace: &str) -> Option<String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .ok()?;
    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "eth_call",
        "params": [{"to": marketplace, "data": "0xfc0c546a"}, "latest"],
        "id": 1
    });
    let resp = client.post(rpc_url).json(&body).send().await.ok()?;
    let json: serde_json::Value = resp.json().await.ok()?;
    let result = json["result"].as_str()?;
    // Result is 32-byte ABI-encoded address: 0x + 24 zero-padding + 40 hex address
    if result.len() >= 66 {
        let addr = format!("0x{}", &result[26..]);
        if addr.len() == 42 {
            Some(addr)
        } else {
            None
        }
    } else {
        None
    }
}

/// Fetch the marketplace contract address from the remote config endpoint.
/// Returns `None` on any failure (network error, bad format, etc.).
pub async fn fetch_remote_marketplace_contract(network: ArchivistNetwork) -> Option<String> {
    let url = format!("{}/marketplace", network.config_base_url());
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .ok()?;
    let resp = client.get(&url).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let text = resp.text().await.ok()?.trim().to_string();
    // Validate: must start with 0x and be 42 chars (20 bytes hex address)
    if text.starts_with("0x")
        && text.len() == 42
        && text[2..].chars().all(|c| c.is_ascii_hexdigit())
    {
        Some(text)
    } else {
        None
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    // General settings
    pub theme: Theme,
    pub language: String,
    pub start_minimized: bool,
    pub start_on_boot: bool,
    #[serde(default = "default_true")]
    pub close_to_tray: bool,

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

    // Web archive settings
    #[serde(default)]
    pub web_archive: WebArchiveSettings,

    // Chat settings (P2P encrypted messaging)
    #[serde(default)]
    pub chat: ChatSettings,

    // Marketplace settings
    #[serde(default)]
    pub blockchain: BlockchainSettings,

    #[serde(default)]
    pub marketplace: MarketplaceSettings,

    // Torrent settings (librqbit)
    #[serde(default)]
    pub torrent: TorrentSettings,

    // IRC settings (native Libera.Chat client)
    #[serde(default)]
    pub irc: IrcSettings,
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
    /// Optional external IP address. When set, the node uses --nat=extip:<ip> instead of --nat=upnp.
    #[serde(default)]
    pub announce_ip: Option<String>,
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
    #[serde(default = "default_true")]
    pub sound_on_chat_message: bool,
    pub sound_volume: f32, // 0.0 to 1.0
    #[serde(default)]
    pub custom_startup_sound: Option<String>,
    #[serde(default)]
    pub custom_peer_connect_sound: Option<String>,
    #[serde(default)]
    pub custom_download_sound: Option<String>,
}

fn default_true() -> bool {
    true
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

/// Web archive settings for website crawling/archival
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebArchiveSettings {
    pub max_concurrent_archives: u32,
    pub default_max_depth: u32,
    pub default_max_pages: u32,
    pub include_assets: bool,
    pub request_delay_ms: u64,
    #[serde(default = "default_viewer_port")]
    pub viewer_port: u16,
}

fn default_viewer_port() -> u16 {
    8088
}

impl Default for WebArchiveSettings {
    fn default() -> Self {
        Self {
            max_concurrent_archives: 2,
            default_max_depth: 3,
            default_max_pages: 100,
            include_assets: true,
            request_delay_ms: 200,
            viewer_port: 8088,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockchainSettings {
    /// Which archivist network to use (devnet or testnet)
    #[serde(default)]
    pub active_network: ArchivistNetwork,
    pub network: String,
    pub rpc_url: String,
    pub wallet_address: Option<String>,
    /// Marketplace smart contract address
    #[serde(default = "default_marketplace_contract")]
    pub marketplace_contract: String,
    /// TST token contract address
    #[serde(default = "default_token_contract")]
    pub token_contract: String,
}

fn default_marketplace_contract() -> String {
    ArchivistNetwork::default()
        .default_marketplace_contract()
        .to_string()
}

fn default_token_contract() -> String {
    ArchivistNetwork::default()
        .default_token_contract()
        .to_string()
}

impl Default for BlockchainSettings {
    fn default() -> Self {
        let net = ArchivistNetwork::default();
        Self {
            active_network: net,
            network: "arbitrum-sepolia".to_string(),
            rpc_url: net.rpc_url().to_string(),
            wallet_address: None,
            marketplace_contract: net.default_marketplace_contract().to_string(),
            token_contract: net.default_token_contract().to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketplaceSettings {
    pub enabled: bool,
    pub auto_renew_storage: bool,
    pub max_price_per_gb: Option<f64>,
}

impl Default for MarketplaceSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            auto_renew_storage: false,
            max_price_per_gb: None,
        }
    }
}

/// Torrent client settings (librqbit engine)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TorrentSettings {
    pub enabled: bool,
    pub download_directory: String,
    pub listen_port_start: u16,
    pub listen_port_end: u16,
    pub enable_dht: bool,
    pub enable_upnp: bool,
    pub max_seed_ratio: Option<f64>,
    pub max_seed_time_minutes: Option<u64>,
    pub remove_on_seed_limit: bool,
    pub download_speed_limit: Option<u64>,
    pub upload_speed_limit: Option<u64>,
    pub sequential_by_default: bool,
}

impl Default for TorrentSettings {
    fn default() -> Self {
        let download_dir = dirs::download_dir()
            .map(|p| p.join("Archivist Torrents"))
            .unwrap_or_else(|| std::path::PathBuf::from("Archivist Torrents"))
            .to_string_lossy()
            .to_string();

        Self {
            enabled: true,
            download_directory: download_dir,
            listen_port_start: 6881,
            listen_port_end: 6889,
            enable_dht: true,
            enable_upnp: true,
            max_seed_ratio: None,
            max_seed_time_minutes: None,
            remove_on_seed_limit: false,
            download_speed_limit: None,
            upload_speed_limit: None,
            sequential_by_default: false,
        }
    }
}

/// Chat settings for P2P encrypted messaging
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatSettings {
    pub enabled: bool,
    pub port: u16,
    pub max_message_size: usize,
    pub message_retention_days: u32,
    pub store_history: bool,
    pub notify_on_message: bool,
}

impl Default for ChatSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            port: 8089,
            max_message_size: 65536,
            message_retention_days: 0, // 0 = forever
            store_history: true,
            notify_on_message: true,
        }
    }
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
            close_to_tray: true,
            node: NodeSettings {
                data_directory: data_dir,
                api_port: 8080,       // Default archivist-node API port
                discovery_port: 8090, // Default UDP port for DHT/mDNS discovery
                listen_port: 8070,    // Default TCP port for P2P connections
                max_storage_gb: 10,
                auto_start: true,
                log_level: "DEBUG".to_string(), // Good balance of verbosity for debugging
                announce_ip: None,
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
                sound_on_chat_message: true,
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
            web_archive: WebArchiveSettings::default(),
            chat: ChatSettings::default(),
            blockchain: BlockchainSettings::default(),
            marketplace: MarketplaceSettings::default(),
            torrent: TorrentSettings::default(),
            irc: IrcSettings::default(),
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

        let mut config = Self::load_from_file(&config_path).unwrap_or_default();

        // Migration: if rpc_url points to devnet but marketplace_contract is the testnet address,
        // fix it to devnet's contract and ensure active_network is Devnet
        if config.blockchain.rpc_url.contains("devnet")
            && config.blockchain.marketplace_contract
                == ArchivistNetwork::Testnet.default_marketplace_contract()
        {
            log::info!(
                "Config migration: fixing devnet marketplace contract (was testnet address)"
            );
            config.blockchain.active_network = ArchivistNetwork::Devnet;
            config.blockchain.marketplace_contract = ArchivistNetwork::Devnet
                .default_marketplace_contract()
                .to_string();
        }

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

/// IRC settings for native Libera.Chat client
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IrcSettings {
    pub enabled: bool,
    pub auto_connect: bool,
    pub server: String,
    pub port: u16,
    pub channel: String,
    pub nick_prefix: String,
    pub max_history: usize,
}

impl Default for IrcSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            auto_connect: false,
            server: "irc.libera.chat".to_string(),
            port: 6697,
            channel: "#archivist".to_string(),
            nick_prefix: "Arch".to_string(),
            max_history: 500,
        }
    }
}

impl Default for ConfigService {
    fn default() -> Self {
        Self::new()
    }
}
