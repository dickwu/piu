use super::{get_connection, DbResult};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

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
    pub parent_model_id: Option<String>,
    pub mixin_model_ids: String, // JSON array, default "[]"
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
        updated_at INTEGER NOT NULL,
        parent_model_id TEXT DEFAULT NULL,
        mixin_model_ids TEXT NOT NULL DEFAULT '[]'
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

/// Pending changelog entry to be written after a transaction commits.
struct PendingChangelog {
    entity_type: &'static str,
    entity_id: String,
    entity_name: String,
    version: i64,
    summary: String,
    diff: Option<String>,
}

/// Validate that every non-null `ref_model_id` in `fields_json` refers to
/// a data_model that exists within `project_id`.
pub async fn validate_model_refs(project_id: &str, fields_json: &str) -> DbResult<()> {
    let fields: Vec<ModelField> =
        serde_json::from_str(fields_json).map_err(|e| format!("Invalid fields JSON: {}", e))?;

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
    parent_model_id: Option<&str>,
    mixin_model_ids: Option<&str>,
) -> DbResult<DataModel> {
    let conn = get_connection()?.lock().await;
    let now = chrono::Utc::now().timestamp_millis();
    let fields_str = fields.unwrap_or("[]").to_string();
    let mixin_str = mixin_model_ids.unwrap_or("[]").to_string();

    conn.execute(
        "INSERT INTO data_models (id, project_id, name, description, fields, sort_order, version, created_at, updated_at, parent_model_id, mixin_model_ids)
         VALUES (?1, ?2, ?3, ?4, ?5, 0, 1, ?6, ?6, ?7, ?8)",
        turso::params![id, project_id, name, description, fields_str.clone(), now, parent_model_id, mixin_str.clone()],
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
        parent_model_id: parent_model_id.map(str::to_string),
        mixin_model_ids: mixin_str,
    })
}

