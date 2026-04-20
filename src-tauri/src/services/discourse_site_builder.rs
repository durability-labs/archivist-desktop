use crate::services::discourse_scraper::{
    strip_html, DiscourseCategory, DiscoursePost, DiscourseTopic, DiscourseUser,
};
use regex::Regex;
use std::collections::{HashMap, HashSet};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOPICS_PER_PAGE: usize = 50;
const POSTS_PER_PAGE: usize = 100;

// ---------------------------------------------------------------------------
// Site Builder
// ---------------------------------------------------------------------------

pub struct SiteBuilder {
    pub categories: Vec<DiscourseCategory>,
    pub topics: Vec<DiscourseTopic>,
    pub posts: Vec<DiscoursePost>,
    pub users: Vec<DiscourseUser>,
    pub forum_title: String,
    /// Downloaded images: (relative_path_in_zip, file_data)
    pub image_files: Vec<(String, Vec<u8>)>,
    /// Mapping from original image URL to local relative path
    pub url_map: HashMap<String, String>,
    /// URLs that failed to download
    pub failed_urls: HashSet<String>,
}

impl SiteBuilder {
    pub fn new(
        categories: Vec<DiscourseCategory>,
        topics: Vec<DiscourseTopic>,
        posts: Vec<DiscoursePost>,
        users: Vec<DiscourseUser>,
        forum_title: String,
    ) -> Self {
        Self {
            categories,
            topics,
            posts,
            users,
            forum_title,
            image_files: Vec::new(),
            url_map: HashMap::new(),
            failed_urls: HashSet::new(),
        }
    }

    /// Generate all pages and return (relative_path, content_bytes) pairs for ZIP
    pub fn build(&self) -> Vec<(String, Vec<u8>)> {
        let mut files: Vec<(String, Vec<u8>)> = Vec::new();

        // Build lookup tables
        let cat_by_id = self.build_cat_by_id();
        let topics_by_cat = self.build_topics_by_cat();
        let posts_by_topic = self.build_posts_by_topic();
        let user_by_name = self.build_user_by_name();
        let user_by_id = self.build_user_by_id();
        let topic_by_id = self.build_topic_by_id();
        let tags_to_topics = self.build_tags_to_topics();
        let posts_by_user = self.build_posts_by_user();

        let stats = ForumStats {
            topics: self.topics.len(),
            posts: self.posts.len(),
            users: self.users.len(),
            categories: self.categories.len(),
        };

        // CSS
        files.push(("assets/style.css".to_string(), minify_css(CSS).into_bytes()));

        // Index
        files.push((
            "index.html".to_string(),
            self.generate_index(&topics_by_cat, &stats).into_bytes(),
        ));

        // Category pages
        for cat in &self.categories {
            let cat_topics = topics_by_cat.get(&cat.id).cloned().unwrap_or_default();
            let html = self.generate_category_page(cat, &cat_topics, &user_by_id, &posts_by_topic);
            files.push((format!("c/{}/index.html", cat.slug), html.into_bytes()));
        }

        // Topic pages
        for topic in &self.topics {
            let topic_posts = posts_by_topic.get(&topic.id).cloned().unwrap_or_default();
            let total_pages = ((topic_posts.len() as f64) / POSTS_PER_PAGE as f64).ceil() as usize;
            let total_pages = total_pages.max(1);

            for page_num in 1..=total_pages {
                let start = (page_num - 1) * POSTS_PER_PAGE;
                let end = (start + POSTS_PER_PAGE).min(topic_posts.len());
                let page_posts = &topic_posts[start..end];

                let html = self.generate_topic_page(
                    topic,
                    page_posts,
                    &topic_posts,
                    page_num,
                    total_pages,
                    &cat_by_id,
                    &user_by_name,
                );

                let filename = page_filename(page_num);
                files.push((
                    format!("t/{}/{}/{}", topic.slug, topic.id, filename),
                    html.into_bytes(),
                ));
            }
        }

        // User pages
        for user in &self.users {
            let user_posts = posts_by_user
                .get(&user.username)
                .cloned()
                .unwrap_or_default();
            let html = self.generate_user_page(user, &user_posts, &topic_by_id);
            files.push((format!("u/{}/index.html", user.username), html.into_bytes()));
        }

        // Tag pages
        if !tags_to_topics.is_empty() {
            files.push((
                "tags/index.html".to_string(),
                self.generate_tag_index(&tags_to_topics).into_bytes(),
            ));
            for (tag, tag_topics) in &tags_to_topics {
                let total_pages =
                    ((tag_topics.len() as f64) / TOPICS_PER_PAGE as f64).ceil() as usize;
                let total_pages = total_pages.max(1);
                for page_num in 1..=total_pages {
                    let start = (page_num - 1) * TOPICS_PER_PAGE;
                    let end = (start + TOPICS_PER_PAGE).min(tag_topics.len());
                    let page_topics = &tag_topics[start..end];
                    let html = self.generate_tag_page(
                        tag,
                        tag_topics.len(),
                        page_topics,
                        page_num,
                        total_pages,
                        &cat_by_id,
                        &user_by_id,
                        &posts_by_topic,
                    );
                    files.push((
                        format!("tags/{}/{}", tag, page_filename(page_num)),
                        html.into_bytes(),
                    ));
                }
            }
        }

        // Stats page
        files.push((
            "stats.html".to_string(),
            self.generate_stats_page(&posts_by_topic, &stats)
                .into_bytes(),
        ));

        // Search page (simple JS search, no Pagefind)
        files.push((
            "search.html".to_string(),
            self.generate_search_page(&stats).into_bytes(),
        ));

        // Search index JSON
        files.push((
            "search-index.json".to_string(),
            self.generate_search_index(&posts_by_topic).into_bytes(),
        ));

        // Include downloaded images
        for (path, data) in &self.image_files {
            files.push((path.clone(), data.clone()));
        }

        files
    }

    // -----------------------------------------------------------------------
    // Lookup builders
    // -----------------------------------------------------------------------

    fn build_cat_by_id(&self) -> HashMap<u64, &DiscourseCategory> {
        self.categories.iter().map(|c| (c.id, c)).collect()
    }

    fn build_topics_by_cat(&self) -> HashMap<u64, Vec<&DiscourseTopic>> {
        let mut m: HashMap<u64, Vec<&DiscourseTopic>> = HashMap::new();
        for t in &self.topics {
            if let Some(cid) = t.category_id {
                m.entry(cid).or_default().push(t);
            }
        }
        // Sort by last_posted_at desc
        for topics in m.values_mut() {
            topics.sort_by(|a, b| {
                b.last_posted_at
                    .as_deref()
                    .unwrap_or("")
                    .cmp(a.last_posted_at.as_deref().unwrap_or(""))
            });
        }
        m
    }

    fn build_posts_by_topic(&self) -> HashMap<u64, Vec<&DiscoursePost>> {
        let mut m: HashMap<u64, Vec<&DiscoursePost>> = HashMap::new();
        for p in &self.posts {
            m.entry(p.topic_id).or_default().push(p);
        }
        for posts in m.values_mut() {
            posts.sort_by_key(|p| p.post_number);
        }
        m
    }

    fn build_user_by_name(&self) -> HashMap<&str, &DiscourseUser> {
        self.users
            .iter()
            .map(|u| (u.username.as_str(), u))
            .collect()
    }

    fn build_user_by_id(&self) -> HashMap<u64, &DiscourseUser> {
        self.users.iter().map(|u| (u.id, u)).collect()
    }

    fn build_topic_by_id(&self) -> HashMap<u64, &DiscourseTopic> {
        self.topics.iter().map(|t| (t.id, t)).collect()
    }

    fn build_tags_to_topics(&self) -> HashMap<String, Vec<&DiscourseTopic>> {
        let mut m: HashMap<String, Vec<&DiscourseTopic>> = HashMap::new();
        for t in &self.topics {
            for tag in &t.tags {
                m.entry(tag.clone()).or_default().push(t);
            }
        }
        for topics in m.values_mut() {
            topics.sort_by(|a, b| {
                b.last_posted_at
                    .as_deref()
                    .unwrap_or("")
                    .cmp(a.last_posted_at.as_deref().unwrap_or(""))
            });
        }
        m
    }

