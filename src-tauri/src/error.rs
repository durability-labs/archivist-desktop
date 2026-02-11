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

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("Serialization error: {0}")]
    SerializationError(#[from] serde_json::Error),

    #[cfg(feature = "marketplace")]
    #[error("Wallet error: {0}")]
    WalletError(String),

    #[cfg(feature = "marketplace")]
    #[error("Contract error: {0}")]
    ContractError(String),
}

// Make error serializable for Tauri commands
impl Serialize for ArchivistError {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, ArchivistError>;
