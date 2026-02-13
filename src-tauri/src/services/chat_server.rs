//! Chat Server — warp HTTPS server on port 8088.
//!
//! Follows the same pattern as `manifest_server.rs`:
//! bind_with_graceful_shutdown + oneshot channel.

use std::sync::Arc;
use warp::Filter;

use super::chat_types::{
    DeliveryAck, EncryptedChatMessage, EncryptedGroupMessage, GroupInvite, GroupRekey,
    PreKeyBundleExchange,
};
use crate::error::Result;

/// Incoming message handler trait — implemented by ChatService.
pub type IncomingHandler = Arc<dyn ChatIncomingHandler + Send + Sync>;

#[async_trait::async_trait]
pub trait ChatIncomingHandler: Send + Sync {
    async fn handle_prekey_bundle(
        &self,
        exchange: PreKeyBundleExchange,
    ) -> std::result::Result<PreKeyBundleExchange, String>;
    async fn handle_message(&self, msg: EncryptedChatMessage) -> std::result::Result<(), String>;
    async fn handle_group_invite(&self, invite: GroupInvite) -> std::result::Result<(), String>;
    async fn handle_group_message(
        &self,
        msg: EncryptedGroupMessage,
    ) -> std::result::Result<(), String>;
    async fn handle_group_rekey(&self, rekey: GroupRekey) -> std::result::Result<(), String>;
    async fn handle_ack(&self, ack: DeliveryAck) -> std::result::Result<(), String>;
}

/// TLS-enabled chat HTTP server.
pub struct ChatServer {
    port: u16,
    cert_path: String,
    key_path: String,
    shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
    running: bool,
}

impl ChatServer {
    pub fn new(port: u16, cert_path: String, key_path: String) -> Self {
        Self {
            port,
            cert_path,
            key_path,
            shutdown_tx: None,
            running: false,
        }
    }

    /// Start the TLS server. `handler` processes incoming chat traffic.
    pub async fn start(&mut self, handler: IncomingHandler) -> Result<()> {
        if self.running {
            return Ok(());
        }

        let handler_prekey = handler.clone();
        let handler_msg = handler.clone();
        let handler_group_invite = handler.clone();
        let handler_group_msg = handler.clone();
        let handler_rekey = handler.clone();
        let handler_ack = handler.clone();

        // POST /chat/prekey-bundle
        let prekey_route = warp::path!("chat" / "prekey-bundle")
            .and(warp::post())
            .and(warp::body::json())
            .and(warp::any().map(move || handler_prekey.clone()))
            .and_then(handle_prekey_bundle);

        // POST /chat/message
        let msg_route = warp::path!("chat" / "message")
            .and(warp::post())
            .and(warp::body::json())
            .and(warp::any().map(move || handler_msg.clone()))
            .and_then(handle_message);

        // POST /chat/group/invite
        let group_invite_route = warp::path!("chat" / "group" / "invite")
            .and(warp::post())
            .and(warp::body::json())
            .and(warp::any().map(move || handler_group_invite.clone()))
            .and_then(handle_group_invite);

        // POST /chat/group/message
        let group_msg_route = warp::path!("chat" / "group" / "message")
            .and(warp::post())
            .and(warp::body::json())
            .and(warp::any().map(move || handler_group_msg.clone()))
            .and_then(handle_group_message);

        // POST /chat/group/rekey
        let rekey_route = warp::path!("chat" / "group" / "rekey")
            .and(warp::post())
            .and(warp::body::json())
            .and(warp::any().map(move || handler_rekey.clone()))
            .and_then(handle_group_rekey);

        // POST /chat/ack/{msgId}
        let ack_route = warp::path!("chat" / "ack")
            .and(warp::post())
            .and(warp::body::json())
            .and(warp::any().map(move || handler_ack.clone()))
            .and_then(handle_ack);

        // GET /chat/health
        let health_route = warp::path!("chat" / "health")
            .and(warp::get())
            .map(|| warp::reply::json(&serde_json::json!({"status": "ok"})));

        let routes = prekey_route
            .or(msg_route)
            .or(group_invite_route)
            .or(group_msg_route)
            .or(rekey_route)
            .or(ack_route)
            .or(health_route)
            .recover(handle_rejection)
            .with(warp::log("chat_server"));

        let (tx, rx) = tokio::sync::oneshot::channel();
        self.shutdown_tx = Some(tx);

        let port = self.port;
        let cert_path = self.cert_path.clone();
        let key_path = self.key_path.clone();

        let (_, server) = warp::serve(routes)
            .tls()
            .cert_path(&cert_path)
            .key_path(&key_path)
            .bind_with_graceful_shutdown(([0, 0, 0, 0], port), async {
                rx.await.ok();
            });

        tokio::spawn(server);
        self.running = true;
        log::info!("Chat TLS server started on port {}", port);
        Ok(())
    }

