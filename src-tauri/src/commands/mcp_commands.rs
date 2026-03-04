use crate::mcp::PiuMcp;
use rmcp::transport::{
    streamable_http_server::{session::local::LocalSessionManager, tower::StreamableHttpService},
    StreamableHttpServerConfig,
};
use serde::Serialize;
use std::sync::OnceLock;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

struct McpServerHandle {
    cancellation_token: CancellationToken,
    port: u16,
    api_key: Option<String>,
}

static MCP_SERVER: OnceLock<Mutex<Option<McpServerHandle>>> = OnceLock::new();

fn get_mutex() -> &'static Mutex<Option<McpServerHandle>> {
    MCP_SERVER.get_or_init(|| Mutex::new(None))
}

#[tauri::command]
pub async fn start_mcp_server(app: tauri::AppHandle, port: u16, api_key: Option<String>) -> Result<String, String> {
    let mutex = get_mutex();
    let mut guard = mutex.lock().await;
    crate::mcp::set_app_handle(app);

    if guard.is_some() {
        return Err("MCP server is already running".to_string());
    }

    let ct = CancellationToken::new();

    let service: StreamableHttpService<PiuMcp, LocalSessionManager> = StreamableHttpService::new(
        || Ok(PiuMcp::new()),
        Default::default(),
        StreamableHttpServerConfig {
            stateful_mode: true,
            cancellation_token: ct.child_token(),
            ..Default::default()
        },
    );

    let mcp_router = axum::Router::new().nest_service("/mcp", service);

    // Wrap with API key middleware if provided
    let app = if let Some(ref key) = api_key {
        let expected_key = key.clone();
        let auth_layer = axum::middleware::from_fn(
            move |req: axum::extract::Request, next: axum::middleware::Next| {
                let expected = expected_key.clone();
                async move {
                    let auth_header = req
                        .headers()
                        .get("authorization")
                        .and_then(|v| v.to_str().ok());

                    let expected_value = format!("Bearer {}", expected);
                    match auth_header {
                        Some(value) if value == expected_value => {
                            next.run(req).await
                        }
                        _ => axum::http::Response::builder()
                            .status(axum::http::StatusCode::UNAUTHORIZED)
                            .header("content-type", "application/json")
                            .body(axum::body::Body::from(
                                r#"{"error":"unauthorized","message":"Invalid or missing API key. Use Authorization: Bearer <api_key>"}"#,
                            ))
                            .unwrap(),
                    }
                }
            },
        );
        mcp_router.layer(auth_layer)
    } else {
        mcp_router
    };

    let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{}", port))
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

    let url = format!("http://127.0.0.1:{}/mcp", port);
    *guard = Some(McpServerHandle {
        cancellation_token: ct,
        port,
        api_key,
    });

    Ok(url)
}

#[tauri::command]
pub async fn stop_mcp_server() -> Result<(), String> {
    let mutex = get_mutex();
    let mut guard = mutex.lock().await;

    if let Some(handle) = guard.take() {
        handle.cancellation_token.cancel();
        Ok(())
    } else {
        Err("MCP server is not running".to_string())
    }
}

#[tauri::command]
pub async fn get_mcp_server_status() -> serde_json::Value {
    let mutex = get_mutex();
    let guard = mutex.lock().await;

    match &*guard {
        Some(handle) => serde_json::json!({
            "running": true,
            "port": handle.port,
            "url": format!("http://127.0.0.1:{}/mcp", handle.port),
            "has_api_key": handle.api_key.is_some(),
        }),
        None => serde_json::json!({ "running": false }),
    }
}

#[derive(Serialize)]
pub struct CommandOutput {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
}

#[tauri::command]
pub async fn run_claude_mcp_install(url: String) -> Result<CommandOutput, String> {
    let output = tokio::process::Command::new("claude")
        .args(["mcp", "add", "--transport", "http", "piu", &url])
        .output()
        .await
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "Claude CLI not found. Install it from https://claude.ai/download and ensure 'claude' is in your PATH.".to_string()
            } else {
                format!("Failed to run claude command: {}", e)
            }
        })?;

    Ok(CommandOutput {
        success: output.status.success(),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code(),
    })
}
