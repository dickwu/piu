use super::{get_connection, DbResult};

pub fn get_table_sql() -> &'static str {
    "
    CREATE TABLE IF NOT EXISTS layout_cache (
        input_hash TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        positions TEXT NOT NULL,
        created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_layout_cache_project ON layout_cache(project_id);
    "
}

/// Look up a cached layout by input hash.
/// Returns the positions JSON string if found, None otherwise.
pub async fn get_cached_layout(input_hash: &str) -> DbResult<Option<String>> {
    let conn = get_connection()?;
    let conn = conn.lock().await;

    let mut rows = conn
        .query(
            "SELECT positions FROM layout_cache WHERE input_hash = ?1 LIMIT 1",
            turso::params![input_hash],
        )
        .await?;

    let result = if let Some(row) = rows.next().await? {
        let positions: String = row.get(0)?;
        Some(positions)
    } else {
        None
    };
    drop(rows);

    Ok(result)
}

/// Save a layout computation result to the cache.
/// Uses INSERT OR REPLACE to upsert by input_hash (PRIMARY KEY).
/// Also prunes old entries for the same project, keeping the 5 most recent.
pub async fn save_layout_cache(
    project_id: &str,
    input_hash: &str,
    positions_json: &str,
) -> DbResult<()> {
    let conn = get_connection()?;
    let conn = conn.lock().await;

    let now = chrono::Utc::now().timestamp_millis();

    // Upsert: if the hash already exists, replace it
    conn.execute(
        "INSERT INTO layout_cache (input_hash, project_id, positions, created_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (input_hash) DO UPDATE SET positions = ?3, created_at = ?4",
        turso::params![input_hash, project_id, positions_json, now],
    )
    .await?;

    // Prune: keep only the 5 most recent entries per project
    conn.execute(
        "DELETE FROM layout_cache WHERE project_id = ?1 AND input_hash NOT IN (
            SELECT input_hash FROM layout_cache WHERE project_id = ?1
            ORDER BY created_at DESC LIMIT 5
        )",
        turso::params![project_id],
    )
    .await?;

    Ok(())
}

/// Clear all cached layouts for a project.
pub async fn clear_layout_cache(project_id: &str) -> DbResult<()> {
    let conn = get_connection()?;
    let conn = conn.lock().await;

    conn.execute(
        "DELETE FROM layout_cache WHERE project_id = ?1",
        turso::params![project_id],
    )
    .await?;

    Ok(())
}
