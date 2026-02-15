//! Debrid Service Integration
//!
//! Resolves torrent-based streams into direct HTTP links via debrid APIs.
//! Supports Real-Debrid and Premiumize with a provider trait for extensibility.

use crate::error::{ArchivistError, Result};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

// --- Types ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolvedStream {
    pub url: String,
    pub filename: Option<String>,
    pub filesize: Option<u64>,
    pub mime_type: Option<String>,
    pub is_streamable: Option<bool>,
    pub quality: Option<String>,
    pub provider: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheCheckResult {
    pub info_hash: String,
    pub is_cached: bool,
    pub files: Vec<CachedFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedFile {
    pub id: u32,
    pub filename: String,
    pub filesize: u64,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscodeInfo {
    pub apple_hls: Option<String>,
    pub dash: Option<String>,
    pub livemp4: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum DebridProviderType {
    RealDebrid,
    Premiumize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DebridStatus {
    pub configured: bool,
    pub provider_type: Option<String>,
}

// --- Provider Trait ---

#[async_trait]
pub trait DebridProvider: Send + Sync {
    fn provider_type(&self) -> DebridProviderType;
    fn is_configured(&self) -> bool;
    async fn unrestrict_link(&self, url: &str) -> Result<ResolvedStream>;
    async fn check_cache(&self, info_hashes: &[String]) -> Result<Vec<CacheCheckResult>>;
    async fn resolve_magnet(&self, magnet: &str, file_idx: Option<u32>) -> Result<ResolvedStream>;
    async fn validate_token(&self) -> Result<bool>;
}

// --- Real-Debrid Provider ---

pub struct RealDebridProvider {
    token: String,
    client: reqwest::Client,
    base_url: String,
}

impl RealDebridProvider {
    pub fn new(token: &str) -> Self {
        Self {
            token: token.to_string(),
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .unwrap_or_default(),
            base_url: "https://api.real-debrid.com/rest/1.0".to_string(),
        }
    }
}

#[async_trait]
impl DebridProvider for RealDebridProvider {
    fn provider_type(&self) -> DebridProviderType {
        DebridProviderType::RealDebrid
    }

    fn is_configured(&self) -> bool {
        !self.token.is_empty()
    }

    async fn unrestrict_link(&self, url: &str) -> Result<ResolvedStream> {
        #[derive(Deserialize)]
        struct UnrestrictResponse {
            download: String,
            filename: String,
            filesize: u64,
            #[serde(default)]
            #[serde(rename = "mimeType")]
            mime_type: Option<String>,
            #[serde(default)]
            streamable: Option<u8>,
        }

        let response: UnrestrictResponse = self
            .client
            .post(format!("{}/unrestrict/link", self.base_url))
            .header("Authorization", format!("Bearer {}", self.token))
            .form(&[("link", url)])
            .send()
            .await
            .map_err(|e| ArchivistError::DebridError(format!("Unrestrict request failed: {}", e)))?
            .json()
            .await
            .map_err(|e| {
                ArchivistError::DebridError(format!("Failed to parse unrestrict response: {}", e))
            })?;

        Ok(ResolvedStream {
            url: response.download,
            filename: Some(response.filename),
            filesize: Some(response.filesize),
            mime_type: response.mime_type,
            is_streamable: response.streamable.map(|s| s == 1),
            quality: None,
            provider: "Real-Debrid".to_string(),
        })
    }

    async fn check_cache(&self, info_hashes: &[String]) -> Result<Vec<CacheCheckResult>> {
        if info_hashes.is_empty() {
            return Ok(Vec::new());
        }

        let hashes_path = info_hashes.join("/");
        let url = format!(
            "{}/torrents/instantAvailability/{}",
            self.base_url, hashes_path
        );

        let response = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", self.token))
            .send()
            .await
            .map_err(|e| ArchivistError::DebridError(format!("Cache check failed: {}", e)))?;

        let body: serde_json::Value = response.json().await.map_err(|e| {
            ArchivistError::DebridError(format!("Failed to parse cache response: {}", e))
        })?;

        let mut results = Vec::new();
        for hash in info_hashes {
            let hash_lower = hash.to_lowercase();
            let is_cached = body
                .get(&hash_lower)
                .and_then(|v| v.get("rd"))
                .map(|rd| rd.is_array() && !rd.as_array().unwrap_or(&vec![]).is_empty())
                .unwrap_or(false);

            let files = if is_cached {
                body.get(&hash_lower)
                    .and_then(|v| v.get("rd"))
                    .and_then(|rd| rd.as_array())
                    .and_then(|arr| arr.first())
                    .and_then(|obj| obj.as_object())
                    .map(|obj| {
                        obj.iter()
                            .filter_map(|(id, file_info)| {
                                let id = id.parse::<u32>().ok()?;
                                let filename = file_info.get("filename")?.as_str()?.to_string();
                                let filesize = file_info.get("filesize")?.as_u64()?;
                                Some(CachedFile {
                                    id,
                                    filename,
                                    filesize,
                                })
                            })
                            .collect()
                    })
                    .unwrap_or_default()
            } else {
                Vec::new()
            };

            results.push(CacheCheckResult {
                info_hash: hash.clone(),
                is_cached,
                files,
            });
        }

        Ok(results)
    }

    async fn resolve_magnet(&self, magnet: &str, file_idx: Option<u32>) -> Result<ResolvedStream> {
        // Step 1: Add magnet
        #[derive(Deserialize)]
        struct AddMagnetResponse {
            id: String,
        }

        let add_response: AddMagnetResponse = self
            .client
            .post(format!("{}/torrents/addMagnet", self.base_url))
            .header("Authorization", format!("Bearer {}", self.token))
            .form(&[("magnet", magnet)])
            .send()
            .await
            .map_err(|e| ArchivistError::DebridError(format!("Add magnet failed: {}", e)))?
            .json()
            .await
            .map_err(|e| {
                ArchivistError::DebridError(format!("Failed to parse add magnet response: {}", e))
            })?;

        let torrent_id = add_response.id;

        // Step 2: Select files
        let files_param = match file_idx {
            Some(idx) => idx.to_string(),
            None => "all".to_string(),
        };

        self.client
            .post(format!(
                "{}/torrents/selectFiles/{}",
                self.base_url, torrent_id
            ))
            .header("Authorization", format!("Bearer {}", self.token))
            .form(&[("files", &files_param)])
            .send()
            .await
            .map_err(|e| ArchivistError::DebridError(format!("Select files failed: {}", e)))?;

        // Step 3: Poll for completion
        #[derive(Deserialize)]
        struct TorrentInfo {
            status: String,
            links: Vec<String>,
        }

        let mut attempts = 0;
        let max_attempts = 30;

        loop {
            let info: TorrentInfo = self
                .client
                .get(format!("{}/torrents/info/{}", self.base_url, torrent_id))
                .header("Authorization", format!("Bearer {}", self.token))
                .send()
                .await
                .map_err(|e| ArchivistError::DebridError(format!("Torrent info failed: {}", e)))?
                .json()
                .await
                .map_err(|e| {
                    ArchivistError::DebridError(format!("Failed to parse torrent info: {}", e))
                })?;

            if info.status == "downloaded" && !info.links.is_empty() {
                // Step 4: Unrestrict the download link
                return self.unrestrict_link(&info.links[0]).await;
            }

            if info.status == "error" || info.status == "dead" || info.status == "magnet_error" {
                return Err(ArchivistError::DebridError(format!(
                    "Torrent failed with status: {}",
                    info.status
                )));
            }

            attempts += 1;
            if attempts >= max_attempts {
                return Err(ArchivistError::DebridError(
                    "Torrent resolution timed out".to_string(),
                ));
            }

            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        }
    }

    async fn validate_token(&self) -> Result<bool> {
        let response = self
            .client
            .get(format!("{}/user", self.base_url))
            .header("Authorization", format!("Bearer {}", self.token))
            .send()
            .await
            .map_err(|e| {
                ArchivistError::DebridError(format!("Validation request failed: {}", e))
            })?;

        Ok(response.status().is_success())
    }
}

// --- Premiumize Provider ---

pub struct PremiumizeProvider {
    api_key: String,
    client: reqwest::Client,
    base_url: String,
}

impl PremiumizeProvider {
    pub fn new(api_key: &str) -> Self {
        Self {
            api_key: api_key.to_string(),
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .unwrap_or_default(),
            base_url: "https://www.premiumize.me/api".to_string(),
        }
    }
}

#[async_trait]
impl DebridProvider for PremiumizeProvider {
    fn provider_type(&self) -> DebridProviderType {
        DebridProviderType::Premiumize
    }

    fn is_configured(&self) -> bool {
        !self.api_key.is_empty()
    }

    async fn unrestrict_link(&self, url: &str) -> Result<ResolvedStream> {
        #[derive(Deserialize)]
        struct DirectDlResponse {
            status: String,
            content: Option<Vec<DirectDlContent>>,
            location: Option<String>,
        }

        #[derive(Deserialize)]
        struct DirectDlContent {
            path: Option<String>,
            size: Option<u64>,
            link: Option<String>,
            stream_link: Option<String>,
        }

        let response: DirectDlResponse = self
            .client
            .post(format!("{}/transfer/directdl", self.base_url))
            .form(&[("apikey", &self.api_key), ("src", &url.to_string())])
            .send()
            .await
            .map_err(|e| ArchivistError::DebridError(format!("DirectDL request failed: {}", e)))?
            .json()
            .await
            .map_err(|e| {
                ArchivistError::DebridError(format!("Failed to parse DirectDL response: {}", e))
            })?;

        if response.status != "success" {
            return Err(ArchivistError::DebridError(format!(
                "DirectDL failed with status: {}",
                response.status
            )));
        }

        // Try location first (single file), then content array
        if let Some(location) = response.location {
            return Ok(ResolvedStream {
                url: location,
                filename: None,
                filesize: None,
                mime_type: None,
                is_streamable: Some(true),
                quality: None,
                provider: "Premiumize".to_string(),
            });
        }

        if let Some(content) = response.content {
            // Find the largest file (usually the video)
            if let Some(file) = content.iter().max_by_key(|c| c.size.unwrap_or(0)) {
                let url = file
                    .stream_link
                    .clone()
                    .or_else(|| file.link.clone())
                    .ok_or_else(|| {
                        ArchivistError::DebridError("No download link in response".to_string())
                    })?;

                return Ok(ResolvedStream {
                    url,
                    filename: file.path.clone(),
                    filesize: file.size,
                    mime_type: None,
                    is_streamable: Some(true),
                    quality: None,
                    provider: "Premiumize".to_string(),
                });
            }
        }

        Err(ArchivistError::DebridError(
            "No content in DirectDL response".to_string(),
        ))
    }

    async fn check_cache(&self, info_hashes: &[String]) -> Result<Vec<CacheCheckResult>> {
        if info_hashes.is_empty() {
            return Ok(Vec::new());
        }

        let items: Vec<(&str, String)> =
            info_hashes.iter().map(|h| ("items[]", h.clone())).collect();

        let mut params = vec![("apikey", self.api_key.clone())];
        for (k, v) in &items {
            params.push((k, v.clone()));
        }

        #[derive(Deserialize)]
        struct CacheCheckResponse {
            #[allow(dead_code)]
            status: String,
            response: Option<Vec<bool>>,
        }

        let response: CacheCheckResponse = self
            .client
            .post(format!("{}/cache/check", self.base_url))
            .form(&params)
            .send()
            .await
            .map_err(|e| ArchivistError::DebridError(format!("Cache check failed: {}", e)))?
            .json()
            .await
            .map_err(|e| {
                ArchivistError::DebridError(format!("Failed to parse cache response: {}", e))
            })?;

        let cached_flags = response.response.unwrap_or_default();
        let results = info_hashes
            .iter()
            .enumerate()
            .map(|(i, hash)| CacheCheckResult {
                info_hash: hash.clone(),
                is_cached: cached_flags.get(i).copied().unwrap_or(false),
                files: Vec::new(),
            })
            .collect();

        Ok(results)
    }

    async fn resolve_magnet(&self, magnet: &str, _file_idx: Option<u32>) -> Result<ResolvedStream> {
        // Premiumize can resolve magnets directly via directdl
        self.unrestrict_link(magnet).await
    }

    async fn validate_token(&self) -> Result<bool> {
        #[derive(Deserialize)]
        struct AccountInfo {
            status: String,
        }

        let response = self
            .client
            .get(format!(
                "{}/account/info?apikey={}",
                self.base_url, self.api_key
            ))
            .send()
            .await
            .map_err(|e| {
                ArchivistError::DebridError(format!("Validation request failed: {}", e))
            })?;

        if !response.status().is_success() {
            return Ok(false);
        }

        let info: AccountInfo = response.json().await.map_err(|e| {
            ArchivistError::DebridError(format!("Failed to parse account info: {}", e))
        })?;

        Ok(info.status == "success")
    }
}

// --- Debrid Service (compositor) ---

pub struct DebridService {
    provider: Option<Box<dyn DebridProvider>>,
}

impl DebridService {
    pub fn new() -> Self {
        Self { provider: None }
    }

    pub fn configure_real_debrid(&mut self, token: &str) {
        self.provider = Some(Box::new(RealDebridProvider::new(token)));
        log::info!("Configured Real-Debrid provider");
    }

    pub fn configure_premiumize(&mut self, api_key: &str) {
        self.provider = Some(Box::new(PremiumizeProvider::new(api_key)));
        log::info!("Configured Premiumize provider");
    }

    pub fn clear_provider(&mut self) {
        self.provider = None;
        log::info!("Cleared debrid provider");
    }

    pub fn get_status(&self) -> DebridStatus {
        match &self.provider {
            Some(p) => DebridStatus {
                configured: p.is_configured(),
                provider_type: Some(match p.provider_type() {
                    DebridProviderType::RealDebrid => "real_debrid".to_string(),
                    DebridProviderType::Premiumize => "premiumize".to_string(),
                }),
            },
            None => DebridStatus {
                configured: false,
                provider_type: None,
            },
        }
    }

    pub async fn validate_token(&self) -> Result<bool> {
        let provider = self
            .provider
            .as_ref()
            .ok_or_else(|| ArchivistError::DebridError("No provider configured".to_string()))?;
        provider.validate_token().await
    }

    pub async fn unrestrict_link(&self, url: &str) -> Result<ResolvedStream> {
        let provider = self
            .provider
            .as_ref()
            .ok_or_else(|| ArchivistError::DebridError("No provider configured".to_string()))?;
        provider.unrestrict_link(url).await
    }

    pub async fn check_cache(&self, info_hashes: &[String]) -> Result<Vec<CacheCheckResult>> {
        let provider = self
            .provider
            .as_ref()
            .ok_or_else(|| ArchivistError::DebridError("No provider configured".to_string()))?;
        provider.check_cache(info_hashes).await
    }

    pub async fn resolve_magnet(
        &self,
        magnet: &str,
        file_idx: Option<u32>,
    ) -> Result<ResolvedStream> {
        let provider = self
            .provider
            .as_ref()
            .ok_or_else(|| ArchivistError::DebridError("No provider configured".to_string()))?;
        provider.resolve_magnet(magnet, file_idx).await
    }

    /// Resolve a Stremio StreamObject through debrid
    pub async fn resolve_stream(
        &self,
        stream: &crate::services::stremio_client::StreamObject,
    ) -> Result<ResolvedStream> {
        if let Some(ref url) = stream.url {
            return self.unrestrict_link(url).await;
        }

        if let Some(ref info_hash) = stream.info_hash {
            let magnet = format!("magnet:?xt=urn:btih:{}", info_hash);
            return self.resolve_magnet(&magnet, stream.file_idx).await;
        }

        Err(ArchivistError::DebridError(
            "Stream has no URL or infoHash to resolve".to_string(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_debrid_service_not_configured() {
        let service = DebridService::new();
        let status = service.get_status();
        assert!(!status.configured);
        assert!(status.provider_type.is_none());
    }

    #[test]
    fn test_debrid_service_configure_real_debrid() {
        let mut service = DebridService::new();
        service.configure_real_debrid("test_token");
        let status = service.get_status();
        assert!(status.configured);
        assert_eq!(status.provider_type, Some("real_debrid".to_string()));
    }

    #[test]
    fn test_debrid_service_configure_premiumize() {
        let mut service = DebridService::new();
        service.configure_premiumize("test_key");
        let status = service.get_status();
        assert!(status.configured);
        assert_eq!(status.provider_type, Some("premiumize".to_string()));
    }

    #[test]
    fn test_debrid_service_configure_switch() {
        let mut service = DebridService::new();
        service.configure_real_debrid("rd_token");
        assert_eq!(
            service.get_status().provider_type,
            Some("real_debrid".to_string())
        );

        service.configure_premiumize("pm_key");
        assert_eq!(
            service.get_status().provider_type,
            Some("premiumize".to_string())
        );
    }

    #[test]
    fn test_debrid_service_clear() {
        let mut service = DebridService::new();
        service.configure_real_debrid("test_token");
        assert!(service.get_status().configured);

        service.clear_provider();
        assert!(!service.get_status().configured);
    }

    #[tokio::test]
    async fn test_debrid_service_resolve_stream_no_source() {
        let mut service = DebridService::new();
        service.configure_real_debrid("token");

        // Test the no-source case (stream with no URL or infoHash)
        let stream = crate::services::stremio_client::StreamObject {
            url: None,
            yt_id: None,
            info_hash: None,
            file_idx: None,
            external_url: None,
            name: None,
            title: None,
            behavior_hints: None,
        };

        let result = service.resolve_stream(&stream).await;
        assert!(result.is_err());
    }
}
