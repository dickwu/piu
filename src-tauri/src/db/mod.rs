use std::path::Path;
use std::sync::OnceLock;
use tokio::sync::Mutex;
use turso::{Builder, Connection};

// Wrap Connection in Mutex to serialize database access
// turso 0.4.0 has race conditions in its page cache when accessed concurrently
static DB_CONNECTION: OnceLock<Mutex<Connection>> = OnceLock::new();

pub type DbResult<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

pub mod app_state;
pub mod changelog;
pub mod collections;
pub mod descriptions;
pub mod entity_graph;
pub mod environments;
pub mod graph;
pub mod hooks;
pub mod models;
pub mod projects;
pub mod relations;
pub mod requests;
pub mod search;
pub mod specs;

// Re-export types
pub use changelog::ChangelogEntry;
pub use collections::Collection;
pub use environments::{EnvVariable, EnvVariableTuple, Environment};
pub use hooks::{EnvHook, EnvHookTarget};
pub use models::DataModel;
pub use projects::Project;
pub use requests::ApiRequest;

// ============ Connection and Initialization ============

pub fn get_connection() -> DbResult<&'static Mutex<Connection>> {
    DB_CONNECTION
        .get()
        .ok_or_else(|| "Database not initialized".into())
}

pub async fn init_db(db_path: &Path) -> DbResult<()> {
    let db = Builder::new_local(db_path.to_str().unwrap())
        .build()
        .await?;
    let conn = db.connect()?;

    conn.execute("PRAGMA foreign_keys = ON;", ()).await?;

    conn.execute_batch(&format!(
        "{}{}{}{}{}{}{}{}{}{}{}{}",
        projects::get_table_sql(),
        collections::get_table_sql(),
        requests::get_table_sql(),
        environments::get_table_sql(),
        hooks::get_table_sql(),
        changelog::get_table_sql(),
        app_state::get_table_sql(),
        models::get_table_sql(),
        graph::get_table_sql(),
        specs::get_table_sql(),
        descriptions::get_table_sql(),
        relations::get_table_sql(),
    ))
    .await?;

    // FTS5 virtual table — try separately since the module may not be compiled
    // into the bundled libSQL. Search falls back to LIKE queries if unavailable.
    search::try_create_fts_table(&conn).await?;

    // Run migrations for existing databases
    run_migrations(&conn).await?;

    DB_CONNECTION
        .set(Mutex::new(conn))
        .map_err(|_| "Database already initialized")?;

    Ok(())
}

async fn run_migrations(conn: &Connection) -> DbResult<()> {
    // Migration 1: Add collection settings columns
    // Migration 2: Add project_id to collections/environments, add host to environments
    let alter_migrations = [
        "ALTER TABLE collections ADD COLUMN path_prefix TEXT DEFAULT NULL",
        "ALTER TABLE collections ADD COLUMN description TEXT DEFAULT NULL",
        "ALTER TABLE collections ADD COLUMN shared_headers TEXT NOT NULL DEFAULT '[]'",
        "ALTER TABLE collections ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE CASCADE",
        "ALTER TABLE environments ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE CASCADE",
        "ALTER TABLE environments ADD COLUMN host TEXT DEFAULT NULL",
        "ALTER TABLE data_models ADD COLUMN parent_model_id TEXT DEFAULT NULL",
        "ALTER TABLE data_models ADD COLUMN mixin_model_ids TEXT NOT NULL DEFAULT '[]'",
        "ALTER TABLE projects ADD COLUMN source_repo_url TEXT DEFAULT NULL",
        "ALTER TABLE projects ADD COLUMN source_commit_id TEXT DEFAULT NULL",
        "ALTER TABLE projects ADD COLUMN backend_type TEXT DEFAULT NULL",
        "ALTER TABLE collections ADD COLUMN source_commit_id TEXT DEFAULT NULL",
        "ALTER TABLE api_requests ADD COLUMN source_commit_id TEXT DEFAULT NULL",
        // Migration: env_variables targeted variable columns
        "ALTER TABLE env_variables ADD COLUMN match_paths TEXT NOT NULL DEFAULT '[\"*\"]'",
        "ALTER TABLE env_variables ADD COLUMN target_location TEXT NOT NULL DEFAULT 'url-path'",
        "ALTER TABLE env_variables ADD COLUMN expires_at INTEGER",
        "ALTER TABLE env_variables ADD COLUMN priority INTEGER NOT NULL DEFAULT 0",
    ];
    for sql in &alter_migrations {
        if let Err(e) = conn.execute(sql, ()).await {
            let msg = e.to_string();
            if !msg.contains("duplicate column") {
                return Err(Box::new(e));
            }
        }
    }

    // Create indexes (idempotent via IF NOT EXISTS)
    let index_migrations = [
        "CREATE INDEX IF NOT EXISTS idx_collections_project ON collections(project_id)",
        "CREATE INDEX IF NOT EXISTS idx_environments_project ON environments(project_id)",
    ];
    for sql in &index_migrations {
        conn.execute(sql, ()).await?;
    }

    // Data migration: assign orphan collections and environments to a default project
    migrate_orphans_to_default_project(conn).await?;

    // Data migration: add project_id column to api_requests (must run after orphan migration
    // so that projects exist for the backfill)
    migrate_requests_schema(conn).await?;

    // Ensure project_id index exists (created by migration for existing DBs,
    // needed here for new DBs where get_table_sql doesn't include it)
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_requests_project ON api_requests(project_id)",
        (),
    )
    .await?;

    // Data migration: classify existing env_variables target_location based on
    // where their {{key}} pattern actually appears in request configs.
    migrate_variable_target_locations(conn).await?;

    Ok(())
}

