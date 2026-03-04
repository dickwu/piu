use crate::commands;
use crate::db;
use crate::http;
use crate::mcp_relations;
use rmcp::{
    handler::server::tool::ToolRouter, handler::server::wrapper::Parameters, model::*, tool,
    tool_handler, tool_router, ErrorData as McpError, ServerHandler,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::OnceLock;
use tauri::Emitter;

static APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();

pub fn set_app_handle(handle: tauri::AppHandle) {
    if APP_HANDLE.set(handle).is_err() {
        log::debug!(
            "AppHandle already set — ignoring re-registration (expected on server restart)"
        );
    }
}

// ============ Parameter Structs ============

#[derive(Deserialize, JsonSchema)]
struct ProjectIdParam {
    #[schemars(description = "The project's unique ID")]
    project_id: String,
}

#[derive(Deserialize, JsonSchema)]
struct CreateProjectParam {
    #[schemars(description = "Project name")]
    name: String,
    #[schemars(description = "Optional project description")]
    description: Option<String>,
    #[schemars(
        description = "Git repository URL this project was imported from (e.g. 'https://github.com/org/repo')"
    )]
    source_repo_url: Option<String>,
    #[schemars(description = "Git commit SHA at the time of import (for tracking sync state)")]
    source_commit_id: Option<String>,
    #[schemars(description = "Backend framework type (e.g. 'express', 'fastapi', 'gin', 'axum')")]
    backend_type: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
struct UpdateProjectParam {
    #[schemars(description = "The project's unique ID")]
    project_id: String,
    #[schemars(description = "New project name")]
    name: Option<String>,
    #[schemars(description = "New project description (null to clear)")]
    description: Option<Option<String>>,
    #[schemars(description = "New sort order")]
    sort_order: Option<i64>,
    #[schemars(description = "Git repository URL (null to clear)")]
    source_repo_url: Option<Option<String>>,
    #[schemars(description = "Git commit SHA (null to clear)")]
    source_commit_id: Option<Option<String>>,
    #[schemars(description = "Backend framework type (null to clear)")]
    backend_type: Option<Option<String>>,
}

#[derive(Deserialize, JsonSchema)]
struct CollectionIdParam {
    #[schemars(description = "The collection's unique ID")]
    collection_id: String,
}

#[derive(Deserialize, JsonSchema)]
struct CreateCollectionParam {
    #[schemars(description = "Project ID this collection belongs to")]
    project_id: String,
    #[schemars(description = "Collection name")]
    name: String,
    #[schemars(description = "Parent collection ID for nesting")]
    parent_id: Option<String>,
    #[schemars(
        description = "URL path prefix prepended to all child request URLs (e.g. '/v1/users')"
    )]
    path_prefix: Option<String>,
    #[schemars(description = "Collection description")]
    description: Option<String>,
    #[schemars(description = "Git commit SHA at the time of import")]
    source_commit_id: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
struct UpdateCollectionParam {
    #[schemars(description = "The collection's unique ID")]
    collection_id: String,
    #[schemars(description = "New collection name")]
    name: Option<String>,
    #[schemars(description = "New parent collection ID (null to make root-level)")]
    parent_id: Option<Option<String>>,
    #[schemars(description = "New sort order")]
    sort_order: Option<i64>,
    #[schemars(description = "URL path prefix (e.g. '/v1')")]
    path_prefix: Option<Option<String>>,
    #[schemars(description = "Collection description")]
    description: Option<Option<String>>,
    #[schemars(
        description = "Shared headers as JSON array: [{\"key\":\"X-Api\",\"value\":\"v2\",\"enabled\":true}]"
    )]
    shared_headers: Option<String>,
    #[schemars(description = "Git commit SHA (null to clear)")]
    source_commit_id: Option<Option<String>>,
}

#[derive(Deserialize, JsonSchema)]
struct RequestIdParam {
    #[schemars(description = "The API request's unique ID")]
    request_id: String,
}

#[derive(Deserialize, JsonSchema)]
struct CreateRequestParam {
    #[schemars(description = "Collection ID this request belongs to")]
    collection_id: String,
    #[schemars(description = "Request name")]
    name: String,
    #[schemars(
        description = "Request config as JSON string: {\"method\":\"GET\",\"url\":\"/path\",\"headers\":[],\"params\":[],\"body\":{\"type\":\"json\",\"content\":\"\"},\"auth\":{\"type\":\"none\"},\"description\":\"\"}"
    )]
    config: Option<String>,
    #[schemars(description = "Git commit SHA at the time of import")]
    source_commit_id: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
struct UpdateRequestParam {
    #[schemars(description = "The API request's unique ID")]
    request_id: String,
    #[schemars(description = "New request name")]
    name: Option<String>,
    #[schemars(description = "New request config as JSON string")]
    config: Option<String>,
    #[schemars(description = "Move to a different collection")]
    collection_id: Option<String>,
    #[schemars(description = "New sort order")]
    sort_order: Option<i64>,
    #[schemars(description = "Git commit SHA (null to clear)")]
    source_commit_id: Option<Option<String>>,
}

#[derive(Deserialize, JsonSchema)]
struct EnvironmentIdParam {
    #[schemars(description = "The environment's unique ID")]
    environment_id: String,
}

#[derive(Deserialize, JsonSchema)]
struct CreateEnvironmentParam {
    #[schemars(description = "Project ID this environment belongs to")]
    project_id: String,
    #[schemars(description = "Environment name (e.g. 'Development', 'Production')")]
    name: String,
    #[schemars(description = "Base host URL (e.g. 'https://api.example.com')")]
    host: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
struct UpdateEnvironmentParam {
    #[schemars(description = "The environment's unique ID")]
    environment_id: String,
    #[schemars(description = "New environment name")]
    name: Option<String>,
    #[schemars(description = "New base host URL (null to clear)")]
    host: Option<Option<String>>,
}

#[derive(Deserialize, JsonSchema)]
struct SetActiveEnvParam {
    #[schemars(description = "Environment ID to activate")]
    environment_id: String,
    #[schemars(description = "Project ID the environment belongs to")]
    project_id: String,
}

#[derive(Deserialize, JsonSchema)]
struct EnvVarInput {
    #[schemars(description = "Variable name")]
    key: String,
    #[schemars(description = "Variable value")]
    value: String,
    #[schemars(description = "Whether this variable is enabled")]
    enabled: bool,
}

#[derive(Deserialize, JsonSchema)]
struct SetEnvVarsParam {
    #[schemars(description = "The environment's unique ID")]
    environment_id: String,
    #[schemars(description = "List of variables to set (replaces all existing)")]
    variables: Vec<EnvVarInput>,
}

#[derive(Deserialize, JsonSchema)]
struct SearchParam {
    #[schemars(description = "Search query (matches request name, URL, or config content)")]
    query: String,
    #[schemars(description = "Filter by project ID")]
    project_id: Option<String>,
    #[schemars(description = "Filter by HTTP method (GET, POST, etc.)")]
    method: Option<String>,
    #[schemars(description = "Maximum results to return (default 50)")]
    limit: Option<i64>,
}

#[derive(Deserialize, JsonSchema)]
struct ChangelogParam {
    #[schemars(description = "Filter by entity type: project, collection, request, environment")]
    entity_type: Option<String>,
    #[schemars(description = "Filter by entity ID")]
    entity_id: Option<String>,
    #[schemars(description = "Maximum entries to return (default 50)")]
    limit: Option<i64>,
    #[schemars(description = "Number of entries to skip (default 0)")]
    offset: Option<i64>,
}

#[derive(Deserialize, JsonSchema)]
struct SyncStatusParam {
    #[schemars(description = "The project's unique ID")]
    project_id: String,
}

#[derive(Deserialize, JsonSchema)]
struct ModelIdParam {
    #[schemars(description = "The data model's unique ID")]
    model_id: String,
}

#[derive(Deserialize, JsonSchema)]
struct CreateModelParam {
    #[schemars(description = "Project ID this model belongs to")]
    project_id: String,
    #[schemars(description = "Model name (e.g. 'User', 'OrderResponse')")]
    name: String,
    #[schemars(description = "Model description")]
    description: Option<String>,
    #[schemars(
        description = "Fields as JSON array: [{\"name\":\"id\",\"field_type\":\"string\",\"description\":\"User ID\",\"required\":true,\"example\":\"usr_123\",\"ref_model_id\":null}]"
    )]
    fields: Option<String>,
    #[schemars(
        description = "Parent model ID for single inheritance (model must exist in same project)"
    )]
    parent_model_id: Option<String>,
    #[schemars(
        description = "Mixin model IDs as JSON array of strings (e.g. '[\"model-id-1\",\"model-id-2\"]'). Models must exist in same project."
    )]
    mixin_model_ids: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
struct UpdateModelParam {
    #[schemars(description = "The data model's unique ID")]
    model_id: String,
    #[schemars(description = "New model name")]
    name: Option<String>,
    #[schemars(description = "New model description (null to clear)")]
    description: Option<Option<String>>,
    #[schemars(description = "Updated fields as JSON array")]
    fields: Option<String>,
    #[schemars(description = "New sort order")]
    sort_order: Option<i64>,
}

#[derive(Deserialize, JsonSchema)]
struct ValidateResponseParam {
    #[schemars(description = "The data model's unique ID to validate against")]
    model_id: String,
    #[schemars(description = "The JSON response body to validate")]
    response_body: String,
}

#[derive(Deserialize, JsonSchema)]
struct GetModelDiagramParam {
    #[schemars(description = "The project's unique ID")]
    project_id: String,
}

#[derive(Deserialize, JsonSchema)]
struct LinkModelParam {
    #[schemars(description = "The API request's unique ID")]
    request_id: String,
    #[schemars(description = "Which model link to set: 'request' or 'response'")]
    model_type: String,
    #[schemars(description = "The data model's unique ID to link")]
    model_id: String,
}

#[derive(Deserialize, JsonSchema)]
struct UnlinkModelParam {
    #[schemars(description = "The API request's unique ID")]
    request_id: String,
    #[schemars(description = "Which model link to remove: 'request' or 'response'")]
    model_type: String,
}

#[derive(Deserialize, JsonSchema)]
struct BatchCreateModelsParam {
    #[schemars(description = "Project ID the models belong to")]
    project_id: String,
    #[schemars(
        description = "JSON array of models to create: [{\"name\":\"User\",\"description\":\"...\",\"fields\":\"[...]\",\"parent_model_id\":\"...\",\"mixin_model_ids\":\"[...]\"}]. Models are created in order so later entries can reference earlier ones by name."
    )]
    models: String,
}

#[derive(Deserialize, JsonSchema)]
struct BatchLinkModelsParam {
    #[schemars(
        description = "JSON array of links: [{\"request_id\":\"...\",\"model_type\":\"request\",\"model_id\":\"...\"}]"
    )]
    links: String,
}

// ============ Helper Functions ============

