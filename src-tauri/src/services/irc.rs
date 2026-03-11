use std::collections::VecDeque;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, watch, RwLock};
use tokio::time::{timeout, Duration};

use crate::services::config::IrcSettings;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IrcConnectionState {
    Disconnected,
    Connecting,
    Connected,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IrcMessageKind {
    Chat,
    Join,
    Part,
    Quit,
    Topic,
    System,
    Action,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IrcMessage {
    pub id: String,
    pub timestamp: String,
    pub kind: IrcMessageKind,
    pub sender: Option<String>,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IrcStatus {
    pub state: IrcConnectionState,
    pub nickname: String,
    pub channel: String,
    pub user_count: usize,
    pub topic: Option<String>,
}

pub struct IrcService {
    state: IrcConnectionState,
    config: IrcSettings,
    nickname: String,
    message_history: VecDeque<IrcMessage>,
    channel_users: Vec<String>,
    topic: Option<String>,
    outbound_tx: Option<mpsc::Sender<String>>,
    cancel_tx: Option<watch::Sender<bool>>,
    reconnect_count: u32,
}

impl IrcService {
    pub fn new(config: IrcSettings) -> Self {
        let nick = format!("{}{:04}", config.nick_prefix, rand::random::<u16>() % 10000);
        Self {
            state: IrcConnectionState::Disconnected,
            config,
            nickname: nick,
            message_history: VecDeque::new(),
            channel_users: Vec::new(),
            topic: None,
            outbound_tx: None,
            cancel_tx: None,
            reconnect_count: 0,
        }
    }

    pub fn get_status(&self) -> IrcStatus {
        IrcStatus {
            state: self.state,
            nickname: self.nickname.clone(),
            channel: self.config.channel.clone(),
            user_count: self.channel_users.len(),
            topic: self.topic.clone(),
        }
    }

    pub fn get_history(&self) -> Vec<IrcMessage> {
        self.message_history.iter().cloned().collect()
    }

    pub fn get_users(&self) -> Vec<String> {
        self.channel_users.clone()
    }

    pub fn push_message(&mut self, msg: IrcMessage) {
        self.message_history.push_back(msg);
        while self.message_history.len() > self.config.max_history {
            self.message_history.pop_front();
        }
    }

    pub fn send_message(&self, message: &str) -> Result<(), String> {
        if self.state != IrcConnectionState::Connected {
            return Err("Not connected to IRC".to_string());
        }
        let tx = self.outbound_tx.as_ref().ok_or("No outbound channel")?;
        let line = format!("PRIVMSG {} :{}\r\n", self.config.channel, message);
        tx.try_send(line).map_err(|e| e.to_string())
    }

    pub fn disconnect(&mut self) {
        if let Some(ref tx) = self.outbound_tx {
            let _ = tx.try_send("QUIT :Leaving\r\n".to_string());
        }
        if let Some(ref cancel) = self.cancel_tx {
            let _ = cancel.send(true);
        }
        self.outbound_tx = None;
        self.cancel_tx = None;
        self.state = IrcConnectionState::Disconnected;
        self.channel_users.clear();
    }

    /// Connect only if currently disconnected — prevents duplicate connections
    /// when both backend auto-start and frontend invoke try to connect.
    pub async fn connect_if_idle(service: Arc<RwLock<Self>>, app_handle: tauri::AppHandle) {
        log::info!("IRC connect_if_idle called");
        let svc = service.read().await;
        if svc.state != IrcConnectionState::Disconnected {
            log::info!("IRC already {:?} — skipping connect", svc.state);
            return;
        }
        drop(svc);
        Self::connect(service, app_handle);
    }

    pub fn connect(service: Arc<RwLock<Self>>, app_handle: tauri::AppHandle) {
        tauri::async_runtime::spawn(async move {
            log::info!("IRC background task starting");
            let result = std::panic::AssertUnwindSafe(Self::connection_loop(service, app_handle));
            if let Err(e) = futures::FutureExt::catch_unwind(result).await {
                log::error!("IRC connection task panicked: {:?}", e);
            }
        });
    }

    async fn connection_loop(service: Arc<RwLock<Self>>, app_handle: tauri::AppHandle) {
        log::info!("IRC connection_loop started");
        let mut backoff_secs = 5u64;

        loop {
            let (config, nickname, cancel_rx) = {
                let mut svc = service.write().await;
                if svc.state == IrcConnectionState::Connected {
                    return;
                }

                let (cancel_tx, cancel_rx) = watch::channel(false);
                svc.cancel_tx = Some(cancel_tx);
                svc.state = IrcConnectionState::Connecting;
                let config = svc.config.clone();
                let nickname = svc.nickname.clone();
                drop(svc);

                let _ = app_handle.emit(
                    "irc-state-changed",
                    serde_json::json!({
                        "state": "connecting"
                    }),
                );

                (config, nickname, cancel_rx)
            };

            match Self::do_connect(
                &config,
                &nickname,
                service.clone(),
                app_handle.clone(),
                cancel_rx,
            )
            .await
            {
                Ok(()) => {
                    // Clean disconnect requested
                    let svc = service.read().await;
                    if svc.cancel_tx.is_none() {
                        // User-initiated disconnect, don't reconnect
                        return;
                    }
                    drop(svc);
                }
                Err(e) => {
                    log::error!("IRC connection error: {}", e);
                    {
                        let mut svc = service.write().await;
                        svc.state = IrcConnectionState::Error;
                        svc.channel_users.clear();
                        svc.reconnect_count += 1;
                    }
                    let _ = app_handle.emit(
                        "irc-state-changed",
                        serde_json::json!({
                            "state": "error"
                        }),
                    );
                }
            }

            // Check if cancelled before reconnecting
            {
                let svc = service.read().await;
                if svc.cancel_tx.is_none() {
                    return;
                }
            }

            log::info!("IRC reconnecting in {}s...", backoff_secs);
            tokio::time::sleep(Duration::from_secs(backoff_secs)).await;
            backoff_secs = (backoff_secs * 2).min(120);
        }
    }

    async fn do_connect(
        config: &IrcSettings,
        nickname: &str,
        service: Arc<RwLock<Self>>,
        app_handle: tauri::AppHandle,
        mut cancel_rx: watch::Receiver<bool>,
    ) -> Result<(), String> {
        use rustls::ClientConfig;
        use tokio_rustls::TlsConnector;

        log::info!("IRC connecting to {}:{}", config.server, config.port);

        // Build TLS config with Mozilla CA roots
        let mut root_store = rustls::RootCertStore::empty();
        root_store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());

        let tls_config =
            ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
                .with_safe_default_protocol_versions()
                .map_err(|e| format!("TLS protocol version error: {}", e))?
                .with_root_certificates(root_store)
                .with_no_client_auth();

        let connector = TlsConnector::from(Arc::new(tls_config));

        let addr = format!("{}:{}", config.server, config.port);
        let tcp = timeout(
            Duration::from_secs(10),
            tokio::net::TcpStream::connect(&addr),
        )
        .await
        .map_err(|_| format!("TCP connect timed out after 10s to {}", addr))?
        .map_err(|e| format!("TCP connect failed: {}", e))?;

        log::info!("IRC TCP connected to {}", addr);

        let server_name = rustls::pki_types::ServerName::try_from(config.server.clone())
            .map_err(|e| format!("Invalid server name: {}", e))?;

        let tls_stream = timeout(Duration::from_secs(10), connector.connect(server_name, tcp))
            .await
            .map_err(|_| "TLS handshake timed out after 10s".to_string())?
            .map_err(|e| format!("TLS handshake failed: {}", e))?;

        log::info!("IRC TLS handshake complete");

        let (reader, mut writer) = tokio::io::split(tls_stream);
        let mut buf_reader = BufReader::new(reader);

        // Set up outbound channel
        let (outbound_tx, mut outbound_rx) = mpsc::channel::<String>(64);

        {
            let mut svc = service.write().await;
            svc.outbound_tx = Some(outbound_tx.clone());
        }

        // Send NICK and USER
        let nick_cmd = format!("NICK {}\r\n", nickname);
        let user_cmd = "USER arch 0 * :Archivist User\r\n".to_string();
        writer
            .write_all(nick_cmd.as_bytes())
            .await
            .map_err(|e| e.to_string())?;
        writer
            .write_all(user_cmd.as_bytes())
            .await
            .map_err(|e| e.to_string())?;

        log::info!("IRC registration sent as {}", nickname);

        // Spawn writer task
        let writer_cancel = cancel_rx.clone();
        let writer_handle = tauri::async_runtime::spawn(async move {
            let mut cancel = writer_cancel;
            loop {
                tokio::select! {
                    msg = outbound_rx.recv() => {
                        match msg {
                            Some(line) => {
                                if let Err(e) = writer.write_all(line.as_bytes()).await {
                                    log::error!("IRC write error: {}", e);
                                    break;
                                }
                            }
                            None => break,
                        }
                    }
                    _ = cancel.changed() => {
                        break;
                    }
                }
            }
        });

        let channel = config.channel.clone();
        let max_history = config.max_history;
        let mut names_buffer: Vec<String> = Vec::new();

        // Read loop
        let mut line = String::new();
        loop {
            line.clear();
            tokio::select! {
                result = buf_reader.read_line(&mut line) => {
                    match result {
                        Ok(0) => {
                            // Connection closed
                            break;
                        }
                        Ok(_) => {
                            let trimmed = line.trim_end();
                            if trimmed.is_empty() {
                                continue;
                            }
                            Self::handle_line(
                                trimmed,
                                &service,
                                &app_handle,
                                &outbound_tx,
                                &channel,
                                max_history,
                                &mut names_buffer,
                            ).await;
                        }
                        Err(e) => {
                            log::error!("IRC read error: {}", e);
                            break;
                        }
                    }
                }
                _ = cancel_rx.changed() => {
                    break;
                }
            }
        }

        writer_handle.abort();
        Ok(())
    }

    async fn handle_line(
        line: &str,
        service: &Arc<RwLock<Self>>,
        app_handle: &tauri::AppHandle,
        outbound_tx: &mpsc::Sender<String>,
        channel: &str,
        max_history: usize,
        names_buffer: &mut Vec<String>,
    ) {
        let parsed = parse_irc_line(line);

        match parsed.command.as_str() {
            "PING" => {
                let token = parsed.trailing.as_deref().unwrap_or("");
                let _ = outbound_tx.try_send(format!("PONG :{}\r\n", token));
            }
            "001" => {
                // Welcome - registered successfully
                let nickname = {
                    let mut svc = service.write().await;
                    svc.state = IrcConnectionState::Connected;
                    svc.reconnect_count = 0;
                    svc.nickname.clone()
                };
                let _ = app_handle.emit(
                    "irc-state-changed",
                    serde_json::json!({
                        "state": "connected"
                    }),
                );
                let _ = outbound_tx.try_send(format!("JOIN {}\r\n", channel));
                log::info!("IRC connected as {}, joining {}", nickname, channel);
            }
            "433" => {
                // Nick in use - try new one
                let new_nick = format!("Arch{:04}", rand::random::<u16>() % 10000);
                let _ = outbound_tx.try_send(format!("NICK {}\r\n", new_nick));
                let mut svc = service.write().await;
                svc.nickname = new_nick;
            }
            "332" => {
                // Topic
                let topic = parsed.trailing.clone().unwrap_or_default();
                {
                    let mut svc = service.write().await;
                    svc.topic = Some(topic.clone());
                }
                let _ = app_handle.emit(
                    "irc-topic-changed",
                    serde_json::json!({
                        "topic": topic
                    }),
                );
            }
            "353" => {
                // NAMES list (accumulate)
                if let Some(ref trailing) = parsed.trailing {
                    for name in trailing.split_whitespace() {
                        let clean = name.trim_start_matches(['@', '+', '%']);
                        names_buffer.push(clean.to_string());
                    }
                }
            }
            "366" => {
                // End of NAMES
                let users = {
                    let mut svc = service.write().await;
                    svc.channel_users = std::mem::take(names_buffer);
                    svc.channel_users.sort();
                    svc.channel_users.clone()
                };
                let _ = app_handle.emit(
                    "irc-users-updated",
                    serde_json::json!({
                        "users": users,
                        "count": users.len()
                    }),
                );
            }
            "PRIVMSG" => {
                let sender = extract_nick(&parsed.prefix);
                let content = parsed.trailing.clone().unwrap_or_default();

                let (kind, content) =
                    if content.starts_with("\x01ACTION ") && content.ends_with('\x01') {
                        let action = content[8..content.len() - 1].to_string();
                        (IrcMessageKind::Action, action)
                    } else {
                        (IrcMessageKind::Chat, content)
                    };

                let msg = IrcMessage {
                    id: uuid::Uuid::new_v4().to_string(),
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    kind,
                    sender: Some(sender),
                    content,
                };

                {
                    let mut svc = service.write().await;
                    svc.message_history.push_back(msg.clone());
                    while svc.message_history.len() > max_history {
                        svc.message_history.pop_front();
                    }
                }
                let _ = app_handle.emit("irc-message", &msg);
            }
            "JOIN" => {
                let sender = extract_nick(&parsed.prefix);
                let msg = IrcMessage {
                    id: uuid::Uuid::new_v4().to_string(),
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    kind: IrcMessageKind::Join,
                    sender: Some(sender.clone()),
                    content: format!("{} has joined {}", sender, channel),
                };
                let users = {
                    let mut svc = service.write().await;
                    if !svc.channel_users.contains(&sender) {
                        svc.channel_users.push(sender);
                        svc.channel_users.sort();
                    }
                    svc.message_history.push_back(msg.clone());
                    while svc.message_history.len() > max_history {
                        svc.message_history.pop_front();
                    }
                    svc.channel_users.clone()
                };
                let _ = app_handle.emit("irc-message", &msg);
                let _ = app_handle.emit(
                    "irc-users-updated",
                    serde_json::json!({
                        "users": users,
                        "count": users.len()
                    }),
                );
            }
            "PART" => {
                let sender = extract_nick(&parsed.prefix);
                let reason = parsed.trailing.clone().unwrap_or_default();
                let msg = IrcMessage {
                    id: uuid::Uuid::new_v4().to_string(),
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    kind: IrcMessageKind::Part,
                    sender: Some(sender.clone()),
                    content: if reason.is_empty() {
                        format!("{} has left {}", sender, channel)
                    } else {
                        format!("{} has left {} ({})", sender, channel, reason)
                    },
                };
                let users = {
                    let mut svc = service.write().await;
                    svc.channel_users.retain(|u| u != &sender);
                    svc.message_history.push_back(msg.clone());
                    while svc.message_history.len() > max_history {
                        svc.message_history.pop_front();
                    }
                    svc.channel_users.clone()
                };
                let _ = app_handle.emit("irc-message", &msg);
                let _ = app_handle.emit(
                    "irc-users-updated",
                    serde_json::json!({
                        "users": users,
                        "count": users.len()
                    }),
                );
            }
            "QUIT" => {
                let sender = extract_nick(&parsed.prefix);
                let reason = parsed.trailing.clone().unwrap_or_default();
                let msg = IrcMessage {
                    id: uuid::Uuid::new_v4().to_string(),
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    kind: IrcMessageKind::Quit,
                    sender: Some(sender.clone()),
                    content: if reason.is_empty() {
                        format!("{} has quit", sender)
                    } else {
                        format!("{} has quit ({})", sender, reason)
                    },
                };
                let users = {
                    let mut svc = service.write().await;
                    svc.channel_users.retain(|u| u != &sender);
                    svc.message_history.push_back(msg.clone());
                    while svc.message_history.len() > max_history {
                        svc.message_history.pop_front();
                    }
                    svc.channel_users.clone()
                };
                let _ = app_handle.emit("irc-message", &msg);
                let _ = app_handle.emit(
                    "irc-users-updated",
                    serde_json::json!({
                        "users": users,
                        "count": users.len()
                    }),
                );
            }
            "TOPIC" => {
                let sender = extract_nick(&parsed.prefix);
                let topic = parsed.trailing.clone().unwrap_or_default();
                let msg = IrcMessage {
                    id: uuid::Uuid::new_v4().to_string(),
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    kind: IrcMessageKind::Topic,
                    sender: Some(sender.clone()),
                    content: format!("{} changed the topic to: {}", sender, topic),
                };
                {
                    let mut svc = service.write().await;
                    svc.topic = Some(topic.clone());
                    svc.message_history.push_back(msg.clone());
                    while svc.message_history.len() > max_history {
                        svc.message_history.pop_front();
                    }
                }
                let _ = app_handle.emit("irc-message", &msg);
                let _ = app_handle.emit(
                    "irc-topic-changed",
                    serde_json::json!({
                        "topic": topic
                    }),
                );
            }
            "ERROR" => {
                let error_msg = parsed.trailing.clone().unwrap_or_default();
                log::error!("IRC server error: {}", error_msg);
            }
            _ => {
                // Ignore unhandled numerics/commands
            }
        }
    }
}

/// Parsed IRC message components
struct ParsedIrcLine {
    prefix: Option<String>,
    command: String,
    #[allow(dead_code)]
    params: Vec<String>,
    trailing: Option<String>,
}

/// Parse a raw IRC protocol line: `[:prefix] COMMAND [params...] [:trailing]`
fn parse_irc_line(line: &str) -> ParsedIrcLine {
    let mut rest = line;
    let prefix = if rest.starts_with(':') {
        let end = rest.find(' ').unwrap_or(rest.len());
        let p = rest[1..end].to_string();
        rest = if end < rest.len() {
            &rest[end + 1..]
        } else {
            ""
        };
        Some(p)
    } else {
        None
    };

    // Split at trailing
    let (main, trailing) = if let Some(idx) = rest.find(" :") {
        (&rest[..idx], Some(rest[idx + 2..].to_string()))
    } else {
        (rest, None)
    };

    let mut parts: Vec<&str> = main.split_whitespace().collect();
    let command = if parts.is_empty() {
        String::new()
    } else {
        parts.remove(0).to_string()
    };
    let params: Vec<String> = parts.iter().map(|s| s.to_string()).collect();

    ParsedIrcLine {
        prefix,
        command,
        params,
        trailing,
    }
}

/// Extract nickname from IRC prefix (nick!user@host)
fn extract_nick(prefix: &Option<String>) -> String {
    match prefix {
        Some(p) => {
            if let Some(idx) = p.find('!') {
                p[..idx].to_string()
            } else {
                p.clone()
            }
        }
        None => "unknown".to_string(),
    }
}