    fn build_posts_by_user(&self) -> HashMap<String, Vec<&DiscoursePost>> {
        let mut m: HashMap<String, Vec<&DiscoursePost>> = HashMap::new();
        for p in &self.posts {
            m.entry(p.username.clone()).or_default().push(p);
        }
        for posts in m.values_mut() {
            posts.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        }
        m
    }

    // -----------------------------------------------------------------------
    // Page generators
    // -----------------------------------------------------------------------

    fn generate_index(
        &self,
        _topics_by_cat: &HashMap<u64, Vec<&DiscourseTopic>>,
        stats: &ForumStats,
    ) -> String {
        let mut html = self.html_head(&self.forum_title, 0);
        html += &self.site_header(0);
        html += "<div class=\"container\" id=\"main\">\n";
        html += "<div class=\"search-box\">\n";
        html += "<input type=\"text\" id=\"search-input\" placeholder=\"Search the archive...\" autocomplete=\"off\" onfocus=\"window.location.href='search.html'\">\n";
        html += "</div>\n";
        html += "<h2 style=\"margin-bottom:16px;\">Categories</h2>\n";
        html += "<ul class=\"category-list\">\n";

        let mut sorted_cats: Vec<&DiscourseCategory> = self.categories.iter().collect();
        sorted_cats.sort_by_key(|c| c.position);

        for cat in sorted_cats {
            let color = cat.color.as_deref().unwrap_or("888");
            let desc = cat.description_text.as_deref().unwrap_or("");
            let link = format!("c/{}/index.html", cat.slug);
            html += &format!(
                "<li class=\"category-item\">\n  <span class=\"cat-color\" style=\"background:#{color};\"></span>\n  <div class=\"cat-info\">\n    <a class=\"cat-name\" href=\"{link}\">{name}</a>\n    <div class=\"cat-desc\">{desc}</div>\n  </div>\n  <div class=\"cat-stats\">{tc} topics<br>{pc} posts</div>\n</li>\n",
                color = html_escape(color),
                link = link,
                name = html_escape(&cat.name),
                desc = html_escape(desc),
                tc = cat.topic_count,
                pc = cat.post_count,
            );
        }

        html += "</ul>\n</div>\n";
        html += &self.site_footer(stats);
        html
    }

    fn generate_category_page(
        &self,
        cat: &DiscourseCategory,
        topics: &[&DiscourseTopic],
        user_by_id: &HashMap<u64, &DiscourseUser>,
        posts_by_topic: &HashMap<u64, Vec<&DiscoursePost>>,
    ) -> String {
        let depth = 2;
        let mut html = self.html_head(&cat.name, depth);
        html += &self.site_header(depth);
        html += &breadcrumbs(&[(&cat.name, None)], depth);
        html += "<div class=\"container\" id=\"main\">\n";

        let color = cat.color.as_deref().unwrap_or("888");
        html += &format!(
            "<h2 style=\"margin-bottom:16px;\"><span class=\"cat-color\" style=\"background:#{};display:inline-block;width:12px;height:12px;border-radius:50%;vertical-align:middle;margin-right:8px;\"></span>{}</h2>\n",
            html_escape(color), html_escape(&cat.name)
        );

        if let Some(ref desc) = cat.description_text {
            html += &format!("<p class=\"cat-page-desc\">{}</p>\n", html_escape(desc));
        }

        if topics.is_empty() {
            html += "<p>No topics in this category.</p>\n";
        } else {
            // Build JSON data for client-side sort
            let mut json_topics = Vec::new();
            for t in topics {
                let author = find_original_poster(t, user_by_id);
                let excerpt = t.excerpt.as_deref().unwrap_or("").to_string();
                let excerpt = if excerpt.is_empty() {
                    posts_by_topic
                        .get(&t.id)
                        .and_then(|posts| posts.first())
                        .map(|p| {
                            let text = strip_html(&p.cooked);
                            truncate_str(&text, 120).to_string()
                        })
                        .unwrap_or_default()
                } else {
                    excerpt
                };

                json_topics.push(serde_json::json!({
                    "title": html_escape(&t.title),
                    "slug": t.slug,
                    "id": t.id,
                    "replies": t.posts_count.saturating_sub(1),
                    "likes": t.like_count,
                    "views": t.views,
                    "activity": format_date(t.last_posted_at.as_deref()),
                    "created": format_date(Some(&t.created_at)),
                    "pinned": t.pinned,
                    "closed": t.closed,
                    "archived": t.archived,
                    "author": html_escape(&author),
                    "excerpt": html_escape(&excerpt),
                    "tags": t.tags,
                }));
            }

            // Sort/filter controls
            html += "<div class=\"table-controls\" data-pagefind-ignore>\n";
            html += "<span class=\"label\">Sort:</span>\n";
            html += "<button class=\"sort-btn active\" data-sort=\"activity\">Activity</button>\n";
            html += "<button class=\"sort-btn\" data-sort=\"created\">Newest</button>\n";
            html += "<button class=\"sort-btn\" data-sort=\"views\">Views</button>\n";
            html += "<button class=\"sort-btn\" data-sort=\"likes\">Likes</button>\n";
            html += "<button class=\"sort-btn\" data-sort=\"replies\">Replies</button>\n";
            html += "<span class=\"label\" style=\"margin-left:12px;\">Filter:</span>\n";
            html += "<button class=\"filter-btn active\" data-filter=\"all\">All</button>\n";
            html += "<button class=\"filter-btn\" data-filter=\"open\">Open</button>\n";
            html += "<button class=\"filter-btn\" data-filter=\"closed\">Closed</button>\n";
            html += "</div>\n";

            html += "<table class=\"topic-table\">\n<thead><tr><th>Topic</th><th>Replies</th><th class=\"col-likes\">Likes</th><th class=\"col-views\">Views</th><th>Activity</th></tr></thead>\n<tbody id=\"topic-tbody\"></tbody></table>\n";
            html += "<div class=\"js-pagination\" id=\"js-page-nav\" data-pagefind-ignore></div>\n";

            // Embed topic data
            if let Ok(json_str) = serde_json::to_string(&json_topics) {
                html += &format!("<script>window.__TOPICS={};</script>\n", json_str);
            }
            html += CATEGORY_SORT_JS;

            // Noscript fallback
            html += "<noscript>\n<table class=\"topic-table\">\n<thead><tr><th>Topic</th><th>Replies</th><th class=\"col-likes\">Likes</th><th class=\"col-views\">Views</th><th>Activity</th></tr></thead>\n<tbody>\n";
            for t in topics.iter().take(TOPICS_PER_PAGE) {
                let link = format!("../../t/{}/{}/index.html", t.slug, t.id);
                let replies = t.posts_count.saturating_sub(1);
                let likes_html = if t.like_count > 0 {
                    format!(
                        "<span style=\"color:#e25555;\">&#9829;</span> {}",
                        t.like_count
                    )
                } else {
                    "0".to_string()
                };
                let badges = topic_badges_html(t, "../../");
                html += &format!(
                    "<tr><td><a class=\"topic-title\" href=\"{}\">{}</a>{}<div class=\"topic-meta\"></div></td><td>{}</td><td class=\"col-likes\">{}</td><td class=\"col-views\">{}</td><td>{}</td></tr>\n",
                    link, html_escape(&t.title), badges, replies, likes_html, t.views,
                    format_date(t.last_posted_at.as_deref())
                );
            }
            html += "</tbody></table>\n</noscript>\n";
        }

        html += "</div>\n";
        html += &self.site_footer(&ForumStats::default());
        html
    }

