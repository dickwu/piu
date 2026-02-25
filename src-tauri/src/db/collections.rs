use super::{get_connection, DbResult};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Collection {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub sort_order: i64,
    pub path_prefix: Option<String>,
    pub description: Option<String>,
    pub shared_headers: String,
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
        path_prefix TEXT,
        description TEXT,
        shared_headers TEXT NOT NULL DEFAULT '[]',
        version INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_collections_parent ON collections(parent_id);
    "
}

const SELECT_COLUMNS: &str =
    "id, name, parent_id, sort_order, path_prefix, description, shared_headers, version, created_at, updated_at";

fn collection_from_row(
    row: &turso::Row,
) -> Result<Collection, Box<dyn std::error::Error + Send + Sync>> {
    Ok(Collection {
        id: row.get(0)?,
        name: row.get(1)?,
        parent_id: row.get(2)?,
        sort_order: row.get(3)?,
        path_prefix: row.get(4)?,
        description: row.get(5)?,
        shared_headers: row
            .get::<Option<String>>(6)?
            .unwrap_or_else(|| "[]".to_string()),
        version: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

pub async fn create_collection(
    id: &str,
    name: &str,
    parent_id: Option<&str>,
) -> DbResult<Collection> {
    let conn = get_connection()?.lock().await;
    let now = chrono::Utc::now().timestamp_millis();

    conn.execute(
        "INSERT INTO collections (id, name, parent_id, sort_order, path_prefix, description, shared_headers, version, created_at, updated_at)
         VALUES (?1, ?2, ?3, 0, NULL, NULL, '[]', 1, ?4, ?4)",
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
        path_prefix: None,
        description: None,
        shared_headers: "[]".to_string(),
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
    path_prefix: Option<Option<&str>>,
    description: Option<Option<&str>>,
    shared_headers: Option<&str>,
) -> DbResult<Collection> {
    let conn = get_connection()?.lock().await;

    // Fetch current state for diff
    let mut rows = conn
        .query(
            &format!("SELECT {} FROM collections WHERE id = ?1", SELECT_COLUMNS),
            turso::params![id],
        )
        .await?;

    let row = rows
        .next()
        .await?
        .ok_or_else(|| format!("Collection {} not found", id))?;

    let old = collection_from_row(&row)?;
    drop(rows);

    let new_name = name.unwrap_or(&old.name);
    let new_parent_id = parent_id.unwrap_or(old.parent_id.as_deref());
    let new_sort_order = sort_order.unwrap_or(old.sort_order);
    let new_path_prefix = path_prefix.unwrap_or(old.path_prefix.as_deref());
    let new_description = description.unwrap_or(old.description.as_deref());
    let new_shared_headers = shared_headers.unwrap_or(&old.shared_headers);
    let new_version = old.version + 1;
    let now = chrono::Utc::now().timestamp_millis();

    conn.execute(
        "UPDATE collections SET name = ?1, parent_id = ?2, sort_order = ?3, path_prefix = ?4, description = ?5, shared_headers = ?6, version = ?7, updated_at = ?8 WHERE id = ?9",
        turso::params![new_name, new_parent_id, new_sort_order, new_path_prefix, new_description, new_shared_headers, new_version, now, id],
    )
    .await?;

    // Build diff summary
    let mut changes = Vec::new();
    if name.is_some() && new_name != old.name {
        changes.push(format!("Renamed from '{}' to '{}'", old.name, new_name));
    }
    if parent_id.is_some() && new_parent_id != old.parent_id.as_deref() {
        changes.push("Moved to different parent".to_string());
    }
    if sort_order.is_some() && new_sort_order != old.sort_order {
        changes.push("Reordered".to_string());
    }
    if path_prefix.is_some() && new_path_prefix != old.path_prefix.as_deref() {
        changes.push(format!(
            "Path prefix changed to '{}'",
            new_path_prefix.unwrap_or("")
        ));
    }
    if description.is_some() && new_description != old.description.as_deref() {
        changes.push("Description updated".to_string());
    }
    if shared_headers.is_some() && new_shared_headers != old.shared_headers {
        changes.push("Shared headers updated".to_string());
    }
    let summary = if changes.is_empty() {
        "Updated collection".to_string()
    } else {
        changes.join("; ")
    };

    let diff = serde_json::json!({
        "name": { "old": old.name, "new": new_name },
        "parent_id": { "old": old.parent_id, "new": new_parent_id },
        "sort_order": { "old": old.sort_order, "new": new_sort_order },
        "path_prefix": { "old": old.path_prefix, "new": new_path_prefix },
        "description": { "old": old.description, "new": new_description },
        "shared_headers": { "old": old.shared_headers, "new": new_shared_headers },
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
        path_prefix: new_path_prefix.map(|s| s.to_string()),
        description: new_description.map(|s| s.to_string()),
        shared_headers: new_shared_headers.to_string(),
        version: new_version,
        created_at: old.created_at,
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

    conn.execute("DELETE FROM collections WHERE id = ?1", turso::params![id])
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

#[allow(dead_code)]
pub async fn get_collection(id: &str) -> DbResult<Option<Collection>> {
    let conn = get_connection()?.lock().await;
    let mut rows = conn
        .query(
            &format!("SELECT {} FROM collections WHERE id = ?1", SELECT_COLUMNS),
            turso::params![id],
        )
        .await?;

    if let Some(row) = rows.next().await? {
        Ok(Some(collection_from_row(&row)?))
    } else {
        Ok(None)
    }
}

pub async fn list_collections() -> DbResult<Vec<Collection>> {
    let conn = get_connection()?.lock().await;
    let mut rows = conn
        .query(
            &format!(
                "SELECT {} FROM collections ORDER BY sort_order, name",
                SELECT_COLUMNS
            ),
            (),
        )
        .await?;

    let mut collections = Vec::new();
    while let Some(row) = rows.next().await? {
        collections.push(collection_from_row(&row)?);
    }

    Ok(collections)
}