pub async fn update_model(
    id: &str,
    name: Option<&str>,
    description: Option<Option<&str>>,
    fields: Option<&str>,
    sort_order: Option<i64>,
    parent_model_id: Option<Option<&str>>,
    mixin_model_ids: Option<&str>,
) -> DbResult<DataModel> {
    let conn = get_connection()?.lock().await;

    let mut rows = conn
        .query(
            "SELECT id, project_id, name, description, fields, sort_order, version, created_at, updated_at, parent_model_id, mixin_model_ids FROM data_models WHERE id = ?1",
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
    let old_parent_model_id: Option<String> = row.get(9)?;
    let old_mixin_model_ids: String = row.get(10)?;
    drop(rows);

    let new_name = name.unwrap_or(&old_name);
    let new_description: Option<String> = match description {
        Some(Some(d)) => Some(d.to_string()),
        Some(None) => None,
        None => old_description.clone(),
    };
    let new_fields = fields.unwrap_or(&old_fields);
    let new_sort_order = sort_order.unwrap_or(old_sort_order);
    let new_parent_model_id: Option<String> = match parent_model_id {
        Some(Some(p)) => Some(p.to_string()),
        Some(None) => None,
        None => old_parent_model_id.clone(),
    };
    let new_mixin_model_ids = mixin_model_ids.unwrap_or(&old_mixin_model_ids).to_string();
    let new_version = old_version + 1;
    let now = chrono::Utc::now().timestamp_millis();

    conn.execute(
        "UPDATE data_models SET name = ?1, description = ?2, fields = ?3, sort_order = ?4, version = ?5, updated_at = ?6, parent_model_id = ?7, mixin_model_ids = ?8 WHERE id = ?9",
        turso::params![new_name, new_description.as_deref(), new_fields, new_sort_order, new_version, now, new_parent_model_id.as_deref(), new_mixin_model_ids.as_str(), id],
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
    if parent_model_id.is_some() && new_parent_model_id != old_parent_model_id {
        changes.push("Updated parent model".to_string());
    }
    if mixin_model_ids.is_some() && new_mixin_model_ids != old_mixin_model_ids {
        changes.push("Updated mixin models".to_string());
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
        "parent_model_id": { "old": old_parent_model_id, "new": new_parent_model_id },
        "mixin_model_ids": { "old": old_mixin_model_ids, "new": new_mixin_model_ids },
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
        parent_model_id: new_parent_model_id,
        mixin_model_ids: new_mixin_model_ids,
    })
}

pub async fn delete_model(id: &str) -> DbResult<()> {
    // All DB mutations happen inside a single transaction.
    // The inner async block collects all work; on any `?` failure the outer
    // code executes ROLLBACK before propagating the error.
    // Changelog writes (which need the same mutex) are deferred until after COMMIT.

    let now = chrono::Utc::now().timestamp_millis();
    let pending_changelogs: Vec<PendingChangelog>;

    {
        let conn = get_connection()?.lock().await;
        conn.execute("BEGIN", ()).await?;

        let result: Result<Vec<PendingChangelog>, Box<dyn std::error::Error + Send + Sync>> =
            async {
                let mut changelogs: Vec<PendingChangelog> = Vec::new();

                // Step 1: Read the model to be deleted
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

                // Step 2: Find children (WHERE parent_model_id = id) — set parent_model_id = NULL
                let mut rows = conn
                    .query(
                        "SELECT id, name, version FROM data_models WHERE parent_model_id = ?1",
                        turso::params![id],
                    )
                    .await?;
                let mut children: Vec<(String, String, i64)> = Vec::new();
                while let Some(row) = rows.next().await? {
                    let child_id: String = row.get(0)?;
                    let child_name: String = row.get(1)?;
                    let child_version: i64 = row.get(2)?;
                    children.push((child_id, child_name, child_version));
                }
                drop(rows);

                for (child_id, child_name, child_version) in &children {
                    let new_child_version = child_version + 1;
                    conn.execute(
                        "UPDATE data_models SET parent_model_id = NULL, version = ?1, updated_at = ?2 WHERE id = ?3",
                        turso::params![new_child_version, now, child_id.as_str()],
                    )
                    .await?;
                    let child_diff = serde_json::json!({
                        "parent_model_id": { "old": id, "new": null }
                    });
                    changelogs.push(PendingChangelog {
                        entity_type: "model",
                        entity_id: child_id.clone(),
                        entity_name: child_name.clone(),
                        version: new_child_version,
                        summary: format!(
                            "Parent model '{}' deleted; parent_model_id cleared",
                            name
                        ),
                        diff: Some(child_diff.to_string()),
                    });
                }

                // Step 3: Find siblings that list the deleted model in mixin_model_ids
                let mut rows = conn
                    .query(
                        "SELECT id, name, version, mixin_model_ids FROM data_models WHERE project_id = ?1 AND id != ?2",
                        turso::params![project_id.as_str(), id],
                    )
                    .await?;
                let mut mixin_siblings: Vec<(String, String, i64, String)> = Vec::new();
                while let Some(row) = rows.next().await? {
                    let sib_id: String = row.get(0)?;
                    let sib_name: String = row.get(1)?;
                    let sib_version: i64 = row.get(2)?;
                    let sib_mixin_json: String = row.get(3)?;
                    mixin_siblings.push((sib_id, sib_name, sib_version, sib_mixin_json));
                }
                drop(rows);

                for (sib_id, sib_name, sib_version, sib_mixin_json) in &mixin_siblings {
                    // HARD ERROR on malformed JSON — abort transaction, never unwrap_or_default
                    let mut mixin_ids: Vec<serde_json::Value> =
                        serde_json::from_str(sib_mixin_json).map_err(|e| {
                            format!(
                                "Malformed mixin_model_ids JSON for model '{}': {}",
                                sib_id, e
                            )
                        })?;

                    let before_len = mixin_ids.len();
                    mixin_ids.retain(|v| v.as_str() != Some(id));

                    if mixin_ids.len() < before_len {
                        let new_mixin_json = serde_json::to_string(&mixin_ids)
                            .map_err(|e| format!("Failed to serialize mixin_model_ids: {}", e))?;
                        let new_sib_version = sib_version + 1;

                        conn.execute(
                            "UPDATE data_models SET mixin_model_ids = ?1, version = ?2, updated_at = ?3 WHERE id = ?4",
                            turso::params![new_mixin_json.as_str(), new_sib_version, now, sib_id.as_str()],
                        )
                        .await?;

                        let sib_diff = serde_json::json!({
                            "mixin_model_ids": { "old": sib_mixin_json, "new": new_mixin_json }
                        });
                        changelogs.push(PendingChangelog {
                            entity_type: "model",
                            entity_id: sib_id.clone(),
                            entity_name: sib_name.clone(),
                            version: new_sib_version,
                            summary: format!(
                                "Mixin model '{}' deleted; removed from mixin list",
                                name
                            ),
                            diff: Some(sib_diff.to_string()),
                        });
                    }
                }

                // Step 4: Find siblings with fields referencing deleted model via ref_model_id.
                // Query all siblings in the project; filter for changed ones in Rust.
                let mut rows = conn
                    .query(
                        "SELECT id, name, version, fields FROM data_models WHERE project_id = ?1 AND id != ?2",
                        turso::params![project_id.as_str(), id],
                    )
                    .await?;
                let mut field_ref_siblings: Vec<(String, String, i64, String)> = Vec::new();
                while let Some(row) = rows.next().await? {
                    let sib_id: String = row.get(0)?;
                    let sib_name: String = row.get(1)?;
                    let sib_version: i64 = row.get(2)?;
                    let sib_fields: String = row.get(3)?;
                    field_ref_siblings.push((sib_id, sib_name, sib_version, sib_fields));
                }
                drop(rows);

                for (sib_id, sib_name, sib_version, sib_fields_json) in &field_ref_siblings {
                    let mut fields: Vec<serde_json::Value> =
                        serde_json::from_str(sib_fields_json).map_err(|e| {
                            format!("Malformed fields JSON for model '{}': {}", sib_id, e)
                        })?;

                    let mut changed = false;
                    for field in fields.iter_mut() {
                        if let Some(ref_id) = field.get("ref_model_id").and_then(|v| v.as_str()) {
                            if ref_id == id {
                                if let Some(obj) = field.as_object_mut() {
                                    obj.insert(
                                        "ref_model_id".to_string(),
                                        serde_json::Value::Null,
                                    );
                                    changed = true;
                                }
                            }
                        }
                    }

                    if changed {
                        let updated_fields = serde_json::to_string(&fields).map_err(|e| {
                            format!("Failed to serialize fields for model '{}': {}", sib_id, e)
                        })?;
                        let new_sib_version = sib_version + 1;

                        conn.execute(
                            "UPDATE data_models SET fields = ?1, version = ?2, updated_at = ?3 WHERE id = ?4",
                            turso::params![updated_fields.as_str(), new_sib_version, now, sib_id.as_str()],
                        )
                        .await?;

                        let field_diff = serde_json::json!({
                            "fields": { "old": sib_fields_json, "new": updated_fields }
                        });
                        changelogs.push(PendingChangelog {
                            entity_type: "model",
                            entity_id: sib_id.clone(),
                            entity_name: sib_name.clone(),
                            version: new_sib_version,
                            summary: format!("Field ref to deleted model '{}' cleared", name),
                            diff: Some(field_diff.to_string()),
                        });
                    }
                }

                // Step 5: Find api_requests with config referencing this model (requestModelId / responseModelId)
                let mut rows = conn
                    .query(
                        "SELECT r.id, r.config FROM api_requests r
                         INNER JOIN collections c ON r.collection_id = c.id
                         WHERE c.project_id = ?1",
                        turso::params![project_id.as_str()],
                    )
                    .await?;
                let mut requests: Vec<(String, String)> = Vec::new();
                while let Some(row) = rows.next().await? {
                    let req_id: String = row.get(0)?;
                    let req_config: String = row.get(1)?;
                    requests.push((req_id, req_config));
                }
                drop(rows);

                for (req_id, req_config_json) in &requests {
                    let mut config: serde_json::Value =
                        serde_json::from_str(req_config_json).map_err(|e| {
                            format!("Malformed config JSON for request '{}': {}", req_id, e)
                        })?;

                    let mut config_changed = false;
                    if let Some(obj) = config.as_object_mut() {
                        if let Some(req_model_id) =
                            obj.get("requestModelId").and_then(|v| v.as_str())
                        {
                            if req_model_id == id {
                                obj.insert(
                                    "requestModelId".to_string(),
                                    serde_json::Value::Null,
                                );
                                config_changed = true;
                            }
                        }
                        if let Some(resp_model_id) =
                            obj.get("responseModelId").and_then(|v| v.as_str())
                        {
                            if resp_model_id == id {
                                obj.insert(
                                    "responseModelId".to_string(),
                                    serde_json::Value::Null,
                                );
                                config_changed = true;
                            }
                        }
                    }

                    if config_changed {
                        let updated_config =
                            serde_json::to_string(&config).map_err(|e| {
                                format!(
                                    "Failed to serialize config for request '{}': {}",
                                    req_id, e
                                )
                            })?;

                        conn.execute(
                            "UPDATE api_requests SET config = ?1, version = version + 1, updated_at = ?2 WHERE id = ?3",
                            turso::params![updated_config.as_str(), now, req_id.as_str()],
                        )
                        .await?;
                    }
                }

                // Step 6: Delete the model
                conn.execute("DELETE FROM data_models WHERE id = ?1", turso::params![id])
                    .await?;

                // Step 7: Commit
                conn.execute("COMMIT", ()).await?;

                // Enqueue the deletion changelog
                changelogs.push(PendingChangelog {
                    entity_type: "model",
                    entity_id: id.to_string(),
                    entity_name: name,
                    version: version + 1,
                    summary: "Deleted model".to_string(),
                    diff: None,
                });

                Ok(changelogs)
            }
            .await;

        match result {
            Ok(changelogs) => {
                pending_changelogs = changelogs;
            }
            Err(e) => {
                let _ = conn.execute("ROLLBACK", ()).await;
                return Err(e);
            }
        }
    } // conn guard dropped here — mutex is free

    // Write all pending changelog entries now that the mutex is released
    for entry in pending_changelogs {
        super::changelog::insert_changelog(
            entry.entity_type,
            &entry.entity_id,
            &entry.entity_name,
            entry.version,
            &entry.summary,
            entry.diff.as_deref(),
        )
        .await?;
    }

    Ok(())
}

pub async fn get_model(id: &str) -> DbResult<Option<DataModel>> {
    let conn = get_connection()?.lock().await;
    let mut rows = conn
        .query(
            "SELECT id, project_id, name, description, fields, sort_order, version, created_at, updated_at, parent_model_id, mixin_model_ids FROM data_models WHERE id = ?1",
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
            parent_model_id: row.get(9)?,
            mixin_model_ids: row.get(10)?,
        }))
    } else {
        Ok(None)
    }
}