    #[allow(clippy::too_many_arguments)]
    fn generate_topic_page(
        &self,
        topic: &DiscourseTopic,
        page_posts: &[&DiscoursePost],
        all_posts: &[&DiscoursePost],
        page_num: usize,
        total_pages: usize,
        cat_by_id: &HashMap<u64, &DiscourseCategory>,
        user_by_name: &HashMap<&str, &DiscourseUser>,
    ) -> String {
        let depth = 3;
        let page_title = if page_num == 1 {
            topic.title.clone()
        } else {
            format!("{} - Page {}", topic.title, page_num)
        };

        let mut html = self.html_head(&page_title, depth);
        html += &self.site_header(depth);

        // Breadcrumbs
        let mut crumbs: Vec<(&str, Option<String>)> = Vec::new();
        if let Some(cid) = topic.category_id {
            if let Some(cat) = cat_by_id.get(&cid) {
                crumbs.push((
                    &cat.name,
                    Some(format!("../../../c/{}/index.html", cat.slug)),
                ));
            }
        }
        crumbs.push((&topic.title, None));
        let crumb_refs: Vec<(&str, Option<&str>)> =
            crumbs.iter().map(|(l, u)| (*l, u.as_deref())).collect();
        html += &breadcrumbs_with_urls(&crumb_refs, depth);

        html += "<div class=\"container\" id=\"main\">\n";
        html += &format!(
            "<h2 style=\"margin-bottom:4px;\">{}</h2>\n",
            html_escape(&topic.title)
        );

        // Badges
        let badges = topic_badges_html(topic, "../../../");
        if !badges.is_empty() {
            html += &format!("<div style=\"margin-bottom:16px;\">{}</div>\n", badges);
        } else {
            html += "<div style=\"margin-bottom:16px;\"></div>\n";
        }

        // Top pagination
        if total_pages > 1 {
            html += &pagination_html(page_num, total_pages);
        }

        // Build post lookup for reply threading
        let mut post_user_lookup: HashMap<(u64, u32), String> = HashMap::new();
        let mut reply_counts: HashMap<(u64, u32), u32> = HashMap::new();
        let mut post_page_map: HashMap<u32, usize> = HashMap::new();
        for (i, p) in all_posts.iter().enumerate() {
            let page = (i / POSTS_PER_PAGE) + 1;
            post_page_map.insert(p.post_number, page);
            post_user_lookup.insert((p.topic_id, p.post_number), p.username.clone());
            if let Some(rto) = p.reply_to_post_number {
                *reply_counts.entry((p.topic_id, rto)).or_insert(0) += 1;
            }
        }

        for p in page_posts {
            let user = user_by_name.get(p.username.as_str());
            let avatar_html = match user {
                Some(u) => avatar_img(u, depth),
                None => format!(
                    "<img src=\"\" alt=\"{}\" width=\"48\" height=\"48\" loading=\"lazy\">",
                    html_escape(&p.username)
                ),
            };
            let user_link = format!("../../../u/{}/index.html", p.username);

            let reply_class = if p.reply_to_post_number.is_some() {
                " post-reply"
            } else {
                ""
            };

            let cooked = self.rewrite_cooked_html(&p.cooked, depth);

            html += &format!(
                "<div class=\"post{}\" id=\"post-{}\">\n",
                reply_class, p.post_number
            );
            html += &format!(
                "<div class=\"post-avatar\"><a href=\"{}\">{}</a></div>\n",
                user_link, avatar_html
            );
            html += "<div class=\"post-body\">\n<div class=\"post-header\">\n";
            html += &format!(
                "<a class=\"post-username\" href=\"{}\">{}</a>\n",
                user_link,
                html_escape(&p.username)
            );
            html += &format!(
                "<span class=\"post-date\">{}</span>\n",
                format_date(Some(&p.created_at))
            );
            html += &format!("<span class=\"post-number\">#{}</span>\n", p.post_number);

            let trust_label = match p.trust_level {
                0 => "New",
                1 => "Basic",
                2 => "Member",
                3 => "Regular",
                4 => "Leader",
                _ => "TL",
            };
            html += &format!(
                "<span class=\"trust-badge trust-{}\">{}</span>\n",
                p.trust_level, trust_label
            );

            // Reply indicator
            if let Some(reply_to) = p.reply_to_post_number {
                let reply_user = post_user_lookup
                    .get(&(p.topic_id, reply_to))
                    .map(|s| s.as_str())
                    .unwrap_or("");
                let reply_page = post_page_map.get(&reply_to).copied().unwrap_or(1);
                let reply_href = if reply_page == page_num {
                    format!("#post-{}", reply_to)
                } else {
                    format!("{}#post-{}", page_filename(reply_page), reply_to)
                };
                html += &format!(
                    "<span class=\"reply-indicator\">&#8618; in reply to <a href=\"{}\">{} #{}</a></span>\n",
                    reply_href, html_escape(reply_user), reply_to
                );
            }

            // Reply count badge
            let rc = reply_counts
                .get(&(topic.id, p.post_number))
                .copied()
                .unwrap_or(0);
            if rc > 0 {
                let label = if rc == 1 {
                    "1 reply".to_string()
                } else {
                    format!("{} replies", rc)
                };
                html += &format!("<span class=\"reply-count-badge\">{}</span>\n", label);
            }

            html += "</div>\n"; // post-header
            html += &format!("<div class=\"post-content\">{}</div>\n", cooked);
            html += "</div>\n"; // post-body
            html += "</div>\n"; // post
        }

        // Bottom pagination
        if total_pages > 1 {
            html += &pagination_html(page_num, total_pages);
        }

        html += "</div>\n";
        html += &self.site_footer(&ForumStats::default());
        html
    }

    fn generate_user_page(
        &self,
        user: &DiscourseUser,
        user_posts: &[&DiscoursePost],
        topic_by_id: &HashMap<u64, &DiscourseTopic>,
    ) -> String {
        let depth = 2;
        let mut html = self.html_head(&user.username, depth);
        html += &self.site_header(depth);
        html += &breadcrumbs(&[(&user.username, None)], depth);
        html += "<div class=\"container\" id=\"main\">\n";

        let display_name = user.name.as_deref().unwrap_or(&user.username);
        let avatar = avatar_img(user, depth);

        html += "<div class=\"profile-card\">\n";
        html += &format!("<div>{}</div>\n", avatar);
        html += "<div class=\"profile-info\">\n";
        html += &format!("<h2>{}", html_escape(display_name));
        if user.admin {
            html += " <span class=\"admin-badge\">Admin</span>";
        }
        if user.moderator {
            html += " <span class=\"mod-badge\">Moderator</span>";
        }
        html += "</h2>\n";
        html += &format!(
            "<div style=\"color:#888;\">@{}</div>\n",
            html_escape(&user.username)
        );
        if let Some(ref title) = user.title {
            html += &format!("<div class=\"title\">{}</div>\n", html_escape(title));
        }
        if let Some(ref bio) = user.bio_excerpt {
            html += &format!("<p style=\"margin-top:8px;\">{}</p>\n", html_escape(bio));
        }

        html += "<div class=\"profile-stats\">\n";
        html += &format!(
            "<div><div class=\"stat-label\">Posts</div><div>{}</div></div>\n",
            user_posts.len()
        );
        html += &format!(
            "<div><div class=\"stat-label\">Trust Level</div><div>{}</div></div>\n",
            user.trust_level
        );
        html += &format!(
            "<div><div class=\"stat-label\">Badges</div><div>{}</div></div>\n",
            user.badge_count
        );
        html += &format!(
            "<div><div class=\"stat-label\">Joined</div><div>{}</div></div>\n",
            format_date(user.created_at.as_deref())
        );
        if let Some(ref lp) = user.last_posted_at {
            html += &format!(
                "<div><div class=\"stat-label\">Last Posted</div><div>{}</div></div>\n",
                format_date(Some(lp))
            );
        }
        html += &format!(
            "<div><div class=\"stat-label\">Profile Views</div><div>{}</div></div>\n",
            user.profile_view_count
        );
        html += "</div>\n"; // profile-stats
        html += "</div>\n"; // profile-info
        html += "</div>\n"; // profile-card

        // Recent posts
        if !user_posts.is_empty() {
            html += "<h3 style=\"margin:24px 0 12px;\">Recent Posts</h3>\n";
            html += "<ul class=\"user-posts-list\">\n";
            for p in user_posts.iter().take(50) {
                let topic = topic_by_id.get(&p.topic_id);
                let topic_title = topic.map(|t| t.title.as_str()).unwrap_or("Unknown Topic");
                let topic_slug = topic.map(|t| t.slug.as_str()).unwrap_or("topic");
                let topic_link = format!("../../t/{}/{}/index.html", topic_slug, p.topic_id);
                let excerpt = strip_html(&p.cooked);
                let excerpt = truncate_str(&excerpt, 200);
                html += "<li class=\"user-post-item\">\n";
                html += &format!(
                    "<a class=\"user-post-topic\" href=\"{}\">{}</a>",
                    topic_link,
                    html_escape(topic_title)
                );
                html += &format!(
                    "<span class=\"user-post-date\">{}</span>\n",
                    format_date(Some(&p.created_at))
                );
                if !excerpt.is_empty() {
                    html += &format!(
                        "<div class=\"user-post-excerpt\">{}</div>\n",
                        html_escape(excerpt)
                    );
                }
                html += "</li>\n";
            }
            html += "</ul>\n";
            if user_posts.len() > 50 {
                html += &format!(
                    "<p style=\"color:var(--text-muted);margin-top:8px;\">Showing 50 of {} posts.</p>\n",
                    user_posts.len()
                );
            }
        }

        html += "</div>\n";
        html += &self.site_footer(&ForumStats::default());
        html
    }

