use crate::error::{ArchivistError, Result};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::{broadcast, mpsc, RwLock};

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
    pub public_ip: Option<String>,
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
            storage_available_bytes: 0, // Will be populated from node API
            last_error: None,
            restart_count: 0,
            api_url: None,
            peer_id: None,
            spr: None,
            addresses: Vec::new(),
            public_ip: None,
        }
    }
}

/// Node configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeConfig {
    pub data_dir: String,
    pub api_port: u16,
    pub discovery_port: u16, // UDP port for DHT/mDNS discovery
    pub listen_port: u16,    // TCP port for P2P connections
    pub max_storage_bytes: u64,
    pub auto_start: bool,
    pub auto_restart: bool,
    pub max_restart_attempts: u32,
    pub health_check_interval_secs: u64,
    pub log_level: String, // Log level: TRACE, DEBUG, INFO, NOTICE, WARN, ERROR, FATAL
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
            api_port: 8080,       // Default archivist-node API port
            discovery_port: 8090, // Default UDP port for DHT/mDNS discovery
            listen_port: 8070,    // Default TCP port for P2P connections
            max_storage_bytes: 10 * 1024 * 1024 * 1024, // 10 GB default
            auto_start: false,
            auto_restart: true,
            max_restart_attempts: 3,
            health_check_interval_secs: 30,
            log_level: "DEBUG".to_string(), // Good balance for debugging
        }
    }
}

