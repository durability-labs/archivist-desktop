use crate::error::{ArchivistError, Result};
use crate::node_api::NodeApiClient;
use chrono::{DateTime, Utc};
use regex::Regex;
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::watch;
use url::Url;
use uuid::Uuid;

/// State machine for an archive task
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ArchiveState {
    Queued,
    Crawling,
    Downloading,
    Packaging,
    Uploading,
    Completed,
    Failed,
    Cancelled,
    Paused,
}

/// Options for a web archive task
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveOptions {
    pub url: String,
    pub max_depth: u32,
    pub max_pages: u32,
    pub include_assets: bool,
    pub request_delay_ms: u64,
    #[serde(default)]
    pub single_page: bool,
    #[serde(default)]
    pub user_agent: Option<String>,
    #[serde(default)]
    pub custom_headers: Option<HashMap<String, String>>,
    #[serde(default)]
    pub exclude_patterns: Option<Vec<String>>,
}

/// A tracked archive task in the queue
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveTask {
    pub id: String,
    pub url: String,
    pub title: Option<String>,
    pub state: ArchiveState,
    pub pages_found: u32,
    pub pages_downloaded: u32,
    pub assets_downloaded: u32,
    pub total_bytes: u64,
    pub bytes_per_second: f64,
    pub eta_seconds: Option<u64>,
    pub cid: Option<String>,
    pub error: Option<String>,
    pub created_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub options: ArchiveOptions,
}

/// A completed archived site stored in node
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchivedSite {
    pub cid: String,
    pub url: String,
    pub title: Option<String>,
    pub pages_count: u32,
    pub assets_count: u32,
    pub total_bytes: u64,
    pub archived_at: DateTime<Utc>,
}

/// Queue state returned to frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveQueueState {
    pub tasks: Vec<ArchiveTask>,
    pub active_count: u32,
    pub queued_count: u32,
    pub completed_count: u32,
    pub paused_count: u32,
    pub max_concurrent: u32,
    pub archived_sites: Vec<ArchivedSite>,
}

/// Rolling window speed tracker for bytes/second and ETA
struct SpeedTracker {
    samples: VecDeque<(std::time::Instant, u64)>,
    window: std::time::Duration,
}

impl SpeedTracker {
    fn new(window_secs: u64) -> Self {
        Self {
            samples: VecDeque::new(),
            window: std::time::Duration::from_secs(window_secs),
        }
    }

    fn record(&mut self, total_bytes: u64) {
        let now = std::time::Instant::now();
        self.samples.push_back((now, total_bytes));
        // Prune old samples outside the window
        while let Some(&(t, _)) = self.samples.front() {
            if now.duration_since(t) > self.window {
                self.samples.pop_front();
            } else {
                break;
            }
        }
    }

    fn bytes_per_second(&self) -> f64 {
        if self.samples.len() < 2 {
            return 0.0;
        }
        let first = self.samples.front().unwrap();
        let last = self.samples.back().unwrap();
        let elapsed = last.0.duration_since(first.0).as_secs_f64();
        if elapsed < 0.001 {
            return 0.0;
        }
        let bytes_diff = last.1.saturating_sub(first.1);
        bytes_diff as f64 / elapsed
    }

    #[cfg(test)]
    fn eta_seconds(&self, estimated_total: u64) -> Option<u64> {
        let bps = self.bytes_per_second();
        if bps < 1.0 {
            return None;
        }
        let current = self.samples.back().map(|s| s.1).unwrap_or(0);
        if current >= estimated_total {
            return Some(0);
        }
        let remaining = estimated_total - current;
        Some((remaining as f64 / bps) as u64)
    }
}

/// Core service for web archiving
pub struct WebArchiveService {
    tasks: HashMap<String, ArchiveTask>,
    task_order: Vec<String>,
    archived_sites: Vec<ArchivedSite>,
    cancel_tokens: HashMap<String, watch::Sender<bool>>,
    pause_tokens: HashMap<String, watch::Sender<bool>>,
    max_concurrent: u32,
    api_port: u16,
    history_path: Option<PathBuf>,
}

impl WebArchiveService {
    #[cfg(test)]
    pub fn new(max_concurrent: u32, api_port: u16) -> Self {
        Self {
            tasks: HashMap::new(),
            task_order: Vec::new(),
            archived_sites: Vec::new(),
            cancel_tokens: HashMap::new(),
            pause_tokens: HashMap::new(),
            max_concurrent,
            api_port,
            history_path: None,
        }
    }

    pub fn with_history(max_concurrent: u32, api_port: u16, data_dir: PathBuf) -> Self {
        let history_path = data_dir.join("web-archive-history.json");
        let archived_sites = load_history(&history_path).unwrap_or_default();
        Self {
            tasks: HashMap::new(),
            task_order: Vec::new(),
            archived_sites,
            cancel_tokens: HashMap::new(),
            pause_tokens: HashMap::new(),
            max_concurrent,
            api_port,
            history_path: Some(history_path),
        }
    }

    fn save_history(&self) {
        if let Some(ref path) = self.history_path {
            if let Ok(json) = serde_json::to_string_pretty(&self.archived_sites) {
                if let Err(e) = std::fs::write(path, json) {
                    log::warn!("Failed to save web archive history: {}", e);
                }
            }
        }
    }

    /// Queue a new archive task, returns the task ID
    pub fn queue_archive(&mut self, options: ArchiveOptions) -> Result<String> {
        let id = Uuid::new_v4().to_string();
        let task = ArchiveTask {
            id: id.clone(),
            url: options.url.clone(),
            title: None,
            state: ArchiveState::Queued,
            pages_found: 0,
            pages_downloaded: 0,
            assets_downloaded: 0,
            total_bytes: 0,
            bytes_per_second: 0.0,
            eta_seconds: None,
            cid: None,
            error: None,
            created_at: Utc::now(),
            completed_at: None,
            options,
        };
        self.task_order.push(id.clone());
        self.tasks.insert(id.clone(), task);
        Ok(id)
    }

    /// Get the current queue state
    pub fn get_queue_state(&self) -> ArchiveQueueState {
        let tasks: Vec<ArchiveTask> = self
            .task_order
            .iter()
            .filter_map(|id| self.tasks.get(id).cloned())
            .collect();

        let active_count = tasks
            .iter()
            .filter(|t| {
                matches!(
                    t.state,
                    ArchiveState::Crawling
                        | ArchiveState::Downloading
                        | ArchiveState::Packaging
                        | ArchiveState::Uploading
                )
            })
            .count() as u32;

        let queued_count = tasks
            .iter()
            .filter(|t| t.state == ArchiveState::Queued)
            .count() as u32;

        let completed_count = tasks
            .iter()
            .filter(|t| t.state == ArchiveState::Completed)
            .count() as u32;

        let paused_count = tasks
            .iter()
            .filter(|t| t.state == ArchiveState::Paused)
            .count() as u32;

        ArchiveQueueState {
            tasks,
            active_count,
            queued_count,
            completed_count,
            paused_count,
            max_concurrent: self.max_concurrent,
            archived_sites: self.archived_sites.clone(),
        }
    }