    fn generate_tag_index(&self, tags_to_topics: &HashMap<String, Vec<&DiscourseTopic>>) -> String {
        let depth = 1;
        let mut html = self.html_head("Tags", depth);
        html += &self.site_header(depth);
        html += &breadcrumbs(&[("Tags", None)], depth);
        html += "<div class=\"container\" id=\"main\">\n";
        html += "<h2 style=\"margin-bottom:16px;\">Tags</h2>\n";

        let mut sorted_tags: Vec<&String> = tags_to_topics.keys().collect();
        sorted_tags.sort();

        html += "<div style=\"display:flex;flex-wrap:wrap;gap:8px;\">\n";
        for tag in sorted_tags {
            let count = tags_to_topics[tag].len();
            html += &format!(
                "<a class=\"badge badge-tag\" href=\"{}/index.html\" style=\"font-size:0.85rem;padding:4px 10px;\">{} ({})</a>\n",
                html_escape(tag), html_escape(tag), count
            );
        }
        html += "</div>\n</div>\n";
        html += &self.site_footer(&ForumStats::default());
        html
    }

    #[allow(clippy::too_many_arguments)]
    fn generate_tag_page(
        &self,
        tag: &str,
        total_count: usize,
        page_topics: &[&DiscourseTopic],
        page_num: usize,
        total_pages: usize,
        _cat_by_id: &HashMap<u64, &DiscourseCategory>,
        _user_by_id: &HashMap<u64, &DiscourseUser>,
        _posts_by_topic: &HashMap<u64, Vec<&DiscoursePost>>,
    ) -> String {
        let depth = 2;
        let page_title = if page_num == 1 {
            format!("Tag: {}", tag)
        } else {
            format!("Tag: {} - Page {}", tag, page_num)
        };
        let mut html = self.html_head(&page_title, depth);
        html += &self.site_header(depth);
        html += &breadcrumbs_with_urls(&[("Tags", Some("../index.html")), (tag, None)], depth);
        html += "<div class=\"container\" id=\"main\">\n";
        html += &format!(
            "<h2 style=\"margin-bottom:16px;\"><span class=\"badge badge-tag\" style=\"font-size:1rem;padding:4px 12px;\">{}</span> <span style=\"color:var(--text-muted);font-size:0.9rem;\">{} topics</span></h2>\n",
            html_escape(tag), total_count
        );

        html += "<table class=\"topic-table\">\n<thead><tr><th>Topic</th><th>Replies</th><th class=\"col-likes\">Likes</th><th class=\"col-views\">Views</th><th>Activity</th></tr></thead>\n<tbody>\n";
        for t in page_topics {
            let link = format!("../../t/{}/{}/index.html", t.slug, t.id);
            let replies = t.posts_count.saturating_sub(1);
            let likes_html = if t.like_count > 0 {
                format!(
                    "<span style=\"color:#e25555;\">&#9829;</span> {}",
                    t.like_count
                )
            } else {
                "0".to_string()
            };
            html += &format!(
                "<tr><td><a class=\"topic-title\" href=\"{}\">{}</a><div class=\"topic-meta\"></div></td><td>{}</td><td class=\"col-likes\">{}</td><td class=\"col-views\">{}</td><td>{}</td></tr>\n",
                link, html_escape(&t.title), replies, likes_html, t.views,
                format_date(t.last_posted_at.as_deref())
            );
        }
        html += "</tbody></table>\n";
        html += &pagination_html(page_num, total_pages);
        html += "</div>\n";
        html += &self.site_footer(&ForumStats::default());
        html
    }

    fn generate_stats_page(
        &self,
        posts_by_topic: &HashMap<u64, Vec<&DiscoursePost>>,
        stats: &ForumStats,
    ) -> String {
        let mut html = self.html_head("Forum Statistics", 0);
        html += &self.site_header(0);
        html += "<div class=\"container\" id=\"main\">\n";
        html += "<h2 style=\"margin-bottom:16px;\">Forum Statistics</h2>\n";

        let avg_posts = if stats.topics > 0 {
            format!("{:.1}", stats.posts as f64 / stats.topics as f64)
        } else {
            "0".to_string()
        };

        html += "<div class=\"stats-grid\">\n";
        for (label, value) in &[
            ("Topics", format!("{}", stats.topics)),
            ("Posts", format!("{}", stats.posts)),
            ("Users", format!("{}", stats.users)),
            ("Categories", format!("{}", stats.categories)),
            ("Avg Posts/Topic", avg_posts.clone()),
        ] {
            html += &format!(
                "<div class=\"stats-card\"><div class=\"stat-value\">{}</div><div class=\"stat-label\">{}</div></div>\n",
                value, label
            );
        }
        html += "</div>\n";

        // Top categories by posts
        let mut cat_post_counts: Vec<(&str, usize)> = Vec::new();
        for cat in &self.categories {
            let cat_topics: Vec<&DiscourseTopic> = self
                .topics
                .iter()
                .filter(|t| t.category_id == Some(cat.id))
                .collect();
            let pc: usize = cat_topics
                .iter()
                .map(|t| posts_by_topic.get(&t.id).map(|p| p.len()).unwrap_or(0))
                .sum();
            cat_post_counts.push((&cat.name, pc));
        }
        cat_post_counts.sort_by_key(|x| std::cmp::Reverse(x.1));
        let top_cats: Vec<_> = cat_post_counts.iter().take(10).collect();
        if !top_cats.is_empty() {
            let max_val = top_cats[0].1.max(1);
            html += "<h3 style=\"margin:24px 0 12px;\">Top Categories by Posts</h3>\n";
            for (name, count) in &top_cats {
                let pct = (*count * 100) / max_val;
                html += &format!(
                    "<div class=\"stat-bar-row\"><div class=\"stat-bar-label\">{}</div><div class=\"stat-bar-fill\" style=\"width:{}%\"></div><div class=\"stat-bar-count\">{}</div></div>\n",
                    html_escape(name), pct, count
                );
            }
        }

        // Top users
        let mut user_post_counts: HashMap<&str, usize> = HashMap::new();
        for p in &self.posts {
            *user_post_counts.entry(&p.username).or_insert(0) += 1;
        }
        let mut top_users: Vec<_> = user_post_counts.into_iter().collect();
        top_users.sort_by_key(|x| std::cmp::Reverse(x.1));
        top_users.truncate(10);
        if !top_users.is_empty() {
            let max_val = top_users[0].1.max(1);
            html += "<h3 style=\"margin:24px 0 12px;\">Most Active Users</h3>\n";
            for (uname, count) in &top_users {
                let pct = (*count * 100) / max_val;
                html += &format!(
                    "<div class=\"stat-bar-row\"><div class=\"stat-bar-label\"><a href=\"u/{}/index.html\">{}</a></div><div class=\"stat-bar-fill\" style=\"width:{}%\"></div><div class=\"stat-bar-count\">{}</div></div>\n",
                    html_escape(uname), html_escape(uname), pct, count
                );
            }
        }

        // Most viewed topics
        let mut viewed: Vec<&DiscourseTopic> = self.topics.iter().collect();
        viewed.sort_by_key(|t| std::cmp::Reverse(t.views));
        viewed.truncate(10);
        if !viewed.is_empty() {
            let max_val = viewed[0].views.max(1);
            html += "<h3 style=\"margin:24px 0 12px;\">Most Viewed Topics</h3>\n";
            for t in &viewed {
                let pct = (t.views * 100) / max_val;
                let link = format!("t/{}/{}/index.html", t.slug, t.id);
                html += &format!(
                    "<div class=\"stat-bar-row\"><div class=\"stat-bar-label\"><a href=\"{}\">{}</a></div><div class=\"stat-bar-fill\" style=\"width:{}%\"></div><div class=\"stat-bar-count\">{}</div></div>\n",
                    link, html_escape(&t.title), pct, t.views
                );
            }
        }

        // Posts per year
        let mut year_counts: HashMap<String, usize> = HashMap::new();
        for p in &self.posts {
            if p.created_at.len() >= 4 {
                let year = truncate_str(&p.created_at, 4).to_string();
                if year.len() == 4 {
                    *year_counts.entry(year).or_insert(0) += 1;
                }
            }
        }
        if !year_counts.is_empty() {
            let mut years: Vec<_> = year_counts.iter().collect();
            years.sort_by_key(|(y, _)| (*y).clone());
            let max_val = years.iter().map(|(_, c)| **c).max().unwrap_or(1).max(1);
            html += "<h3 style=\"margin:24px 0 12px;\">Posts per Year</h3>\n";
            for (year, count) in &years {
                let pct = (*count * 100) / max_val;
                html += &format!(
                    "<div class=\"stat-bar-row\"><div class=\"stat-bar-label\">{}</div><div class=\"stat-bar-fill\" style=\"width:{}%\"></div><div class=\"stat-bar-count\">{}</div></div>\n",
                    year, pct, count
                );
            }
        }

        html += "</div>\n";
        html += &self.site_footer(stats);
        html
    }

