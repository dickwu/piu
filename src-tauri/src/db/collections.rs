use super::{get_connection, DbResult};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Collection {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub sort_order: i64,
    pub version: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

pub fn get_table_sql() -> &'static str {
    "
    CREATE TABLE IF NOT EXISTS collections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        parent_id TEXT REFERENCES collections(id) ON DELETE CASCADE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_collections_parent ON collections(parent_id);
    "
}

pub async fn create_collection(
    id: &str,
    name: &str,
    parent_id: Option<&str>,
) -> DbResult<Collection> {
    let conn = get_connection()?.lock().await;
    let now = chrono::Utc::now().timestamp_millis();

    conn.execute(
        "INSERT INTO collections (id, name, parent_id, sort_order, version, created_at, updated_at)
         VALUES (?1, ?2, ?3, 0, 1, ?4, ?4)",
        turso::params![id, name, parent_id, now],
    )
    .await?;

    // Log creation in changelog
    drop(conn);
    super::changelog::insert_changelog("collection", id, name, 1, "Created collection", None)
        .await?;

    Ok(Collection {
        id: id.to_string(),
        name: name.to_string(),
        parent_id: parent_id.map(|s| s.to_string()),
        sort_order: 0,
        version: 1,
        created_at: now,
        updated_at: now,
    })
}

pub async fn update_collection(
    id: &str,
    name: Option<&str>,
    parent_id: Option<Option<&str>>,
    sort_order: Option<i64>,
) -> DbResult<Collection> {
    let conn = get_connection()?.lock().await;

    // Fetch current state for diff
    let mut rows = conn
        .query(
            "SELECT id, name, parent_id, sort_order, version, created_at, updated_at FROM collections WHERE id = ?1",
            turso::params![id],
        )
        .await?;

    let row = rows
        .next()
        .await?
        .ok_or_else(|| format!("Collection {} not found", id))?;

    let old_name: String = row.get(1)?;
    let old_parent_id: Option<String> = row.get(2)?;
    let old_sort_order: i64 = row.get(3)?;
    let old_version: i64 = row.get(4)?;
    let created_at: i64 = row.get(5)?;
    drop(rows);

    let new_name = name.unwrap_or(&old_name);
    let new_parent_id = parent_id.unwrap_or(old_parent_id.as_deref());
    let new_sort_order = sort_order.unwrap_or(old_sort_order);
    let new_version = old_version + 1;
    let now = chrono::Utc::now().timestamp_millis();

    conn.execute(
        "UPDATE collections SET name = ?1, parent_id = ?2, sort_order = ?3, version = ?4, updated_at = ?5 WHERE id = ?6",
        turso::params![new_name, new_parent_id, new_sort_order, new_version, now, id],
    )
    .await?;

    // Build diff summary
    let mut changes = Vec::new();
    if name.is_some() && new_name != old_name {
        changes.push(format!("Renamed from '{}' to '{}'", old_name, new_name));
    }
    if parent_id.is_some() && new_parent_id != old_parent_id.as_deref() {
        changes.push("Moved to different parent".to_string());
    }
    if sort_order.is_some() && new_sort_order != old_sort_order {
        changes.push("Reordered".to_string());
    }
    let summary = if changes.is_empty() {
        "Updated collection".to_string()
    } else {
        changes.join("; ")
    };

    let diff = serde_json::json!({
        "name": { "old": old_name, "new": new_name },
        "parent_id": { "old": old_parent_id, "new": new_parent_id },
        "sort_order": { "old": old_sort_order, "new": new_sort_order },
    });

    drop(conn);
    super::changelog::insert_changelog(
        "collection",
        id,
        new_name,
        new_version,
        &summary,
        Some(&diff.to_string()),
    )
    .await?;

    Ok(Collection {
        id: id.to_string(),
        name: new_name.to_string(),
        parent_id: new_parent_id.map(|s| s.to_string()),
        sort_order: new_sort_order,
        version: new_version,
        created_at,
        updated_at: now,
    })
}

pub async fn delete_collection(id: &str) -> DbResult<()> {
    let conn = get_connection()?.lock().await;

    // Get name for changelog
    let mut rows = conn
        .query(
            "SELECT name, version FROM collections WHERE id = ?1",
            turso::params![id],
        )
        .await?;
    let row = rows
        .next()
        .await?
        .ok_or_else(|| format!("Collection {} not found", id))?;
    let name: String = row.get(0)?;
    let version: i64 = row.get(1)?;
    drop(rows);

    conn.execute(
        "DELETE FROM collections WHERE id = ?1",
        turso::params![id],
    )
    .await?;

    drop(conn);
    super::changelog::insert_changelog(
        "collection",
        id,
        &name,
        version + 1,
        "Deleted collection",
        None,
    )
    .await?;

    Ok(())
}

pub async fn get_collection(id: &str) -> DbResult<Option<Collection>> {
    let conn = get_connection()?.lock().await;
    let mut rows = conn
        .query(
            "SELECT id, name, parent_id, sort_order, version, created_at, updated_at FROM collections WHERE id = ?1",
            turso::params![id],
        )
        .await?;

    if let Some(row) = rows.next().await? {
        Ok(Some(Collection {
            id: row.get(0)?,
            name: row.get(1)?,
            parent_id: row.get(2)?,
            sort_order: row.get(3)?,
            version: row.get(4)?,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
        }))
    } else {
        Ok(None)
    }
}

pub async fn list_collections() -> DbResult<Vec<Collection>> {
    let conn = get_connection()?.lock().await;
    let mut rows = conn
        .query(
            "SELECT id, name, parent_id, sort_order, version, created_at, updated_at FROM collections ORDER BY sort_order, name",
            (),
        )
        .await?;

    let mut collections = Vec::new();
    while let Some(row) = rows.next().await? {
        collections.push(Collection {
            id: row.get(0)?,
            name: row.get(1)?,
            parent_id: row.get(2)?,
            sort_order: row.get(3)?,
            version: row.get(4)?,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
        });
    }

    Ok(collections)
}
