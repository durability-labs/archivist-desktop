use std::net::IpAddr;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::node_api::NodeApiClient;
use crate::services::node::NodeConfig;
use crate::services::{
    BackupDaemon, BackupService, ConfigService, FileService, ManifestRegistry, ManifestServer,
    ManifestServerConfig, NodeService, PeerService, SyncService,
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
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
