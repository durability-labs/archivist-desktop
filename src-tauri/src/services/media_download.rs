use crate::error::{ArchivistError, Result};
use crate::services::binary_manager::BinaryManager;
use chrono::{DateTime, Utc};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::{AppHandle, Emitter, Manager};

/// State of a download task
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DownloadState {
    Queued,
    FetchingMetadata,
    Downloading,
    PostProcessing,
    Completed,
    Failed,
    Cancelled,
}

/// Video/audio metadata from yt-dlp
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaMetadata {
    pub title: String,
    pub url: String,
    pub thumbnail: Option<String>,
    pub duration_seconds: Option<f64>,
    pub uploader: Option<String>,
    pub description: Option<String>,
    pub formats: Vec<MediaFormat>,
}

/// A single available format from yt-dlp
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaFormat {
    pub format_id: String,
    pub ext: String,
    pub resolution: Option<String>,
    pub filesize_approx: Option<u64>,
    pub vcodec: Option<String>,
    pub acodec: Option<String>,
    pub format_note: Option<String>,
    pub quality_label: String,
    pub has_video: bool,
    pub has_audio: bool,
    pub fps: Option<f64>,
    pub tbr: Option<f64>,
}

/// User's chosen download options
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadOptions {
    pub url: String,
    pub format_id: Option<String>,
    pub audio_only: bool,
    pub audio_format: Option<String>,
    pub output_directory: String,
    pub filename: Option<String>,
}

/// A tracked download in the queue
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadTask {
    pub id: String,
    pub url: String,
    pub title: String,
    pub thumbnail: Option<String>,
    pub state: DownloadState,
    pub progress_percent: f32,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub speed: Option<String>,
    pub eta: Option<String>,
    pub output_path: Option<String>,
    pub error: Option<String>,
    pub created_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub options: DownloadOptions,
}

/// Download queue state returned to frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadQueueState {
    pub tasks: Vec<DownloadTask>,
    pub active_count: u32,
    pub queued_count: u32,
    pub completed_count: u32,
    pub max_concurrent: u32,
    pub yt_dlp_available: bool,
    pub ffmpeg_available: bool,
    pub yt_dlp_version: Option<String>,
}

/// Core service for managing media downloads via yt-dlp
pub struct MediaDownloadService {
    tasks: HashMap<String, DownloadTask>,
    /// Task ordering (insertion order)
    task_order: Vec<String>,
    /// PIDs of active yt-dlp processes for cancellation
    active_pids: HashMap<String, u32>,
    max_concurrent: u32,
    binary_manager: BinaryManager,
    /// Cached yt-dlp version
    yt_dlp_version: Option<String>,
}

impl MediaDownloadService {
    pub fn new(max_concurrent: u32) -> Self {
        Self {
            tasks: HashMap::new(),
            task_order: Vec::new(),
            active_pids: HashMap::new(),
            max_concurrent,
            binary_manager: BinaryManager::new(),
            yt_dlp_version: None,
        }
    }

    pub fn binary_manager(&self) -> &BinaryManager {
        &self.binary_manager
    }

    /// Fetch metadata for a URL using yt-dlp
    pub async fn fetch_metadata(&self, url: &str) -> Result<MediaMetadata> {
        let yt_dlp = self.binary_manager.yt_dlp_path();
        if !yt_dlp.exists() {
            return Err(ArchivistError::BinaryNotFound(
                "yt-dlp is not installed. Install it first.".to_string(),
            ));
        }

        log::info!("Fetching metadata for: {}", url);

        let output = tokio::process::Command::new(&yt_dlp)
            .args(["-j", "--no-playlist", "--no-warnings", url])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .output()
            .await
            .map_err(|e| {
                ArchivistError::MediaDownloadError(format!("Failed to run yt-dlp: {}", e))
            })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(ArchivistError::MediaDownloadError(format!(
                "Failed to fetch metadata: {}",
                stderr.trim()
            )));
        }

        let json: serde_json::Value = serde_json::from_slice(&output.stdout).map_err(|e| {
            ArchivistError::MediaDownloadError(format!("Failed to parse metadata JSON: {}", e))
        })?;

