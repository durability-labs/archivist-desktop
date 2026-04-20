use serde::Serialize;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ArchivistError {
    #[error("Node not running")]
    NodeNotRunning,

    #[error("Node already running")]
    NodeAlreadyRunning,

    #[error("Failed to start node: {0}")]
    NodeStartFailed(String),

    #[error("Failed to stop node: {0}")]
    NodeStopFailed(String),

    #[error("File not found: {0}")]
    FileNotFound(String),

    #[error("File operation failed: {0}")]
    FileOperationFailed(String),

    #[error("Sync error: {0}")]
    SyncError(String),

    #[error("Peer connection failed: {0}")]
    PeerConnectionFailed(String),

    #[error("Configuration error: {0}")]
    ConfigError(String),

    #[error("API request failed: {0}")]
    ApiError(String),

    #[error("Media download error: {0}")]
    MediaDownloadError(String),

    #[error("Binary not found: {0}")]
    BinaryNotFound(String),

    #[error("Streaming server error: {0}")]
    StreamingError(String),

    #[error("Web archive error: {0}")]
    WebArchiveError(String),

    #[error("Chat error: {0}")]
    ChatError(String),

    #[error("Crypto error: {0}")]
    CryptoError(String),

    #[error("TLS error: {0}")]
    TlsError(String),

    #[error("Session not found: {0}")]
    SessionNotFound(String),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("Serialization error: {0}")]
    SerializationError(#[from] serde_json::Error),

    #[error("Wallet error: {0}")]
    WalletError(String),

    #[error("Contract error: {0}")]
    ContractError(String),

    #[error("Marketplace error: {0}")]
    MarketplaceError(String),

    #[error("Torrent error: {0}")]
    TorrentError(String),

    #[error("IRC error: {0}")]
    IrcError(String),
}

impl ArchivistError {
    /// Returns a stable error code for frontend matching.
    pub fn error_code(&self) -> &'static str {
        match self {
            ArchivistError::NodeNotRunning => "NODE_NOT_RUNNING",
            ArchivistError::NodeAlreadyRunning => "NODE_ALREADY_RUNNING",
            ArchivistError::NodeStartFailed(_) => "NODE_START_FAILED",
            ArchivistError::NodeStopFailed(_) => "NODE_STOP_FAILED",
            ArchivistError::FileNotFound(_) => "FILE_NOT_FOUND",
            ArchivistError::FileOperationFailed(_) => "FILE_OPERATION_FAILED",
            ArchivistError::SyncError(_) => "SYNC_ERROR",
            ArchivistError::PeerConnectionFailed(_) => "PEER_CONNECTION_FAILED",
            ArchivistError::ConfigError(_) => "CONFIG_ERROR",
            ArchivistError::ApiError(_) => "API_ERROR",
            ArchivistError::MediaDownloadError(_) => "MEDIA_DOWNLOAD_ERROR",
            ArchivistError::BinaryNotFound(_) => "BINARY_NOT_FOUND",
            ArchivistError::StreamingError(_) => "STREAMING_ERROR",
            ArchivistError::WebArchiveError(_) => "WEB_ARCHIVE_ERROR",
            ArchivistError::ChatError(_) => "CHAT_ERROR",
            ArchivistError::CryptoError(_) => "CRYPTO_ERROR",
            ArchivistError::TlsError(_) => "TLS_ERROR",
            ArchivistError::SessionNotFound(_) => "SESSION_NOT_FOUND",
            ArchivistError::IoError(_) => "IO_ERROR",
            ArchivistError::SerializationError(_) => "SERIALIZATION_ERROR",
            ArchivistError::WalletError(_) => "WALLET_ERROR",
            ArchivistError::ContractError(_) => "CONTRACT_ERROR",
            ArchivistError::MarketplaceError(_) => "MARKETPLACE_ERROR",
            ArchivistError::TorrentError(_) => "TORRENT_ERROR",
            ArchivistError::IrcError(_) => "IRC_ERROR",
        }
    }
}

// Serialize as a plain string for frontend consumption. The frontend has dozens
// of `String(err)` / `e instanceof Error ? e.message : ...` call sites that
// expect the error to stringify cleanly. A structured `{ code, message }` form
// would surface as "[object Object]" at every call site that hasn't been
// migrated. The `error_code()` accessor above is still available for any future
// command that wants to expose machine-readable codes via a typed return value.
impl Serialize for ArchivistError {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, ArchivistError>;