    /// Cancel an active archive task
    pub fn cancel_archive(&mut self, task_id: &str) -> Result<()> {
        if let Some(sender) = self.cancel_tokens.get(task_id) {
            let _ = sender.send(true);
        }

        if let Some(task) = self.tasks.get_mut(task_id) {
            match task.state {
                ArchiveState::Queued
                | ArchiveState::Crawling
                | ArchiveState::Downloading
                | ArchiveState::Packaging
                | ArchiveState::Uploading
                | ArchiveState::Paused => {
                    task.state = ArchiveState::Cancelled;
                    task.completed_at = Some(Utc::now());
                    Ok(())
                }
                _ => Err(ArchivistError::WebArchiveError(
                    "Task is not in a cancellable state".to_string(),
                )),
            }
        } else {
            Err(ArchivistError::WebArchiveError(
                "Task not found".to_string(),
            ))
        }
    }

    /// Pause an active archive task
    pub fn pause_archive(&mut self, task_id: &str) -> Result<()> {
        if let Some(task) = self.tasks.get_mut(task_id) {
            match task.state {
                ArchiveState::Crawling | ArchiveState::Downloading => {
                    if let Some(sender) = self.pause_tokens.get(task_id) {
                        let _ = sender.send(true);
                    }
                    task.state = ArchiveState::Paused;
                    Ok(())
                }
                _ => Err(ArchivistError::WebArchiveError(
                    "Task is not in a pausable state".to_string(),
                )),
            }
        } else {
            Err(ArchivistError::WebArchiveError(
                "Task not found".to_string(),
            ))
        }
    }

    /// Resume a paused archive task
    pub fn resume_archive(&mut self, task_id: &str) -> Result<()> {
        if let Some(task) = self.tasks.get_mut(task_id) {
            if task.state == ArchiveState::Paused {
                if let Some(sender) = self.pause_tokens.get(task_id) {
                    let _ = sender.send(false);
                }
                // Restore to crawling (the pipeline will determine actual phase)
                task.state = ArchiveState::Crawling;
                Ok(())
            } else {
                Err(ArchivistError::WebArchiveError(
                    "Task is not paused".to_string(),
                ))
            }
        } else {
            Err(ArchivistError::WebArchiveError(
                "Task not found".to_string(),
            ))
        }
    }

    /// Remove a completed/failed/cancelled task
    pub fn remove_task(&mut self, task_id: &str) -> Result<()> {
        if let Some(task) = self.tasks.get(task_id) {
            match task.state {
                ArchiveState::Completed | ArchiveState::Failed | ArchiveState::Cancelled => {
                    self.tasks.remove(task_id);
                    self.task_order.retain(|id| id != task_id);
                    self.cancel_tokens.remove(task_id);
                    self.pause_tokens.remove(task_id);
                    Ok(())
                }
                _ => Err(ArchivistError::WebArchiveError(
                    "Can only remove completed, failed, or cancelled tasks".to_string(),
                )),
            }
        } else {
            Err(ArchivistError::WebArchiveError(
                "Task not found".to_string(),
            ))
        }
    }

    /// Clear all completed tasks
    pub fn clear_completed(&mut self) {
        let completed_ids: Vec<String> = self
            .tasks
            .iter()
            .filter(|(_, t)| {
                matches!(
                    t.state,
                    ArchiveState::Completed | ArchiveState::Failed | ArchiveState::Cancelled
                )
            })
            .map(|(id, _)| id.clone())
            .collect();

        for id in &completed_ids {
            self.tasks.remove(id);
            self.cancel_tokens.remove(id);
            self.pause_tokens.remove(id);
        }
        self.task_order.retain(|id| !completed_ids.contains(id));
    }

    /// Get archived sites list
    pub fn get_archived_sites(&self) -> Vec<ArchivedSite> {
        self.archived_sites.clone()
    }
}

/// Load history from disk
fn load_history(path: &PathBuf) -> Result<Vec<ArchivedSite>> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let data = std::fs::read_to_string(path)
        .map_err(|e| ArchivistError::WebArchiveError(format!("Failed to read history: {}", e)))?;
    serde_json::from_str(&data)
        .map_err(|e| ArchivistError::WebArchiveError(format!("Failed to parse history: {}", e)))
}

/// Process the queue — called from the background loop in lib.rs.
/// Takes the Arc so spawned tasks can write back results directly.
pub async fn process_queue(
    service: &Arc<tokio::sync::RwLock<WebArchiveService>>,
    app_handle: &AppHandle,
) {
    let mut svc = service.write().await;

    let active_count = svc
        .tasks
        .values()
        .filter(|t| {
            matches!(
                t.state,
                ArchiveState::Crawling
                    | ArchiveState::Downloading
                    | ArchiveState::Packaging
                    | ArchiveState::Uploading
                    | ArchiveState::Paused
            )
        })
        .count() as u32;

    if active_count >= svc.max_concurrent {
        return;
    }

    let slots = svc.max_concurrent - active_count;
    let queued_ids: Vec<String> = svc
        .task_order
        .iter()
        .filter(|id| {
            svc.tasks
                .get(*id)
                .map(|t| t.state == ArchiveState::Queued)
                .unwrap_or(false)
        })
        .take(slots as usize)
        .cloned()
        .collect();

    for task_id in queued_ids {
        let task = match svc.tasks.get_mut(&task_id) {
            Some(t) => {
                t.state = ArchiveState::Crawling;
                t.clone()
            }
            None => continue,
        };

        let (cancel_tx, cancel_rx) = watch::channel(false);
        let (pause_tx, pause_rx) = watch::channel(false);
        svc.cancel_tokens.insert(task_id.clone(), cancel_tx);
        svc.pause_tokens.insert(task_id.clone(), pause_tx);

        let app_handle = app_handle.clone();
        let api_port = svc.api_port;
        let service_clone = service.clone();

        // Emit initial state change
        let _ = app_handle.emit(
            "web-archive-state-changed",
            serde_json::json!({
                "taskId": task.id,
                "state": "crawling",
            }),
        );

        tokio::spawn(async move {
            let result = run_archive_pipeline(
                task.clone(),
                cancel_rx,
                pause_rx,
                app_handle.clone(),
                api_port,
                &service_clone,
            )
            .await;

            let mut svc = service_clone.write().await;
            match result {
                Ok((cid, title, pages, assets, bytes)) => {
                    if let Some(t) = svc.tasks.get_mut(&task.id) {
                        t.state = ArchiveState::Completed;
                        t.cid = Some(cid.clone());
                        t.title = title.clone();
                        t.pages_downloaded = pages;
                        t.assets_downloaded = assets;
                        t.total_bytes = bytes;
                        t.completed_at = Some(Utc::now());
                    }

                    let url = svc
                        .tasks
                        .get(&task.id)
                        .map(|t| t.url.clone())
                        .unwrap_or_default();

                    svc.archived_sites.push(ArchivedSite {
                        cid: cid.clone(),
                        url,
                        title: title.clone(),
                        pages_count: pages,
                        assets_count: assets,
                        total_bytes: bytes,
                        archived_at: Utc::now(),
                    });

                    svc.save_history();

                    let _ = app_handle.emit(
                        "web-archive-state-changed",
                        serde_json::json!({
                            "taskId": task.id,
                            "state": "completed",
                            "cid": cid,
                        }),
                    );
                }
                Err(e) => {
                    let error_msg = e.to_string();
                    if error_msg.contains("cancelled") {
                        if let Some(t) = svc.tasks.get_mut(&task.id) {
                            t.state = ArchiveState::Cancelled;
                            t.completed_at = Some(Utc::now());
                        }
                        let _ = app_handle.emit(
                            "web-archive-state-changed",
                            serde_json::json!({
                                "taskId": task.id,
                                "state": "cancelled",
                            }),
                        );
                    } else {
                        if let Some(t) = svc.tasks.get_mut(&task.id) {
                            t.state = ArchiveState::Failed;
                            t.error = Some(error_msg.clone());
                            t.completed_at = Some(Utc::now());
                        }
                        let _ = app_handle.emit(
                            "web-archive-state-changed",
                            serde_json::json!({
                                "taskId": task.id,
                                "state": "failed",
                                "error": error_msg,
                            }),
                        );
                    }
                }
            }
        });
    }
}

