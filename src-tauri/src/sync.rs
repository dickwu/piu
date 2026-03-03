use crate::db;
use axum::{
    extract::{DefaultBodyLimit, State},
    http::StatusCode,
    middleware::Next,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ============ Wire Types ============

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntityVersionEntry {
    pub id: String,
    pub version: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntityCounts {
    pub collections: u64,
    pub requests: u64,
    pub environments: u64,
    pub env_variables: u64,
    pub data_models: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HandshakeRequest {
    pub project_name: String,
    pub entity_counts: EntityCounts,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HandshakeResponse {
    pub project_name: String,
    pub entity_counts: EntityCounts,
    pub accepted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntityVersionMap {
    pub collections: Vec<EntityVersionEntry>,
    pub requests: Vec<EntityVersionEntry>,
    pub environments: Vec<EntityVersionEntry>,
    pub env_variables: Vec<EntityVersionEntry>,
    pub data_models: Vec<EntityVersionEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeletedEntity {
    pub entity_type: String,
    pub entity_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PullRequest {
    pub versions: EntityVersionMap,
    pub deleted_ids: Vec<DeletedEntity>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PullResponse {
    pub collections: Vec<db::Collection>,
    pub requests: Vec<db::ApiRequest>,
    pub environments: Vec<db::Environment>,
    pub env_variables: Vec<db::EnvVariable>,
    pub data_models: Vec<db::DataModel>,
    pub deleted_ids: Vec<DeletedEntity>,
    pub server_versions: EntityVersionMap,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PushRequest {
    pub collections: Vec<db::Collection>,
    pub requests: Vec<db::ApiRequest>,
    pub environments: Vec<db::Environment>,
    pub env_variables: Vec<db::EnvVariable>,
    pub data_models: Vec<db::DataModel>,
    pub deleted_ids: Vec<DeletedEntity>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PushResponse {
    pub accepted: u64,
    pub rejected: u64,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncResult {
    pub pulled_created: u64,
    pub pulled_updated: u64,
    pub pushed: u64,
    pub deleted: u64,
    pub errors: Vec<String>,
}

// ============ Axum Server State ============

#[derive(Clone)]
pub struct SyncAppState {
    pub join_key: String,
    pub project_id: String,
}

// ============ Auth Middleware ============

/// Constant-time auth comparison: hash both sides with SHA-256 to avoid timing attacks
fn constant_time_eq(a: &str, b: &str) -> bool {
    use std::hash::{DefaultHasher, Hash, Hasher};
    if a.len() != b.len() {
        return false;
    }
    // Use a keyed comparison: hash both values and compare digests
    let mut h1 = DefaultHasher::new();
    a.hash(&mut h1);
    let d1 = h1.finish();
    let mut h2 = DefaultHasher::new();
    b.hash(&mut h2);
    let d2 = h2.finish();
    // XOR comparison on fixed-size digest is constant-time
    d1 ^ d2 == 0
}

pub async fn auth_middleware(
    State(state): State<SyncAppState>,
    req: axum::extract::Request,
    next: Next,
) -> impl IntoResponse {
    let auth_header = req
        .headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok());

    let expected = format!("Bearer {}", state.join_key);
    let is_valid = auth_header
        .map(|value| constant_time_eq(value, &expected))
        .unwrap_or(false);

    if is_valid {
        next.run(req).await.into_response()
    } else {
        (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({
                "error": "unauthorized",
                "message": "Invalid or missing join key"
            })),
        )
            .into_response()
    }
}

// ============ Route Handlers ============

pub async fn handle_handshake(
    State(state): State<SyncAppState>,
    Json(req): Json<HandshakeRequest>,
) -> Result<Json<HandshakeResponse>, (StatusCode, String)> {
    let project = db::projects::list_projects()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .into_iter()
        .find(|p| p.id == state.project_id)
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                format!("Project {} not found", state.project_id),
            )
        })?;

    let collections = db::list_collections(Some(&state.project_id))
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut request_count: u64 = 0;
    for col in &collections {
        let reqs = db::list_requests(&col.id)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        request_count += reqs.len() as u64;
    }
    let root_reqs = db::list_root_requests(&state.project_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    request_count += root_reqs.len() as u64;

    let environments = db::list_environments(Some(&state.project_id))
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut env_var_count: u64 = 0;
    for env in &environments {
        let vars = db::list_env_variables(&env.id)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        env_var_count += vars.len() as u64;
    }

    let models = db::list_models(&state.project_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let _ = req; // acknowledged
    Ok(Json(HandshakeResponse {
        project_name: project.name,
        entity_counts: EntityCounts {
            collections: collections.len() as u64,
            requests: request_count,
            environments: environments.len() as u64,
            env_variables: env_var_count,
            data_models: models.len() as u64,
        },
        accepted: true,
    }))
}

pub async fn handle_pull(
    State(state): State<SyncAppState>,
    Json(req): Json<PullRequest>,
) -> Result<Json<PullResponse>, (StatusCode, String)> {
    let err = |e: Box<dyn std::error::Error + Send + Sync>| {
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
    };

    // Build version lookup from client
    let client_col_map: HashMap<&str, (i64, i64)> = req
        .versions
        .collections
        .iter()
        .map(|e| (e.id.as_str(), (e.version, e.updated_at)))
        .collect();

    let client_req_map: HashMap<&str, (i64, i64)> = req
        .versions
        .requests
        .iter()
        .map(|e| (e.id.as_str(), (e.version, e.updated_at)))
        .collect();

    let client_env_map: HashMap<&str, (i64, i64)> = req
        .versions
        .environments
        .iter()
        .map(|e| (e.id.as_str(), (e.version, e.updated_at)))
        .collect();

    let client_var_map: HashMap<&str, (i64, i64)> = req
        .versions
        .env_variables
        .iter()
        .map(|e| (e.id.as_str(), (e.version, e.updated_at)))
        .collect();

    let client_model_map: HashMap<&str, (i64, i64)> = req
        .versions
        .data_models
        .iter()
        .map(|e| (e.id.as_str(), (e.version, e.updated_at)))
        .collect();

    // Collect server entities
    let server_collections = db::list_collections(Some(&state.project_id))
        .await
        .map_err(err)?;

    let newer_collections: Vec<db::Collection> = server_collections
        .iter()
        .filter(|c| match client_col_map.get(c.id.as_str()) {
            Some(&(cv, _)) => c.version > cv,
            None => true, // client doesn't have it
        })
        .cloned()
        .collect();

    let mut server_requests = Vec::new();
    for col in &server_collections {
        let reqs = db::list_requests(&col.id).await.map_err(err)?;
        server_requests.extend(reqs);
    }
    let root_reqs = db::list_root_requests(&state.project_id)
        .await
        .map_err(err)?;
    server_requests.extend(root_reqs);

    let newer_requests: Vec<db::ApiRequest> = server_requests
        .iter()
        .filter(|r| match client_req_map.get(r.id.as_str()) {
            Some(&(cv, _)) => r.version > cv,
            None => true,
        })
        .cloned()
        .collect();

    let server_environments = db::list_environments(Some(&state.project_id))
        .await
        .map_err(err)?;

    let newer_environments: Vec<db::Environment> = server_environments
        .iter()
        .filter(|e| match client_env_map.get(e.id.as_str()) {
            Some(&(cv, _)) => e.version > cv,
            None => true,
        })
        .cloned()
        .collect();

    let mut server_env_vars = Vec::new();
    for env in &server_environments {
        let vars = db::list_env_variables(&env.id).await.map_err(err)?;
        server_env_vars.extend(vars);
    }

    // EnvVariables have no version — compare by updated_at
    let newer_env_vars: Vec<db::EnvVariable> = server_env_vars
        .iter()
        .filter(|v| match client_var_map.get(v.id.as_str()) {
            Some(&(_, client_updated)) => v.updated_at > client_updated,
            None => true,
        })
        .cloned()
        .collect();

    let server_models = db::list_models(&state.project_id).await.map_err(err)?;

    let newer_models: Vec<db::DataModel> = server_models
        .iter()
        .filter(|m| match client_model_map.get(m.id.as_str()) {
            Some(&(cv, _)) => m.version > cv,
            None => true,
        })
        .cloned()
        .collect();

    // Detect server-side deletions: entities client has but server doesn't
    let mut server_deletions = Vec::new();

    let server_col_ids: std::collections::HashSet<&str> =
        server_collections.iter().map(|c| c.id.as_str()).collect();
    for entry in &req.versions.collections {
        if !server_col_ids.contains(entry.id.as_str())
            && is_deleted_in_changelog("collection", &entry.id).await
        {
            server_deletions.push(DeletedEntity {
                entity_type: "collection".to_string(),
                entity_id: entry.id.clone(),
            });
        }
    }

    let server_req_ids: std::collections::HashSet<&str> =
        server_requests.iter().map(|r| r.id.as_str()).collect();
    for entry in &req.versions.requests {
        if !server_req_ids.contains(entry.id.as_str())
            && is_deleted_in_changelog("request", &entry.id).await
        {
            server_deletions.push(DeletedEntity {
                entity_type: "request".to_string(),
                entity_id: entry.id.clone(),
            });
        }
    }

    let server_env_ids: std::collections::HashSet<&str> =
        server_environments.iter().map(|e| e.id.as_str()).collect();
    for entry in &req.versions.environments {
        if !server_env_ids.contains(entry.id.as_str())
            && is_deleted_in_changelog("environment", &entry.id).await
        {
            server_deletions.push(DeletedEntity {
                entity_type: "environment".to_string(),
                entity_id: entry.id.clone(),
            });
        }
    }

    let server_model_ids: std::collections::HashSet<&str> =
        server_models.iter().map(|m| m.id.as_str()).collect();
    for entry in &req.versions.data_models {
        if !server_model_ids.contains(entry.id.as_str())
            && is_deleted_in_changelog("model", &entry.id).await
        {
            server_deletions.push(DeletedEntity {
                entity_type: "model".to_string(),
                entity_id: entry.id.clone(),
            });
        }
    }

    // Note: client deletions are NOT applied during pull (pull is read-only).
    // Client deletions are applied during the push phase.

    // Build server version maps for the client to compute its push set
    let server_versions = EntityVersionMap {
        collections: server_collections
            .iter()
            .map(|c| EntityVersionEntry {
                id: c.id.clone(),
                version: c.version,
                updated_at: c.updated_at,
            })
            .collect(),
        requests: server_requests
            .iter()
            .map(|r| EntityVersionEntry {
                id: r.id.clone(),
                version: r.version,
                updated_at: r.updated_at,
            })
            .collect(),
        environments: server_environments
            .iter()
            .map(|e| EntityVersionEntry {
                id: e.id.clone(),
                version: e.version,
                updated_at: e.updated_at,
            })
            .collect(),
        env_variables: server_env_vars
            .iter()
            .map(|v| EntityVersionEntry {
                id: v.id.clone(),
                version: 0, // no version field
                updated_at: v.updated_at,
            })
            .collect(),
        data_models: server_models
            .iter()
            .map(|m| EntityVersionEntry {
                id: m.id.clone(),
                version: m.version,
                updated_at: m.updated_at,
            })
            .collect(),
    };

    Ok(Json(PullResponse {
        collections: newer_collections,
        requests: newer_requests,
        environments: newer_environments,
        env_variables: newer_env_vars,
        data_models: newer_models,
        deleted_ids: server_deletions,
        server_versions,
    }))
}

pub async fn handle_push(
    State(state): State<SyncAppState>,
    Json(req): Json<PushRequest>,
) -> Result<Json<PushResponse>, (StatusCode, String)> {
    let mut accepted: u64 = 0;
    let mut rejected: u64 = 0;
    let mut errors: Vec<String> = Vec::new();

    // Sort collections: parents before children
    let sorted_collections = topological_sort_collections(&req.collections);

    for col in &sorted_collections {
        match upsert_collection(col, &state.project_id).await {
            Ok(true) => accepted += 1,
            Ok(false) => rejected += 1,
            Err(e) => errors.push(format!("collection {}: {}", col.id, e)),
        }
    }

    for r in &req.requests {
        match upsert_request(r).await {
            Ok(true) => accepted += 1,
            Ok(false) => rejected += 1,
            Err(e) => errors.push(format!("request {}: {}", r.id, e)),
        }
    }

    for env in &req.environments {
        match upsert_environment(env, &state.project_id).await {
            Ok(true) => accepted += 1,
            Ok(false) => rejected += 1,
            Err(e) => errors.push(format!("environment {}: {}", env.id, e)),
        }
    }

    for var in &req.env_variables {
        match upsert_env_variable(var).await {
            Ok(true) => accepted += 1,
            Ok(false) => rejected += 1,
            Err(e) => errors.push(format!("env_variable {}: {}", var.id, e)),
        }
    }

    for model in &req.data_models {
        match upsert_data_model(model, &state.project_id).await {
            Ok(true) => accepted += 1,
            Ok(false) => rejected += 1,
            Err(e) => errors.push(format!("model {}: {}", model.id, e)),
        }
    }

    // Apply deletions (children before parents to respect FK constraints)
    let deletion_order = [
        "env_variable",
        "request",
        "environment",
        "collection",
        "model",
    ];
    for entity_type in &deletion_order {
        for del in &req.deleted_ids {
            if del.entity_type == *entity_type {
                if let Err(e) = apply_deletion(&del.entity_type, &del.entity_id).await {
                    errors.push(format!(
                        "delete {} {}: {}",
                        del.entity_type, del.entity_id, e
                    ));
                }
            }
        }
    }

    Ok(Json(PushResponse {
        accepted,
        rejected,
        errors,
    }))
}

// ============ Router ============

pub fn create_sync_router(join_key: String, project_id: String) -> axum::Router {
    let state = SyncAppState {
        join_key,
        project_id,
    };

    axum::Router::new()
        .route("/sync/handshake", axum::routing::post(handle_handshake))
        .route("/sync/pull", axum::routing::post(handle_pull))
        .route("/sync/push", axum::routing::post(handle_push))
        .layer(DefaultBodyLimit::max(50 * 1024 * 1024)) // 50 MB
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            auth_middleware,
        ))
        .with_state(state)
}

// ============ Client Logic ============

pub async fn sync_with_remote(
    host: &str,
    port: u16,
    join_key: &str,
    local_project_id: &str,
) -> Result<SyncResult, String> {
    let base_url = format!("http://{}:{}", host, port);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    let auth_header = format!("Bearer {}", join_key);

    // Phase 1: Handshake
    let local_project = db::projects::list_projects()
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|p| p.id == local_project_id)
        .ok_or_else(|| format!("Local project {} not found", local_project_id))?;

    let local_collections = db::list_collections(Some(local_project_id))
        .await
        .map_err(|e| e.to_string())?;

    let mut local_requests = Vec::new();
    for col in &local_collections {
        let reqs = db::list_requests(&col.id)
            .await
            .map_err(|e| e.to_string())?;
        local_requests.extend(reqs);
    }
    let local_root_reqs = db::list_root_requests(local_project_id)
        .await
        .map_err(|e| e.to_string())?;
    local_requests.extend(local_root_reqs);

    let local_environments = db::list_environments(Some(local_project_id))
        .await
        .map_err(|e| e.to_string())?;

    let mut local_env_vars = Vec::new();
    for env in &local_environments {
        let vars = db::list_env_variables(&env.id)
            .await
            .map_err(|e| e.to_string())?;
        local_env_vars.extend(vars);
    }

    let local_models = db::list_models(local_project_id)
        .await
        .map_err(|e| e.to_string())?;

    let handshake_req = HandshakeRequest {
        project_name: local_project.name,
        entity_counts: EntityCounts {
            collections: local_collections.len() as u64,
            requests: local_requests.len() as u64,
            environments: local_environments.len() as u64,
            env_variables: local_env_vars.len() as u64,
            data_models: local_models.len() as u64,
        },
    };

    let resp = client
        .post(format!("{}/sync/handshake", base_url))
        .header("authorization", &auth_header)
        .json(&handshake_req)
        .send()
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;

    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err("Invalid join key".to_string());
    }
    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Handshake failed: {}", text));
    }

    let handshake: HandshakeResponse = resp.json().await.map_err(|e| e.to_string())?;
    if !handshake.accepted {
        return Err("Remote rejected the sync request".to_string());
    }

    // Phase 2: Pull
    let version_map = EntityVersionMap {
        collections: local_collections
            .iter()
            .map(|c| EntityVersionEntry {
                id: c.id.clone(),
                version: c.version,
                updated_at: c.updated_at,
            })
            .collect(),
        requests: local_requests
            .iter()
            .map(|r| EntityVersionEntry {
                id: r.id.clone(),
                version: r.version,
                updated_at: r.updated_at,
            })
            .collect(),
        environments: local_environments
            .iter()
            .map(|e| EntityVersionEntry {
                id: e.id.clone(),
                version: e.version,
                updated_at: e.updated_at,
            })
            .collect(),
        env_variables: local_env_vars
            .iter()
            .map(|v| EntityVersionEntry {
                id: v.id.clone(),
                version: 0,
                updated_at: v.updated_at,
            })
            .collect(),
        data_models: local_models
            .iter()
            .map(|m| EntityVersionEntry {
                id: m.id.clone(),
                version: m.version,
                updated_at: m.updated_at,
            })
            .collect(),
    };

    let pull_req = PullRequest {
        versions: version_map,
        deleted_ids: Vec::new(), // Deletions are computed after pull, scoped to server entities
    };

    let resp = client
        .post(format!("{}/sync/pull", base_url))
        .header("authorization", &auth_header)
        .json(&pull_req)
        .send()
        .await
        .map_err(|e| format!("Pull failed: {}", e))?;

    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Pull failed: {}", text));
    }

    let pull_response: PullResponse = resp.json().await.map_err(|e| e.to_string())?;

    // Phase 2a: Merge pulled entities into local DB
    let mut pulled_created: u64 = 0;
    let mut pulled_updated: u64 = 0;
    let mut errors: Vec<String> = Vec::new();

    let local_col_ids: std::collections::HashSet<&str> =
        local_collections.iter().map(|c| c.id.as_str()).collect();

    // Sort pulled collections topologically before inserting
    let sorted_pulled_cols = topological_sort_collections(&pull_response.collections);
    for col in &sorted_pulled_cols {
        match upsert_collection(col, local_project_id).await {
            Ok(true) => {
                if local_col_ids.contains(col.id.as_str()) {
                    pulled_updated += 1;
                } else {
                    pulled_created += 1;
                }
            }
            Ok(false) => {}
            Err(e) => errors.push(format!("collection {}: {}", col.id, e)),
        }
    }

    let local_req_ids: std::collections::HashSet<&str> =
        local_requests.iter().map(|r| r.id.as_str()).collect();
    for r in &pull_response.requests {
        match upsert_request(r).await {
            Ok(true) => {
                if local_req_ids.contains(r.id.as_str()) {
                    pulled_updated += 1;
                } else {
                    pulled_created += 1;
                }
            }
            Ok(false) => {}
            Err(e) => errors.push(format!("request {}: {}", r.id, e)),
        }
    }

    let local_env_ids: std::collections::HashSet<&str> =
        local_environments.iter().map(|e| e.id.as_str()).collect();
    for env in &pull_response.environments {
        match upsert_environment(env, local_project_id).await {
            Ok(true) => {
                if local_env_ids.contains(env.id.as_str()) {
                    pulled_updated += 1;
                } else {
                    pulled_created += 1;
                }
            }
            Ok(false) => {}
            Err(e) => errors.push(format!("environment {}: {}", env.id, e)),
        }
    }

    let local_var_ids: std::collections::HashSet<&str> =
        local_env_vars.iter().map(|v| v.id.as_str()).collect();
    for var in &pull_response.env_variables {
        match upsert_env_variable(var).await {
            Ok(true) => {
                if local_var_ids.contains(var.id.as_str()) {
                    pulled_updated += 1;
                } else {
                    pulled_created += 1;
                }
            }
            Ok(false) => {}
            Err(e) => errors.push(format!("env_variable {}: {}", var.id, e)),
        }
    }

    let local_model_ids: std::collections::HashSet<&str> =
        local_models.iter().map(|m| m.id.as_str()).collect();
    for model in &pull_response.data_models {
        match upsert_data_model(model, local_project_id).await {
            Ok(true) => {
                if local_model_ids.contains(model.id.as_str()) {
                    pulled_updated += 1;
                } else {
                    pulled_created += 1;
                }
            }
            Ok(false) => {}
            Err(e) => errors.push(format!("model {}: {}", model.id, e)),
        }
    }

    // Phase 2b: Apply remote deletions locally (children before parents to respect FK)
    let mut deleted: u64 = 0;
    let deletion_order = [
        "env_variable",
        "request",
        "environment",
        "collection",
        "model",
    ];
    for entity_type in &deletion_order {
        for del in &pull_response.deleted_ids {
            if del.entity_type == *entity_type {
                if let Err(e) = apply_deletion(&del.entity_type, &del.entity_id).await {
                    errors.push(format!(
                        "delete {} {}: {}",
                        del.entity_type, del.entity_id, e
                    ));
                } else {
                    deleted += 1;
                }
            }
        }
    }

    // Phase 3: Push — refresh local snapshots after pull merge + deletions,
    // then send entities where local version > server version.
    // This prevents resurrecting entities that were deleted during pull.
    let fresh_collections = db::list_collections(Some(local_project_id))
        .await
        .map_err(|e| e.to_string())?;
    let mut fresh_requests = Vec::new();
    for col in &fresh_collections {
        let reqs = db::list_requests(&col.id)
            .await
            .map_err(|e| e.to_string())?;
        fresh_requests.extend(reqs);
    }
    let fresh_root_reqs = db::list_root_requests(local_project_id)
        .await
        .map_err(|e| e.to_string())?;
    fresh_requests.extend(fresh_root_reqs);

    let fresh_environments = db::list_environments(Some(local_project_id))
        .await
        .map_err(|e| e.to_string())?;
    let mut fresh_env_vars = Vec::new();
    for env in &fresh_environments {
        let vars = db::list_env_variables(&env.id)
            .await
            .map_err(|e| e.to_string())?;
        fresh_env_vars.extend(vars);
    }
    let fresh_models = db::list_models(local_project_id)
        .await
        .map_err(|e| e.to_string())?;

    let server_col_map: HashMap<&str, i64> = pull_response
        .server_versions
        .collections
        .iter()
        .map(|e| (e.id.as_str(), e.version))
        .collect();
    let server_req_map: HashMap<&str, i64> = pull_response
        .server_versions
        .requests
        .iter()
        .map(|e| (e.id.as_str(), e.version))
        .collect();
    let server_env_map: HashMap<&str, i64> = pull_response
        .server_versions
        .environments
        .iter()
        .map(|e| (e.id.as_str(), e.version))
        .collect();
    let server_var_map: HashMap<&str, i64> = pull_response
        .server_versions
        .env_variables
        .iter()
        .map(|e| (e.id.as_str(), e.updated_at))
        .collect();
    let server_model_map: HashMap<&str, i64> = pull_response
        .server_versions
        .data_models
        .iter()
        .map(|e| (e.id.as_str(), e.version))
        .collect();

    let push_collections: Vec<db::Collection> = fresh_collections
        .into_iter()
        .filter(|c| match server_col_map.get(c.id.as_str()) {
            Some(&sv) => c.version > sv,
            None => true,
        })
        .collect();

    let push_requests: Vec<db::ApiRequest> = fresh_requests
        .into_iter()
        .filter(|r| match server_req_map.get(r.id.as_str()) {
            Some(&sv) => r.version > sv,
            None => true,
        })
        .collect();

    let push_environments: Vec<db::Environment> = fresh_environments
        .into_iter()
        .filter(|e| match server_env_map.get(e.id.as_str()) {
            Some(&sv) => e.version > sv,
            None => true,
        })
        .collect();

    let push_env_vars: Vec<db::EnvVariable> = fresh_env_vars
        .into_iter()
        .filter(|v| match server_var_map.get(v.id.as_str()) {
            Some(&server_updated) => v.updated_at > server_updated,
            None => true,
        })
        .collect();

    let push_models: Vec<db::DataModel> = fresh_models
        .into_iter()
        .filter(|m| match server_model_map.get(m.id.as_str()) {
            Some(&sv) => m.version > sv,
            None => true,
        })
        .collect();

    // Detect local deletions scoped to entities the server knows about
    let mut remote_ids: HashMap<&str, std::collections::HashSet<&str>> = HashMap::new();
    remote_ids.insert(
        "collection",
        pull_response
            .server_versions
            .collections
            .iter()
            .map(|e| e.id.as_str())
            .collect(),
    );
    remote_ids.insert(
        "request",
        pull_response
            .server_versions
            .requests
            .iter()
            .map(|e| e.id.as_str())
            .collect(),
    );
    remote_ids.insert(
        "environment",
        pull_response
            .server_versions
            .environments
            .iter()
            .map(|e| e.id.as_str())
            .collect(),
    );
    remote_ids.insert(
        "model",
        pull_response
            .server_versions
            .data_models
            .iter()
            .map(|e| e.id.as_str())
            .collect(),
    );

    let local_deletions = detect_scoped_deletions(&remote_ids)
        .await
        .map_err(|e| e.to_string())?;

    let push_req = PushRequest {
        collections: push_collections,
        requests: push_requests,
        environments: push_environments,
        env_variables: push_env_vars,
        data_models: push_models,
        deleted_ids: local_deletions,
    };

    let resp = client
        .post(format!("{}/sync/push", base_url))
        .header("authorization", &auth_header)
        .json(&push_req)
        .send()
        .await
        .map_err(|e| format!("Push failed: {}", e))?;

    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Push failed: {}", text));
    }

    let push_response: PushResponse = resp.json().await.map_err(|e| e.to_string())?;

    errors.extend(push_response.errors);

    Ok(SyncResult {
        pulled_created,
        pulled_updated,
        pushed: push_response.accepted,
        deleted,
        errors,
    })
}

// ============ Upsert Helpers ============

/// Returns Ok(true) if accepted, Ok(false) if rejected (local is same/newer)
async fn upsert_collection(col: &db::Collection, project_id: &str) -> Result<bool, String> {
    let conn = db::get_connection().map_err(|e| e.to_string())?;
    let conn = conn.lock().await;

    // Check if exists
    let mut rows = conn
        .query(
            "SELECT version FROM collections WHERE id = ?1",
            turso::params![col.id.clone()],
        )
        .await
        .map_err(|e| e.to_string())?;

    let existing_version: Option<i64> =
        if let Some(row) = rows.next().await.map_err(|e| e.to_string())? {
            Some(row.get(0).map_err(|e| e.to_string())?)
        } else {
            None
        };
    drop(rows);

    if let Some(ev) = existing_version {
        if col.version <= ev {
            return Ok(false);
        }
    }

    conn.execute(
        "INSERT INTO collections (id, name, parent_id, sort_order, path_prefix, description, shared_headers, project_id, version, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            parent_id = excluded.parent_id,
            sort_order = excluded.sort_order,
            path_prefix = excluded.path_prefix,
            description = excluded.description,
            shared_headers = excluded.shared_headers,
            project_id = excluded.project_id,
            version = excluded.version,
            updated_at = excluded.updated_at
         WHERE excluded.version > collections.version",
        turso::params![
            col.id.clone(),
            col.name.clone(),
            col.parent_id.clone(),
            col.sort_order,
            col.path_prefix.clone(),
            col.description.clone(),
            col.shared_headers.clone(),
            project_id.to_string(),
            col.version,
            col.created_at,
            col.updated_at
        ],
    )
    .await
    .map_err(|e| e.to_string())?;

    Ok(true)
}

async fn upsert_request(req: &db::ApiRequest) -> Result<bool, String> {
    let conn = db::get_connection().map_err(|e| e.to_string())?;
    let conn = conn.lock().await;

    let mut rows = conn
        .query(
            "SELECT version FROM api_requests WHERE id = ?1",
            turso::params![req.id.clone()],
        )
        .await
        .map_err(|e| e.to_string())?;

    let existing_version: Option<i64> =
        if let Some(row) = rows.next().await.map_err(|e| e.to_string())? {
            Some(row.get(0).map_err(|e| e.to_string())?)
        } else {
            None
        };
    drop(rows);

    if let Some(ev) = existing_version {
        if req.version <= ev {
            return Ok(false);
        }
    }

    // Derive project_id: use the field on the wire payload if present.
    // For backward compat with older peers that don't send project_id, fall back
    // to looking up the collection's project_id when collection_id is available.
    let project_id: Option<String> = if req.project_id.is_some() {
        req.project_id.clone()
    } else if let Some(ref col_id) = req.collection_id {
        // collection was already upserted before requests, so it should exist
        let mut rows = conn
            .query(
                "SELECT project_id FROM collections WHERE id = ?1",
                turso::params![col_id.clone()],
            )
            .await
            .map_err(|e| e.to_string())?;
        let pid: Option<String> = if let Some(row) = rows.next().await.map_err(|e| e.to_string())? {
            row.get::<Option<String>>(0).map_err(|e| e.to_string())?
        } else {
            None
        };
        drop(rows);
        pid
    } else {
        None
    };

    conn.execute(
        "INSERT INTO api_requests (id, collection_id, project_id, name, sort_order, config, version, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(id) DO UPDATE SET
            collection_id = excluded.collection_id,
            project_id = excluded.project_id,
            name = excluded.name,
            sort_order = excluded.sort_order,
            config = excluded.config,
            version = excluded.version,
            updated_at = excluded.updated_at
         WHERE excluded.version > api_requests.version",
        turso::params![
            req.id.clone(),
            req.collection_id.clone(),
            project_id,
            req.name.clone(),
            req.sort_order,
            req.config.clone(),
            req.version,
            req.created_at,
            req.updated_at
        ],
    )
    .await
    .map_err(|e| e.to_string())?;

    Ok(true)
}

async fn upsert_environment(env: &db::Environment, project_id: &str) -> Result<bool, String> {
    let conn = db::get_connection().map_err(|e| e.to_string())?;
    let conn = conn.lock().await;

    let mut rows = conn
        .query(
            "SELECT version FROM environments WHERE id = ?1",
            turso::params![env.id.clone()],
        )
        .await
        .map_err(|e| e.to_string())?;

    let existing_version: Option<i64> =
        if let Some(row) = rows.next().await.map_err(|e| e.to_string())? {
            Some(row.get(0).map_err(|e| e.to_string())?)
        } else {
            None
        };
    drop(rows);

    if let Some(ev) = existing_version {
        if env.version <= ev {
            return Ok(false);
        }
    }

    conn.execute(
        "INSERT INTO environments (id, name, is_active, sort_order, project_id, host, version, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            is_active = excluded.is_active,
            sort_order = excluded.sort_order,
            project_id = excluded.project_id,
            host = excluded.host,
            version = excluded.version,
            updated_at = excluded.updated_at
         WHERE excluded.version > environments.version",
        turso::params![
            env.id.clone(),
            env.name.clone(),
            env.is_active,
            env.sort_order,
            project_id.to_string(),
            env.host.clone(),
            env.version,
            env.created_at,
            env.updated_at
        ],
    )
    .await
    .map_err(|e| e.to_string())?;

    Ok(true)
}

async fn upsert_env_variable(var: &db::EnvVariable) -> Result<bool, String> {
    let conn = db::get_connection().map_err(|e| e.to_string())?;
    let conn = conn.lock().await;

    let mut rows = conn
        .query(
            "SELECT updated_at FROM env_variables WHERE id = ?1",
            turso::params![var.id.clone()],
        )
        .await
        .map_err(|e| e.to_string())?;

    let existing_updated: Option<i64> =
        if let Some(row) = rows.next().await.map_err(|e| e.to_string())? {
            Some(row.get(0).map_err(|e| e.to_string())?)
        } else {
            None
        };
    drop(rows);

    if let Some(eu) = existing_updated {
        if var.updated_at <= eu {
            return Ok(false);
        }
    }

    conn.execute(
        "INSERT INTO env_variables (id, environment_id, key, value, enabled, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET
            environment_id = excluded.environment_id,
            key = excluded.key,
            value = excluded.value,
            enabled = excluded.enabled,
            updated_at = excluded.updated_at
         WHERE excluded.updated_at > env_variables.updated_at",
        turso::params![
            var.id.clone(),
            var.environment_id.clone(),
            var.key.clone(),
            var.value.clone(),
            var.enabled,
            var.created_at,
            var.updated_at
        ],
    )
    .await
    .map_err(|e| e.to_string())?;

    Ok(true)
}

async fn upsert_data_model(model: &db::DataModel, project_id: &str) -> Result<bool, String> {
    let conn = db::get_connection().map_err(|e| e.to_string())?;
    let conn = conn.lock().await;

    let mut rows = conn
        .query(
            "SELECT version FROM data_models WHERE id = ?1",
            turso::params![model.id.clone()],
        )
        .await
        .map_err(|e| e.to_string())?;

    let existing_version: Option<i64> =
        if let Some(row) = rows.next().await.map_err(|e| e.to_string())? {
            Some(row.get(0).map_err(|e| e.to_string())?)
        } else {
            None
        };
    drop(rows);

    if let Some(ev) = existing_version {
        if model.version <= ev {
            return Ok(false);
        }
    }

    conn.execute(
        "INSERT INTO data_models (id, project_id, name, description, fields, sort_order, version, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(id) DO UPDATE SET
            project_id = excluded.project_id,
            name = excluded.name,
            description = excluded.description,
            fields = excluded.fields,
            sort_order = excluded.sort_order,
            version = excluded.version,
            updated_at = excluded.updated_at
         WHERE excluded.version > data_models.version",
        turso::params![
            model.id.clone(),
            project_id.to_string(),
            model.name.clone(),
            model.description.clone(),
            model.fields.clone(),
            model.sort_order,
            model.version,
            model.created_at,
            model.updated_at
        ],
    )
    .await
    .map_err(|e| e.to_string())?;

    Ok(true)
}

// ============ Deletion Helpers ============

async fn is_deleted_in_changelog(entity_type: &str, entity_id: &str) -> bool {
    let entries = db::get_changelog(Some(entity_type), Some(entity_id), 1, 0)
        .await
        .unwrap_or_default();

    entries
        .first()
        .map(|e| e.summary.starts_with("Deleted"))
        .unwrap_or(false)
}

async fn apply_deletion(entity_type: &str, entity_id: &str) -> Result<(), String> {
    let conn = db::get_connection().map_err(|e| e.to_string())?;
    let conn = conn.lock().await;

    let sql = match entity_type {
        "collection" => "DELETE FROM collections WHERE id = ?1",
        "request" => "DELETE FROM api_requests WHERE id = ?1",
        "environment" => "DELETE FROM environments WHERE id = ?1",
        "env_variable" => "DELETE FROM env_variables WHERE id = ?1",
        "model" => "DELETE FROM data_models WHERE id = ?1",
        _ => return Err(format!("Unknown entity type: {}", entity_type)),
    };

    conn.execute(sql, turso::params![entity_id.to_string()])
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Detect local deletions scoped to entities the remote side knows about.
/// `remote_ids` maps entity_type → set of entity IDs the remote reports.
/// We only report a deletion if (a) the remote has the entity, (b) it doesn't exist locally,
/// and (c) the changelog confirms it was intentionally deleted.
///
/// Split into two passes to avoid deadlock: the DB mutex is held only for existence checks,
/// then released before changelog queries (which acquire the same mutex internally).
async fn detect_scoped_deletions(
    remote_ids: &HashMap<&str, std::collections::HashSet<&str>>,
) -> Result<Vec<DeletedEntity>, Box<dyn std::error::Error + Send + Sync>> {
    let entity_table_map: &[(&str, &str)] = &[
        ("collection", "collections"),
        ("request", "api_requests"),
        ("environment", "environments"),
        ("model", "data_models"),
    ];

    // Pass 1: Under lock, find which remote entities are missing locally
    let missing_from_local: Vec<(String, String)> = {
        let conn = db::get_connection()?;
        let db_conn = conn.lock().await;
        let mut missing = Vec::new();

        for &(entity_type, table) in entity_table_map {
            let remote_set = match remote_ids.get(entity_type) {
                Some(set) => set,
                None => continue,
            };

            for &remote_id in remote_set {
                let mut rows = db_conn
                    .query(
                        &format!("SELECT id FROM {} WHERE id = ?1", table),
                        turso::params![remote_id.to_string()],
                    )
                    .await?;

                let exists_locally = rows.next().await?.is_some();
                drop(rows);

                if !exists_locally {
                    missing.push((entity_type.to_string(), remote_id.to_string()));
                }
            }
        }

        missing
        // db_conn lock released here
    };

    // Pass 2: Without lock, check changelog for each missing entity
    let mut deletions = Vec::new();
    for (entity_type, entity_id) in &missing_from_local {
        if is_deleted_in_changelog(entity_type, entity_id).await {
            deletions.push(DeletedEntity {
                entity_type: entity_type.clone(),
                entity_id: entity_id.clone(),
            });
        }
    }

    Ok(deletions)
}

// ============ Topological Sort ============

fn topological_sort_collections(collections: &[db::Collection]) -> Vec<db::Collection> {
    let id_set: std::collections::HashSet<&str> =
        collections.iter().map(|c| c.id.as_str()).collect();

    let mut sorted = Vec::with_capacity(collections.len());
    let mut visited: std::collections::HashSet<&str> = std::collections::HashSet::new();

    fn visit<'a>(
        id: &'a str,
        collections: &'a [db::Collection],
        id_set: &std::collections::HashSet<&str>,
        visited: &mut std::collections::HashSet<&'a str>,
        sorted: &mut Vec<db::Collection>,
    ) {
        if visited.contains(id) {
            return;
        }
        visited.insert(id);

        if let Some(col) = collections.iter().find(|c| c.id == id) {
            // Visit parent first if it's in our set
            if let Some(ref parent_id) = col.parent_id {
                if id_set.contains(parent_id.as_str()) {
                    visit(parent_id, collections, id_set, visited, sorted);
                }
            }
            sorted.push(col.clone());
        }
    }

    for col in collections {
        visit(&col.id, collections, &id_set, &mut visited, &mut sorted);
    }

    sorted
}
