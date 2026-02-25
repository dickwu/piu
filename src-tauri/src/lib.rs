use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

mod commands;
mod db;
mod http;

const APP_NAME: &str = "piu";

async fn init_db_with_recovery<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    db_path: &std::path::Path,
) -> Result<(), String> {
    if let Err(err) = db::init_db(db_path).await {
        let (tx, rx) = tokio::sync::oneshot::channel();
        let message = format!(
            "Failed to load local database:\n{}\n\nLocation: {}\n\nRemove the database file and recreate it?",
            err,
            db_path.display()
        );

        app.dialog()
            .message(&message)
            .title(APP_NAME)
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Remove DB File".to_string(),
                "Quit".to_string(),
            ))
            .show(move |confirmed| {
                let _ = tx.send(confirmed);
            });

        let should_reset = rx.await.unwrap_or(false);
        if !should_reset {
            return Err(format!("Database initialization failed: {}", err));
        }

        if let Err(remove_err) = std::fs::remove_file(db_path) {
            if remove_err.kind() != std::io::ErrorKind::NotFound {
                return Err(format!(
                    "Failed to remove database file {}: {}",
                    db_path.display(),
                    remove_err
                ));
            }
        }

        db::init_db(db_path)
            .await
            .map_err(|e| format!("Failed to reinitialize database: {}", e))?;
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data dir");
            std::fs::create_dir_all(&app_data_dir).expect("Failed to create app data dir");

            let db_path = app_data_dir.join("piu.db");

            let rt = tokio::runtime::Runtime::new().expect("Failed to create runtime");
            let app_handle = app.handle();
            let init_result =
                rt.block_on(async { init_db_with_recovery(app_handle, &db_path).await });

            if let Err(err) = init_result {
                let exit_handle = app_handle.clone();
                app_handle
                    .dialog()
                    .message(&err)
                    .title(APP_NAME)
                    .buttons(MessageDialogButtons::OkCancelCustom(
                        "OK".to_string(),
                        "Quit".to_string(),
                    ))
                    .show(move |_| {
                        exit_handle.exit(1);
                    });
                return Ok(());
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Collection commands
            commands::create_collection,
            commands::update_collection,
            commands::delete_collection,
            commands::list_collections,
            // Request commands
            commands::create_request,
            commands::update_request,
            commands::delete_request,
            commands::list_requests,
            commands::get_request,
            commands::duplicate_request,
            // HTTP execution
            commands::execute_request,
            // Environment commands
            commands::create_environment,
            commands::update_environment,
            commands::delete_environment,
            commands::list_environments,
            commands::set_active_environment,
            commands::get_active_environment,
            // Environment variable commands
            commands::set_env_variables,
            commands::list_env_variables,
            // Changelog commands
            commands::get_changelog,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