        parse_yt_dlp_metadata(&json, url)
    }

    /// Add a download to the queue
    pub fn queue_download(
        &mut self,
        options: DownloadOptions,
        title: String,
        thumbnail: Option<String>,
    ) -> Result<String> {
        let id = uuid::Uuid::new_v4().to_string();

        let task = DownloadTask {
            id: id.clone(),
            url: options.url.clone(),
            title,
            thumbnail,
            state: DownloadState::Queued,
            progress_percent: 0.0,
            downloaded_bytes: 0,
            total_bytes: None,
            speed: None,
            eta: None,
            output_path: None,
            error: None,
            created_at: Utc::now(),
            completed_at: None,
            options,
        };

        self.task_order.push(id.clone());
        self.tasks.insert(id.clone(), task);

        log::info!("Queued download task: {}", id);
        Ok(id)
    }

    /// Cancel an active or queued download
    pub fn cancel_download(&mut self, task_id: &str) -> Result<()> {
        // Kill the process if running
        if let Some(pid) = self.active_pids.remove(task_id) {
            kill_process(pid);
            log::info!("Killed yt-dlp process {} for task {}", pid, task_id);
        }

        if let Some(task) = self.tasks.get_mut(task_id) {
            task.state = DownloadState::Cancelled;
        }

        Ok(())
    }

    /// Remove a completed/failed/cancelled task from the queue
    pub fn remove_task(&mut self, task_id: &str) -> Result<()> {
        self.tasks.remove(task_id);
        self.task_order.retain(|id| id != task_id);
        self.active_pids.remove(task_id);
        Ok(())
    }

    /// Clear all completed, failed, and cancelled tasks
    pub fn clear_completed(&mut self) {
        let to_remove: Vec<String> = self
            .tasks
            .iter()
            .filter(|(_, t)| {
                matches!(
                    t.state,
                    DownloadState::Completed | DownloadState::Failed | DownloadState::Cancelled
                )
            })
            .map(|(id, _)| id.clone())
            .collect();

        for id in &to_remove {
            self.tasks.remove(id);
        }
        self.task_order.retain(|id| !to_remove.contains(id));
    }

    /// Get current queue state for frontend
    pub fn get_queue_state(&self) -> DownloadQueueState {
        let tasks: Vec<DownloadTask> = self
            .task_order
            .iter()
            .filter_map(|id| self.tasks.get(id).cloned())
            .collect();

        let active_count = tasks
            .iter()
            .filter(|t| {
                matches!(
                    t.state,
                    DownloadState::Downloading | DownloadState::PostProcessing
                )
            })
            .count() as u32;

        let queued_count = tasks
            .iter()
            .filter(|t| t.state == DownloadState::Queued)
            .count() as u32;

        let completed_count = tasks
            .iter()
            .filter(|t| t.state == DownloadState::Completed)
            .count() as u32;

        DownloadQueueState {
            tasks,
            active_count,
            queued_count,
            completed_count,
            max_concurrent: self.max_concurrent,
            yt_dlp_available: self.binary_manager.is_yt_dlp_installed(),
            ffmpeg_available: self.binary_manager.is_ffmpeg_installed(),
            yt_dlp_version: self.yt_dlp_version.clone(),
        }
    }

    /// Get completed downloads with output paths (for streaming library)
    pub fn get_completed_media(&self) -> Vec<DownloadTask> {
        self.task_order
            .iter()
            .filter_map(|id| self.tasks.get(id).cloned())
            .filter(|t| t.state == DownloadState::Completed && t.output_path.is_some())
            .collect()
    }

    /// Process the download queue — start new downloads if slots available
    /// Called by background loop every ~1 second
    pub async fn process_queue(&mut self, app_handle: &AppHandle) {
        // Count active downloads
        let active_count = self
            .tasks
            .values()
            .filter(|t| {
                matches!(
                    t.state,
                    DownloadState::Downloading | DownloadState::PostProcessing
                )
            })
            .count() as u32;

        if active_count >= self.max_concurrent {
            return;
        }

        // Find next queued task
        let slots = self.max_concurrent - active_count;
        let queued_ids: Vec<String> = self
            .task_order
            .iter()
            .filter(|id| {
                self.tasks
                    .get(*id)
                    .map(|t| t.state == DownloadState::Queued)
                    .unwrap_or(false)
            })
            .take(slots as usize)
            .cloned()
            .collect();

        for task_id in queued_ids {
            self.start_download(&task_id, app_handle).await;
        }

        // Clean up finished process PIDs
        let finished: Vec<String> = self
            .active_pids
            .keys()
            .filter(|id| {
                self.tasks
                    .get(*id)
                    .map(|t| {
                        !matches!(
                            t.state,
                            DownloadState::Downloading | DownloadState::PostProcessing
                        )
                    })
                    .unwrap_or(true)
            })
            .cloned()
            .collect();
        for id in finished {
            self.active_pids.remove(&id);
        }
    }

    /// Start a single download task
    async fn start_download(&mut self, task_id: &str, app_handle: &AppHandle) {
        let yt_dlp = self.binary_manager.yt_dlp_path();
        if !yt_dlp.exists() {
            if let Some(task) = self.tasks.get_mut(task_id) {
                task.state = DownloadState::Failed;
                task.error = Some("yt-dlp is not installed".to_string());
            }
            return;
        }

        let task = match self.tasks.get(task_id) {
            Some(t) => t.clone(),
            None => return,
        };

        // Mark as downloading
        if let Some(t) = self.tasks.get_mut(task_id) {
            t.state = DownloadState::Downloading;
        }

        let _ = app_handle.emit(
            "media-download-state-changed",
            serde_json::json!({
                "taskId": task_id,
                "state": "downloading",
            }),
        );

        // Build yt-dlp arguments
        let mut args: Vec<String> = vec!["--newline".to_string()];

        // Format selection
        if task.options.audio_only {
            args.push("-x".to_string());
            if let Some(ref fmt) = task.options.audio_format {
                args.extend_from_slice(&["--audio-format".to_string(), fmt.clone()]);
            }
        } else if let Some(ref fmt_id) = task.options.format_id {
            args.extend_from_slice(&["-f".to_string(), fmt_id.clone()]);
        } else {
            // Default: best mp4 video+audio
            args.extend_from_slice(&[
                "-f".to_string(),
                "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best".to_string(),
            ]);
        }

        // ffmpeg location
        let ffmpeg = self.binary_manager.ffmpeg_path();
        if ffmpeg.exists() {
            if let Some(ffmpeg_dir) = ffmpeg.parent() {
                args.extend_from_slice(&[
                    "--ffmpeg-location".to_string(),
                    ffmpeg_dir.to_string_lossy().to_string(),
                ]);
            }
        }

        // Output template
        let output_template = if let Some(ref name) = task.options.filename {
            format!("{}/{}.%(ext)s", task.options.output_directory, name)
        } else {
            format!("{}/%(title)s.%(ext)s", task.options.output_directory)
        };
        args.extend_from_slice(&["-o".to_string(), output_template]);

        // URL
        args.push(task.options.url.clone());

        log::info!(
            "Starting download for task {}: yt-dlp {}",
            task_id,
            args.join(" ")
        );

        // Spawn yt-dlp process
        let child = match tokio::process::Command::new(&yt_dlp)
            .args(&args)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                if let Some(t) = self.tasks.get_mut(task_id) {
                    t.state = DownloadState::Failed;
                    t.error = Some(format!("Failed to start yt-dlp: {}", e));
                }
                return;
            }
        };

        let pid = child.id().unwrap_or(0);
        self.active_pids.insert(task_id.to_string(), pid);

        // Spawn a task to read stdout/stderr and update progress
        let task_id_owned = task_id.to_string();
        let app_handle_clone = app_handle.clone();

        // We need to handle the async monitoring without holding &mut self
        // So we'll collect output and handle it in the next process_queue call
        tokio::spawn(async move {
            monitor_download(child, task_id_owned, app_handle_clone).await;
        });
    }

    /// Update a task's state from the monitoring thread
    pub fn update_task_progress(
        &mut self,
        task_id: &str,
        percent: f32,
        speed: Option<String>,
        eta: Option<String>,
    ) {
        if let Some(task) = self.tasks.get_mut(task_id) {
            task.progress_percent = percent;
            task.speed = speed;
            task.eta = eta;
        }
    }

    /// Mark a task as completed
    pub fn mark_completed(&mut self, task_id: &str, output_path: Option<String>) {
        if let Some(task) = self.tasks.get_mut(task_id) {
            task.state = DownloadState::Completed;
            task.progress_percent = 100.0;
            task.completed_at = Some(Utc::now());
            task.output_path = output_path;
        }
        self.active_pids.remove(task_id);
    }

    /// Mark a task as failed
    pub fn mark_failed(&mut self, task_id: &str, error: String) {
        if let Some(task) = self.tasks.get_mut(task_id) {
            task.state = DownloadState::Failed;
            task.error = Some(error);
        }
        self.active_pids.remove(task_id);
    }

    /// Update cached yt-dlp version
    pub async fn refresh_version(&mut self) {
        self.yt_dlp_version = self.binary_manager.get_yt_dlp_version().await;
    }
}