/// A crawled page with its content and extracted links
#[derive(Clone)]
struct CrawledPage {
    url: Url,
    html: String,
    #[allow(dead_code)]
    title: Option<String>,
}

/// An asset (CSS, JS, image, font) to download
struct AssetRef {
    url: Url,
    relative_path: String,
}

/// Check if a URL has the same origin as the root
fn is_same_origin(root: &Url, candidate: &Url) -> bool {
    root.scheme() == candidate.scheme()
        && root.host() == candidate.host()
        && root.port() == candidate.port()
}

/// Transform URL for better archival (e.g., Reddit → old.reddit.com)
fn transform_url_for_archival(url: &Url) -> Url {
    if matches!(url.host_str(), Some("www.reddit.com") | Some("reddit.com")) {
        let mut t = url.clone();
        let _ = t.set_host(Some("old.reddit.com"));
        return t;
    }
    url.clone()
}

/// Check if a URL should be crawled based on exclude patterns
fn should_crawl_url(url: &Url, exclude_patterns: &[Regex]) -> bool {
    let url_str = url.as_str();
    !exclude_patterns.iter().any(|p| p.is_match(url_str))
}

/// Convert a URL to a relative file path for the archive
fn url_to_path(base: &Url, page_url: &Url) -> String {
    let path = page_url.path();
    let path = path.strip_prefix('/').unwrap_or(path);

    if path.is_empty() || path == "/" {
        return "index.html".to_string();
    }

    let mut result = path.to_string();

    // If path ends with / or has no extension, add index.html
    if result.ends_with('/') {
        result.push_str("index.html");
    } else if !result.contains('.') || result.ends_with('/') {
        result.push_str("/index.html");
    }

    // Remove leading slash
    let _ = base; // base used for context only

    // Sanitize each path component for Windows compatibility
    crate::path_utils::sanitize_path_for_archive(&result)
}

/// Extract links from HTML
fn extract_links(html: &str, page_url: &Url) -> Vec<Url> {
    let document = Html::parse_document(html);
    let selector = Selector::parse("a[href]").unwrap();
    let mut links = Vec::new();

    for element in document.select(&selector) {
        if let Some(href) = element.value().attr("href") {
            // Skip fragments, javascript:, mailto:, etc.
            if href.starts_with('#')
                || href.starts_with("javascript:")
                || href.starts_with("mailto:")
                || href.starts_with("tel:")
                || href.starts_with("data:")
            {
                continue;
            }

            if let Ok(resolved) = page_url.join(href) {
                // Remove fragment
                let mut clean = resolved;
                clean.set_fragment(None);
                links.push(clean);
            }
        }
    }

    links
}

/// Extract asset references (CSS, JS, images, fonts, favicons) from HTML
fn extract_assets(html: &str, page_url: &Url) -> Vec<AssetRef> {
    let document = Html::parse_document(html);
    let mut assets = Vec::new();

    // CSS links
    if let Ok(sel) = Selector::parse("link[rel='stylesheet'][href]") {
        for el in document.select(&sel) {
            if let Some(href) = el.value().attr("href") {
                if let Ok(url) = page_url.join(href) {
                    let path = asset_url_to_path(&url);
                    assets.push(AssetRef {
                        url,
                        relative_path: path,
                    });
                }
            }
        }
    }

    // Scripts
    if let Ok(sel) = Selector::parse("script[src]") {
        for el in document.select(&sel) {
            if let Some(src) = el.value().attr("src") {
                if let Ok(url) = page_url.join(src) {
                    let path = asset_url_to_path(&url);
                    assets.push(AssetRef {
                        url,
                        relative_path: path,
                    });
                }
            }
        }
    }

    // Images
    if let Ok(sel) = Selector::parse("img[src]") {
        for el in document.select(&sel) {
            if let Some(src) = el.value().attr("src") {
                if src.starts_with("data:") {
                    continue;
                }
                if let Ok(url) = page_url.join(src) {
                    let path = asset_url_to_path(&url);
                    assets.push(AssetRef {
                        url,
                        relative_path: path,
                    });
                }
            }
        }
    }

    // Favicons
    if let Ok(sel) = Selector::parse("link[rel~='icon'][href], link[rel='shortcut icon'][href]") {
        for el in document.select(&sel) {
            if let Some(href) = el.value().attr("href") {
                if let Ok(url) = page_url.join(href) {
                    let path = asset_url_to_path(&url);
                    assets.push(AssetRef {
                        url,
                        relative_path: path,
                    });
                }
            }
        }
    }

    assets
}

