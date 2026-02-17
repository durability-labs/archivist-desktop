//! Media Streaming Server
//!
//! HTTP server that streams downloaded media files with range request support.
//! Used by both the local video player (webview) and mobile browser clients on the LAN.
//! Follows the ManifestServer pattern: warp 0.3, graceful shutdown, CORS.

use crate::error::{ArchivistError, Result};
use crate::services::media_download::{DownloadTask, MediaDownloadService};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;
use warp::Filter;

/// Configuration for the media streaming server
#[derive(Debug, Clone)]
pub struct MediaStreamingConfig {
    pub port: u16,
}

impl Default for MediaStreamingConfig {
    fn default() -> Self {
        Self { port: 8087 }
    }
}

/// A media item available for streaming
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaLibraryItem {
    pub id: String,
    pub title: String,
    pub thumbnail: Option<String>,
    pub output_path: String,
    pub file_size: u64,
    pub mime_type: String,
    pub completed_at: Option<String>,
    pub audio_only: bool,
}

/// Response from GET /api/v1/library
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryResponse {
    pub items: Vec<MediaLibraryItem>,
    pub total_count: usize,
}

/// Media Streaming Server
pub struct MediaStreamingServer {
    media_download: Arc<RwLock<MediaDownloadService>>,
    shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
    running: bool,
    port: u16,
}

impl MediaStreamingServer {
    pub fn new(
        config: MediaStreamingConfig,
        media_download: Arc<RwLock<MediaDownloadService>>,
    ) -> Self {
        Self {
            media_download,
            shutdown_tx: None,
            running: false,
            port: config.port,
        }
    }

    /// Get the server URL if running
    pub fn get_url(&self) -> Option<String> {
        if self.running {
            Some(format!("http://127.0.0.1:{}", self.port))
        } else {
            None
        }
    }

    /// Build library items from completed downloads
    pub async fn get_library(&self) -> Vec<MediaLibraryItem> {
        let download = self.media_download.read().await;
        let completed = download.get_completed_media();
        completed
            .into_iter()
            .filter_map(|task| build_library_item(&task))
            .collect()
    }

    /// Start the HTTP server
    pub async fn start(&mut self) -> Result<()> {
        if self.running {
            return Ok(());
        }

        let port = self.port;

        let media_download = self.media_download.clone();

        // CORS for mobile browser access
        let cors = warp::cors()
            .allow_any_origin()
            .allow_methods(vec!["GET", "HEAD", "OPTIONS"])
            .allow_headers(vec!["Range", "Content-Type"]);

        // GET /health
        let health_route = warp::path("health")
            .and(warp::get())
            .map(|| warp::reply::json(&serde_json::json!({"status": "ok"})));

        // GET /api/v1/library
        let media_for_library = media_download.clone();
        let library_route = warp::path!("api" / "v1" / "library")
            .and(warp::get())
            .and(warp::any().map(move || media_for_library.clone()))
            .and_then(handle_library);

        // GET /api/v1/media/:id
        let media_for_info = media_download.clone();
        let info_route = warp::path!("api" / "v1" / "media" / String)
            .and(warp::get())
            .and(warp::any().map(move || media_for_info.clone()))
            .and_then(handle_media_info);

        // GET /api/v1/media/:id/stream
        let media_for_stream = media_download.clone();
        let stream_route = warp::path!("api" / "v1" / "media" / String / "stream")
            .and(warp::get().or(warp::head()).unify())
            .and(warp::header::optional::<String>("range"))
            .and(warp::any().map(move || media_for_stream.clone()))
            .and_then(handle_stream);

        let routes = health_route
            .or(library_route)
            .or(stream_route)
            .or(info_route)
            .recover(handle_rejection)
            .with(cors)
            .with(warp::log("media_streaming"));

        // Create shutdown channel
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.shutdown_tx = Some(tx);
        self.running = true;

        let (_, server) =
            warp::serve(routes).bind_with_graceful_shutdown(([0, 0, 0, 0], port), async {
                rx.await.ok();
            });

        log::info!("Media streaming server starting on port {}", port);
        tokio::spawn(server);

        Ok(())
    }

