use crate::error::Result;
use crate::services::config::{fetch_network_config, ConfigService};
use crate::services::node::{NodeConfig, NodeService, NodeStatus};
use crate::services::wallet::WalletService;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::io::BufRead;
use std::sync::Arc;
use tauri::{AppHandle, State};
use tokio::sync::RwLock;

/// Check if the marketplace contract has bytecode deployed at the given RPC endpoint.
/// Returns `false` when the contract address is empty, the RPC is unreachable, or the
/// address has no code (i.e. eth_getCode returns "0x").
pub(crate) async fn is_marketplace_contract_available(
    rpc_url: &str,
    contract_address: &str,
) -> bool {
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };

    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "eth_getCode",
        "params": [contract_address, "latest"],
        "id": 1
    });

    match client.post(rpc_url).json(&body).send().await {
        Ok(response) => match response.json::<serde_json::Value>().await {
            Ok(json) => {
                let code = json["result"].as_str().unwrap_or("0x");
                let available = code != "0x" && code != "0x0" && code.len() > 4;
                if !available {
                    log::warn!(
                        "Marketplace contract {} has no code deployed on RPC {}",
                        contract_address,
                        rpc_url
                    );
                }
                available
            }
            Err(e) => {
                log::warn!("Failed to parse eth_getCode response: {}", e);
                false
            }
        },
        Err(e) => {
            log::warn!(
                "Cannot reach RPC endpoint {} for marketplace contract check: {}",
                rpc_url,
                e
            );
            false
        }
    }
}

/// Apply the active network's remote config to the running NodeConfig so the
/// sidecar starts with the right blockchain endpoints and bootstrap peers.
///
/// Always applies (regardless of wallet state):
///   - Bootstrap peer SPRs (forwarded as `--bootstrap-node=<spr>` flags)
///   - Updated marketplace contract address and RPC URL persisted to AppConfig
///
/// Only applies when the wallet is unlocked AND the marketplace contract is
/// deployed on-chain:
///   - `eth_private_key`, `marketplace_address`, `eth_provider_url` on NodeConfig
///     (which causes `--persistence` + related flags to be passed)
///
/// `fetch_network_config` is cached for 60s so calling this repeatedly (e.g. from
/// `switch_network` followed by `restart_node`) only does one HTTP request.
/// Convenience wrapper for callers that already hold an `&AppState`.
pub(crate) async fn try_apply_network_config(state: &AppState) {
    try_apply_network_config_inner(&state.node, &state.wallet, &state.config).await
}

