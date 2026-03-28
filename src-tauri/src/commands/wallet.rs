use crate::error::{ArchivistError, Result};
use crate::services::config::{
    fetch_network_config, fetch_token_from_marketplace, ArchivistNetwork,
};
use crate::services::node::NodeConfig;
use crate::services::wallet::{WalletBalances, WalletInfo};
use crate::state::AppState;
use serde::Serialize;
use tauri::State;

#[tauri::command]
pub async fn get_wallet_info(state: State<'_, AppState>) -> Result<WalletInfo> {
    let wallet = state.wallet.read().await;
    let mut info = wallet.get_wallet_info().await?;
    drop(wallet);

    // If wallet is unlocked but marketplace isn't active, check if the contract exists on-chain
    if info.has_key && info.is_unlocked && !info.marketplace_active {
        let config = state.config.read().await;
        let app_config = config.get();
        let rpc_url = app_config.blockchain.rpc_url.clone();
        let contract = app_config.blockchain.marketplace_contract.clone();
        drop(config);

        let available = super::node::is_marketplace_contract_available(&rpc_url, &contract).await;
        info.marketplace_unavailable = !available;
    }

    Ok(info)
}

#[tauri::command]
pub async fn generate_wallet(state: State<'_, AppState>, password: String) -> Result<WalletInfo> {
    let mut wallet = state.wallet.write().await;
    wallet.generate_wallet(&password)
}

#[tauri::command]
pub async fn import_wallet(
    state: State<'_, AppState>,
    private_key: String,
    password: String,
) -> Result<WalletInfo> {
    let mut wallet = state.wallet.write().await;
    wallet.import_wallet(&private_key, &password)
}

#[tauri::command]
pub async fn export_wallet(state: State<'_, AppState>, password: String) -> Result<String> {
    let wallet = state.wallet.read().await;
    wallet.export_wallet(&password)
}

#[tauri::command]
pub async fn unlock_wallet(state: State<'_, AppState>, password: String) -> Result<WalletInfo> {
    let mut wallet = state.wallet.write().await;
    wallet.unlock_wallet(&password)
}

#[tauri::command]
pub async fn delete_wallet(state: State<'_, AppState>) -> Result<()> {
    let mut wallet = state.wallet.write().await;
    wallet.delete_wallet()
}

#[tauri::command]
pub async fn get_wallet_balances(state: State<'_, AppState>) -> Result<WalletBalances> {
    let wallet = state.wallet.read().await;
    wallet.get_balances().await
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkSwitchResult {
    pub network: String,
    pub rpc_url: String,
    pub marketplace_contract: String,
    pub token_contract: String,
    pub needs_restart: bool,
}

#[tauri::command]
pub async fn switch_network(
    state: State<'_, AppState>,
    network: String,
) -> Result<NetworkSwitchResult> {
    let net = ArchivistNetwork::from_str_loose(&network).ok_or_else(|| {
        ArchivistError::ConfigError(format!(
            "Unknown network '{}'. Use 'devnet' or 'testnet'.",
            network
        ))
    })?;

    // Fetch full network config from remote (source of truth), fall back to hardcoded
    let remote_config = fetch_network_config(net).await;

    let marketplace_contract = remote_config
        .as_ref()
        .map(|r| r.marketplace_contract.clone())
        .unwrap_or_else(|| net.default_marketplace_contract().to_string());

    let rpc_url = remote_config
        .as_ref()
        .and_then(|r| r.rpc_url.clone())
        .unwrap_or_else(|| net.rpc_url().to_string());

    let token_contract = fetch_token_from_marketplace(&rpc_url, &marketplace_contract)
        .await
        .unwrap_or_else(|| net.default_token_contract().to_string());

    // Update config and save
    {
        let mut config = state.config.write().await;
        let mut app_config = config.get();
        app_config.blockchain.active_network = net;
        app_config.blockchain.rpc_url = rpc_url.clone();
        app_config.blockchain.marketplace_contract = marketplace_contract.clone();
        app_config.blockchain.token_contract = token_contract.clone();
        config.update(app_config)?;
    }

    // Update wallet service in-memory so balance queries use the new RPC immediately
    {
        let mut wallet = state.wallet.write().await;
        wallet.update_network(
            net.display_name().to_string(),
            rpc_url.clone(),
            token_contract.clone(),
        );
    }

    // Update node sidecar name for the new network
    {
        let mut node = state.node.write().await;
        node.set_sidecar_name(NodeConfig::sidecar_name_for_network(net));
    }

    log::info!(
        "Switched to {} (rpc={}, marketplace={}, sidecar={})",
        net.display_name(),
        rpc_url,
        marketplace_contract,
        NodeConfig::sidecar_name_for_network(net)
    );

    Ok(NetworkSwitchResult {
        network: net.display_name().to_string(),
        rpc_url,
        marketplace_contract,
        token_contract,
        needs_restart: true,
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockchainConfig {
    pub active_network: String,
    pub rpc_url: String,
    pub marketplace_contract: String,
    pub token_contract: String,
}

#[tauri::command]
pub async fn get_blockchain_config(state: State<'_, AppState>) -> Result<BlockchainConfig> {
    let config = state.config.read().await;
    let bc = &config.get().blockchain;
    Ok(BlockchainConfig {
        active_network: match bc.active_network {
            ArchivistNetwork::Devnet => "devnet".to_string(),
            ArchivistNetwork::Testnet => "testnet".to_string(),
        },
        rpc_url: bc.rpc_url.clone(),
        marketplace_contract: bc.marketplace_contract.clone(),
        token_contract: bc.token_contract.clone(),
    })
}
