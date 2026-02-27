use super::{get_connection, DbResult};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataModel {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub description: Option<String>,
    pub fields: String, // JSON array
    pub sort_order: i64,
    pub version: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

pub fn get_table_sql() -> &'static str {
    "
    CREATE TABLE IF NOT EXISTS data_models (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        fields TEXT NOT NULL DEFAULT '[]',
        sort_order INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_data_models_project ON data_models(project_id);
    "
}

/// Represents a single field entry in the fields JSON array.
/// Used only for validation before storing.
#[derive(Deserialize)]
pub struct ModelField {
    pub name: String,
    pub field_type: String,
    pub description: String,
    pub required: bool,
    pub example: Option<String>,
    pub ref_model_id: Option<String>,
}

/// Validate that every non-null `ref_model_id` in `fields_json` refers to
/// a data_model that exists within `project_id`.
pub async fn validate_model_refs(project_id: &str, fields_json: &str) -> DbResult<()> {
    let fields: Vec<ModelField> = serde_json::from_str(fields_json)
        .map_err(|e| format!("Invalid fields JSON: {}", e))?;

    for field in &fields {
        if let Some(ref ref_id) = field.ref_model_id {
            let conn = get_connection()?.lock().await;
            let mut rows = conn
                .query(
                    "SELECT id FROM data_models WHERE id = ?1 AND project_id = ?2",
                    turso::params![ref_id.clone(), project_id],
                )
                .await?;
            let exists = rows.next().await?.is_some();
            drop(rows);
            drop(conn);

            if !exists {
                return Err(format!(
                    "ref_model_id '{}' does not exist in project '{}'",
                    ref_id, project_id
                )
                .into());
            }
        }
    }

    Ok(())
}

pub async fn create_model(
    id: &str,
    project_id: &str,
    name: &str,
    description: Option<&str>,
    fields: Option<&str>,
) -> DbResult<DataModel> {
    let conn = get_connection()?.lock().await;
    let now = chrono::Utc::now().timestamp_millis();
    let fields_str = fields.unwrap_or("[]").to_string();

    conn.execute(
        "INSERT INTO data_models (id, project_id, name, description, fields, sort_order, version, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 0, 1, ?6, ?6)",
        turso::params![id, project_id, name, description, fields_str.clone(), now],
    )
    .await?;

    drop(conn);
    super::changelog::insert_changelog("model", id, name, 1, "Created model", None).await?;

    Ok(DataModel {
        id: id.to_string(),
        project_id: project_id.to_string(),
        name: name.to_string(),
        description: description.map(str::to_string),
        fields: fields_str,
        sort_order: 0,
        version: 1,
        created_at: now,
        updated_at: now,
    })
}

pub async fn update_model(
    id: &str,
    name: Option<&str>,
    description: Option<Option<&str>>,
    fields: Option<&str>,
    sort_order: Option<i64>,
) -> DbResult<DataModel> {
    let conn = get_connection()?.lock().await;

    let mut rows = conn
        .query(
            "SELECT id, project_id, name, description, fields, sort_order, version, created_at, updated_at FROM data_models WHERE id = ?1",
            turso::params![id],
        )
        .await?;

    let row = rows
        .next()
        .await?
        .ok_or_else(|| format!("Model {} not found", id))?;

    let old_project_id: String = row.get(1)?;
    let old_name: String = row.get(2)?;
    let old_description: Option<String> = row.get(3)?;
    let old_fields: String = row.get(4)?;
    let old_sort_order: i64 = row.get(5)?;
    let old_version: i64 = row.get(6)?;
    let created_at: i64 = row.get(7)?;
    drop(rows);

    let new_name = name.unwrap_or(&old_name);
    let new_description: Option<String> = match description {
        Some(Some(d)) => Some(d.to_string()),
        Some(None) => None,
        None => old_description.clone(),
    };
    let new_fields = fields.unwrap_or(&old_fields);
    let new_sort_order = sort_order.unwrap_or(old_sort_order);
    let new_version = old_version + 1;
    let now = chrono::Utc::now().timestamp_millis();

    conn.execute(
        "UPDATE data_models SET name = ?1, description = ?2, fields = ?3, sort_order = ?4, version = ?5, updated_at = ?6 WHERE id = ?7",
        turso::params![new_name, new_description.as_deref(), new_fields, new_sort_order, new_version, now, id],
    )
    .await?;

    // Build change summary
    let mut changes = Vec::new();
    if name.is_some() && new_name != old_name {
        changes.push(format!("Renamed from '{}' to '{}'", old_name, new_name));
    }
    if description.is_some() && new_description != old_description {
        changes.push("Updated description".to_string());
    }
    if fields.is_some() && new_fields != old_fields {
        changes.push("Updated fields".to_string());
    }
    if sort_order.is_some() && new_sort_order != old_sort_order {
        changes.push("Reordered".to_string());
    }
    let summary = if changes.is_empty() {
        "Updated model".to_string()
    } else {
        changes.join("; ")
    };

    let diff = serde_json::json!({
        "name": { "old": old_name, "new": new_name },
        "description": { "old": old_description, "new": new_description },
        "fields": { "old": old_fields, "new": new_fields },
        "sort_order": { "old": old_sort_order, "new": new_sort_order },
    });

    drop(conn);
    super::changelog::insert_changelog(
        "model",
        id,
        new_name,
        new_version,
        &summary,
        Some(&diff.to_string()),
    )
    .await?;

    Ok(DataModel {
        id: id.to_string(),
        project_id: old_project_id,
        name: new_name.to_string(),
        description: new_description,
        fields: new_fields.to_string(),
        sort_order: new_sort_order,
        version: new_version,
        created_at,
        updated_at: now,
    })
}

pub async fn delete_model(id: &str) -> DbResult<()> {
    // Step 1: Read the model to be deleted
    let conn = get_connection()?.lock().await;

    let mut rows = conn
        .query(
            "SELECT name, version, project_id FROM data_models WHERE id = ?1",
            turso::params![id],
        )
        .await?;
    let row = rows
        .next()
        .await?
        .ok_or_else(|| format!("Model {} not found", id))?;
    let name: String = row.get(0)?;
    let version: i64 = row.get(1)?;
    let project_id: String = row.get(2)?;
    drop(rows);

    // Step 2: Find all sibling models that reference this model via ref_model_id in their fields
    let mut rows = conn
        .query(
            "SELECT id, fields FROM data_models WHERE project_id = ?1 AND id != ?2",
            turso::params![project_id, id],
        )
        .await?;

    let mut siblings: Vec<(String, String)> = Vec::new();
    while let Some(row) = rows.next().await? {
        let sibling_id: String = row.get(0)?;
        let sibling_fields: String = row.get(1)?;
        siblings.push((sibling_id, sibling_fields));
    }
    drop(rows);

    // Step 3: For each sibling, null out any ref_model_id pointing to the deleted model
    for (sibling_id, sibling_fields_json) in siblings {
        let mut fields: Vec<serde_json::Value> =
            serde_json::from_str(&sibling_fields_json).unwrap_or_default();

        let mut changed = false;
        for field in fields.iter_mut() {
            if let Some(ref_id) = field.get("ref_model_id").and_then(|v| v.as_str()) {
                if ref_id == id {
                    field
                        .as_object_mut()
                        .unwrap()
                        .insert("ref_model_id".to_string(), serde_json::Value::Null);
                    changed = true;
                }
            }
        }

        if changed {
            let updated_fields =
                serde_json::to_string(&fields).unwrap_or_else(|_| "[]".to_string());
            conn.execute(
                "UPDATE data_models SET fields = ?1, updated_at = ?2 WHERE id = ?3",
                turso::params![
                    updated_fields,
                    chrono::Utc::now().timestamp_millis(),
                    sibling_id
                ],
            )
            .await?;
        }
    }

    // Step 4: Delete the model
    conn.execute("DELETE FROM data_models WHERE id = ?1", turso::params![id])
        .await?;

    drop(conn);
    super::changelog::insert_changelog("model", id, &name, version + 1, "Deleted model", None)
        .await?;

    Ok(())
}

pub async fn get_model(id: &str) -> DbResult<Option<DataModel>> {
    let conn = get_connection()?.lock().await;
    let mut rows = conn
        .query(
            "SELECT id, project_id, name, description, fields, sort_order, version, created_at, updated_at FROM data_models WHERE id = ?1",
            turso::params![id],
        )
        .await?;

    if let Some(row) = rows.next().await? {
        Ok(Some(DataModel {
            id: row.get(0)?,
            project_id: row.get(1)?,
            name: row.get(2)?,
            description: row.get(3)?,
            fields: row.get(4)?,
            sort_order: row.get(5)?,
            version: row.get(6)?,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
        }))
    } else {
        Ok(None)
    }
}

pub async fn list_models(project_id: &str) -> DbResult<Vec<DataModel>> {
    let conn = get_connection()?.lock().await;
    let mut rows = conn
        .query(
            "SELECT id, project_id, name, description, fields, sort_order, version, created_at, updated_at FROM data_models WHERE project_id = ?1 ORDER BY sort_order, name",
            turso::params![project_id],
        )
        .await?;

    let mut models = Vec::new();
    while let Some(row) = rows.next().await? {
        models.push(DataModel {
            id: row.get(0)?,
            project_id: row.get(1)?,
            name: row.get(2)?,
            description: row.get(3)?,
            fields: row.get(4)?,
            sort_order: row.get(5)?,
            version: row.get(6)?,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
        });
    }

    Ok(models)
}
