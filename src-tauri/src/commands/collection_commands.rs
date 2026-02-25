use crate::db;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct CreateCollectionInput {
    pub name: String,
    pub parent_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateCollectionInput {
    pub id: String,
    pub name: Option<String>,
    pub parent_id: Option<Option<String>>,
    pub sort_order: Option<i64>,
}

#[tauri::command]
pub async fn create_collection(input: CreateCollectionInput) -> Result<db::Collection, String> {
    let id = uuid::Uuid::new_v4().to_string();
    db::create_collection(&id, &input.name, input.parent_id.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_collection(input: UpdateCollectionInput) -> Result<db::Collection, String> {
    let parent_id_ref = input
        .parent_id
        .as_ref()
        .map(|opt| opt.as_deref());
    db::update_collection(
        &input.id,
        input.name.as_deref(),
        parent_id_ref,
        input.sort_order,
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_collection(id: String) -> Result<(), String> {
    db::delete_collection(&id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_collections() -> Result<Vec<db::Collection>, String> {
    db::list_collections().await.map_err(|e| e.to_string())
}
