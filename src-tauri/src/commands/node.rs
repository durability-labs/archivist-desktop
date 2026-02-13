use crate::error::Result;
use crate::services::node::{NodeConfig, NodeStatus};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::io::BufRead;
use tauri::{AppHandle, State};

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
