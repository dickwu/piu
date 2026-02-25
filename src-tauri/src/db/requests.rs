use super::{get_connection, DbResult};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiRequest {
    pub id: String,
    pub collection_id: String,
    pub name: String,
    pub sort_order: i64,
    pub config: String, // JSON blob
    pub version: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

pub fn get_table_sql() -> &'static str {
    "
    CREATE TABLE IF NOT EXISTS api_requests (
        id TEXT PRIMARY KEY,
        collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        config TEXT NOT NULL DEFAULT '{}',
        version INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_requests_collection ON api_requests(collection_id);
    "
}

fn default_config() -> String {
    serde_json::json!({
        "method": "GET",
        "url": "",
        "headers": [],
        "params": [],
        "body": {
            "type": "json",
            "content": ""
        },
        "auth": {
            "type": "none"
        }
    })
    .to_string()
}

pub async fn create_request(
    id: &str,
    collection_id: &str,
    name: &str,
    config: Option<&str>,
) -> DbResult<ApiRequest> {
    let conn = get_connection()?.lock().await;
    let now = chrono::Utc::now().timestamp_millis();
    let config_str = config.unwrap_or(&default_config()).to_string();

    conn.execute(
        "INSERT INTO api_requests (id, collection_id, name, sort_order, config, version, created_at, updated_at)
         VALUES (?1, ?2, ?3, 0, ?4, 1, ?5, ?5)",
        turso::params![id, collection_id, name, config_str.clone(), now],
    )
    .await?;

    drop(conn);
    super::changelog::insert_changelog("request", id, name, 1, "Created request", None).await?;

    Ok(ApiRequest {
        id: id.to_string(),
        collection_id: collection_id.to_string(),
        name: name.to_string(),
        sort_order: 0,
        config: config_str,
        version: 1,
        created_at: now,
        updated_at: now,
    })
}

pub async fn update_request(
    id: &str,
    name: Option<&str>,
    config: Option<&str>,
    collection_id: Option<&str>,
    sort_order: Option<i64>,
) -> DbResult<ApiRequest> {
    let conn = get_connection()?.lock().await;

    let mut rows = conn
        .query(
            "SELECT id, collection_id, name, sort_order, config, version, created_at, updated_at FROM api_requests WHERE id = ?1",
            turso::params![id],
        )
        .await?;

    let row = rows
        .next()
        .await?
        .ok_or_else(|| format!("Request {} not found", id))?;

    let old_collection_id: String = row.get(1)?;
    let old_name: String = row.get(2)?;
    let old_sort_order: i64 = row.get(3)?;
    let old_config: String = row.get(4)?;
    let old_version: i64 = row.get(5)?;
    let created_at: i64 = row.get(6)?;
    drop(rows);

    let new_name = name.unwrap_or(&old_name);
    let new_config = config.unwrap_or(&old_config);
    let new_collection_id = collection_id.unwrap_or(&old_collection_id);
    let new_sort_order = sort_order.unwrap_or(old_sort_order);
    let new_version = old_version + 1;
    let now = chrono::Utc::now().timestamp_millis();

    conn.execute(
        "UPDATE api_requests SET name = ?1, config = ?2, collection_id = ?3, sort_order = ?4, version = ?5, updated_at = ?6 WHERE id = ?7",
        turso::params![new_name, new_config, new_collection_id, new_sort_order, new_version, now, id],
    )
    .await?;

    // Build change summary
    let mut changes = Vec::new();
    if name.is_some() && new_name != old_name {
        changes.push(format!("Renamed from '{}' to '{}'", old_name, new_name));
    }
    if config.is_some() && new_config != old_config {
        changes.push("Updated request config".to_string());
    }
    if collection_id.is_some() && new_collection_id != old_collection_id {
        changes.push("Moved to different collection".to_string());
    }
    if sort_order.is_some() && new_sort_order != old_sort_order {
        changes.push("Reordered".to_string());
    }
    let summary = if changes.is_empty() {
        "Updated request".to_string()
    } else {
        changes.join("; ")
    };

    let diff = serde_json::json!({
        "name": { "old": old_name, "new": new_name },
        "config": { "old": old_config, "new": new_config },
        "collection_id": { "old": old_collection_id, "new": new_collection_id },
    });

    drop(conn);
    super::changelog::insert_changelog(
        "request",
        id,
        new_name,
        new_version,
        &summary,
        Some(&diff.to_string()),
    )
    .await?;

    Ok(ApiRequest {
        id: id.to_string(),
        collection_id: new_collection_id.to_string(),
        name: new_name.to_string(),
        sort_order: new_sort_order,
        config: new_config.to_string(),
        version: new_version,
        created_at,
        updated_at: now,
    })
}

pub async fn delete_request(id: &str) -> DbResult<()> {
    let conn = get_connection()?.lock().await;

    let mut rows = conn
        .query(
            "SELECT name, version FROM api_requests WHERE id = ?1",
            turso::params![id],
        )
        .await?;
    let row = rows
        .next()
        .await?
        .ok_or_else(|| format!("Request {} not found", id))?;
    let name: String = row.get(0)?;
    let version: i64 = row.get(1)?;
    drop(rows);

    conn.execute("DELETE FROM api_requests WHERE id = ?1", turso::params![id])
        .await?;

    drop(conn);
    super::changelog::insert_changelog("request", id, &name, version + 1, "Deleted request", None)
        .await?;

    Ok(())
}

pub async fn get_request(id: &str) -> DbResult<Option<ApiRequest>> {
    let conn = get_connection()?.lock().await;
    let mut rows = conn
        .query(
            "SELECT id, collection_id, name, sort_order, config, version, created_at, updated_at FROM api_requests WHERE id = ?1",
            turso::params![id],
        )
        .await?;

    if let Some(row) = rows.next().await? {
        Ok(Some(ApiRequest {
            id: row.get(0)?,
            collection_id: row.get(1)?,
            name: row.get(2)?,
            sort_order: row.get(3)?,
            config: row.get(4)?,
            version: row.get(5)?,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
        }))
    } else {
        Ok(None)
    }
}

pub async fn list_requests(collection_id: &str) -> DbResult<Vec<ApiRequest>> {
    let conn = get_connection()?.lock().await;
    let mut rows = conn
        .query(
            "SELECT id, collection_id, name, sort_order, config, version, created_at, updated_at FROM api_requests WHERE collection_id = ?1 ORDER BY sort_order, name",
            turso::params![collection_id],
        )
        .await?;

    let mut requests = Vec::new();
    while let Some(row) = rows.next().await? {
        requests.push(ApiRequest {
            id: row.get(0)?,
            collection_id: row.get(1)?,
            name: row.get(2)?,
            sort_order: row.get(3)?,
            config: row.get(4)?,
            version: row.get(5)?,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
        });
    }

    Ok(requests)
}

pub async fn duplicate_request(id: &str, new_id: &str) -> DbResult<ApiRequest> {
    let original = get_request(id)
        .await?
        .ok_or_else(|| format!("Request {} not found", id))?;

    let new_name = format!("{} (copy)", original.name);
    create_request(
        new_id,
        &original.collection_id,
        &new_name,
        Some(&original.config),
    )
    .await
}
