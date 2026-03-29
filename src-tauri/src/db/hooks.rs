use super::{get_connection, DbResult};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvHook {
    pub id: String,
    pub environment_id: String,
    pub source_request_id: String,
    pub response_location: String,
    pub selector: String,
    pub value_template: String,
    pub expires_in: Option<i64>,
    pub array_strategy: String,
    pub enabled: bool,
    pub last_executed_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvHookTarget {
    pub hook_id: String,
    pub variable_id: String,
}

pub fn get_table_sql() -> &'static str {
    "
    CREATE TABLE IF NOT EXISTS env_hooks (
        id TEXT PRIMARY KEY,
        environment_id TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
        source_request_id TEXT NOT NULL REFERENCES api_requests(id) ON DELETE CASCADE,
        response_location TEXT NOT NULL,
        selector TEXT NOT NULL,
        value_template TEXT NOT NULL DEFAULT '{{value}}',
        expires_in INTEGER,
        array_strategy TEXT NOT NULL DEFAULT 'pick',
        enabled INTEGER NOT NULL DEFAULT 1,
        last_executed_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_env_hooks_env ON env_hooks(environment_id);
    CREATE INDEX IF NOT EXISTS idx_env_hooks_source ON env_hooks(source_request_id);

    CREATE TABLE IF NOT EXISTS env_hook_targets (
        hook_id TEXT NOT NULL REFERENCES env_hooks(id) ON DELETE CASCADE,
        variable_id TEXT NOT NULL REFERENCES env_variables(id) ON DELETE CASCADE,
        PRIMARY KEY (hook_id, variable_id)
    );
    CREATE INDEX IF NOT EXISTS idx_hook_targets_var ON env_hook_targets(variable_id);
    "
}

const HOOK_SELECT: &str =
    "id, environment_id, source_request_id, response_location, selector, value_template, expires_in, array_strategy, enabled, last_executed_at, created_at, updated_at";

const HOOK_SELECT_ALIASED: &str =
    "h.id, h.environment_id, h.source_request_id, h.response_location, h.selector, h.value_template, h.expires_in, h.array_strategy, h.enabled, h.last_executed_at, h.created_at, h.updated_at";

fn hook_from_row(row: &turso::Row) -> Result<EnvHook, Box<dyn std::error::Error + Send + Sync>> {
    Ok(EnvHook {
        id: row.get(0)?,
        environment_id: row.get(1)?,
        source_request_id: row.get(2)?,
        response_location: row.get(3)?,
        selector: row.get(4)?,
        value_template: row.get(5)?,
        expires_in: row.get(6)?,
        array_strategy: row.get(7)?,
        enabled: row.get(8)?,
        last_executed_at: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

fn hook_target_from_row(
    row: &turso::Row,
) -> Result<EnvHookTarget, Box<dyn std::error::Error + Send + Sync>> {
    Ok(EnvHookTarget {
        hook_id: row.get(0)?,
        variable_id: row.get(1)?,
    })
}

#[allow(clippy::too_many_arguments)]
pub async fn create_hook(
    id: &str,
    environment_id: &str,
    source_request_id: &str,
    response_location: &str,
    selector: &str,
    value_template: &str,
    expires_in: Option<i64>,
    array_strategy: &str,
    target_variable_ids: &[String],
) -> DbResult<EnvHook> {
    let conn = get_connection()?.lock().await;
    let now = chrono::Utc::now().timestamp_millis();

    // Wrap hook + targets in a transaction to prevent partial state on FK failure
    conn.execute("BEGIN IMMEDIATE", ()).await?;

    let result: DbResult<()> = async {
        conn.execute(
            &format!(
                "INSERT INTO env_hooks ({}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, NULL, ?9, ?9)",
                HOOK_SELECT
            ),
            turso::params![
                id,
                environment_id,
                source_request_id,
                response_location,
                selector,
                value_template,
                expires_in,
                array_strategy,
                now
            ],
        )
        .await?;

        for var_id in target_variable_ids {
            conn.execute(
                "INSERT INTO env_hook_targets (hook_id, variable_id) VALUES (?1, ?2)",
                turso::params![id, var_id.as_str()],
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

    Ok(EnvHook {
        id: id.to_string(),
        environment_id: environment_id.to_string(),
        source_request_id: source_request_id.to_string(),
        response_location: response_location.to_string(),
        selector: selector.to_string(),
        value_template: value_template.to_string(),
        expires_in,
        array_strategy: array_strategy.to_string(),
        enabled: true,
        last_executed_at: None,
        created_at: now,
        updated_at: now,
    })
}

pub async fn list_hooks(environment_id: &str) -> DbResult<Vec<EnvHook>> {
    let conn = get_connection()?.lock().await;

    let mut rows = conn
        .query(
            &format!(
                "SELECT {} FROM env_hooks WHERE environment_id = ?1 ORDER BY created_at DESC",
                HOOK_SELECT
            ),
            turso::params![environment_id],
        )
        .await?;

    let mut hooks = Vec::new();
    while let Some(row) = rows.next().await? {
        hooks.push(hook_from_row(&row)?);
    }

    Ok(hooks)
}

pub async fn list_hook_targets(hook_id: &str) -> DbResult<Vec<EnvHookTarget>> {
    let conn = get_connection()?.lock().await;

    let mut rows = conn
        .query(
            "SELECT hook_id, variable_id FROM env_hook_targets WHERE hook_id = ?1",
            turso::params![hook_id],
        )
        .await?;

    let mut targets = Vec::new();
    while let Some(row) = rows.next().await? {
        targets.push(hook_target_from_row(&row)?);
    }

    Ok(targets)
}

pub async fn find_hook_for_variable(variable_id: &str) -> DbResult<Option<EnvHook>> {
    let conn = get_connection()?.lock().await;

    let mut rows = conn
        .query(
            &format!(
                "SELECT {} FROM env_hooks h
                 JOIN env_hook_targets t ON h.id = t.hook_id
                 WHERE t.variable_id = ?1 AND h.enabled = 1
                 ORDER BY h.created_at DESC
                 LIMIT 1",
                HOOK_SELECT_ALIASED
            ),
            turso::params![variable_id],
        )
        .await?;

    if let Some(row) = rows.next().await? {
        Ok(Some(hook_from_row(&row)?))
    } else {
        Ok(None)
    }
}

#[allow(clippy::too_many_arguments)]
pub async fn update_hook(
    id: &str,
    source_request_id: Option<&str>,
    response_location: Option<&str>,
    selector: Option<&str>,
    value_template: Option<&str>,
    expires_in: Option<Option<i64>>,
    array_strategy: Option<&str>,
    enabled: Option<bool>,
    target_variable_ids: Option<&[String]>,
) -> DbResult<EnvHook> {
    let conn = get_connection()?.lock().await;

    let mut rows = conn
        .query(
            &format!("SELECT {} FROM env_hooks WHERE id = ?1", HOOK_SELECT),
            turso::params![id],
        )
        .await?;

    let row = rows
        .next()
        .await?
        .ok_or_else(|| format!("EnvHook {} not found", id))?;

    let current = hook_from_row(&row)?;
    drop(rows);

    let new_source_request_id = source_request_id.unwrap_or(&current.source_request_id);
    let new_response_location = response_location.unwrap_or(&current.response_location);
    let new_selector = selector.unwrap_or(&current.selector);
    let new_value_template = value_template.unwrap_or(&current.value_template);
    let new_expires_in = match expires_in {
        Some(v) => v,
        None => current.expires_in,
    };
    let new_array_strategy = array_strategy.unwrap_or(&current.array_strategy);
    let new_enabled = enabled.unwrap_or(current.enabled);
    let now = chrono::Utc::now().timestamp_millis();

    // Wrap update + target replacement in a transaction to prevent partial state
    conn.execute("BEGIN IMMEDIATE", ()).await?;

    let result: DbResult<()> = async {
        conn.execute(
            "UPDATE env_hooks SET source_request_id = ?1, response_location = ?2, selector = ?3, value_template = ?4, expires_in = ?5, array_strategy = ?6, enabled = ?7, updated_at = ?8 WHERE id = ?9",
            turso::params![
                new_source_request_id,
                new_response_location,
                new_selector,
                new_value_template,
                new_expires_in,
                new_array_strategy,
                new_enabled,
                now,
                id
            ],
        )
        .await?;

        if let Some(var_ids) = target_variable_ids {
            conn.execute(
                "DELETE FROM env_hook_targets WHERE hook_id = ?1",
                turso::params![id],
            )
            .await?;

            for var_id in var_ids {
                conn.execute(
                    "INSERT INTO env_hook_targets (hook_id, variable_id) VALUES (?1, ?2)",
                    turso::params![id, var_id.as_str()],
                )
                .await?;
            }
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

    Ok(EnvHook {
        id: current.id,
        environment_id: current.environment_id,
        source_request_id: new_source_request_id.to_string(),
        response_location: new_response_location.to_string(),
        selector: new_selector.to_string(),
        value_template: new_value_template.to_string(),
        expires_in: new_expires_in,
        array_strategy: new_array_strategy.to_string(),
        enabled: new_enabled,
        last_executed_at: current.last_executed_at,
        created_at: current.created_at,
        updated_at: now,
    })
}

pub async fn delete_hook(id: &str) -> DbResult<()> {
    let conn = get_connection()?.lock().await;

    conn.execute("DELETE FROM env_hooks WHERE id = ?1", turso::params![id])
        .await?;

    Ok(())
}

pub async fn get_hook_by_id(id: &str) -> DbResult<Option<EnvHook>> {
    let conn = get_connection()?.lock().await;

    let mut rows = conn
        .query(
            &format!("SELECT {} FROM env_hooks WHERE id = ?1", HOOK_SELECT),
            turso::params![id],
        )
        .await?;

    if let Some(row) = rows.next().await? {
        Ok(Some(hook_from_row(&row)?))
    } else {
        Ok(None)
    }
}

pub async fn update_hook_last_executed(id: &str) -> DbResult<()> {
    let conn = get_connection()?.lock().await;
    let now = chrono::Utc::now().timestamp_millis();

    conn.execute(
        "UPDATE env_hooks SET last_executed_at = ?1, updated_at = ?1 WHERE id = ?2",
        turso::params![now, id],
    )
    .await?;

    Ok(())
}