fn mcp_err(msg: impl std::fmt::Display) -> McpError {
    McpError::internal_error(msg.to_string(), None)
}

fn text_result(value: &impl Serialize) -> Result<CallToolResult, McpError> {
    let json = serde_json::to_string_pretty(value).map_err(mcp_err)?;
    Ok(CallToolResult::success(vec![Content::text(json)]))
}

fn parse_config(config_str: &str) -> serde_json::Value {
    serde_json::from_str(config_str).unwrap_or_else(|_| serde_json::json!({}))
}

fn enrich_request(req: &db::ApiRequest) -> serde_json::Value {
    let config = parse_config(&req.config);
    serde_json::json!({
        "id": req.id,
        "collection_id": req.collection_id,
        "name": req.name,
        "sort_order": req.sort_order,
        "method": config.get("method").and_then(|v| v.as_str()).unwrap_or("GET"),
        "url": config.get("url").and_then(|v| v.as_str()).unwrap_or(""),
        "headers": config.get("headers"),
        "params": config.get("params"),
        "body": config.get("body"),
        "auth": config.get("auth"),
        "description": config.get("description"),
        "requestModelId": config.get("requestModelId"),
        "responseModelId": config.get("responseModelId"),
        "source_commit_id": req.source_commit_id,
        "version": req.version,
        "created_at": req.created_at,
        "updated_at": req.updated_at,
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct DataChangedEvent {
    pub entity_type: String,
    pub action: String,
    pub entity_id: Option<String>,
    pub project_id: Option<String>,
}

fn emit_data_changed(
    entity_type: &str,
    action: &str,
    entity_id: Option<&str>,
    project_id: Option<&str>,
) {
    match APP_HANDLE.get() {
        Some(handle) => {
            if let Err(e) = handle.emit(
                "data-changed",
                DataChangedEvent {
                    entity_type: entity_type.to_string(),
                    action: action.to_string(),
                    entity_id: entity_id.map(|s| s.to_string()),
                    project_id: project_id.map(|s| s.to_string()),
                },
            ) {
                log::warn!("Failed to emit data-changed event: {e}");
            }
        }
        None => {
            log::warn!("Cannot emit data-changed: AppHandle not initialized");
        }
    }
}

// ============ PiuMcp Service ============

#[derive(Clone)]
pub struct PiuMcp {
    tool_router: ToolRouter<Self>,
}

impl Default for PiuMcp {
    fn default() -> Self {
        Self::new()
    }
}

#[tool_router]
impl PiuMcp {
    pub fn new() -> Self {
        Self {
            tool_router: Self::tool_router(),
        }
    }

    // ---- Projects ----

    #[tool(
        description = "List all projects with their collection counts, request counts, and environment counts. Use this first to discover available projects and their IDs. Returns full project metadata including source repository URL, sync commit, and backend framework type."
    )]
    async fn list_projects(&self) -> Result<CallToolResult, McpError> {
        let projects = db::list_projects().await.map_err(mcp_err)?;
        let mut result = Vec::new();
        for p in &projects {
            let collections = db::list_collections(Some(&p.id)).await.unwrap_or_default();
            let envs = db::list_environments(Some(&p.id)).await.unwrap_or_default();
            let mut request_count = 0usize;
            for c in &collections {
                request_count += db::list_requests(&c.id).await.unwrap_or_default().len();
            }
            result.push(serde_json::json!({
                "id": p.id,
                "name": p.name,
                "description": p.description,
                "sort_order": p.sort_order,
                "version": p.version,
                "source_repo_url": p.source_repo_url,
                "source_commit_id": p.source_commit_id,
                "backend_type": p.backend_type,
                "created_at": p.created_at,
                "updated_at": p.updated_at,
                "collection_count": collections.len(),
                "request_count": request_count,
                "environment_count": envs.len(),
            }));
        }
        text_result(&serde_json::json!({ "projects": result, "total": result.len() }))
    }

    #[tool(
        description = "Get detailed project info including all collections (with request counts), all environments (with variable counts), and the active environment."
    )]
    async fn get_project(
        &self,
        Parameters(p): Parameters<ProjectIdParam>,
    ) -> Result<CallToolResult, McpError> {
        let projects = db::list_projects().await.map_err(mcp_err)?;
        let project = projects
            .iter()
            .find(|proj| proj.id == p.project_id)
            .ok_or_else(|| mcp_err(format!("Project {} not found", p.project_id)))?;

        let collections = db::list_collections(Some(&p.project_id))
            .await
            .unwrap_or_default();
        let mut col_details = Vec::new();
        for c in &collections {
            let reqs = db::list_requests(&c.id).await.unwrap_or_default();
            col_details.push(serde_json::json!({
                "id": c.id,
                "name": c.name,
                "parent_id": c.parent_id,
                "path_prefix": c.path_prefix,
                "description": c.description,
                "shared_headers": parse_config(&c.shared_headers),
                "request_count": reqs.len(),
                "version": c.version,
                "source_commit_id": c.source_commit_id,
            }));
        }

        let envs = db::list_environments(Some(&p.project_id))
            .await
            .unwrap_or_default();
        let mut env_details = Vec::new();
        for e in &envs {
            let vars = db::list_env_variables(&e.id).await.unwrap_or_default();
            env_details.push(serde_json::json!({
                "id": e.id,
                "name": e.name,
                "host": e.host,
                "is_active": e.is_active,
                "variable_count": vars.len(),
                "version": e.version,
            }));
        }

        let active_env = db::get_active_environment(&p.project_id)
            .await
            .unwrap_or(None);
        let active_env_detail = if let Some(ref env) = active_env {
            let vars = db::list_env_variables(&env.id).await.unwrap_or_default();
            Some(serde_json::json!({
                "id": env.id,
                "name": env.name,
                "host": env.host,
                "variables": vars,
            }))
        } else {
            None
        };

        text_result(&serde_json::json!({
            "project": project,
            "collections": col_details,
            "environments": env_details,
            "active_environment": active_env_detail,
        }))
    }

    #[tool(
        description = "Get a complete tree view of a project: all collections (nested hierarchy) with every request (fully parsed configs showing method, URL, headers, params, body, auth), all environments with their variables, method statistics, source sync metadata, and the active environment. This is the most comprehensive tool for understanding a project's full API surface. Use this after import to verify all routes were captured."
    )]
    async fn get_project_overview(
        &self,
        Parameters(p): Parameters<ProjectIdParam>,
    ) -> Result<CallToolResult, McpError> {
        let projects = db::list_projects().await.map_err(mcp_err)?;
        let project = projects
            .iter()
            .find(|proj| proj.id == p.project_id)
            .ok_or_else(|| mcp_err(format!("Project {} not found", p.project_id)))?;

        let collections = db::list_collections(Some(&p.project_id))
            .await
            .unwrap_or_default();

        // Fetch all requests grouped by collection
        let mut requests_by_col: HashMap<String, Vec<serde_json::Value>> = HashMap::new();
        let mut total_requests = 0usize;
        let mut methods: HashMap<String, usize> = HashMap::new();

        for c in &collections {
            let reqs = db::list_requests(&c.id).await.unwrap_or_default();
            let enriched: Vec<serde_json::Value> = reqs.iter().map(enrich_request).collect();
            for req in &enriched {
                let m = req
                    .get("method")
                    .and_then(|v| v.as_str())
                    .unwrap_or("GET")
                    .to_string();
                *methods.entry(m).or_insert(0) += 1;
            }
            total_requests += enriched.len();
            requests_by_col.insert(c.id.clone(), enriched);
        }

        // Build nested tree
        fn build_tree(
            parent_id: Option<&str>,
            collections: &[db::Collection],
            requests_by_col: &HashMap<String, Vec<serde_json::Value>>,
        ) -> Vec<serde_json::Value> {
            collections
                .iter()
                .filter(|c| c.parent_id.as_deref() == parent_id)
                .map(|c| {
                    serde_json::json!({
                        "id": c.id,
                        "name": c.name,
                        "path_prefix": c.path_prefix,
                        "description": c.description,
                        "shared_headers": serde_json::from_str::<serde_json::Value>(&c.shared_headers).unwrap_or_default(),
                        "source_commit_id": c.source_commit_id,
                        "requests": requests_by_col.get(&c.id).unwrap_or(&Vec::new()),
                        "children": build_tree(Some(&c.id), collections, requests_by_col),
                    })
                })
                .collect()
        }

        let tree = build_tree(None, &collections, &requests_by_col);

        // Environments
        let envs = db::list_environments(Some(&p.project_id))
            .await
            .unwrap_or_default();
        let mut env_details = Vec::new();
        for e in &envs {
            let vars = db::list_env_variables(&e.id).await.unwrap_or_default();
            env_details.push(serde_json::json!({
                "id": e.id,
                "name": e.name,
                "host": e.host,
                "is_active": e.is_active,
                "variables": vars,
            }));
        }

        let active_env = db::get_active_environment(&p.project_id)
            .await
            .unwrap_or(None);
        let active_env_detail = if let Some(ref env) = active_env {
            let vars = db::list_env_variables(&env.id).await.unwrap_or_default();
            Some(serde_json::json!({
                "id": env.id,
                "name": env.name,
                "host": env.host,
                "variables": vars,
            }))
        } else {
            None
        };

        text_result(&serde_json::json!({
            "project": project,
            "active_environment": active_env_detail,
            "environments": env_details,
            "collection_tree": tree,
            "stats": {
                "total_collections": collections.len(),
                "total_requests": total_requests,
                "total_environments": envs.len(),
                "methods": methods,
            },
        }))
    }

    #[tool(
        description = "Create a new project. Use as first step when importing a backend — the returned project_id is needed for all subsequent operations. Set source_repo_url and backend_type when importing from a code repository."
    )]
    async fn create_project(
        &self,
        Parameters(p): Parameters<CreateProjectParam>,
    ) -> Result<CallToolResult, McpError> {
        let id = uuid::Uuid::new_v4().to_string();
        let project = db::create_project(
            &id,
            &p.name,
            p.description.as_deref(),
            p.source_repo_url.as_deref(),
            p.source_commit_id.as_deref(),
            p.backend_type.as_deref(),
        )
        .await
        .map_err(mcp_err)?;
        emit_data_changed("project", "created", Some(&id), Some(&id));
        text_result(&project)
    }

    #[tool(
        description = "Update a project's name, description, or sort order. Only provided fields are changed."
    )]
    async fn update_project(
        &self,
        Parameters(p): Parameters<UpdateProjectParam>,
    ) -> Result<CallToolResult, McpError> {
        let desc = p.description.as_ref().map(|d| d.as_deref());
        let source_repo_url = p.source_repo_url.as_ref().map(|o| o.as_deref());
        let source_commit_id_ref = p.source_commit_id.as_ref().map(|o| o.as_deref());
        let backend_type = p.backend_type.as_ref().map(|o| o.as_deref());
        let project = db::update_project(
            &p.project_id,
            p.name.as_deref(),
            desc,
            p.sort_order,
            source_repo_url,
            source_commit_id_ref,
            backend_type,
        )
        .await
        .map_err(mcp_err)?;
        emit_data_changed(
            "project",
            "updated",
            Some(&p.project_id),
            Some(&p.project_id),
        );
        text_result(&project)
    }

    #[tool(
        description = "Delete a project and all its collections, requests, environments, and variables (cascading delete)."
    )]
    async fn delete_project(
        &self,
        Parameters(p): Parameters<ProjectIdParam>,
    ) -> Result<CallToolResult, McpError> {
        // Reconcile active_project_id if deleting the active project
        if let Ok(Some(active_id)) = db::get_app_state("active_project_id").await {
            if active_id == p.project_id {
                let projects = db::list_projects().await.unwrap_or_default();
                let fallback = projects.iter().find(|proj| proj.id != p.project_id);
                if let Some(fb) = fallback {
                    let _ = db::set_app_state("active_project_id", &fb.id).await;
                } else {
                    // Last project being deleted — clear active_project_id
                    let _ = db::set_app_state("active_project_id", "").await;
                }
            }
        }
        db::delete_project(&p.project_id).await.map_err(mcp_err)?;
        emit_data_changed(
            "project",
            "deleted",
            Some(&p.project_id),
            Some(&p.project_id),
        );
        text_result(&serde_json::json!({ "deleted": p.project_id }))
    }

    // ---- Collections ----

    #[tool(
        description = "List all collections for a project with request counts, parsed shared headers, path prefix, parent info, and version metadata."
    )]
    async fn list_collections(
        &self,
        Parameters(p): Parameters<ProjectIdParam>,
    ) -> Result<CallToolResult, McpError> {
        let collections = db::list_collections(Some(&p.project_id))
            .await
            .map_err(mcp_err)?;
        let mut result = Vec::new();
        for c in &collections {
            let reqs = db::list_requests(&c.id).await.unwrap_or_default();
            result.push(serde_json::json!({
                "id": c.id,
                "name": c.name,
                "parent_id": c.parent_id,
                "path_prefix": c.path_prefix,
                "description": c.description,
                "shared_headers": serde_json::from_str::<serde_json::Value>(&c.shared_headers).unwrap_or_default(),
                "project_id": c.project_id,
                "request_count": reqs.len(),
                "source_commit_id": c.source_commit_id,
                "version": c.version,
                "sort_order": c.sort_order,
                "created_at": c.created_at,
                "updated_at": c.updated_at,
            }));
        }
        text_result(&serde_json::json!({ "collections": result, "total": result.len() }))
    }

    #[tool(
        description = "Get detailed info about a collection including all its API requests (with fully parsed configs: method, URL, headers, params, body, auth), shared headers, path prefix, and the parent chain from root to this collection."
    )]
    async fn get_collection(
        &self,
        Parameters(p): Parameters<CollectionIdParam>,
    ) -> Result<CallToolResult, McpError> {
        let col = db::collections::get_collection(&p.collection_id)
            .await
            .map_err(mcp_err)?
            .ok_or_else(|| mcp_err(format!("Collection {} not found", p.collection_id)))?;

        let reqs = db::list_requests(&col.id).await.unwrap_or_default();
        let enriched_reqs: Vec<serde_json::Value> = reqs.iter().map(enrich_request).collect();

        // Build parent chain
        let mut chain = Vec::new();
        let mut current_parent = col.parent_id.clone();
        while let Some(pid) = current_parent {
            if let Ok(Some(parent)) = db::collections::get_collection(&pid).await {
                chain.push(serde_json::json!({
                    "id": parent.id,
                    "name": parent.name,
                    "path_prefix": parent.path_prefix,
                }));
                current_parent = parent.parent_id;
            } else {
                break;
            }
        }
        chain.reverse();

        text_result(&serde_json::json!({
            "id": col.id,
            "name": col.name,
            "parent_id": col.parent_id,
            "path_prefix": col.path_prefix,
            "description": col.description,
            "shared_headers": serde_json::from_str::<serde_json::Value>(&col.shared_headers).unwrap_or_default(),
            "project_id": col.project_id,
            "source_commit_id": col.source_commit_id,
            "version": col.version,
            "sort_order": col.sort_order,
            "created_at": col.created_at,
            "updated_at": col.updated_at,
            "requests": enriched_reqs,
            "parent_chain": chain,
        }))
    }

    #[tool(
        description = "Create a new collection in a project, optionally nested under a parent. Maps to route groups/middleware. Set path_prefix to match Express routers (e.g. '/api/users'), FastAPI APIRouter prefixes, Go router groups, etc."
    )]
    async fn create_collection(
        &self,
        Parameters(p): Parameters<CreateCollectionParam>,
    ) -> Result<CallToolResult, McpError> {
        let id = uuid::Uuid::new_v4().to_string();
        let col = db::create_collection(
            &id,
            &p.name,
            p.parent_id.as_deref(),
            Some(&p.project_id),
            p.path_prefix.as_deref(),
            p.description.as_deref(),
            p.source_commit_id.as_deref(),
        )
        .await
        .map_err(mcp_err)?;
        emit_data_changed("collection", "created", Some(&id), Some(&p.project_id));
        text_result(&col)
    }

    #[tool(
        description = "Update a collection's name, parent, path prefix, description, shared headers, or sort order."
    )]
    async fn update_collection(
        &self,
        Parameters(p): Parameters<UpdateCollectionParam>,
    ) -> Result<CallToolResult, McpError> {
        let parent_id = p.parent_id.as_ref().map(|o| o.as_deref());
        let path_prefix = p.path_prefix.as_ref().map(|o| o.as_deref());
        let description = p.description.as_ref().map(|o| o.as_deref());
        let source_commit_id = p.source_commit_id.as_ref().map(|o| o.as_deref());

        let col = db::update_collection(
            &p.collection_id,
            p.name.as_deref(),
            parent_id,
            p.sort_order,
            path_prefix,
            description,
            p.shared_headers.as_deref(),
            source_commit_id,
        )
        .await
        .map_err(mcp_err)?;
        emit_data_changed(
            "collection",
            "updated",
            Some(&p.collection_id),
            col.project_id.as_deref(),
        );
        text_result(&col)
    }

    #[tool(
        description = "Delete a collection and all its child collections and requests (cascading delete)."
    )]
    async fn delete_collection(
        &self,
        Parameters(p): Parameters<CollectionIdParam>,
    ) -> Result<CallToolResult, McpError> {
        let col_info = db::get_collection(&p.collection_id).await.ok().flatten();
        let proj_id = col_info.as_ref().and_then(|c| c.project_id.as_deref());
        db::delete_collection(&p.collection_id)
            .await
            .map_err(mcp_err)?;
        emit_data_changed("collection", "deleted", Some(&p.collection_id), proj_id);
        text_result(&serde_json::json!({ "deleted": p.collection_id }))
    }

    // ---- API Requests ----

    #[tool(
        description = "List all API requests in a collection with fully parsed config summaries: method, URL, header count, param count, body type, auth type, and description."
    )]
    async fn list_requests(
        &self,
        Parameters(p): Parameters<CollectionIdParam>,
    ) -> Result<CallToolResult, McpError> {
        let reqs = db::list_requests(&p.collection_id).await.map_err(mcp_err)?;
        let enriched: Vec<serde_json::Value> = reqs.iter().map(enrich_request).collect();
        text_result(&serde_json::json!({ "requests": enriched, "total": enriched.len() }))
    }

    #[tool(
        description = "Get complete details of an API request: fully parsed config (method, URL, all headers, all params, body, auth details, description), collection context (path prefix, shared headers), project info, environment context (resolved host, active variables), the fully resolved URL, effective headers (merged shared + request + auth), and which {{variables}} are used."
    )]
    async fn get_request(
        &self,
        Parameters(p): Parameters<RequestIdParam>,
    ) -> Result<CallToolResult, McpError> {
        let req = db::get_request(&p.request_id)
            .await
            .map_err(mcp_err)?
            .ok_or_else(|| mcp_err(format!("Request {} not found", p.request_id)))?;

        let config: http::types::RequestConfig =
            serde_json::from_str(&req.config).unwrap_or_else(|_| http::types::RequestConfig {
                method: "GET".to_string(),
                url: String::new(),
                headers: Vec::new(),
                params: Vec::new(),
                body: Default::default(),
                auth: Default::default(),
                description: None,
            });

        // Collection context
        let col = if let Some(cid) = req.collection_id.as_deref() {
            db::collections::get_collection(cid).await.unwrap_or(None)
        } else {
            None
        };

        let col_info = col.as_ref().map(|c| {
            serde_json::json!({
                "id": c.id,
                "name": c.name,
                "path_prefix": c.path_prefix,
                "shared_headers": serde_json::from_str::<serde_json::Value>(&c.shared_headers).unwrap_or_default(),
            })
        });

        // Project context
        let project_id = col.as_ref().and_then(|c| c.project_id.as_deref());
        let project_info = if let Some(pid) = project_id {
            let projects = db::list_projects().await.unwrap_or_default();
            projects
                .iter()
                .find(|pr| pr.id == pid)
                .map(|pr| serde_json::json!({ "id": pr.id, "name": pr.name }))
        } else {
            None
        };

        // Resolve URL and variables
        let mut resolved_url = config.url.clone();
        let mut variables_used: Vec<String> = Vec::new();
        let mut variables_resolved: HashMap<String, String> = HashMap::new();

        // Apply collection path prefix
        if let Some(ref c) = col {
            if let Some(ref prefix) = c.path_prefix {
                let prefix = prefix.trim_end_matches('/');
                if !prefix.is_empty() {
                    let path = if resolved_url.starts_with('/') {
                        resolved_url.clone()
                    } else if resolved_url.is_empty() {
                        "/".to_string()
                    } else {
                        format!("/{}", resolved_url)
                    };
                    resolved_url = format!("{}{}", prefix, path);
                }
            }
        }

        // Apply environment host and load variables
        if let Some(pid) = project_id {
            if let Ok(Some(env)) = db::get_active_environment(pid).await {
                if let Some(ref host) = env.host {
                    let host = host.trim_end_matches('/');
                    if !host.is_empty() {
                        let path = if resolved_url.starts_with('/') {
                            resolved_url.clone()
                        } else if resolved_url.is_empty() {
                            String::new()
                        } else {
                            format!("/{}", resolved_url)
                        };
                        resolved_url = format!("{}{}", host, path);
                    }
                }
                if let Ok(vars) = db::list_env_variables(&env.id).await {
                    for v in &vars {
                        if v.enabled {
                            variables_resolved.insert(v.key.clone(), v.value.clone());
                        }
                    }
                }
            }
        }

        // Find {{variable}} references in all config fields
        let auth_header = [
            config.auth.header_name.as_deref().unwrap_or(""),
            config.auth.header_value.as_deref().unwrap_or(""),
        ]
        .concat();
        let all_text = format!(
            "{} {} {} {} {} {} {} {}",
            config.url,
            config
                .headers
                .iter()
                .map(|h| format!("{}{}", h.key, h.value))
                .collect::<Vec<_>>()
                .join(""),
            config
                .params
                .iter()
                .map(|p| format!("{}{}", p.key, p.value))
                .collect::<Vec<_>>()
                .join(""),
            config.body.content,
            config.auth.token.as_deref().unwrap_or(""),
            config.auth.username.as_deref().unwrap_or(""),
            config.auth.password.as_deref().unwrap_or(""),
            auth_header,
        );
        let mut i = 0;
        let bytes = all_text.as_bytes();
        while i < bytes.len().saturating_sub(3) {
            if bytes[i] == b'{' && bytes.get(i + 1) == Some(&b'{') {
                if let Some(end) = all_text[i + 2..].find("}}") {
                    let var_name = &all_text[i + 2..i + 2 + end];
                    if !var_name.is_empty() && !variables_used.contains(&var_name.to_string()) {
                        variables_used.push(var_name.to_string());
                    }
                    i += end + 4;
                    continue;
                }
            }
            i += 1;
        }

        // Build effective headers (shared + request + auth)
        let shared_headers: Vec<http::types::KeyValuePair> = col
            .as_ref()
            .map(|c| serde_json::from_str(&c.shared_headers).unwrap_or_default())
            .unwrap_or_default();

        let request_header_keys: std::collections::HashSet<String> = config
            .headers
            .iter()
            .filter(|h| h.enabled && !h.key.is_empty())
            .map(|h| h.key.to_lowercase())
            .collect();

        let mut effective_headers: Vec<serde_json::Value> = shared_headers
            .iter()
            .filter(|h| h.enabled && !h.key.is_empty() && !request_header_keys.contains(&h.key.to_lowercase()))
            .map(|h| {
                serde_json::json!({ "key": h.key, "value": h.value, "source": "collection", "enabled": h.enabled })
            })
            .collect();

        for h in &config.headers {
            if h.enabled && !h.key.is_empty() {
                effective_headers.push(
                    serde_json::json!({ "key": h.key, "value": h.value, "source": "request", "enabled": true }),
                );
            }
        }

        // Parse raw config for model ID fields not in the typed struct
        let raw_config = parse_config(&req.config);

        text_result(&serde_json::json!({
            "id": req.id,
            "name": req.name,
            "collection": col_info,
            "project": project_info,
            "config": {
                "method": config.method,
                "url": config.url,
                "headers": config.headers,
                "params": config.params,
                "body": config.body,
                "auth": config.auth,
                "description": config.description,
                "requestModelId": raw_config.get("requestModelId"),
                "responseModelId": raw_config.get("responseModelId"),
            },
            "resolved": {
                "full_url": resolved_url,
                "effective_headers": effective_headers,
                "variables_used": variables_used,
                "variables_resolved": variables_resolved,
            },
            "source_commit_id": req.source_commit_id,
            "version": req.version,
            "sort_order": req.sort_order,
            "created_at": req.created_at,
            "updated_at": req.updated_at,
        }))
    }

    #[tool(
        description = "Create a new API request in a collection. Config.url is the path only (not the host) — host comes from the environment. Use {{param}} for path parameters (e.g. '/users/{{userId}}'). The description field is critical for LLM consumers to understand the endpoint's purpose. Config defaults to GET with empty URL if omitted."
    )]
    async fn create_request(
        &self,
        Parameters(p): Parameters<CreateRequestParam>,
    ) -> Result<CallToolResult, McpError> {
        let id = uuid::Uuid::new_v4().to_string();
        // Resolve project_id from collection
        let col = db::collections::get_collection(&p.collection_id)
            .await
            .map_err(mcp_err)?
            .ok_or_else(|| mcp_err(format!("Collection {} not found", p.collection_id)))?;
        let project_id = col
            .project_id
            .as_deref()
            .ok_or_else(|| mcp_err("Collection has no project_id".to_string()))?;
        let req = db::create_request(
            &id,
            Some(&p.collection_id),
            project_id,
            &p.name,
            p.config.as_deref(),
            p.source_commit_id.as_deref(),
        )
        .await
        .map_err(mcp_err)?;
        emit_data_changed("request", "created", Some(&id), Some(project_id));
        text_result(&enrich_request(&req))
    }

    #[tool(
        description = "Update an API request's name, config (as JSON string), collection, or sort order. Only provided fields are changed."
    )]
    async fn update_request(
        &self,
        Parameters(p): Parameters<UpdateRequestParam>,
    ) -> Result<CallToolResult, McpError> {
        let source_commit_id = p.source_commit_id.as_ref().map(|o| o.as_deref());
        let req = db::update_request(
            &p.request_id,
            p.name.as_deref(),
            p.config.as_deref(),
            p.collection_id.as_deref(),
            p.sort_order,
            false,
            source_commit_id,
        )
        .await
        .map_err(mcp_err)?;
        emit_data_changed(
            "request",
            "updated",
            Some(&p.request_id),
            req.project_id.as_deref(),
        );
        text_result(&enrich_request(&req))
    }

    #[tool(description = "Delete an API request.")]
    async fn delete_request(
        &self,
        Parameters(p): Parameters<RequestIdParam>,
    ) -> Result<CallToolResult, McpError> {
        let req_info = db::get_request(&p.request_id).await.ok().flatten();
        let proj_id = req_info.as_ref().and_then(|r| r.project_id.as_deref());
        db::delete_request(&p.request_id).await.map_err(mcp_err)?;
        emit_data_changed("request", "deleted", Some(&p.request_id), proj_id);
        text_result(&serde_json::json!({ "deleted": p.request_id }))
    }

    #[tool(
        description = "Duplicate an existing API request within the same collection. The copy gets ' (copy)' appended to its name."
    )]
    async fn duplicate_request(
        &self,
        Parameters(p): Parameters<RequestIdParam>,
    ) -> Result<CallToolResult, McpError> {
        let new_id = uuid::Uuid::new_v4().to_string();
        let req = db::duplicate_request(&p.request_id, &new_id)
            .await
            .map_err(mcp_err)?;
        emit_data_changed(
            "request",
            "created",
            Some(&new_id),
            req.project_id.as_deref(),
        );
        text_result(&enrich_request(&req))
    }

    // ---- Environments ----

    #[tool(
        description = "List all environments for a project with host URL, active status, variable counts, and version metadata."
    )]
    async fn list_environments(
        &self,
        Parameters(p): Parameters<ProjectIdParam>,
    ) -> Result<CallToolResult, McpError> {
        let envs = db::list_environments(Some(&p.project_id))
            .await
            .map_err(mcp_err)?;
        let mut result = Vec::new();
        for e in &envs {
            let vars = db::list_env_variables(&e.id).await.unwrap_or_default();
            let enabled_count = vars.iter().filter(|v| v.enabled).count();
            result.push(serde_json::json!({
                "id": e.id,
                "name": e.name,
                "host": e.host,
                "is_active": e.is_active,
                "sort_order": e.sort_order,
                "variable_count": vars.len(),
                "enabled_variable_count": enabled_count,
                "version": e.version,
                "created_at": e.created_at,
                "updated_at": e.updated_at,
            }));
        }
        text_result(&serde_json::json!({ "environments": result, "total": result.len() }))
    }

    #[tool(
        description = "Get detailed information about an environment including all its variables (keys, values, enabled status)."
    )]
    async fn get_environment(
        &self,
        Parameters(p): Parameters<EnvironmentIdParam>,
    ) -> Result<CallToolResult, McpError> {
        let envs = db::list_environments(None).await.map_err(mcp_err)?;
        let env = envs
            .iter()
            .find(|e| e.id == p.environment_id)
            .ok_or_else(|| mcp_err(format!("Environment {} not found", p.environment_id)))?;

        let vars = db::list_env_variables(&env.id).await.map_err(mcp_err)?;

        text_result(&serde_json::json!({
            "id": env.id,
            "name": env.name,
            "host": env.host,
            "is_active": env.is_active,
            "project_id": env.project_id,
            "sort_order": env.sort_order,
            "version": env.version,
            "created_at": env.created_at,
            "updated_at": env.updated_at,
            "variables": vars,
        }))
    }

    #[tool(description = "Create a new environment in a project with an optional base host URL.")]
    async fn create_environment(
        &self,
        Parameters(p): Parameters<CreateEnvironmentParam>,
    ) -> Result<CallToolResult, McpError> {
        let id = uuid::Uuid::new_v4().to_string();
        let env = db::create_environment(&id, &p.name, Some(&p.project_id), p.host.as_deref())
            .await
            .map_err(mcp_err)?;
        emit_data_changed("environment", "created", Some(&id), Some(&p.project_id));
        text_result(&env)
    }

    #[tool(description = "Update an environment's name or host URL.")]
    async fn update_environment(
        &self,
        Parameters(p): Parameters<UpdateEnvironmentParam>,
    ) -> Result<CallToolResult, McpError> {
        let host = p.host.as_ref().map(|o| o.as_deref());
        let env = db::update_environment(&p.environment_id, p.name.as_deref(), host)
            .await
            .map_err(mcp_err)?;
        emit_data_changed(
            "environment",
            "updated",
            Some(&p.environment_id),
            env.project_id.as_deref(),
        );
        text_result(&env)
    }

    #[tool(description = "Delete an environment and all its variables.")]
    async fn delete_environment(
        &self,
        Parameters(p): Parameters<EnvironmentIdParam>,
    ) -> Result<CallToolResult, McpError> {
        let envs = db::list_environments(None).await.unwrap_or_default();
        let env_proj_id = envs
            .iter()
            .find(|e| e.id == p.environment_id)
            .and_then(|e| e.project_id.as_deref())
            .map(|s| s.to_string());
        db::delete_environment(&p.environment_id)
            .await
            .map_err(mcp_err)?;
        emit_data_changed(
            "environment",
            "deleted",
            Some(&p.environment_id),
            env_proj_id.as_deref(),
        );
        text_result(&serde_json::json!({ "deleted": p.environment_id }))
    }

    #[tool(
        description = "Set an environment as the active environment for its project. Only one environment can be active per project; all others are deactivated."
    )]
    async fn set_active_environment(
        &self,
        Parameters(p): Parameters<SetActiveEnvParam>,
    ) -> Result<CallToolResult, McpError> {
        db::set_active_environment(&p.environment_id, &p.project_id)
            .await
            .map_err(mcp_err)?;
        emit_data_changed(
            "environment",
            "updated",
            Some(&p.environment_id),
            Some(&p.project_id),
        );
        text_result(&serde_json::json!({
            "activated": p.environment_id,
            "project_id": p.project_id,
        }))
    }

    // ---- Environment Variables ----

    #[tool(
        description = "List all variables for an environment with their keys, values, and enabled status."
    )]
    async fn list_env_variables(
        &self,
        Parameters(p): Parameters<EnvironmentIdParam>,
    ) -> Result<CallToolResult, McpError> {
        let vars = db::list_env_variables(&p.environment_id)
            .await
            .map_err(mcp_err)?;
        text_result(&serde_json::json!({ "variables": vars, "total": vars.len() }))
    }

    #[tool(
        description = "Replace all variables for an environment. This is an upsert-all operation: all existing variables are deleted and replaced with the provided list."
    )]
    async fn set_env_variables(
        &self,
        Parameters(p): Parameters<SetEnvVarsParam>,
    ) -> Result<CallToolResult, McpError> {
        let envs = db::list_environments(None).await.unwrap_or_default();
        let env_proj_id = envs
            .iter()
            .find(|e| e.id == p.environment_id)
            .and_then(|e| e.project_id.as_deref())
            .map(|s| s.to_string());
        let variables: Vec<(String, String, String, bool)> = p
            .variables
            .iter()
            .map(|v| {
                (
                    uuid::Uuid::new_v4().to_string(),
                    v.key.clone(),
                    v.value.clone(),
                    v.enabled,
                )
            })
            .collect();
        let count = variables.len();
        db::set_env_variables(&p.environment_id, variables)
            .await
            .map_err(mcp_err)?;
        emit_data_changed(
            "environment",
            "updated",
            Some(&p.environment_id),
            env_proj_id.as_deref(),
        );
        text_result(&serde_json::json!({
            "environment_id": p.environment_id,
            "variables_set": count,
        }))
    }

    // ---- Data Models ----

    #[tool(description = "List all data models for a project with field counts and descriptions.")]
    async fn list_models(
        &self,
        Parameters(p): Parameters<ProjectIdParam>,
    ) -> Result<CallToolResult, McpError> {
        let models = db::models::list_models(&p.project_id)
            .await
            .map_err(mcp_err)?;
        let result: Vec<serde_json::Value> = models
            .iter()
            .map(|m| {
                let fields: Vec<serde_json::Value> =
                    serde_json::from_str(&m.fields).unwrap_or_default();
                serde_json::json!({
                    "id": m.id,
                    "project_id": m.project_id,
                    "name": m.name,
                    "description": m.description,
                    "field_count": fields.len(),
                    "sort_order": m.sort_order,
                    "version": m.version,
                    "created_at": m.created_at,
                    "updated_at": m.updated_at,
                })
            })
            .collect();
        text_result(&serde_json::json!({ "models": result, "total": result.len() }))
    }

    #[tool(
        description = "Get detailed info about a data model including all parsed fields with their types, descriptions, required status, examples, and model references."
    )]
    async fn get_model(
        &self,
        Parameters(p): Parameters<ModelIdParam>,
    ) -> Result<CallToolResult, McpError> {
        let model = db::models::get_model(&p.model_id)
            .await
            .map_err(mcp_err)?
            .ok_or_else(|| mcp_err(format!("Model {} not found", p.model_id)))?;

        let fields: Vec<serde_json::Value> =
            serde_json::from_str(&model.fields).unwrap_or_default();

        text_result(&serde_json::json!({
            "id": model.id,
            "project_id": model.project_id,
            "name": model.name,
            "description": model.description,
            "fields": fields,
            "field_count": fields.len(),
            "sort_order": model.sort_order,
            "version": model.version,
            "created_at": model.created_at,
            "updated_at": model.updated_at,
        }))
    }

    #[tool(
        description = "Create a new data model in a project with a name, optional description, and optional field definitions."
    )]
    async fn create_model(
        &self,
        Parameters(p): Parameters<CreateModelParam>,
    ) -> Result<CallToolResult, McpError> {
        if let Some(ref fields_json) = p.fields {
            db::models::validate_model_refs(&p.project_id, fields_json)
                .await
                .map_err(mcp_err)?;
        }

        // Validate parent/mixin references exist in same project
        if let Some(ref parent_id) = p.parent_model_id {
            let parent_exists = db::models::get_model(parent_id)
                .await
                .map_err(mcp_err)?
                .map(|m| m.project_id == p.project_id)
                .unwrap_or(false);
            if !parent_exists {
                return Err(mcp_err(format!(
                    "parent_model_id '{}' does not exist in project '{}'",
                    parent_id, p.project_id
                )));
            }
        }
        if let Some(ref mixin_json) = p.mixin_model_ids {
            let mixin_ids: Vec<String> = serde_json::from_str(mixin_json)
                .map_err(|e| mcp_err(format!("Invalid mixin_model_ids JSON: {}", e)))?;
            for mixin_id in &mixin_ids {
                let mixin_exists = db::models::get_model(mixin_id)
                    .await
                    .map_err(mcp_err)?
                    .map(|m| m.project_id == p.project_id)
                    .unwrap_or(false);
                if !mixin_exists {
                    return Err(mcp_err(format!(
                        "mixin_model_id '{}' does not exist in project '{}'",
                        mixin_id, p.project_id
                    )));
                }
            }
        }

        let id = uuid::Uuid::new_v4().to_string();
        let model = db::models::create_model(
            &id,
            &p.project_id,
            &p.name,
            p.description.as_deref(),
            p.fields.as_deref(),
            p.parent_model_id.as_deref(),
            p.mixin_model_ids.as_deref(),
        )
        .await
        .map_err(mcp_err)?;

        emit_data_changed("model", "created", Some(&id), Some(&p.project_id));

        let fields: Vec<serde_json::Value> =
            serde_json::from_str(&model.fields).unwrap_or_default();

        text_result(&serde_json::json!({
            "id": model.id,
            "project_id": model.project_id,
            "name": model.name,
            "description": model.description,
            "parent_model_id": model.parent_model_id,
            "mixin_model_ids": serde_json::from_str::<serde_json::Value>(&model.mixin_model_ids).unwrap_or_default(),
            "fields": fields,
            "field_count": fields.len(),
            "sort_order": model.sort_order,
            "version": model.version,
            "created_at": model.created_at,
            "updated_at": model.updated_at,
        }))
    }

    #[tool(description = "Update a data model's name, description, fields, or sort order.")]
    async fn update_model(
        &self,
        Parameters(p): Parameters<UpdateModelParam>,
    ) -> Result<CallToolResult, McpError> {
        if let Some(ref fields_json) = p.fields {
            // Retrieve project_id for ref validation
            let existing = db::models::get_model(&p.model_id)
                .await
                .map_err(mcp_err)?
                .ok_or_else(|| mcp_err(format!("Model {} not found", p.model_id)))?;
            db::models::validate_model_refs(&existing.project_id, fields_json)
                .await
                .map_err(mcp_err)?;
        }

        let desc = p.description.as_ref().map(|o| o.as_deref());
        let model = db::models::update_model(
            &p.model_id,
            p.name.as_deref(),
            desc,
            p.fields.as_deref(),
            p.sort_order,
            None,
            None,
        )
        .await
        .map_err(mcp_err)?;

        emit_data_changed(
            "model",
            "updated",
            Some(&p.model_id),
            Some(&model.project_id),
        );

        let fields: Vec<serde_json::Value> =
            serde_json::from_str(&model.fields).unwrap_or_default();

        text_result(&serde_json::json!({
            "id": model.id,
            "project_id": model.project_id,
            "name": model.name,
            "description": model.description,
            "fields": fields,
            "field_count": fields.len(),
            "sort_order": model.sort_order,
            "version": model.version,
            "created_at": model.created_at,
            "updated_at": model.updated_at,
        }))
    }

    #[tool(
        description = "Delete a data model. References to this model in other models' fields will be automatically cleared."
    )]
    async fn delete_model(
        &self,
        Parameters(p): Parameters<ModelIdParam>,
    ) -> Result<CallToolResult, McpError> {
        let model_info = db::models::get_model(&p.model_id).await.ok().flatten();
        let proj_id = model_info.as_ref().map(|m| m.project_id.as_str());
        db::models::delete_model(&p.model_id)
            .await
            .map_err(mcp_err)?;
        emit_data_changed("model", "deleted", Some(&p.model_id), proj_id);
        emit_data_changed("request", "updated", None, proj_id);
        text_result(&serde_json::json!({ "deleted": p.model_id }))
    }

    #[tool(
        description = "Generate a sample JSON request body from a data model's field definitions. Uses example values when available, with recursive model reference expansion."
    )]
    async fn generate_body_from_model(
        &self,
        Parameters(p): Parameters<ModelIdParam>,
    ) -> Result<CallToolResult, McpError> {
        let model = db::models::get_model(&p.model_id)
            .await
            .map_err(mcp_err)?
            .ok_or_else(|| mcp_err(format!("Model {} not found", p.model_id)))?;

        // Load all sibling models for ref expansion
        let all_models = db::models::list_models(&model.project_id)
            .await
            .unwrap_or_default();

        fn build_sample(
            fields_json: &str,
            all_models: &[db::models::DataModel],
            visited: &mut std::collections::HashSet<String>,
            depth: u8,
        ) -> serde_json::Value {
            if depth > 5 {
                return serde_json::json!({});
            }
            let fields: Vec<serde_json::Value> =
                serde_json::from_str(fields_json).unwrap_or_default();
            let mut obj = serde_json::Map::new();
            for field in &fields {
                let name = field.get("name").and_then(|v| v.as_str()).unwrap_or("");
                if name.is_empty() {
                    continue;
                }
                let field_type = field
                    .get("field_type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("string");
                let example = field.get("example").and_then(|v| v.as_str());
                let ref_model_id = field
                    .get("ref_model_id")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty());

                let value = if let Some(ref_id) = ref_model_id {
                    let raw = if visited.contains(ref_id) {
                        serde_json::json!(null)
                    } else if let Some(ref_model) = all_models.iter().find(|m| m.id == ref_id) {
                        visited.insert(ref_id.to_string());
                        let v = build_sample(&ref_model.fields, all_models, visited, depth + 1);
                        visited.remove(ref_id);
                        v
                    } else {
                        serde_json::json!({})
                    };
                    if field_type == "array" {
                        serde_json::json!([raw])
                    } else {
                        raw
                    }
                } else if let Some(ex) = example {
                    // Try to parse as JSON value first; fall back to string
                    serde_json::from_str(ex)
                        .unwrap_or_else(|_| serde_json::Value::String(ex.to_string()))
                } else {
                    match field_type {
                        "string" => serde_json::json!(""),
                        "number" | "integer" => serde_json::json!(0),
                        "boolean" => serde_json::json!(false),
                        "array" => serde_json::json!([]),
                        "object" => serde_json::json!({}),
                        _ => serde_json::json!(null),
                    }
                };
                obj.insert(name.to_string(), value);
            }
            serde_json::Value::Object(obj)
        }

        let mut visited = std::collections::HashSet::new();
        visited.insert(model.id.clone());
        let sample = build_sample(&model.fields, &all_models, &mut visited, 0);
        let pretty = serde_json::to_string_pretty(&sample).unwrap_or_else(|_| "{}".to_string());

        text_result(&serde_json::json!({
            "model_id": model.id,
            "model_name": model.name,
            "sample_body": pretty,
        }))
    }

    #[tool(
        description = "Validate a JSON response body against a data model's field definitions. Checks required fields and basic type matching."
    )]
    async fn validate_response_against_model(
        &self,
        Parameters(p): Parameters<ValidateResponseParam>,
    ) -> Result<CallToolResult, McpError> {
        let model = db::models::get_model(&p.model_id)
            .await
            .map_err(mcp_err)?
            .ok_or_else(|| mcp_err(format!("Model {} not found", p.model_id)))?;

        let fields: Vec<serde_json::Value> =
            serde_json::from_str(&model.fields).unwrap_or_default();

        let response: serde_json::Value = serde_json::from_str(&p.response_body)
            .map_err(|e| mcp_err(format!("Invalid JSON response body: {}", e)))?;

        let response_obj = response.as_object();

        let mut results: Vec<serde_json::Value> = Vec::new();
        let mut valid_count = 0usize;
        let mut missing_count = 0usize;
        let mut mismatch_count = 0usize;

        for field in &fields {
            let name = match field.get("name").and_then(|v| v.as_str()) {
                Some(n) if !n.is_empty() => n,
                _ => continue,
            };
            let expected_type = field
                .get("field_type")
                .and_then(|v| v.as_str())
                .unwrap_or("string");
            let required = field
                .get("required")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            let actual_value = response_obj.and_then(|obj| obj.get(name));

            let (status, actual_type) = match actual_value {
                None => {
                    if required {
                        missing_count += 1;
                        ("missing", "absent")
                    } else {
                        // optional and absent — treat as valid
                        valid_count += 1;
                        ("valid", "absent")
                    }
                }
                Some(v) => {
                    let actual = match v {
                        serde_json::Value::String(_) => "string",
                        serde_json::Value::Number(n) => {
                            if n.is_f64() {
                                "number"
                            } else {
                                "integer"
                            }
                        }
                        serde_json::Value::Bool(_) => "boolean",
                        serde_json::Value::Array(_) => "array",
                        serde_json::Value::Object(_) => "object",
                        serde_json::Value::Null => "null",
                    };
                    // Loose type matching: integer satisfies number
                    let matches = actual == expected_type
                        || (expected_type == "number" && actual == "integer")
                        || (expected_type == "integer" && actual == "number");
                    if matches {
                        valid_count += 1;
                        ("valid", actual)
                    } else {
                        mismatch_count += 1;
                        ("type_mismatch", actual)
                    }
                }
            };

            results.push(serde_json::json!({
                "field": name,
                "expected_type": expected_type,
                "actual_type": actual_type,
                "required": required,
                "status": status,
            }));
        }

        text_result(&serde_json::json!({
            "model_id": model.id,
            "model_name": model.name,
            "is_valid": missing_count == 0 && mismatch_count == 0,
            "summary": {
                "valid": valid_count,
                "missing": missing_count,
                "type_mismatch": mismatch_count,
                "total_fields": results.len(),
            },
            "fields": results,
        }))
    }

    // ---- Model Relations ----

    #[tool(
        description = "Get a relationship graph of all data models in a project. Returns nodes (models) and edges (inheritance, mixin, field references). Use this to understand how models relate to each other."
    )]
    async fn get_model_relations(
        &self,
        Parameters(p): Parameters<ProjectIdParam>,
    ) -> Result<CallToolResult, McpError> {
        let graph = mcp_relations::get_model_relations(&p.project_id)
            .await
            .map_err(mcp_err)?;
        text_result(&serde_json::json!(graph))
    }

    #[tool(
        description = "Get the inheritance hierarchy for a specific model: parent chain (ancestors), children (descendants), and mixin relationships. DAG-aware — mixins are returned as separate edges, not flattened into the tree."
    )]
    async fn get_model_hierarchy(
        &self,
        Parameters(p): Parameters<ModelIdParam>,
    ) -> Result<CallToolResult, McpError> {
        let hierarchy = mcp_relations::get_model_hierarchy(&p.model_id)
            .await
            .map_err(mcp_err)?;
        text_result(&serde_json::json!(hierarchy))
    }

    #[tool(
        description = "Generate a Mermaid class diagram showing all model relationships in a project. Returns a Mermaid classDiagram string that LLMs and markdown renderers can display directly. Shows inheritance (<|--), mixin (<|..), and field reference (-->) relationships."
    )]
    async fn get_model_diagram(
        &self,
        Parameters(p): Parameters<GetModelDiagramParam>,
    ) -> Result<CallToolResult, McpError> {
        let diagram = mcp_relations::generate_mermaid_diagram(&p.project_id)
            .await
            .map_err(mcp_err)?;
        Ok(CallToolResult::success(vec![Content::text(diagram)]))
    }

    // ---- Model-Request Linking ----

    #[tool(
        description = "Set requestModelId or responseModelId on a request's config. Links a data model to a request so the model's schema documents the request or response shape. The model must belong to the same project as the request."
    )]
    async fn link_model_to_request(
        &self,
        Parameters(p): Parameters<LinkModelParam>,
    ) -> Result<CallToolResult, McpError> {
        let config_key = match p.model_type.as_str() {
            "request" => "requestModelId",
            "response" => "responseModelId",
            _ => return Err(mcp_err("model_type must be 'request' or 'response'")),
        };

        let req = db::get_request(&p.request_id)
            .await
            .map_err(mcp_err)?
            .ok_or_else(|| mcp_err(format!("Request {} not found", p.request_id)))?;

        // Validate model exists and belongs to the same project
        let model = db::models::get_model(&p.model_id)
            .await
            .map_err(mcp_err)?
            .ok_or_else(|| mcp_err(format!("Model {} not found", p.model_id)))?;

        // Validate model belongs to same project as request
        if let Some(ref req_project_id) = req.project_id {
            if req_project_id != &model.project_id {
                return Err(mcp_err(format!(
                    "Model '{}' belongs to project '{}' but request belongs to project '{}'",
                    p.model_id, model.project_id, req_project_id
                )));
            }
        }

        let mut config: serde_json::Value =
            serde_json::from_str(&req.config).unwrap_or_else(|_| serde_json::json!({}));
        config[config_key] = serde_json::Value::String(p.model_id.clone());

        let config_str =
            serde_json::to_string(&config).map_err(|e| mcp_err(format!("JSON error: {}", e)))?;

        let updated_req = db::update_request(
            &p.request_id,
            None,
            Some(&config_str),
            None,
            None,
            false,
            None,
        )
        .await
        .map_err(mcp_err)?;
        emit_data_changed(
            "request",
            "updated",
            Some(&p.request_id),
            updated_req.project_id.as_deref(),
        );

        text_result(&serde_json::json!({
            "request_id": p.request_id,
            "model_type": p.model_type,
            "model_id": p.model_id,
            "model_name": model.name,
        }))
    }

    #[tool(
        description = "Remove a requestModelId or responseModelId link from a request's config."
    )]
    async fn unlink_model_from_request(
        &self,
        Parameters(p): Parameters<UnlinkModelParam>,
    ) -> Result<CallToolResult, McpError> {
        let config_key = match p.model_type.as_str() {
            "request" => "requestModelId",
            "response" => "responseModelId",
            _ => return Err(mcp_err("model_type must be 'request' or 'response'")),
        };

        let req = db::get_request(&p.request_id)
            .await
            .map_err(mcp_err)?
            .ok_or_else(|| mcp_err(format!("Request {} not found", p.request_id)))?;

        let mut config: serde_json::Value =
            serde_json::from_str(&req.config).unwrap_or_else(|_| serde_json::json!({}));
        if let Some(obj) = config.as_object_mut() {
            obj.remove(config_key);
        }

        let config_str =
            serde_json::to_string(&config).map_err(|e| mcp_err(format!("JSON error: {}", e)))?;

        let updated_req = db::update_request(
            &p.request_id,
            None,
            Some(&config_str),
            None,
            None,
            false,
            None,
        )
        .await
        .map_err(mcp_err)?;
        emit_data_changed(
            "request",
            "updated",
            Some(&p.request_id),
            updated_req.project_id.as_deref(),
        );

        text_result(&serde_json::json!({
            "request_id": p.request_id,
            "model_type": p.model_type,
            "unlinked": true,
        }))
    }

    #[tool(
        description = "Get both linked models (request and response) for a request, with resolved fields including inherited and mixin fields. Returns null for unlinked slots."
    )]
    async fn get_request_models(
        &self,
        Parameters(p): Parameters<RequestIdParam>,
    ) -> Result<CallToolResult, McpError> {
        let req = db::get_request(&p.request_id)
            .await
            .map_err(mcp_err)?
            .ok_or_else(|| mcp_err(format!("Request {} not found", p.request_id)))?;

        let config: serde_json::Value =
            serde_json::from_str(&req.config).unwrap_or_else(|_| serde_json::json!({}));

        let request_model_id = config
            .get("requestModelId")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty());
        let response_model_id = config
            .get("responseModelId")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty());

        async fn resolve_model_with_fields(model_id: &str) -> Option<serde_json::Value> {
            let model = db::models::get_model(model_id).await.ok()??;
            let fields = commands::resolve_model_fields(model_id.to_string())
                .await
                .ok()?;
            let field_values: Vec<serde_json::Value> = fields
                .iter()
                .map(|f| {
                    serde_json::json!({
                        "name": f.name,
                        "field_type": f.field_type,
                        "description": f.description,
                        "required": f.required,
                        "example": f.example,
                        "ref_model_id": f.ref_model_id,
                        "origin": f.origin,
                        "origin_model_id": f.origin_model_id,
                        "origin_model_name": f.origin_model_name,
                        "overridden": f.overridden,
                    })
                })
                .collect();
            Some(serde_json::json!({
                "id": model.id,
                "name": model.name,
                "description": model.description,
                "parent_model_id": model.parent_model_id,
                "resolved_fields": field_values,
                "field_count": field_values.len(),
            }))
        }

        let request_model = if let Some(mid) = request_model_id {
            resolve_model_with_fields(mid).await
        } else {
            None
        };
        let response_model = if let Some(mid) = response_model_id {
            resolve_model_with_fields(mid).await
        } else {
            None
        };

        text_result(&serde_json::json!({
            "request_id": p.request_id,
            "request_model": request_model,
            "response_model": response_model,
        }))
    }

    #[tool(
        description = "Resolve all fields for a data model including inherited fields from parent and mixin models. Returns each field with its origin ('own', 'parent', 'mixin'), source model info, and override status."
    )]
    async fn resolve_model_fields(
        &self,
        Parameters(p): Parameters<ModelIdParam>,
    ) -> Result<CallToolResult, McpError> {
        let model = db::models::get_model(&p.model_id)
            .await
            .map_err(mcp_err)?
            .ok_or_else(|| mcp_err(format!("Model {} not found", p.model_id)))?;

        let fields = commands::resolve_model_fields(p.model_id)
            .await
            .map_err(mcp_err)?;

        let field_values: Vec<serde_json::Value> = fields
            .iter()
            .map(|f| {
                serde_json::json!({
                    "name": f.name,
                    "field_type": f.field_type,
                    "description": f.description,
                    "required": f.required,
                    "example": f.example,
                    "ref_model_id": f.ref_model_id,
                    "origin": f.origin,
                    "origin_model_id": f.origin_model_id,
                    "origin_model_name": f.origin_model_name,
                    "overridden": f.overridden,
                })
            })
            .collect();

        text_result(&serde_json::json!({
            "model_id": model.id,
            "model_name": model.name,
            "parent_model_id": model.parent_model_id,
            "mixin_model_ids": serde_json::from_str::<serde_json::Value>(&model.mixin_model_ids).unwrap_or_default(),
            "resolved_fields": field_values,
            "field_count": field_values.len(),
        }))
    }

    #[tool(
        description = "Bulk create multiple data models in a project. Models are created in order so later entries can reference earlier ones by name via parent_model_id or mixin_model_ids. Returns created models with their IDs."
    )]
    async fn batch_create_models(
        &self,
        Parameters(p): Parameters<BatchCreateModelsParam>,
    ) -> Result<CallToolResult, McpError> {
        #[derive(Deserialize)]
        struct BatchModelInput {
            name: String,
            description: Option<String>,
            fields: Option<String>,
            parent_model_id: Option<String>,
            mixin_model_ids: Option<String>,
        }

        let models: Vec<BatchModelInput> = serde_json::from_str(&p.models)
            .map_err(|e| mcp_err(format!("Invalid models JSON array: {}", e)))?;

        // Name → ID mapping so later models can reference earlier ones by name
        let mut name_to_id: HashMap<String, String> = HashMap::new();
        let mut created: Vec<serde_json::Value> = Vec::new();
        let mut errors: Vec<serde_json::Value> = Vec::new();

        let total = models.len();

        for input in &models {
            // Resolve parent by name or pass through as raw ID
            let parent_id = input
                .parent_model_id
                .as_ref()
                .map(|pid| name_to_id.get(pid).cloned().unwrap_or_else(|| pid.clone()));

            // Validate parent belongs to same project (if not a batch name reference)
            if let Some(ref pid) = parent_id {
                match db::models::get_model(pid).await {
                    Ok(Some(m)) if m.project_id != p.project_id => {
                        errors.push(serde_json::json!({
                            "name": input.name,
                            "error": format!("parent_model_id '{}' does not belong to project '{}'", pid, p.project_id),
                        }));
                        continue;
                    }
                    Ok(None) => {
                        errors.push(serde_json::json!({
                            "name": input.name,
                            "error": format!("parent_model_id '{}' not found", pid),
                        }));
                        continue;
                    }
                    Err(e) => {
                        errors.push(serde_json::json!({
                            "name": input.name,
                            "error": e.to_string(),
                        }));
                        continue;
                    }
                    _ => {}
                }
            }

            // Resolve mixin IDs by name
            let mixin_ids_str = if let Some(ref mixin_json) = input.mixin_model_ids {
                let raw_ids: Vec<String> = match serde_json::from_str(mixin_json) {
                    Ok(ids) => ids,
                    Err(e) => {
                        errors.push(serde_json::json!({
                            "name": input.name,
                            "error": format!("Invalid mixin_model_ids JSON: {}", e),
                        }));
                        continue;
                    }
                };
                let resolved: Vec<String> = raw_ids
                    .into_iter()
                    .map(|mid| name_to_id.get(&mid).cloned().unwrap_or(mid))
                    .collect();
                // Validate each mixin belongs to same project
                let mut mixin_valid = true;
                for mid in &resolved {
                    match db::models::get_model(mid).await {
                        Ok(Some(m)) if m.project_id != p.project_id => {
                            errors.push(serde_json::json!({
                                "name": input.name,
                                "error": format!("mixin_model_id '{}' does not belong to project '{}'", mid, p.project_id),
                            }));
                            mixin_valid = false;
                            break;
                        }
                        Ok(None) => {
                            errors.push(serde_json::json!({
                                "name": input.name,
                                "error": format!("mixin_model_id '{}' not found", mid),
                            }));
                            mixin_valid = false;
                            break;
                        }
                        Err(e) => {
                            errors.push(serde_json::json!({
                                "name": input.name,
                                "error": e.to_string(),
                            }));
                            mixin_valid = false;
                            break;
                        }
                        _ => {}
                    }
                }
                if !mixin_valid {
                    continue;
                }
                Some(serde_json::to_string(&resolved).unwrap_or_else(|_| "[]".to_string()))
            } else {
                None
            };

            if let Some(ref fields_json) = input.fields {
                if let Err(e) = db::models::validate_model_refs(&p.project_id, fields_json).await {
                    errors.push(serde_json::json!({
                        "name": input.name,
                        "error": e.to_string(),
                    }));
                    continue;
                }
            }

            let id = uuid::Uuid::new_v4().to_string();
            match db::models::create_model(
                &id,
                &p.project_id,
                &input.name,
                input.description.as_deref(),
                input.fields.as_deref(),
                parent_id.as_deref(),
                mixin_ids_str.as_deref(),
            )
            .await
            {
                Ok(model) => {
                    let fields: Vec<serde_json::Value> =
                        serde_json::from_str(&model.fields).unwrap_or_default();
                    name_to_id.insert(input.name.clone(), model.id.clone());
                    created.push(serde_json::json!({
                        "id": model.id,
                        "name": model.name,
                        "field_count": fields.len(),
                    }));
                }
                Err(e) => {
                    errors.push(serde_json::json!({
                        "name": input.name,
                        "error": e.to_string(),
                    }));
                }
            }
        }

        if !created.is_empty() {
            emit_data_changed("model", "created", None, Some(&p.project_id));
        }

        text_result(&serde_json::json!({
            "created": created,
            "errors": errors,
            "total": total,
        }))
    }

    #[tool(
        description = "Bulk link models to requests. Each link sets requestModelId or responseModelId on the request's config. Applies each link atomically."
    )]
    async fn batch_link_models(
        &self,
        Parameters(p): Parameters<BatchLinkModelsParam>,
    ) -> Result<CallToolResult, McpError> {
        #[derive(Deserialize)]
        struct LinkInput {
            request_id: String,
            model_type: String,
            model_id: String,
        }

        let links: Vec<LinkInput> = serde_json::from_str(&p.links)
            .map_err(|e| mcp_err(format!("Invalid links JSON array: {}", e)))?;

        let mut linked = 0usize;
        let mut errors: Vec<serde_json::Value> = Vec::new();

        for link in &links {
            let config_key = match link.model_type.as_str() {
                "request" => "requestModelId",
                "response" => "responseModelId",
                _ => {
                    errors.push(serde_json::json!({
                        "request_id": link.request_id,
                        "error": "model_type must be 'request' or 'response'",
                    }));
                    continue;
                }
            };

            let req = match db::get_request(&link.request_id).await {
                Ok(Some(r)) => r,
                Ok(None) => {
                    errors.push(serde_json::json!({
                        "request_id": link.request_id,
                        "error": "Request not found",
                    }));
                    continue;
                }
                Err(e) => {
                    errors.push(serde_json::json!({
                        "request_id": link.request_id,
                        "error": e.to_string(),
                    }));
                    continue;
                }
            };

            // Validate model exists and belongs to same project
            let model = match db::models::get_model(&link.model_id).await {
                Ok(Some(m)) => m,
                Ok(None) => {
                    errors.push(serde_json::json!({
                        "request_id": link.request_id,
                        "error": format!("Model {} not found", link.model_id),
                    }));
                    continue;
                }
                Err(e) => {
                    errors.push(serde_json::json!({
                        "request_id": link.request_id,
                        "error": e.to_string(),
                    }));
                    continue;
                }
            };
            if let Some(ref req_project_id) = req.project_id {
                if req_project_id != &model.project_id {
                    errors.push(serde_json::json!({
                        "request_id": link.request_id,
                        "error": format!(
                            "Model '{}' belongs to project '{}' but request belongs to project '{}'",
                            link.model_id, model.project_id, req_project_id
                        ),
                    }));
                    continue;
                }
            }

            let mut config: serde_json::Value =
                serde_json::from_str(&req.config).unwrap_or_else(|_| serde_json::json!({}));
            config[config_key] = serde_json::Value::String(link.model_id.clone());

            let config_str = match serde_json::to_string(&config) {
                Ok(s) => s,
                Err(e) => {
                    errors.push(serde_json::json!({
                        "request_id": link.request_id,
                        "error": e.to_string(),
                    }));
                    continue;
                }
            };

            match db::update_request(
                &link.request_id,
                None,
                Some(&config_str),
                None,
                None,
                false,
                None,
            )
            .await
            {
                Ok(_) => linked += 1,
                Err(e) => {
                    errors.push(serde_json::json!({
                        "request_id": link.request_id,
                        "error": e.to_string(),
                    }));
                }
            }
        }

        if linked > 0 {
            emit_data_changed("request", "updated", None, None);
        }

        text_result(&serde_json::json!({
            "linked": linked,
            "errors": errors,
            "total": links.len(),
        }))
    }

    // ---- Execution ----

    #[tool(
        description = "Execute an API request by its ID. Resolves the full URL from environment.host + collection.path_prefix + request.url, interpolates {{variables}} from the active environment, merges shared headers, applies auth, and sends the HTTP request. Ensure an environment with a host URL is active before executing. Returns status, headers, body, size, and timing."
    )]
    async fn execute_request(
        &self,
        Parameters(p): Parameters<RequestIdParam>,
    ) -> Result<CallToolResult, McpError> {
        // Replicate orchestrator.rs logic without Tauri event emission
        let req = db::get_request(&p.request_id)
            .await
            .map_err(mcp_err)?
            .ok_or_else(|| mcp_err(format!("Request {} not found", p.request_id)))?;

        let mut config: http::types::RequestConfig = serde_json::from_str(&req.config)
            .map_err(|e| mcp_err(format!("Invalid config: {e}")))?;

        // Resolve collection context
        let collection = if let Some(cid) = req.collection_id.as_deref() {
            db::collections::get_collection(cid)
                .await
                .map_err(mcp_err)?
        } else {
            None
        };

        if let Some(ref col) = collection {
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

            let shared_headers: Vec<http::types::KeyValuePair> =
                serde_json::from_str(&col.shared_headers).unwrap_or_default();
            let request_header_keys: std::collections::HashSet<String> = config
                .headers
                .iter()
                .filter(|h| h.enabled && !h.key.is_empty())
                .map(|h| h.key.to_lowercase())
                .collect();
            let extra_headers: Vec<http::types::KeyValuePair> = shared_headers
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

        // Resolve environment
        // Prefer project_id from collection; fall back to request.project_id for root requests
        let project_id = collection
            .as_ref()
            .and_then(|c| c.project_id.as_deref())
            .or(req.project_id.as_deref());
        let mut env_variables = HashMap::new();
        let mut env_name: Option<String> = None;

        if let Some(pid) = project_id {
            if let Ok(Some(env)) = db::get_active_environment(pid).await {
                env_name = Some(env.name.clone());
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
                if let Ok(vars) = db::list_env_variables(&env.id).await {
                    for v in vars {
                        if v.enabled {
                            env_variables.insert(v.key, v.value);
                        }
                    }
                }
            }
        }

        let resolved_url = config.url.clone();

        // Execute
        let response = http::executor::execute(&config, &env_variables)
            .await
            .map_err(mcp_err)?;

        text_result(&serde_json::json!({
            "status": response.status,
            "status_text": response.status_text,
            "headers": response.headers,
            "body": response.body,
            "size": response.size,
            "timing": response.timing,
            "request_context": {
                "resolved_url": resolved_url,
                "method": config.method,
                "environment": env_name,
                "variables_interpolated": env_variables.keys().collect::<Vec<_>>(),
            },
        }))
    }

    // ---- Search ----

    #[tool(
        description = "Search across all API requests by name, URL, method, or config content. Use this to find existing endpoints before creating duplicates during import. Optionally filter by project ID or HTTP method. Returns matching requests with their collection and project context."
    )]
    async fn search_requests(
        &self,
        Parameters(p): Parameters<SearchParam>,
    ) -> Result<CallToolResult, McpError> {
        let limit = p.limit.unwrap_or(50);
        let conn = db::get_connection().map_err(mcp_err)?;
        let conn = conn.lock().await;

        let mut results = Vec::new();

        // Get all collections, optionally filtered by project
        let collections: Vec<db::Collection> = if let Some(ref pid) = p.project_id {
            drop(conn);
            db::list_collections(Some(pid)).await.unwrap_or_default()
        } else {
            drop(conn);
            db::list_collections(None).await.unwrap_or_default()
        };

        let projects = db::list_projects().await.unwrap_or_default();

        for col in &collections {
            let reqs = db::list_requests(&col.id).await.unwrap_or_default();
            for req in &reqs {
                let config = parse_config(&req.config);
                let method = config
                    .get("method")
                    .and_then(|v| v.as_str())
                    .unwrap_or("GET");
                let url = config.get("url").and_then(|v| v.as_str()).unwrap_or("");

                // Filter by method if specified
                if let Some(ref filter_method) = p.method {
                    if !method.eq_ignore_ascii_case(filter_method) {
                        continue;
                    }
                }

                // Match against name, URL, or config content
                let name_lower = req.name.to_lowercase();
                let url_lower = url.to_lowercase();
                let config_lower = req.config.to_lowercase();
                let query_lower = p.query.to_lowercase();

                if name_lower.contains(&query_lower)
                    || url_lower.contains(&query_lower)
                    || config_lower.contains(&query_lower)
                {
                    let project_name = col
                        .project_id
                        .as_ref()
                        .and_then(|pid| projects.iter().find(|pr| pr.id == *pid))
                        .map(|pr| pr.name.as_str());

                    results.push(serde_json::json!({
                        "id": req.id,
                        "name": req.name,
                        "method": method,
                        "url": url,
                        "collection": {
                            "id": col.id,
                            "name": col.name,
                            "path_prefix": col.path_prefix,
                        },
                        "project": {
                            "id": col.project_id,
                            "name": project_name,
                        },
                        "source_commit_id": req.source_commit_id,
                        "version": req.version,
                        "updated_at": req.updated_at,
                    }));

                    if results.len() >= limit as usize {
                        break;
                    }
                }
            }
            if results.len() >= limit as usize {
                break;
            }
        }

        text_result(&serde_json::json!({
            "results": results,
            "total": results.len(),
            "query": p.query,
        }))
    }

    // ---- Sync Status ----

    #[tool(
        description = "Get the sync status of a project imported from a git repository. Returns the project's source repository URL, project-level commit SHA, backend framework type, and per-entity commit tracking. Entities whose source_commit_id differs from the project's are flagged as potentially stale. Use after re-syncing to verify all entities are up to date."
    )]
    async fn get_sync_status(
        &self,
        Parameters(p): Parameters<SyncStatusParam>,
    ) -> Result<CallToolResult, McpError> {
        let projects = db::list_projects().await.map_err(mcp_err)?;
        let project = projects
            .iter()
            .find(|proj| proj.id == p.project_id)
            .ok_or_else(|| mcp_err(format!("Project {} not found", p.project_id)))?;

        let project_commit = project.source_commit_id.as_deref();

        let collections = db::list_collections(Some(&p.project_id))
            .await
            .map_err(mcp_err)?;

        let mut collection_status = Vec::new();
        let mut request_status = Vec::new();
        let mut stale_collections = 0usize;
        let mut stale_requests = 0usize;

        for c in &collections {
            let is_stale = match (project_commit, c.source_commit_id.as_deref()) {
                (Some(pc), Some(cc)) => pc != cc,
                (Some(_), None) => true,
                _ => false,
            };
            if is_stale {
                stale_collections += 1;
            }
            collection_status.push(serde_json::json!({
                "id": c.id,
                "name": c.name,
                "source_commit_id": c.source_commit_id,
                "is_stale": is_stale,
            }));

            let reqs = db::list_requests(&c.id).await.map_err(mcp_err)?;
            for req in &reqs {
                let req_stale = match (project_commit, req.source_commit_id.as_deref()) {
                    (Some(pc), Some(rc)) => pc != rc,
                    (Some(_), None) => true,
                    _ => false,
                };
                if req_stale {
                    stale_requests += 1;
                }
                request_status.push(serde_json::json!({
                    "id": req.id,
                    "name": req.name,
                    "collection_id": req.collection_id,
                    "source_commit_id": req.source_commit_id,
                    "is_stale": req_stale,
                }));
            }
        }

        // Also check root requests (no collection)
        let root_reqs = db::list_root_requests(&p.project_id)
            .await
            .map_err(mcp_err)?;
        for req in &root_reqs {
            let req_stale = match (project_commit, req.source_commit_id.as_deref()) {
                (Some(pc), Some(rc)) => pc != rc,
                (Some(_), None) => true,
                _ => false,
            };
            if req_stale {
                stale_requests += 1;
            }
            request_status.push(serde_json::json!({
                "id": req.id,
                "name": req.name,
                "collection_id": req.collection_id,
                "source_commit_id": req.source_commit_id,
                "is_stale": req_stale,
            }));
        }

        text_result(&serde_json::json!({
            "project": {
                "id": project.id,
                "name": project.name,
                "source_repo_url": project.source_repo_url,
                "source_commit_id": project.source_commit_id,
                "backend_type": project.backend_type,
            },
            "summary": {
                "total_collections": collection_status.len(),
                "stale_collections": stale_collections,
                "total_requests": request_status.len(),
                "stale_requests": stale_requests,
                "has_sync_metadata": project.source_repo_url.is_some() && project.source_commit_id.is_some(),
                "is_synced": project.source_repo_url.is_some() && project.source_commit_id.is_some() && stale_collections == 0 && stale_requests == 0,
            },
            "collections": collection_status,
            "requests": request_status,
        }))
    }

    // ---- Changelog ----

    #[tool(
        description = "Query the audit trail of changes. Filter by entity type (project, collection, request, environment) and/or entity ID. Returns change summaries, version numbers, JSON diffs, and timestamps."
    )]
    async fn get_changelog(
        &self,
        Parameters(p): Parameters<ChangelogParam>,
    ) -> Result<CallToolResult, McpError> {
        let entries = db::get_changelog(
            p.entity_type.as_deref(),
            p.entity_id.as_deref(),
            p.limit.unwrap_or(50),
            p.offset.unwrap_or(0),
        )
        .await
        .map_err(mcp_err)?;

        let enriched: Vec<serde_json::Value> = entries
            .iter()
            .map(|e| {
                let diff_parsed = e
                    .diff
                    .as_ref()
                    .and_then(|d| serde_json::from_str::<serde_json::Value>(d).ok());
                serde_json::json!({
                    "id": e.id,
                    "entity_type": e.entity_type,
                    "entity_id": e.entity_id,
                    "entity_name": e.entity_name,
                    "version": e.version,
                    "summary": e.summary,
                    "diff": diff_parsed,
                    "created_at": e.created_at,
                })
            })
            .collect();

        text_result(&serde_json::json!({ "entries": enriched, "total": enriched.len() }))
    }
}

