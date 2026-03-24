use crate::{db, http};
use serde::Deserialize;
use tauri::Emitter;

#[derive(Debug, Deserialize)]
pub struct CreateRequestInput {
    pub collection_id: Option<String>,
    pub project_id: Option<String>,
    pub name: String,
    pub config: Option<String>,
    pub source_commit_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateRequestInput {
    pub id: String,
    pub name: Option<String>,
    pub config: Option<String>,
    pub collection_id: Option<String>,
    pub sort_order: Option<i64>,
    #[serde(default)]
    pub move_to_root: bool,
    #[serde(
        default,
        deserialize_with = "super::collection_commands::deserialize_optional_nullable"
    )]
    pub source_commit_id: Option<Option<String>>,
}

#[derive(Debug, Deserialize)]
pub struct ExecuteRequestInput {
    pub config: String,
    /// Deprecated: env_variables is no longer used by the executor.
    /// Variable resolution is handled by the orchestrator via `execute_request_by_id`.
    /// This field is kept for backward compatibility with existing frontend callers.
    #[serde(default)]
    #[allow(dead_code)]
    pub env_variables: Option<serde_json::Value>,
}

#[tauri::command]
pub async fn create_request(input: CreateRequestInput) -> Result<db::ApiRequest, String> {
    let id = uuid::Uuid::new_v4().to_string();

    // Derive project_id server-side from the collection when collection_id is present
    let project_id = if let Some(ref cid) = input.collection_id {
        let col = db::get_collection(cid)
            .await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Collection {} not found", cid))?;
        col.project_id
            .ok_or_else(|| format!("Collection {} has no project", cid))?
    } else {
        input
            .project_id
            .ok_or_else(|| "project_id required for root requests".to_string())?
    };

    db::create_request(
        &id,
        input.collection_id.as_deref(),
        &project_id,
        &input.name,
        input.config.as_deref(),
        input.source_commit_id.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_request(input: UpdateRequestInput) -> Result<db::ApiRequest, String> {
    let source_commit_id_ref = input.source_commit_id.as_ref().map(|opt| opt.as_deref());
    db::update_request(
        &input.id,
        input.name.as_deref(),
        input.config.as_deref(),
        input.collection_id.as_deref(),
        input.sort_order,
        input.move_to_root,
        source_commit_id_ref,
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_request(id: String) -> Result<(), String> {
    db::delete_request(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_requests(collection_id: String) -> Result<Vec<db::ApiRequest>, String> {
    db::list_requests(&collection_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_request(id: String) -> Result<Option<db::ApiRequest>, String> {
    db::get_request(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn duplicate_request(id: String) -> Result<db::ApiRequest, String> {
    let new_id = uuid::Uuid::new_v4().to_string();
    db::duplicate_request(&id, &new_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn execute_request(input: ExecuteRequestInput) -> Result<http::HttpResponse, String> {
    let config: http::types::RequestConfig = serde_json::from_str(&input.config)
        .map_err(|e| format!("Invalid request config: {}", e))?;

    // NOTE: env_variables is ignored — variable resolution now happens in the
    // orchestrator via resolver::resolve_and_inject. This legacy command executes
    // the config as-is. Use execute_request_by_id for full orchestration.
    http::executor::execute(&config).await
}

#[tauri::command]
pub async fn list_root_requests(project_id: String) -> Result<Vec<db::ApiRequest>, String> {
    db::list_root_requests(&project_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn count_requests_in_collection(collection_id: String) -> Result<i64, String> {
    db::count_requests_in_collection(&collection_id)
        .await
        .map_err(|e| e.to_string())
}

/// Event-based request execution. Fires and forgets — progress streamed via "request-progress" events.
#[tauri::command]
pub async fn execute_request_by_id(
    app: tauri::AppHandle,
    request_id: String,
    execution_id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn(async move {
        if let Err(e) =
            http::orchestrator::orchestrate_request(&app, &request_id, &execution_id).await
        {
            let _ = app.emit(
                "request-progress",
                http::types::ExecutionProgress::Error {
                    execution_id,
                    error: e,
                },
            );
        }
    });
    Ok(())
}
