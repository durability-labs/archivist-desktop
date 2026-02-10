use crate::error::{ArchivistError, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};

/// Status of external binaries (yt-dlp, ffmpeg)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BinaryStatus {
    pub yt_dlp_installed: bool,
    pub yt_dlp_version: Option<String>,
    pub yt_dlp_path: Option<String>,
    pub ffmpeg_installed: bool,
    pub ffmpeg_version: Option<String>,
    pub ffmpeg_path: Option<String>,
}

/// Manages downloading and locating yt-dlp and ffmpeg binaries
pub struct BinaryManager {
    bin_dir: PathBuf,
}

impl BinaryManager {
    pub fn new() -> Self {
        let bin_dir = dirs::data_dir()
            .map(|p| p.join("archivist").join("bin"))
            .unwrap_or_else(|| PathBuf::from(".archivist/bin"));
        Self { bin_dir }
    }

    pub fn yt_dlp_path(&self) -> PathBuf {
        #[cfg(target_os = "windows")]
        {
            self.bin_dir.join("yt-dlp.exe")
        }
        #[cfg(not(target_os = "windows"))]
        {
            self.bin_dir.join("yt-dlp")
        }
    }

    pub fn ffmpeg_path(&self) -> PathBuf {
        #[cfg(target_os = "windows")]
        {
            self.bin_dir.join("ffmpeg.exe")
        }
        #[cfg(not(target_os = "windows"))]
        {
            self.bin_dir.join("ffmpeg")
        }
    }

    pub fn is_yt_dlp_installed(&self) -> bool {
        self.yt_dlp_path().exists()
    }

    pub fn is_ffmpeg_installed(&self) -> bool {
        self.ffmpeg_path().exists()
    }

    /// Check status of all managed binaries
    pub async fn check_binaries(&self) -> BinaryStatus {
        let yt_dlp_installed = self.is_yt_dlp_installed();
        let ffmpeg_installed = self.is_ffmpeg_installed();

        let yt_dlp_version = if yt_dlp_installed {
            self.get_yt_dlp_version().await
        } else {
            None
        };

        let ffmpeg_version = if ffmpeg_installed {
            self.get_ffmpeg_version().await
        } else {
            None
        };

        BinaryStatus {
            yt_dlp_installed,
            yt_dlp_version,
            yt_dlp_path: if yt_dlp_installed {
                Some(self.yt_dlp_path().to_string_lossy().to_string())
            } else {
                None
            },
            ffmpeg_installed,
            ffmpeg_version,
            ffmpeg_path: if ffmpeg_installed {
                Some(self.ffmpeg_path().to_string_lossy().to_string())
            } else {
                None
            },
        }
    }

    /// Get yt-dlp version by running `yt-dlp --version`
    pub async fn get_yt_dlp_version(&self) -> Option<String> {
        let path = self.yt_dlp_path();
        if !path.exists() {
            return None;
        }

        match tokio::process::Command::new(&path)
            .arg("--version")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output()
            .await
        {
            Ok(output) if output.status.success() => {
                let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if version.is_empty() {
                    None
                } else {
                    Some(version)
                }
            }
            _ => None,
        }
    }

    /// Get ffmpeg version by running `ffmpeg -version`
    pub async fn get_ffmpeg_version(&self) -> Option<String> {
        let path = self.ffmpeg_path();
        if !path.exists() {
            return None;
        }

        match tokio::process::Command::new(&path)
            .arg("-version")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output()
            .await
        {
            Ok(output) if output.status.success() => {
                let full = String::from_utf8_lossy(&output.stdout);
                // First line is like: ffmpeg version N-xxxxx-g... Copyright ...
                full.lines()
                    .next()
                    .and_then(|line| line.strip_prefix("ffmpeg version "))
                    .map(|v| v.split_whitespace().next().unwrap_or(v).to_string())
            }
            _ => None,
        }
    }