/// One-time data migration: scan request configs to classify where each
/// env_variable's `{{key}}` is actually used, then update `target_location`
/// from the default `url-path` to a more specific location.
///
/// Only runs for variables that still have the initial defaults
/// (`match_paths = '["*"]'` AND `target_location = 'url-path'`).
async fn migrate_variable_target_locations(conn: &Connection) -> DbResult<()> {
    // Check if migration is needed: any variables with default match_paths + target_location
    let mut rows = conn
        .query(
            "SELECT COUNT(*) FROM env_variables WHERE match_paths = '[\"*\"]' AND target_location = 'url-path'",
            (),
        )
        .await?;
    let count: i64 = if let Some(row) = rows.next().await? {
        row.get(0)?
    } else {
        0
    };
    drop(rows);

    if count == 0 {
        return Ok(());
    }

    // Load all request configs (we only need the JSON config column)
    let mut config_rows = conn.query("SELECT config FROM api_requests", ()).await?;
    let mut all_configs: Vec<String> = Vec::new();
    while let Some(row) = config_rows.next().await? {
        let config: String = row.get(0)?;
        all_configs.push(config);
    }
    drop(config_rows);

    // Load candidate variables
    let mut var_rows = conn
        .query(
            "SELECT id, key FROM env_variables WHERE match_paths = '[\"*\"]' AND target_location = 'url-path'",
            (),
        )
        .await?;
    let mut candidates: Vec<(String, String)> = Vec::new();
    while let Some(row) = var_rows.next().await? {
        let id: String = row.get(0)?;
        let key: String = row.get(1)?;
        candidates.push((id, key));
    }
    drop(var_rows);

    // For each candidate variable, scan all configs to classify its location
    for (var_id, var_key) in &candidates {
        let pattern = format!("{{{{{}}}}}", var_key); // produces {{key}}
        let location = classify_variable_location(&pattern, &all_configs);

        if location != "url-path" {
            conn.execute(
                "UPDATE env_variables SET target_location = ?1 WHERE id = ?2",
                turso::params![location, var_id.clone()],
            )
            .await?;
        }
    }

    Ok(())
}

