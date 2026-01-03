use crate::error::{ArchivistError, Result};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::{broadcast, RwLock};

/// Node running status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NodeState {
    #[default]
    Stopped,
    Starting,
    Running,
    Stopping,
    Error,
}

/// Detailed node status for the frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeStatus {
    pub state: NodeState,
    pub pid: Option<u32>,
    pub version: Option<String>,
    pub uptime_seconds: Option<u64>,
    pub peer_count: u32,
    pub storage_used_bytes: u64,
    pub storage_available_bytes: u64,
    pub last_error: Option<String>,
    pub restart_count: u32,
    pub api_url: Option<String>,
    pub peer_id: Option<String>,
    pub spr: Option<String>,
    pub addresses: Vec<String>,
}

impl Default for NodeStatus {
    fn default() -> Self {
        Self {
            state: NodeState::Stopped,
            pid: None,
            version: None,
            uptime_seconds: None,
            peer_count: 0,
            storage_used_bytes: 0,
            storage_available_bytes: 100 * 1024 * 1024 * 1024, // 100 GB placeholder
            last_error: None,
            restart_count: 0,
            api_url: None,
            peer_id: None,
            spr: None,
            addresses: Vec::new(),
        }
    }
}

/// Node configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeConfig {
    pub data_dir: String,
    pub api_port: u16,
    pub p2p_port: u16,
    pub max_storage_bytes: u64,
    pub auto_start: bool,
    pub auto_restart: bool,
    pub max_restart_attempts: u32,
    pub health_check_interval_secs: u64,
}

impl Default for NodeConfig {
    fn default() -> Self {
        let data_dir = dirs::data_dir()
            .map(|p| p.join("archivist").join("node"))
            .unwrap_or_else(|| std::path::PathBuf::from(".archivist/node"))
            .to_string_lossy()
            .to_string();

        Self {
            data_dir,
            api_port: 8080, // Default archivist-node API port
            p2p_port: 8090, // Default archivist-node discovery port
            max_storage_bytes: 10 * 1024 * 1024 * 1024, // 10 GB default
            auto_start: false,
            auto_restart: true,
            max_restart_attempts: 3,
            health_check_interval_secs: 30,
        }
    }
}

/// Events emitted by the node manager (for future use with Tauri events)
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
#[allow(dead_code)]
pub enum NodeEvent {
    StateChanged { state: NodeState },
    StatusUpdate { status: NodeStatus },
    Log { level: String, message: String },
    Error { message: String },
}

/// Response from the node's debug/info API endpoint
#[derive(Debug, Clone, Deserialize)]
pub struct NodeInfoResponse {
    pub id: String,
    pub addrs: Vec<String>,
    pub spr: String,
    #[serde(rename = "announceAddresses")]
    pub announce_addresses: Option<Vec<String>>,
}

/// Internal state for managing the node process
#[allow(dead_code)]
struct NodeProcessState {
    child: Option<CommandChild>,
    start_time: Option<Instant>,
    restart_count: u32,
}

/// Node service that manages the archivist-node sidecar
pub struct NodeService {
    status: NodeStatus,
    config: NodeConfig,
    process_state: Option<NodeProcessState>,
    shutdown_tx: Option<broadcast::Sender<()>>,
}

impl NodeService {
    pub fn new() -> Self {
        Self {
            status: NodeStatus::default(),
            config: NodeConfig::default(),
            process_state: None,
            shutdown_tx: None,
        }
    }