impl NodeConfig {
    /// Create NodeConfig from persisted NodeSettings (AppConfig.node)
    pub fn from_node_settings(settings: &crate::services::config::NodeSettings) -> Self {
        Self {
            data_dir: settings.data_directory.clone(),
            api_port: settings.api_port,
            discovery_port: settings.discovery_port,
            listen_port: settings.listen_port,
            max_storage_bytes: settings.max_storage_gb as u64 * 1024 * 1024 * 1024,
            auto_start: settings.auto_start,
            auto_restart: true,
            max_restart_attempts: 3,
            health_check_interval_secs: 30,
            log_level: settings.log_level.clone(),
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
    /// Cached public IP to avoid repeated API calls
    public_ip_cache: Option<String>,
    /// Last time public IP was fetched
    public_ip_cache_time: Option<Instant>,
}

impl NodeService {
    pub fn new() -> Self {
        Self::with_config(NodeConfig::default())
    }

    /// Create a new NodeService with the specified configuration
    pub fn with_config(config: NodeConfig) -> Self {
        Self {
            status: NodeStatus::default(),
            config,
            process_state: None,
            shutdown_tx: None,
            public_ip_cache: None,
            public_ip_cache_time: None,
        }
    }

    /// Start the archivist-node sidecar
    pub async fn start(&mut self, app_handle: &AppHandle) -> Result<()> {
        self.start_internal(app_handle, false).await
    }

    /// Internal start method with retry capability
    async fn start_internal(&mut self, app_handle: &AppHandle, is_retry: bool) -> Result<()> {
        if self.status.state == NodeState::Running || self.status.state == NodeState::Starting {
            return Err(ArchivistError::NodeAlreadyRunning);
        }

        self.status.state = NodeState::Starting;
        self.status.last_error = None;
        log::info!("Starting Archivist node...");

        // Check if ports are available and clean up orphaned processes
        self.cleanup_orphaned_processes().await;

        // After orphaned process cleanup, verify port is actually free
        #[cfg(unix)]
        if let Some(process_info) = Self::check_port_in_use(self.config.api_port) {
            let msg = format!(
                "Port {} is already in use by {}. Close the conflicting application or change the API port in Settings.",
                self.config.api_port, process_info
            );
            log::error!("{}", msg);
            self.status.state = NodeState::Error;
            self.status.last_error = Some(msg.clone());
            return Err(ArchivistError::NodeStartFailed(msg));
        }

        // Ensure data directory exists
        let data_dir = std::path::Path::new(&self.config.data_dir);
        if !data_dir.exists() {
            std::fs::create_dir_all(data_dir).map_err(|e| {
                ArchivistError::NodeStartFailed(format!("Failed to create data dir: {}", e))
            })?;
        }

        // Build sidecar command with arguments
        // Note: archivist-node uses --key=value format (not --key value)
        // Use separate ports for discovery (UDP) and listening (TCP)
        // - discovery_port: UDP port for DHT/mDNS peer discovery (default: 8090)
        // - listen_port: TCP port for actual P2P connections (default: 8070)
        // Enable UPnP for automatic port forwarding on supported routers
        let listen_addr = format!("/ip4/0.0.0.0/tcp/{}", self.config.listen_port);

        // Set up log file path (inside data_dir)
        let log_file = std::path::Path::new(&self.config.data_dir).join("node.log");
        let log_file_str = log_file.to_string_lossy().to_string();

        log::info!("Archivist node logs will be written to: {}", log_file_str);

        let sidecar_command = app_handle
            .shell()
            .sidecar("archivist")
            .map_err(|e| ArchivistError::NodeStartFailed(format!("Sidecar not found: {}", e)))?
            .args([
                &format!("--data-dir={}", self.config.data_dir),
                &format!("--api-port={}", self.config.api_port),
                &format!("--disc-port={}", self.config.discovery_port),
                &format!("--listen-addrs={}", listen_addr),
                &format!("--storage-quota={}", self.config.max_storage_bytes),
                "--nat=upnp",
            ]);

        // Spawn the sidecar process
        let (mut rx, child) = sidecar_command.spawn().map_err(|e| {
            ArchivistError::NodeStartFailed(format!("Failed to spawn sidecar: {}", e))
        })?;

        let pid = child.pid();
        log::info!("Archivist node started with PID: {}", pid);

        // Update status - still in Starting state until API is ready
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

        // Wait for the API to become ready (UPnP probing can take ~10 seconds)
        let api_url = format!(
            "http://127.0.0.1:{}/api/archivist/v1/debug/info",
            self.config.api_port
        );
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(2))
            .build()
            .unwrap();

        let max_wait = Duration::from_secs(15);
        let start = Instant::now();
        let mut ready = false;

        log::info!("Waiting for node API to become ready...");
        while start.elapsed() < max_wait {
            match client.get(&api_url).send().await {
                Ok(response) if response.status().is_success() => {
                    ready = true;
                    log::info!("Node API is ready (took {:?})", start.elapsed());
                    break;
                }
                _ => {
                    tokio::time::sleep(Duration::from_millis(500)).await;
                }
            }
        }

        if ready {
            self.status.state = NodeState::Running;

            // Set log level via API
            let log_level_url = format!(
                "http://127.0.0.1:{}/api/archivist/v1/debug/chronicles/loglevel?level={}",
                self.config.api_port, self.config.log_level
            );
            log::info!("Setting node log level to: {}", self.config.log_level);
            match client.post(&log_level_url).send().await {
                Ok(response) if response.status().is_success() => {
                    log::info!("Log level set successfully");
                }
                Ok(response) => {
                    log::warn!("Failed to set log level, status: {}", response.status());
                }
                Err(e) => {
                    log::warn!("Failed to set log level: {}", e);
                }
            }

            // Emit event for sound notification
            let _ = app_handle.emit("node-started", ());
        } else {
            log::warn!(
                "Node API not ready after {:?}, may still be starting",
                max_wait
            );
            // Still set to Running - the health check will handle it if it's truly failed
            self.status.state = NodeState::Running;
            // Still emit the event since the process started
            let _ = app_handle.emit("node-started", ());
        }

        // Create channel to detect recoverable errors
        let (error_tx, mut error_rx) = mpsc::channel::<String>(10);
        let data_dir_clone = self.config.data_dir.clone();
        let log_file_path = log_file.clone();

        // Spawn task to handle stdout/stderr from the sidecar
        tokio::spawn(async move {
            // Open log file for writing (create or append)
            use std::fs::OpenOptions;
            use std::io::Write;

            let mut log_file_handle = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&log_file_path);

            if let Err(e) = &log_file_handle {
                log::error!("Failed to open log file for writing: {}", e);
            }

            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stdout(line) => {
                        let line_str = String::from_utf8_lossy(&line);
                        let trimmed = line_str.trim();
                        log::info!("[archivist-node] {}", trimmed);

                        // Write to log file
                        if let Ok(ref mut file) = log_file_handle {
                            let _ = writeln!(file, "{}", trimmed);
                            let _ = file.flush();
                        }

                        // Check for recoverable errors
                        if line_str.contains("Should create discovery datastore!") {
                            let _ = error_tx.send("discovery_datastore_error".to_string()).await;
                        }
                        // Check for port conflict errors
                        if line_str.contains("Address already in use") {
                            let _ = error_tx.send("port_conflict".to_string()).await;
                        }
                    }
                    CommandEvent::Stderr(line) => {
                        let line_str = String::from_utf8_lossy(&line);
                        let trimmed = line_str.trim();
                        log::warn!("[archivist-node] {}", trimmed);

                        // Write to log file
                        if let Ok(ref mut file) = log_file_handle {
                            let _ = writeln!(file, "{}", trimmed);
                            let _ = file.flush();
                        }

                        // Check for recoverable errors in stderr too
                        if line_str.contains("Should create discovery datastore!") {
                            let _ = error_tx.send("discovery_datastore_error".to_string()).await;
                        }
                        // Check for port conflict errors
                        if line_str.contains("Address already in use") {
                            let _ = error_tx.send("port_conflict".to_string()).await;
                        }
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

        // If this is not already a retry, check for recoverable errors in the first few seconds
        if !is_retry {
            let data_dir_for_recovery = data_dir_clone;
            let api_port = self.config.api_port;

            tokio::spawn(async move {
                // Wait a short time for potential errors
                tokio::select! {
                    Some(error_type) = error_rx.recv() => {
                        match error_type.as_str() {
                            "discovery_datastore_error" => {
                                log::warn!("Detected corrupted discovery datastore, attempting auto-recovery...");

                                // Clear the data directory
                                let data_path = std::path::Path::new(&data_dir_for_recovery);
                                if data_path.exists() {
                                    if let Err(e) = std::fs::remove_dir_all(data_path) {
                                        log::error!("Failed to clear data directory for recovery: {}", e);
                                        return;
                                    }
                                    log::info!("Cleared corrupted data directory: {}", data_dir_for_recovery);
                                }

                                log::info!("Data directory cleared. Node will auto-restart via health monitor.");
                            }
                            "port_conflict" => {
                                log::error!(
                                    "Port {} is in use by another application. Please change the port in Settings or close the conflicting application.",
                                    api_port
                                );
                            }
                            _ => {}
                        }
                    }
                    _ = tokio::time::sleep(Duration::from_secs(5)) => {
                        // No error detected within 5 seconds, node started successfully
                    }
                }
            });
        }

        Ok(())
    }

    /// Clear the node data directory (for recovery from corruption)
    #[allow(dead_code)]
    pub fn clear_data_directory(&self) -> Result<()> {
        let data_path = std::path::Path::new(&self.config.data_dir);
        if data_path.exists() {
            std::fs::remove_dir_all(data_path).map_err(|e| {
                ArchivistError::ConfigError(format!("Failed to clear data directory: {}", e))
            })?;
            log::info!("Cleared node data directory: {}", self.config.data_dir);
        }
        Ok(())
    }

    /// Clean up any orphaned archivist processes using our configured ports
    async fn cleanup_orphaned_processes(&self) {
        let api_port = self.config.api_port;
        let discovery_port = self.config.discovery_port;
        let listen_port = self.config.listen_port;

        log::info!(
            "Checking for orphaned processes on ports {} (API), {} (discovery), {} (listen)",
            api_port,
            discovery_port,
            listen_port
        );

        #[cfg(unix)]
        {
            // Check and kill orphaned archivist processes on the API port
            if let Some(pid) = Self::find_archivist_process_on_port(api_port) {
                log::warn!(
                    "Found orphaned archivist process (PID {}) on port {}, killing it",
                    pid,
                    api_port
                );
                unsafe {
                    libc::kill(pid as i32, libc::SIGTERM);
                }
                // Give it a moment to terminate
                tokio::time::sleep(Duration::from_millis(500)).await;
            }

            // Check and kill orphaned archivist processes on the discovery port
            if let Some(pid) = Self::find_archivist_process_on_port(discovery_port) {
                log::warn!(
                    "Found orphaned archivist process (PID {}) on port {}, killing it",
                    pid,
                    discovery_port
                );
                unsafe {
                    libc::kill(pid as i32, libc::SIGTERM);
                }
                tokio::time::sleep(Duration::from_millis(500)).await;
            }

            // Check and kill orphaned archivist processes on the listen port
            if let Some(pid) = Self::find_archivist_process_on_port(listen_port) {
                log::warn!(
                    "Found orphaned archivist process (PID {}) on port {}, killing it",
                    pid,
                    listen_port
                );
                unsafe {
                    libc::kill(pid as i32, libc::SIGTERM);
                }
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
        }

        #[cfg(not(unix))]
        {
            // On Windows, we can't easily check process names, so just log
            log::debug!("Orphaned process cleanup not implemented on this platform");
        }
    }

    /// Check if any process is listening on a port, returns user-friendly process info if so (Unix only)
    #[cfg(unix)]
    fn check_port_in_use(port: u16) -> Option<String> {
        use std::process::Command;

        let output = Command::new("ss")
            .args(["-tlnp", &format!("sport = :{}", port)])
            .output()
            .ok()?;

        let output_str = String::from_utf8_lossy(&output.stdout);
        // Parse the users:(("name",pid=NNN,...)) portion into a friendly string
        let re = regex::Regex::new(r#"users:\(\("([^"]+)",pid=(\d+)"#).ok();
        for line in output_str.lines() {
            if line.contains(&format!(":{}", port)) && !line.starts_with("State") {
                if let Some(caps) = re.as_ref().and_then(|r| r.captures(line)) {
                    let name = caps.get(1).map(|m| m.as_str()).unwrap_or("unknown");
                    let pid = caps.get(2).map(|m| m.as_str()).unwrap_or("?");
                    return Some(format!("process \"{}\" (PID {})", name, pid));
                }
                return Some("another process".to_string());
            }
        }

        None
    }

    /// Find an archivist process using a specific port (Unix only)
    #[cfg(unix)]
    fn find_archivist_process_on_port(port: u16) -> Option<u32> {
        use std::process::Command;

        // Use ss to find the process using the port
        let output = Command::new("ss")
            .args(["-tlnp", &format!("sport = :{}", port)])
            .output()
            .ok()?;

        let output_str = String::from_utf8_lossy(&output.stdout);

        // Parse the output to find PID of archivist process
        // Format: LISTEN 0 4096 127.0.0.1:8080 0.0.0.0:* users:(("archivist",pid=12345,fd=11))
        for line in output_str.lines() {
            if line.contains("archivist") {
                // Extract PID from users:(("archivist",pid=XXXXX,fd=YY))
                if let Some(pid_start) = line.find("pid=") {
                    let pid_str = &line[pid_start + 4..];
                    if let Some(pid_end) = pid_str.find(',') {
                        if let Ok(pid) = pid_str[..pid_end].parse::<u32>() {
                            return Some(pid);
                        }
                    }
                }
            }
        }

        None
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
    /// Note: This method checks if the process is still alive and updates status accordingly
    pub fn get_status(&mut self) -> NodeStatus {
        // Check if process is still alive when status claims to be running
        if self.status.state == NodeState::Running && !self.is_process_alive() {
            log::warn!("get_status: detected dead process, marking as terminated");
            self.mark_terminated(Some("Process died unexpectedly".into()));
        }

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

        // First check if the process is actually alive
        if !self.is_process_alive() {
            log::warn!(
                "Health check: process PID {} is no longer running",
                self.status.pid.unwrap_or(0)
            );
            self.mark_terminated(Some("Process died unexpectedly".into()));
            return Ok(false);
        }

        let client = reqwest::Client::new();

        // Use the debug/info endpoint to check node health and get peer info
        let api_url = format!(
            "http://127.0.0.1:{}/api/archivist/v1/debug/info",
            self.config.api_port
        );

        match client
            .get(&api_url)
            .timeout(Duration::from_secs(5))
            .send()
            .await
        {
            Ok(response) if response.status().is_success() => {
                log::debug!("Node health check passed");
                // Clear any previous error on successful health check
                self.status.last_error = None;
                // Try to parse the response to get peer info
                if let Ok(info) = response.json::<NodeInfoResponse>().await {
                    self.status.peer_id = Some(info.id);
                    self.status.spr = Some(info.spr);
                    self.status.addresses = info.announce_addresses.unwrap_or(info.addrs);
                }

                // Fetch storage space info from /space endpoint
                let space_url = format!(
                    "http://127.0.0.1:{}/api/archivist/v1/space",
                    self.config.api_port
                );
                if let Ok(space_response) = client
                    .get(&space_url)
                    .timeout(Duration::from_secs(5))
                    .send()
                    .await
                {
                    if space_response.status().is_success() {
                        #[derive(Deserialize)]
                        #[serde(rename_all = "camelCase")]
                        struct SpaceInfo {
                            quota_max_bytes: u64,
                            quota_used_bytes: u64,
                        }
                        if let Ok(space) = space_response.json::<SpaceInfo>().await {
                            self.status.storage_available_bytes = space.quota_max_bytes;
                            self.status.storage_used_bytes = space.quota_used_bytes;
                            log::debug!(
                                "Storage: {} / {} bytes",
                                space.quota_used_bytes,
                                space.quota_max_bytes
                            );
                        }
                    }
                }

                // Fetch public IP (cache for 5 minutes to avoid rate limiting)
                let should_fetch_ip = match self.public_ip_cache_time {
                    Some(time) => time.elapsed() > Duration::from_secs(300),
                    None => true,
                };

                if should_fetch_ip {
                    if let Ok(ip_response) = client
                        .get("https://api.ipify.org")
                        .timeout(Duration::from_secs(5))
                        .send()
                        .await
                    {
                        if let Ok(ip) = ip_response.text().await {
                            let ip = ip.trim().to_string();
                            log::debug!("Fetched public IP: {}", ip);
                            self.public_ip_cache = Some(ip.clone());
                            self.public_ip_cache_time = Some(Instant::now());
                            self.status.public_ip = Some(ip);
                        }
                    }
                } else {
                    // Use cached public IP
                    self.status.public_ip = self.public_ip_cache.clone();
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
                // Connection refused or timeout is expected if the node hasn't started its HTTP server yet
                // Don't set last_error for these transient issues
                if e.is_connect() {
                    log::debug!("Node health check: connection refused (may still be starting)");
                } else if e.is_timeout() {
                    log::debug!("Node health check: timeout (may still be starting)");
                } else {
                    log::warn!("Node health check error: {}", e);
                    self.status.last_error = Some(format!("Health check error: {}", e));
                }
                Ok(false)
            }
        }
    }

    /// Check if the process is still alive by verifying the PID exists
    pub fn is_process_alive(&self) -> bool {
        if self.process_state.is_none() || self.status.state != NodeState::Running {
            return false;
        }

        // Actually verify the process exists at the OS level
        #[cfg(unix)]
        if let Some(pid) = self.status.pid {
            // kill with signal 0 checks if process exists without sending a signal
            unsafe { libc::kill(pid as i32, 0) == 0 }
        } else {
            false
        }

        #[cfg(not(unix))]
        if self.status.pid.is_some() {
            // On non-Unix, fall back to checking process_state
            true
        } else {
            false
        }
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