    /// Download and install yt-dlp binary for current platform
    pub async fn install_yt_dlp(&self, app_handle: &AppHandle) -> Result<()> {
        std::fs::create_dir_all(&self.bin_dir).map_err(|e| {
            ArchivistError::MediaDownloadError(format!("Failed to create bin directory: {}", e))
        })?;

        let url = Self::yt_dlp_download_url();
        let dest = self.yt_dlp_path();

        log::info!("Downloading yt-dlp from {} to {:?}", url, dest);

        let client = reqwest::Client::new();
        let response = client
            .get(&url)
            .send()
            .await
            .map_err(|e| ArchivistError::MediaDownloadError(format!("Download failed: {}", e)))?;

        if !response.status().is_success() {
            return Err(ArchivistError::MediaDownloadError(format!(
                "Download failed with status: {}",
                response.status()
            )));
        }

        let total = response.content_length();
        let mut downloaded: u64 = 0;

        // Stream to file
        let mut file = tokio::fs::File::create(&dest).await.map_err(|e| {
            ArchivistError::MediaDownloadError(format!("Failed to create file: {}", e))
        })?;

        use futures::StreamExt;
        use tokio::io::AsyncWriteExt;

        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let data = chunk.map_err(|e| {
                ArchivistError::MediaDownloadError(format!("Download stream error: {}", e))
            })?;
            downloaded += data.len() as u64;
            file.write_all(&data).await.map_err(|e| {
                ArchivistError::MediaDownloadError(format!("Write error: {}", e))
            })?;

            let _ = app_handle.emit(
                "binary-download-progress",
                serde_json::json!({
                    "binary": "yt-dlp",
                    "downloaded": downloaded,
                    "total": total,
                }),
            );
        }

        file.flush().await.map_err(|e| {
            ArchivistError::MediaDownloadError(format!("Flush error: {}", e))
        })?;
        drop(file);

