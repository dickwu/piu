use crate::sync::{self, SyncResult};
use serde::Deserialize;
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