/// Parsed progress information from a yt-dlp output line
#[derive(Debug, Clone)]
pub(crate) struct ProgressInfo {
    pub percent: f32,
    pub speed: Option<String>,
    pub eta: Option<String>,
}

/// Result of parsing a single yt-dlp stdout line
#[derive(Debug)]
pub(crate) enum LineParseResult {
    /// Progress update with percent, optional speed and ETA
    Progress(ProgressInfo),
    /// Destination file path
    Destination(String),
    /// Merged output file path
    Merge(String),
    /// File was already downloaded
    AlreadyDownloaded(String),
    /// Line didn't match any known pattern
    Other,
}

/// Parse a single line of yt-dlp stdout output into a structured result
pub(crate) fn parse_yt_dlp_line(line: &str) -> LineParseResult {
    let progress_re = Regex::new(
        r"\[download\]\s+([\d.]+)%\s+of\s+~?([\d.]+\w+)\s+at\s+([\d.]+\w+/s)\s+ETA\s+(\S+)",
    )
    .unwrap();
    let progress_simple_re = Regex::new(r"\[download\]\s+([\d.]+)%").unwrap();
    let dest_re = Regex::new(r"\[download\]\s+Destination:\s+(.+)").unwrap();
    let merge_re = Regex::new(r#"\[Merger\]\s+Merging formats into\s+"(.+)""#).unwrap();
    let already_re = Regex::new(r"\[download\]\s+(.+)\s+has already been downloaded").unwrap();

    if let Some(caps) = dest_re.captures(line) {
        return LineParseResult::Destination(caps[1].to_string());
    }

    if let Some(caps) = merge_re.captures(line) {
        return LineParseResult::Merge(caps[1].to_string());
    }

    if let Some(caps) = already_re.captures(line) {
        return LineParseResult::AlreadyDownloaded(caps[1].to_string());
    }

    if let Some(caps) = progress_re.captures(line) {
        let percent: f32 = caps[1].parse().unwrap_or(0.0);
        let speed = caps.get(3).map(|m| m.as_str().to_string());
        let eta = caps.get(4).map(|m| m.as_str().to_string());
        return LineParseResult::Progress(ProgressInfo {
            percent,
            speed,
            eta,
        });
    }

    if let Some(caps) = progress_simple_re.captures(line) {
        let percent: f32 = caps[1].parse().unwrap_or(0.0);
        return LineParseResult::Progress(ProgressInfo {
            percent,
            speed: None,
            eta: None,
        });
    }

    LineParseResult::Other
}

/// Monitor a running yt-dlp process, emitting progress events
async fn monitor_download(
    mut child: tokio::process::Child,
    task_id: String,
    app_handle: AppHandle,
) {
    use tokio::io::{AsyncBufReadExt, BufReader};

    let stdout = match child.stdout.take() {
        Some(s) => s,
        None => {
            let _ = app_handle.emit(
                "media-download-state-changed",
                serde_json::json!({
                    "taskId": &task_id,
                    "state": "failed",
                    "error": "Failed to capture stdout",
                }),
            );
            return;
        }
    };

    let stderr = child.stderr.take();

    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();

    let mut output_path: Option<String> = None;

    while let Ok(Some(line)) = lines.next_line().await {
        log::debug!("yt-dlp [{}]: {}", task_id, line);

        match parse_yt_dlp_line(&line) {
            LineParseResult::Destination(path) => {
                output_path = Some(path);
            }
            LineParseResult::Merge(path) => {
                output_path = Some(path);
            }
            LineParseResult::AlreadyDownloaded(path) => {
                output_path = Some(path);
            }
            LineParseResult::Progress(info) => {
                let _ = app_handle.emit(
                    "media-download-progress",
                    serde_json::json!({
                        "taskId": &task_id,
                        "percent": info.percent,
                        "speed": info.speed,
                        "eta": info.eta,
                    }),
                );
                // Sync progress to backend so polling returns current values
                if let Some(state) = app_handle.try_state::<crate::state::AppState>() {
                    let mut media = state.media.write().await;
                    media.update_task_progress(
                        &task_id,
                        info.percent,
                        info.speed.clone(),
                        info.eta.clone(),
                    );
                }
            }
            LineParseResult::Other => {}
        }
    }

    // Read stderr for error messages
    let stderr_output = if let Some(stderr) = stderr {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        let mut output = String::new();
        while let Ok(Some(line)) = lines.next_line().await {
            if !line.trim().is_empty() {
                output.push_str(&line);
                output.push('\n');
            }
        }
        output
    } else {
        String::new()
    };

    // Wait for process to exit
    match child.wait().await {
        Ok(status) if status.success() => {
            let _ = app_handle.emit(
                "media-download-state-changed",
                serde_json::json!({
                    "taskId": &task_id,
                    "state": "completed",
                    "outputPath": output_path,
                }),
            );
            // Update backend state so polling returns correct state
            if let Some(state) = app_handle.try_state::<crate::state::AppState>() {
                let mut media = state.media.write().await;
                media.mark_completed(&task_id, output_path);
            }
            log::info!("Download completed for task {}", task_id);
        }
        Ok(status) => {
            let error = if stderr_output.is_empty() {
                format!("yt-dlp exited with code: {}", status)
            } else {
                stderr_output.trim().to_string()
            };
            let _ = app_handle.emit(
                "media-download-state-changed",
                serde_json::json!({
                    "taskId": &task_id,
                    "state": "failed",
                    "error": &error,
                }),
            );
            // Update backend state so polling returns correct state
            if let Some(state) = app_handle.try_state::<crate::state::AppState>() {
                let mut media = state.media.write().await;
                media.mark_failed(&task_id, error.clone());
            }
            log::warn!("Download failed for task {}: {}", task_id, error);
        }
        Err(e) => {
            let error = format!("Process error: {}", e);
            let _ = app_handle.emit(
                "media-download-state-changed",
                serde_json::json!({
                    "taskId": &task_id,
                    "state": "failed",
                    "error": &error,
                }),
            );
            // Update backend state so polling returns correct state
            if let Some(state) = app_handle.try_state::<crate::state::AppState>() {
                let mut media = state.media.write().await;
                media.mark_failed(&task_id, error);
            }
        }
    }
}

/// Parse yt-dlp JSON metadata into our MediaMetadata struct
fn parse_yt_dlp_metadata(json: &serde_json::Value, url: &str) -> Result<MediaMetadata> {
    let title = json["title"]
        .as_str()
        .unwrap_or("Unknown Title")
        .to_string();

    let thumbnail = json["thumbnail"].as_str().map(|s| s.to_string());
    let duration = json["duration"].as_f64();
    let uploader = json["uploader"].as_str().map(|s| s.to_string());
    let description = json["description"]
        .as_str()
        .map(|s| s.chars().take(500).collect());

    // Parse formats
    let mut formats = Vec::new();
    if let Some(raw_formats) = json["formats"].as_array() {
        for f in raw_formats {
            let format_id = match f["format_id"].as_str() {
                Some(id) => id.to_string(),
                None => continue,
            };

            let ext = f["ext"].as_str().unwrap_or("unknown").to_string();
            let vcodec = f["vcodec"].as_str().map(|s| s.to_string());
            let acodec = f["acodec"].as_str().map(|s| s.to_string());

            let has_video = vcodec.as_ref().map(|v| v != "none").unwrap_or(false);
            let has_audio = acodec.as_ref().map(|a| a != "none").unwrap_or(false);

            let resolution = f["resolution"].as_str().map(|s| s.to_string());
            let height = f["height"].as_u64();
            let format_note = f["format_note"].as_str().map(|s| s.to_string());
            let fps = f["fps"].as_f64();
            let tbr = f["tbr"].as_f64();

            let filesize_approx = f["filesize"]
                .as_u64()
                .or_else(|| f["filesize_approx"].as_u64());

            // Build quality label
            let quality_label = if has_video && has_audio {
                match height {
                    Some(h) => format!("{}p (video+audio)", h),
                    None => format_note
                        .clone()
                        .unwrap_or_else(|| "video+audio".to_string()),
                }
            } else if has_video {
                match height {
                    Some(h) => format!("{}p (video only)", h),
                    None => format_note
                        .clone()
                        .unwrap_or_else(|| "video only".to_string()),
                }
            } else if has_audio {
                let abr = f["abr"].as_f64();
                match abr {
                    Some(br) => format!("{:.0}kbps (audio)", br),
                    None => format_note
                        .clone()
                        .unwrap_or_else(|| "audio only".to_string()),
                }
            } else {
                "unknown".to_string()
            };

            // Skip storyboard/mhtml formats
            if ext == "mhtml" {
                continue;
            }

            formats.push(MediaFormat {
                format_id,
                ext,
                resolution,
                filesize_approx,
                vcodec,
                acodec,
                format_note,
                quality_label,
                has_video,
                has_audio,
                fps,
                tbr,
            });
        }
    }

    // Sort: video+audio first (by height desc), then video only, then audio only
    formats.sort_by(|a, b| {
        let a_score = if a.has_video && a.has_audio {
            2
        } else if a.has_video {
            1
        } else {
            0
        };
        let b_score = if b.has_video && b.has_audio {
            2
        } else if b.has_video {
            1
        } else {
            0
        };
        b_score.cmp(&a_score).then_with(|| {
            let a_tbr = a.tbr.unwrap_or(0.0);
            let b_tbr = b.tbr.unwrap_or(0.0);
            b_tbr
                .partial_cmp(&a_tbr)
                .unwrap_or(std::cmp::Ordering::Equal)
        })
    });

    Ok(MediaMetadata {
        title,
        url: url.to_string(),
        thumbnail,
        duration_seconds: duration,
        uploader,
        description,
        formats,
    })
}

/// Kill a process by PID
fn kill_process(pid: u32) {
    #[cfg(unix)]
    {
        unsafe {
            libc::kill(pid as i32, libc::SIGTERM);
        }
    }
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F"])
            .output();
    }
}

