use crate::error::Result;
use crate::services::config::fetch_network_config;
use crate::services::node::{NodeConfig, NodeStatus};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::io::BufRead;
use tauri::{AppHandle, State};

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

/// If the wallet is unlocked and the marketplace contract is available on-chain,
/// inject the marketplace credentials into the node config so the sidecar starts
/// with `persistence` flags.  Otherwise the node starts without marketplace.
///
/// Also fetches the latest network config from the remote endpoint to ensure
/// contract addresses and RPC URLs are up-to-date (not stale hardcoded values).
async fn try_inject_marketplace_config(state: &AppState) {
    let wallet = state.wallet.read().await;
    if !wallet.is_unlocked() {
        return;
    }

    // Fetch the active network before doing remote lookup
    let network = {
        let config = state.config.read().await;
        config.get().blockchain.active_network
    };

    // Fetch live config from remote — updates contract address and RPC if changed
    if let Some(remote) = fetch_network_config(network).await {
        let mut config = state.config.write().await;
        let mut app_config = config.get();
        let old_contract = app_config.blockchain.marketplace_contract.clone();
        app_config.blockchain.marketplace_contract = remote.marketplace_contract.clone();
        if let Some(rpc) = remote.rpc_url {
            app_config.blockchain.rpc_url = rpc;
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

    // Also set the correct sidecar name for this network
    {
        let mut node = state.node.write().await;
        node.set_sidecar_name(NodeConfig::sidecar_name_for_network(network));
    }

    let config = state.config.read().await;
    let app_config = config.get();
    let rpc_url = app_config.blockchain.rpc_url.clone();
    let contract = app_config.blockchain.marketplace_contract.clone();
    drop(config);

    if !is_marketplace_contract_available(&rpc_url, &contract).await {
        log::warn!(
            "Skipping marketplace flags — contract {} not available on {}. \
             Node will start without marketplace features.",
            contract,
            rpc_url
        );
        // Clear any previously-set marketplace config so the node starts clean
        let mut node = state.node.write().await;
        node.set_marketplace_config(None, None, None);
        return;
    }

    let config = state.config.read().await;
    let app_config = config.get();
    let mut node = state.node.write().await;
    node.set_marketplace_config(
        wallet.get_private_key().map(|s| s.to_string()),
        Some(app_config.blockchain.marketplace_contract.clone()),
        Some(app_config.blockchain.rpc_url.clone()),
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
    try_inject_marketplace_config(&state).await;

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
    try_inject_marketplace_config(&state).await;

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
