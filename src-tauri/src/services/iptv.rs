//! IPTV Service
//!
//! Parses M3U playlists and provides channel browsing for live TV streaming.

use crate::error::{ArchivistError, Result};
use serde::{Deserialize, Serialize};

// --- Types ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IptvChannel {
    pub id: String,
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub logo: Option<String>,
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default)]
    pub country: Option<String>,
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub tvg_id: Option<String>,
    #[serde(default)]
    pub tvg_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IptvPlaylist {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub url: Option<String>,
    pub channels: Vec<IptvChannel>,
    pub groups: Vec<String>,
    #[serde(default)]
    pub last_updated: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IptvPlaylistSummary {
    pub id: String,
    pub name: String,
    pub channel_count: usize,
    pub group_count: usize,
    pub url: Option<String>,
    pub last_updated: Option<String>,
}

impl IptvPlaylist {
    fn to_summary(&self) -> IptvPlaylistSummary {
        IptvPlaylistSummary {
            id: self.id.clone(),
            name: self.name.clone(),
            channel_count: self.channels.len(),
            group_count: self.groups.len(),
            url: self.url.clone(),
            last_updated: self.last_updated.clone(),
        }
    }
}

// --- M3U Parser ---

/// Parse M3U content into a list of channels
pub fn parse_m3u(content: &str) -> Vec<IptvChannel> {
    let mut channels = Vec::new();
    let lines: Vec<&str> = content.lines().collect();
    let mut i = 0;

    while i < lines.len() {
        let line = lines[i].trim();

        if let Some(extinf) = line.strip_prefix("#EXTINF:") {
            // Parse the EXTINF line

            // Extract attributes
            let tvg_id = extract_attribute(extinf, "tvg-id");
            let tvg_name = extract_attribute(extinf, "tvg-name");
            let tvg_logo = extract_attribute(extinf, "tvg-logo");
            let group_title = extract_attribute(extinf, "group-title");
            let country = extract_attribute(extinf, "tvg-country");
            let language = extract_attribute(extinf, "tvg-language");

            // Channel name is after the last comma
            let channel_name = extinf
                .rfind(',')
                .map(|pos| extinf[pos + 1..].trim().to_string())
                .unwrap_or_default();

            // Next non-empty, non-comment line should be the URL
            i += 1;
            while i < lines.len() {
                let url_line = lines[i].trim();
                if !url_line.is_empty() && !url_line.starts_with('#') {
                    if !channel_name.is_empty() {
                        channels.push(IptvChannel {
                            id: uuid::Uuid::new_v4().to_string(),
                            name: channel_name,
                            url: url_line.to_string(),
                            logo: tvg_logo,
                            group: group_title,
                            country,
                            language,
                            tvg_id,
                            tvg_name,
                        });
                    }
                    break;
                }
                i += 1;
            }
        }

        i += 1;
    }

    channels
}

/// Extract an attribute value from an EXTINF line
fn extract_attribute(line: &str, attr: &str) -> Option<String> {
    let pattern = format!("{}=\"", attr);
    if let Some(start) = line.find(&pattern) {
        let value_start = start + pattern.len();
        if let Some(end) = line[value_start..].find('"') {
            let value = line[value_start..value_start + end].to_string();
            if !value.is_empty() {
                return Some(value);
            }
        }
    }
    None
}

/// Collect unique groups from a list of channels
fn collect_groups(channels: &[IptvChannel]) -> Vec<String> {
    let mut groups: Vec<String> = channels
        .iter()
        .filter_map(|c| c.group.clone())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();
    groups.sort();
    groups
}

// --- IPTV Service ---

pub struct IptvService {
    playlists: Vec<IptvPlaylist>,
    http_client: reqwest::Client,
}

impl IptvService {
    pub fn new() -> Self {
        Self {
            playlists: Vec::new(),
            http_client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .unwrap_or_default(),
        }
    }

    /// Add a playlist from a URL
    pub async fn add_playlist_from_url(
        &mut self,
        url: &str,
        name: &str,
    ) -> Result<IptvPlaylistSummary> {
        let content = self
            .http_client
            .get(url)
            .send()
            .await
            .map_err(|e| ArchivistError::IptvError(format!("Failed to fetch playlist: {}", e)))?
            .text()
            .await
            .map_err(|e| ArchivistError::IptvError(format!("Failed to read playlist: {}", e)))?;

        let channels = parse_m3u(&content);
        let groups = collect_groups(&channels);

        let playlist = IptvPlaylist {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.to_string(),
            url: Some(url.to_string()),
            channels,
            groups,
            last_updated: Some(chrono::Utc::now().to_rfc3339()),
        };

        let summary = playlist.to_summary();
        self.playlists.push(playlist);
        log::info!(
            "Added IPTV playlist '{}' with {} channels",
            name,
            summary.channel_count
        );
        Ok(summary)
    }

    /// Add a playlist from raw M3U content
    pub fn add_playlist_from_content(
        &mut self,
        content: &str,
        name: &str,
    ) -> Result<IptvPlaylistSummary> {
        let channels = parse_m3u(content);
        let groups = collect_groups(&channels);

        let playlist = IptvPlaylist {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.to_string(),
            url: None,
            channels,
            groups,
            last_updated: Some(chrono::Utc::now().to_rfc3339()),
        };

        let summary = playlist.to_summary();
        self.playlists.push(playlist);
        log::info!(
            "Added IPTV playlist '{}' from content with {} channels",
            name,
            summary.channel_count
        );
        Ok(summary)
    }

    /// Remove a playlist
    pub fn remove_playlist(&mut self, id: &str) {
        self.playlists.retain(|p| p.id != id);
        log::info!("Removed IPTV playlist: {}", id);
    }

    /// Refresh a playlist by re-fetching from URL
    pub async fn refresh_playlist(&mut self, id: &str) -> Result<IptvPlaylistSummary> {
        let playlist = self
            .playlists
            .iter()
            .find(|p| p.id == id)
            .ok_or_else(|| ArchivistError::IptvError("Playlist not found".to_string()))?;

        let url = playlist
            .url
            .as_ref()
            .ok_or_else(|| {
                ArchivistError::IptvError("Playlist has no URL, cannot refresh".to_string())
            })?
            .clone();

        let name = playlist.name.clone();

        let content = self
            .http_client
            .get(&url)
            .send()
            .await
            .map_err(|e| ArchivistError::IptvError(format!("Failed to fetch playlist: {}", e)))?
            .text()
            .await
            .map_err(|e| ArchivistError::IptvError(format!("Failed to read playlist: {}", e)))?;

        let channels = parse_m3u(&content);
        let groups = collect_groups(&channels);

        if let Some(playlist) = self.playlists.iter_mut().find(|p| p.id == id) {
            playlist.channels = channels;
            playlist.groups = groups;
            playlist.last_updated = Some(chrono::Utc::now().to_rfc3339());
            let summary = playlist.to_summary();
            log::info!(
                "Refreshed IPTV playlist '{}' with {} channels",
                name,
                summary.channel_count
            );
            return Ok(summary);
        }

        Err(ArchivistError::IptvError("Playlist not found".to_string()))
    }

    /// List all playlists (summary only)
    pub fn list_playlists(&self) -> Vec<IptvPlaylistSummary> {
        self.playlists.iter().map(|p| p.to_summary()).collect()
    }

    /// Get channels from a playlist with optional group and search filters
    pub fn get_channels(
        &self,
        playlist_id: &str,
        group: Option<&str>,
        search: Option<&str>,
    ) -> Result<Vec<IptvChannel>> {
        let playlist = self
            .playlists
            .iter()
            .find(|p| p.id == playlist_id)
            .ok_or_else(|| ArchivistError::IptvError("Playlist not found".to_string()))?;

        let mut channels: Vec<IptvChannel> = playlist.channels.clone();

        // Filter by group
        if let Some(group) = group {
            channels.retain(|c| c.group.as_deref() == Some(group));
        }

        // Filter by search (case-insensitive name match)
        if let Some(search) = search {
            let search_lower = search.to_lowercase();
            channels.retain(|c| c.name.to_lowercase().contains(&search_lower));
        }

        Ok(channels)
    }

    /// Get a single channel by ID
    #[allow(dead_code)]
    pub fn get_channel(&self, playlist_id: &str, channel_id: &str) -> Result<IptvChannel> {
        let playlist = self
            .playlists
            .iter()
            .find(|p| p.id == playlist_id)
            .ok_or_else(|| ArchivistError::IptvError("Playlist not found".to_string()))?;

        playlist
            .channels
            .iter()
            .find(|c| c.id == channel_id)
            .cloned()
            .ok_or_else(|| ArchivistError::IptvError("Channel not found".to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_m3u_basic() {
        let content = r#"#EXTM3U
#EXTINF:-1,Channel One
http://example.com/stream1.m3u8
#EXTINF:-1,Channel Two
http://example.com/stream2.m3u8
#EXTINF:-1,Channel Three
http://example.com/stream3.m3u8
"#;
        let channels = parse_m3u(content);
        assert_eq!(channels.len(), 3);
        assert_eq!(channels[0].name, "Channel One");
        assert_eq!(channels[0].url, "http://example.com/stream1.m3u8");
        assert_eq!(channels[2].name, "Channel Three");
    }

    #[test]
    fn test_parse_m3u_with_all_attributes() {
        let content = r#"#EXTM3U
#EXTINF:-1 tvg-id="bbc1.uk" tvg-name="BBC One" tvg-logo="https://logo.com/bbc1.png" group-title="News" tvg-country="UK" tvg-language="English",BBC One HD
http://example.com/bbc1.m3u8
"#;
        let channels = parse_m3u(content);
        assert_eq!(channels.len(), 1);
        let ch = &channels[0];
        assert_eq!(ch.name, "BBC One HD");
        assert_eq!(ch.tvg_id.as_deref(), Some("bbc1.uk"));
        assert_eq!(ch.tvg_name.as_deref(), Some("BBC One"));
        assert_eq!(ch.logo.as_deref(), Some("https://logo.com/bbc1.png"));
        assert_eq!(ch.group.as_deref(), Some("News"));
        assert_eq!(ch.country.as_deref(), Some("UK"));
        assert_eq!(ch.language.as_deref(), Some("English"));
    }

    #[test]
    fn test_parse_m3u_no_header() {
        let content = r#"#EXTINF:-1,Channel One
http://example.com/stream1.m3u8
"#;
        let channels = parse_m3u(content);
        assert_eq!(channels.len(), 1);
        assert_eq!(channels[0].name, "Channel One");
    }

    #[test]
    fn test_parse_m3u_empty() {
        let channels = parse_m3u("");
        assert_eq!(channels.len(), 0);
    }

    #[test]
    fn test_parse_m3u_malformed_entries() {
        let content = r#"#EXTM3U
#EXTINF:-1,Good Channel
http://example.com/good.m3u8
#EXTINF:-1,
http://example.com/no-name.m3u8
#EXTINF:-1,Another Good
http://example.com/good2.m3u8
"#;
        let channels = parse_m3u(content);
        // Only channels with names should be parsed
        assert_eq!(channels.len(), 2);
        assert_eq!(channels[0].name, "Good Channel");
        assert_eq!(channels[1].name, "Another Good");
    }

    #[test]
    fn test_parse_m3u_unicode_channel_names() {
        let content = r#"#EXTM3U
#EXTINF:-1,日本テレビ
http://example.com/ntv.m3u8
#EXTINF:-1,Телеканал Россия
http://example.com/russia.m3u8
"#;
        let channels = parse_m3u(content);
        assert_eq!(channels.len(), 2);
        assert_eq!(channels[0].name, "日本テレビ");
        assert_eq!(channels[1].name, "Телеканал Россия");
    }

    #[test]
    fn test_groups_collected() {
        let channels = vec![
            IptvChannel {
                id: "1".to_string(),
                name: "Ch1".to_string(),
                url: "http://a".to_string(),
                logo: None,
                group: Some("News".to_string()),
                country: None,
                language: None,
                tvg_id: None,
                tvg_name: None,
            },
            IptvChannel {
                id: "2".to_string(),
                name: "Ch2".to_string(),
                url: "http://b".to_string(),
                logo: None,
                group: Some("Sports".to_string()),
                country: None,
                language: None,
                tvg_id: None,
                tvg_name: None,
            },
            IptvChannel {
                id: "3".to_string(),
                name: "Ch3".to_string(),
                url: "http://c".to_string(),
                logo: None,
                group: Some("News".to_string()),
                country: None,
                language: None,
                tvg_id: None,
                tvg_name: None,
            },
        ];
        let groups = collect_groups(&channels);
        assert_eq!(groups.len(), 2);
        assert!(groups.contains(&"News".to_string()));
        assert!(groups.contains(&"Sports".to_string()));
    }

    #[test]
    fn test_add_playlist_from_content() {
        let mut service = IptvService::new();
        let content = r#"#EXTM3U
#EXTINF:-1 group-title="News",CNN
http://example.com/cnn.m3u8
#EXTINF:-1 group-title="Sports",ESPN
http://example.com/espn.m3u8
"#;
        let summary = service.add_playlist_from_content(content, "Test").unwrap();
        assert_eq!(summary.name, "Test");
        assert_eq!(summary.channel_count, 2);
        assert_eq!(summary.group_count, 2);
    }

    #[test]
    fn test_remove_playlist() {
        let mut service = IptvService::new();
        let content = "#EXTINF:-1,Test\nhttp://test.m3u8";
        let summary = service.add_playlist_from_content(content, "Test").unwrap();
        assert_eq!(service.list_playlists().len(), 1);
        service.remove_playlist(&summary.id);
        assert_eq!(service.list_playlists().len(), 0);
    }

    #[test]
    fn test_get_channels_filter_by_group() {
        let mut service = IptvService::new();
        let content = r#"#EXTM3U
#EXTINF:-1 group-title="News",CNN
http://example.com/cnn.m3u8
#EXTINF:-1 group-title="Sports",ESPN
http://example.com/espn.m3u8
#EXTINF:-1 group-title="News",BBC
http://example.com/bbc.m3u8
"#;
        let summary = service.add_playlist_from_content(content, "Test").unwrap();
        let news = service
            .get_channels(&summary.id, Some("News"), None)
            .unwrap();
        assert_eq!(news.len(), 2);
        let sports = service
            .get_channels(&summary.id, Some("Sports"), None)
            .unwrap();
        assert_eq!(sports.len(), 1);
    }

    #[test]
    fn test_get_channels_search() {
        let mut service = IptvService::new();
        let content = r#"#EXTM3U
#EXTINF:-1,CNN International
http://example.com/cnn.m3u8
#EXTINF:-1,ESPN Sports
http://example.com/espn.m3u8
#EXTINF:-1,BBC World News
http://example.com/bbc.m3u8
"#;
        let summary = service.add_playlist_from_content(content, "Test").unwrap();
        let results = service
            .get_channels(&summary.id, None, Some("news"))
            .unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "BBC World News");
    }

    #[test]
    fn test_extract_attribute() {
        let line = r#"-1 tvg-id="test.id" tvg-name="Test" tvg-logo="http://logo.png" group-title="News",Channel Name"#;
        assert_eq!(
            extract_attribute(line, "tvg-id"),
            Some("test.id".to_string())
        );
        assert_eq!(
            extract_attribute(line, "tvg-name"),
            Some("Test".to_string())
        );
        assert_eq!(
            extract_attribute(line, "tvg-logo"),
            Some("http://logo.png".to_string())
        );
        assert_eq!(
            extract_attribute(line, "group-title"),
            Some("News".to_string())
        );
        assert_eq!(extract_attribute(line, "nonexistent"), None);
    }
}
