use super::{get_connection, DbResult};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChangelogEntry {
    pub id: i64,
    pub entity_type: String,
    pub entity_id: String,
    pub entity_name: String,
    pub version: i64,
    pub summary: String,
    pub diff: Option<String>,
    pub created_at: i64,
}

pub fn get_table_sql() -> &'static str {
    "
    CREATE TABLE IF NOT EXISTS changelog (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        entity_name TEXT NOT NULL,
        version INTEGER NOT NULL,
        summary TEXT NOT NULL,
        diff TEXT,
        created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_changelog_entity ON changelog(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_changelog_version ON changelog(entity_type, entity_id, version);
    "
}

pub async fn insert_changelog(
    entity_type: &str,
    entity_id: &str,
    entity_name: &str,
    version: i64,
    summary: &str,
    diff: Option<&str>,
) -> DbResult<()> {
    let conn = get_connection()?.lock().await;
    let now = chrono::Utc::now().timestamp_millis();

    conn.execute(
        "INSERT INTO changelog (entity_type, entity_id, entity_name, version, summary, diff, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        turso::params![entity_type, entity_id, entity_name, version, summary, diff, now],
    )
    .await?;

    Ok(())
}

pub async fn get_changelog(
    entity_type: Option<&str>,
    entity_id: Option<&str>,
    limit: i64,
    offset: i64,
) -> DbResult<Vec<ChangelogEntry>> {
    let conn = get_connection()?.lock().await;

    let mut rows = match (entity_type, entity_id) {
        (Some(et), Some(ei)) => {
            conn.query(
                "SELECT id, entity_type, entity_id, entity_name, version, summary, diff, created_at FROM changelog WHERE entity_type = ?1 AND entity_id = ?2 ORDER BY created_at DESC LIMIT ?3 OFFSET ?4",
                turso::params![et, ei, limit, offset],
            ).await?
        }
        (Some(et), None) => {
            conn.query(
                "SELECT id, entity_type, entity_id, entity_name, version, summary, diff, created_at FROM changelog WHERE entity_type = ?1 ORDER BY created_at DESC LIMIT ?2 OFFSET ?3",
                turso::params![et, limit, offset],
            ).await?
        }
        _ => {
            conn.query(
                "SELECT id, entity_type, entity_id, entity_name, version, summary, diff, created_at FROM changelog ORDER BY created_at DESC LIMIT ?1 OFFSET ?2",
                turso::params![limit, offset],
            ).await?
        }
    };

    let mut entries = Vec::new();
    while let Some(row) = rows.next().await? {
        entries.push(ChangelogEntry {
            id: row.get(0)?,
            entity_type: row.get(1)?,
            entity_id: row.get(2)?,
            entity_name: row.get(3)?,
            version: row.get(4)?,
            summary: row.get(5)?,
            diff: row.get(6)?,
            created_at: row.get(7)?,
        });
    }

    Ok(entries)
}
