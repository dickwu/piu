use super::{get_connection, DbResult};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Environment {
    pub id: String,
    pub name: String,
    pub is_active: bool,
    pub sort_order: i64,
    pub project_id: Option<String>,
    pub host: Option<String>,
    pub version: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvVariable {
    pub id: String,
    pub environment_id: String,
    pub key: String,
    pub value: String,
    pub enabled: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

pub fn get_table_sql() -> &'static str {
    "
    CREATE TABLE IF NOT EXISTS environments (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        host TEXT DEFAULT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_environments_project ON environments(project_id);

    CREATE TABLE IF NOT EXISTS env_variables (
        id TEXT PRIMARY KEY,
        environment_id TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_env_vars_env ON env_variables(environment_id);
    "
}

const ENV_SELECT: &str =
    "id, name, is_active, sort_order, project_id, host, version, created_at, updated_at";

fn environment_from_row(
    row: &turso::Row,
) -> Result<Environment, Box<dyn std::error::Error + Send + Sync>> {
    Ok(Environment {
        id: row.get(0)?,
        name: row.get(1)?,
        is_active: row.get(2)?,
        sort_order: row.get(3)?,
        project_id: row.get(4)?,
        host: row.get(5)?,
        version: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

pub async fn create_environment(
    id: &str,
    name: &str,
    project_id: Option<&str>,
    host: Option<&str>,
) -> DbResult<Environment> {
    let conn = get_connection()?.lock().await;
    let now = chrono::Utc::now().timestamp_millis();

    conn.execute(
        &format!(
            "INSERT INTO environments ({}) VALUES (?1, ?2, 0, 0, ?3, ?4, 1, ?5, ?5)",
            ENV_SELECT
        ),
        turso::params![id, name, project_id, host, now],
    )
    .await?;

    drop(conn);
    super::changelog::insert_changelog("environment", id, name, 1, "Created environment", None)
        .await?;

    Ok(Environment {
        id: id.to_string(),
        name: name.to_string(),
        is_active: false,
        sort_order: 0,
        project_id: project_id.map(|s| s.to_string()),
        host: host.map(|s| s.to_string()),
        version: 1,
        created_at: now,
        updated_at: now,
    })
}

pub async fn update_environment(
    id: &str,
    name: Option<&str>,
    host: Option<Option<&str>>,
) -> DbResult<Environment> {
    let conn = get_connection()?.lock().await;

    let mut rows = conn
        .query(
            &format!("SELECT {} FROM environments WHERE id = ?1", ENV_SELECT),
            turso::params![id],
        )
        .await?;

    let row = rows
        .next()
        .await?
        .ok_or_else(|| format!("Environment {} not found", id))?;

    let old = environment_from_row(&row)?;
    drop(rows);

    let new_name = name.unwrap_or(&old.name);
    let new_host = host.unwrap_or(old.host.as_deref());
    let new_version = old.version + 1;
    let now = chrono::Utc::now().timestamp_millis();

    conn.execute(
        "UPDATE environments SET name = ?1, host = ?2, version = ?3, updated_at = ?4 WHERE id = ?5",
        turso::params![new_name, new_host, new_version, now, id],
    )
    .await?;

    let mut changes = Vec::new();
    if name.is_some() && new_name != old.name {
        changes.push(format!("Renamed from '{}' to '{}'", old.name, new_name));
    }
    if host.is_some() && new_host != old.host.as_deref() {
        changes.push(format!("Host changed to '{}'", new_host.unwrap_or("")));
    }
    let summary = if changes.is_empty() {
        "Updated environment".to_string()
    } else {
        changes.join("; ")
    };

    drop(conn);
    super::changelog::insert_changelog("environment", id, new_name, new_version, &summary, None)
        .await?;

    Ok(Environment {
        id: id.to_string(),
        name: new_name.to_string(),
        is_active: old.is_active,
        sort_order: old.sort_order,
        project_id: old.project_id,
        host: new_host.map(|s| s.to_string()),
        version: new_version,
        created_at: old.created_at,
        updated_at: now,
    })
}

pub async fn delete_environment(id: &str) -> DbResult<()> {
    let conn = get_connection()?.lock().await;

    let mut rows = conn
        .query(
            "SELECT name, version FROM environments WHERE id = ?1",
            turso::params![id],
        )
        .await?;
    let row = rows
        .next()
        .await?
        .ok_or_else(|| format!("Environment {} not found", id))?;
    let name: String = row.get(0)?;
    let version: i64 = row.get(1)?;
    drop(rows);

    conn.execute("DELETE FROM environments WHERE id = ?1", turso::params![id])
        .await?;

    drop(conn);
    super::changelog::insert_changelog(
        "environment",
        id,
        &name,
        version + 1,
        "Deleted environment",
        None,
    )
    .await?;

    Ok(())
}

pub async fn list_environments(project_id: Option<&str>) -> DbResult<Vec<Environment>> {
    let conn = get_connection()?.lock().await;

    let mut rows = if let Some(pid) = project_id {
        conn.query(
            &format!(
                "SELECT {} FROM environments WHERE project_id = ?1 ORDER BY sort_order, name",
                ENV_SELECT
            ),
            turso::params![pid],
        )
        .await?
    } else {
        conn.query(
            &format!(
                "SELECT {} FROM environments ORDER BY sort_order, name",
                ENV_SELECT
            ),
            (),
        )
        .await?
    };

    let mut envs = Vec::new();
    while let Some(row) = rows.next().await? {
        envs.push(environment_from_row(&row)?);
    }

    Ok(envs)
}

pub async fn set_active_environment(id: &str, project_id: &str) -> DbResult<()> {
    let conn = get_connection()?.lock().await;

    // Deactivate all environments in this project
    conn.execute(
        "UPDATE environments SET is_active = 0 WHERE project_id = ?1",
        turso::params![project_id],
    )
    .await?;

    // Activate the selected one
    conn.execute(
        "UPDATE environments SET is_active = 1 WHERE id = ?1",
        turso::params![id],
    )
    .await?;

    Ok(())
}

pub async fn get_active_environment(project_id: &str) -> DbResult<Option<Environment>> {
    let conn = get_connection()?.lock().await;
    let mut rows = conn
        .query(
            &format!(
                "SELECT {} FROM environments WHERE is_active = 1 AND project_id = ?1 LIMIT 1",
                ENV_SELECT
            ),
            turso::params![project_id],
        )
        .await?;

    if let Some(row) = rows.next().await? {
        Ok(Some(environment_from_row(&row)?))
    } else {
        Ok(None)
    }
}

pub async fn set_env_variables(
    environment_id: &str,
    variables: Vec<(String, String, String, bool)>, // (id, key, value, enabled)
) -> DbResult<()> {
    let conn = get_connection()?.lock().await;
    let now = chrono::Utc::now().timestamp_millis();

    conn.execute(
        "DELETE FROM env_variables WHERE environment_id = ?1",
        turso::params![environment_id],
    )
    .await?;

    for (id, key, value, enabled) in &variables {
        conn.execute(
            "INSERT INTO env_variables (id, environment_id, key, value, enabled, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
            turso::params![id.clone(), environment_id, key.clone(), value.clone(), *enabled, now],
        )
        .await?;
    }

    Ok(())
}

pub async fn list_env_variables(environment_id: &str) -> DbResult<Vec<EnvVariable>> {
    let conn = get_connection()?.lock().await;
    let mut rows = conn
        .query(
            "SELECT id, environment_id, key, value, enabled, created_at, updated_at FROM env_variables WHERE environment_id = ?1 ORDER BY key",
            turso::params![environment_id],
        )
        .await?;

    let mut variables = Vec::new();
    while let Some(row) = rows.next().await? {
        variables.push(EnvVariable {
            id: row.get(0)?,
            environment_id: row.get(1)?,
            key: row.get(2)?,
            value: row.get(3)?,
            enabled: row.get(4)?,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
        });
    }

    Ok(variables)
}