/// Scan all request config JSON strings to determine where a `{{key}}` pattern
/// is used. Returns one of: `header`, `auth-bearer`, `auth-basic-username`,
/// `auth-basic-password`, `auth-custom`, `url-param`, `body`, `url-path`.
///
/// If the pattern appears in multiple distinct locations, returns `url-path`
/// as the safe default (the simplest migration strategy).
fn classify_variable_location(pattern: &str, configs: &[String]) -> String {
    let mut found_in_header = false;
    let mut found_in_auth = false;
    let mut found_in_param = false;
    let mut found_in_body = false;
    let mut found_in_url = false;
    let mut auth_type = String::new();

    for config_json in configs {
        // Parse just enough structure to classify. If parsing fails, skip.
        let parsed: serde_json::Value = match serde_json::from_str(config_json) {
            Ok(v) => v,
            Err(_) => continue,
        };

        // Check URL
        if let Some(url) = parsed.get("url").and_then(|v| v.as_str()) {
            if url.contains(pattern) {
                found_in_url = true;
            }
        }

        // Check headers
        if let Some(headers) = parsed.get("headers").and_then(|v| v.as_array()) {
            for h in headers {
                let val = h.get("value").and_then(|v| v.as_str()).unwrap_or("");
                if val.contains(pattern) {
                    found_in_header = true;
                }
            }
        }

        // Check params
        if let Some(params) = parsed.get("params").and_then(|v| v.as_array()) {
            for p in params {
                let val = p.get("value").and_then(|v| v.as_str()).unwrap_or("");
                if val.contains(pattern) {
                    found_in_param = true;
                }
            }
        }

        // Check body
        if let Some(body) = parsed.get("body") {
            let content = body.get("content").and_then(|v| v.as_str()).unwrap_or("");
            if content.contains(pattern) {
                found_in_body = true;
            }
        }

        // Check auth fields
        if let Some(auth) = parsed.get("auth") {
            let at = auth.get("type").and_then(|v| v.as_str()).unwrap_or("none");
            let token = auth.get("token").and_then(|v| v.as_str()).unwrap_or("");
            let username = auth.get("username").and_then(|v| v.as_str()).unwrap_or("");
            let password = auth.get("password").and_then(|v| v.as_str()).unwrap_or("");
            let header_name = auth
                .get("header_name")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let header_value = auth
                .get("header_value")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            if token.contains(pattern)
                || username.contains(pattern)
                || password.contains(pattern)
                || header_name.contains(pattern)
                || header_value.contains(pattern)
            {
                found_in_auth = true;
                auth_type = at.to_string();
            }
        }
    }

    // Count distinct location categories
    let location_count = [
        found_in_header,
        found_in_auth,
        found_in_param,
        found_in_body,
        found_in_url,
    ]
    .iter()
    .filter(|&&b| b)
    .count();

    // If found in multiple distinct locations, keep url-path as safe default
    if location_count > 1 {
        return "url-path".to_string();
    }

    if found_in_auth {
        return match auth_type.as_str() {
            "bearer" => "auth-bearer".to_string(),
            "basic" => "auth-basic-username".to_string(),
            "custom" => "auth-custom".to_string(),
            _ => "auth-bearer".to_string(),
        };
    }
    if found_in_header {
        return "header".to_string();
    }
    if found_in_param {
        return "url-param".to_string();
    }
    if found_in_body {
        return "body".to_string();
    }

    // Not found anywhere or only in URL — keep url-path
    "url-path".to_string()
}

async fn migrate_orphans_to_default_project(conn: &Connection) -> DbResult<()> {
    let mut rows = conn
        .query(
            "SELECT COUNT(*) FROM collections WHERE project_id IS NULL",
            (),
        )
        .await?;
    let orphan_collections: i64 = if let Some(row) = rows.next().await? {
        row.get(0)?
    } else {
        0
    };
    drop(rows);

    let mut rows = conn
        .query(
            "SELECT COUNT(*) FROM environments WHERE project_id IS NULL",
            (),
        )
        .await?;
    let orphan_environments: i64 = if let Some(row) = rows.next().await? {
        row.get(0)?
    } else {
        0
    };
    drop(rows);

    if orphan_collections == 0 && orphan_environments == 0 {
        return Ok(());
    }

    // Deterministic ID for idempotent migration
    let default_project_id = "00000000-0000-0000-0000-000000000001";

    let mut rows = conn
        .query(
            "SELECT id FROM projects WHERE id = ?1",
            turso::params![default_project_id],
        )
        .await?;
    let exists = rows.next().await?.is_some();
    drop(rows);

    if !exists {
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "INSERT INTO projects (id, name, description, sort_order, version, created_at, updated_at)
             VALUES (?1, 'Default Project', NULL, 0, 1, ?2, ?2)",
            turso::params![default_project_id, now],
        )
        .await?;
    }

    if orphan_collections > 0 {
        conn.execute(
            "UPDATE collections SET project_id = ?1 WHERE project_id IS NULL",
            turso::params![default_project_id],
        )
        .await?;
    }

    if orphan_environments > 0 {
        conn.execute(
            "UPDATE environments SET project_id = ?1 WHERE project_id IS NULL",
            turso::params![default_project_id],
        )
        .await?;
    }

    let mut rows = conn
        .query(
            "SELECT value FROM app_state WHERE key = 'active_project_id'",
            (),
        )
        .await?;
    let has_active = rows.next().await?.is_some();
    drop(rows);

    if !has_active {
        conn.execute(
            "INSERT INTO app_state (key, value) VALUES ('active_project_id', ?1)
             ON CONFLICT (key) DO UPDATE SET value = ?1",
            turso::params![default_project_id],
        )
        .await?;
    }

    Ok(())
}