        // Set executable permission on Unix
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755)).map_err(
                |e| {
                    ArchivistError::MediaDownloadError(format!(
                        "Failed to set permissions: {}",
                        e
                    ))
                },
            )?;
        }

        log::info!("yt-dlp installed successfully at {:?}", dest);

        let _ = app_handle.emit(
            "binary-installed",
            serde_json::json!({
                "binary": "yt-dlp",
                "path": dest.to_string_lossy(),
            }),
        );

        Ok(())
    }

    /// Download and install ffmpeg binary for current platform
    pub async fn install_ffmpeg(&self, app_handle: &AppHandle) -> Result<()> {
        std::fs::create_dir_all(&self.bin_dir).map_err(|e| {
            ArchivistError::MediaDownloadError(format!("Failed to create bin directory: {}", e))
        })?;

        let (url, archive_type) = Self::ffmpeg_download_url();
        let dest = self.ffmpeg_path();

        log::info!("Downloading ffmpeg from {} to {:?}", url, dest);

        let client = reqwest::Client::new();
        let response = client
            .get(&url)
            .send()
            .await
            .map_err(|e| ArchivistError::MediaDownloadError(format!("Download failed: {}", e)))?;

        if !response.status().is_success() {
            return Err(ArchivistError::MediaDownloadError(format!(
                "Download failed with status: {}",
                response.status()
            )));
        }

        let total = response.content_length();
        let mut downloaded: u64 = 0;

        // Download archive to temp file
        let temp_archive = self.bin_dir.join(format!("ffmpeg-download.{}", archive_type));
        let mut file = tokio::fs::File::create(&temp_archive).await.map_err(|e| {
            ArchivistError::MediaDownloadError(format!("Failed to create temp file: {}", e))
        })?;

        use futures::StreamExt;
        use tokio::io::AsyncWriteExt;

        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let data = chunk.map_err(|e| {
                ArchivistError::MediaDownloadError(format!("Download stream error: {}", e))
            })?;
            downloaded += data.len() as u64;
            file.write_all(&data).await.map_err(|e| {
                ArchivistError::MediaDownloadError(format!("Write error: {}", e))
            })?;

            let _ = app_handle.emit(
                "binary-download-progress",
                serde_json::json!({
                    "binary": "ffmpeg",
                    "downloaded": downloaded,
                    "total": total,
                }),
            );
        }

        file.flush().await.map_err(|e| {
            ArchivistError::MediaDownloadError(format!("Flush error: {}", e))
        })?;
        drop(file);

        // Extract ffmpeg binary from archive
        self.extract_ffmpeg(&temp_archive, &dest, archive_type)
            .await?;

        // Clean up temp archive
        let _ = tokio::fs::remove_file(&temp_archive).await;

        log::info!("ffmpeg installed successfully at {:?}", dest);

        let _ = app_handle.emit(
            "binary-installed",
            serde_json::json!({
                "binary": "ffmpeg",
                "path": dest.to_string_lossy(),
            }),
        );

        Ok(())
    }

    /// Extract ffmpeg binary from downloaded archive
    async fn extract_ffmpeg(
        &self,
        archive_path: &PathBuf,
        dest: &PathBuf,
        archive_type: &str,
    ) -> Result<()> {
        match archive_type {
            "zip" => self.extract_ffmpeg_from_zip(archive_path, dest).await,
            "tar.xz" => self.extract_ffmpeg_from_tar_xz(archive_path, dest).await,
            _ => Err(ArchivistError::MediaDownloadError(format!(
                "Unsupported archive type: {}",
                archive_type
            ))),
        }
    }

    /// Extract ffmpeg from a zip archive (Windows)
    async fn extract_ffmpeg_from_zip(
        &self,
        archive_path: &PathBuf,
        dest: &PathBuf,
    ) -> Result<()> {
        let archive_path = archive_path.clone();
        let dest = dest.clone();

        tokio::task::spawn_blocking(move || {
            let file = std::fs::File::open(&archive_path).map_err(|e| {
                ArchivistError::MediaDownloadError(format!("Failed to open archive: {}", e))
            })?;
            let mut archive = zip::ZipArchive::new(file).map_err(|e| {
                ArchivistError::MediaDownloadError(format!("Failed to read zip: {}", e))
            })?;

            // Find the ffmpeg binary in the archive
            let ffmpeg_name = if cfg!(target_os = "windows") {
                "ffmpeg.exe"
            } else {
                "ffmpeg"
            };

            for i in 0..archive.len() {
                let mut entry = archive.by_index(i).map_err(|e| {
                    ArchivistError::MediaDownloadError(format!("Zip entry error: {}", e))
                })?;
                let name = entry.name().to_string();
                if name.ends_with(ffmpeg_name) && !name.contains("ffplay") && !name.contains("ffprobe") {
                    let mut outfile = std::fs::File::create(&dest).map_err(|e| {
                        ArchivistError::MediaDownloadError(format!(
                            "Failed to create ffmpeg file: {}",
                            e
                        ))
                    })?;
                    std::io::copy(&mut entry, &mut outfile).map_err(|e| {
                        ArchivistError::MediaDownloadError(format!("Extract error: {}", e))
                    })?;

                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::PermissionsExt;
                        let _ = std::fs::set_permissions(
                            &dest,
                            std::fs::Permissions::from_mode(0o755),
                        );
                    }

                    return Ok(());
                }
            }

            Err(ArchivistError::MediaDownloadError(
                "ffmpeg binary not found in archive".to_string(),
            ))
        })
        .await
        .map_err(|e| ArchivistError::MediaDownloadError(format!("Task join error: {}", e)))?
    }

    /// Extract ffmpeg from a tar.xz archive (Linux/macOS)
    async fn extract_ffmpeg_from_tar_xz(
        &self,
        archive_path: &PathBuf,
        dest: &PathBuf,
    ) -> Result<()> {
        // Use system tar for extraction since it handles xz natively
        let output = tokio::process::Command::new("tar")
            .args([
                "xf",
                &archive_path.to_string_lossy(),
                "--wildcards",
                "*/ffmpeg",
                "--strip-components=2",
                "-C",
                &self.bin_dir.to_string_lossy(),
            ])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .output()
            .await
            .map_err(|e| {
                ArchivistError::MediaDownloadError(format!("Failed to extract: {}", e))
            })?;

        if !output.status.success() {
            // Try without --wildcards (macOS tar doesn't support it)
            let output2 = tokio::process::Command::new("tar")
                .args([
                    "xf",
                    &archive_path.to_string_lossy(),
                    "-C",
                    &self.bin_dir.to_string_lossy(),
                ])
                .output()
                .await
                .map_err(|e| {
                    ArchivistError::MediaDownloadError(format!("Failed to extract: {}", e))
                })?;

            if !output2.status.success() {
                let stderr = String::from_utf8_lossy(&output2.stderr);
                return Err(ArchivistError::MediaDownloadError(format!(
                    "tar extraction failed: {}",
                    stderr
                )));
            }

            // Find and move the ffmpeg binary to the expected location
            self.find_and_move_ffmpeg(dest).await?;
        }

        // Ensure executable permissions
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if dest.exists() {
                let _ =
                    std::fs::set_permissions(dest, std::fs::Permissions::from_mode(0o755));
            }
        }

        if !dest.exists() {
            return Err(ArchivistError::MediaDownloadError(
                "ffmpeg binary not found after extraction".to_string(),
            ));
        }

        Ok(())
    }

    /// Find extracted ffmpeg binary and move it to the expected location
    async fn find_and_move_ffmpeg(&self, dest: &PathBuf) -> Result<()> {
        // Walk the bin_dir looking for an ffmpeg binary in subdirectories
        for entry in walkdir(&self.bin_dir) {
            let path = entry.path();
            if path.file_name().map(|n| n == "ffmpeg").unwrap_or(false) && path != *dest {
                tokio::fs::rename(path, dest).await.map_err(|e| {
                    ArchivistError::MediaDownloadError(format!(
                        "Failed to move ffmpeg: {}",
                        e
                    ))
                })?;
                return Ok(());
            }
        }
        Ok(())
    }

    /// Get yt-dlp download URL for current platform
    pub(crate) fn yt_dlp_download_url() -> String {
        let base = "https://github.com/yt-dlp/yt-dlp/releases/latest/download";

        #[cfg(target_os = "linux")]
        {
            format!("{}/yt-dlp", base)
        }
        #[cfg(target_os = "macos")]
        {
            format!("{}/yt-dlp_macos", base)
        }
        #[cfg(target_os = "windows")]
        {
            format!("{}/yt-dlp.exe", base)
        }
    }

    /// Get ffmpeg download URL and archive type for current platform
    pub(crate) fn ffmpeg_download_url() -> (String, &'static str) {
        #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
        {
            (
                "https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz".to_string(),
                "tar.xz",
            )
        }
        #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
        {
            (
                "https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linuxarm64-gpl.tar.xz".to_string(),
                "tar.xz",
            )
        }
        #[cfg(target_os = "macos")]
        {
            (
                "https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-macos64-gpl.tar.xz".to_string(),
                "tar.xz",
            )
        }
        #[cfg(target_os = "windows")]
        {
            (
                "https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip".to_string(),
                "zip",
            )
        }
    }
}

