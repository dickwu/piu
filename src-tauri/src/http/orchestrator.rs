use super::executor;
use super::extractor::{self, ExtractionResult};
use super::glob_match;
use super::types::{ExecutionProgress, HttpResponse, KeyValuePair, RequestConfig};
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
                    let api_path = path.trim_start_matches('/').to_string();

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
    // If the source request has hooks, extract values and update target variables.
    if let Ok(ref response) = result {
        process_hooks(app, request_id, response).await;
    }

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

/// Process post-response hooks: for each enabled hook whose `source_request_id`
/// matches the request that just executed, extract a value from the response
/// and update the target variables. Emits a `hook-captured` event on success.
async fn process_hooks(app: &tauri::AppHandle, request_id: &str, response: &HttpResponse) {
    // Find all enabled hooks that trigger on this request
    let hooks = match list_hooks_for_source_request(request_id).await {
        Ok(h) => h,
        Err(_) => return,
    };

    for hook in &hooks {
        // Extract value from response based on response_location + selector
        let extraction = match hook.response_location.as_str() {
            "body" => extractor::extract_from_body(&response.body, &hook.selector),
            "header" => extractor::extract_from_header(&response.headers, &hook.selector),
            _ => continue,
        };

        let captured_value = match extraction {
            ExtractionResult::Scalar(v) => extractor::apply_template(&hook.value_template, &v),
            // Array results require user interaction via the picker — skip for now.
            // The frontend picker flow handles this separately.
            ExtractionResult::Array(_) => continue,
            ExtractionResult::NotFound
            | ExtractionResult::InvalidJson
            | ExtractionResult::NonScalar => continue,
        };

        // Load target variable IDs for this hook
        let target_ids = match db::list_hook_targets(&hook.id).await {
            Ok(t) => t,
            Err(_) => continue,
        };

        if target_ids.is_empty() {
            continue;
        }

        // Compute expires_at from hook.expires_in
        let expires_at = hook
            .expires_in
            .map(|ms| chrono::Utc::now().timestamp_millis() + ms);

        // Update each target variable
        let mut updated_count: usize = 0;
        for target in &target_ids {
            if db::update_env_variable(
                &target.variable_id,
                Some(&captured_value),
                None,
                None,
                Some(expires_at),
                None,
                None,
            )
            .await
            .is_ok()
            {
                updated_count += 1;
            }
        }

        // Mark hook as executed
        let _ = db::update_hook_last_executed(&hook.id).await;

        // Emit hook-captured event
        let _ = app.emit(
            "hook-captured",
            serde_json::json!({
                "hook_id": hook.id,
                "source_request_id": hook.source_request_id,
                "captured_value": captured_value,
                "target_count": updated_count,
            }),
        );
    }
}

/// Process post-response hooks without Tauri event emission.
/// Used by the MCP execute_request path which has no AppHandle.
/// Returns the number of variables updated across all hooks.
pub async fn process_hooks_headless(request_id: &str, response: &HttpResponse) -> usize {
    let hooks = match list_hooks_for_source_request(request_id).await {
        Ok(h) => h,
        Err(_) => return 0,
    };

    let mut total_updated: usize = 0;

    for hook in &hooks {
        let extraction = match hook.response_location.as_str() {
            "body" => extractor::extract_from_body(&response.body, &hook.selector),
            "header" => extractor::extract_from_header(&response.headers, &hook.selector),
            _ => continue,
        };

        let captured_value = match extraction {
            ExtractionResult::Scalar(v) => extractor::apply_template(&hook.value_template, &v),
            ExtractionResult::Array(_) => continue,
            ExtractionResult::NotFound
            | ExtractionResult::InvalidJson
            | ExtractionResult::NonScalar => continue,
        };

        let target_ids = match db::list_hook_targets(&hook.id).await {
            Ok(t) => t,
            Err(_) => continue,
        };

        if target_ids.is_empty() {
            continue;
        }

        let expires_at = hook
            .expires_in
            .map(|ms| chrono::Utc::now().timestamp_millis() + ms);

        for target in &target_ids {
            if db::update_env_variable(
                &target.variable_id,
                Some(&captured_value),
                None,
                None,
                Some(expires_at),
                None,
                None,
            )
            .await
            .is_ok()
            {
                total_updated += 1;
            }
        }

        let _ = db::update_hook_last_executed(&hook.id).await;
    }

    total_updated
}

/// Query hooks whose source_request_id matches the given request and are enabled.
async fn list_hooks_for_source_request(
    request_id: &str,
) -> Result<Vec<db::EnvHook>, Box<dyn std::error::Error + Send + Sync>> {
    let conn = db::get_connection()?.lock().await;

    let mut rows = conn
        .query(
            "SELECT id, environment_id, source_request_id, response_location, selector, value_template, expires_in, array_strategy, enabled, last_executed_at, created_at, updated_at FROM env_hooks WHERE source_request_id = ?1 AND enabled = 1",
            turso::params![request_id],
        )
        .await?;

    let mut hooks = Vec::new();
    while let Some(row) = rows.next().await? {
        hooks.push(db::EnvHook {
            id: row.get(0)?,
            environment_id: row.get(1)?,
            source_request_id: row.get(2)?,
            response_location: row.get(3)?,
            selector: row.get(4)?,
            value_template: row.get(5)?,
            expires_in: row.get(6)?,
            array_strategy: row.get(7)?,
            enabled: row.get(8)?,
            last_executed_at: row.get(9)?,
            created_at: row.get(10)?,
            updated_at: row.get(11)?,
        });
    }

    Ok(hooks)
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
