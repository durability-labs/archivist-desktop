//! Archive Viewer Server
//!
//! Local HTTP server that downloads a web archive ZIP from the node by CID,
//! extracts it to a temp directory, and serves the static files so they can
//! be viewed in an iframe within the app.
//! Follows the same warp pattern as `media_streaming.rs`.

use crate::error::{ArchivistError, Result};
use crate::node_api::NodeApiClient;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use warp::Filter;

/// Status of the archive viewer
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewerStatus {
    pub running: bool,
    pub cid: Option<String>,
    pub url: Option<String>,
}

/// Archive viewer server — downloads, extracts, and serves web archive ZIPs.
pub struct ArchiveViewerServer {
    shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
    running: bool,
    port: u16,
    api_port: u16,
    current_cid: Option<String>,
    extract_dir: Option<PathBuf>,
}

impl ArchiveViewerServer {
    pub fn new(port: u16, api_port: u16) -> Self {
        Self {
            shutdown_tx: None,
            running: false,
            port,
            api_port,
            current_cid: None,
            extract_dir: None,
        }
    }

    /// Open an archive by CID: download ZIP from node, extract, and start server.
    /// Returns the viewer URL pointing to the correct starting page.
    /// If `original_url` is provided, the returned URL will point to the
    /// corresponding path within the archive instead of the root.
    pub async fn open_archive(&mut self, cid: &str, original_url: Option<&str>) -> Result<String> {
        // If already serving a different archive, close the current one first
        if self.running {
            self.close_archive();
        }

        // 1. Download the ZIP from the node
        let temp_dir =
            std::env::temp_dir().join(format!("archivist-viewer-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).map_err(|e| {
            ArchivistError::WebArchiveError(format!("Failed to create temp dir: {}", e))
        })?;

        let zip_path = temp_dir.join("archive.zip");
        let api_client = NodeApiClient::new(self.api_port);
        api_client
            .download_file_to_path(cid, &zip_path)
            .await
            .map_err(|e| {
                ArchivistError::WebArchiveError(format!("Failed to download archive: {}", e))
            })?;

        // 2. Extract the ZIP
        let extract_dir = temp_dir.join("site");
        std::fs::create_dir_all(&extract_dir).map_err(|e| {
            ArchivistError::WebArchiveError(format!("Failed to create extract dir: {}", e))
        })?;

        let zip_path_clone = zip_path.clone();
        let extract_dir_clone = extract_dir.clone();
        tokio::task::spawn_blocking(move || extract_zip(&zip_path_clone, &extract_dir_clone))
            .await
            .map_err(|e| {
                ArchivistError::WebArchiveError(format!("Extract task failed: {}", e))
            })??;

        // Clean up the ZIP file after extraction
        let _ = std::fs::remove_file(&zip_path);

        // 3. Start the warp server
        let serve_dir = extract_dir.clone();
        let port = self.port;

        // Health route
        let health_route = warp::path("health")
            .and(warp::get())
            .map(|| warp::reply::json(&serde_json::json!({"status": "ok"})));

        // Serve static files from the extracted directory
        let static_files = warp::get()
            .and(warp::path::full())
            .and(warp::any().map(move || serve_dir.clone()))
            .and_then(serve_static_file);

        let cors = warp::cors()
            .allow_any_origin()
            .allow_methods(vec!["GET", "HEAD", "OPTIONS"])
            .allow_headers(vec!["Content-Type"]);

        let routes = health_route
            .or(static_files)
            .recover(handle_rejection)
            .with(cors);

        let (tx, rx) = tokio::sync::oneshot::channel();
        self.shutdown_tx = Some(tx);
        self.running = true;
        self.current_cid = Some(cid.to_string());
        self.extract_dir = Some(temp_dir);

        let (_, server) =
            warp::serve(routes).bind_with_graceful_shutdown(([127, 0, 0, 1], port), async {
                rx.await.ok();
            });

        log::info!("Archive viewer server starting on port {}", port);
        tokio::spawn(server);

        let base_url = format!("http://127.0.0.1:{}", port);

        // Compute starting page path from original URL
        if let Some(url_str) = original_url {
            if let Ok(parsed) = url::Url::parse(url_str) {
                let path = parsed.path().trim_start_matches('/');
                if !path.is_empty() {
                    let path = path.trim_end_matches('/');
                    return Ok(format!("{}/{}/index.html", base_url, path));
                }
            }
        }

        Ok(base_url)
    }

