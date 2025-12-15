mod commands;
mod error;
mod features;
pub mod node_api;
mod services;
mod state;

use state::AppState;
use services::node::NodeManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Create shared app state
    let app_state = AppState::new();
    let node_service = app_state.node.clone();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init());

    // Single instance plugin (desktop only)
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {
            log::info!("Another instance attempted to start");
        }));
    }

    builder
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
            // File commands
            commands::list_files,
            commands::upload_file,
            commands::download_file,
            commands::delete_file,
            commands::pin_file,
            commands::get_file,
            commands::check_node_connection,
            // Sync commands
            commands::get_sync_status,
            commands::add_watch_folder,
            commands::remove_watch_folder,
            commands::toggle_watch_folder,
            commands::sync_now,
            commands::pause_sync,
            // Peer commands
            commands::get_peers,
            commands::connect_peer,
            commands::disconnect_peer,
            commands::remove_peer,
            // System commands
            commands::get_config,
            commands::save_config,
            commands::reset_config,
            commands::get_app_version,
            commands::get_platform,
            commands::get_arch,
        ])
        .setup(move |app| {
            log::info!("Archivist Desktop v{} starting...", env!("CARGO_PKG_VERSION"));

            // Log feature status
            let features = features::Features::new();
            log::info!("Features: marketplace={}, zk_proofs={}",
                features.marketplace, features.zk_proofs);

            // Start the node health monitor
            let node_manager = NodeManager::new(node_service.clone(), app.handle().clone());
            tauri::async_runtime::spawn(async move {
                node_manager.start_monitoring().await;
            });

            // Auto-start node if configured
            let node_svc = node_service.clone();
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let node = node_svc.read().await;
                if node.get_config().auto_start {
                    drop(node); // Release read lock
                    let mut node = node_svc.write().await;
                    if let Err(e) = node.start(&app_handle).await {
                        log::error!("Auto-start failed: {}", e);
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Archivist");
}
