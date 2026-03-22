use super::{get_connection, DbResult};
use crate::db::{
    collections::Collection, environments::Environment, models::DataModel, projects::Project,
    requests::ApiRequest,
};
use std::collections::HashMap;

pub fn get_table_sql() -> &'static str {
    "
    CREATE TABLE IF NOT EXISTS entity_descriptions (
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        description_text TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (entity_type, entity_id)
    );
    CREATE INDEX IF NOT EXISTS idx_descriptions_project ON entity_descriptions(project_id);
    "
}

// ---------------------------------------------------------------------------
// JSON parsing helpers (same patterns as graph_commands.rs)
// ---------------------------------------------------------------------------

fn parse_request_config(config_json: &str) -> serde_json::Value {
    serde_json::from_str(config_json).unwrap_or_else(|_| {
        serde_json::json!({
            "method": "GET",
            "url": "",
        })
    })
}

fn parse_fields_json(fields_json: &str) -> Vec<serde_json::Value> {
    serde_json::from_str::<Vec<serde_json::Value>>(fields_json).unwrap_or_default()
}

fn parse_mixin_ids(json: &str) -> Vec<String> {
    serde_json::from_str::<Vec<serde_json::Value>>(json)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|v| v.as_str().map(String::from))
        .collect()
}

// ---------------------------------------------------------------------------
// Description generators
// ---------------------------------------------------------------------------

pub fn describe_request(
    req: &ApiRequest,
    collection_path: &str,
    model_names: &HashMap<String, String>,
) -> String {
    let config = parse_request_config(&req.config);

    let method = config
        .get("method")
        .and_then(|v| v.as_str())
        .unwrap_or("GET")
        .to_uppercase();

    let url = config.get("url").and_then(|v| v.as_str()).unwrap_or("");

    let full_path = if collection_path.is_empty() {
        url.to_string()
    } else {
        format!("{}{}", collection_path, url)
    };

    // Check if config was essentially unparseable (no method key in original)
    if config.get("method").is_none() && config.get("url").is_none() {
        return format!("{} request (unparseable config)", method);
    }

    let mut parts: Vec<String> = Vec::new();
    parts.push(format!("{} {}", method, full_path));

    // Body type
    if let Some(body_type) = config
        .get("body")
        .and_then(|b| b.get("type"))
        .and_then(|v| v.as_str())
    {
        if body_type != "none" {
            parts.push(format!("with {} body", body_type.to_uppercase()));
        }
    }

    // Auth type
    if let Some(auth_type) = config
        .get("auth")
        .and_then(|a| a.get("type"))
        .and_then(|v| v.as_str())
    {
        if auth_type != "none" {
            parts.push(format!("{} auth", capitalize(auth_type)));
        }
    }

    // Header count
    let header_count = config
        .get("headers")
        .and_then(|v| v.as_array())
        .map(|a| a.len())
        .unwrap_or(0);
    if header_count > 0 {
        parts.push(format!(
            "{} header{}",
            header_count,
            if header_count == 1 { "" } else { "s" }
        ));
    }

    // Param count
    let param_count = config
        .get("params")
        .and_then(|v| v.as_array())
        .map(|a| a.len())
        .unwrap_or(0);
    if param_count > 0 {
        parts.push(format!(
            "{} param{}",
            param_count,
            if param_count == 1 { "" } else { "s" }
        ));
    }

    // Request/Response model references
    if let Some(req_model_id) = config.get("requestModelId").and_then(|v| v.as_str()) {
        if let Some(name) = model_names.get(req_model_id) {
            parts.push(format!("sends {}", name));
        }
    }
    if let Some(resp_model_id) = config.get("responseModelId").and_then(|v| v.as_str()) {
        if let Some(name) = model_names.get(resp_model_id) {
            parts.push(format!("returns {}", name));
        }
    }

    parts.join(", ")
}

