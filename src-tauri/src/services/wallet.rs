use crate::error::Result;
use crate::node_api::NodeApiClient;
use serde::{Deserialize, Serialize};

/// Wallet information derived from the node's identity
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalletInfo {
    pub address: String,
    pub network: String,
}

/// Wallet service — retrieves wallet info from the node sidecar
pub struct WalletService {
    api_client: NodeApiClient,
    network: String,
}

impl WalletService {
    pub fn new(api_client: NodeApiClient, network: String) -> Self {
        Self {
            api_client,
            network,
        }
    }

    /// Get wallet info from the node's /debug/info endpoint
    pub async fn get_wallet_info(&self) -> Result<WalletInfo> {
        let info = self.api_client.get_info().await?;
        let address = info
            .eth_address
            .unwrap_or_else(|| "0x0000000000000000000000000000000000000000".to_string());

        Ok(WalletInfo {
            address,
            network: self.network.clone(),
        })
    }
}
