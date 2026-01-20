//! Backup peer notification service
//!
//! This service handles notifying a designated backup peer about new manifest files.
//! It ensures the backup peer is connected and creates storage requests for manifests.

use crate::error::{ArchivistError, Result};
use crate::node_api::NodeApiClient;
use crate::services::peers::PeerService;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Service for managing backup peer notifications
pub struct BackupService {
    api_client: NodeApiClient,
    peer_service: Arc<RwLock<PeerService>>,
}

impl BackupService {
    /// Create a new BackupService
    pub fn new(api_client: NodeApiClient, peer_service: Arc<RwLock<PeerService>>) -> Self {
        Self {
            api_client,
            peer_service,
        }
    }

    /// Notify backup peer of new manifest by creating storage request
    ///
    /// This ensures the backup peer is connected and then creates a storage
    /// request for the manifest CID, which will trigger the backup peer to
    /// download the manifest from the network.
    pub async fn notify_backup_peer(
        &self,
        manifest_cid: &str,
        backup_peer_addr: &str,
    ) -> Result<()> {
        log::info!("Notifying backup peer about manifest CID: {}", manifest_cid);

        // 1. Ensure connected to backup peer
        self.ensure_backup_peer_connected(backup_peer_addr).await?;

        // 2. Create storage request for manifest CID
        // POST /storage/request/{cid}
        // Backup peer will pull manifest from network
        self.api_client.request_storage(manifest_cid).await?;

        log::info!(
            "Successfully notified backup peer about manifest CID: {}",
            manifest_cid
        );
        Ok(())
    }

    /// Connect to backup peer if not already connected
    async fn ensure_backup_peer_connected(&self, peer_addr: &str) -> Result<()> {
        log::info!("Ensuring backup peer is connected: {}", peer_addr);

        let mut peers = self.peer_service.write().await;

        // Try to connect (this is idempotent - if already connected, it succeeds)
        match peers.connect_peer(peer_addr).await {
            Ok(_) => {
                log::info!("Backup peer connected successfully");
                Ok(())
            }
            Err(e) => {
                log::error!("Failed to connect to backup peer: {}", e);
                Err(ArchivistError::PeerConnectionFailed(format!(
                    "Failed to connect to backup peer: {}",
                    e
                )))
            }
        }
    }
}
