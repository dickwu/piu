use crate::sync::{self, SyncResult};
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

struct SyncServerHandle {
    cancellation_token: CancellationToken,
    port: u16,
    join_key: String,
    project_id: String,
}

static SYNC_SERVER: OnceLock<Mutex<Option<SyncServerHandle>>> = OnceLock::new();

fn get_mutex() -> &'static Mutex<Option<SyncServerHandle>> {
    SYNC_SERVER.get_or_init(|| Mutex::new(None))
}

#[tauri::command]
pub async fn start_sync_server(
    port: u16,
    join_key: String,
    project_id: String,
) -> Result<String, String> {
    let mutex = get_mutex();
    let mut guard = mutex.lock().await;

    if guard.is_some() {
        return Err("Sync server is already running".to_string());
    }

    let ct = CancellationToken::new();

    let app = sync::create_sync_router(join_key.clone(), project_id.clone());

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port))
        .await
        .map_err(|e| format!("Failed to bind to port {}: {}", port, e))?;

    let shutdown_token = ct.clone();
    tokio::spawn(async move {
        let _ = axum::serve(listener, app)
            .with_graceful_shutdown(async move {
                shutdown_token.cancelled().await;
            })
            .await;
    });

    let url = format!("http://0.0.0.0:{}/sync", port);
    *guard = Some(SyncServerHandle {
        cancellation_token: ct,
        port,
        join_key,
        project_id,
    });

    Ok(url)
}

#[tauri::command]
pub async fn stop_sync_server() -> Result<(), String> {
    let mutex = get_mutex();
    let mut guard = mutex.lock().await;

    if let Some(handle) = guard.take() {
        handle.cancellation_token.cancel();
        Ok(())
    } else {
        Err("Sync server is not running".to_string())
    }
}

#[tauri::command]
pub async fn get_sync_server_status() -> serde_json::Value {
    let mutex = get_mutex();
    let guard = mutex.lock().await;

    match &*guard {
        Some(handle) => serde_json::json!({
            "running": true,
            "port": handle.port,
            "join_key": handle.join_key,
            "project_id": handle.project_id,
        }),
        None => serde_json::json!({ "running": false }),
    }
}

#[derive(Debug, Deserialize)]
pub struct SyncConnectInput {
    pub host: String,
    pub port: u16,
    pub join_key: String,
    pub project_id: String,
}

#[tauri::command]
pub async fn sync_connect(input: SyncConnectInput) -> Result<SyncResult, String> {
    sync::sync_with_remote(&input.host, input.port, &input.join_key, &input.project_id).await
}

#[derive(Debug, Serialize)]
pub struct SyncCloneResult {
    pub project_id: String,
    pub project_name: String,
    pub sync_result: SyncResult,
}

#[derive(Debug, Deserialize)]
pub struct SyncCloneInput {
    pub host: String,
    pub port: u16,
    pub join_key: String,
}

#[tauri::command]
pub async fn sync_clone(input: SyncCloneInput) -> Result<SyncCloneResult, String> {
    // 1. Handshake to discover remote project
    let handshake = sync::handshake_only(&input.host, input.port, &input.join_key).await?;

    // Validate that remote supports clone (has project_id in handshake)
    if handshake.project_id.is_empty() {
        return Err("Remote host does not support clone. Ask the host to upgrade Piu.".to_string());
    }

    // 2. Duplicate clone detection
    let marker = format!("sync://{}", handshake.project_id);
    let existing_projects = crate::db::projects::list_projects()
        .await
        .map_err(|e| e.to_string())?;
    if let Some(p) = existing_projects
        .iter()
        .find(|p| p.source_repo_url.as_deref() == Some(marker.as_str()))
    {
        return Err(format!(
            "Already cloned as '{}'. Use Sync tab instead.",
            p.name
        ));
    }

    // 3. Create local project with remote's name
    let project_id = uuid::Uuid::new_v4().to_string();
    let _project = crate::db::create_project(
        &project_id,
        &handshake.project_name,
        None,
        Some(&marker),
        None,
        None,
    )
    .await
    .map_err(|e| e.to_string())?;

    // 4. Full sync into the new project
    match sync::sync_with_remote(&input.host, input.port, &input.join_key, &project_id).await {
        Ok(result) if result.errors.is_empty() => Ok(SyncCloneResult {
            project_id,
            project_name: handshake.project_name,
            sync_result: result,
        }),
        Ok(result) => {
            // Partial failure — clean up the project (CASCADE deletes pulled data)
            let errors_msg = result.errors.join("; ");
            if let Err(cleanup_err) = crate::db::delete_project(&project_id).await {
                return Err(format!(
                    "Clone failed with errors: {}. Cleanup also failed: {}",
                    errors_msg, cleanup_err
                ));
            }
            Err(format!("Clone failed with errors: {}", errors_msg))
        }
        Err(e) => {
            // Full failure — clean up the project
            if let Err(cleanup_err) = crate::db::delete_project(&project_id).await {
                return Err(format!("{}. Cleanup also failed: {}", e, cleanup_err));
            }
            Err(e)
        }
    }
}
