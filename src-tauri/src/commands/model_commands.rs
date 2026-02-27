use crate::db;
use serde::Deserialize;
use std::collections::{HashMap, HashSet};

#[derive(Debug, Deserialize)]
pub struct CreateModelInput {
    pub project_id: String,
    pub name: String,
    pub description: Option<String>,
    pub fields: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateModelInput {
    pub id: String,
    pub name: Option<String>,
    pub description: Option<Option<String>>,
    pub fields: Option<String>,
    pub sort_order: Option<i64>,
}

#[tauri::command]
pub async fn create_model(input: CreateModelInput) -> Result<db::DataModel, String> {
    if let Some(ref fields_json) = input.fields {
        db::validate_model_refs(&input.project_id, fields_json)
            .await
            .map_err(|e| e.to_string())?;
    }

    let id = uuid::Uuid::new_v4().to_string();
    db::create_model(
        &id,
        &input.project_id,
        &input.name,
        input.description.as_deref(),
        input.fields.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_model(input: UpdateModelInput) -> Result<db::DataModel, String> {
    if let Some(ref fields_json) = input.fields {
        let model = db::get_model(&input.id)
            .await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Model {} not found", input.id))?;
        db::validate_model_refs(&model.project_id, fields_json)
            .await
            .map_err(|e| e.to_string())?;
    }

    db::update_model(
        &input.id,
        input.name.as_deref(),
        input.description.as_ref().map(|opt| opt.as_deref()),
        input.fields.as_deref(),
        input.sort_order,
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

    let mut visited = HashSet::new();
    let value = generate_json_for_model(&model, &model_map, &mut visited, 0);

    serde_json::to_string_pretty(&value).map_err(|e| e.to_string())
}

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

    let fields: Vec<serde_json::Value> = serde_json::from_str(&model.fields).unwrap_or_default();

    let mut obj = serde_json::Map::new();

    for field in &fields {
        let name = match field.get("name").and_then(|v| v.as_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        let field_type = field
            .get("field_type")
            .and_then(|v| v.as_str())
            .unwrap_or("any");
        let example = field
            .get("example")
            .and_then(|v| v.as_str())
            .map(str::to_string);
        let ref_model_id = field
            .get("ref_model_id")
            .and_then(|v| v.as_str())
            .map(str::to_string);

        let value = match field_type {
            "string" => serde_json::Value::String(example.unwrap_or_default()),
            "number" => {
                let n = example
                    .as_deref()
                    .and_then(|s| s.parse::<f64>().ok())
                    .unwrap_or(0.0);
                serde_json::json!(n)
            }
            "boolean" => {
                let b = example
                    .as_deref()
                    .and_then(|s| s.parse::<bool>().ok())
                    .unwrap_or(false);
                serde_json::Value::Bool(b)
            }
            "array" => {
                if let Some(ref rid) = ref_model_id {
                    if let Some(ref_model) = model_map.get(rid) {
                        let mut child_visited = visited.clone();
                        let item = generate_json_for_model(
                            ref_model,
                            model_map,
                            &mut child_visited,
                            depth + 1,
                        );
                        serde_json::Value::Array(vec![item])
                    } else {
                        serde_json::Value::Array(vec![])
                    }
                } else {
                    serde_json::Value::Array(vec![])
                }
            }
            "object" => {
                if let Some(ref rid) = ref_model_id {
                    if let Some(ref_model) = model_map.get(rid) {
                        let mut child_visited = visited.clone();
                        generate_json_for_model(ref_model, model_map, &mut child_visited, depth + 1)
                    } else {
                        serde_json::Value::Object(serde_json::Map::new())
                    }
                } else {
                    serde_json::Value::Object(serde_json::Map::new())
                }
            }
            "null" | "any" => serde_json::Value::Null,
            _ => serde_json::Value::Null,
        };

        obj.insert(name, value);
    }

    visited.remove(&model.id);

    serde_json::Value::Object(obj)
}
