use super::{get_connection, DbResult};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub sort_order: i64,
    pub version: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

pub fn get_table_sql() -> &'static str {
    "
    CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );
    "
}

const SELECT_COLUMNS: &str = "id, name, description, sort_order, version, created_at, updated_at";

fn project_from_row(row: &turso::Row) -> Result<Project, Box<dyn std::error::Error + Send + Sync>> {
    Ok(Project {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        sort_order: row.get(3)?,
        version: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

pub async fn create_project(id: &str, name: &str, description: Option<&str>) -> DbResult<Project> {
    let conn = get_connection()?.lock().await;
    let now = chrono::Utc::now().timestamp_millis();

    conn.execute(
        "INSERT INTO projects (id, name, description, sort_order, version, created_at, updated_at)
         VALUES (?1, ?2, ?3, 0, 1, ?4, ?4)",
        turso::params![id, name, description, now],
    )
    .await?;

    drop(conn);
    super::changelog::insert_changelog("project", id, name, 1, "Created project", None).await?;

    Ok(Project {
        id: id.to_string(),
        name: name.to_string(),
        description: description.map(|s| s.to_string()),
        sort_order: 0,
        version: 1,
        created_at: now,
        updated_at: now,
    })
}

pub async fn update_project(
    id: &str,
    name: Option<&str>,
    description: Option<Option<&str>>,
    sort_order: Option<i64>,
) -> DbResult<Project> {
    let conn = get_connection()?.lock().await;

    let mut rows = conn
        .query(
            &format!("SELECT {} FROM projects WHERE id = ?1", SELECT_COLUMNS),
            turso::params![id],
        )
        .await?;

    let row = rows
        .next()
        .await?
        .ok_or_else(|| format!("Project {} not found", id))?;

    let old = project_from_row(&row)?;
    drop(rows);

    let new_name = name.unwrap_or(&old.name);
    let new_description = description.unwrap_or(old.description.as_deref());
    let new_sort_order = sort_order.unwrap_or(old.sort_order);
    let new_version = old.version + 1;
    let now = chrono::Utc::now().timestamp_millis();

    conn.execute(
        "UPDATE projects SET name = ?1, description = ?2, sort_order = ?3, version = ?4, updated_at = ?5 WHERE id = ?6",
        turso::params![new_name, new_description, new_sort_order, new_version, now, id],
    )
    .await?;

    let mut changes = Vec::new();
    if name.is_some() && new_name != old.name {
        changes.push(format!("Renamed from '{}' to '{}'", old.name, new_name));
    }
    if description.is_some() && new_description != old.description.as_deref() {
        changes.push("Description updated".to_string());
    }
    if sort_order.is_some() && new_sort_order != old.sort_order {
        changes.push("Reordered".to_string());
    }
    let summary = if changes.is_empty() {
        "Updated project".to_string()
    } else {
        changes.join("; ")
    };

    let diff = serde_json::json!({
        "name": { "old": old.name, "new": new_name },
        "description": { "old": old.description, "new": new_description },
        "sort_order": { "old": old.sort_order, "new": new_sort_order },
    });

    drop(conn);
    super::changelog::insert_changelog(
        "project",
        id,
        new_name,
        new_version,
        &summary,
        Some(&diff.to_string()),
    )
    .await?;

    Ok(Project {
        id: id.to_string(),
        name: new_name.to_string(),
        description: new_description.map(|s| s.to_string()),
        sort_order: new_sort_order,
        version: new_version,
        created_at: old.created_at,
        updated_at: now,
    })
}

pub async fn delete_project(id: &str) -> DbResult<()> {
    let conn = get_connection()?.lock().await;

    let mut rows = conn
        .query(
            "SELECT name, version FROM projects WHERE id = ?1",
            turso::params![id],
        )
        .await?;
    let row = rows
        .next()
        .await?
        .ok_or_else(|| format!("Project {} not found", id))?;
    let name: String = row.get(0)?;
    let version: i64 = row.get(1)?;
    drop(rows);

    conn.execute("DELETE FROM projects WHERE id = ?1", turso::params![id])
        .await?;

    drop(conn);
    super::changelog::insert_changelog("project", id, &name, version + 1, "Deleted project", None)
        .await?;

    Ok(())
}

pub async fn get_project(id: &str) -> DbResult<Option<Project>> {
    let conn = get_connection()?.lock().await;
    let mut rows = conn
        .query(
            &format!("SELECT {} FROM projects WHERE id = ?1", SELECT_COLUMNS),
            turso::params![id],
        )
        .await?;

    if let Some(row) = rows.next().await? {
        Ok(Some(project_from_row(&row)?))
    } else {
        Ok(None)
    }
}

pub async fn list_projects() -> DbResult<Vec<Project>> {
    let conn = get_connection()?.lock().await;
    let mut rows = conn
        .query(
            &format!(
                "SELECT {} FROM projects ORDER BY sort_order, name",
                SELECT_COLUMNS
            ),
            (),
        )
        .await?;

    let mut projects = Vec::new();
    while let Some(row) = rows.next().await? {
        projects.push(project_from_row(&row)?);
    }

    Ok(projects)
}
