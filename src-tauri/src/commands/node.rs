use crate::error::Result;
use crate::services::node::{NodeConfig, NodeStatus};
use crate::state::AppState;
use tauri::{AppHandle, State};

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

    Ok(node.get_status())
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
    Ok(node.get_status())
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