    fn generate_search_page(&self, stats: &ForumStats) -> String {
        let mut html = self.html_head("Search", 0);
        html += &self.site_header(0);
        html += "<div class=\"container\" id=\"main\">\n";
        html += "<h2 style=\"margin-bottom:16px;\">Search the Archive</h2>\n";
        html += "<div class=\"search-box\"><input type=\"text\" id=\"search-input\" placeholder=\"Type to search topics...\" autocomplete=\"off\"></div>\n";
        html += "<div id=\"search-results\" class=\"search-results\"></div>\n";
        html += r#"<script>
(function(){
  var idx=null;
  var input=document.getElementById('search-input');
  var results=document.getElementById('search-results');
  fetch('search-index.json').then(function(r){return r.json();}).then(function(d){idx=d;});
  input.addEventListener('input',function(){
    if(!idx){results.style.display='none';return;}
    var q=input.value.toLowerCase().trim();
    if(q.length<2){results.style.display='none';return;}
    var matches=[];
    for(var i=0;i<idx.length&&matches.length<20;i++){
      var t=idx[i];
      if(t.title.toLowerCase().indexOf(q)>=0||(t.excerpt&&t.excerpt.toLowerCase().indexOf(q)>=0)){
        matches.push(t);
      }
    }
    if(matches.length===0){results.innerHTML='<li>No results found</li>';results.style.display='block';return;}
    var html='';
    matches.forEach(function(m){
      html+='<li><a href="'+m.url+'"><div class="sr-title">'+m.title+'</div>';
      if(m.excerpt)html+='<div class="sr-excerpt">'+m.excerpt+'</div>';
      html+='</a></li>';
    });
    results.innerHTML=html;
    results.style.display='block';
  });
})();
</script>
"#;
        html += "</div>\n";
        html += &self.site_footer(stats);
        html
    }

    fn generate_search_index(&self, posts_by_topic: &HashMap<u64, Vec<&DiscoursePost>>) -> String {
        let mut entries: Vec<serde_json::Value> = Vec::new();
        for t in &self.topics {
            let excerpt = t.excerpt.as_deref().unwrap_or("").to_string();
            let excerpt = if excerpt.is_empty() {
                posts_by_topic
                    .get(&t.id)
                    .and_then(|posts| posts.first())
                    .map(|p| {
                        let text = strip_html(&p.cooked);
                        truncate_str(&text, 200).to_string()
                    })
                    .unwrap_or_default()
            } else {
                excerpt
            };
            entries.push(serde_json::json!({
                "title": t.title,
                "url": format!("t/{}/{}/index.html", t.slug, t.id),
                "excerpt": excerpt,
            }));
        }
        serde_json::to_string(&entries).unwrap_or_else(|_| "[]".to_string())
    }

    // -----------------------------------------------------------------------
    // HTML structure helpers
    // -----------------------------------------------------------------------

    fn html_head(&self, title: &str, depth: usize) -> String {
        let css_path = format!("{}assets/style.css", "../".repeat(depth));
        let escaped_title = html_escape(title);
        let escaped_forum = html_escape(&self.forum_title);
        format!(
            "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<meta name=\"theme-color\" content=\"#1a1a2e\">\n<title>{} - {}</title>\n<link rel=\"preload\" href=\"{}\" as=\"style\">\n<link rel=\"stylesheet\" href=\"{}\">\n<script>\n(function(){{var h=document.documentElement,t=localStorage.getItem('theme');if(t==='dark')h.classList.add('dark');else if(t==='light')h.classList.add('light');}})();\n</script>\n</head>\n<body>\n<a href=\"#main\" class=\"skip-link\">Skip to content</a>\n",
            escaped_title, escaped_forum, css_path, css_path,
        )
    }

    fn site_header(&self, depth: usize) -> String {
        let home = format!("{}index.html", "../".repeat(depth));
        let search = format!("{}search.html", "../".repeat(depth));
        let stats = format!("{}stats.html", "../".repeat(depth));
        let tags = format!("{}tags/index.html", "../".repeat(depth));
        format!(
            r#"<div class="site-header" role="banner">
<h1><a href="{home}">{name}</a></h1>
<a href="{search}" style="color:var(--header-text);font-size:0.9rem;">Search</a>
<a href="{stats}" style="color:var(--header-text);font-size:0.9rem;">Stats</a>
<a href="{tags}" style="color:var(--header-text);font-size:0.9rem;">Tags</a>
<button class="theme-toggle" aria-label="Toggle dark mode">Dark/Light</button>
</div>
"#,
            home = home,
            name = html_escape(&self.forum_title),
            search = search,
            stats = stats,
            tags = tags,
        )
    }

    fn site_footer(&self, stats: &ForumStats) -> String {
        let stats_html = if stats.topics > 0 {
            format!(
                "<div class=\"footer-stats\">{} topics &middot; {} posts &middot; {} users</div>\n",
                stats.topics, stats.posts, stats.users
            )
        } else {
            String::new()
        };
        format!(
            r#"<div class="site-footer" role="contentinfo">
{stats_html}Archive of {forum}
</div>
{theme_js}</body>
</html>
"#,
            stats_html = stats_html,
            forum = html_escape(&self.forum_title),
            theme_js = THEME_TOGGLE_JS,
        )
    }

