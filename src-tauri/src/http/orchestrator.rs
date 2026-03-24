use super::executor;
use super::glob_match;
use super::types::{ExecutionProgress, KeyValuePair, RequestConfig};
use crate::db;
use crate::db::EnvVariable;
use tauri::Emitter;

/// Orchestrate a full request execution from just a request ID.
/// Resolves collection context (path_prefix, shared_headers),
/// environment context (host, variables), builds the effective config,
/// and executes via the existing executor. Progress is emitted as events.
pub async fn orchestrate_request(
    app: &tauri::AppHandle,
    request_id: &str,
    execution_id: &str,
) -> Result<(), String> {
    // Phase: Resolving
    let _ = app.emit(
        "request-progress",
        ExecutionProgress::Resolving {
            execution_id: execution_id.to_string(),
        },
    );

    // 1. Fetch request from DB
    let request = db::get_request(request_id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Request {} not found", request_id))?;

    // 2. Parse config
    let mut config: RequestConfig = serde_json::from_str(&request.config)
        .map_err(|e| format!("Invalid request config: {}", e))?;

    // 3. Resolve collection context
    let collection = if let Some(cid) = request.collection_id.as_deref() {
        db::collections::get_collection(cid)
            .await
            .map_err(|e| e.to_string())?
    } else {
        None
    };

    if let Some(ref col) = collection {
        // Apply path_prefix
        if let Some(ref prefix) = col.path_prefix {
            let prefix = prefix.trim_end_matches('/');
            if !prefix.is_empty() {
                let url = if config.url.starts_with('/') {
                    config.url.clone()
                } else if config.url.is_empty() {
                    "/".to_string()
                } else {
                    format!("/{}", config.url)
                };
                config.url = format!("{}{}", prefix, url);
            }
        }

        // Merge shared headers (collection headers first, request headers override)
        let shared_headers: Vec<KeyValuePair> =
            serde_json::from_str(&col.shared_headers).unwrap_or_default();

        let request_header_keys: std::collections::HashSet<String> = config
            .headers
            .iter()
            .filter(|h| h.enabled && !h.key.is_empty())
            .map(|h| h.key.to_lowercase())
            .collect();

        let extra_headers: Vec<KeyValuePair> = shared_headers
            .into_iter()
            .filter(|h| {
                h.enabled
                    && !h.key.is_empty()
                    && !request_header_keys.contains(&h.key.to_lowercase())
            })
            .collect();

        let mut merged = extra_headers;
        merged.extend(config.headers);
        config.headers = merged;
    }

    // 4. Resolve environment (host only) and targeted variables
    // Prefer project_id from collection; fall back to request.project_id for root requests
    let project_id = collection
        .as_ref()
        .and_then(|c| c.project_id.as_deref())
        .or(request.project_id.as_deref());

    if let Some(pid) = project_id {
        if let Ok(Some(env)) = db::get_active_environment(pid).await {
            // Prepend host to URL (always relative)
            if let Some(ref host) = env.host {
                let host = host.trim_end_matches('/');
                if !host.is_empty() {
                    let path = if config.url.starts_with('/') {
                        config.url.clone()
                    } else if config.url.is_empty() {
                        String::new()
                    } else {
                        format!("/{}", config.url)
                    };

                    // 5. Capture api_path BEFORE prepending host (used for glob matching)
                    let api_path = format!("{}{}", host.trim_start_matches('/'), path)
                        .trim_start_matches('/')
                        .to_string();

                    config.url = format!("{}{}", host, path);

                    // 5a. Load full EnvVariable structs and resolve via targeted injection
                    if let Ok(variables) = db::list_env_variables(&env.id).await {
                        super::resolver::resolve_and_inject(&mut config, &variables, &api_path);
                        emit_expired_variable_warnings(app, &variables, &api_path);
                    }
                } else {
                    // No host — api_path is the config url itself
                    let api_path = config.url.trim_start_matches('/').to_string();
                    if let Ok(variables) = db::list_env_variables(&env.id).await {
                        super::resolver::resolve_and_inject(&mut config, &variables, &api_path);
                        emit_expired_variable_warnings(app, &variables, &api_path);
                    }
                }
            } else {
                // No host set — api_path is the config url itself
                let api_path = config.url.trim_start_matches('/').to_string();
                if let Ok(variables) = db::list_env_variables(&env.id).await {
                    super::resolver::resolve_and_inject(&mut config, &variables, &api_path);
                    emit_expired_variable_warnings(app, &variables, &api_path);
                }
            }
        }
    }

    // Phase: Connecting
    let _ = app.emit(
        "request-progress",
        ExecutionProgress::Connecting {
            execution_id: execution_id.to_string(),
            url: config.url.clone(),
        },
    );

    // Phase: Sending
    let _ = app.emit(
        "request-progress",
        ExecutionProgress::Sending {
            execution_id: execution_id.to_string(),
        },
    );

    // 6. Execute
    let result = executor::execute(&config).await;

    // 7. Post-response hook processing
    // TODO(Task 9/10): Full hook execution — extract values from response,
    // update target variables, and trigger dependent re-execution.
    // For now, this is a placeholder that will be wired in Tasks 9-10.

    match result {
        Ok(response) => {
            let _ = app.emit(
                "request-progress",
                ExecutionProgress::Complete {
                    execution_id: execution_id.to_string(),
                    response,
                },
            );
        }
        Err(error) => {
            let _ = app.emit(
                "request-progress",
                ExecutionProgress::Error {
                    execution_id: execution_id.to_string(),
                    error,
                },
            );
        }
    }

    Ok(())
}

/// Emit a `variable-expired` event for each enabled, path-matched variable
/// whose `expires_at` timestamp is in the past.
///
/// This is the detection-only phase of auto-refresh. The resolver has already
/// injected the (stale) value. Full auto-refresh -- executing the source
/// request through the single-flight gate -- will be wired in a future task.
fn emit_expired_variable_warnings(
    app: &tauri::AppHandle,
    variables: &[EnvVariable],
    api_path: &str,
) {
    let now = chrono::Utc::now().timestamp_millis();

    for var in variables {
        let is_expired = var.enabled
            && glob_match::matches_path(&var.match_paths, api_path)
            && var.expires_at.is_some_and(|exp| exp <= now);

        if is_expired {
            let _ = app.emit(
                "variable-expired",
                serde_json::json!({
                    "variable_id": var.id,
                    "key": var.key,
                    "match_paths": var.match_paths,
                }),
            );
        }
    }
}