#[cfg(test)]
impl MediaDownloadService {
    /// Test helper to directly set a task's state
    pub fn set_task_state_for_test(&mut self, task_id: &str, state: DownloadState) {
        if let Some(task) = self.tasks.get_mut(task_id) {
            task.state = state;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Helper to create default DownloadOptions for tests
    fn test_options(url: &str) -> DownloadOptions {
        DownloadOptions {
            url: url.to_string(),
            format_id: None,
            audio_only: false,
            audio_format: None,
            output_directory: "/tmp".to_string(),
            filename: None,
        }
    }

    // =========================================================================
    // parse_yt_dlp_metadata tests
    // =========================================================================

    #[test]
    fn test_parse_metadata_basic() {
        let json = json!({
            "title": "Test Video",
            "thumbnail": "https://example.com/thumb.jpg",
            "duration": 120.5,
            "uploader": "Test Channel",
            "description": "A test video description",
            "formats": []
        });
        let result = parse_yt_dlp_metadata(&json, "https://example.com/video").unwrap();
        assert_eq!(result.title, "Test Video");
        assert_eq!(result.url, "https://example.com/video");
        assert_eq!(
            result.thumbnail,
            Some("https://example.com/thumb.jpg".to_string())
        );
        assert!((result.duration_seconds.unwrap() - 120.5).abs() < f64::EPSILON);
        assert_eq!(result.uploader, Some("Test Channel".to_string()));
        assert_eq!(
            result.description,
            Some("A test video description".to_string())
        );
        assert!(result.formats.is_empty());
    }

    #[test]
    fn test_parse_metadata_missing_title() {
        let json = json!({ "formats": [] });
        let result = parse_yt_dlp_metadata(&json, "https://example.com").unwrap();
        assert_eq!(result.title, "Unknown Title");
    }

    #[test]
    fn test_parse_metadata_description_truncated() {
        let long_desc = "a".repeat(600);
        let json = json!({
            "title": "Test",
            "description": long_desc,
            "formats": []
        });
        let result = parse_yt_dlp_metadata(&json, "https://example.com").unwrap();
        assert_eq!(result.description.unwrap().len(), 500);
    }

    #[test]
    fn test_parse_metadata_optional_fields_none() {
        let json = json!({ "title": "Test", "formats": [] });
        let result = parse_yt_dlp_metadata(&json, "https://example.com").unwrap();
        assert!(result.thumbnail.is_none());
        assert!(result.duration_seconds.is_none());
        assert!(result.uploader.is_none());
        assert!(result.description.is_none());
    }

    #[test]
    fn test_parse_format_video_and_audio() {
        let json = json!({
            "title": "Test",
            "formats": [{
                "format_id": "22",
                "ext": "mp4",
                "vcodec": "avc1.64001F",
                "acodec": "mp4a.40.2",
                "height": 1080,
                "tbr": 2500.0
            }]
        });
        let result = parse_yt_dlp_metadata(&json, "https://example.com").unwrap();
        assert_eq!(result.formats.len(), 1);
        let fmt = &result.formats[0];
        assert!(fmt.has_video);
        assert!(fmt.has_audio);
        assert_eq!(fmt.quality_label, "1080p (video+audio)");
        assert_eq!(fmt.format_id, "22");
        assert_eq!(fmt.ext, "mp4");
    }

    #[test]
    fn test_parse_format_video_only() {
        let json = json!({
            "title": "Test",
            "formats": [{
                "format_id": "137",
                "ext": "mp4",
                "vcodec": "avc1.640028",
                "acodec": "none",
                "height": 720
            }]
        });
        let result = parse_yt_dlp_metadata(&json, "https://example.com").unwrap();
        let fmt = &result.formats[0];
        assert!(fmt.has_video);
        assert!(!fmt.has_audio);
        assert_eq!(fmt.quality_label, "720p (video only)");
    }

    #[test]
    fn test_parse_format_audio_only() {
        let json = json!({
            "title": "Test",
            "formats": [{
                "format_id": "251",
                "ext": "webm",
                "vcodec": "none",
                "acodec": "opus",
                "abr": 128.0
            }]
        });
        let result = parse_yt_dlp_metadata(&json, "https://example.com").unwrap();
        let fmt = &result.formats[0];
        assert!(!fmt.has_video);
        assert!(fmt.has_audio);
        assert_eq!(fmt.quality_label, "128kbps (audio)");
    }

    #[test]
    fn test_parse_formats_skips_mhtml() {
        let json = json!({
            "title": "Test",
            "formats": [
                { "format_id": "sb0", "ext": "mhtml", "vcodec": "none", "acodec": "none" },
                { "format_id": "22", "ext": "mp4", "vcodec": "avc1", "acodec": "mp4a", "height": 720 }
            ]
        });
        let result = parse_yt_dlp_metadata(&json, "https://example.com").unwrap();
        assert_eq!(result.formats.len(), 1);
        assert_eq!(result.formats[0].format_id, "22");
    }

    #[test]
    fn test_parse_formats_skips_no_format_id() {
        let json = json!({
            "title": "Test",
            "formats": [
                { "ext": "mp4", "vcodec": "avc1", "acodec": "mp4a" },
                { "format_id": "22", "ext": "mp4", "vcodec": "avc1", "acodec": "mp4a" }
            ]
        });
        let result = parse_yt_dlp_metadata(&json, "https://example.com").unwrap();
        assert_eq!(result.formats.len(), 1);
        assert_eq!(result.formats[0].format_id, "22");
    }

    #[test]
    fn test_parse_formats_sorting() {
        let json = json!({
            "title": "Test",
            "formats": [
                { "format_id": "1", "ext": "webm", "vcodec": "none", "acodec": "opus", "abr": 128.0, "tbr": 128.0 },
                { "format_id": "2", "ext": "mp4", "vcodec": "avc1", "acodec": "none", "height": 1080, "tbr": 3000.0 },
                { "format_id": "3", "ext": "mp4", "vcodec": "avc1", "acodec": "mp4a", "height": 720, "tbr": 1500.0 },
                { "format_id": "4", "ext": "mp4", "vcodec": "avc1", "acodec": "mp4a", "height": 1080, "tbr": 2500.0 }
            ]
        });
        let result = parse_yt_dlp_metadata(&json, "https://example.com").unwrap();
        assert_eq!(result.formats.len(), 4);
        // video+audio sorted by tbr descending first
        assert_eq!(result.formats[0].format_id, "4"); // 2500 tbr, video+audio
        assert_eq!(result.formats[1].format_id, "3"); // 1500 tbr, video+audio
                                                      // then video-only
        assert_eq!(result.formats[2].format_id, "2"); // video only
                                                      // then audio-only
        assert_eq!(result.formats[3].format_id, "1"); // audio only
    }

    // =========================================================================
    // Queue management tests
    // =========================================================================

    #[test]
    fn test_queue_download_creates_task() {
        let mut svc = MediaDownloadService::new(3);
        let id = svc
            .queue_download(
                test_options("https://example.com/video"),
                "Test Video".to_string(),
                None,
            )
            .unwrap();

        assert!(!id.is_empty());
        let state = svc.get_queue_state();
        assert_eq!(state.tasks.len(), 1);
        assert_eq!(state.tasks[0].id, id);
        assert_eq!(state.tasks[0].state, DownloadState::Queued);
        assert_eq!(state.tasks[0].title, "Test Video");
        assert!((state.tasks[0].progress_percent - 0.0).abs() < f32::EPSILON);
    }

    #[test]
    fn test_queue_download_preserves_order() {
        let mut svc = MediaDownloadService::new(3);
        let id1 = svc
            .queue_download(test_options("https://a.com"), "First".to_string(), None)
            .unwrap();
        let id2 = svc
            .queue_download(test_options("https://b.com"), "Second".to_string(), None)
            .unwrap();
        let id3 = svc
            .queue_download(test_options("https://c.com"), "Third".to_string(), None)
            .unwrap();

        let state = svc.get_queue_state();
        assert_eq!(state.tasks[0].id, id1);
        assert_eq!(state.tasks[1].id, id2);
        assert_eq!(state.tasks[2].id, id3);
    }

    #[test]
    fn test_queue_state_counts() {
        let mut svc = MediaDownloadService::new(3);
        let id1 = svc
            .queue_download(test_options("https://a.com"), "A".to_string(), None)
            .unwrap();
        let id2 = svc
            .queue_download(test_options("https://b.com"), "B".to_string(), None)
            .unwrap();
        let _id3 = svc
            .queue_download(test_options("https://c.com"), "C".to_string(), None)
            .unwrap();

        svc.set_task_state_for_test(&id1, DownloadState::Downloading);
        svc.mark_completed(&id2, Some("/tmp/b.mp4".to_string()));
        // _id3 stays Queued

        let state = svc.get_queue_state();
        assert_eq!(state.active_count, 1);
        assert_eq!(state.queued_count, 1);
        assert_eq!(state.completed_count, 1);
    }

    #[test]
    fn test_cancel_download_sets_cancelled() {
        let mut svc = MediaDownloadService::new(3);
        let id = svc
            .queue_download(test_options("https://a.com"), "A".to_string(), None)
            .unwrap();

        svc.cancel_download(&id).unwrap();

        let state = svc.get_queue_state();
        assert_eq!(state.tasks[0].state, DownloadState::Cancelled);
    }

    #[test]
    fn test_cancel_nonexistent_ok() {
        let mut svc = MediaDownloadService::new(3);
        let result = svc.cancel_download("nonexistent-id");
        assert!(result.is_ok());
    }

    #[test]
    fn test_remove_task() {
        let mut svc = MediaDownloadService::new(3);
        let id = svc
            .queue_download(test_options("https://a.com"), "A".to_string(), None)
            .unwrap();

        svc.remove_task(&id).unwrap();

        let state = svc.get_queue_state();
        assert!(state.tasks.is_empty());
    }

    #[test]
    fn test_clear_completed() {
        let mut svc = MediaDownloadService::new(3);
        let id1 = svc
            .queue_download(test_options("https://a.com"), "A".to_string(), None)
            .unwrap();
        let id2 = svc
            .queue_download(test_options("https://b.com"), "B".to_string(), None)
            .unwrap();
        let id3 = svc
            .queue_download(test_options("https://c.com"), "C".to_string(), None)
            .unwrap();
        let id4 = svc
            .queue_download(test_options("https://d.com"), "D".to_string(), None)
            .unwrap();
        let id5 = svc
            .queue_download(test_options("https://e.com"), "E".to_string(), None)
            .unwrap();

        // id1 stays Queued
        svc.set_task_state_for_test(&id2, DownloadState::Downloading);
        svc.mark_completed(&id3, None);
        svc.mark_failed(&id4, "error".to_string());
        svc.cancel_download(&id5).unwrap();

        svc.clear_completed();

        let state = svc.get_queue_state();
        assert_eq!(state.tasks.len(), 2);
        assert_eq!(state.tasks[0].id, id1); // Queued preserved
        assert_eq!(state.tasks[1].id, id2); // Downloading preserved
    }

    #[test]
    fn test_mark_completed() {
        let mut svc = MediaDownloadService::new(3);
        let id = svc
            .queue_download(test_options("https://a.com"), "A".to_string(), None)
            .unwrap();

        svc.mark_completed(&id, Some("/tmp/video.mp4".to_string()));

        let state = svc.get_queue_state();
        let task = &state.tasks[0];
        assert_eq!(task.state, DownloadState::Completed);
        assert!((task.progress_percent - 100.0).abs() < f32::EPSILON);
        assert_eq!(task.output_path, Some("/tmp/video.mp4".to_string()));
        assert!(task.completed_at.is_some());
    }

    #[test]
    fn test_mark_failed() {
        let mut svc = MediaDownloadService::new(3);
        let id = svc
            .queue_download(test_options("https://a.com"), "A".to_string(), None)
            .unwrap();

        svc.mark_failed(&id, "network error".to_string());

        let state = svc.get_queue_state();
        let task = &state.tasks[0];
        assert_eq!(task.state, DownloadState::Failed);
        assert_eq!(task.error, Some("network error".to_string()));
    }

    #[test]
    fn test_update_task_progress() {
        let mut svc = MediaDownloadService::new(3);
        let id = svc
            .queue_download(test_options("https://a.com"), "A".to_string(), None)
            .unwrap();

        svc.update_task_progress(
            &id,
            42.5,
            Some("5.2MiB/s".to_string()),
            Some("00:30".to_string()),
        );

        let state = svc.get_queue_state();
        let task = &state.tasks[0];
        assert!((task.progress_percent - 42.5).abs() < f32::EPSILON);
        assert_eq!(task.speed, Some("5.2MiB/s".to_string()));
        assert_eq!(task.eta, Some("00:30".to_string()));
    }

    // =========================================================================
    // Progress line parsing tests
    // =========================================================================

    #[test]
    fn test_parse_full_progress() {
        let line = "[download]  45.2% of ~150.00MiB at 5.50MiB/s ETA 00:15";
        match parse_yt_dlp_line(line) {
            LineParseResult::Progress(info) => {
                assert!((info.percent - 45.2).abs() < f32::EPSILON);
                assert_eq!(info.speed, Some("5.50MiB/s".to_string()));
                assert_eq!(info.eta, Some("00:15".to_string()));
            }
            other => panic!("Expected Progress, got {:?}", other),
        }
    }

    #[test]
    fn test_parse_simple_progress() {
        let line = "[download] 100%";
        match parse_yt_dlp_line(line) {
            LineParseResult::Progress(info) => {
                assert!((info.percent - 100.0).abs() < f32::EPSILON);
                assert!(info.speed.is_none());
                assert!(info.eta.is_none());
            }
            other => panic!("Expected Progress, got {:?}", other),
        }
    }

    #[test]
    fn test_parse_destination() {
        let line = "[download] Destination: /home/user/Downloads/video.mp4";
        match parse_yt_dlp_line(line) {
            LineParseResult::Destination(path) => {
                assert_eq!(path, "/home/user/Downloads/video.mp4");
            }
            other => panic!("Expected Destination, got {:?}", other),
        }
    }

    #[test]
    fn test_parse_merger() {
        let line = r#"[Merger] Merging formats into "/home/user/Downloads/video.mp4""#;
        match parse_yt_dlp_line(line) {
            LineParseResult::Merge(path) => {
                assert_eq!(path, "/home/user/Downloads/video.mp4");
            }
            other => panic!("Expected Merge, got {:?}", other),
        }
    }

    #[test]
    fn test_parse_already_downloaded() {
        let line = "[download] /home/user/Downloads/video.mp4 has already been downloaded";
        match parse_yt_dlp_line(line) {
            LineParseResult::AlreadyDownloaded(path) => {
                assert_eq!(path, "/home/user/Downloads/video.mp4");
            }
            other => panic!("Expected AlreadyDownloaded, got {:?}", other),
        }
    }

    #[test]
    fn test_parse_unrecognized_line() {
        let line = "[info] Writing video metadata";
        match parse_yt_dlp_line(line) {
            LineParseResult::Other => {}
            other => panic!("Expected Other, got {:?}", other),
        }
    }
}
