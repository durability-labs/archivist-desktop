//! Integration test: Discourse scraper → site builder → ZIP → upload pipeline
//!
//! Run with: cargo test --manifest-path src-tauri/Cargo.toml --test discourse_integration -- --nocapture

use std::collections::HashSet;
use std::io::Write;

// We test each component in isolation since we can't easily construct AppHandle in tests

#[tokio::test]
#[ignore] // requires network access to external Discourse instance
async fn test_discourse_scrape_and_build() {
    // -- Phase 1: Scrape --
    let (cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);
    let (pause_tx, pause_rx) = tokio::sync::watch::channel(false);
    let _ = (cancel_tx, pause_tx); // keep senders alive

    let mut scraper = archivist_lib::services::discourse_scraper::DiscourseScraper::new(
        "https://forums.theanimenetwork.com",
        cancel_rx,
        pause_rx,
        500,  // 500ms delay
        None, // no state persistence for test
    )
    .expect("Failed to create scraper");

    // Scrape site info
    scraper
        .scrape_site_info()
        .await
        .expect("Failed to scrape site info");
    println!("Forum title: {}", scraper.forum_title);
    assert!(
        !scraper.forum_title.is_empty(),
        "Forum title should not be empty"
    );

    // Scrape categories
    scraper
        .scrape_categories()
        .await
        .expect("Failed to scrape categories");
    println!("Categories: {}", scraper.categories.len());
    assert!(
        scraper.categories.len() > 0,
        "Should have at least one category"
    );

    // Scrape topics (limit to 10 for speed)
    let progress_cb = |p: &archivist_lib::services::discourse_scraper::ScrapeProgress| {
        println!(
            "  [{}] topics: {}/{}, posts: {}, users: {}",
            p.phase, p.topics_scraped, p.topics_found, p.posts_found, p.users_found
        );
    };
    scraper
        .scrape_topics(Some(10), &progress_cb)
        .await
        .expect("Failed to scrape topics");
    println!("Topics found: {}", scraper.topics.len());
    assert!(scraper.topics.len() > 0, "Should have at least one topic");

    // Scrape posts for all topics
    scraper
        .scrape_all_topic_posts(&progress_cb)
        .await
        .expect("Failed to scrape topic posts");
    println!("Posts collected: {}", scraper.posts.len());
    assert!(scraper.posts.len() > 0, "Should have at least one post");

    // Scrape users (limited set from posts)
    scraper
        .scrape_users(&progress_cb)
        .await
        .expect("Failed to scrape users");
    println!("Users collected: {}", scraper.users.len());

    // Collect image URLs
    scraper.collect_image_urls();
    println!(
        "Images: {} post images, {} avatars",
        scraper.image_urls.len(),
        scraper.avatar_urls.len()
    );

    // -- Phase 2: Build site --
    let builder = archivist_lib::services::discourse_site_builder::SiteBuilder::new(
        scraper.categories,
        scraper.topics,
        scraper.posts,
        scraper.users,
        scraper.forum_title,
    );

    let site_files = builder.build();
    println!("Site files generated: {}", site_files.len());
    assert!(
        site_files.len() > 3,
        "Should have index + category + topic pages"
    );

    // Check that key files exist
    let file_names: Vec<&str> = site_files.iter().map(|(name, _)| name.as_str()).collect();
    assert!(file_names.contains(&"index.html"), "Should have index.html");
    assert!(
        file_names.contains(&"assets/style.css"),
        "Should have style.css"
    );
    assert!(
        file_names.contains(&"search.html"),
        "Should have search.html"
    );
    assert!(file_names.contains(&"stats.html"), "Should have stats.html");

    // Verify HTML content
    let index = site_files
        .iter()
        .find(|(name, _)| name == "index.html")
        .expect("index.html missing");
    let html = String::from_utf8_lossy(&index.1);
    assert!(html.contains("<!DOCTYPE html>"), "Should be valid HTML");
    assert!(html.contains("<html"), "Should have html tag");

    // -- Phase 3: Create ZIP --
    let zip_path = std::env::temp_dir().join("archivist-discourse-test.zip");
    {
        let file = std::fs::File::create(&zip_path).expect("Failed to create ZIP file");
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);

        let mut written: HashSet<String> = HashSet::new();
        for (rel_path, data) in &site_files {
            if !written.insert(rel_path.clone()) {
                continue;
            }
            zip.start_file(rel_path, options)
                .expect("Failed to start ZIP entry");
            zip.write_all(data).expect("Failed to write ZIP entry");
        }
        zip.finish().expect("Failed to finalize ZIP");
    }

    let zip_size = std::fs::metadata(&zip_path)
        .expect("ZIP file missing")
        .len();
    println!("ZIP created: {} bytes at {:?}", zip_size, zip_path);
    assert!(zip_size > 1000, "ZIP should be non-trivial size");

    // -- Phase 4: Upload to node (if running) --
    let api_url = "http://127.0.0.1:8080/api/archivist/v1/data";
    let client = reqwest::Client::new();

    let zip_data = std::fs::read(&zip_path).expect("Failed to read ZIP");
    let resp = client
        .post(api_url)
        .header("Content-Type", "application/zip")
        .header(
            "Content-Disposition",
            "attachment; filename=\"discourse-test.zip\"",
        )
        .body(zip_data)
        .send()
        .await;

    match resp {
        Ok(r) if r.status().is_success() => {
            let cid = r.text().await.unwrap_or_default();
            println!("Upload successful! CID: {}", cid.trim());
            assert!(!cid.trim().is_empty(), "CID should not be empty");
        }
        Ok(r) => {
            println!(
                "Upload returned non-success: {} - {}",
                r.status(),
                r.text().await.unwrap_or_default()
            );
        }
        Err(e) => {
            println!("Upload failed (node may not be running): {}", e);
        }
    }

    // Cleanup
    let _ = std::fs::remove_file(&zip_path);

    println!("\n=== PIPELINE TEST COMPLETE ===");
}
