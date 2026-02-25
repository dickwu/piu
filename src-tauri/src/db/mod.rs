use std::path::Path;
use std::sync::OnceLock;
use tokio::sync::Mutex;
use turso::{Builder, Connection};

// Wrap Connection in Mutex to serialize database access
// turso 0.4.0 has race conditions in its page cache when accessed concurrently
static DB_CONNECTION: OnceLock<Mutex<Connection>> = OnceLock::new();

pub(crate) type DbResult<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

pub mod app_state;
pub mod changelog;
pub mod collections;
pub mod environments;
pub mod requests;

// Re-export types
pub use changelog::ChangelogEntry;
pub use collections::Collection;
pub use environments::{EnvVariable, Environment};
pub use requests::ApiRequest;

// ============ Connection and Initialization ============

pub(crate) fn get_connection() -> DbResult<&'static Mutex<Connection>> {
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
        "{}{}{}{}{}",
        collections::get_table_sql(),
        requests::get_table_sql(),
        environments::get_table_sql(),
        changelog::get_table_sql(),
        app_state::get_table_sql(),
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
    // Migration 1: Add collection settings columns (path_prefix, description, shared_headers)
    let migrations = [
        "ALTER TABLE collections ADD COLUMN path_prefix TEXT DEFAULT NULL",
        "ALTER TABLE collections ADD COLUMN description TEXT DEFAULT NULL",
        "ALTER TABLE collections ADD COLUMN shared_headers TEXT NOT NULL DEFAULT '[]'",
    ];
    for sql in &migrations {
        if let Err(e) = conn.execute(sql, ()).await {
            let msg = e.to_string();
            if !msg.contains("duplicate column") {
                return Err(Box::new(e));
            }
        }
    }
    Ok(())
}

// Re-export collection functions
pub use collections::{create_collection, delete_collection, list_collections, update_collection};

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

// Re-export app_state functions (reserved for future use)
#[allow(unused_imports)]
pub use app_state::{get_app_state, set_app_state};