    /// Rewrite image URLs in cooked HTML to local paths
    fn rewrite_cooked_html(&self, cooked: &str, page_depth: usize) -> String {
        let img_re = Regex::new(r#"<img([^>]+)src=["']([^"']+)["']"#).unwrap();

        img_re
            .replace_all(cooked, |caps: &regex::Captures| {
                let attrs = &caps[1];
                let url = &caps[2];

                if let Some(local_path) = self.url_map.get(url) {
                    let rel = format!("{}{}", "../".repeat(page_depth), local_path);
                    format!("<img{}src=\"{}\"", attrs, rel)
                } else if self.failed_urls.contains(url) {
                    "<span class=\"broken-image\" title=\"Image no longer available\">Image unavailable</span".to_string()
                } else {
                    caps[0].to_string()
                }
            })
            .to_string()
    }
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/// Truncate a string to at most `max_bytes` bytes, respecting UTF-8 char boundaries.
fn truncate_str(s: &str, max_bytes: usize) -> &str {
    if s.len() <= max_bytes {
        return s;
    }
    // Walk backwards from max_bytes to find a char boundary
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#x27;")
}

fn format_date(iso_str: Option<&str>) -> String {
    match iso_str {
        Some(s) if s.len() >= 10 => truncate_str(s, 10).to_string(),
        _ => String::new(),
    }
}

fn page_filename(page_num: usize) -> String {
    if page_num == 1 {
        "index.html".to_string()
    } else {
        format!("page-{}.html", page_num)
    }
}

fn breadcrumbs(crumbs: &[(&str, Option<&str>)], depth: usize) -> String {
    breadcrumbs_with_urls(
        &crumbs.iter().map(|(l, u)| (*l, *u)).collect::<Vec<_>>(),
        depth,
    )
}

fn breadcrumbs_with_urls(crumbs: &[(&str, Option<&str>)], depth: usize) -> String {
    let home_url = format!("{}index.html", "../".repeat(depth));
    let mut parts = vec![format!("<a href=\"{}\">Home</a>", home_url)];
    for (label, url) in crumbs {
        match url {
            Some(u) => parts.push(format!("<a href=\"{}\">{}</a>", u, html_escape(label))),
            None => parts.push(format!("<span>{}</span>", html_escape(label))),
        }
    }
    format!(
        "<nav class=\"breadcrumbs\" role=\"navigation\" aria-label=\"Breadcrumbs\">{}</nav>\n",
        parts.join(" &rsaquo; ")
    )
}

fn pagination_html(current_page: usize, total_pages: usize) -> String {
    if total_pages <= 1 {
        return String::new();
    }
    let mut html = "<div class=\"pagination\">\n".to_string();
    for i in 1..=total_pages {
        if i == current_page {
            html += &format!("<span class=\"page-current\">{}</span>\n", i);
        } else {
            html += &format!("<a href=\"{}\">{}</a>\n", page_filename(i), i);
        }
    }
    html += "</div>\n";
    html
}

fn topic_badges_html(topic: &DiscourseTopic, tag_prefix: &str) -> String {
    let mut badges = String::new();
    if topic.pinned {
        badges += "<span class=\"badge badge-pinned\">Pinned</span> ";
    }
    if topic.closed {
        badges += "<span class=\"badge badge-closed\">Closed</span> ";
    }
    if topic.archived {
        badges += "<span class=\"badge badge-archived\">Archived</span> ";
    }
    for tag in &topic.tags {
        badges += &format!(
            "<a class=\"badge badge-tag\" href=\"{}tags/{}/index.html\">{}</a> ",
            tag_prefix,
            html_escape(tag),
            html_escape(tag)
        );
    }
    if topic.like_count > 0 {
        badges += &format!(
            "<span class=\"topic-likes\">&#9829; {}</span> ",
            topic.like_count
        );
    }
    badges
}

fn avatar_img(user: &DiscourseUser, depth: usize) -> String {
    let src = match &user.avatar_local {
        Some(fname) => format!("{}assets/images/avatars/{}", "../".repeat(depth), fname),
        None => String::new(),
    };
    format!(
        "<img src=\"{}\" alt=\"{}\" width=\"48\" height=\"48\" loading=\"lazy\">",
        src,
        html_escape(&user.username)
    )
}

fn find_original_poster(
    topic: &DiscourseTopic,
    user_by_id: &HashMap<u64, &DiscourseUser>,
) -> String {
    for poster in &topic.posters {
        if let Some(ref desc) = poster.description {
            if desc.contains("Original Poster") {
                if let Some(uid) = poster.user_id {
                    if let Some(user) = user_by_id.get(&uid) {
                        return user.username.clone();
                    }
                }
            }
        }
    }
    String::new()
}

/// SHA256-based filename for URL (matching Python url_to_filename)
pub fn url_to_filename(url: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(url.as_bytes());
    let hash = format!("{:x}", hasher.finalize());
    let hash = truncate_str(&hash, 16);

    let ext = url
        .rsplit('/')
        .next()
        .and_then(|segment| {
            let segment = segment.split('?').next().unwrap_or(segment);
            segment.rfind('.').map(|i| &segment[i..])
        })
        .unwrap_or(".img");

    let ext = if ext.len() > 10 { ".img" } else { ext };

    format!("{}{}", hash, ext)
}

fn minify_css(css: &str) -> String {
    let re_comment = Regex::new(r"/\*.*?\*/").unwrap();
    let css = re_comment.replace_all(css, "");
    let re_ws = Regex::new(r"\s+").unwrap();
    let css = re_ws.replace_all(&css, " ");
    let re_tokens = Regex::new(r"\s*([{}:;,])\s*").unwrap();
    let css = re_tokens.replace_all(&css, "$1");
    let re_semi = Regex::new(r";\s*\}").unwrap();
    re_semi.replace_all(&css, "}").trim().to_string()
}

// ---------------------------------------------------------------------------
// Forum stats struct
// ---------------------------------------------------------------------------

#[derive(Default)]
struct ForumStats {
    topics: usize,
    posts: usize,
    users: usize,
    categories: usize,
}

// ---------------------------------------------------------------------------
// JS constants
// ---------------------------------------------------------------------------

const THEME_TOGGLE_JS: &str = r#"<script>
document.addEventListener('click',function(e){
  if(e.target.classList.contains('theme-toggle')){
    var h=document.documentElement;
    if(h.classList.contains('dark')){
      h.classList.remove('dark');h.classList.add('light');
      localStorage.setItem('theme','light');
    } else {
      h.classList.remove('light');h.classList.add('dark');
      localStorage.setItem('theme','dark');
    }
  }
});
</script>"#;

const CATEGORY_SORT_JS: &str = r#"<script>
(function(){
  var PER_PAGE=50;
  var data=window.__TOPICS||[];
  var filtered=data.slice();
  var sortField='activity';
  var sortAsc=false;
  var filterMode='all';
  var curPage=1;
  function cmp(a,b,f){var va=a[f],vb=b[f];if(typeof va==='string')return va.localeCompare(vb);return(va||0)-(vb||0);}
  function sortData(){filtered.sort(function(a,b){return sortAsc?cmp(a,b,sortField):-cmp(a,b,sortField);});}
  function applyFilter(){if(filterMode==='all')filtered=data.slice();else if(filterMode==='open')filtered=data.filter(function(t){return!t.closed;});else filtered=data.filter(function(t){return t.closed;});}
  function renderPage(page){
    var start=(page-1)*PER_PAGE,end=start+PER_PAGE;var items=filtered.slice(start,end);
    var tbody=document.getElementById('topic-tbody');var html='';
    items.forEach(function(t){
      var badges='';
      if(t.pinned)badges+='<span class="badge badge-pinned">Pinned</span>';
      if(t.closed)badges+='<span class="badge badge-closed">Closed</span>';
      if(t.archived)badges+='<span class="badge badge-archived">Archived</span>';
      if(t.tags){t.tags.forEach(function(tg){badges+='<a class="badge badge-tag" href="../../tags/'+tg+'/index.html">'+tg+'</a>';});}
      var likesHtml=t.likes>0?'<span style="color:#e25555;">&#9829;</span> '+t.likes:'0';
      var excerpt=t.excerpt?'<div class="topic-excerpt">'+t.excerpt+'</div>':'';
      html+='<tr><td><a class="topic-title" href="../../t/'+t.slug+'/'+t.id+'/index.html">'+t.title+'</a>'+badges+excerpt+'<div class="topic-meta">'+t.author+'</div></td>';
      html+='<td>'+t.replies+'</td><td class="col-likes">'+likesHtml+'</td><td class="col-views">'+t.views+'</td><td>'+t.activity+'</td></tr>';
    });
    tbody.innerHTML=html;curPage=page;renderPagination();
  }
  function renderPagination(){
    var total=Math.ceil(filtered.length/PER_PAGE)||1;var cont=document.getElementById('js-page-nav');
    if(total<=1){cont.innerHTML='';return;}var html='';
    for(var i=1;i<=total;i++){html+='<button'+(i===curPage?' class="active"':'')+' data-page="'+i+'">'+i+'</button>';}
    cont.innerHTML=html;
  }
  function init(){
    applyFilter();sortData();renderPage(1);
    document.querySelectorAll('.sort-btn').forEach(function(btn){btn.addEventListener('click',function(){var f=this.getAttribute('data-sort');if(sortField===f)sortAsc=!sortAsc;else{sortField=f;sortAsc=false;}document.querySelectorAll('.sort-btn').forEach(function(b){b.classList.remove('active');});this.classList.add('active');sortData();renderPage(1);});});
    document.querySelectorAll('.filter-btn').forEach(function(btn){btn.addEventListener('click',function(){filterMode=this.getAttribute('data-filter');document.querySelectorAll('.filter-btn').forEach(function(b){b.classList.remove('active');});this.classList.add('active');applyFilter();sortData();renderPage(1);});});
    document.getElementById('js-page-nav').addEventListener('click',function(e){if(e.target.tagName==='BUTTON'&&e.target.dataset.page){renderPage(parseInt(e.target.dataset.page));}});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
</script>"#;

// ---------------------------------------------------------------------------
// CSS (ported from build_site.py)
// ---------------------------------------------------------------------------

const CSS: &str = r#":root {
    --bg: #f8f8f8;
    --card-bg: #fff;
    --text: #222;
    --text-muted: #888;
    --border: #e0e0e0;
    --link: #2a6496;
    --link-hover: #1a4060;
    --header-bg: #1a1a2e;
    --header-text: #e0e0e0;
    --reply-bg: #f0f4f8;
    --row-even: #fafbfc;
    --row-hover: #f0f4f8;
    --broken-bg: #f0f0f0;
    --broken-border: #ccc;
    --broken-text: #999;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.5;
}
a { color: var(--link); text-decoration: none; }
a:hover { color: var(--link-hover); text-decoration: underline; }
.site-header {
    background: var(--header-bg);
    color: var(--header-text);
    padding: 16px 24px;
    display: flex; align-items: center; gap: 16px;
}
.site-header h1 { font-size: 1.3rem; font-weight: 600; }
.site-header a { color: var(--header-text); }
.site-header a:hover { color: #fff; text-decoration: none; }
.theme-toggle {
    margin-left: auto;
    background: transparent; border: 1px solid var(--header-text);
    color: var(--header-text); padding: 4px 10px; border-radius: 4px;
    cursor: pointer; font-size: 0.85rem;
}
.theme-toggle:hover { background: rgba(255,255,255,0.1); }
.breadcrumbs {
    padding: 10px 24px;
    font-size: 0.9rem;
    color: var(--text-muted);
    border-bottom: 1px solid var(--border);
    background: var(--card-bg);
}
.breadcrumbs a { margin: 0 4px; }
.breadcrumbs span { margin: 0 2px; color: var(--text-muted); }
.container { max-width: 1080px; margin: 0 auto; padding: 24px; }
.search-box { margin-bottom: 20px; }
.search-box input {
    width: 100%; padding: 10px 14px;
    border: 1px solid var(--border); border-radius: 6px;
    font-size: 1rem; background: var(--card-bg); color: var(--text);
    outline: none;
}
.search-box input:focus { border-color: var(--link); box-shadow: 0 0 0 2px rgba(42,100,150,0.15); }
.search-results {
    list-style: none; background: var(--card-bg);
    border: 1px solid var(--border); border-radius: 6px;
    max-height: 400px; overflow-y: auto; display: none;
}
.search-results li { padding: 10px 14px; border-bottom: 1px solid var(--border); }
.search-results li:last-child { border-bottom: none; }
.search-results li:hover { background: var(--row-hover); }
.search-results .sr-title { font-weight: 600; }
.search-results .sr-excerpt { font-size: 0.85rem; color: var(--text-muted); margin-top: 2px; }
.category-list { list-style: none; }
.category-item {
    display: flex; align-items: center; gap: 16px;
    padding: 14px 16px;
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    margin-bottom: 8px;
    transition: box-shadow 0.15s;
}
.category-item:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.07); }
.cat-color { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.cat-info { flex: 1; }
.cat-name { font-weight: 600; font-size: 1.05rem; }
.cat-desc { color: var(--text-muted); font-size: 0.85rem; margin-top: 2px; }
.cat-stats { font-size: 0.8rem; color: var(--text-muted); white-space: nowrap; text-align: right; min-width: 100px; }
.topic-table { width: 100%; border-collapse: collapse; }
.topic-table th {
    text-align: left; padding: 10px 12px; font-size: 0.8rem;
    color: var(--text-muted); border-bottom: 2px solid var(--border);
    text-transform: uppercase; letter-spacing: 0.5px;
}
.topic-table td { padding: 12px; border-bottom: 1px solid var(--border); vertical-align: middle; }
.topic-table tbody tr:nth-child(even) td { background: var(--row-even); }
.topic-table tbody tr:hover td { background: var(--row-hover); }
.topic-title { font-weight: 600; }
.topic-excerpt { font-size: 0.8rem; color: var(--text-muted); margin-top: 3px; }
.badge {
    display: inline-block; font-size: 0.7rem; padding: 1px 6px;
    border-radius: 3px; margin-left: 6px; vertical-align: middle;
}
.badge-pinned { background: #d4edda; color: #155724; }
.badge-closed { background: #f8d7da; color: #721c24; }
.badge-archived { background: #e2e3e5; color: #383d41; }
.badge-tag { background: #e8f0fe; color: #1a5276; }
.badge-tag:hover { background: #d0e2f7; text-decoration: none; }
.topic-meta { font-size: 0.85rem; color: var(--text-muted); }
.post {
    display: flex; gap: 16px;
    padding: 20px 0;
    border-bottom: 1px solid var(--border);
}
.post:target { background: #fffbe6; margin: 0 -16px; padding: 20px 16px; border-radius: 4px; }
.post-avatar img { width: 48px; height: 48px; border-radius: 50%; background: var(--border); }
.post-body { flex: 1; min-width: 0; }
.post-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
.post-username { font-weight: 600; }
.post-date { font-size: 0.8rem; color: var(--text-muted); }
.post-number { font-size: 0.75rem; color: var(--text-muted); }
.reply-indicator {
    font-size: 0.8rem; color: var(--text-muted);
    background: var(--reply-bg); padding: 2px 8px; border-radius: 3px;
}
.reply-indicator a { color: var(--link); }
.post-content { word-wrap: break-word; overflow-wrap: break-word; line-height: 1.65; }
.post-content img { max-width: 100%; height: auto; border-radius: 4px; }
.post-content blockquote {
    border-left: 3px solid var(--border); padding: 8px 16px;
    margin: 12px 0; color: #555; background: #fafafa;
}
.post-content pre { background: #f5f5f5; padding: 12px; border-radius: 4px; overflow-x: auto; font-size: 0.9rem; }
.post-content p { margin: 8px 0; }
.post-reply { margin-left: 32px; border-left: 3px solid var(--link); padding-left: 16px; }
.reply-count-badge {
    font-size: 0.75rem; color: var(--text-muted); margin-left: auto;
    background: var(--reply-bg); padding: 1px 8px; border-radius: 3px;
}
.broken-image {
    display: inline-block; padding: 12px 16px;
    background: var(--broken-bg); border: 2px dashed var(--broken-border);
    border-radius: 4px; color: var(--broken-text); font-size: 0.8rem;
}
.pagination { display: flex; gap: 4px; justify-content: center; padding: 20px 0; flex-wrap: wrap; }
.pagination a, .page-current {
    padding: 6px 12px; border: 1px solid var(--border); border-radius: 4px;
    font-size: 0.9rem; text-decoration: none;
}
.page-current { background: var(--link); color: #fff; border-color: var(--link); }
.pagination a:hover { background: var(--row-hover); text-decoration: none; }
.profile-card {
    display: flex; gap: 24px; align-items: flex-start;
    background: var(--card-bg); border: 1px solid var(--border);
    border-radius: 8px; padding: 24px; margin-bottom: 20px;
}
.profile-card img { width: 96px; height: 96px; border-radius: 50%; background: var(--border); }
.profile-info h2 { margin-bottom: 4px; }
.profile-info .title { color: var(--text-muted); font-style: italic; margin-bottom: 8px; }
.profile-stats { display: flex; gap: 24px; flex-wrap: wrap; margin-top: 12px; font-size: 0.9rem; }
.profile-stats .stat-label { color: var(--text-muted); font-size: 0.75rem; text-transform: uppercase; }
.admin-badge { display: inline-block; background: #dc3545; color: #fff; font-size: 0.75rem; padding: 2px 8px; border-radius: 3px; margin-left: 8px; }
.mod-badge { display: inline-block; background: #28a745; color: #fff; font-size: 0.75rem; padding: 2px 8px; border-radius: 3px; margin-left: 8px; }
.site-footer { text-align: center; padding: 24px; font-size: 0.8rem; color: var(--text-muted); border-top: 1px solid var(--border); margin-top: 40px; }
.footer-stats { margin-bottom: 6px; }
.stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 32px; }
.stats-card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; padding: 20px; text-align: center; }
.stats-card .stat-value { font-size: 1.8rem; font-weight: 700; color: var(--link); }
.stats-card .stat-label { font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase; margin-top: 4px; }
.stat-bar-row { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
.stat-bar-label { min-width: 150px; font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.stat-bar-fill { height: 24px; background: var(--link); border-radius: 4px; min-width: 2px; transition: width 0.3s; }
.stat-bar-count { font-size: 0.8rem; color: var(--text-muted); min-width: 50px; }
.user-posts-list { list-style: none; }
.user-post-item { padding: 12px 0; border-bottom: 1px solid var(--border); }
.user-post-topic { font-weight: 600; }
.user-post-date { font-size: 0.8rem; color: var(--text-muted); margin-left: 8px; }
.user-post-excerpt { font-size: 0.85rem; color: var(--text-muted); margin-top: 4px; }
.skip-link { position: absolute; top: -40px; left: 0; background: var(--link); color: #fff; padding: 8px 16px; z-index: 1000; font-size: 0.9rem; text-decoration: none; transition: top 0.2s; }
.skip-link:focus { top: 0; }
:focus-visible { outline: 2px solid var(--link); outline-offset: 2px; }
.trust-badge { display: inline-block; font-size: 0.7rem; padding: 1px 6px; border-radius: 3px; margin-left: 6px; vertical-align: middle; font-weight: 600; }
.trust-0 { background: #6c757d; color: #fff; }
.trust-1 { background: #17a2b8; color: #fff; }
.trust-2 { background: #28a745; color: #fff; }
.trust-3 { background: #fd7e14; color: #fff; }
.trust-4 { background: #dc3545; color: #fff; }
.cat-page-desc { color: var(--text-muted); margin: -8px 0 16px 0; font-size: 0.95rem; }
.topic-likes { display: inline-block; color: #e25555; font-size: 0.9rem; margin-left: 8px; }
.table-controls { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; align-items: center; }
.table-controls .label { font-size: 0.8rem; color: var(--text-muted); margin-right: 4px; }
.sort-btn, .filter-btn {
    display: inline-block; font-size: 0.8rem; padding: 4px 12px;
    border: 1px solid var(--border); border-radius: 16px; cursor: pointer;
    background: var(--card-bg); color: var(--text);
}
.sort-btn:hover, .filter-btn:hover { background: var(--row-hover); }
.sort-btn.active, .filter-btn.active { background: var(--link); color: #fff; border-color: var(--link); }
.js-pagination { display: flex; gap: 4px; justify-content: center; padding: 20px 0; flex-wrap: wrap; }
.js-pagination button {
    padding: 6px 12px; border: 1px solid var(--border); border-radius: 4px;
    font-size: 0.9rem; cursor: pointer; background: var(--card-bg); color: var(--text);
}
.js-pagination button:hover { background: var(--row-hover); }
.js-pagination button.active { background: var(--link); color: #fff; border-color: var(--link); }
@media (prefers-color-scheme: dark) {
    :root:not(.light) {
        --bg: #1a1a2e; --card-bg: #16213e; --text: #e0e0e0; --text-muted: #8899aa;
        --border: #2a3a5a; --link: #6cb4ee; --link-hover: #8ccaff;
        --header-bg: #0f0f1e; --header-text: #d0d0e0; --reply-bg: #1c2a44;
        --row-even: #182238; --row-hover: #1e2e4e;
        --broken-bg: #1e2e4e; --broken-border: #2a3a5a; --broken-text: #6688aa;
    }
    :root:not(.light) .post-content blockquote { background: #1c2a44; color: #b0c0d0; }
    :root:not(.light) .post-content pre { background: #0f1e36; }
    :root:not(.light) .badge-pinned { background: #1a3a2a; color: #6dbe82; }
    :root:not(.light) .badge-closed { background: #3a1a1a; color: #e07070; }
    :root:not(.light) .badge-archived { background: #2a2a3a; color: #8888aa; }
    :root:not(.light) .badge-tag { background: #1c2a44; color: #6cb4ee; }
}
html.dark {
    --bg: #1a1a2e; --card-bg: #16213e; --text: #e0e0e0; --text-muted: #8899aa;
    --border: #2a3a5a; --link: #6cb4ee; --link-hover: #8ccaff;
    --header-bg: #0f0f1e; --header-text: #d0d0e0; --reply-bg: #1c2a44;
    --row-even: #182238; --row-hover: #1e2e4e;
    --broken-bg: #1e2e4e; --broken-border: #2a3a5a; --broken-text: #6688aa;
}
html.dark .post-content blockquote { background: #1c2a44; color: #b0c0d0; }
html.dark .post-content pre { background: #0f1e36; }
html.dark .badge-pinned { background: #1a3a2a; color: #6dbe82; }
html.dark .badge-closed { background: #3a1a1a; color: #e07070; }
html.dark .badge-archived { background: #2a2a3a; color: #8888aa; }
html.dark .badge-tag { background: #1c2a44; color: #6cb4ee; }
@media (max-width: 768px) {
    .site-header { padding: 12px 16px; flex-wrap: wrap; }
    .container { max-width: 100%; }
    .topic-table { font-size: 0.9rem; }
    .stat-bar-label { min-width: 100px; }
}
@media (max-width: 600px) {
    .container { padding: 12px; }
    .post { gap: 10px; }
    .post-avatar img { width: 36px; height: 36px; }
    .post-reply { margin-left: 16px; padding-left: 10px; }
    .profile-card { flex-direction: column; align-items: center; text-align: center; }
    .category-item { flex-direction: column; align-items: flex-start; gap: 6px; }
    .cat-stats { text-align: left; }
    .topic-table .col-views, .topic-table .col-likes { display: none; }
    .pagination a, .page-current { min-height: 44px; min-width: 44px; display: flex; align-items: center; justify-content: center; }
}
@media print {
    .site-header, .site-footer, .breadcrumbs, .pagination, .skip-link, .search-box { display: none; }
    body { background: #fff; color: #000; }
    a { color: #000; text-decoration: underline; }
    .container { max-width: 100%; }
}"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_url_to_filename() {
        let name = url_to_filename("https://example.com/images/photo.jpg");
        assert!(name.ends_with(".jpg"));
        assert_eq!(name.len(), 16 + 4); // 16 hex + .jpg

        let name2 = url_to_filename("https://example.com/images/photo.jpg");
        assert_eq!(name, name2); // deterministic

        let name3 = url_to_filename("https://example.com/no-ext");
        assert!(name3.ends_with(".img"));
    }

    #[test]
    fn test_html_escape() {
        assert_eq!(html_escape("<script>"), "&lt;script&gt;");
        assert_eq!(html_escape("a & b"), "a &amp; b");
        assert_eq!(html_escape("\"quotes\""), "&quot;quotes&quot;");
    }

    #[test]
    fn test_format_date() {
        assert_eq!(format_date(Some("2024-01-15T12:00:00Z")), "2024-01-15");
        assert_eq!(format_date(None), "");
        assert_eq!(format_date(Some("short")), "");
    }

    #[test]
    fn test_page_filename() {
        assert_eq!(page_filename(1), "index.html");
        assert_eq!(page_filename(2), "page-2.html");
        assert_eq!(page_filename(10), "page-10.html");
    }

    #[test]
    fn test_minify_css() {
        let css = "body { color: red; }";
        let minified = minify_css(css);
        assert_eq!(minified, "body{color:red}");
    }
}
