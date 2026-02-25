use crate::db;
use serde::Deserialize;

/// Deserializes a present JSON field into `Some(...)`, distinguishing:
/// - field absent → `None` (via `#[serde(default)]`)
/// - field is `null` → `Some(None)` (clear the value)
/// - field is `"value"` → `Some(Some("value"))` (set the value)
pub fn deserialize_optional_nullable<'de, D>(
    deserializer: D,
) -> Result<Option<Option<String>>, D::Error>
where
    D: serde::de::Deserializer<'de>,
{
    Ok(Some(Option::deserialize(deserializer)?))
}

#[derive(Debug, Deserialize)]
pub struct CreateCollectionInput {
    pub name: String,
    pub parent_id: Option<String>,
    pub project_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateCollectionInput {
    pub id: String,
    pub name: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_nullable")]
    pub parent_id: Option<Option<String>>,
    pub sort_order: Option<i64>,
    #[serde(default, deserialize_with = "deserialize_optional_nullable")]
    pub path_prefix: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_nullable")]
    pub description: Option<Option<String>>,
    pub shared_headers: Option<String>,
}

#[tauri::command]
pub async fn create_collection(input: CreateCollectionInput) -> Result<db::Collection, String> {
    let id = uuid::Uuid::new_v4().to_string();
    db::create_collection(
        &id,
        &input.name,
        input.parent_id.as_deref(),
        input.project_id.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_collection(input: UpdateCollectionInput) -> Result<db::Collection, String> {
    let parent_id_ref = input.parent_id.as_ref().map(|opt| opt.as_deref());
    let path_prefix_ref = input.path_prefix.as_ref().map(|opt| opt.as_deref());
    let description_ref = input.description.as_ref().map(|opt| opt.as_deref());
    db::update_collection(
        &input.id,
        input.name.as_deref(),
        parent_id_ref,
        input.sort_order,
        path_prefix_ref,
        description_ref,
        input.shared_headers.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_collection(id: String) -> Result<(), String> {
    db::delete_collection(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_collections(project_id: Option<String>) -> Result<Vec<db::Collection>, String> {
    db::list_collections(project_id.as_deref())
        .await
        .map_err(|e| e.to_string())
}