    #[allow(dead_code)]
    pub fn stop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
            self.running = false;
            log::info!("Chat TLS server stopped");
        }
    }

    pub fn is_running(&self) -> bool {
        self.running
    }

    #[allow(dead_code)]
    pub fn port(&self) -> u16 {
        self.port
    }
}

// ── Handlers ───────────────────────────────────────────────────

async fn handle_prekey_bundle(
    exchange: PreKeyBundleExchange,
    handler: IncomingHandler,
) -> std::result::Result<impl warp::Reply, warp::Rejection> {
    match handler.handle_prekey_bundle(exchange).await {
        Ok(response) => Ok(warp::reply::with_status(
            warp::reply::json(&response),
            warp::http::StatusCode::OK,
        )),
        Err(e) => Ok(warp::reply::with_status(
            warp::reply::json(&serde_json::json!({"error": e})),
            warp::http::StatusCode::BAD_REQUEST,
        )),
    }
}

async fn handle_message(
    msg: EncryptedChatMessage,
    handler: IncomingHandler,
) -> std::result::Result<impl warp::Reply, warp::Rejection> {
    match handler.handle_message(msg).await {
        Ok(()) => Ok(warp::reply::with_status(
            warp::reply::json(&serde_json::json!({"status": "ok"})),
            warp::http::StatusCode::OK,
        )),
        Err(e) => Ok(warp::reply::with_status(
            warp::reply::json(&serde_json::json!({"error": e})),
            warp::http::StatusCode::BAD_REQUEST,
        )),
    }
}

async fn handle_group_invite(
    invite: GroupInvite,
    handler: IncomingHandler,
) -> std::result::Result<impl warp::Reply, warp::Rejection> {
    match handler.handle_group_invite(invite).await {
        Ok(()) => Ok(warp::reply::with_status(
            warp::reply::json(&serde_json::json!({"status": "ok"})),
            warp::http::StatusCode::OK,
        )),
        Err(e) => Ok(warp::reply::with_status(
            warp::reply::json(&serde_json::json!({"error": e})),
            warp::http::StatusCode::BAD_REQUEST,
        )),
    }
}

async fn handle_group_message(
    msg: EncryptedGroupMessage,
    handler: IncomingHandler,
) -> std::result::Result<impl warp::Reply, warp::Rejection> {
    match handler.handle_group_message(msg).await {
        Ok(()) => Ok(warp::reply::with_status(
            warp::reply::json(&serde_json::json!({"status": "ok"})),
            warp::http::StatusCode::OK,
        )),
        Err(e) => Ok(warp::reply::with_status(
            warp::reply::json(&serde_json::json!({"error": e})),
            warp::http::StatusCode::BAD_REQUEST,
        )),
    }
}

async fn handle_group_rekey(
    rekey: GroupRekey,
    handler: IncomingHandler,
) -> std::result::Result<impl warp::Reply, warp::Rejection> {
    match handler.handle_group_rekey(rekey).await {
        Ok(()) => Ok(warp::reply::with_status(
            warp::reply::json(&serde_json::json!({"status": "ok"})),
            warp::http::StatusCode::OK,
        )),
        Err(e) => Ok(warp::reply::with_status(
            warp::reply::json(&serde_json::json!({"error": e})),
            warp::http::StatusCode::BAD_REQUEST,
        )),
    }
}

async fn handle_ack(
    ack: DeliveryAck,
    handler: IncomingHandler,
) -> std::result::Result<impl warp::Reply, warp::Rejection> {
    match handler.handle_ack(ack).await {
        Ok(()) => Ok(warp::reply::with_status(
            warp::reply::json(&serde_json::json!({"status": "ok"})),
            warp::http::StatusCode::OK,
        )),
        Err(e) => Ok(warp::reply::with_status(
            warp::reply::json(&serde_json::json!({"error": e})),
            warp::http::StatusCode::BAD_REQUEST,
        )),
    }
}

async fn handle_rejection(
    err: warp::Rejection,
) -> std::result::Result<impl warp::Reply, std::convert::Infallible> {
    if err.is_not_found() {
        Ok(warp::reply::with_status(
            warp::reply::json(&serde_json::json!({"error": "Not Found"})),
            warp::http::StatusCode::NOT_FOUND,
        ))
    } else {
        Ok(warp::reply::with_status(
            warp::reply::json(&serde_json::json!({"error": "Internal Server Error"})),
            warp::http::StatusCode::INTERNAL_SERVER_ERROR,
        ))
    }
}
