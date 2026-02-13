use std::net::IpAddr;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::crypto::key_store::KeyStore;
use crate::node_api::NodeApiClient;
use crate::services::node::NodeConfig;
use crate::services::{
    ArchiveViewerServer, BackupDaemon, BackupService, ChatServer, ChatService, ConfigService,
    FileService, ManifestRegistry, ManifestServer, ManifestServerConfig, MediaDownloadService,
    MediaStreamingConfig, MediaStreamingServer, NodeService, PeerService, SyncService,
    WebArchiveService,
};

/// Global application state managed by Tauri
pub struct AppState {
    pub node: Arc<RwLock<NodeService>>,
    pub files: Arc<RwLock<FileService>>,
    pub sync: Arc<RwLock<SyncService>>,
    pub peers: Arc<RwLock<PeerService>>,
    pub config: Arc<RwLock<ConfigService>>,
    pub backup: Arc<RwLock<BackupService>>,
    pub backup_daemon: Arc<BackupDaemon>,
    pub manifest_registry: Arc<RwLock<ManifestRegistry>>,
    pub manifest_server: Arc<RwLock<ManifestServer>>,
    pub media: Arc<RwLock<MediaDownloadService>>,
    pub media_streaming: Arc<RwLock<MediaStreamingServer>>,
    pub web_archive: Arc<RwLock<WebArchiveService>>,
    pub archive_viewer: Arc<RwLock<ArchiveViewerServer>>,
    pub chat: Arc<RwLock<ChatService>>,
    pub chat_server: Arc<RwLock<ChatServer>>,
}

impl AppState {
    pub fn new() -> Self {
        // Load persisted configuration
        let config_service = ConfigService::new();
        let app_config = config_service.get();

        // Create NodeConfig from persisted settings
        let node_config = NodeConfig::from_node_settings(&app_config.node);

        log::info!(
            "Initializing NodeService with config: api_port={}, discovery_port={}, listen_port={}, data_dir={}",
            node_config.api_port,
            node_config.discovery_port,
            node_config.listen_port,
            node_config.data_dir
        );

        // Create shared peer service for backup
        let peers = Arc::new(RwLock::new(PeerService::new()));

        // Create API client for backup service
        let api_client = NodeApiClient::new(node_config.api_port);

        // Create backup service with API client and peer service
        let backup_service = BackupService::new(api_client.clone(), peers.clone());

        // Create backup daemon with API client and config
        let backup_daemon = Arc::new(BackupDaemon::new(
            api_client,
            app_config.backup_server.enabled,
            app_config.backup_server.poll_interval_secs,
            app_config.backup_server.max_concurrent_downloads,
            app_config.backup_server.max_retries,
            app_config.backup_server.auto_delete_tombstones,
            app_config.backup_server.trigger_port,
        ));

        // Source peers will be configured when backup daemon starts (in lib.rs setup)

        // Create manifest registry (shared between sync service and manifest server)
        let manifest_registry = Arc::new(RwLock::new(ManifestRegistry::new()));

        // Create sync service with manifest registry for auto-registration
        let sync_service = SyncService::with_manifest_registry(manifest_registry.clone());

        // Create manifest server with config from settings
        let mut allowed_ips = std::collections::HashSet::new();
        for ip_str in &app_config.manifest_server.allowed_ips {
            if let Ok(ip) = ip_str.parse::<IpAddr>() {
                allowed_ips.insert(ip);
            } else {
                log::warn!(
                    "Invalid IP address in manifest_server.allowed_ips: {}",
                    ip_str
                );
            }
        }

        let manifest_server_config = ManifestServerConfig {
            port: app_config.manifest_server.port,
            enabled: app_config.manifest_server.enabled,
            allowed_ips,
        };

        let manifest_server =
            ManifestServer::with_config(manifest_registry.clone(), manifest_server_config);
        let manifest_server = Arc::new(RwLock::new(manifest_server));

        // Create media download service
        let media_service =
            MediaDownloadService::new(app_config.media_download.max_concurrent_downloads);
        let media = Arc::new(RwLock::new(media_service));

        // Create media streaming server (shares media download service for library)
        let streaming_config = MediaStreamingConfig {
            port: app_config.media_streaming.port,
        };
        let media_streaming = Arc::new(RwLock::new(MediaStreamingServer::new(
            streaming_config,
            media.clone(),
        )));

        // Create web archive service
        let web_archive = Arc::new(RwLock::new(WebArchiveService::new(
            app_config.web_archive.max_concurrent_archives,
            app_config.node.api_port,
        )));

        // Create archive viewer server
        let archive_viewer = Arc::new(RwLock::new(ArchiveViewerServer::new(
            app_config.web_archive.viewer_port,
            app_config.node.api_port,
        )));

        // Create chat service (crypto + messaging)
        let chat_base_dir = dirs::data_dir()
            .map(|p| p.join("archivist").join("chat"))
            .unwrap_or_else(|| std::path::PathBuf::from(".archivist/chat"));

        let chat_port = app_config.chat.port;
        let key_store =
            Arc::new(KeyStore::new(&chat_base_dir).expect("Failed to initialize chat key store"));

        // Load or create TLS identity
        let tls_identity = crate::services::chat_tls::load_or_create_tls_identity(
            &key_store.cert_path(),
            &key_store.key_path(),
            "pending-peer-id", // Will be updated when node starts
        )
        .expect("Failed to initialize chat TLS identity");

        let chat_service = ChatService::new(
            key_store.clone(),
            "pending-peer-id".to_string(),
            tls_identity.fingerprint.clone(),
            &app_config.chat,
        )
        .expect("Failed to initialize chat service");

        let chat = Arc::new(RwLock::new(chat_service));

        let chat_server = Arc::new(RwLock::new(ChatServer::new(
            chat_port,
            key_store.cert_path().to_string_lossy().to_string(),
            key_store.key_path().to_string_lossy().to_string(),
        )));

        Self {
            node: Arc::new(RwLock::new(NodeService::with_config(node_config))),
            files: Arc::new(RwLock::new(FileService::new())),
            sync: Arc::new(RwLock::new(sync_service)),
            peers,
            config: Arc::new(RwLock::new(config_service)),
            backup: Arc::new(RwLock::new(backup_service)),
            backup_daemon,
            manifest_registry,
            manifest_server,
            media,
            media_streaming,
            web_archive,
            archive_viewer,
            chat,
            chat_server,
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
