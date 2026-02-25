use super::executor;
use super::types::{ExecutionProgress, KeyValuePair, RequestConfig};
use crate::db;
use std::collections::HashMap;
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
    let collection = db::collections::get_collection(&request.collection_id)
        .await
        .map_err(|e| e.to_string())?;

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
            .filter(|h| h.enabled && !h.key.is_empty() && !request_header_keys.contains(&h.key.to_lowercase()))
            .collect();

        let mut merged = extra_headers;
        merged.extend(config.headers);
        config.headers = merged;
    }

    // 4. Resolve environment (host + variables)
    let project_id = collection.as_ref().and_then(|c| c.project_id.as_deref());
    let mut env_variables = HashMap::new();

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
                    config.url = format!("{}{}", host, path);
                }
            }

            // Load variables
            if let Ok(vars) = db::list_env_variables(&env.id).await {
                for v in vars {
                    if v.enabled {
                        env_variables.insert(v.key, v.value);
                    }
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

    // 5. Execute
    match executor::execute(&config, &env_variables).await {
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