pub fn describe_model(model: &DataModel, parent_name: Option<&str>) -> String {
    let fields = parse_fields_json(&model.fields);
    let total_fields = fields.len();

    let required_count = fields
        .iter()
        .filter(|f| f.get("required").and_then(|v| v.as_bool()).unwrap_or(false))
        .count();

    let ref_count = fields
        .iter()
        .filter(|f| {
            f.get("ref_model_id")
                .map(|v| v.is_string())
                .unwrap_or(false)
        })
        .count();

    let field_names: Vec<&str> = fields
        .iter()
        .filter_map(|f| f.get("name").and_then(|v| v.as_str()))
        .collect();

    let mixin_ids = parse_mixin_ids(&model.mixin_model_ids);

    let mut parts: Vec<String> = Vec::new();

    // Core info
    parts.push(format!(
        "Data model with {} field{} ({} required)",
        total_fields,
        if total_fields == 1 { "" } else { "s" },
        required_count,
    ));

    // Inheritance
    if let Some(parent) = parent_name {
        parts.push(format!("inherits from {}", parent));
    }

    // References
    if ref_count > 0 {
        parts.push(format!(
            "{} field reference{}",
            ref_count,
            if ref_count == 1 { "" } else { "s" }
        ));
    }

    // Mixin count
    if !mixin_ids.is_empty() {
        parts.push(format!(
            "{} mixin{}",
            mixin_ids.len(),
            if mixin_ids.len() == 1 { "" } else { "s" }
        ));
    }

    // Field names (up to 5)
    if !field_names.is_empty() {
        let display_names: Vec<&str> = field_names.iter().take(5).copied().collect();
        let suffix = if field_names.len() > 5 {
            format!(" (+{} more)", field_names.len() - 5)
        } else {
            String::new()
        };
        parts.push(format!("Fields: {}{}", display_names.join(", "), suffix));
    }

    parts.join(". ")
}

pub fn describe_collection(
    col: &Collection,
    method_counts: &HashMap<String, usize>,
    total_requests: usize,
) -> String {
    let mut parts: Vec<String> = Vec::new();

    // Path prefix
    let path_str = col
        .path_prefix
        .as_deref()
        .filter(|p| !p.is_empty())
        .map(|p| format!(" {}", p))
        .unwrap_or_default();

    // Method breakdown
    let method_breakdown: Vec<String> = {
        let mut sorted: Vec<(&String, &usize)> = method_counts.iter().collect();
        sorted.sort_by(|a, b| b.1.cmp(a.1));
        sorted.iter().map(|(m, c)| format!("{} {}", c, m)).collect()
    };

    let methods_str = if method_breakdown.is_empty() {
        String::new()
    } else {
        format!(" ({})", method_breakdown.join(", "))
    };

    parts.push(format!(
        "API collection{} with {} endpoint{}{}",
        path_str,
        total_requests,
        if total_requests == 1 { "" } else { "s" },
        methods_str,
    ));

    // Description
    if let Some(ref desc) = col.description {
        if !desc.is_empty() {
            parts.push(desc.clone());
        }
    }

    parts.join(". ")
}

pub fn describe_environment(env: &Environment, variable_keys: &[String]) -> String {
    let mut parts: Vec<String> = Vec::new();

    // Name and host
    let host_str = env
        .host
        .as_deref()
        .filter(|h| !h.is_empty())
        .map(|h| format!(" at {}", h))
        .unwrap_or_default();

    // Variable summary
    let var_count = variable_keys.len();
    let var_preview: Vec<&str> = variable_keys.iter().take(5).map(|s| s.as_str()).collect();
    let var_suffix = if var_count > 5 {
        format!(" (+{} more)", var_count - 5)
    } else {
        String::new()
    };

    if var_count > 0 {
        parts.push(format!(
            "{} environment{} with {} variable{} ({}{})",
            env.name,
            host_str,
            var_count,
            if var_count == 1 { "" } else { "s" },
            var_preview.join(", "),
            var_suffix,
        ));
    } else {
        parts.push(format!(
            "{} environment{} with no variables",
            env.name, host_str,
        ));
    }

    parts.join(". ")
}

#[allow(clippy::too_many_arguments)]
pub fn describe_project(
    project: &Project,
    collection_count: usize,
    request_count: usize,
    model_count: usize,
    env_count: usize,
    method_counts: &HashMap<String, usize>,
    top_collections: &[String],
) -> String {
    let mut parts: Vec<String> = Vec::new();

    // Name and description
    let desc_str = project
        .description
        .as_deref()
        .filter(|d| !d.is_empty())
        .map(|d| format!(": {}", d))
        .unwrap_or_default();

    parts.push(format!(
        "{} project{} -- {} collection{}, {} endpoint{}, {} model{}, {} environment{}",
        project.name,
        desc_str,
        collection_count,
        if collection_count == 1 { "" } else { "s" },
        request_count,
        if request_count == 1 { "" } else { "s" },
        model_count,
        if model_count == 1 { "" } else { "s" },
        env_count,
        if env_count == 1 { "" } else { "s" },
    ));

    // Method breakdown
    if !method_counts.is_empty() {
        let mut sorted: Vec<(&String, &usize)> = method_counts.iter().collect();
        sorted.sort_by(|a, b| b.1.cmp(a.1));
        let method_strs: Vec<String> = sorted.iter().map(|(m, c)| format!("{} {}", c, m)).collect();
        parts.push(format!("Methods: {}", method_strs.join(", ")));
    }

    // Top collections
    if !top_collections.is_empty() {
        parts.push(format!("Sections: {}", top_collections.join(", ")));
    }

    parts.join(". ")
}

