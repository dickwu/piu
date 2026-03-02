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
pub mod environments;
pub mod models;
pub mod projects;
pub mod requests;

// Re-export types
pub use changelog::ChangelogEntry;
pub use collections::Collection;
pub use environments::{EnvVariable, Environment};
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
        "{}{}{}{}{}{}{}",
        projects::get_table_sql(),
        collections::get_table_sql(),
        requests::get_table_sql(),
        environments::get_table_sql(),
        changelog::get_table_sql(),
        app_state::get_table_sql(),
        models::get_table_sql(),
    ))
    .await?;

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

    Ok(())
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

// Re-export project functions
pub use projects::{create_project, delete_project, get_project, list_projects, update_project};

// Re-export collection functions
pub use collections::{
    create_collection, delete_collection, get_collection, list_collections, update_collection,
};

// Re-export request functions
pub use requests::{
    create_request, delete_request, duplicate_request, get_request, list_requests, update_request,
};

// Re-export environment functions
pub use environments::{
    create_environment, delete_environment, get_active_environment, list_env_variables,
    list_environments, set_active_environment, set_env_variables, update_environment,
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
