mod commands;
pub mod crypto;
mod error;
mod features;
pub mod node_api;
mod services;
mod state;

use services::node::NodeManager;
use services::sync::SyncManager;
use state::AppState;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri::menu::{Menu, MenuItem};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri::Manager;
use tauri::Emitter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Create shared app state
    let app_state = AppState::new();
    let node_service = app_state.node.clone();
    let sync_service = app_state.sync.clone();
    let backup_daemon = app_state.backup_daemon.clone();
    let config_service = app_state.config.clone();
    let manifest_registry = app_state.manifest_registry.clone();
    let manifest_server = app_state.manifest_server.clone();
    let media_service = app_state.media.clone();
    let media_streaming = app_state.media_streaming.clone();
    let web_archive_service = app_state.web_archive.clone();
    let chat_service = app_state.chat.clone();
    let chat_server = app_state.chat_server.clone();
    let torrent_service = app_state.torrent.clone();

    let mut builder = tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .level_for("librqbit", log::LevelFilter::Warn)
                .level_for("librqbit_dht", log::LevelFilter::Warn)
                .level_for("librqbit_tracker_comms", log::LevelFilter::Warn)
                .level_for("tracing::span", log::LevelFilter::Off)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init());

    // Desktop-only plugins
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder
            .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
                log::info!("Another instance attempted to start, focusing window");
                // Focus the main window when another instance tries to start
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }))
            .plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                Some(vec!["--minimized"]),
            ))
            .plugin(tauri_plugin_updater::Builder::new().build());
    }

    let app = builder
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            // Feature detection
            features::get_features,
            // Node commands
            commands::start_node,
            commands::stop_node,
            commands::restart_node,
            commands::get_node_status,
            commands::get_node_config,
            commands::set_node_config,
            commands::health_check_node,
            commands::run_node_diagnostics,
            commands::get_node_logs,
            commands::get_node_log_path,
            // File commands
            commands::list_files,
            commands::upload_file,
            commands::download_file,
            commands::delete_file,
            commands::delete_all_files,
            commands::pin_file,
            commands::get_file,
            commands::check_node_connection,
            commands::get_file_info_by_cid,
            // Sync commands
            commands::get_sync_status,
            commands::add_watch_folder,
            commands::remove_watch_folder,
            commands::toggle_watch_folder,
            commands::sync_now,
            commands::pause_sync,
            commands::generate_folder_manifest,
            commands::notify_backup_peer,
            commands::test_backup_peer_connection,
            commands::create_quickstart_folder,
            // Backup daemon commands
            commands::get_backup_daemon_state,
            commands::enable_backup_daemon,
            commands::disable_backup_daemon,
            commands::pause_backup_daemon,
            commands::resume_backup_daemon,
            commands::retry_failed_manifest,
            // Peer commands
            commands::get_peers,
            commands::connect_peer,
            commands::disconnect_peer,
            commands::remove_peer,
            // Media download commands
            commands::check_media_binaries,
            commands::install_yt_dlp,
            commands::install_ffmpeg,
            commands::fetch_media_metadata,
            commands::queue_media_download,
            commands::cancel_media_download,
            commands::remove_media_task,
            commands::clear_completed_downloads,
            commands::get_download_queue,
            commands::update_yt_dlp,
            // Web archive commands
            commands::queue_web_archive,
            commands::get_archive_queue,
            commands::cancel_web_archive,
            commands::remove_archive_task,
            commands::clear_completed_archives,
            commands::get_archived_sites,
            // Archive viewer commands
            commands::open_archive_viewer,
            commands::close_archive_viewer,
            commands::get_archive_viewer_status,
            // Streaming server commands
            commands::get_streaming_server_url,
            commands::start_streaming_server,
            commands::stop_streaming_server,
            commands::get_media_library,
            // Chat commands
            commands::initiate_chat_session,
            commands::send_chat_message,
            commands::get_conversations,
            commands::get_conversation_messages,
            commands::mark_messages_read,
            commands::delete_conversation,
            commands::get_chat_identity,
            commands::get_safety_number,
            commands::verify_peer_identity,
            commands::get_chat_server_status,
            commands::create_chat_group,
            commands::send_group_message,
            commands::add_group_member,
            commands::remove_group_member,
            commands::leave_group,
            commands::get_group_info,
            // Marketplace commands
            commands::get_sales_slots,
            commands::get_availability,
            commands::set_availability,
            commands::create_storage_request,
            commands::get_purchases,
            commands::get_purchase,
            // Wallet commands
            commands::get_wallet_info,
            // Torrent commands
            commands::get_torrent_session_stats,
            commands::add_torrent,
            commands::pause_torrent,
            commands::resume_torrent,
            commands::remove_torrent,
            commands::set_torrent_files,
            commands::get_torrent_peers,
            commands::get_torrent_details,
            commands::set_torrent_speed_limits,
            commands::set_torrent_seeding_rules,
            // System commands
            commands::get_config,
            commands::save_config,
            commands::reset_config,
            commands::get_app_version,
            commands::get_platform,
            commands::get_arch,
        ])
        .setup(move |app| {
            log::info!(
                "Archivist Desktop v{} starting...",
                env!("CARGO_PKG_VERSION")
            );

            // Log feature status
            let features = features::Features::new();
            log::info!(
                "Features: marketplace={}, zk_proofs={}",
                features.marketplace,
                features.zk_proofs
            );

            // Set up system tray (desktop only)
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
                setup_system_tray(app)?;
            }

            // Start the node health monitor
            let node_manager = NodeManager::new(node_service.clone(), app.handle().clone());
            tauri::async_runtime::spawn(async move {
                node_manager.start_monitoring().await;
            });

            // Auto-start node if configured
            let node_svc = node_service.clone();
            let chat_svc_for_autostart = chat_service.clone();
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let node = node_svc.read().await;
                if node.get_config().auto_start {
                    drop(node); // Release read lock
                    let mut node = node_svc.write().await;
                    if let Err(e) = node.start(&app_handle).await {
                        log::error!("Auto-start failed: {}", e);
                    } else {
                        // Wait for the node API to be ready, then update chat peer ID
                        for _ in 0..30 {
                            tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                            if node.health_check().await.unwrap_or(false) {
                                break;
                            }
                        }
                        let status = node.get_status();
                        if let Some(ref peer_id) = status.peer_id {
                            drop(node);
                            let mut chat = chat_svc_for_autostart.write().await;
                            chat.update_peer_id(peer_id);
                        }
                    }
                }
            });

            // Start the sync manager for file watching
            let sync_manager = SyncManager::new(sync_service.clone());
            tauri::async_runtime::spawn(async move {
                sync_manager.start_processing().await;
            });

            // Start the manifest discovery server (Machine A exposes this for Machine B to poll)
            let manifest_server_clone = manifest_server.clone();
            let manifest_registry_clone = manifest_registry.clone();
            let config_for_manifest = config_service.clone();
            tauri::async_runtime::spawn(async move {
                // Wait for node to start and get peer ID
                tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;

                // Try to get peer ID from node API
                let api_client = crate::node_api::NodeApiClient::new(8080);
                match api_client.get_info().await {
                    Ok(info) => {
                        let mut registry = manifest_registry_clone.write().await;
                        registry.set_peer_id(info.id.clone());
                        log::info!("Manifest registry peer ID set to: {}", info.id);
                    }
                    Err(e) => {
                        log::warn!("Could not get peer ID for manifest registry: {}", e);
                    }
                }

                let config = config_for_manifest.read().await;
                let app_config = config.get();

                if app_config.manifest_server.enabled {
                    log::info!(
                        "Starting manifest discovery server on port {}",
                        app_config.manifest_server.port
                    );
                    let mut server = manifest_server_clone.write().await;
                    if let Err(e) = server.start().await {
                        log::error!("Failed to start manifest server: {}", e);
                    }
                } else {
                    log::info!("Manifest discovery server is disabled");
                }
            });

            // Configure and start the backup daemon for automatic manifest processing
            let config_for_backup = config_service.clone();
            let backup_daemon_for_server = backup_daemon.clone();

            // Spawn the main daemon loop
            tauri::async_runtime::spawn(async move {
                // Configure source peers from settings
                let config = config_for_backup.read().await;
                let source_peers = config.get().backup_server.source_peers.clone();
                drop(config);

                backup_daemon.set_source_peers(source_peers).await;
                backup_daemon.start().await;
            });

            // Spawn the HTTP trigger server
            let trigger_port = backup_daemon_for_server.get_trigger_port();
            tauri::async_runtime::spawn(async move {
                backup_daemon_for_server.start_trigger_server().await;
            });
            log::info!(
                "Backup daemon initialized (trigger server on port {})",
                trigger_port
            );

            // Start media download queue processor
            let media_service_clone = media_service.clone();
            let app_handle_media = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    {
                        let mut media = media_service_clone.write().await;
                        media.process_queue(&app_handle_media).await;
                    }
                    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                }
            });
            log::info!("Media download queue processor started");

            // Start web archive queue processor
            let web_archive_clone = web_archive_service.clone();
            let app_handle_archive = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    crate::services::web_archive::process_queue(
                        &web_archive_clone,
                        &app_handle_archive,
                    )
                    .await;
                    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                }
            });
            log::info!("Web archive queue processor started");

            // Start chat TLS server and delivery queue processor
            let chat_service_for_server = chat_service.clone();
            let chat_server_clone = chat_server.clone();
            let config_for_chat = config_service.clone();
            let chat_app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // Set app handle on chat service
                {
                    let mut chat = chat_service_for_server.write().await;
                    chat.set_app_handle(chat_app_handle);
                }

                let config = config_for_chat.read().await;
                if config.get().chat.enabled {
                    let handler = std::sync::Arc::new(
                        crate::services::chat_service::ChatIncomingAdapter::new(
                            chat_service_for_server.clone(),
                        ),
                    );
                    let mut server = chat_server_clone.write().await;
                    if let Err(e) = server.start(handler).await {
                        log::error!("Failed to start chat TLS server: {}", e);
                    }
                } else {
                    log::info!("Chat server disabled in config");
                }
            });

            // Chat delivery queue processor (1s loop, same as media download)
            let chat_delivery_service = chat_service.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    {
                        let mut chat = chat_delivery_service.write().await;
                        chat.process_delivery_queue().await;
                    }
                    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                }
            });
            log::info!("Chat delivery queue processor started");

            // Auto-start media streaming server if enabled in config
            let media_streaming_clone = media_streaming.clone();
            let config_for_streaming = config_service.clone();
            tauri::async_runtime::spawn(async move {
                let config = config_for_streaming.read().await;
                if config.get().media_streaming.enabled {
                    let mut server = media_streaming_clone.write().await;
                    if let Err(e) = server.start().await {
                        log::error!("Failed to start media streaming server: {}", e);
                    }
                } else {
                    log::info!("Media streaming server auto-start disabled");
                }
            });

            // Initialize torrent session
            let torrent_service_init = torrent_service.clone();
            tauri::async_runtime::spawn(async move {
                let mut torrent = torrent_service_init.write().await;
                if let Err(e) = torrent.initialize().await {
                    log::error!("Failed to initialize torrent session: {}", e);
                } else {
                    log::info!("Torrent session initialized");
                }
            });

            // Torrent stats emitter + seeding rule enforcer (2s interval)
            let torrent_service_loop = torrent_service.clone();
            let app_handle_torrent = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    {
                        let mut torrent = torrent_service_loop.write().await;
                        match torrent.get_session_stats() {
                            Ok(stats) => {
                                let _ = app_handle_torrent.emit("torrent-stats-update", &stats);
                            }
                            Err(e) => {
                                log::warn!("Torrent stats emission failed: {}", e);
                            }
                        }
                        if let Err(e) = torrent.enforce_seeding_rules().await {
                            log::warn!("Seeding rules error: {}", e);
                        }
                    }
                    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                }
            });
            log::info!("Torrent stats emitter started");

            Ok(())
        })
        .on_window_event(|window, event| {
            // Handle window close to minimize to tray instead
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Hide the window instead of closing
                let _ = window.hide();
                api.prevent_close();
                log::info!("Window hidden to tray");
            }
        })
        .build(tauri::generate_context!())
        .expect("error building Archivist");

    app.run(|app_handle, event| {
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        if let tauri::RunEvent::Exit = event {
            log::info!("Application exiting, cleaning up...");
            let state = app_handle.state::<AppState>();
            let node = state.node.clone();
            let torrent = state.torrent.clone();
            tauri::async_runtime::block_on(async {
                // Shutdown torrent session
                let mut torrent = torrent.write().await;
                if let Err(e) = torrent.shutdown().await {
                    log::warn!("Torrent session cleanup on exit: {}", e);
                }
                drop(torrent);

                // Stop node sidecar
                let mut node = node.write().await;
                if let Err(e) = node.stop().await {
                    log::warn!("Sidecar cleanup on exit: {}", e);
                }
            });
            log::info!("Cleanup complete");
        }
    });
}

/// Set up the system tray icon and menu
#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn setup_system_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItem::with_id(app, "show", "Show Archivist", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    let _tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .tooltip("Archivist - Decentralized Storage")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "quit" => {
                log::info!("Quit requested from tray");
                let state = app.state::<AppState>();
                let node = state.node.clone();
                tauri::async_runtime::block_on(async {
                    let mut node = node.write().await;
                    if let Err(e) = node.stop().await {
                        log::warn!("Sidecar cleanup on quit: {}", e);
                    }
                });
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // Show window on double-click or left-click (platform dependent)
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    log::info!("System tray initialized");
    Ok(())
}