// ---------------------------------------------------------------------------
// Rebuild function
// ---------------------------------------------------------------------------

pub async fn rebuild_project_descriptions(project_id: &str) -> DbResult<()> {
    // Phase 1: Load all source data (acquire lock, read, release)
    let (project, collections, all_requests, models, environments, env_vars_map) = {
        let conn = get_connection()?.lock().await;

        // Load project
        let project = {
            let mut rows = conn
                .query(
                    "SELECT id, name, description, sort_order, version, created_at, updated_at, source_repo_url, source_commit_id, backend_type FROM projects WHERE id = ?1",
                    turso::params![project_id],
                )
                .await?;
            let row = rows
                .next()
                .await?
                .ok_or_else(|| format!("Project {} not found", project_id))?;
            let p = Project {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                sort_order: row.get(3)?,
                version: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
                source_repo_url: row.get(7)?,
                source_commit_id: row.get(8)?,
                backend_type: row.get(9)?,
            };
            drop(rows);
            p
        };

        // Load collections
        let collections = {
            let mut rows = conn
                .query(
                    "SELECT id, name, parent_id, sort_order, path_prefix, description, shared_headers, project_id, version, created_at, updated_at, source_commit_id FROM collections WHERE project_id = ?1 ORDER BY sort_order, name",
                    turso::params![project_id],
                )
                .await?;
            let mut cols = Vec::new();
            while let Some(row) = rows.next().await? {
                cols.push(Collection {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    parent_id: row.get(2)?,
                    sort_order: row.get(3)?,
                    path_prefix: row.get(4)?,
                    description: row.get(5)?,
                    shared_headers: row
                        .get::<Option<String>>(6)?
                        .unwrap_or_else(|| "[]".to_string()),
                    project_id: row.get(7)?,
                    version: row.get(8)?,
                    created_at: row.get(9)?,
                    updated_at: row.get(10)?,
                    source_commit_id: row.get(11)?,
                });
            }
            drop(rows);
            cols
        };

        // Load all requests for project
        let all_requests = {
            let mut rows = conn
                .query(
                    "SELECT id, collection_id, project_id, name, sort_order, config, version, created_at, updated_at, source_commit_id FROM api_requests WHERE project_id = ?1 ORDER BY sort_order, name",
                    turso::params![project_id],
                )
                .await?;
            let mut reqs = Vec::new();
            while let Some(row) = rows.next().await? {
                reqs.push(ApiRequest {
                    id: row.get(0)?,
                    collection_id: row.get::<Option<String>>(1)?,
                    project_id: row.get::<Option<String>>(2)?,
                    name: row.get(3)?,
                    sort_order: row.get(4)?,
                    config: row.get(5)?,
                    version: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                    source_commit_id: row.get::<Option<String>>(9)?,
                });
            }
            drop(rows);
            reqs
        };

        // Load models
        let models = {
            let mut rows = conn
                .query(
                    "SELECT id, project_id, name, description, fields, sort_order, version, created_at, updated_at, parent_model_id, mixin_model_ids FROM data_models WHERE project_id = ?1 ORDER BY sort_order, name",
                    turso::params![project_id],
                )
                .await?;
            let mut mods = Vec::new();
            while let Some(row) = rows.next().await? {
                mods.push(DataModel {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    name: row.get(2)?,
                    description: row.get(3)?,
                    fields: row.get(4)?,
                    sort_order: row.get(5)?,
                    version: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                    parent_model_id: row.get(9)?,
                    mixin_model_ids: row.get(10)?,
                });
            }
            drop(rows);
            mods
        };

        // Load environments
        let environments = {
            let mut rows = conn
                .query(
                    "SELECT id, name, is_active, sort_order, project_id, host, version, created_at, updated_at FROM environments WHERE project_id = ?1 ORDER BY sort_order, name",
                    turso::params![project_id],
                )
                .await?;
            let mut envs = Vec::new();
            while let Some(row) = rows.next().await? {
                envs.push(Environment {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    is_active: row.get(2)?,
                    sort_order: row.get(3)?,
                    project_id: row.get(4)?,
                    host: row.get(5)?,
                    version: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                });
            }
            drop(rows);
            envs
        };

        // Load env variables for all environments in project
        let mut env_vars_map: HashMap<String, Vec<String>> = HashMap::new();
        for env in &environments {
            let mut rows = conn
                .query(
                    "SELECT key FROM env_variables WHERE environment_id = ?1 ORDER BY key",
                    turso::params![env.id.clone()],
                )
                .await?;
            let mut keys = Vec::new();
            while let Some(row) = rows.next().await? {
                let key: String = row.get(0)?;
                keys.push(key);
            }
            drop(rows);
            env_vars_map.insert(env.id.clone(), keys);
        }

        (
            project,
            collections,
            all_requests,
            models,
            environments,
            env_vars_map,
        )
    }; // Lock released here

    // Phase 2: Compute descriptions in memory (no lock held)

    let now = chrono::Utc::now().timestamp_millis();

    // Build lookup maps
    let model_names: HashMap<String, String> = models
        .iter()
        .map(|m| (m.id.clone(), m.name.clone()))
        .collect();

    let collection_paths: HashMap<String, String> = collections
        .iter()
        .map(|c| {
            (
                c.id.clone(),
                c.path_prefix.as_deref().unwrap_or("").to_string(),
            )
        })
        .collect();

    // Method counts per collection
    let mut method_counts_per_collection: HashMap<String, HashMap<String, usize>> = HashMap::new();
    let mut requests_per_collection: HashMap<String, usize> = HashMap::new();
    let mut project_method_counts: HashMap<String, usize> = HashMap::new();

    for req in &all_requests {
        let config = parse_request_config(&req.config);
        let method = config
            .get("method")
            .and_then(|v| v.as_str())
            .unwrap_or("GET")
            .to_uppercase();

        *project_method_counts.entry(method.clone()).or_insert(0) += 1;

        if let Some(ref col_id) = req.collection_id {
            *method_counts_per_collection
                .entry(col_id.clone())
                .or_default()
                .entry(method)
                .or_insert(0) += 1;
            *requests_per_collection.entry(col_id.clone()).or_insert(0) += 1;
        }
    }

    // Collect all description rows
    let mut descriptions: Vec<(String, String, String)> = Vec::new(); // (entity_type, entity_id, description_text)

    // Request descriptions
    for req in &all_requests {
        let col_path = req
            .collection_id
            .as_deref()
            .and_then(|cid| collection_paths.get(cid))
            .map(|s| s.as_str())
            .unwrap_or("");
        let desc = describe_request(req, col_path, &model_names);
        descriptions.push(("request".to_string(), req.id.clone(), desc));
    }

    // Model descriptions
    for model in &models {
        let parent_name = model
            .parent_model_id
            .as_deref()
            .and_then(|pid| model_names.get(pid))
            .map(|s| s.as_str());
        let desc = describe_model(model, parent_name);
        descriptions.push(("model".to_string(), model.id.clone(), desc));
    }

    // Collection descriptions
    for col in &collections {
        let empty_methods = HashMap::new();
        let col_methods = method_counts_per_collection
            .get(&col.id)
            .unwrap_or(&empty_methods);
        let total = *requests_per_collection.get(&col.id).unwrap_or(&0);
        let desc = describe_collection(col, col_methods, total);
        descriptions.push(("collection".to_string(), col.id.clone(), desc));
    }

    // Environment descriptions
    for env in &environments {
        let empty_keys: Vec<String> = Vec::new();
        let keys = env_vars_map.get(&env.id).unwrap_or(&empty_keys);
        let desc = describe_environment(env, keys);
        descriptions.push(("environment".to_string(), env.id.clone(), desc));
    }

    // Project description
    let top_collections: Vec<String> = collections
        .iter()
        .filter(|c| c.parent_id.is_none())
        .take(10)
        .map(|c| c.name.clone())
        .collect();

    let project_desc = describe_project(
        &project,
        collections.len(),
        all_requests.len(),
        models.len(),
        environments.len(),
        &project_method_counts,
        &top_collections,
    );
    descriptions.push(("project".to_string(), project.id.clone(), project_desc));

    // Phase 3: Write descriptions in a transaction (re-acquire lock)
    {
        let conn = get_connection()?.lock().await;
        conn.execute("BEGIN", ()).await?;

        let result: Result<(), Box<dyn std::error::Error + Send + Sync>> = async {
            // Delete existing descriptions for this project
            conn.execute(
                "DELETE FROM entity_descriptions WHERE project_id = ?1",
                turso::params![project_id],
            )
            .await?;

            // Batch insert all descriptions
            for (entity_type, entity_id, description_text) in &descriptions {
                conn.execute(
                    "INSERT INTO entity_descriptions (entity_type, entity_id, project_id, description_text, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                    turso::params![entity_type.as_str(), entity_id.as_str(), project_id, description_text.as_str(), now],
                )
                .await?;
            }

            Ok(())
        }
        .await;

        match result {
            Ok(()) => {
                conn.execute("COMMIT", ()).await?;
            }
            Err(e) => {
                let _ = conn.execute("ROLLBACK", ()).await;
                return Err(e);
            }
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn capitalize(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        None => String::new(),
        Some(c) => c.to_uppercase().collect::<String>() + chars.as_str(),
    }
}
