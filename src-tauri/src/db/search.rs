use super::{get_connection, DbResult};
use crate::db::entity_graph::parse_request_config;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};

static FTS5_AVAILABLE: AtomicBool = AtomicBool::new(false);

pub fn is_fts5_available() -> bool {
    FTS5_AVAILABLE.load(Ordering::Relaxed)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub entity_type: String,
    pub entity_id: String,
    pub name: String,
    pub description_text: String,
    pub snippet: String,
    pub relevance_score: f64,
}

const FTS5_CREATE_SQL: &str = "
    CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
        name,
        description_text,
        path,
        method,
        fields_text,
        extra,
        entity_type UNINDEXED,
        entity_id UNINDEXED,
        project_id UNINDEXED,
        tokenize='porter unicode61'
    );
";

/// Attempt to create the FTS5 virtual table. If the module is not available
/// (e.g. turso/libSQL without FTS5 compiled in), log a warning and continue.
/// Search will fall back to LIKE-based queries.
pub async fn try_create_fts_table(conn: &turso::Connection) -> DbResult<()> {
    match conn.execute(FTS5_CREATE_SQL, ()).await {
        Ok(_) => {
            FTS5_AVAILABLE.store(true, Ordering::Relaxed);
        }
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("no such module") {
                log::warn!("FTS5 module not available — search will use LIKE fallback: {msg}");
            } else {
                return Err(Box::new(e));
            }
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// FTS5 query sanitization
// ---------------------------------------------------------------------------

/// Sanitize user input for FTS5. If the query does not contain FTS5 operators,
/// wrap each word in double quotes to prevent syntax errors from special chars.
fn sanitize_fts_query(query: &str) -> String {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return "\"\"".to_string();
    }

    let fts_operators = ["+", "-", "OR", "AND", "NOT", "*", "NEAR"];
    let has_operators = fts_operators.iter().any(|op| trimmed.contains(op));

    if has_operators {
        trimmed.to_string()
    } else {
        trimmed
            .split_whitespace()
            .map(|word| {
                let escaped = word.replace('"', "\"\"");
                format!("\"{}\"", escaped)
            })
            .collect::<Vec<_>>()
            .join(" ")
    }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

pub async fn search_entities(
    query: &str,
    project_id: Option<&str>,
    entity_type: Option<&str>,
    limit: usize,
) -> DbResult<Vec<SearchResult>> {
    let sanitized = sanitize_fts_query(query);

    // Try FTS5 search first
    match fts_search(&sanitized, project_id, entity_type, limit).await {
        Ok(results) => Ok(results),
        Err(_) => {
            // Fall back to LIKE-based search on entity_descriptions
            like_search(query, project_id, entity_type, limit).await
        }
    }
}

async fn fts_search(
    sanitized_query: &str,
    project_id: Option<&str>,
    entity_type: Option<&str>,
    limit: usize,
) -> DbResult<Vec<SearchResult>> {
    let conn = get_connection()?.lock().await;

    let mut rows = conn
        .query(
            "SELECT name, description_text, entity_type, entity_id, project_id,
                    snippet(search_fts, 1, '<b>', '</b>', '...', 32) AS snippet,
                    bm25(search_fts, 10.0, 5.0, 8.0, 2.0, 3.0, 1.0) AS rank
             FROM search_fts
             WHERE search_fts MATCH ?1
               AND (?2 IS NULL OR project_id = ?2)
               AND (?3 IS NULL OR entity_type = ?3)
             ORDER BY rank
             LIMIT ?4",
            turso::params![sanitized_query, project_id, entity_type, limit as i64],
        )
        .await?;

    let mut results = Vec::new();
    while let Some(row) = rows.next().await? {
        let name: String = row.get(0)?;
        let description_text: String = row.get(1)?;
        let result_entity_type: String = row.get(2)?;
        let entity_id: String = row.get(3)?;
        let snippet: String = row.get(5)?;
        let rank: f64 = row.get(6)?;

        results.push(SearchResult {
            entity_type: result_entity_type,
            entity_id,
            name,
            description_text,
            snippet,
            relevance_score: rank,
        });
    }

    Ok(results)
}

async fn like_search(
    query: &str,
    project_id: Option<&str>,
    entity_type: Option<&str>,
    limit: usize,
) -> DbResult<Vec<SearchResult>> {
    let conn = get_connection()?.lock().await;
    let like_pattern = format!("%{}%", query.trim());

    let mut rows = conn
        .query(
            "SELECT entity_type, entity_id, description_text
             FROM entity_descriptions
             WHERE description_text LIKE ?1
               AND (?2 IS NULL OR project_id = ?2)
               AND (?3 IS NULL OR entity_type = ?3)
             LIMIT ?4",
            turso::params![like_pattern.as_str(), project_id, entity_type, limit as i64],
        )
        .await?;

    let mut results = Vec::new();
    while let Some(row) = rows.next().await? {
        let result_entity_type: String = row.get(0)?;
        let entity_id: String = row.get(1)?;
        let description_text: String = row.get(2)?;

        results.push(SearchResult {
            entity_type: result_entity_type,
            entity_id,
            name: String::new(),
            description_text,
            snippet: String::new(),
            relevance_score: 0.0,
        });
    }

    Ok(results)
}

// ---------------------------------------------------------------------------
// Full rebuild
// ---------------------------------------------------------------------------

pub async fn rebuild_search_index(project_id: &str) -> DbResult<()> {
    if !is_fts5_available() {
        return Ok(());
    }

    // Phase 1: Load all source data (acquire lock, read, release)
    let (project, collections, requests, models, environments, env_vars_map, descriptions_map) = {
        let conn = get_connection()?.lock().await;

        // Load project
        let project = {
            let mut rows = conn
                .query(
                    "SELECT id, name, description, source_repo_url FROM projects WHERE id = ?1",
                    turso::params![project_id],
                )
                .await?;
            let row = rows
                .next()
                .await?
                .ok_or_else(|| format!("Project {} not found", project_id))?;
            let id: String = row.get(0)?;
            let name: String = row.get(1)?;
            let description: Option<String> = row.get(2)?;
            let source_repo_url: Option<String> = row.get(3)?;
            drop(rows);
            (id, name, description, source_repo_url)
        };

        // Load collections
        let collections = {
            let mut rows = conn
                .query(
                    "SELECT id, name, path_prefix, description FROM collections WHERE project_id = ?1",
                    turso::params![project_id],
                )
                .await?;
            let mut cols: Vec<(String, String, Option<String>, Option<String>)> = Vec::new();
            while let Some(row) = rows.next().await? {
                cols.push((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?));
            }
            drop(rows);
            cols
        };

        // Load requests
        let requests = {
            let mut rows = conn
                .query(
                    "SELECT id, name, config FROM api_requests WHERE project_id = ?1",
                    turso::params![project_id],
                )
                .await?;
            let mut reqs: Vec<(String, String, String)> = Vec::new();
            while let Some(row) = rows.next().await? {
                reqs.push((row.get(0)?, row.get(1)?, row.get(2)?));
            }
            drop(rows);
            reqs
        };

        // Load models
        let models = {
            let mut rows = conn
                .query(
                    "SELECT id, name, description, fields FROM data_models WHERE project_id = ?1",
                    turso::params![project_id],
                )
                .await?;
            let mut mods: Vec<(String, String, Option<String>, String)> = Vec::new();
            while let Some(row) = rows.next().await? {
                mods.push((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?));
            }
            drop(rows);
            mods
        };

        // Load environments
        let environments = {
            let mut rows = conn
                .query(
                    "SELECT id, name, host FROM environments WHERE project_id = ?1",
                    turso::params![project_id],
                )
                .await?;
            let mut envs: Vec<(String, String, Option<String>)> = Vec::new();
            while let Some(row) = rows.next().await? {
                envs.push((row.get(0)?, row.get(1)?, row.get(2)?));
            }
            drop(rows);
            envs
        };

        // Load env variables per environment
        let mut env_vars_map: std::collections::HashMap<String, Vec<String>> =
            std::collections::HashMap::new();
        for (env_id, _, _) in &environments {
            let mut rows = conn
                .query(
                    "SELECT key FROM env_variables WHERE environment_id = ?1 ORDER BY key",
                    turso::params![env_id.clone()],
                )
                .await?;
            let mut keys = Vec::new();
            while let Some(row) = rows.next().await? {
                let key: String = row.get(0)?;
                keys.push(key);
            }
            drop(rows);
            env_vars_map.insert(env_id.clone(), keys);
        }

        // Load entity_descriptions for this project
        let mut descriptions_map: std::collections::HashMap<(String, String), String> =
            std::collections::HashMap::new();
        {
            let mut rows = conn
                .query(
                    "SELECT entity_type, entity_id, description_text FROM entity_descriptions WHERE project_id = ?1",
                    turso::params![project_id],
                )
                .await?;
            while let Some(row) = rows.next().await? {
                let entity_type: String = row.get(0)?;
                let entity_id: String = row.get(1)?;
                let desc_text: String = row.get(2)?;
                descriptions_map.insert((entity_type, entity_id), desc_text);
            }
            drop(rows);
        }

        (
            project,
            collections,
            requests,
            models,
            environments,
            env_vars_map,
            descriptions_map,
        )
    }; // Lock released here

    // Phase 2: Build FTS entries in memory (no lock held)

    // Each entry: (name, description_text, path, method, fields_text, extra, entity_type, entity_id)
    #[allow(clippy::type_complexity)]
    let mut entries: Vec<(
        String,
        String,
        String,
        String,
        String,
        String,
        String,
        String,
    )> = Vec::new();

    // Project entry
    {
        let (ref id, ref name, ref description, ref source_repo_url) = project;
        let desc_text = descriptions_map
            .get(&("project".to_string(), id.clone()))
            .cloned()
            .or_else(|| description.clone())
            .unwrap_or_default();
        entries.push((
            name.clone(),
            desc_text,
            String::new(),
            String::new(),
            String::new(),
            source_repo_url.clone().unwrap_or_default(),
            "project".to_string(),
            id.clone(),
        ));
    }

    // Collection entries
    for (id, name, path_prefix, description) in &collections {
        let desc_text = descriptions_map
            .get(&("collection".to_string(), id.clone()))
            .cloned()
            .unwrap_or_default();
        entries.push((
            name.clone(),
            desc_text,
            path_prefix.clone().unwrap_or_default(),
            String::new(),
            String::new(),
            description.clone().unwrap_or_default(),
            "collection".to_string(),
            id.clone(),
        ));
    }

    // Request entries
    for (id, name, config_json) in &requests {
        let config = parse_request_config(config_json);
        let method = config
            .get("method")
            .and_then(|v| v.as_str())
            .unwrap_or("GET")
            .to_uppercase();
        let url = config
            .get("url")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        // Extract body content for extra field
        let body_content = config
            .get("body")
            .and_then(|b| b.get("content"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let desc_text = descriptions_map
            .get(&("request".to_string(), id.clone()))
            .cloned()
            .unwrap_or_default();

        entries.push((
            name.clone(),
            desc_text,
            url,
            method,
            String::new(),
            body_content,
            "request".to_string(),
            id.clone(),
        ));
    }

    // Model entries
    for (id, name, _description, fields_json) in &models {
        let fields: Vec<serde_json::Value> = serde_json::from_str(fields_json).unwrap_or_default();

        let field_names: String = fields
            .iter()
            .filter_map(|f| f.get("name").and_then(|v| v.as_str()))
            .collect::<Vec<&str>>()
            .join(" ");

        let field_types: String = fields
            .iter()
            .filter_map(|f| f.get("field_type").and_then(|v| v.as_str()))
            .collect::<Vec<&str>>()
            .join(" ");

        let desc_text = descriptions_map
            .get(&("model".to_string(), id.clone()))
            .cloned()
            .unwrap_or_default();

        entries.push((
            name.clone(),
            desc_text,
            String::new(),
            String::new(),
            field_names,
            field_types,
            "model".to_string(),
            id.clone(),
        ));
    }

    // Environment entries
    for (id, name, host) in &environments {
        let empty_keys: Vec<String> = Vec::new();
        let keys = env_vars_map.get(id).unwrap_or(&empty_keys);
        let variable_keys = keys.join(" ");

        let desc_text = descriptions_map
            .get(&("environment".to_string(), id.clone()))
            .cloned()
            .unwrap_or_default();

        entries.push((
            name.clone(),
            desc_text,
            host.clone().unwrap_or_default(),
            String::new(),
            String::new(),
            variable_keys,
            "environment".to_string(),
            id.clone(),
        ));
    }

    // Phase 3: Write to FTS in a transaction (re-acquire lock)
    {
        let conn = get_connection()?.lock().await;
        conn.execute("BEGIN", ()).await?;

        let result: Result<(), Box<dyn std::error::Error + Send + Sync>> = async {
            // Delete existing entries for this project
            conn.execute(
                "DELETE FROM search_fts WHERE project_id = ?1",
                turso::params![project_id],
            )
            .await?;

            // Insert all entries
            for (name, desc_text, path, method, fields_text, extra, entity_type, entity_id) in
                &entries
            {
                conn.execute(
                    "INSERT INTO search_fts (name, description_text, path, method, fields_text, extra, entity_type, entity_id, project_id)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                    turso::params![
                        name.as_str(),
                        desc_text.as_str(),
                        path.as_str(),
                        method.as_str(),
                        fields_text.as_str(),
                        extra.as_str(),
                        entity_type.as_str(),
                        entity_id.as_str(),
                        project_id
                    ],
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
// Incremental update
// ---------------------------------------------------------------------------

pub async fn update_search_entry(
    entity_type: &str,
    entity_id: &str,
    project_id: &str,
) -> DbResult<()> {
    if !is_fts5_available() {
        return Ok(());
    }

    // Delete existing entry first
    delete_search_entry(entity_type, entity_id).await?;

    // Load fresh data and re-insert based on entity type
    let entry = load_single_entry(entity_type, entity_id, project_id).await?;

    if let Some((name, desc_text, path, method, fields_text, extra)) = entry {
        let conn = get_connection()?.lock().await;
        conn.execute(
            "INSERT INTO search_fts (name, description_text, path, method, fields_text, extra, entity_type, entity_id, project_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            turso::params![
                name.as_str(),
                desc_text.as_str(),
                path.as_str(),
                method.as_str(),
                fields_text.as_str(),
                extra.as_str(),
                entity_type,
                entity_id,
                project_id
            ],
        )
        .await?;
    }

    Ok(())
}

/// Load a single entity's search data from the source tables.
async fn load_single_entry(
    entity_type: &str,
    entity_id: &str,
    _project_id: &str,
) -> DbResult<Option<(String, String, String, String, String, String)>> {
    // Load the description text from entity_descriptions
    let desc_text = {
        let conn = get_connection()?.lock().await;
        let mut rows = conn
            .query(
                "SELECT description_text FROM entity_descriptions WHERE entity_type = ?1 AND entity_id = ?2",
                turso::params![entity_type, entity_id],
            )
            .await?;
        let desc = if let Some(row) = rows.next().await? {
            row.get::<String>(0)?
        } else {
            String::new()
        };
        drop(rows);
        desc
    };

    match entity_type {
        "project" => {
            let conn = get_connection()?.lock().await;
            let mut rows = conn
                .query(
                    "SELECT name, source_repo_url FROM projects WHERE id = ?1",
                    turso::params![entity_id],
                )
                .await?;
            if let Some(row) = rows.next().await? {
                let name: String = row.get(0)?;
                let source_repo_url: Option<String> = row.get(1)?;
                drop(rows);
                Ok(Some((
                    name,
                    desc_text,
                    String::new(),
                    String::new(),
                    String::new(),
                    source_repo_url.unwrap_or_default(),
                )))
            } else {
                drop(rows);
                Ok(None)
            }
        }
        "collection" => {
            let conn = get_connection()?.lock().await;
            let mut rows = conn
                .query(
                    "SELECT name, path_prefix, description FROM collections WHERE id = ?1",
                    turso::params![entity_id],
                )
                .await?;
            if let Some(row) = rows.next().await? {
                let name: String = row.get(0)?;
                let path_prefix: Option<String> = row.get(1)?;
                let description: Option<String> = row.get(2)?;
                drop(rows);
                Ok(Some((
                    name,
                    desc_text,
                    path_prefix.unwrap_or_default(),
                    String::new(),
                    String::new(),
                    description.unwrap_or_default(),
                )))
            } else {
                drop(rows);
                Ok(None)
            }
        }
        "request" => {
            let conn = get_connection()?.lock().await;
            let mut rows = conn
                .query(
                    "SELECT name, config FROM api_requests WHERE id = ?1",
                    turso::params![entity_id],
                )
                .await?;
            if let Some(row) = rows.next().await? {
                let name: String = row.get(0)?;
                let config_json: String = row.get(1)?;
                drop(rows);

                let config = parse_request_config(&config_json);
                let method = config
                    .get("method")
                    .and_then(|v| v.as_str())
                    .unwrap_or("GET")
                    .to_uppercase();
                let url = config
                    .get("url")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let body_content = config
                    .get("body")
                    .and_then(|b| b.get("content"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                Ok(Some((
                    name,
                    desc_text,
                    url,
                    method,
                    String::new(),
                    body_content,
                )))
            } else {
                drop(rows);
                Ok(None)
            }
        }
        "model" => {
            let conn = get_connection()?.lock().await;
            let mut rows = conn
                .query(
                    "SELECT name, fields FROM data_models WHERE id = ?1",
                    turso::params![entity_id],
                )
                .await?;
            if let Some(row) = rows.next().await? {
                let name: String = row.get(0)?;
                let fields_json: String = row.get(1)?;
                drop(rows);

                let fields: Vec<serde_json::Value> =
                    serde_json::from_str(&fields_json).unwrap_or_default();

                let field_names: String = fields
                    .iter()
                    .filter_map(|f| f.get("name").and_then(|v| v.as_str()))
                    .collect::<Vec<&str>>()
                    .join(" ");

                let field_types: String = fields
                    .iter()
                    .filter_map(|f| f.get("field_type").and_then(|v| v.as_str()))
                    .collect::<Vec<&str>>()
                    .join(" ");

                Ok(Some((
                    name,
                    desc_text,
                    String::new(),
                    String::new(),
                    field_names,
                    field_types,
                )))
            } else {
                drop(rows);
                Ok(None)
            }
        }
        "environment" => {
            let conn = get_connection()?.lock().await;
            let mut rows = conn
                .query(
                    "SELECT name, host FROM environments WHERE id = ?1",
                    turso::params![entity_id],
                )
                .await?;
            if let Some(row) = rows.next().await? {
                let name: String = row.get(0)?;
                let host: Option<String> = row.get(1)?;
                drop(rows);
                drop(conn);

                // Load variable keys
                let variable_keys = {
                    let conn2 = get_connection()?.lock().await;
                    let mut var_rows = conn2
                        .query(
                            "SELECT key FROM env_variables WHERE environment_id = ?1 ORDER BY key",
                            turso::params![entity_id],
                        )
                        .await?;
                    let mut keys = Vec::new();
                    while let Some(var_row) = var_rows.next().await? {
                        let key: String = var_row.get(0)?;
                        keys.push(key);
                    }
                    drop(var_rows);
                    keys.join(" ")
                };

                Ok(Some((
                    name,
                    desc_text,
                    host.unwrap_or_default(),
                    String::new(),
                    String::new(),
                    variable_keys,
                )))
            } else {
                drop(rows);
                Ok(None)
            }
        }
        _ => Ok(None),
    }
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

pub async fn delete_search_entry(entity_type: &str, entity_id: &str) -> DbResult<()> {
    let conn = get_connection()?.lock().await;

    // FTS5 delete requires matching the rowid or all indexed+unindexed columns.
    // Safest approach: delete by matching entity_type and entity_id.
    // FTS table might not exist yet; silently ignore errors.
    let _ = conn
        .execute(
            "DELETE FROM search_fts WHERE entity_type = ?1 AND entity_id = ?2",
            turso::params![entity_type, entity_id],
        )
        .await;

    Ok(())
}