    /// Close the archive viewer: stop server and clean up extracted files.
    pub fn close_archive(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
            log::info!("Archive viewer server stopped");
        }
        self.running = false;
        self.current_cid = None;

        // Clean up extracted files
        if let Some(dir) = self.extract_dir.take() {
            if let Err(e) = std::fs::remove_dir_all(&dir) {
                log::warn!("Failed to clean up viewer temp dir: {}", e);
            }
        }
    }

    /// Get the current viewer status.
    pub fn get_status(&self) -> ViewerStatus {
        ViewerStatus {
            running: self.running,
            cid: self.current_cid.clone(),
            url: if self.running {
                Some(format!("http://127.0.0.1:{}", self.port))
            } else {
                None
            },
        }
    }
}

/// Extract a ZIP file to a destination directory.
fn extract_zip(zip_path: &std::path::Path, dest: &std::path::Path) -> Result<()> {
    let file = std::fs::File::open(zip_path)
        .map_err(|e| ArchivistError::WebArchiveError(format!("Failed to open ZIP: {}", e)))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| ArchivistError::WebArchiveError(format!("Failed to read ZIP: {}", e)))?;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| ArchivistError::WebArchiveError(format!("ZIP entry error: {}", e)))?;

        let name = entry.name().to_string();
        // Skip directories and entries with suspicious paths
        if name.ends_with('/') || name.contains("..") {
            continue;
        }

        let out_path = dest.join(&name);

        // Create parent directories
        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                ArchivistError::WebArchiveError(format!("Failed to create dir: {}", e))
            })?;
        }

        let mut out_file = std::fs::File::create(&out_path).map_err(|e| {
            ArchivistError::WebArchiveError(format!("Failed to create file: {}", e))
        })?;

        std::io::copy(&mut entry, &mut out_file).map_err(|e| {
            ArchivistError::WebArchiveError(format!("Failed to extract file: {}", e))
        })?;
    }

    Ok(())
}

/// Serve a static file from the extracted archive directory.
async fn serve_static_file(
    path: warp::path::FullPath,
    base_dir: PathBuf,
) -> std::result::Result<warp::reply::Response, warp::Rejection> {
    let request_path = path.as_str().trim_start_matches('/');

    // Default to index.html for root
    let file_path = if request_path.is_empty() {
        base_dir.join("index.html")
    } else {
        let candidate = base_dir.join(request_path);
        // If the path is a directory or has a nested index.html, serve that
        let index_candidate = candidate.join("index.html");
        if index_candidate.exists() {
            index_candidate
        } else {
            candidate
        }
    };

    // Security: ensure the resolved path is within the base directory
    let canonical_base = base_dir.canonicalize().unwrap_or_else(|_| base_dir.clone());
    if let Ok(canonical_file) = file_path.canonicalize() {
        if !canonical_file.starts_with(&canonical_base) {
            return Err(warp::reject::not_found());
        }
    }

    if !file_path.exists() || !file_path.is_file() {
        return Err(warp::reject::not_found());
    }

    let body = tokio::fs::read(&file_path)
        .await
        .map_err(|_| warp::reject::not_found())?;

    let mime = mime_guess::from_path(&file_path)
        .first_or_octet_stream()
        .to_string();

    let response = warp::http::Response::builder()
        .status(200)
        .header("Content-Type", mime)
        .header("Content-Length", body.len())
        .body(body.into())
        .unwrap();

    Ok(response)
}

