use crate::db;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Deserialize)]
pub struct CreateModelInput {
    pub project_id: String,
    pub name: String,
    pub description: Option<String>,
    pub fields: Option<String>,
    pub parent_model_id: Option<String>,
    pub mixin_model_ids: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateModelInput {
    pub id: String,
    pub name: Option<String>,
    pub description: Option<Option<String>>,
    pub fields: Option<String>,
    pub sort_order: Option<i64>,
    pub parent_model_id: Option<Option<String>>,
    pub mixin_model_ids: Option<String>,
}

#[tauri::command]
pub async fn create_model(input: CreateModelInput) -> Result<db::DataModel, String> {
    if let Some(ref fields_json) = input.fields {
        db::validate_model_refs(&input.project_id, fields_json)
            .await
            .map_err(|e| e.to_string())?;
    }

    // Validate inheritance graph before creating
    let proposed_parent = input.parent_model_id.as_deref();
    let proposed_mixins: Vec<String> = if let Some(ref mixin_json) = input.mixin_model_ids {
        serde_json::from_str(mixin_json)
            .map_err(|e| format!("Invalid mixin_model_ids JSON: {}", e))?
    } else {
        Vec::new()
    };

    // Only validate graph if any inheritance is proposed
    if proposed_parent.is_some() || !proposed_mixins.is_empty() {
        // For a new model, the graph validation must be done after insert since the model
        // doesn't exist yet. We validate that the referenced parents/mixins exist in the project
        // by checking each individually.
        if let Some(parent_id) = proposed_parent {
            let parent_exists = db::get_model(parent_id)
                .await
                .map_err(|e| e.to_string())?
                .map(|m| m.project_id == input.project_id)
                .unwrap_or(false);
            if !parent_exists {
                return Err(format!(
                    "parent_model_id '{}' does not exist in project '{}'",
                    parent_id, input.project_id
                ));
            }
        }
        for mixin_id in &proposed_mixins {
            let mixin_exists = db::get_model(mixin_id)
                .await
                .map_err(|e| e.to_string())?
                .map(|m| m.project_id == input.project_id)
                .unwrap_or(false);
            if !mixin_exists {
                return Err(format!(
                    "mixin_model_id '{}' does not exist in project '{}'",
                    mixin_id, input.project_id
                ));
            }
        }
    }

    let id = uuid::Uuid::new_v4().to_string();
    let model = db::create_model(
        &id,
        &input.project_id,
        &input.name,
        input.description.as_deref(),
        input.fields.as_deref(),
        input.parent_model_id.as_deref(),
        input.mixin_model_ids.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())?;

    // Validate graph after insert (model must exist in DB for cycle detection)
    if proposed_parent.is_some() || !proposed_mixins.is_empty() {
        if let Err(e) =
            db::validate_model_graph(&input.project_id, &id, proposed_parent, &proposed_mixins)
                .await
        {
            // Rollback: delete the model we just created
            let _ = db::delete_model(&id).await;
            return Err(e.to_string());
        }
    }

    Ok(model)
}

#[tauri::command]
pub async fn update_model(input: UpdateModelInput) -> Result<db::DataModel, String> {
    let model = db::get_model(&input.id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Model {} not found", input.id))?;

    if let Some(ref fields_json) = input.fields {
        db::validate_model_refs(&model.project_id, fields_json)
            .await
            .map_err(|e| e.to_string())?;
    }

    // Validate the inheritance graph if parent or mixin changes are proposed
    let has_parent_change = input.parent_model_id.is_some();
    let has_mixin_change = input.mixin_model_ids.is_some();

    if has_parent_change || has_mixin_change {
        let proposed_parent: Option<&str> = match &input.parent_model_id {
            Some(Some(p)) => Some(p.as_str()),
            Some(None) => None,
            None => model.parent_model_id.as_deref(),
        };

        let proposed_mixins: Vec<String> = if let Some(ref mixin_json) = input.mixin_model_ids {
            serde_json::from_str(mixin_json)
                .map_err(|e| format!("Invalid mixin_model_ids JSON: {}", e))?
        } else {
            serde_json::from_str(&model.mixin_model_ids)
                .map_err(|e| format!("Malformed stored mixin_model_ids: {}", e))?
        };

        db::validate_model_graph(
            &model.project_id,
            &input.id,
            proposed_parent,
            &proposed_mixins,
        )
        .await
        .map_err(|e| e.to_string())?;
    }

    db::update_model(
        &input.id,
        input.name.as_deref(),
        input.description.as_ref().map(|opt| opt.as_deref()),
        input.fields.as_deref(),
        input.sort_order,
        input.parent_model_id.as_ref().map(|opt| opt.as_deref()),
        input.mixin_model_ids.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_model(id: String) -> Result<(), String> {
    db::delete_model(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_model(id: String) -> Result<Option<db::DataModel>, String> {
    db::get_model(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_models(project_id: String) -> Result<Vec<db::DataModel>, String> {
    db::list_models(&project_id)
        .await
        .map_err(|e| e.to_string())
}

#[derive(Debug, Serialize)]
pub struct ResolvedModelField {
    pub name: String,
    pub field_type: String,
    pub description: String,
    pub required: bool,
    pub example: Option<String>,
    pub ref_model_id: Option<String>,
    pub origin: String,
    pub origin_model_id: String,
    pub origin_model_name: String,
    pub overridden: bool,
}

/// Walk the ancestor chain from `model` up to the root, returning ancestors
/// in oldest-first order (root first, immediate parent last).
/// Returns an error on cycle detection or exceeding max depth.
fn collect_ancestors(
    model: &db::DataModel,
    model_map: &HashMap<String, db::DataModel>,
    visited: &mut HashSet<String>,
) -> Result<Vec<String>, String> {
    const MAX_DEPTH: usize = 10;

    let mut chain: Vec<String> = Vec::new();
    let mut current_parent = model.parent_model_id.clone();
    let mut depth = 0;

    while let Some(parent_id) = current_parent {
        if visited.contains(&parent_id) {
            return Err(format!(
                "Cycle detected in model inheritance graph at model '{}'",
                parent_id
            ));
        }
        if depth >= MAX_DEPTH {
            return Err(format!(
                "Inheritance graph exceeds maximum depth of {} levels",
                MAX_DEPTH
            ));
        }

        let parent = model_map
            .get(&parent_id)
            .ok_or_else(|| format!("Parent model '{}' not found in project", parent_id))?;

        visited.insert(parent_id.clone());
        chain.push(parent_id.clone());
        current_parent = parent.parent_model_id.clone();
        depth += 1;
    }

    // Reverse so root is first, immediate parent is last
    chain.reverse();
    Ok(chain)
}

/// Extract fields from a model's JSON, mapping each to a `ResolvedModelField`
/// with the given `origin` tag. Returns an error if the fields JSON is malformed
/// or any required field attribute is missing.
fn extract_fields(model: &db::DataModel, origin: &str) -> Result<Vec<ResolvedModelField>, String> {
    let raw_fields: Vec<serde_json::Value> = serde_json::from_str(&model.fields).map_err(|e| {
        format!(
            "Malformed fields JSON for model '{}' ({}): {}",
            model.name, model.id, e
        )
    })?;

    let mut result = Vec::with_capacity(raw_fields.len());
    for (idx, field) in raw_fields.iter().enumerate() {
        let name = field
            .get("name")
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                format!(
                    "Field #{} in model '{}' is missing required 'name' attribute",
                    idx, model.name
                )
            })?
            .to_string();

        let field_type = field
            .get("field_type")
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                format!(
                    "Field '{}' in model '{}' is missing required 'field_type' attribute",
                    name, model.name
                )
            })?
            .to_string();

        let description = field
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let required = field
            .get("required")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let example = field
            .get("example")
            .and_then(|v| v.as_str())
            .map(str::to_string);

        let ref_model_id = field
            .get("ref_model_id")
            .and_then(|v| v.as_str())
            .map(str::to_string);

        result.push(ResolvedModelField {
            name,
            field_type,
            description,
            required,
            example,
            ref_model_id,
            origin: origin.to_string(),
            origin_model_id: model.id.clone(),
            origin_model_name: model.name.clone(),
            overridden: false,
        });
    }

    Ok(result)
}

/// Core linearization logic shared by `resolve_model_fields` and
/// `generate_json_from_model`. Returns the ordered, deduplicated list of
/// winning fields (one per name). Fields that were replaced by a later
/// declaration are omitted from the result (only the winner is returned
/// with `overridden: false`).
///
/// Linearization order (earlier entries lose to later ones):
///   1. Ancestor chain — oldest first → immediate parent last (origin = "parent")
///   2. Mixins declared on `model` — in declaration order (origin = "mixin")
///   3. Model's own fields (origin = "own")
fn resolve_fields_for_model(
    model: &db::DataModel,
    model_map: &HashMap<String, db::DataModel>,
) -> Result<Vec<ResolvedModelField>, String> {
    // Tracks visited IDs during ancestor walk to detect cycles
    let mut visited: HashSet<String> = HashSet::new();
    visited.insert(model.id.clone());

    // --- Step 1: Collect ancestor chain (root first) ---
    let ancestor_ids = collect_ancestors(model, model_map, &mut visited)?;

    // --- Step 2: Collect mixin IDs ---
    let mixin_ids: Vec<String> = serde_json::from_str(&model.mixin_model_ids).map_err(|e| {
        format!(
            "Malformed mixin_model_ids JSON for model '{}' ({}): {}",
            model.name, model.id, e
        )
    })?;

    // --- Step 3: Build ordered sequence of (model_ref, origin) pairs ---
    // Ancestors first (oldest → youngest), then mixins, then own
    let mut ordered_sources: Vec<(&db::DataModel, &str)> = Vec::new();

    for ancestor_id in &ancestor_ids {
        let ancestor = model_map
            .get(ancestor_id)
            .ok_or_else(|| format!("Ancestor model '{}' not found in project", ancestor_id))?;
        ordered_sources.push((ancestor, "parent"));
    }

    for mixin_id in &mixin_ids {
        let mixin = model_map
            .get(mixin_id)
            .ok_or_else(|| format!("Mixin model '{}' not found in project", mixin_id))?;
        ordered_sources.push((mixin, "mixin"));
    }

    ordered_sources.push((model, "own"));

    // --- Step 4: Merge fields; later entries override earlier by name ---
    // We use an ordered Vec<String> to preserve insertion order for the output,
    // plus a HashMap<name, usize> to track the index of the current winner.
    let mut field_order: Vec<String> = Vec::new();
    let mut winner_map: HashMap<String, ResolvedModelField> = HashMap::new();

    for (source_model, origin) in ordered_sources {
        let fields = extract_fields(source_model, origin)?;
        for field in fields {
            if !winner_map.contains_key(&field.name) {
                field_order.push(field.name.clone());
            }
            // Insert unconditionally — overrides previous winner
            winner_map.insert(field.name.clone(), field);
        }
    }

    // Reconstruct in insertion order
    let resolved: Vec<ResolvedModelField> = field_order
        .into_iter()
        .filter_map(|name| winner_map.remove(&name))
        .collect();

    Ok(resolved)
}

#[tauri::command]
pub async fn resolve_model_fields(model_id: String) -> Result<Vec<ResolvedModelField>, String> {
    let model = db::get_model(&model_id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Model {} not found", model_id))?;

    let all_models = db::list_models(&model.project_id)
        .await
        .map_err(|e| e.to_string())?;

    let model_map: HashMap<String, db::DataModel> =
        all_models.into_iter().map(|m| (m.id.clone(), m)).collect();

    resolve_fields_for_model(&model, &model_map)
}

#[tauri::command]
pub async fn generate_json_from_model(model_id: String) -> Result<String, String> {
    let model = db::get_model(&model_id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Model {} not found", model_id))?;

    let all_models = db::list_models(&model.project_id)
        .await
        .map_err(|e| e.to_string())?;

    let model_map: HashMap<String, db::DataModel> =
        all_models.into_iter().map(|m| (m.id.clone(), m)).collect();

    let resolved_fields = resolve_fields_for_model(&model, &model_map)?;

    let mut visited = HashSet::new();
    let value = generate_json_from_resolved_fields(&resolved_fields, &model_map, &mut visited, 0);

    serde_json::to_string_pretty(&value).map_err(|e| e.to_string())
}

/// Generate a JSON object from an already-resolved field list. Handles
/// nested `object` and `array` fields that reference other models by
/// recursively expanding them (using `generate_json_for_model` so that
/// nested models also honour their own inheritance).
fn generate_json_from_resolved_fields(
    fields: &[ResolvedModelField],
    model_map: &HashMap<String, db::DataModel>,
    visited: &mut HashSet<String>,
    depth: usize,
) -> serde_json::Value {
    let mut obj = serde_json::Map::new();

    for field in fields {
        let value = field_to_json_value(
            &field.field_type,
            field.example.as_deref(),
            field.ref_model_id.as_deref(),
            model_map,
            visited,
            depth,
        );
        obj.insert(field.name.clone(), value);
    }

    serde_json::Value::Object(obj)
}

/// Recursively expand a single model reference for `object`/`array` fields.
/// Nested models are resolved through their own inheritance chain so that
/// an `array` of `Child` returns fields from `Child`'s resolved view.
fn generate_json_for_model(
    model: &db::DataModel,
    model_map: &HashMap<String, db::DataModel>,
    visited: &mut HashSet<String>,
    depth: usize,
) -> serde_json::Value {
    const MAX_DEPTH: usize = 5;

    if depth >= MAX_DEPTH || visited.contains(&model.id) {
        return serde_json::Value::Null;
    }

    visited.insert(model.id.clone());

    // Resolve the nested model's own inheritance so child fields are included
    let resolved = match resolve_fields_for_model(model, model_map) {
        Ok(fields) => fields,
        Err(_) => {
            // Fall back to own fields only on resolution error
            let raw: Vec<serde_json::Value> =
                serde_json::from_str(&model.fields).unwrap_or_default();
            raw.into_iter()
                .filter_map(|f| {
                    let name = f.get("name")?.as_str()?.to_string();
                    let field_type = f
                        .get("field_type")
                        .and_then(|v| v.as_str())
                        .unwrap_or("any")
                        .to_string();
                    Some(ResolvedModelField {
                        name,
                        field_type,
                        description: String::new(),
                        required: false,
                        example: f
                            .get("example")
                            .and_then(|v| v.as_str())
                            .map(str::to_string),
                        ref_model_id: f
                            .get("ref_model_id")
                            .and_then(|v| v.as_str())
                            .map(str::to_string),
                        origin: "own".to_string(),
                        origin_model_id: model.id.clone(),
                        origin_model_name: model.name.clone(),
                        overridden: false,
                    })
                })
                .collect()
        }
    };

    let value = generate_json_from_resolved_fields(&resolved, model_map, visited, depth);

    visited.remove(&model.id);

    value
}

/// Convert a single field to its JSON value representation.
fn field_to_json_value(
    field_type: &str,
    example: Option<&str>,
    ref_model_id: Option<&str>,
    model_map: &HashMap<String, db::DataModel>,
    visited: &mut HashSet<String>,
    depth: usize,
) -> serde_json::Value {
    const MAX_DEPTH: usize = 5;

    match field_type {
        "string" => serde_json::Value::String(example.unwrap_or("").to_string()),
        "number" => {
            let n = example.and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0);
            serde_json::json!(n)
        }
        "boolean" => {
            let b = example
                .and_then(|s| s.parse::<bool>().ok())
                .unwrap_or(false);
            serde_json::Value::Bool(b)
        }
        "array" => {
            if depth < MAX_DEPTH {
                if let Some(rid) = ref_model_id {
                    if let Some(ref_model) = model_map.get(rid) {
                        let mut child_visited = visited.clone();
                        let item = generate_json_for_model(
                            ref_model,
                            model_map,
                            &mut child_visited,
                            depth + 1,
                        );
                        return serde_json::Value::Array(vec![item]);
                    }
                }
            }
            serde_json::Value::Array(vec![])
        }
        "object" => {
            if depth < MAX_DEPTH {
                if let Some(rid) = ref_model_id {
                    if let Some(ref_model) = model_map.get(rid) {
                        let mut child_visited = visited.clone();
                        return generate_json_for_model(
                            ref_model,
                            model_map,
                            &mut child_visited,
                            depth + 1,
                        );
                    }
                }
            }
            serde_json::Value::Object(serde_json::Map::new())
        }
        _ => serde_json::Value::Null,
    }
}
