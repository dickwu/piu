use super::{get_connection, DbResult};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiRequest {
    pub id: String,
    pub collection_id: Option<String>,
    pub project_id: Option<String>,
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
        collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
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
    collection_id: Option<&str>,
    project_id: &str,
    name: &str,
    config: Option<&str>,
) -> DbResult<ApiRequest> {
    let conn = get_connection()?.lock().await;
    let now = chrono::Utc::now().timestamp_millis();
    let config_str = config.unwrap_or(&default_config()).to_string();

    conn.execute(
        "INSERT INTO api_requests (id, collection_id, project_id, name, sort_order, config, version, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 0, ?5, 1, ?6, ?6)",
        turso::params![id, collection_id, project_id, name, config_str.clone(), now],
    )
    .await?;

    drop(conn);
    super::changelog::insert_changelog("request", id, name, 1, "Created request", None).await?;

    Ok(ApiRequest {
        id: id.to_string(),
        collection_id: collection_id.map(|s| s.to_string()),
        project_id: Some(project_id.to_string()),
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
    move_to_root: bool,
) -> DbResult<ApiRequest> {
    // Phase 1: read the current request while holding the lock
    let (old_collection_id, old_project_id, old_name, old_sort_order, old_config, old_version, created_at) = {
        let conn = get_connection()?.lock().await;

        let mut rows = conn
            .query(
                "SELECT id, collection_id, project_id, name, sort_order, config, version, created_at, updated_at FROM api_requests WHERE id = ?1",
                turso::params![id],
            )
            .await?;

        let row = rows
            .next()
            .await?
            .ok_or_else(|| format!("Request {} not found", id))?;

        let old_col: Option<String> = row.get::<Option<String>>(1)?;
        let old_proj: Option<String> = row.get::<Option<String>>(2)?;
        let old_n: String = row.get(3)?;
        let old_so: i64 = row.get(4)?;
        let old_cfg: String = row.get(5)?;
        let old_ver: i64 = row.get(6)?;
        let c_at: i64 = row.get(7)?;
        drop(rows);
        // Lock released here when conn is dropped
        (old_col, old_proj, old_n, old_so, old_cfg, old_ver, c_at)
    };

    // Determine the new collection_id
    let new_collection_id: Option<String> = if move_to_root {
        None
    } else if let Some(cid) = collection_id {
        Some(cid.to_string())
    } else {
        old_collection_id.clone()
    };

    // Phase 2: resolve the new project_id (outside the DB lock to avoid deadlock with
    // get_collection which also acquires the lock)
    let collection_changed = new_collection_id != old_collection_id;
    let new_project_id: String = if move_to_root || !collection_changed {
        // Not moving to a different collection — retain current project
        old_project_id.clone().unwrap_or_default()
    } else if let Some(ref new_cid) = new_collection_id {
        // Moving to a different collection — derive project_id from target collection
        let target_col = super::collections::get_collection(new_cid).await?;
        target_col
            .and_then(|c| c.project_id)
            .unwrap_or_else(|| old_project_id.clone().unwrap_or_default())
    } else {
        // new_collection_id is None (moved to root) — already handled above, but keep fallback
        old_project_id.clone().unwrap_or_default()
    };

    // Phase 3: write the update while holding the lock again
    let new_name: String = name.map(|s| s.to_string()).unwrap_or_else(|| old_name.clone());
    let new_config: String = config.map(|s| s.to_string()).unwrap_or_else(|| old_config.clone());
    let new_sort_order = sort_order.unwrap_or(old_sort_order);
    let new_version = old_version + 1;
    let now = chrono::Utc::now().timestamp_millis();

    {
        let conn = get_connection()?.lock().await;
        let affected = conn.execute(
            "UPDATE api_requests SET name = ?1, config = ?2, collection_id = ?3, project_id = ?4, sort_order = ?5, version = ?6, updated_at = ?7 WHERE id = ?8 AND version = ?9",
            turso::params![new_name.as_str(), new_config.as_str(), new_collection_id.as_deref(), new_project_id.as_str(), new_sort_order, new_version, now, id, old_version],
        )
        .await?;
        if affected == 0 {
            return Err(format!("Request {} was modified or deleted concurrently", id).into());
        }
    }

    // Build change summary
    let mut changes = Vec::new();
    if name.is_some() && new_name != old_name {
        changes.push(format!("Renamed from '{}' to '{}'", old_name, new_name));
    }
    if config.is_some() && new_config != old_config {
        changes.push("Updated request config".to_string());
    }
    if (move_to_root || collection_id.is_some()) && new_collection_id != old_collection_id {
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
        "project_id": { "old": old_project_id, "new": new_project_id },
    });

    super::changelog::insert_changelog(
        "request",
        id,
        &new_name,
        new_version,
        &summary,
        Some(&diff.to_string()),
    )
    .await?;

    Ok(ApiRequest {
        id: id.to_string(),
        collection_id: new_collection_id,
        project_id: Some(new_project_id),
        name: new_name,
        sort_order: new_sort_order,
        config: new_config,
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
            "SELECT id, collection_id, project_id, name, sort_order, config, version, created_at, updated_at FROM api_requests WHERE id = ?1",
            turso::params![id],
        )
        .await?;

    if let Some(row) = rows.next().await? {
        Ok(Some(ApiRequest {
            id: row.get(0)?,
            collection_id: row.get::<Option<String>>(1)?,
            project_id: row.get::<Option<String>>(2)?,
            name: row.get(3)?,
            sort_order: row.get(4)?,
            config: row.get(5)?,
            version: row.get(6)?,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
        }))
    } else {
        Ok(None)
    }
}

pub async fn list_requests(collection_id: &str) -> DbResult<Vec<ApiRequest>> {
    let conn = get_connection()?.lock().await;
    let mut rows = conn
        .query(
            "SELECT id, collection_id, project_id, name, sort_order, config, version, created_at, updated_at FROM api_requests WHERE collection_id = ?1 ORDER BY sort_order, name",
            turso::params![collection_id],
        )
        .await?;

    let mut requests = Vec::new();
    while let Some(row) = rows.next().await? {
        requests.push(ApiRequest {
            id: row.get(0)?,
            collection_id: row.get::<Option<String>>(1)?,
            project_id: row.get::<Option<String>>(2)?,
            name: row.get(3)?,
            sort_order: row.get(4)?,
            config: row.get(5)?,
            version: row.get(6)?,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
        });
    }

    Ok(requests)
}

pub async fn list_root_requests(project_id: &str) -> DbResult<Vec<ApiRequest>> {
    let conn = get_connection()?.lock().await;
    let mut rows = conn
        .query(
            "SELECT id, collection_id, project_id, name, sort_order, config, version, created_at, updated_at FROM api_requests WHERE collection_id IS NULL AND project_id = ?1 ORDER BY sort_order, name",
            turso::params![project_id],
        )
        .await?;

    let mut requests = Vec::new();
    while let Some(row) = rows.next().await? {
        requests.push(ApiRequest {
            id: row.get(0)?,
            collection_id: row.get::<Option<String>>(1)?,
            project_id: row.get::<Option<String>>(2)?,
            name: row.get(3)?,
            sort_order: row.get(4)?,
            config: row.get(5)?,
            version: row.get(6)?,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
        });
    }
    Ok(requests)
}

pub async fn count_requests_in_collection(collection_id: &str) -> DbResult<i64> {
    let conn = get_connection()?.lock().await;
    let mut rows = conn
        .query(
            "SELECT COUNT(*) FROM api_requests WHERE collection_id = ?1",
            turso::params![collection_id],
        )
        .await?;
    if let Some(row) = rows.next().await? {
        Ok(row.get(0)?)
    } else {
        Ok(0)
    }
}

pub async fn duplicate_request(id: &str, new_id: &str) -> DbResult<ApiRequest> {
    let original = get_request(id)
        .await?
        .ok_or_else(|| format!("Request {} not found", id))?;

    let new_name = format!("{} (copy)", original.name);
    let project_id = original
        .project_id
        .as_deref()
        .ok_or_else(|| format!("Request {} has no project_id", id))?;
    create_request(
        new_id,
        original.collection_id.as_deref(),
        project_id,
        &new_name,
        Some(&original.config),
    )
    .await
}