async fn migrate_requests_schema(conn: &Connection) -> DbResult<()> {
    // Check if migration already done by looking for project_id column that is NOT NULL.
    // PRAGMA table_info columns: cid(0), name(1), type(2), notnull(3), dflt_value(4), pk(5)
    let mut rows = conn.query("PRAGMA table_info(api_requests)", ()).await?;
    let mut project_id_is_not_null = false;
    while let Some(row) = rows.next().await? {
        let col_name: String = row.get(1)?;
        if col_name == "project_id" {
            let notnull: i64 = row.get(3)?;
            if notnull != 0 {
                project_id_is_not_null = true;
            }
            break;
        }
    }
    drop(rows);
    if project_id_is_not_null {
        return Ok(());
    }

    // Full table rebuild in a transaction
    conn.execute("BEGIN IMMEDIATE", ()).await?;

    let result = async {
        conn.execute(
            "CREATE TABLE api_requests_new (
                id TEXT PRIMARY KEY,
                collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                config TEXT NOT NULL DEFAULT '{}',
                version INTEGER NOT NULL DEFAULT 1,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                source_commit_id TEXT DEFAULT NULL
            )",
            (),
        )
        .await?;

        conn.execute(
            "INSERT INTO api_requests_new (id, collection_id, project_id, name, sort_order, config, version, created_at, updated_at, source_commit_id)
             SELECT r.id, c.id,
                    COALESCE(c.project_id, (SELECT id FROM projects ORDER BY created_at ASC, id ASC LIMIT 1)),
                    r.name, r.sort_order, r.config, r.version, r.created_at, r.updated_at, r.source_commit_id
             FROM api_requests r
             LEFT JOIN collections c ON r.collection_id = c.id",
            (),
        )
        .await?;

        conn.execute("DROP TABLE api_requests", ()).await?;
        conn.execute("ALTER TABLE api_requests_new RENAME TO api_requests", ()).await?;
        conn.execute(
            "CREATE INDEX idx_requests_collection ON api_requests(collection_id)",
            (),
        )
        .await?;
        conn.execute(
            "CREATE INDEX idx_requests_project ON api_requests(project_id)",
            (),
        )
        .await?;

        // Verify FK integrity — query so we can inspect violations
        let mut fk_rows = conn
            .query("PRAGMA foreign_key_check(api_requests)", ())
            .await?;
        if fk_rows.next().await?.is_some() {
            drop(fk_rows);
            return Err("Migration produced foreign key violations in api_requests".into());
        }
        drop(fk_rows);

        Ok::<(), Box<dyn std::error::Error + Send + Sync>>(())
    }
    .await;

    match result {
        Ok(()) => {
            conn.execute("COMMIT", ()).await?;
            Ok(())
        }
        Err(e) => {
            let _ = conn.execute("ROLLBACK", ()).await;
            Err(e)
        }
    }
}

// Re-export project functions
pub use projects::{create_project, delete_project, get_project, list_projects, update_project};

// Re-export collection functions
pub use collections::{
    create_collection, delete_collection, get_collection, list_collections, update_collection,
};

// Re-export request functions
pub use requests::{
    count_requests_in_collection, create_request, delete_request, duplicate_request, get_request,
    list_requests, list_root_requests, update_request,
};

// Re-export environment functions
pub use environments::{
    create_environment, delete_environment, get_active_environment, list_env_variables,
    list_environments, set_active_environment, set_env_variables, update_env_variable,
    update_environment,
};

// Re-export changelog functions
pub use changelog::get_changelog;

// Re-export model functions
pub use models::{
    create_model, delete_model, get_model, list_models, update_model, validate_model_graph,
    validate_model_refs,
};

// Re-export app_state functions
pub use app_state::{get_app_state, set_app_state};

// Re-export graph functions
pub use graph::{
    clear_project_graph, list_graph_edges, list_graph_nodes, replace_project_graph,
    update_node_positions,
};

// Re-export spec functions
pub use specs::{get_spec, upsert_spec};

// Re-export description functions
pub use descriptions::rebuild_project_descriptions;

// Re-export entity graph functions
pub use entity_graph::extract_relations;

// Re-export relation functions
pub use relations::{find_backlinks, find_related_entities, rebuild_entity_relations};

// Re-export search functions
pub use search::{rebuild_search_index, search_entities, SearchResult};

// Re-export hook functions
pub use hooks::{
    create_hook, delete_hook, find_hook_for_variable, list_hook_targets, list_hooks, update_hook,
    update_hook_last_executed,
};