/// Handle rejections (404s)
async fn handle_rejection(
    err: warp::Rejection,
) -> std::result::Result<impl warp::Reply, std::convert::Infallible> {
    if err.is_not_found() {
        Ok(warp::reply::with_status(
            warp::reply::json(&serde_json::json!({
                "error": "Not Found",
                "message": "File not found in archive"
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
    fn test_default_not_running() {
        let server = ArchiveViewerServer::new(8088, 8080);
        assert!(!server.running);
        assert!(server.current_cid.is_none());
        assert!(server.extract_dir.is_none());

        let status = server.get_status();
        assert!(!status.running);
        assert!(status.cid.is_none());
        assert!(status.url.is_none());
    }

    #[test]
    fn test_extract_zip_to_dir() {
        use std::io::Write;

        let temp = tempfile::tempdir().unwrap();
        let zip_path = temp.path().join("test.zip");
        let extract_dir = temp.path().join("extracted");
        std::fs::create_dir_all(&extract_dir).unwrap();

        // Create a test ZIP in memory
        {
            let file = std::fs::File::create(&zip_path).unwrap();
            let mut zip = zip::ZipWriter::new(file);
            let options = zip::write::SimpleFileOptions::default();

            zip.start_file("index.html", options).unwrap();
            zip.write_all(b"<html><body>Hello</body></html>").unwrap();

            zip.start_file("css/style.css", options).unwrap();
            zip.write_all(b"body { color: red; }").unwrap();

            zip.start_file("about/index.html", options).unwrap();
            zip.write_all(b"<html><body>About</body></html>").unwrap();

            zip.finish().unwrap();
        }

        // Extract and verify
        extract_zip(&zip_path, &extract_dir).unwrap();

        assert!(extract_dir.join("index.html").exists());
        assert!(extract_dir.join("css/style.css").exists());
        assert!(extract_dir.join("about/index.html").exists());

        let content = std::fs::read_to_string(extract_dir.join("index.html")).unwrap();
        assert!(content.contains("Hello"));

        let css = std::fs::read_to_string(extract_dir.join("css/style.css")).unwrap();
        assert!(css.contains("color: red"));
    }

    #[test]
    fn test_mime_detection() {
        let html_mime = mime_guess::from_path("page.html")
            .first_or_octet_stream()
            .to_string();
        assert_eq!(html_mime, "text/html");

        let css_mime = mime_guess::from_path("style.css")
            .first_or_octet_stream()
            .to_string();
        assert_eq!(css_mime, "text/css");

        let js_mime = mime_guess::from_path("app.js")
            .first_or_octet_stream()
            .to_string();
        assert_eq!(js_mime, "text/javascript");

        let png_mime = mime_guess::from_path("logo.png")
            .first_or_octet_stream()
            .to_string();
        assert_eq!(png_mime, "image/png");
    }

    #[test]
    fn test_cleanup_on_close() {
        let temp = tempfile::tempdir().unwrap();
        let viewer_dir = temp.path().join("archivist-viewer-test");
        std::fs::create_dir_all(&viewer_dir).unwrap();

        // Write a dummy file
        std::fs::write(viewer_dir.join("test.txt"), "hello").unwrap();
        assert!(viewer_dir.exists());

        let mut server = ArchiveViewerServer::new(8088, 8080);
        server.extract_dir = Some(viewer_dir.clone());
        server.running = false; // no actual server to shut down
        server.close_archive();

        assert!(!viewer_dir.exists());
    }

    #[test]
    fn test_extract_zip_skips_path_traversal() {
        use std::io::Write;

        let temp = tempfile::tempdir().unwrap();
        let zip_path = temp.path().join("evil.zip");
        let extract_dir = temp.path().join("extracted");
        std::fs::create_dir_all(&extract_dir).unwrap();

        // Create a ZIP with a path traversal entry
        {
            let file = std::fs::File::create(&zip_path).unwrap();
            let mut zip = zip::ZipWriter::new(file);
            let options = zip::write::SimpleFileOptions::default();

            zip.start_file("index.html", options).unwrap();
            zip.write_all(b"<html>safe</html>").unwrap();

            zip.start_file("../../../etc/evil.txt", options).unwrap();
            zip.write_all(b"evil content").unwrap();

            zip.finish().unwrap();
        }

        extract_zip(&zip_path, &extract_dir).unwrap();

        // Safe file should exist
        assert!(extract_dir.join("index.html").exists());
        // Evil file should NOT have been created outside
        assert!(!temp.path().join("etc/evil.txt").exists());
    }
}