/// Extract CSS url() references and return them as asset refs
fn extract_css_urls(css: &str, css_url: &Url) -> Vec<AssetRef> {
    let re = Regex::new(r#"url\(\s*['"]?([^'")\s]+)['"]?\s*\)"#).unwrap();
    let mut assets = Vec::new();

    for cap in re.captures_iter(css) {
        let url_str = &cap[1];
        // Skip data: URIs
        if url_str.starts_with("data:") {
            continue;
        }
        if let Ok(resolved) = css_url.join(url_str) {
            let path = asset_url_to_path(&resolved);
            assets.push(AssetRef {
                url: resolved,
                relative_path: path,
            });
        }
    }

    assets
}

/// Rewrite CSS url() values to use relative paths
fn rewrite_css_urls(css: &str, css_url: &Url, _root_url: &Url) -> String {
    let re = Regex::new(r#"url\(\s*['"]?([^'")\s]+)['"]?\s*\)"#).unwrap();
    let css_path = asset_url_to_path(css_url);

    re.replace_all(css, |caps: &regex::Captures| {
        let url_str = &caps[1];
        if url_str.starts_with("data:") {
            return caps[0].to_string();
        }
        if let Ok(resolved) = css_url.join(url_str) {
            let asset_path = asset_url_to_path(&resolved);
            let relative = compute_relative_path(&css_path, &asset_path);
            format!("url(\"{}\")", relative)
        } else {
            caps[0].to_string()
        }
    })
    .to_string()
}

/// Convert an asset URL to a relative path
fn asset_url_to_path(url: &Url) -> String {
    let path = url.path();
    let path = path.strip_prefix('/').unwrap_or(path);
    if path.is_empty() {
        "assets/unknown".to_string()
    } else {
        crate::path_utils::sanitize_path_for_archive(path)
    }
}

/// Extract the page title from HTML
fn extract_title(html: &str) -> Option<String> {
    let document = Html::parse_document(html);
    let selector = Selector::parse("title").ok()?;
    document
        .select(&selector)
        .next()
        .map(|el| el.text().collect::<String>().trim().to_string())
        .filter(|t| !t.is_empty())
}

/// Rewrite HTML references (links + asset refs) to use relative paths.
/// Uses attribute-level replacement (`href="old"` → `href="new"`) to avoid
/// corrupting other parts of the HTML that happen to contain the same text.
fn rewrite_html_refs(html: &str, page_url: &Url, root_url: &Url) -> String {
    let mut result = html.to_string();

    let document = Html::parse_document(html);

    // Rewrite <a href>
    let link_sel = Selector::parse("a[href]").unwrap();
    for el in document.select(&link_sel) {
        if let Some(href) = el.value().attr("href") {
            if let Ok(resolved) = page_url.join(href) {
                if is_same_origin(root_url, &resolved) {
                    let rel_path = url_to_path(root_url, &resolved);
                    let current_path = url_to_path(root_url, page_url);
                    let relative = compute_relative_path(&current_path, &rel_path);
                    let old_attr = format!("href=\"{}\"", href);
                    let new_attr = format!("href=\"{}\"", relative);
                    result = result.replacen(&old_attr, &new_attr, 1);
                }
            }
        }
    }

    // Rewrite <link rel="stylesheet" href>
    if let Ok(sel) = Selector::parse("link[rel='stylesheet'][href]") {
        for el in document.select(&sel) {
            if let Some(href) = el.value().attr("href") {
                if let Ok(resolved) = page_url.join(href) {
                    let asset_path = asset_url_to_path(&resolved);
                    let current_path = url_to_path(root_url, page_url);
                    let relative = compute_relative_path(&current_path, &asset_path);
                    let old_attr = format!("href=\"{}\"", href);
                    let new_attr = format!("href=\"{}\"", relative);
                    result = result.replacen(&old_attr, &new_attr, 1);
                }
            }
        }
    }

    // Rewrite <script src>
    if let Ok(sel) = Selector::parse("script[src]") {
        for el in document.select(&sel) {
            if let Some(src) = el.value().attr("src") {
                if let Ok(resolved) = page_url.join(src) {
                    let asset_path = asset_url_to_path(&resolved);
                    let current_path = url_to_path(root_url, page_url);
                    let relative = compute_relative_path(&current_path, &asset_path);
                    let old_attr = format!("src=\"{}\"", src);
                    let new_attr = format!("src=\"{}\"", relative);
                    result = result.replacen(&old_attr, &new_attr, 1);
                }
            }
        }
    }

    // Rewrite <img src>
    if let Ok(sel) = Selector::parse("img[src]") {
        for el in document.select(&sel) {
            if let Some(src) = el.value().attr("src") {
                if src.starts_with("data:") {
                    continue;
                }
                if let Ok(resolved) = page_url.join(src) {
                    let asset_path = asset_url_to_path(&resolved);
                    let current_path = url_to_path(root_url, page_url);
                    let relative = compute_relative_path(&current_path, &asset_path);
                    let old_attr = format!("src=\"{}\"", src);
                    let new_attr = format!("src=\"{}\"", relative);
                    result = result.replacen(&old_attr, &new_attr, 1);
                }
            }
        }
    }

    // Rewrite <link rel="icon" href>
    if let Ok(sel) = Selector::parse("link[rel~='icon'][href], link[rel='shortcut icon'][href]") {
        for el in document.select(&sel) {
            if let Some(href) = el.value().attr("href") {
                if let Ok(resolved) = page_url.join(href) {
                    let asset_path = asset_url_to_path(&resolved);
                    let current_path = url_to_path(root_url, page_url);
                    let relative = compute_relative_path(&current_path, &asset_path);
                    let old_attr = format!("href=\"{}\"", href);
                    let new_attr = format!("href=\"{}\"", relative);
                    result = result.replacen(&old_attr, &new_attr, 1);
                }
            }
        }
    }

    result
}

/// Compute a relative path from one file to another
fn compute_relative_path(from: &str, to: &str) -> String {
    // Simple approach: count depth of 'from' and prepend ../
    let from_parts: Vec<&str> = from.split('/').collect();
    let to_parts: Vec<&str> = to.split('/').collect();

    // Go up from 'from' directory (not including the filename)
    let up_count = if from_parts.len() > 1 {
        from_parts.len() - 1
    } else {
        0
    };

    let mut result = String::new();
    for _ in 0..up_count {
        result.push_str("../");
    }
    result.push_str(&to_parts.join("/"));

    if result.is_empty() {
        to.to_string()
    } else {
        result
    }
}

/// Normalize a URL for deduplication by stripping trailing slashes.
/// This prevents `/path/` and `/path` from being treated as separate pages
/// (both map to the same file path in the archive).
fn normalize_url_for_dedup(url: &Url) -> String {
    let s = url.to_string();
    if s.ends_with('/') && s.len() > 1 {
        s[..s.len() - 1].to_string()
    } else {
        s
    }
}

/// Wait while paused, checking cancel. Returns true if cancelled.
async fn wait_while_paused(
    cancel_rx: &watch::Receiver<bool>,
    pause_rx: &watch::Receiver<bool>,
) -> bool {
    while *pause_rx.borrow() {
        if *cancel_rx.borrow() {
            return true;
        }
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
    }
    *cancel_rx.borrow()
}

/// The main archive pipeline — runs in a tokio task
async fn run_archive_pipeline(
    task: ArchiveTask,
    cancel_rx: watch::Receiver<bool>,
    pause_rx: watch::Receiver<bool>,
    app_handle: AppHandle,
    api_port: u16,
    service: &Arc<tokio::sync::RwLock<WebArchiveService>>,
) -> Result<(String, Option<String>, u32, u32, u64)> {
    let mut root_url = Url::parse(&task.url)
        .map_err(|e| ArchivistError::WebArchiveError(format!("Invalid URL: {}", e)))?;

    // Transform URLs for better archival (e.g., Reddit → old.reddit.com)
    root_url = transform_url_for_archival(&root_url);

    // Apply single_page overrides
    let effective_max_depth = if task.options.single_page {
        0
    } else {
        task.options.max_depth
    };
    let effective_max_pages = if task.options.single_page {
        1
    } else {
        task.options.max_pages
    };

    // Compile exclude patterns
    let exclude_patterns: Vec<Regex> = task
        .options
        .exclude_patterns
        .as_ref()
        .map(|patterns| patterns.iter().filter_map(|p| Regex::new(p).ok()).collect())
        .unwrap_or_default();

    // Build HTTP client with custom UA and headers
    let user_agent = task
        .options
        .user_agent
        .clone()
        .unwrap_or_else(|| "Mozilla/5.0 (compatible; ArchivistBot/1.0)".to_string());

    let mut default_headers = reqwest::header::HeaderMap::new();
    if let Some(custom) = &task.options.custom_headers {
        for (k, v) in custom {
            if let (Ok(name), Ok(val)) = (
                reqwest::header::HeaderName::from_bytes(k.as_bytes()),
                reqwest::header::HeaderValue::from_str(v),
            ) {
                default_headers.insert(name, val);
            }
        }
    }

    let client = reqwest::Client::builder()
        .user_agent(user_agent)
        .default_headers(default_headers)
        .timeout(std::time::Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| ArchivistError::WebArchiveError(format!("HTTP client error: {}", e)))?;

    let mut speed_tracker = SpeedTracker::new(10);

    // Phase 1: BFS Crawl
    let mut visited: HashSet<String> = HashSet::new();
    let mut queue: VecDeque<(Url, u32)> = VecDeque::new();
    let mut pages: Vec<CrawledPage> = Vec::new();
    let mut site_title: Option<String> = None;

    queue.push_back((root_url.clone(), 0));
    visited.insert(normalize_url_for_dedup(&root_url));

    while let Some((url, depth)) = queue.pop_front() {
        // Check pause/cancellation
        if wait_while_paused(&cancel_rx, &pause_rx).await {
            return Err(ArchivistError::WebArchiveError("cancelled".to_string()));
        }
        if *cancel_rx.borrow() {
            return Err(ArchivistError::WebArchiveError("cancelled".to_string()));
        }

        // Check max pages
        if pages.len() >= effective_max_pages as usize {
            break;
        }

        // Fetch the page
        let response = match client.get(url.as_str()).send().await {
            Ok(r) => r,
            Err(e) => {
                log::warn!("Failed to fetch {}: {}", url, e);
                continue;
            }
        };

        // Only process HTML pages
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();

        if !content_type.contains("text/html") {
            continue;
        }

        let html = match response.text().await {
            Ok(t) => t,
            Err(e) => {
                log::warn!("Failed to read body from {}: {}", url, e);
                continue;
            }
        };

        let title = extract_title(&html);
        if site_title.is_none() {
            site_title = title.clone();
        }

        pages.push(CrawledPage {
            url: url.clone(),
            html,
            title,
        });

        // Extract and enqueue links (only if we haven't hit max depth)
        if depth < effective_max_depth {
            let links = extract_links(&pages.last().unwrap().html, &url);
            for link in links {
                let link_str = normalize_url_for_dedup(&link);
                if !visited.contains(&link_str)
                    && is_same_origin(&root_url, &link)
                    && should_crawl_url(&link, &exclude_patterns)
                {
                    visited.insert(link_str);
                    queue.push_back((link, depth + 1));
                }
            }
        }

        // Update progress in service and emit to frontend
        // NOTE: This must come AFTER link extraction so visited.len() reflects
        // the fully-updated count and the progress bar never jumps backwards.
        {
            let mut svc = service.write().await;
            if let Some(t) = svc.tasks.get_mut(&task.id) {
                t.pages_found = visited.len() as u32;
                t.pages_downloaded = pages.len() as u32;
            }
        }
        let _ = app_handle.emit(
            "web-archive-progress",
            serde_json::json!({
                "taskId": task.id,
                "pagesFound": visited.len(),
                "pagesDownloaded": pages.len(),
                "assetsDownloaded": 0,
                "totalBytes": 0u64,
                "bytesPerSecond": 0.0,
                "etaSeconds": serde_json::Value::Null,
            }),
        );

        // Polite delay
        if task.options.request_delay_ms > 0 {
            tokio::time::sleep(tokio::time::Duration::from_millis(
                task.options.request_delay_ms,
            ))
            .await;
        }
    }

    if pages.is_empty() {
        return Err(ArchivistError::WebArchiveError(
            "No pages could be crawled".to_string(),
        ));
    }

    // Check cancellation
    if *cancel_rx.borrow() {
        return Err(ArchivistError::WebArchiveError("cancelled".to_string()));
    }

    // Phase 2: Download assets
    {
        let mut svc = service.write().await;
        if let Some(t) = svc.tasks.get_mut(&task.id) {
            t.state = ArchiveState::Downloading;
        }
    }
    let _ = app_handle.emit(
        "web-archive-state-changed",
        serde_json::json!({
            "taskId": task.id,
            "state": "downloading",
        }),
    );

    let mut asset_files: Vec<(String, Vec<u8>)> = Vec::new();
    let mut downloaded_asset_urls: HashSet<String> = HashSet::new();
    let mut total_bytes: u64 = 0;

    if task.options.include_assets {
        // Pass 1: collect all assets from HTML pages
        let mut all_assets: Vec<AssetRef> = Vec::new();
        for page in &pages {
            all_assets.extend(extract_assets(&page.html, &page.url));
        }

        // Download initial assets (CSS, JS, images, favicons)
        let mut css_assets: Vec<(String, Vec<u8>, Url)> = Vec::new();
        for asset in &all_assets {
            if wait_while_paused(&cancel_rx, &pause_rx).await {
                return Err(ArchivistError::WebArchiveError("cancelled".to_string()));
            }
            if *cancel_rx.borrow() {
                return Err(ArchivistError::WebArchiveError("cancelled".to_string()));
            }

            let asset_url_str = asset.url.to_string();
            if downloaded_asset_urls.contains(&asset_url_str) {
                continue;
            }
            downloaded_asset_urls.insert(asset_url_str);

            match client.get(asset.url.as_str()).send().await {
                Ok(resp) => {
                    if resp.status().is_success() {
                        let is_css = resp
                            .headers()
                            .get("content-type")
                            .and_then(|v| v.to_str().ok())
                            .map(|ct| ct.contains("text/css"))
                            .unwrap_or(false)
                            || asset.relative_path.ends_with(".css");

                        if let Ok(bytes) = resp.bytes().await {
                            total_bytes += bytes.len() as u64;
                            speed_tracker.record(total_bytes);

                            if is_css {
                                css_assets.push((
                                    asset.relative_path.clone(),
                                    bytes.to_vec(),
                                    asset.url.clone(),
                                ));
                            }

                            asset_files.push((asset.relative_path.clone(), bytes.to_vec()));

                            let bps = speed_tracker.bytes_per_second();
                            let _ = app_handle.emit(
                                "web-archive-progress",
                                serde_json::json!({
                                    "taskId": task.id,
                                    "pagesFound": visited.len(),
                                    "pagesDownloaded": pages.len(),
                                    "assetsDownloaded": asset_files.len(),
                                    "totalBytes": total_bytes,
                                    "bytesPerSecond": bps,
                                    "etaSeconds": serde_json::Value::Null,
                                }),
                            );

                            // Update speed in service
                            {
                                let mut svc = service.write().await;
                                if let Some(t) = svc.tasks.get_mut(&task.id) {
                                    t.bytes_per_second = bps;
                                    t.total_bytes = total_bytes;
                                    t.assets_downloaded = asset_files.len() as u32;
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    log::warn!("Failed to download asset {}: {}", asset.url, e);
                }
            }

            // Small delay between asset downloads
            if task.options.request_delay_ms > 0 {
                tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
            }
        }

        // Pass 2: extract and download CSS sub-assets (url() references)
        let mut css_sub_assets: Vec<AssetRef> = Vec::new();
        for (_, css_bytes, css_url) in &css_assets {
            if let Ok(css_text) = std::str::from_utf8(css_bytes) {
                css_sub_assets.extend(extract_css_urls(css_text, css_url));
            }
        }

        for asset in &css_sub_assets {
            if *cancel_rx.borrow() {
                return Err(ArchivistError::WebArchiveError("cancelled".to_string()));
            }

            let asset_url_str = asset.url.to_string();
            if downloaded_asset_urls.contains(&asset_url_str) {
                continue;
            }
            downloaded_asset_urls.insert(asset_url_str);

            match client.get(asset.url.as_str()).send().await {
                Ok(resp) => {
                    if resp.status().is_success() {
                        if let Ok(bytes) = resp.bytes().await {
                            total_bytes += bytes.len() as u64;
                            speed_tracker.record(total_bytes);
                            asset_files.push((asset.relative_path.clone(), bytes.to_vec()));
                        }
                    }
                }
                Err(e) => {
                    log::warn!("Failed to download CSS sub-asset {}: {}", asset.url, e);
                }
            }
        }

        // Pass 3: rewrite CSS url() values in downloaded CSS files
        for (rel_path, data) in &mut asset_files {
            if rel_path.ends_with(".css") {
                if let Ok(css_text) = std::str::from_utf8(data) {
                    // Find the matching CSS URL
                    if let Some((_, _, css_url)) = css_assets.iter().find(|(p, _, _)| p == rel_path)
                    {
                        let rewritten = rewrite_css_urls(css_text, css_url, &root_url);
                        *data = rewritten.into_bytes();
                    }
                }
            }
        }
    }

    if *cancel_rx.borrow() {
        return Err(ArchivistError::WebArchiveError("cancelled".to_string()));
    }

    // Phase 3: Package into ZIP
    {
        let mut svc = service.write().await;
        if let Some(t) = svc.tasks.get_mut(&task.id) {
            t.state = ArchiveState::Packaging;
        }
    }
    let _ = app_handle.emit(
        "web-archive-state-changed",
        serde_json::json!({
            "taskId": task.id,
            "state": "packaging",
        }),
    );

    let temp_dir = std::env::temp_dir().join(format!("archivist-archive-{}", task.id));
    let zip_path = temp_dir.with_extension("zip");

    // Create ZIP in a blocking task
    let pages_for_zip = pages.clone();
    let root_for_zip = root_url.clone();
    let zip_path_clone = zip_path.clone();

    let zip_result = tokio::task::spawn_blocking(move || {
        create_archive_zip(&zip_path_clone, &pages_for_zip, &asset_files, &root_for_zip)
    })
    .await
    .map_err(|e| ArchivistError::WebArchiveError(format!("ZIP task failed: {}", e)))?;

    zip_result?;

    if *cancel_rx.borrow() {
        let _ = std::fs::remove_file(&zip_path);
        return Err(ArchivistError::WebArchiveError("cancelled".to_string()));
    }

    // Phase 4: Upload to archivist-node
    {
        let mut svc = service.write().await;
        if let Some(t) = svc.tasks.get_mut(&task.id) {
            t.state = ArchiveState::Uploading;
        }
    }
    let _ = app_handle.emit(
        "web-archive-state-changed",
        serde_json::json!({
            "taskId": task.id,
            "state": "uploading",
        }),
    );

    // Get zip size before uploading (for total bytes calculation)
    let zip_size = std::fs::metadata(&zip_path).map(|m| m.len()).unwrap_or(0);

    let api_client = NodeApiClient::new(api_port);
    let upload_result = api_client.upload_file(&zip_path).await;

    // Clean up temp file
    let _ = std::fs::remove_file(&zip_path);

    let upload_response = upload_result
        .map_err(|e| ArchivistError::WebArchiveError(format!("Upload failed: {}", e)))?;

    let final_bytes = total_bytes + zip_size;

    let pages_count = pages.len() as u32;
    let assets_count = downloaded_asset_urls.len() as u32;

    Ok((
        upload_response.cid,
        site_title,
        pages_count,
        assets_count,
        final_bytes,
    ))
}

/// Create a ZIP archive containing all crawled pages and assets
fn create_archive_zip(
    zip_path: &PathBuf,
    pages: &[CrawledPage],
    assets: &[(String, Vec<u8>)],
    root_url: &Url,
) -> Result<()> {
    let file = std::fs::File::create(zip_path)
        .map_err(|e| ArchivistError::WebArchiveError(format!("Failed to create ZIP: {}", e)))?;

    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    // Track written paths to prevent duplicate filename errors
    let mut written_paths: HashSet<String> = HashSet::new();

    // Write HTML pages
    for page in pages {
        let rel_path = url_to_path(root_url, &page.url);
        if !written_paths.insert(rel_path.clone()) {
            log::warn!("Skipping duplicate ZIP entry: {}", rel_path);
            continue;
        }
        let rewritten_html = rewrite_html_refs(&page.html, &page.url, root_url);

        zip.start_file(&rel_path, options)
            .map_err(|e| ArchivistError::WebArchiveError(format!("ZIP write error: {}", e)))?;
        zip.write_all(rewritten_html.as_bytes())
            .map_err(|e| ArchivistError::WebArchiveError(format!("ZIP write error: {}", e)))?;
    }

    // Write assets
    for (rel_path, data) in assets {
        if !written_paths.insert(rel_path.clone()) {
            log::warn!("Skipping duplicate ZIP asset: {}", rel_path);
            continue;
        }
        zip.start_file(rel_path, options)
            .map_err(|e| ArchivistError::WebArchiveError(format!("ZIP write error: {}", e)))?;
        zip.write_all(data)
            .map_err(|e| ArchivistError::WebArchiveError(format!("ZIP write error: {}", e)))?;
    }

    zip.finish()
        .map_err(|e| ArchivistError::WebArchiveError(format!("ZIP finalize error: {}", e)))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn default_opts() -> ArchiveOptions {
        ArchiveOptions {
            url: "https://example.com".to_string(),
            max_depth: 3,
            max_pages: 100,
            include_assets: true,
            request_delay_ms: 200,
            single_page: false,
            user_agent: None,
            custom_headers: None,
            exclude_patterns: None,
        }
    }

    #[test]
    fn test_queue_archive() {
        let mut service = WebArchiveService::new(2, 8080);
        let id = service.queue_archive(default_opts()).unwrap();
        assert!(!id.is_empty());

        let state = service.get_queue_state();
        assert_eq!(state.tasks.len(), 1);
        assert_eq!(state.queued_count, 1);
        assert_eq!(state.active_count, 0);
    }

    #[test]
    fn test_cancel_queued_task() {
        let mut service = WebArchiveService::new(2, 8080);
        let id = service.queue_archive(default_opts()).unwrap();
        service.cancel_archive(&id).unwrap();

        let state = service.get_queue_state();
        assert_eq!(state.tasks[0].state, ArchiveState::Cancelled);
    }

    #[test]
    fn test_remove_completed_task() {
        let mut service = WebArchiveService::new(2, 8080);
        let id = service.queue_archive(default_opts()).unwrap();

        // Can't remove a queued task
        assert!(service.remove_task(&id).is_err());

        // Cancel it first, then remove
        service.cancel_archive(&id).unwrap();
        service.remove_task(&id).unwrap();

        let state = service.get_queue_state();
        assert_eq!(state.tasks.len(), 0);
    }

    #[test]
    fn test_clear_completed() {
        let mut service = WebArchiveService::new(2, 8080);
        for i in 0..3 {
            let mut opts = default_opts();
            opts.url = format!("https://example{}.com", i);
            let id = service.queue_archive(opts).unwrap();
            service.cancel_archive(&id).unwrap();
        }

        assert_eq!(service.get_queue_state().tasks.len(), 3);
        service.clear_completed();
        assert_eq!(service.get_queue_state().tasks.len(), 0);
    }

    #[test]
    fn test_same_origin() {
        let root = Url::parse("https://example.com/path").unwrap();
        let same = Url::parse("https://example.com/other").unwrap();
        let diff = Url::parse("https://other.com/path").unwrap();
        let diff_scheme = Url::parse("http://example.com/path").unwrap();

        assert!(is_same_origin(&root, &same));
        assert!(!is_same_origin(&root, &diff));
        assert!(!is_same_origin(&root, &diff_scheme));
    }

    #[test]
    fn test_url_to_path() {
        let base = Url::parse("https://example.com").unwrap();

        let root = Url::parse("https://example.com/").unwrap();
        assert_eq!(url_to_path(&base, &root), "index.html");

        let page = Url::parse("https://example.com/about").unwrap();
        assert_eq!(url_to_path(&base, &page), "about/index.html");

        let file = Url::parse("https://example.com/page.html").unwrap();
        assert_eq!(url_to_path(&base, &file), "page.html");

        let nested = Url::parse("https://example.com/docs/guide/intro.html").unwrap();
        assert_eq!(url_to_path(&base, &nested), "docs/guide/intro.html");
    }

    #[test]
    fn test_extract_links() {
        let html = r##"<html><body>
            <a href="/about">About</a>
            <a href="https://example.com/contact">Contact</a>
            <a href="https://other.com">External</a>
            <a href="#section">Fragment</a>
            <a href="javascript:void(0)">JS</a>
            <a href="mailto:test@test.com">Mail</a>
            </body></html>"##;
        let base = Url::parse("https://example.com/").unwrap();
        let links = extract_links(html, &base);

        assert_eq!(links.len(), 3); // /about, /contact, external
        assert!(links.iter().any(|l| l.path() == "/about"));
        assert!(links.iter().any(|l| l.path() == "/contact"));
    }

    #[test]
    fn test_extract_title() {
        let html = "<html><head><title>Test Page</title></head><body></body></html>";
        assert_eq!(extract_title(html), Some("Test Page".to_string()));

        let html_no_title = "<html><head></head><body></body></html>";
        assert_eq!(extract_title(html_no_title), None);
    }

    #[test]
    fn test_extract_assets() {
        let html = r#"
            <html>
            <head>
                <link rel="stylesheet" href="/css/style.css">
            </head>
            <body>
                <script src="/js/app.js"></script>
                <img src="/img/logo.png">
                <img src="data:image/png;base64,abc">
            </body>
            </html>
        "#;
        let base = Url::parse("https://example.com/").unwrap();
        let assets = extract_assets(html, &base);

        assert_eq!(assets.len(), 3); // CSS, JS, image (not data: URI)
    }

    #[test]
    fn test_extract_assets_with_favicon() {
        let html = r#"
            <html>
            <head>
                <link rel="stylesheet" href="/css/style.css">
                <link rel="icon" href="/favicon.ico">
                <link rel="shortcut icon" href="/favicon.png">
            </head>
            <body></body>
            </html>
        "#;
        let base = Url::parse("https://example.com/").unwrap();
        let assets = extract_assets(html, &base);

        assert_eq!(assets.len(), 3); // CSS + 2 favicons
        assert!(assets
            .iter()
            .any(|a| a.relative_path.contains("favicon.ico")));
        assert!(assets
            .iter()
            .any(|a| a.relative_path.contains("favicon.png")));
    }

    #[test]
    fn test_task_state_transitions() {
        let mut service = WebArchiveService::new(2, 8080);
        let id = service.queue_archive(default_opts()).unwrap();

        // Verify initial state
        let state = service.get_queue_state();
        assert_eq!(state.tasks[0].state, ArchiveState::Queued);
        assert_eq!(state.queued_count, 1);
        assert_eq!(state.active_count, 0);

        // Manually transition to cancelled
        service.cancel_archive(&id).unwrap();
        let state = service.get_queue_state();
        assert_eq!(state.tasks[0].state, ArchiveState::Cancelled);
        assert!(state.tasks[0].completed_at.is_some());
    }

    #[test]
    fn test_multiple_tasks_queue() {
        let mut service = WebArchiveService::new(2, 8080);
        for i in 0..5 {
            let mut opts = default_opts();
            opts.url = format!("https://example{}.com", i);
            service.queue_archive(opts).unwrap();
        }

        let state = service.get_queue_state();
        assert_eq!(state.tasks.len(), 5);
        assert_eq!(state.queued_count, 5);
        assert_eq!(state.max_concurrent, 2);
    }

    #[test]
    fn test_rewrite_html_refs_does_not_corrupt_title() {
        let html =
            r#"<html><head><title>Test</title></head><body><a href="/">Home</a></body></html>"#;
        let page = Url::parse("https://example.com/docs/page.html").unwrap();
        let root = Url::parse("https://example.com").unwrap();
        let result = rewrite_html_refs(html, &page, &root);
        assert!(
            result.contains("</title>"),
            "closing title tag must not be corrupted: {}",
            result
        );
        assert!(
            result.contains(r#"href="../index.html""#),
            "link should be rewritten to relative path: {}",
            result
        );
    }

    #[test]
    fn test_rewrite_html_refs_deeply_nested_page() {
        let html = r#"<html><head><title>PeerDAS -- Ethereum Research</title></head><body><a href="/">Home</a><a href="/about">About</a></body></html>"#;
        let page = Url::parse("https://example.com/t/peerdas/16541/index.html").unwrap();
        let root = Url::parse("https://example.com").unwrap();
        let result = rewrite_html_refs(html, &page, &root);
        // Title must remain intact
        assert!(
            result.contains("<title>PeerDAS -- Ethereum Research</title>"),
            "title tag was corrupted: {}",
            result
        );
        // Links should be rewritten to correct relative paths
        // t/peerdas/16541/index.html is 3 dirs deep, so 3x ../
        assert!(
            result.contains(r#"href="../../../index.html""#),
            "root link should have correct relative path: {}",
            result
        );
        assert!(
            result.contains(r#"href="../../../about/index.html""#),
            "about link should have correct relative path: {}",
            result
        );
    }

    #[test]
    fn test_rewrite_html_refs_rewrites_asset_refs() {
        let html = r#"<html><head><link rel="stylesheet" href="/css/style.css"><link rel="icon" href="/favicon.ico"></head><body><script src="/js/app.js"></script><img src="/img/logo.png"></body></html>"#;
        let page = Url::parse("https://example.com/docs/page.html").unwrap();
        let root = Url::parse("https://example.com").unwrap();
        let result = rewrite_html_refs(html, &page, &root);

        assert!(
            result.contains(r#"href="../css/style.css""#),
            "CSS href should be rewritten: {}",
            result
        );
        assert!(
            result.contains(r#"src="../js/app.js""#),
            "script src should be rewritten: {}",
            result
        );
        assert!(
            result.contains(r#"src="../img/logo.png""#),
            "img src should be rewritten: {}",
            result
        );
        assert!(
            result.contains(r#"href="../favicon.ico""#),
            "favicon href should be rewritten: {}",
            result
        );
    }

    #[test]
    fn test_compute_relative_path() {
        assert_eq!(
            compute_relative_path("index.html", "about/index.html"),
            "about/index.html"
        );
        assert_eq!(
            compute_relative_path("docs/intro.html", "index.html"),
            "../index.html"
        );
        assert_eq!(
            compute_relative_path("docs/guide/page.html", "css/style.css"),
            "../../css/style.css"
        );
    }

    #[test]
    fn test_transform_url_for_archival_reddit() {
        let reddit = Url::parse("https://www.reddit.com/r/rust/comments/abc123/").unwrap();
        let transformed = transform_url_for_archival(&reddit);
        assert_eq!(transformed.host_str(), Some("old.reddit.com"));
        assert_eq!(transformed.path(), "/r/rust/comments/abc123/");

        let reddit_bare = Url::parse("https://reddit.com/r/test").unwrap();
        let transformed = transform_url_for_archival(&reddit_bare);
        assert_eq!(transformed.host_str(), Some("old.reddit.com"));

        // Non-reddit URLs should not be transformed
        let other = Url::parse("https://example.com/page").unwrap();
        let transformed = transform_url_for_archival(&other);
        assert_eq!(transformed.host_str(), Some("example.com"));
    }

    #[test]
    fn test_extract_css_urls() {
        let css = r#"
            body { background: url("/images/bg.png"); }
            .icon { background-image: url('/fonts/icon.woff2'); }
            .data { background: url(data:image/gif;base64,abc); }
            .bare { background: url(../img/photo.jpg); }
        "#;
        let css_url = Url::parse("https://example.com/css/style.css").unwrap();
        let assets = extract_css_urls(css, &css_url);

        assert_eq!(assets.len(), 3); // bg.png, icon.woff2, photo.jpg (not data:)
        assert!(assets.iter().any(|a| a.url.path().contains("bg.png")));
        assert!(assets.iter().any(|a| a.url.path().contains("icon.woff2")));
        assert!(assets.iter().any(|a| a.url.path().contains("photo.jpg")));
    }

    #[test]
    fn test_rewrite_css_urls() {
        let css = r#"body { background: url("/images/bg.png"); }"#;
        let css_url = Url::parse("https://example.com/css/style.css").unwrap();
        let root_url = Url::parse("https://example.com").unwrap();

        let result = rewrite_css_urls(css, &css_url, &root_url);
        assert!(
            result.contains("url(\"../images/bg.png\")"),
            "CSS url() should be rewritten to relative: {}",
            result
        );
    }

    #[test]
    fn test_should_crawl_url() {
        let patterns = vec![
            Regex::new(r"/api/").unwrap(),
            Regex::new(r"\.pdf$").unwrap(),
        ];

        let ok = Url::parse("https://example.com/about").unwrap();
        assert!(should_crawl_url(&ok, &patterns));

        let api = Url::parse("https://example.com/api/data").unwrap();
        assert!(!should_crawl_url(&api, &patterns));

        let pdf = Url::parse("https://example.com/doc.pdf").unwrap();
        assert!(!should_crawl_url(&pdf, &patterns));
    }

    #[test]
    fn test_speed_tracker() {
        let mut tracker = SpeedTracker::new(10);

        // Record some samples
        tracker.record(0);
        // Manually push a sample with different time
        let start = std::time::Instant::now();
        tracker.samples.clear();
        tracker.samples.push_back((start, 0));
        tracker
            .samples
            .push_back((start + std::time::Duration::from_secs(1), 1000));

        let bps = tracker.bytes_per_second();
        assert!(
            (bps - 1000.0).abs() < 1.0,
            "Expected ~1000 B/s, got {}",
            bps
        );

        let eta = tracker.eta_seconds(2000);
        assert_eq!(eta, Some(1), "Expected ~1s ETA");
    }

    #[test]
    fn test_paused_state_in_queue() {
        let mut service = WebArchiveService::new(2, 8080);
        let id = service.queue_archive(default_opts()).unwrap();

        // Manually set to crawling to test pause
        service.tasks.get_mut(&id).unwrap().state = ArchiveState::Crawling;
        service.pause_archive(&id).unwrap();

        let state = service.get_queue_state();
        assert_eq!(state.tasks[0].state, ArchiveState::Paused);
        assert_eq!(state.paused_count, 1);

        // Resume
        service.resume_archive(&id).unwrap();
        let state = service.get_queue_state();
        assert_eq!(state.tasks[0].state, ArchiveState::Crawling);
        assert_eq!(state.paused_count, 0);
    }

    #[test]
    fn test_cancel_paused_task() {
        let mut service = WebArchiveService::new(2, 8080);
        let id = service.queue_archive(default_opts()).unwrap();

        // Set to crawling, then pause
        service.tasks.get_mut(&id).unwrap().state = ArchiveState::Crawling;
        service.pause_archive(&id).unwrap();

        // Should be able to cancel a paused task
        service.cancel_archive(&id).unwrap();
        let state = service.get_queue_state();
        assert_eq!(state.tasks[0].state, ArchiveState::Cancelled);
    }
}