/// Simple recursive directory walk (no external dependency needed)
fn walkdir(dir: &std::path::Path) -> Vec<std::fs::DirEntry> {
    let mut results = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                results.extend(walkdir(&path));
            } else {
                results.push(entry);
            }
        }
    }
    results
}

#[cfg(test)]
impl BinaryManager {
    /// Test-only constructor that allows pointing at a custom bin directory
    pub fn with_bin_dir(bin_dir: PathBuf) -> Self {
        Self { bin_dir }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_bin_dir_under_data_dir() {
        let mgr = BinaryManager::new();
        let path = mgr.bin_dir.to_string_lossy();
        assert!(
            path.contains("archivist") && path.ends_with("bin"),
            "Expected bin_dir under archivist/bin, got: {}",
            path
        );
    }

    #[test]
    fn test_yt_dlp_path_has_correct_name() {
        let mgr = BinaryManager::new();
        let path = mgr.yt_dlp_path();
        let name = path.file_name().unwrap().to_string_lossy();
        #[cfg(not(target_os = "windows"))]
        assert_eq!(name, "yt-dlp");
        #[cfg(target_os = "windows")]
        assert_eq!(name, "yt-dlp.exe");
    }

    #[test]
    fn test_ffmpeg_path_has_correct_name() {
        let mgr = BinaryManager::new();
        let path = mgr.ffmpeg_path();
        let name = path.file_name().unwrap().to_string_lossy();
        #[cfg(not(target_os = "windows"))]
        assert_eq!(name, "ffmpeg");
        #[cfg(target_os = "windows")]
        assert_eq!(name, "ffmpeg.exe");
    }

    #[test]
    fn test_not_installed_by_default() {
        let tmp = tempfile::TempDir::new().unwrap();
        let mgr = BinaryManager::with_bin_dir(tmp.path().join("nonexistent"));
        assert!(!mgr.is_yt_dlp_installed());
        assert!(!mgr.is_ffmpeg_installed());
    }

    #[test]
    fn test_yt_dlp_installed_when_file_exists() {
        let tmp = tempfile::TempDir::new().unwrap();
        let mgr = BinaryManager::with_bin_dir(tmp.path().to_path_buf());

        // Create the yt-dlp file
        let yt_dlp_path = mgr.yt_dlp_path();
        std::fs::write(&yt_dlp_path, b"fake binary").unwrap();

        assert!(mgr.is_yt_dlp_installed());
    }

    #[test]
    fn test_ffmpeg_installed_when_file_exists() {
        let tmp = tempfile::TempDir::new().unwrap();
        let mgr = BinaryManager::with_bin_dir(tmp.path().to_path_buf());

        let ffmpeg_path = mgr.ffmpeg_path();
        std::fs::write(&ffmpeg_path, b"fake binary").unwrap();

        assert!(mgr.is_ffmpeg_installed());
    }

    #[test]
    fn test_yt_dlp_download_url_format() {
        let url = BinaryManager::yt_dlp_download_url();
        assert!(url.starts_with("https://github.com/yt-dlp/yt-dlp/releases/"));
        #[cfg(target_os = "linux")]
        assert!(url.ends_with("/yt-dlp"));
        #[cfg(target_os = "macos")]
        assert!(url.ends_with("/yt-dlp_macos"));
        #[cfg(target_os = "windows")]
        assert!(url.ends_with("/yt-dlp.exe"));
    }

    #[test]
    fn test_ffmpeg_download_url_format() {
        let (url, archive_type) = BinaryManager::ffmpeg_download_url();
        assert!(url.contains("ffmpeg"));
        assert!(url.contains("github.com"));
        #[cfg(not(target_os = "windows"))]
        assert_eq!(archive_type, "tar.xz");
        #[cfg(target_os = "windows")]
        assert_eq!(archive_type, "zip");
    }

    #[tokio::test]
    async fn test_check_binaries_when_not_installed() {
        let tmp = tempfile::TempDir::new().unwrap();
        let mgr = BinaryManager::with_bin_dir(tmp.path().join("empty"));
        let status = mgr.check_binaries().await;
        assert!(!status.yt_dlp_installed);
        assert!(!status.ffmpeg_installed);
        assert!(status.yt_dlp_version.is_none());
        assert!(status.ffmpeg_version.is_none());
        assert!(status.yt_dlp_path.is_none());
        assert!(status.ffmpeg_path.is_none());
    }
}
