use crate::error::{ArchivistError, Result};
use crate::services::binary_manager::BinaryManager;
use chrono::{DateTime, Utc};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::{AppHandle, Emitter};

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

/// Monitor a running yt-dlp process, emitting progress events
async fn monitor_download(mut child: tokio::process::Child, task_id: String, app_handle: AppHandle) {
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

    let progress_re =
        Regex::new(r"\[download\]\s+([\d.]+)%\s+of\s+~?([\d.]+\w+)\s+at\s+([\d.]+\w+/s)\s+ETA\s+(\S+)")
            .unwrap();
    let progress_simple_re = Regex::new(r"\[download\]\s+([\d.]+)%").unwrap();
    let dest_re = Regex::new(r"\[download\]\s+Destination:\s+(.+)").unwrap();
    let merge_re = Regex::new(r#"\[Merger\]\s+Merging formats into\s+"(.+)""#).unwrap();
    let already_re = Regex::new(r"\[download\]\s+(.+)\s+has already been downloaded").unwrap();

    let mut output_path: Option<String> = None;

    while let Ok(Some(line)) = lines.next_line().await {
        log::debug!("yt-dlp [{}]: {}", task_id, line);

        // Parse destination path
        if let Some(caps) = dest_re.captures(&line) {
            output_path = Some(caps[1].to_string());
        }

        // Parse merge output path
        if let Some(caps) = merge_re.captures(&line) {
            output_path = Some(caps[1].to_string());
        }

        // Parse "already downloaded" path
        if let Some(caps) = already_re.captures(&line) {
            output_path = Some(caps[1].to_string());
        }

        // Parse progress with full details
        if let Some(caps) = progress_re.captures(&line) {
            let percent: f32 = caps[1].parse().unwrap_or(0.0);
            let speed = caps.get(3).map(|m| m.as_str().to_string());
            let eta = caps.get(4).map(|m| m.as_str().to_string());

            let _ = app_handle.emit(
                "media-download-progress",
                serde_json::json!({
                    "taskId": &task_id,
                    "percent": percent,
                    "speed": speed,
                    "eta": eta,
                }),
            );
        } else if let Some(caps) = progress_simple_re.captures(&line) {
            let percent: f32 = caps[1].parse().unwrap_or(0.0);
            let _ = app_handle.emit(
                "media-download-progress",
                serde_json::json!({
                    "taskId": &task_id,
                    "percent": percent,
                }),
            );
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
                    "error": error,
                }),
            );
            log::warn!("Download failed for task {}: {}", task_id, error);
        }
        Err(e) => {
            let _ = app_handle.emit(
                "media-download-state-changed",
                serde_json::json!({
                    "taskId": &task_id,
                    "state": "failed",
                    "error": format!("Process error: {}", e),
                }),
            );
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

            let has_video = vcodec
                .as_ref()
                .map(|v| v != "none")
                .unwrap_or(false);
            let has_audio = acodec
                .as_ref()
                .map(|a| a != "none")
                .unwrap_or(false);

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
                    None => format_note.clone().unwrap_or_else(|| "video+audio".to_string()),
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
            b_tbr.partial_cmp(&a_tbr).unwrap_or(std::cmp::Ordering::Equal)
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