/// Apply the active network's remote config to the running NodeConfig. Takes
/// individual service handles so it can be invoked from contexts without an
/// `AppState` reference (e.g. the auto-start task in lib.rs).
pub(crate) async fn try_apply_network_config_inner(
    node_svc: &Arc<RwLock<NodeService>>,
    wallet_svc: &Arc<RwLock<WalletService>>,
    config_svc: &Arc<RwLock<ConfigService>>,
) {
    let network = {
        let config = config_svc.read().await;
        config.get().blockchain.active_network
    };

    // Fetch live config from remote (cached for 60s — see fetch_network_config).
    let remote = fetch_network_config(network).await;

    // Persist updated marketplace contract / RPC to AppConfig if remote fetch succeeded.
    if let Some(ref remote) = remote {
        let mut config = config_svc.write().await;
        let mut app_config = config.get();
        let old_contract = app_config.blockchain.marketplace_contract.clone();
        app_config.blockchain.marketplace_contract = remote.marketplace_contract.clone();
        if let Some(ref rpc) = remote.rpc_url {
            app_config.blockchain.rpc_url = rpc.clone();
        }
        if old_contract != remote.marketplace_contract {
            log::info!(
                "Updated marketplace contract from remote config: {} -> {}",
                old_contract,
                remote.marketplace_contract
            );
        }
        let _ = config.update(app_config);
    } else {
        log::warn!("Could not fetch remote network config — using persisted/hardcoded values");
    }

    // Bootstrap peers and sidecar name apply regardless of wallet state — P2P
    // discovery is needed even when the user isn't using marketplace features.
    {
        let sprs = remote.as_ref().map(|r| r.sprs.clone()).unwrap_or_default();
        let mut node = node_svc.write().await;
        node.set_bootstrap_nodes(sprs);
        node.set_sidecar_name(NodeConfig::sidecar_name_for_network(network));
    }

    // Marketplace flags require an unlocked wallet. When the user has created
    // or imported a wallet, the node MUST start with --persistence and the
    // marketplace credentials regardless of whether the contract is currently
    // reachable. Clearing the config here was the root cause of the "Marketplace
    // not active" banner after onboarding — the user created a wallet, the RPC
    // or contract check failed (timeout, DNS, VPN, not-yet-deployed), and the
    // node started without persistence. The user then had to manually restart.
    //
    // The contract check is now advisory only: a log warning if it fails, but
    // the node still starts with persistence. If the contract isn't available,
    // marketplace operations will fail at transaction time with a clear error
    // rather than the confusing "Marketplace not active" state.
    let wallet = wallet_svc.read().await;
    if !wallet.is_unlocked() {
        return;
    }

    let (rpc_url, contract) = {
        let config = config_svc.read().await;
        let app_config = config.get();
        (
            app_config.blockchain.rpc_url.clone(),
            app_config.blockchain.marketplace_contract.clone(),
        )
    };

    if !is_marketplace_contract_available(&rpc_url, &contract).await {
        log::warn!(
            "Marketplace contract {} not reachable on {} — node will start with \
             persistence anyway. Marketplace operations may fail until the contract \
             is available.",
            contract,
            rpc_url
        );
    }

    let mut node = node_svc.write().await;
    node.set_marketplace_config(
        wallet.get_private_key().map(|s| s.to_string()),
        Some(contract),
        Some(rpc_url),
    );
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticInfo {
    pub api_reachable: bool,
    pub api_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub peer_id: Option<String>,
    pub address_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[tauri::command]
pub async fn start_node(app_handle: AppHandle, state: State<'_, AppState>) -> Result<NodeStatus> {
    // Inject marketplace credentials only if the contract is actually deployed
    try_apply_network_config(&state).await;

    let mut node = state.node.write().await;
    node.start(&app_handle).await?;

    // Wait for the node's REST API to be ready (up to 30 seconds)
    // The node takes several seconds to initialize (NAT detection, etc.)
    for _ in 0..30 {
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        if node.health_check().await.unwrap_or(false) {
            break;
        }
    }

    let status = node.get_status();
    drop(node);

    // Update chat service with the real peer ID
    if let Some(ref peer_id) = status.peer_id {
        let mut chat = state.chat.write().await;
        chat.update_peer_id(peer_id);
    }

    Ok(status)
}

#[tauri::command]
pub async fn stop_node(state: State<'_, AppState>) -> Result<NodeStatus> {
    let mut node = state.node.write().await;
    node.stop().await?;
    Ok(node.get_status())
}

#[tauri::command]
pub async fn restart_node(app_handle: AppHandle, state: State<'_, AppState>) -> Result<NodeStatus> {
    // Inject marketplace credentials only if the contract is actually deployed
    try_apply_network_config(&state).await;

    let mut node = state.node.write().await;
    node.restart(&app_handle).await?;

    // Wait for the node's REST API to be ready after restart
    for _ in 0..30 {
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        if node.health_check().await.unwrap_or(false) {
            break;
        }
    }

    let status = node.get_status();
    drop(node);

    // Update chat service with the real peer ID
    if let Some(ref peer_id) = status.peer_id {
        let mut chat = state.chat.write().await;
        chat.update_peer_id(peer_id);
    }

    Ok(status)
}

#[tauri::command]
pub async fn get_node_status(state: State<'_, AppState>) -> Result<NodeStatus> {
    // Try to refresh peer info if node is running
    let mut node = state.node.write().await;
    let _ = node.health_check().await;
    Ok(node.get_status())
}

#[tauri::command]
pub async fn get_node_config(state: State<'_, AppState>) -> Result<NodeConfig> {
    let node = state.node.read().await;
    Ok(node.get_config())
}

#[tauri::command]
pub async fn set_node_config(state: State<'_, AppState>, config: NodeConfig) -> Result<()> {
    let mut node = state.node.write().await;
    node.set_config(config);
    Ok(())
}

#[tauri::command]
pub async fn health_check_node(state: State<'_, AppState>) -> Result<bool> {
    let mut node = state.node.write().await;
    node.health_check().await
}

#[tauri::command]
pub async fn run_node_diagnostics(state: State<'_, AppState>) -> Result<DiagnosticInfo> {
    use crate::node_api::NodeApiClient;

    let node = state.node.read().await;
    let config = node.get_config();
    let api_url = format!("http://127.0.0.1:{}", config.api_port);

    // Create an API client for diagnostics
    let client = NodeApiClient::new(config.api_port);

    // Try to get node info
    match client.get_info().await {
        Ok(info) => {
            let peer_id = Some(info.id.clone());
            let address_count = info.addrs.len();
            let node_version = info.archivist.as_ref().map(|a| a.version.clone());

            Ok(DiagnosticInfo {
                api_reachable: true,
                api_url,
                node_version,
                peer_id,
                address_count,
                error: None,
            })
        }
        Err(e) => Ok(DiagnosticInfo {
            api_reachable: false,
            api_url,
            node_version: None,
            peer_id: None,
            address_count: 0,
            error: Some(format!("Failed to connect to node API: {}", e)),
        }),
    }
}

#[tauri::command]
pub async fn get_node_logs(
    state: State<'_, AppState>,
    lines: Option<usize>,
) -> Result<Vec<String>> {
    let node = state.node.read().await;
    let config = node.get_config();

    // Construct log file path (inside data_dir)
    let log_file = std::path::Path::new(&config.data_dir).join("node.log");

    if !log_file.exists() {
        return Ok(vec![
            "Log file not found. Start the node to generate logs.".to_string()
        ]);
    }

    // Read the log file
    // On Windows, we need to explicitly allow sharing to read files being written by the node
    #[cfg(target_os = "windows")]
    let file = {
        use std::fs::OpenOptions;
        use std::os::windows::fs::OpenOptionsExt;
        OpenOptions::new()
            .read(true)
            .share_mode(0x00000001 | 0x00000002) // FILE_SHARE_READ | FILE_SHARE_WRITE
            .open(&log_file)?
    };

    #[cfg(not(target_os = "windows"))]
    let file = std::fs::File::open(&log_file)?;

    let reader = std::io::BufReader::new(file);
    let all_lines: Vec<String> = reader.lines().map_while(|line| line.ok()).collect();

    // Return last N lines (default: 500)
    let num_lines = lines.unwrap_or(500);
    let start_index = all_lines.len().saturating_sub(num_lines);

    Ok(all_lines[start_index..].to_vec())
}

#[tauri::command]
pub async fn get_node_log_path(state: State<'_, AppState>) -> Result<String> {
    let node = state.node.read().await;
    let config = node.get_config();

    let log_file = std::path::Path::new(&config.data_dir).join("node.log");

    Ok(log_file.to_string_lossy().to_string())
}