    /// Stop the server
    pub fn stop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
            self.running = false;
            log::info!("Media streaming server stopped");
        }
    }
}

/// Build a MediaLibraryItem from a DownloadTask
fn build_library_item(task: &DownloadTask) -> Option<MediaLibraryItem> {
    let path = task.output_path.as_ref()?;

    // Check file exists and get size
    let metadata = std::fs::metadata(path).ok()?;
    let mime = mime_guess::from_path(path)
        .first_or_octet_stream()
        .to_string();

    Some(MediaLibraryItem {
        id: task.id.clone(),
        title: task.title.clone(),
        thumbnail: task.thumbnail.clone(),
        output_path: path.clone(),
        file_size: metadata.len(),
        mime_type: mime,
        completed_at: task.completed_at.map(|dt| dt.to_rfc3339()),
        audio_only: task.options.audio_only,
    })
}

/// Find a completed task by ID
async fn find_completed_task(
    id: &str,
    media: &Arc<RwLock<MediaDownloadService>>,
) -> Option<DownloadTask> {
    let download = media.read().await;
    let completed = download.get_completed_media();
    completed.into_iter().find(|t| t.id == id)
}

// --- Route handlers ---

async fn handle_library(
    media: Arc<RwLock<MediaDownloadService>>,
) -> std::result::Result<impl warp::Reply, warp::Rejection> {
    let download = media.read().await;
    let completed = download.get_completed_media();
    let items: Vec<MediaLibraryItem> = completed.iter().filter_map(build_library_item).collect();
    let response = LibraryResponse {
        total_count: items.len(),
        items,
    };
    Ok(warp::reply::json(&response))
}

async fn handle_media_info(
    id: String,
    media: Arc<RwLock<MediaDownloadService>>,
) -> std::result::Result<impl warp::Reply, warp::Rejection> {
    let task = find_completed_task(&id, &media)
        .await
        .ok_or_else(warp::reject::not_found)?;
    let item = build_library_item(&task).ok_or_else(warp::reject::not_found)?;
    Ok(warp::reply::json(&item))
}

async fn handle_stream(
    id: String,
    range_header: Option<String>,
    media: Arc<RwLock<MediaDownloadService>>,
) -> std::result::Result<warp::reply::Response, warp::Rejection> {
    use tokio::io::AsyncReadExt;
    use tokio::io::AsyncSeekExt;
    use tokio_util::io::ReaderStream;

    // Look up the completed task
    let task = find_completed_task(&id, &media)
        .await
        .ok_or_else(warp::reject::not_found)?;
    let path = task
        .output_path
        .as_ref()
        .ok_or_else(warp::reject::not_found)?;

    // Open the file
    let file = tokio::fs::File::open(path)
        .await
        .map_err(|_| warp::reject::not_found())?;
    let file_metadata = file
        .metadata()
        .await
        .map_err(|_| warp::reject::not_found())?;
    let file_size = file_metadata.len();

    // Detect MIME type
    let mime = mime_guess::from_path(path)
        .first_or_octet_stream()
        .to_string();

    if let Some(range) = range_header {
        // Parse Range header
        let (start, end) = parse_range(&range, file_size).map_err(|_| warp::reject::not_found())?;
        let content_length = end - start + 1;

        // Seek to start position
        let mut file = file;
        file.seek(std::io::SeekFrom::Start(start))
            .await
            .map_err(|_| warp::reject::not_found())?;

        // Create a limited reader and stream it
        let limited = file.take(content_length);
        let stream = ReaderStream::with_capacity(limited, 64 * 1024);
        let body = warp::hyper::Body::wrap_stream(stream);

        let response = warp::http::Response::builder()
            .status(206)
            .header("Content-Type", &mime)
            .header("Content-Length", content_length)
            .header(
                "Content-Range",
                format!("bytes {}-{}/{}", start, end, file_size),
            )
            .header("Accept-Ranges", "bytes")
            .body(body)
            .unwrap();

        Ok(response)
    } else {
        // Full file response
        let stream = ReaderStream::with_capacity(file, 64 * 1024);
        let body = warp::hyper::Body::wrap_stream(stream);

        let response = warp::http::Response::builder()
            .status(200)
            .header("Content-Type", &mime)
            .header("Content-Length", file_size)
            .header("Accept-Ranges", "bytes")
            .body(body)
            .unwrap();

        Ok(response)
    }
}