// ============ ServerHandler ============

#[tool_handler]
impl ServerHandler for PiuMcp {
    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            protocol_version: ProtocolVersion::V_2025_03_26,
            capabilities: ServerCapabilities::builder().enable_tools().build(),
            server_info: Implementation {
                name: "piu-mcp".into(),
                title: Some("PIU MCP Server".into()),
                version: env!("CARGO_PKG_VERSION").into(),
                description: Some("Manage projects, collections, API requests, environments, data models, and execute HTTP calls.".into()),
                icons: None,
                website_url: None,
            },
            instructions: Some(
                "PIU is a desktop API management application (like Postman). Core concepts:\n\
                 \n\
                 - **Project**: Top-level container. Has collections, environments, requests, and data models.\n\
                 - **Collection**: Groups related API requests. Has a `path_prefix` (e.g. '/v1/users') prepended to all child request URLs.\n\
                 - **Request**: An API endpoint definition with method, URL path, headers, params, body, and auth.\n\
                 - **Environment**: Contains a `host` base URL and variables. One active per project.\n\
                 - **Data Model**: Typed schema (like a DTO/interface) with fields, used to document request/response shapes.\n\
                 \n\
                 URL Resolution: `environment.host + collection.path_prefix + request.url`\n\
                 Example: `https://api.example.com` + `/v1` + `/users/{{userId}}`\n\
                 \n\
                 Variable Interpolation: Use `{{variableName}}` in URLs, headers, params, body. Resolved from the active environment's variables.\n\
                 \n\
                 Typical workflows:\n\
                 1. **Import from repo**: create_project (with source_repo_url) → create_environment → create_collection(s) → create_request(s)\n\
                 2. **Set up environments**: create_environment → set_env_variables → set_active_environment\n\
                 3. **Test endpoints**: execute_request (resolves URL, interpolates vars, sends HTTP)\n\
                 4. **Track sync state**: get_sync_status (compare entity commit SHAs against project HEAD)\n\
                 \n\
                 Request config JSON structure: {\"method\":\"GET\",\"url\":\"/path\",\"headers\":[{\"key\":\"k\",\"value\":\"v\",\"enabled\":true}],\"params\":[...],\"body\":{\"type\":\"json\",\"content\":\"\"},\"auth\":{\"type\":\"none\"},\"description\":\"...\",\"requestModelId\":\"...\",\"responseModelId\":\"...\"}"
                    .into(),
            ),
        }
    }
}