pub async fn list_models(project_id: &str) -> DbResult<Vec<DataModel>> {
    let conn = get_connection()?.lock().await;
    let mut rows = conn
        .query(
            "SELECT id, project_id, name, description, fields, sort_order, version, created_at, updated_at, parent_model_id, mixin_model_ids FROM data_models WHERE project_id = ?1 ORDER BY sort_order, name",
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
            parent_model_id: row.get(9)?,
            mixin_model_ids: row.get(10)?,
        });
    }

    Ok(models)
}

/// Validate that the proposed inheritance graph for a model contains no cycles
/// and all referenced IDs exist within the project.
///
/// # Arguments
/// * `project_id` — The project all models belong to.
/// * `model_id` — The model being edited.
/// * `proposed_parent_id` — The proposed new parent (None = no parent).
/// * `proposed_mixin_ids` — The proposed new mixin list (owned strings).
pub async fn validate_model_graph(
    project_id: &str,
    model_id: &str,
    proposed_parent_id: Option<&str>,
    proposed_mixin_ids: &[String],
) -> DbResult<()> {
    const MAX_DEPTH: usize = 10;

    // 1. Load ALL models in the project
    let all_models = list_models(project_id).await?;
    let model_map: HashMap<String, DataModel> =
        all_models.into_iter().map(|m| (m.id.clone(), m)).collect();

    // 2. Validate model_id exists in project
    if !model_map.contains_key(model_id) {
        return Err(format!(
            "Model '{}' does not exist in project '{}'",
            model_id, project_id
        )
        .into());
    }

    // 3. Validate proposed_parent_id exists in project and is not self
    if let Some(parent_id) = proposed_parent_id {
        if parent_id == model_id {
            return Err("A model cannot inherit from itself (self-reference in parent)".into());
        }
        if !model_map.contains_key(parent_id) {
            return Err(format!(
                "Proposed parent_model_id '{}' does not exist in project '{}'",
                parent_id, project_id
            )
            .into());
        }
    }

    // 4. Validate proposed_mixin_ids — no self-references, no duplicates, all exist
    let mut seen_mixin_ids: HashSet<&str> = HashSet::new();
    for mixin_id in proposed_mixin_ids {
        if mixin_id == model_id {
            return Err("A model cannot mix itself in (self-reference in mixins)".into());
        }
        if !seen_mixin_ids.insert(mixin_id.as_str()) {
            return Err(format!("Duplicate mixin_model_id '{}' in proposed list", mixin_id).into());
        }
        if !model_map.contains_key(mixin_id.as_str()) {
            return Err(format!(
                "Proposed mixin_model_id '{}' does not exist in project '{}'",
                mixin_id, project_id
            )
            .into());
        }
    }

    // 5. Build adjacency list using proposed values for model_id, stored values for others.
    //    Each node's edges = [parent_model_id] + mixin_model_ids.
    //    We store owned Strings so there are no lifetime issues with local temporaries.
    let mut adjacency: HashMap<String, Vec<String>> = HashMap::new();

    for (mid, model) in &model_map {
        if mid == model_id {
            // Use proposed values for the model being validated
            let mut edges: Vec<String> = Vec::new();
            if let Some(pid) = proposed_parent_id {
                edges.push(pid.to_string());
            }
            for mixin_id in proposed_mixin_ids {
                edges.push(mixin_id.clone());
            }
            adjacency.insert(mid.clone(), edges);
        } else {
            let mut edges: Vec<String> = Vec::new();
            if let Some(ref pid) = model.parent_model_id {
                edges.push(pid.clone());
            }
            // Parse mixin_model_ids — hard error on malformed JSON
            let mixin_vals: Vec<String> =
                serde_json::from_str(&model.mixin_model_ids).map_err(|e| {
                    format!("Malformed mixin_model_ids JSON for model '{}': {}", mid, e)
                })?;
            for mixin_id in mixin_vals {
                edges.push(mixin_id);
            }
            adjacency.insert(mid.clone(), edges);
        }
    }

    // 6. DFS from model_id to detect cycles (max depth 10)
    let mut visited: HashSet<String> = HashSet::new();
    let mut path: Vec<String> = Vec::new();
    dfs_detect_cycle(
        model_id.to_string(),
        &adjacency,
        &mut visited,
        &mut path,
        0,
        MAX_DEPTH,
    )?;

    Ok(())
}

/// Recursive DFS cycle detector. Returns Err if a cycle involving the start node is found.
fn dfs_detect_cycle(
    node: String,
    adjacency: &HashMap<String, Vec<String>>,
    visited: &mut HashSet<String>,
    path: &mut Vec<String>,
    depth: usize,
    max_depth: usize,
) -> DbResult<()> {
    if depth > max_depth {
        return Err(format!(
            "Inheritance graph exceeds maximum depth of {} levels",
            max_depth
        )
        .into());
    }

    if visited.contains(&node) {
        return Err(format!(
            "Cycle detected in model inheritance graph: {} -> {}",
            path.join(" -> "),
            node
        )
        .into());
    }

    visited.insert(node.clone());
    path.push(node.clone());

    if let Some(neighbors) = adjacency.get(&node) {
        for neighbor in neighbors.clone() {
            dfs_detect_cycle(neighbor, adjacency, visited, path, depth + 1, max_depth)?;
        }
    }

    path.pop();
    visited.remove(&node);

    Ok(())
}