/// Parse an HTTP Range header value like "bytes=0-1023" or "bytes=500-" or "bytes=-500"
fn parse_range(range: &str, file_size: u64) -> std::result::Result<(u64, u64), ArchivistError> {
    let range = range
        .strip_prefix("bytes=")
        .ok_or_else(|| ArchivistError::StreamingError("Invalid range format".to_string()))?;

    if let Some(suffix) = range.strip_prefix('-') {
        // Suffix range: last N bytes
        let n: u64 = suffix
            .parse()
            .map_err(|_| ArchivistError::StreamingError("Invalid range value".to_string()))?;
        let start = file_size.saturating_sub(n);
        Ok((start, file_size - 1))
    } else if let Some(prefix) = range.strip_suffix('-') {
        // Open-ended range: from start to end of file
        let start: u64 = prefix
            .parse()
            .map_err(|_| ArchivistError::StreamingError("Invalid range value".to_string()))?;
        Ok((start, file_size - 1))
    } else {
        // Explicit range: start-end
        let parts: Vec<&str> = range.split('-').collect();
        if parts.len() != 2 {
            return Err(ArchivistError::StreamingError(
                "Invalid range format".to_string(),
            ));
        }
        let start: u64 = parts[0]
            .parse()
            .map_err(|_| ArchivistError::StreamingError("Invalid range value".to_string()))?;
        let end: u64 = parts[1]
            .parse()
            .map_err(|_| ArchivistError::StreamingError("Invalid range value".to_string()))?;
        Ok((start, end.min(file_size - 1)))
    }
}

// --- Error handling ---

async fn handle_rejection(
    err: warp::Rejection,
) -> std::result::Result<impl warp::Reply, std::convert::Infallible> {
    if err.is_not_found() {
        Ok(warp::reply::with_status(
            warp::reply::json(&serde_json::json!({
                "error": "Not Found",
                "message": "Media not found or file no longer exists"
            })),
            warp::http::StatusCode::NOT_FOUND,
        ))
    } else {
        Ok(warp::reply::with_status(
            warp::reply::json(&serde_json::json!({
                "error": "Internal Server Error",
                "message": "An unexpected error occurred"
            })),
            warp::http::StatusCode::INTERNAL_SERVER_ERROR,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_range_explicit() {
        let (start, end) = parse_range("bytes=0-999", 10000).unwrap();
        assert_eq!(start, 0);
        assert_eq!(end, 999);
    }

    #[test]
    fn test_parse_range_open_end() {
        let (start, end) = parse_range("bytes=5000-", 10000).unwrap();
        assert_eq!(start, 5000);
        assert_eq!(end, 9999);
    }

    #[test]
    fn test_parse_range_suffix() {
        let (start, end) = parse_range("bytes=-500", 10000).unwrap();
        assert_eq!(start, 9500);
        assert_eq!(end, 9999);
    }

    #[test]
    fn test_parse_range_clamps_end() {
        let (start, end) = parse_range("bytes=0-99999", 10000).unwrap();
        assert_eq!(start, 0);
        assert_eq!(end, 9999);
    }

    #[test]
    fn test_parse_range_invalid_prefix() {
        assert!(parse_range("chars=0-100", 10000).is_err());
    }

    #[test]
    fn test_config_default() {
        let config = MediaStreamingConfig::default();
        assert_eq!(config.port, 8087);
    }

    #[test]
    fn test_mime_detection() {
        let mime = mime_guess::from_path("video.mp4")
            .first_or_octet_stream()
            .to_string();
        assert_eq!(mime, "video/mp4");

        let mime = mime_guess::from_path("audio.mp3")
            .first_or_octet_stream()
            .to_string();
        assert_eq!(mime, "audio/mpeg");

        let mime = mime_guess::from_path("video.webm")
            .first_or_octet_stream()
            .to_string();
        assert_eq!(mime, "video/webm");
    }
}