    /// Start the archivist-node sidecar
    pub async fn start(&mut self, app_handle: &AppHandle) -> Result<()> {
        if self.status.state == NodeState::Running || self.status.state == NodeState::Starting {
            return Err(ArchivistError::NodeAlreadyRunning);
        }

        self.status.state = NodeState::Starting;
        self.status.last_error = None;
        log::info!("Starting Archivist node...");

        // Ensure data directory exists
        let data_dir = std::path::Path::new(&self.config.data_dir);
        if !data_dir.exists() {
            std::fs::create_dir_all(data_dir).map_err(|e| {
                ArchivistError::NodeStartFailed(format!("Failed to create data dir: {}", e))
            })?;
        }

        // Build sidecar command with arguments
        // Note: archivist-node uses --key=value format (not --key value)
        let sidecar_command = app_handle
            .shell()
            .sidecar("archivist")
            .map_err(|e| ArchivistError::NodeStartFailed(format!("Sidecar not found: {}", e)))?
            .args([
                &format!("--data-dir={}", self.config.data_dir),
                &format!("--api-port={}", self.config.api_port),
                &format!("--disc-port={}", self.config.p2p_port),
            ]);

        // Spawn the sidecar process
        let (mut rx, child) = sidecar_command.spawn().map_err(|e| {
            ArchivistError::NodeStartFailed(format!("Failed to spawn sidecar: {}", e))
        })?;

        let pid = child.pid();
        log::info!("Archivist node started with PID: {}", pid);

        // Update status
        self.status.state = NodeState::Running;
        self.status.pid = Some(pid);
        self.status.api_url = Some(format!("http://127.0.0.1:{}", self.config.api_port));

        // Store process state
        self.process_state = Some(NodeProcessState {
            child: Some(child),
            start_time: Some(Instant::now()),
            restart_count: self.status.restart_count,
        });

        // Create shutdown channel for the monitor task
        let (shutdown_tx, _) = broadcast::channel(1);
        self.shutdown_tx = Some(shutdown_tx);

        // Spawn task to handle stdout/stderr from the sidecar
        tokio::spawn(async move {
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stdout(line) => {
                        let line_str = String::from_utf8_lossy(&line);
                        log::info!("[archivist-node] {}", line_str.trim());
                    }
                    CommandEvent::Stderr(line) => {
                        let line_str = String::from_utf8_lossy(&line);
                        log::warn!("[archivist-node] {}", line_str.trim());
                    }
                    CommandEvent::Error(e) => {
                        log::error!("[archivist-node] Error: {}", e);
                    }
                    CommandEvent::Terminated(payload) => {
                        log::info!(
                            "[archivist-node] Terminated with code: {:?}, signal: {:?}",
                            payload.code,
                            payload.signal
                        );
                        break;
                    }
                    _ => {}
                }
            }
        });

        Ok(())
    }

    /// Stop the archivist-node sidecar
    pub async fn stop(&mut self) -> Result<()> {
        if self.status.state == NodeState::Stopped || self.status.state == NodeState::Stopping {
            return Err(ArchivistError::NodeNotRunning);
        }

        self.status.state = NodeState::Stopping;
        log::info!("Stopping Archivist node...");

        // Signal shutdown to monitor task
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }

        // Kill the process
        if let Some(mut process_state) = self.process_state.take() {
            if let Some(child) = process_state.child.take() {
                child.kill().map_err(|e| {
                    ArchivistError::NodeStopFailed(format!("Failed to kill process: {}", e))
                })?;
            }
        }

        // Update status
        self.status.state = NodeState::Stopped;
        self.status.pid = None;
        self.status.uptime_seconds = None;
        self.status.api_url = None;
        self.status.peer_id = None;
        self.status.spr = None;
        self.status.addresses = Vec::new();

        log::info!("Archivist node stopped");
        Ok(())
    }

    /// Restart the node
    pub async fn restart(&mut self, app_handle: &AppHandle) -> Result<()> {
        log::info!("Restarting Archivist node...");

        // Stop if running
        if self.status.state == NodeState::Running {
            self.stop().await?;
            // Brief pause to ensure clean shutdown
            tokio::time::sleep(Duration::from_millis(500)).await;
        }

        self.status.restart_count += 1;
        self.start(app_handle).await
    }

    /// Get current node status with updated uptime
    pub fn get_status(&self) -> NodeStatus {
        let mut status = self.status.clone();

        // Calculate uptime if running
        if let Some(ref process_state) = self.process_state {
            if let Some(start_time) = process_state.start_time {
                status.uptime_seconds = Some(start_time.elapsed().as_secs());
            }
        }

        status
    }

    /// Get node configuration
    pub fn get_config(&self) -> NodeConfig {
        self.config.clone()
    }

    /// Update node configuration (requires restart to take effect)
    pub fn set_config(&mut self, config: NodeConfig) {
        self.config = config;
    }

    /// Check if node is healthy by pinging its API
    pub async fn health_check(&mut self) -> Result<bool> {
        if self.status.state != NodeState::Running {
            return Ok(false);
        }

        // Use the debug/info endpoint to check node health and get peer info
        let api_url = format!(
            "http://127.0.0.1:{}/api/archivist/v1/debug/info",
            self.config.api_port
        );

        match reqwest::Client::new()
            .get(&api_url)
            .timeout(Duration::from_secs(5))
            .send()
            .await
        {
            Ok(response) if response.status().is_success() => {
                log::debug!("Node health check passed");
                // Try to parse the response to get peer info
                if let Ok(info) = response.json::<NodeInfoResponse>().await {
                    self.status.peer_id = Some(info.id);
                    self.status.spr = Some(info.spr);
                    self.status.addresses = info.announce_addresses.unwrap_or(info.addrs);
                }
                Ok(true)
            }
            Ok(response) => {
                log::warn!(
                    "Node health check failed with status: {}",
                    response.status()
                );
                self.status.last_error =
                    Some(format!("Health check failed: HTTP {}", response.status()));
                Ok(false)
            }
            Err(e) => {
                // Connection refused is expected if the node hasn't started its HTTP server yet
                if e.is_connect() {
                    log::debug!("Node health check: connection refused (may still be starting)");
                } else {
                    log::warn!("Node health check error: {}", e);
                    self.status.last_error = Some(format!("Health check error: {}", e));
                }
                Ok(false)
            }
        }
    }

    /// Check if the process is still alive
    pub fn is_process_alive(&self) -> bool {
        self.process_state.is_some() && self.status.state == NodeState::Running
    }

    /// Handle unexpected process termination
    pub fn mark_terminated(&mut self, error_msg: Option<String>) {
        self.status.state = NodeState::Error;
        self.status.pid = None;
        self.status.uptime_seconds = None;
        self.status.api_url = None;
        self.status.peer_id = None;
        self.status.spr = None;
        self.status.addresses = Vec::new();
        if let Some(msg) = error_msg {
            self.status.last_error = Some(msg);
        }
        self.process_state = None;
    }

    /// Get restart count
    pub fn get_restart_count(&self) -> u32 {
        self.status.restart_count
    }

    /// Check if auto-restart is enabled and under limit
    pub fn should_auto_restart(&self) -> bool {
        self.config.auto_restart && self.status.restart_count < self.config.max_restart_attempts
    }

    /// Reset restart counter (called after successful long-running period)
    pub fn reset_restart_count(&mut self) {
        self.status.restart_count = 0;
    }
}

