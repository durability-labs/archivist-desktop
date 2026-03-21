use crate::error::{ArchivistError, Result};
use regex::Regex;
use reqwest::header::RETRY_AFTER;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use tokio::sync::watch;
// url::Url not needed — base_url stored as String to avoid trailing-slash issues

// ---------------------------------------------------------------------------
// Data models (normalized from Discourse JSON API)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscourseCategory {
    pub id: u64,
    pub name: String,
    pub slug: String,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub topic_count: u32,
    #[serde(default)]
    pub post_count: u32,
    #[serde(default)]
    pub description_text: Option<String>,
    #[serde(default)]
    pub position: u32,
    #[serde(default)]
    pub read_restricted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Poster {
    #[serde(default)]
    pub user_id: Option<u64>,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscourseTopic {
    pub id: u64,
    pub title: String,
    #[serde(default)]
    pub slug: String,
    #[serde(default)]
    pub category_id: Option<u64>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub last_posted_at: Option<String>,
    #[serde(default)]
    pub posts_count: u32,
    #[serde(default)]
    pub reply_count: u32,
    #[serde(default)]
    pub views: u32,
    #[serde(default)]
    pub like_count: u32,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub closed: bool,
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub visible: bool,
    #[serde(default)]
    pub excerpt: Option<String>,
    #[serde(default)]
    pub posters: Vec<Poster>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoursePost {
    pub id: u64,
    pub topic_id: u64,
    #[serde(default)]
    pub post_number: u32,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub user_id: u64,
    #[serde(default)]
    pub cooked: String,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub reply_to_post_number: Option<u32>,
    #[serde(default)]
    pub reply_count: u32,
    #[serde(default)]
    pub like_count: u32,
    #[serde(default)]
    pub trust_level: u32,
    #[serde(default)]
    pub score: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscourseUser {
    pub username: String,
    pub id: u64,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub avatar_template: Option<String>,
    #[serde(default)]
    pub bio_excerpt: Option<String>,
    #[serde(default)]
    pub trust_level: u32,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub moderator: bool,
    #[serde(default)]
    pub admin: bool,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub badge_count: u32,
    #[serde(default)]
    pub last_posted_at: Option<String>,
    #[serde(default)]
    pub profile_view_count: u32,
    /// Local avatar filename after download (set by site builder)
    #[serde(default)]
    pub avatar_local: Option<String>,
}

// ---------------------------------------------------------------------------
// Crawl state for resumability
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CrawlState {
    pub visited_topic_ids: HashSet<u64>,
    pub visited_usernames: HashSet<String>,
    pub latest_pages_completed: u32,
    pub categories_done: bool,
}

impl CrawlState {
    fn load(path: &PathBuf) -> Option<Self> {
        let data = std::fs::read_to_string(path).ok()?;
        serde_json::from_str(&data).ok()
    }

    fn save(&self, path: &PathBuf) {
        if let Ok(json) = serde_json::to_string_pretty(self) {
            let tmp = path.with_extension("tmp");
            if std::fs::write(&tmp, &json).is_ok() {
                let _ = std::fs::rename(&tmp, path);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Progress callback
// ---------------------------------------------------------------------------

#[allow(dead_code)]
pub struct ScrapeProgress {
    pub topics_found: u32,
    pub topics_scraped: u32,
    pub posts_found: u32,
    pub users_found: u32,
    pub phase: String,
}

// ---------------------------------------------------------------------------
// Discourse Scraper
// ---------------------------------------------------------------------------

const MAX_POST_IDS_PER_REQUEST: usize = 20;
const CRAWL_STATE_FLUSH_INTERVAL: u32 = 50;

pub struct DiscourseScraper {
    client: reqwest::Client,
    base_url: String,
    cancel_rx: watch::Receiver<bool>,
    pause_rx: watch::Receiver<bool>,
    request_delay_ms: u64,
    pub categories: Vec<DiscourseCategory>,
    pub topics: Vec<DiscourseTopic>,
    pub posts: Vec<DiscoursePost>,
    pub users: Vec<DiscourseUser>,
    pub image_urls: HashSet<String>,
    pub avatar_urls: HashMap<String, String>, // username -> avatar URL
    crawl_state: CrawlState,
    state_path: Option<PathBuf>,
    items_since_flush: u32,
    pub forum_title: String,
}

impl DiscourseScraper {
    pub fn new(
        base_url: &str,
        cancel_rx: watch::Receiver<bool>,
        pause_rx: watch::Receiver<bool>,
        request_delay_ms: u64,
        state_path: Option<PathBuf>,
    ) -> Result<Self> {
        // Parse and re-serialize to validate, then store as String without trailing slash
        let parsed = url::Url::parse(base_url.trim_end_matches('/'))
            .map_err(|e| ArchivistError::WebArchiveError(format!("Invalid URL: {}", e)))?;
        let base_url = parsed.as_str().trim_end_matches('/').to_string();

        let client = reqwest::Client::builder()
            .user_agent("Mozilla/5.0 (compatible; ArchivistBot/1.0; +https://archivist.storage)")
            .timeout(std::time::Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::limited(5))
            .cookie_store(true)
            .build()
            .map_err(|e| {
                ArchivistError::WebArchiveError(format!("Failed to build HTTP client: {}", e))
            })?;

        let crawl_state = state_path
            .as_ref()
            .and_then(CrawlState::load)
            .unwrap_or_default();

        Ok(Self {
            client,
            base_url,
            cancel_rx,
            pause_rx,
            request_delay_ms,
            categories: Vec::new(),
            topics: Vec::new(),
            posts: Vec::new(),
            users: Vec::new(),
            image_urls: HashSet::new(),
            avatar_urls: HashMap::new(),
            crawl_state,
            state_path,
            items_since_flush: 0,
            forum_title: String::new(),
        })
    }

    /// Auto-detect if a URL is a Discourse forum by checking /site.json
    pub async fn detect_discourse(url: &str) -> bool {
        let client = reqwest::Client::builder()
            .user_agent("Mozilla/5.0 (compatible; ArchivistBot/1.0)")
            .timeout(std::time::Duration::from_secs(10))
            .build();

        let client = match client {
            Ok(c) => c,
            Err(_) => return false,
        };

        let base = url.trim_end_matches('/');
        let site_url = format!("{}/site.json", base);

        match client.get(&site_url).send().await {
            Ok(resp) => {
                if !resp.status().is_success() {
                    return false;
                }
                match resp.json::<serde_json::Value>().await {
                    Ok(json) => {
                        // Discourse /site.json has specific keys
                        json.get("default_archetype").is_some()
                            || json.get("uncategorized_category_id").is_some()
                            || json.get("topic_flag_types").is_some()
                    }
                    Err(_) => false,
                }
            }
            Err(_) => false,
        }
    }

    /// Scrape forum title from /site.json
    pub async fn scrape_site_info(&mut self) -> Result<()> {
        self.check_cancelled()?;
        let url = format!("{}/site.json", self.base_url);
        let resp = self.get_json(&url).await?;

        if let Some(title) = resp
            .get("title")
            .or_else(|| resp.get("description"))
            .and_then(|v| v.as_str())
        {
            self.forum_title = title.to_string();
        }

        if self.forum_title.is_empty() {
            self.forum_title = url::Url::parse(&self.base_url)
                .ok()
                .and_then(|u| u.host_str().map(|s| s.to_string()))
                .unwrap_or_else(|| "Forum".to_string());
        }

        Ok(())
    }

    /// Scrape categories from /categories.json
    pub async fn scrape_categories(&mut self) -> Result<()> {
        if self.crawl_state.categories_done {
            log::info!("Categories already scraped, skipping");
            return Ok(());
        }
        self.check_cancelled()?;

        let url = format!("{}/categories.json", self.base_url);
        let json = self.get_json(&url).await?;

        if let Some(cats) = json
            .pointer("/category_list/categories")
            .and_then(|v| v.as_array())
        {
            for raw in cats {
                let cat = normalize_category(raw);
                self.categories.push(cat);
            }
        }

        self.crawl_state.categories_done = true;
        self.maybe_flush_state();
        log::info!("Scraped {} categories", self.categories.len());
        Ok(())
    }

    /// Scrape topics from /latest.json with pagination
    pub async fn scrape_topics<F>(&mut self, max_topics: Option<u32>, on_progress: &F) -> Result<()>
    where
        F: Fn(&ScrapeProgress),
    {
        let max_topics = max_topics.unwrap_or(u32::MAX);
        let start_page = self.crawl_state.latest_pages_completed;
        let mut page = start_page;

        loop {
            if self.wait_paused_or_cancelled().await {
                return Err(ArchivistError::WebArchiveError("cancelled".to_string()));
            }

            if self.topics.len() as u32 >= max_topics {
                break;
            }

            let url = format!("{}/latest.json?page={}", self.base_url, page);
            let json = match self.get_json(&url).await {
                Ok(j) => j,
                Err(e) => {
                    if page == start_page {
                        // First page failure is fatal — no topics at all
                        return Err(e);
                    }
                    log::warn!(
                        "Failed to fetch latest page {}, stopping pagination: {}",
                        page,
                        e
                    );
                    break;
                }
            };

            let topics_array = json
                .pointer("/topic_list/topics")
                .and_then(|v| v.as_array());

            match topics_array {
                Some(topics) if !topics.is_empty() => {
                    for raw in topics {
                        if self.topics.len() as u32 >= max_topics {
                            break;
                        }
                        let topic = normalize_topic(raw);
                        if !self.crawl_state.visited_topic_ids.contains(&topic.id) {
                            self.topics.push(topic);
                        }
                    }
                }
                _ => break,
            }

            self.crawl_state.latest_pages_completed = page + 1;
            self.maybe_flush_state();
            page += 1;

            on_progress(&ScrapeProgress {
                topics_found: self.topics.len() as u32,
                topics_scraped: self.crawl_state.visited_topic_ids.len() as u32,
                posts_found: self.posts.len() as u32,
                users_found: self.users.len() as u32,
                phase: "Discovering topics".to_string(),
            });

            // Check if there are more topics
            let has_more = json
                .pointer("/topic_list/more_topics_url")
                .and_then(|v| v.as_str())
                .is_some();
            if !has_more {
                break;
            }

            self.polite_delay().await;
        }

        log::info!("Found {} topics", self.topics.len());
        Ok(())
    }

    /// Scrape all posts for all discovered topics
    pub async fn scrape_all_topic_posts<F>(&mut self, on_progress: &F) -> Result<()>
    where
        F: Fn(&ScrapeProgress),
    {
        let topic_ids: Vec<(u64, String)> = self
            .topics
            .iter()
            .filter(|t| !self.crawl_state.visited_topic_ids.contains(&t.id))
            .map(|t| (t.id, t.slug.clone()))
            .collect();

        let total_to_scrape = topic_ids.len();
        for (idx, (topic_id, slug)) in topic_ids.into_iter().enumerate() {
            if self.wait_paused_or_cancelled().await {
                return Err(ArchivistError::WebArchiveError("cancelled".to_string()));
            }

            self.scrape_topic_posts(topic_id, &slug).await?;
            self.crawl_state.visited_topic_ids.insert(topic_id);
            self.items_since_flush += 1;
            self.maybe_flush_state();

            if (idx + 1) % 25 == 0 || idx + 1 == total_to_scrape {
                log::info!(
                    "Topic posts: {}/{} topics scraped, {} posts collected",
                    idx + 1,
                    total_to_scrape,
                    self.posts.len()
                );
            }

            on_progress(&ScrapeProgress {
                topics_found: self.topics.len() as u32,
                topics_scraped: self.crawl_state.visited_topic_ids.len() as u32,
                posts_found: self.posts.len() as u32,
                users_found: self.users.len() as u32,
                phase: "Scraping topics".to_string(),
            });

            self.polite_delay().await;
        }

        Ok(())
    }

    /// Scrape posts for a single topic
    async fn scrape_topic_posts(&mut self, topic_id: u64, slug: &str) -> Result<()> {
        let url = format!("{}/t/{}/{}.json", self.base_url, slug, topic_id);
        let json = self.get_json(&url).await?;

        // Extract posts from the topic response
        let initial_posts = json
            .pointer("/post_stream/posts")
            .and_then(|v| v.as_array());

        if let Some(posts) = initial_posts {
            for raw in posts {
                let post = normalize_post(raw, topic_id);
                self.posts.push(post);
            }
        }

        // Check for remaining post IDs
        let all_post_ids: Vec<u64> = json
            .pointer("/post_stream/stream")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_u64()).collect())
            .unwrap_or_default();

        let fetched_ids: HashSet<u64> = initial_posts
            .map(|posts| {
                posts
                    .iter()
                    .filter_map(|p| p.get("id").and_then(|v| v.as_u64()))
                    .collect()
            })
            .unwrap_or_default();

        let remaining_ids: Vec<u64> = all_post_ids
            .into_iter()
            .filter(|id| !fetched_ids.contains(id))
            .collect();

        // Fetch remaining posts in batches
        for chunk in remaining_ids.chunks(MAX_POST_IDS_PER_REQUEST) {
            if self.wait_paused_or_cancelled().await {
                return Err(ArchivistError::WebArchiveError("cancelled".to_string()));
            }

            let ids_param: Vec<String> = chunk
                .iter()
                .map(|id| format!("post_ids[]={}", id))
                .collect();
            let url = format!(
                "{}/t/{}/posts.json?{}",
                self.base_url,
                topic_id,
                ids_param.join("&")
            );

            match self.get_json(&url).await {
                Ok(json) => {
                    // Response can be {"post_stream": {"posts": [...]}} or {"posts": [...]}
                    let posts_array = json
                        .pointer("/post_stream/posts")
                        .or_else(|| json.get("posts"))
                        .and_then(|v| v.as_array());

                    if let Some(posts) = posts_array {
                        for raw in posts {
                            let post = normalize_post(raw, topic_id);
                            self.posts.push(post);
                        }
                    }
                }
                Err(e) => {
                    log::warn!("Failed to fetch posts batch for topic {}: {}", topic_id, e);
                }
            }

            self.polite_delay().await;
        }

        Ok(())
    }

    /// Scrape user profiles for all users seen in posts
    pub async fn scrape_users<F>(&mut self, on_progress: &F) -> Result<()>
    where
        F: Fn(&ScrapeProgress),
    {
        // Collect unique usernames from posts
        let usernames: Vec<String> = self
            .posts
            .iter()
            .map(|p| p.username.clone())
            .collect::<HashSet<_>>()
            .into_iter()
            .filter(|u| !self.crawl_state.visited_usernames.contains(u))
            .collect();

        let total_users = usernames.len();
        log::info!("Scraping {} user profiles", total_users);
        for (idx, username) in usernames.into_iter().enumerate() {
            if self.wait_paused_or_cancelled().await {
                return Err(ArchivistError::WebArchiveError("cancelled".to_string()));
            }

            if (idx + 1) % 25 == 0 || idx + 1 == total_users {
                log::info!("User profiles: {}/{} scraped", idx + 1, total_users);
            }

            match self.scrape_user(&username).await {
                Ok(user) => {
                    self.users.push(user);
                }
                Err(e) => {
                    log::warn!("Failed to scrape user {}: {}", username, e);
                }
            }

            self.crawl_state.visited_usernames.insert(username);
            self.items_since_flush += 1;
            self.maybe_flush_state();

            on_progress(&ScrapeProgress {
                topics_found: self.topics.len() as u32,
                topics_scraped: self.crawl_state.visited_topic_ids.len() as u32,
                posts_found: self.posts.len() as u32,
                users_found: self.users.len() as u32,
                phase: "Scraping user profiles".to_string(),
            });

            self.polite_delay().await;
        }

        Ok(())
    }

    /// Scrape a single user profile
    async fn scrape_user(&self, username: &str) -> Result<DiscourseUser> {
        let url = format!("{}/u/{}.json", self.base_url, username);
        let json = self.get_json(&url).await?;

        let user_obj = json.get("user").unwrap_or(&json);
        Ok(normalize_user(user_obj))
    }

    /// Collect all image URLs from posts and avatar templates
    pub fn collect_image_urls(&mut self) {
        let img_re = Regex::new(r#"<img[^>]+src=["']([^"']+)["']"#).unwrap();

        for post in &self.posts {
            for cap in img_re.captures_iter(&post.cooked) {
                if let Some(url) = cap.get(1) {
                    let url_str = url.as_str().to_string();
                    // Skip data URIs
                    if !url_str.starts_with("data:") {
                        self.image_urls.insert(url_str);
                    }
                }
            }
        }

        for user in &self.users {
            if let Some(ref tmpl) = user.avatar_template {
                let avatar_url = self.resolve_avatar_url(tmpl, 120);
                self.avatar_urls.insert(user.username.clone(), avatar_url);
            }
        }

        log::info!(
            "Collected {} post images and {} avatar URLs",
            self.image_urls.len(),
            self.avatar_urls.len()
        );
    }

    /// Resolve an avatar template URL to a full URL
    pub fn resolve_avatar_url(&self, template: &str, size: u32) -> String {
        let url = template.replace("{size}", &size.to_string());
        if url.starts_with("//") {
            format!("https:{}", url)
        } else if url.starts_with('/') {
            format!("{}{}", self.base_url, url)
        } else {
            url
        }
    }

    /// Resolve any relative URL to absolute
    pub fn resolve_url(&self, url: &str) -> String {
        if url.starts_with("//") {
            format!("https:{}", url)
        } else if url.starts_with('/') {
            format!("{}{}", self.base_url, url)
        } else {
            url.to_string()
        }
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    async fn get_json(&self, url: &str) -> Result<serde_json::Value> {
        let mut retries = 0;
        loop {
            let resp = self
                .client
                .get(url)
                .header("Accept", "application/json")
                .send()
                .await
                .map_err(|e| ArchivistError::WebArchiveError(format!("Request failed: {}", e)))?;

            let status = resp.status();
            log::debug!("GET {} -> {}", url, status);
            if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
                if retries >= 3 {
                    return Err(ArchivistError::WebArchiveError(
                        "Too many rate limit retries".to_string(),
                    ));
                }
                let delay = resp
                    .headers()
                    .get(RETRY_AFTER)
                    .and_then(|v| v.to_str().ok())
                    .and_then(|s| s.parse::<u64>().ok())
                    .unwrap_or(10)
                    .min(120);
                log::warn!("Rate limited, waiting {}s before retry", delay);
                tokio::time::sleep(tokio::time::Duration::from_secs(delay)).await;
                retries += 1;
                continue;
            }

            if !status.is_success() {
                return Err(ArchivistError::WebArchiveError(format!(
                    "HTTP {} for {}",
                    status, url
                )));
            }

            return resp
                .json::<serde_json::Value>()
                .await
                .map_err(|e| ArchivistError::WebArchiveError(format!("JSON parse error: {}", e)));
        }
    }

    fn check_cancelled(&self) -> Result<()> {
        if *self.cancel_rx.borrow() {
            Err(ArchivistError::WebArchiveError("cancelled".to_string()))
        } else {
            Ok(())
        }
    }

    async fn wait_paused_or_cancelled(&self) -> bool {
        while *self.pause_rx.borrow() {
            if *self.cancel_rx.borrow() {
                return true;
            }
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        }
        *self.cancel_rx.borrow()
    }

    async fn polite_delay(&self) {
        if self.request_delay_ms > 0 {
            tokio::time::sleep(tokio::time::Duration::from_millis(self.request_delay_ms)).await;
        }
    }

    fn maybe_flush_state(&mut self) {
        if self.items_since_flush >= CRAWL_STATE_FLUSH_INTERVAL {
            if let Some(ref path) = self.state_path {
                self.crawl_state.save(path);
            }
            self.items_since_flush = 0;
        }
    }

    /// Save final state
    pub fn save_state(&self) {
        if let Some(ref path) = self.state_path {
            self.crawl_state.save(path);
        }
    }

    /// Clean up state file after successful completion
    #[allow(dead_code)]
    pub fn cleanup_state(&self) {
        if let Some(ref path) = self.state_path {
            let _ = std::fs::remove_file(path);
        }
    }
}

// ---------------------------------------------------------------------------
// Normalization functions (matching scraper.py)
// ---------------------------------------------------------------------------

fn normalize_topic(raw: &serde_json::Value) -> DiscourseTopic {
    let posters: Vec<Poster> = raw
        .get("posters")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .map(|p| Poster {
                    user_id: p.get("user_id").and_then(|v| v.as_u64()),
                    description: p
                        .get("description")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                })
                .collect()
        })
        .unwrap_or_default();

    DiscourseTopic {
        id: raw.get("id").and_then(|v| v.as_u64()).unwrap_or(0),
        title: raw
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        slug: raw
            .get("slug")
            .and_then(|v| v.as_str())
            .unwrap_or("topic")
            .to_string(),
        category_id: raw.get("category_id").and_then(|v| v.as_u64()),
        created_at: raw
            .get("created_at")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        last_posted_at: raw
            .get("last_posted_at")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        posts_count: raw.get("posts_count").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
        reply_count: raw.get("reply_count").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
        views: raw.get("views").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
        like_count: raw.get("like_count").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
        tags: raw
            .get("tags")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default(),
        closed: raw.get("closed").and_then(|v| v.as_bool()).unwrap_or(false),
        archived: raw
            .get("archived")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        pinned: raw.get("pinned").and_then(|v| v.as_bool()).unwrap_or(false),
        visible: raw.get("visible").and_then(|v| v.as_bool()).unwrap_or(true),
        excerpt: raw
            .get("excerpt")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        posters,
    }
}

fn normalize_post(raw: &serde_json::Value, topic_id: u64) -> DiscoursePost {
    DiscoursePost {
        id: raw.get("id").and_then(|v| v.as_u64()).unwrap_or(0),
        topic_id: raw
            .get("topic_id")
            .and_then(|v| v.as_u64())
            .unwrap_or(topic_id),
        post_number: raw.get("post_number").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
        username: raw
            .get("username")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        user_id: raw.get("user_id").and_then(|v| v.as_u64()).unwrap_or(0),
        cooked: raw
            .get("cooked")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        created_at: raw
            .get("created_at")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        reply_to_post_number: raw
            .get("reply_to_post_number")
            .and_then(|v| v.as_u64())
            .map(|n| n as u32),
        reply_count: raw.get("reply_count").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
        like_count: raw.get("like_count").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
        trust_level: raw.get("trust_level").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
        score: raw.get("score").and_then(|v| v.as_f64()),
    }
}

fn normalize_user(raw: &serde_json::Value) -> DiscourseUser {
    DiscourseUser {
        username: raw
            .get("username")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        id: raw.get("id").and_then(|v| v.as_u64()).unwrap_or(0),
        name: raw
            .get("name")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        avatar_template: raw
            .get("avatar_template")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        bio_excerpt: raw
            .get("bio_excerpt")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        trust_level: raw.get("trust_level").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
        created_at: raw
            .get("created_at")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        moderator: raw
            .get("moderator")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        admin: raw.get("admin").and_then(|v| v.as_bool()).unwrap_or(false),
        title: raw
            .get("title")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        badge_count: raw.get("badge_count").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
        last_posted_at: raw
            .get("last_posted_at")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        profile_view_count: raw
            .get("profile_view_count")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u32,
        avatar_local: None,
    }
}

fn normalize_category(raw: &serde_json::Value) -> DiscourseCategory {
    let desc_html = raw
        .get("description")
        .or_else(|| raw.get("description_text"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let desc_text = strip_html(desc_html);

    DiscourseCategory {
        id: raw.get("id").and_then(|v| v.as_u64()).unwrap_or(0),
        name: raw
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        slug: raw
            .get("slug")
            .and_then(|v| v.as_str())
            .unwrap_or("uncategorized")
            .to_string(),
        color: raw
            .get("color")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        topic_count: raw.get("topic_count").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
        post_count: raw.get("post_count").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
        description_text: if desc_text.is_empty() {
            None
        } else {
            Some(desc_text)
        },
        position: raw.get("position").and_then(|v| v.as_u64()).unwrap_or(999) as u32,
        read_restricted: raw
            .get("read_restricted")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
    }
}

/// Strip HTML tags and collapse whitespace
pub fn strip_html(html: &str) -> String {
    let re = Regex::new(r"<[^>]+>").unwrap();
    let text = re.replace_all(html, " ");
    let ws = Regex::new(r"\s+").unwrap();
    ws.replace_all(&text, " ").trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strip_html() {
        assert_eq!(strip_html("<p>Hello <b>world</b></p>"), "Hello world");
        assert_eq!(strip_html("plain text"), "plain text");
        assert_eq!(strip_html("<div>  spaces  </div>"), "spaces");
    }

    #[test]
    fn test_normalize_topic() {
        let raw = serde_json::json!({
            "id": 42,
            "title": "Test Topic",
            "slug": "test-topic",
            "category_id": 1,
            "created_at": "2024-01-01T00:00:00Z",
            "posts_count": 5,
            "views": 100,
            "tags": ["rust", "help"],
            "pinned": true
        });
        let topic = normalize_topic(&raw);
        assert_eq!(topic.id, 42);
        assert_eq!(topic.title, "Test Topic");
        assert_eq!(topic.slug, "test-topic");
        assert_eq!(topic.posts_count, 5);
        assert_eq!(topic.views, 100);
        assert_eq!(topic.tags, vec!["rust", "help"]);
        assert!(topic.pinned);
    }

    #[test]
    fn test_normalize_post() {
        let raw = serde_json::json!({
            "id": 100,
            "post_number": 1,
            "username": "testuser",
            "cooked": "<p>Hello world</p>",
            "created_at": "2024-01-01T00:00:00Z",
            "like_count": 3,
            "trust_level": 2
        });
        let post = normalize_post(&raw, 42);
        assert_eq!(post.id, 100);
        assert_eq!(post.topic_id, 42);
        assert_eq!(post.post_number, 1);
        assert_eq!(post.username, "testuser");
        assert_eq!(post.like_count, 3);
    }

    #[test]
    fn test_normalize_category() {
        let raw = serde_json::json!({
            "id": 1,
            "name": "General",
            "slug": "general",
            "color": "0088cc",
            "topic_count": 42,
            "post_count": 500,
            "description": "<p>General discussion</p>",
            "position": 0
        });
        let cat = normalize_category(&raw);
        assert_eq!(cat.id, 1);
        assert_eq!(cat.name, "General");
        assert_eq!(cat.color, Some("0088cc".to_string()));
        assert_eq!(cat.description_text, Some("General discussion".to_string()));
    }

    #[tokio::test]
    async fn test_detect_discourse_invalid_url() {
        // Should return false for non-existent URLs
        assert!(!DiscourseScraper::detect_discourse("http://localhost:99999").await);
    }
}
