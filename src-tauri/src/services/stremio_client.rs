//! Stremio Addon Protocol Client
//!
//! Implements the Stremio addon protocol for browsing catalogs, fetching metadata,
//! and resolving streams from Stremio-compatible addons.

use crate::error::{ArchivistError, Result};
use serde::{Deserialize, Serialize};

// --- Protocol Types ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddonManifest {
    pub id: String,
    pub version: String,
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub logo: Option<String>,
    #[serde(default)]
    pub background: Option<String>,
    #[serde(default)]
    pub types: Vec<String>,
    #[serde(default)]
    pub catalogs: Vec<CatalogDescriptor>,
    #[serde(default)]
    pub resources: Vec<ResourceDescriptor>,
    #[serde(default)]
    pub id_prefixes: Option<Vec<String>>,
    #[serde(default)]
    pub behavior_hints: Option<AddonBehaviorHints>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogDescriptor {
    #[serde(rename = "type")]
    pub content_type: String,
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub extra: Vec<CatalogExtra>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogExtra {
    pub name: String,
    #[serde(default)]
    pub is_required: Option<bool>,
    #[serde(default)]
    pub options: Option<Vec<String>>,
    #[serde(default)]
    pub options_limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ResourceDescriptor {
    Short(String),
    Full(ResourceDescriptorFull),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceDescriptorFull {
    pub name: String,
    #[serde(default)]
    pub types: Vec<String>,
    #[serde(default)]
    pub id_prefixes: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddonBehaviorHints {
    #[serde(default)]
    pub adult: Option<bool>,
    #[serde(default)]
    pub p2p: Option<bool>,
    #[serde(default)]
    pub configurable: Option<bool>,
    #[serde(default)]
    pub configuration_required: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetaItem {
    pub id: String,
    #[serde(rename = "type")]
    pub content_type: String,
    pub name: String,
    #[serde(default)]
    pub poster: Option<String>,
    #[serde(default)]
    pub background: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub release_info: Option<String>,
    #[serde(default)]
    pub runtime: Option<String>,
    #[serde(default)]
    pub genres: Option<Vec<String>>,
    #[serde(default)]
    pub director: Option<Vec<String>>,
    #[serde(default)]
    pub cast: Option<Vec<String>>,
    #[serde(default)]
    pub imdb_rating: Option<String>,
    #[serde(default)]
    pub poster_shape: Option<String>,
    #[serde(default)]
    pub videos: Option<Vec<Video>>,
    #[serde(default)]
    pub links: Option<Vec<MetaLink>>,
    #[serde(default)]
    pub logo: Option<String>,
    #[serde(default)]
    pub year: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Video {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub season: Option<u32>,
    #[serde(default)]
    pub episode: Option<u32>,
    #[serde(default)]
    pub released: Option<String>,
    #[serde(default)]
    pub thumbnail: Option<String>,
    #[serde(default)]
    pub overview: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetaLink {
    pub name: String,
    pub category: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamObject {
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub yt_id: Option<String>,
    #[serde(default)]
    pub info_hash: Option<String>,
    #[serde(default)]
    pub file_idx: Option<u32>,
    #[serde(default)]
    pub external_url: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub behavior_hints: Option<StreamBehaviorHints>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamBehaviorHints {
    #[serde(default)]
    pub not_web_ready: Option<bool>,
    #[serde(default)]
    pub binge_group: Option<String>,
    #[serde(default)]
    pub proxy_headers: Option<ProxyHeaders>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyHeaders {
    #[serde(default)]
    pub request: Option<std::collections::HashMap<String, String>>,
    #[serde(default)]
    pub response: Option<std::collections::HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleObject {
    pub id: String,
    pub url: String,
    pub lang: String,
}

// API Responses
#[derive(Debug, Clone, Deserialize)]
pub struct CatalogResponse {
    pub metas: Vec<MetaItem>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MetaResponse {
    pub meta: MetaItem,
}

#[derive(Debug, Clone, Deserialize)]
pub struct StreamResponse {
    pub streams: Vec<StreamObject>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SubtitleResponse {
    pub subtitles: Vec<SubtitleObject>,
}

// --- Installed Addon ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledAddon {
    pub base_url: String,
    pub manifest: AddonManifest,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamWithAddon {
    pub addon_name: String,
    pub addon_id: String,
    pub stream: StreamObject,
}

// --- Stremio Service ---

pub struct StremioService {
    addons: Vec<InstalledAddon>,
    http_client: reqwest::Client,
}

impl StremioService {
    pub fn new() -> Self {
        Self {
            addons: Vec::new(),
            http_client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(15))
                .build()
                .unwrap_or_default(),
        }
    }

    /// Normalize base URL (remove trailing slashes and /manifest.json)
    fn normalize_url(url: &str) -> String {
        let mut url = url.trim().to_string();
        if url.ends_with("/manifest.json") {
            url = url[..url.len() - "/manifest.json".len()].to_string();
        }
        while url.ends_with('/') {
            url.pop();
        }
        url
    }

    /// Install addon from URL (fetches manifest)
    pub async fn install_addon(&mut self, url: &str) -> Result<InstalledAddon> {
        let base_url = Self::normalize_url(url);
        let manifest_url = format!("{}/manifest.json", base_url);

        // Check if already installed
        if self.addons.iter().any(|a| a.base_url == base_url) {
            return Err(ArchivistError::StremioError(
                "Addon already installed".to_string(),
            ));
        }

        let response = self
            .http_client
            .get(&manifest_url)
            .send()
            .await
            .map_err(|e| {
                ArchivistError::StremioError(format!("Failed to fetch manifest: {}", e))
            })?;

        if !response.status().is_success() {
            return Err(ArchivistError::StremioError(format!(
                "Manifest fetch returned {}",
                response.status()
            )));
        }

        let manifest: AddonManifest = response.json().await.map_err(|e| {
            ArchivistError::StremioError(format!("Failed to parse manifest: {}", e))
        })?;

        let addon = InstalledAddon {
            base_url,
            manifest,
            enabled: true,
        };

        self.addons.push(addon.clone());
        log::info!(
            "Installed Stremio addon: {} ({})",
            addon.manifest.name,
            addon.manifest.id
        );
        Ok(addon)
    }

    /// Remove addon by ID
    pub fn remove_addon(&mut self, addon_id: &str) {
        self.addons.retain(|a| a.manifest.id != addon_id);
        log::info!("Removed Stremio addon: {}", addon_id);
    }

    /// Toggle addon enabled state
    pub fn toggle_addon(&mut self, addon_id: &str, enabled: bool) {
        if let Some(addon) = self.addons.iter_mut().find(|a| a.manifest.id == addon_id) {
            addon.enabled = enabled;
            log::info!("Toggled addon {} enabled={}", addon_id, enabled);
        }
    }

    /// List all installed addons
    pub fn list_addons(&self) -> &[InstalledAddon] {
        &self.addons
    }

    /// Set addons (used for restoring from config)
    #[allow(dead_code)]
    pub fn set_addons(&mut self, addons: Vec<InstalledAddon>) {
        self.addons = addons;
    }

    /// Get catalog from a specific addon
    pub async fn get_catalog(
        &self,
        addon_id: &str,
        content_type: &str,
        catalog_id: &str,
        extra: Option<&str>,
    ) -> Result<Vec<MetaItem>> {
        let addon = self
            .addons
            .iter()
            .find(|a| a.manifest.id == addon_id && a.enabled)
            .ok_or_else(|| {
                ArchivistError::StremioError("Addon not found or disabled".to_string())
            })?;

        let url = if let Some(extra) = extra {
            format!(
                "{}/catalog/{}/{}/{}.json",
                addon.base_url, content_type, catalog_id, extra
            )
        } else {
            format!(
                "{}/catalog/{}/{}.json",
                addon.base_url, content_type, catalog_id
            )
        };

        let response =
            self.http_client.get(&url).send().await.map_err(|e| {
                ArchivistError::StremioError(format!("Catalog fetch failed: {}", e))
            })?;

        if !response.status().is_success() {
            return Err(ArchivistError::StremioError(format!(
                "Catalog fetch returned {}",
                response.status()
            )));
        }

        let catalog: CatalogResponse = response
            .json()
            .await
            .map_err(|e| ArchivistError::StremioError(format!("Failed to parse catalog: {}", e)))?;

        Ok(catalog.metas)
    }

    /// Get metadata for a content item (queries first addon with meta resource)
    pub async fn get_meta(&self, content_type: &str, id: &str) -> Result<MetaItem> {
        for addon in self.addons.iter().filter(|a| a.enabled) {
            if !Self::addon_has_resource(&addon.manifest, "meta", content_type) {
                continue;
            }

            let url = format!("{}/meta/{}/{}.json", addon.base_url, content_type, id);

            match self.http_client.get(&url).send().await {
                Ok(response) if response.status().is_success() => {
                    if let Ok(meta_response) = response.json::<MetaResponse>().await {
                        return Ok(meta_response.meta);
                    }
                }
                _ => continue,
            }
        }

        Err(ArchivistError::StremioError(
            "No addon could provide metadata for this item".to_string(),
        ))
    }

    /// Get streams from ALL enabled addons that support the stream resource
    pub async fn get_streams(
        &self,
        content_type: &str,
        video_id: &str,
    ) -> Result<Vec<StreamWithAddon>> {
        let mut all_streams = Vec::new();

        for addon in self.addons.iter().filter(|a| a.enabled) {
            if !Self::addon_has_resource(&addon.manifest, "stream", content_type) {
                continue;
            }

            let url = format!(
                "{}/stream/{}/{}.json",
                addon.base_url, content_type, video_id
            );

            match self.http_client.get(&url).send().await {
                Ok(response) if response.status().is_success() => {
                    if let Ok(stream_response) = response.json::<StreamResponse>().await {
                        for stream in stream_response.streams {
                            all_streams.push(StreamWithAddon {
                                addon_name: addon.manifest.name.clone(),
                                addon_id: addon.manifest.id.clone(),
                                stream,
                            });
                        }
                    }
                }
                Ok(response) => {
                    log::warn!(
                        "Stream fetch from {} returned {}",
                        addon.manifest.name,
                        response.status()
                    );
                }
                Err(e) => {
                    log::warn!("Stream fetch from {} failed: {}", addon.manifest.name, e);
                }
            }
        }

        Ok(all_streams)
    }

    /// Get subtitles from all subtitle-capable addons
    pub async fn get_subtitles(
        &self,
        content_type: &str,
        video_id: &str,
    ) -> Result<Vec<SubtitleObject>> {
        let mut all_subtitles = Vec::new();

        for addon in self.addons.iter().filter(|a| a.enabled) {
            if !Self::addon_has_resource(&addon.manifest, "subtitles", content_type) {
                continue;
            }

            let url = format!(
                "{}/subtitles/{}/{}.json",
                addon.base_url, content_type, video_id
            );

            match self.http_client.get(&url).send().await {
                Ok(response) if response.status().is_success() => {
                    if let Ok(subtitle_response) = response.json::<SubtitleResponse>().await {
                        all_subtitles.extend(subtitle_response.subtitles);
                    }
                }
                _ => continue,
            }
        }

        Ok(all_subtitles)
    }

    /// Check if an addon manifest declares support for a given resource and type
    fn addon_has_resource(manifest: &AddonManifest, resource: &str, content_type: &str) -> bool {
        for res in &manifest.resources {
            match res {
                ResourceDescriptor::Short(name) => {
                    if name == resource {
                        return true;
                    }
                }
                ResourceDescriptor::Full(full) => {
                    if full.name == resource
                        && (full.types.is_empty() || full.types.contains(&content_type.to_string()))
                    {
                        return true;
                    }
                }
            }
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_addon_manifest() {
        let json = r#"{
            "id": "com.linvo.cinemeta",
            "version": "3.0.12",
            "name": "Cinemeta",
            "description": "The official addon for movie and series catalogs",
            "logo": "https://example.com/logo.png",
            "types": ["movie", "series"],
            "catalogs": [
                {"type": "movie", "id": "top", "name": "Popular"},
                {"type": "series", "id": "top", "name": "Popular"}
            ],
            "resources": ["catalog", "meta", "subtitles"],
            "idPrefixes": ["tt"]
        }"#;

        let manifest: AddonManifest = serde_json::from_str(json).unwrap();
        assert_eq!(manifest.id, "com.linvo.cinemeta");
        assert_eq!(manifest.name, "Cinemeta");
        assert_eq!(manifest.types.len(), 2);
        assert_eq!(manifest.catalogs.len(), 2);
        assert_eq!(manifest.resources.len(), 3);
    }

    #[test]
    fn test_parse_manifest_missing_optional_fields() {
        let json = r#"{
            "id": "minimal.addon",
            "version": "1.0.0",
            "name": "Minimal",
            "description": "A minimal addon"
        }"#;

        let manifest: AddonManifest = serde_json::from_str(json).unwrap();
        assert_eq!(manifest.id, "minimal.addon");
        assert!(manifest.types.is_empty());
        assert!(manifest.catalogs.is_empty());
        assert!(manifest.resources.is_empty());
        assert!(manifest.logo.is_none());
    }

    #[test]
    fn test_resource_descriptor_short_and_full() {
        let json_short = r#""catalog""#;
        let short: ResourceDescriptor = serde_json::from_str(json_short).unwrap();
        assert!(matches!(short, ResourceDescriptor::Short(s) if s == "catalog"));

        let json_full = r#"{"name": "stream", "types": ["movie"], "idPrefixes": ["tt"]}"#;
        let full: ResourceDescriptor = serde_json::from_str(json_full).unwrap();
        assert!(matches!(full, ResourceDescriptor::Full(ref f) if f.name == "stream"));
    }

    #[test]
    fn test_parse_meta_item() {
        let json = r#"{
            "id": "tt1234567",
            "type": "movie",
            "name": "Test Movie",
            "poster": "https://example.com/poster.jpg",
            "description": "A test movie",
            "year": 2024,
            "genres": ["Action", "Drama"],
            "imdbRating": "7.5"
        }"#;

        let meta: MetaItem = serde_json::from_str(json).unwrap();
        assert_eq!(meta.id, "tt1234567");
        assert_eq!(meta.content_type, "movie");
        assert_eq!(meta.name, "Test Movie");
        assert_eq!(meta.year, Some(2024));
        assert_eq!(meta.genres.as_ref().unwrap().len(), 2);
    }

    #[test]
    fn test_parse_stream_object() {
        let json = r#"{
            "infoHash": "abc123def456",
            "fileIdx": 0,
            "name": "Torrentio",
            "title": "1080p WEB-DL"
        }"#;

        let stream: StreamObject = serde_json::from_str(json).unwrap();
        assert_eq!(stream.info_hash.as_deref(), Some("abc123def456"));
        assert_eq!(stream.file_idx, Some(0));
        assert_eq!(stream.name.as_deref(), Some("Torrentio"));
    }

    #[test]
    fn test_parse_stream_with_url() {
        let json = r#"{
            "url": "https://example.com/stream.mp4",
            "name": "Direct",
            "title": "720p"
        }"#;

        let stream: StreamObject = serde_json::from_str(json).unwrap();
        assert_eq!(
            stream.url.as_deref(),
            Some("https://example.com/stream.mp4")
        );
        assert!(stream.info_hash.is_none());
    }

    #[test]
    fn test_normalize_url() {
        assert_eq!(
            StremioService::normalize_url("https://v3-cinemeta.strem.io/manifest.json"),
            "https://v3-cinemeta.strem.io"
        );
        assert_eq!(
            StremioService::normalize_url("https://v3-cinemeta.strem.io/"),
            "https://v3-cinemeta.strem.io"
        );
        assert_eq!(
            StremioService::normalize_url("https://v3-cinemeta.strem.io"),
            "https://v3-cinemeta.strem.io"
        );
    }

    #[test]
    fn test_addon_has_resource_short() {
        let manifest = AddonManifest {
            id: "test".to_string(),
            version: "1.0.0".to_string(),
            name: "Test".to_string(),
            description: "Test".to_string(),
            logo: None,
            background: None,
            types: vec!["movie".to_string()],
            catalogs: vec![],
            resources: vec![
                ResourceDescriptor::Short("catalog".to_string()),
                ResourceDescriptor::Short("stream".to_string()),
            ],
            id_prefixes: None,
            behavior_hints: None,
        };

        assert!(StremioService::addon_has_resource(
            &manifest, "catalog", "movie"
        ));
        assert!(StremioService::addon_has_resource(
            &manifest, "stream", "movie"
        ));
        assert!(!StremioService::addon_has_resource(
            &manifest, "meta", "movie"
        ));
    }

    #[test]
    fn test_addon_has_resource_full() {
        let manifest = AddonManifest {
            id: "test".to_string(),
            version: "1.0.0".to_string(),
            name: "Test".to_string(),
            description: "Test".to_string(),
            logo: None,
            background: None,
            types: vec!["movie".to_string(), "series".to_string()],
            catalogs: vec![],
            resources: vec![ResourceDescriptor::Full(ResourceDescriptorFull {
                name: "stream".to_string(),
                types: vec!["movie".to_string()],
                id_prefixes: None,
            })],
            id_prefixes: None,
            behavior_hints: None,
        };

        assert!(StremioService::addon_has_resource(
            &manifest, "stream", "movie"
        ));
        assert!(!StremioService::addon_has_resource(
            &manifest, "stream", "series"
        ));
    }

    #[test]
    fn test_install_duplicate_addon() {
        let mut service = StremioService::new();
        service.addons.push(InstalledAddon {
            base_url: "https://v3-cinemeta.strem.io".to_string(),
            manifest: AddonManifest {
                id: "com.linvo.cinemeta".to_string(),
                version: "3.0.0".to_string(),
                name: "Cinemeta".to_string(),
                description: "Test".to_string(),
                logo: None,
                background: None,
                types: vec![],
                catalogs: vec![],
                resources: vec![],
                id_prefixes: None,
                behavior_hints: None,
            },
            enabled: true,
        });

        assert_eq!(service.list_addons().len(), 1);
        service.remove_addon("com.linvo.cinemeta");
        assert_eq!(service.list_addons().len(), 0);
    }

    #[test]
    fn test_toggle_addon() {
        let mut service = StremioService::new();
        service.addons.push(InstalledAddon {
            base_url: "https://test.example.com".to_string(),
            manifest: AddonManifest {
                id: "test.addon".to_string(),
                version: "1.0.0".to_string(),
                name: "Test".to_string(),
                description: "Test".to_string(),
                logo: None,
                background: None,
                types: vec![],
                catalogs: vec![],
                resources: vec![],
                id_prefixes: None,
                behavior_hints: None,
            },
            enabled: true,
        });

        assert!(service.list_addons()[0].enabled);
        service.toggle_addon("test.addon", false);
        assert!(!service.list_addons()[0].enabled);
        service.toggle_addon("test.addon", true);
        assert!(service.list_addons()[0].enabled);
    }
}