impl Default for NodeService {
    fn default() -> Self {
        Self::new()
    }
}

/// Node manager that runs health checks and handles auto-restart
pub struct NodeManager {
    service: Arc<RwLock<NodeService>>,
    app_handle: AppHandle,
}

impl NodeManager {
    pub fn new(service: Arc<RwLock<NodeService>>, app_handle: AppHandle) -> Self {
        Self {
            service,
            app_handle,
        }
    }

    /// Start the health monitoring loop
    pub async fn start_monitoring(self) {
        let service = self.service;
        let app_handle = self.app_handle;

        tokio::spawn(async move {
            let mut healthy_since: Option<Instant> = None;

            loop {
                tokio::time::sleep(Duration::from_secs(30)).await;

                let mut node = service.write().await;
                let config = node.get_config();

                // Only monitor if node should be running
                if node.status.state != NodeState::Running {
                    healthy_since = None;
                    continue;
                }

                // Perform health check
                match node.health_check().await {
                    Ok(true) => {
                        // Mark healthy time
                        if healthy_since.is_none() {
                            healthy_since = Some(Instant::now());
                        }

                        // Reset restart count after 5 minutes of healthy operation
                        if let Some(since) = healthy_since {
                            if since.elapsed() > Duration::from_secs(300) {
                                node.reset_restart_count();
                                healthy_since = Some(Instant::now());
                            }
                        }
                    }
                    Ok(false) | Err(_) => {
                        healthy_since = None;

                        // Check if process is actually dead
                        if !node.is_process_alive() {
                            log::warn!("Node process appears to have crashed");
                            node.mark_terminated(Some("Process terminated unexpectedly".into()));

                            // Auto-restart if enabled and under limit
                            if node.should_auto_restart() {
                                log::info!(
                                    "Attempting auto-restart ({}/{})",
                                    node.get_restart_count() + 1,
                                    config.max_restart_attempts
                                );
                                drop(node); // Release lock before restart
                                let mut node = service.write().await;
                                if let Err(e) = node.restart(&app_handle).await {
                                    log::error!("Auto-restart failed: {}", e);
                                }
                            } else if node.get_restart_count() >= config.max_restart_attempts {
                                log::error!("Max restart attempts reached, giving up");
                            }
                        }
                    }
                }
            }
        });
    }
}
