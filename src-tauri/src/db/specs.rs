use super::{get_connection, DbResult};

pub fn get_table_sql() -> &'static str {
    "
    CREATE TABLE IF NOT EXISTS api_specs (
        project_id TEXT PRIMARY KEY,
        spec_json TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    "
}

pub async fn upsert_spec(project_id: &str, spec_json: &str, generated_at: &str) -> DbResult<()> {
    let conn = get_connection()?;
    let conn = conn.lock().await;
    conn.execute(
        "INSERT INTO api_specs (project_id, spec_json, generated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(project_id) DO UPDATE SET spec_json = excluded.spec_json, generated_at = excluded.generated_at",
        turso::params![project_id, spec_json, generated_at],
    )
    .await?;
    Ok(())
}

pub async fn get_spec(project_id: &str) -> DbResult<Option<(String, String)>> {
    let conn = get_connection()?;
    let conn = conn.lock().await;
    let mut rows = conn
        .query(
            "SELECT spec_json, generated_at FROM api_specs WHERE project_id = ?1",
            turso::params![project_id],
        )
        .await?;
    if let Some(row) = rows.next().await? {
        let spec_json: String = row.get(0)?;
        let generated_at: String = row.get(1)?;
        Ok(Some((spec_json, generated_at)))
    } else {
        Ok(None)
    }
}
