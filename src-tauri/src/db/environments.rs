use super::{get_connection, DbResult};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Environment {
    pub id: String,
    pub name: String,
    pub is_active: bool,
    pub sort_order: i64,
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
        version INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );

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

pub async fn create_environment(id: &str, name: &str) -> DbResult<Environment> {
    let conn = get_connection()?.lock().await;
    let now = chrono::Utc::now().timestamp_millis();

    conn.execute(
        "INSERT INTO environments (id, name, is_active, sort_order, version, created_at, updated_at)
         VALUES (?1, ?2, 0, 0, 1, ?3, ?3)",
        turso::params![id, name, now],
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
        version: 1,
        created_at: now,
        updated_at: now,
    })
}

pub async fn update_environment(id: &str, name: Option<&str>) -> DbResult<Environment> {
    let conn = get_connection()?.lock().await;

    let mut rows = conn
        .query(
            "SELECT id, name, is_active, sort_order, version, created_at, updated_at FROM environments WHERE id = ?1",
            turso::params![id],
        )
        .await?;

    let row = rows
        .next()
        .await?
        .ok_or_else(|| format!("Environment {} not found", id))?;

    let old_name: String = row.get(1)?;
    let is_active: bool = row.get(2)?;
    let sort_order: i64 = row.get(3)?;
    let old_version: i64 = row.get(4)?;
    let created_at: i64 = row.get(5)?;
    drop(rows);

    let new_name = name.unwrap_or(&old_name);
    let new_version = old_version + 1;
    let now = chrono::Utc::now().timestamp_millis();

    conn.execute(
        "UPDATE environments SET name = ?1, version = ?2, updated_at = ?3 WHERE id = ?4",
        turso::params![new_name, new_version, now, id],
    )
    .await?;

    let summary = if new_name != old_name {
        format!("Renamed from '{}' to '{}'", old_name, new_name)
    } else {
        "Updated environment".to_string()
    };

    drop(conn);
    super::changelog::insert_changelog("environment", id, new_name, new_version, &summary, None)
        .await?;

    Ok(Environment {
        id: id.to_string(),
        name: new_name.to_string(),
        is_active,
        sort_order,
        version: new_version,
        created_at,
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

pub async fn list_environments() -> DbResult<Vec<Environment>> {
    let conn = get_connection()?.lock().await;
    let mut rows = conn
        .query(
            "SELECT id, name, is_active, sort_order, version, created_at, updated_at FROM environments ORDER BY sort_order, name",
            (),
        )
        .await?;

    let mut envs = Vec::new();
    while let Some(row) = rows.next().await? {
        envs.push(Environment {
            id: row.get(0)?,
            name: row.get(1)?,
            is_active: row.get(2)?,
            sort_order: row.get(3)?,
            version: row.get(4)?,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
        });
    }

    Ok(envs)
}

pub async fn set_active_environment(id: &str) -> DbResult<()> {
    let conn = get_connection()?.lock().await;

    // Deactivate all environments
    conn.execute("UPDATE environments SET is_active = 0", ())
        .await?;

    // Activate the selected one
    conn.execute(
        "UPDATE environments SET is_active = 1 WHERE id = ?1",
        turso::params![id],
    )
    .await?;

    Ok(())
}

pub async fn get_active_environment() -> DbResult<Option<Environment>> {
    let conn = get_connection()?.lock().await;
    let mut rows = conn
        .query(
            "SELECT id, name, is_active, sort_order, version, created_at, updated_at FROM environments WHERE is_active = 1 LIMIT 1",
            (),
        )
        .await?;

    if let Some(row) = rows.next().await? {
        Ok(Some(Environment {
            id: row.get(0)?,
            name: row.get(1)?,
            is_active: row.get(2)?,
            sort_order: row.get(3)?,
            version: row.get(4)?,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
        }))
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

    // Delete existing variables for this environment
    conn.execute(
        "DELETE FROM env_variables WHERE environment_id = ?1",
        turso::params![environment_id],
    )
    .await?;

    // Insert new variables
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
