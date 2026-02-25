use crate::{db, http};
use serde::Deserialize;
use std::collections::HashMap;

#[derive(Debug, Deserialize)]
pub struct CreateRequestInput {
    pub collection_id: String,
    pub name: String,
    pub config: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateRequestInput {
    pub id: String,
    pub name: Option<String>,
    pub config: Option<String>,
    pub collection_id: Option<String>,
    pub sort_order: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct ExecuteRequestInput {
    pub config: String,
    pub env_variables: Option<HashMap<String, String>>,
}

#[tauri::command]
pub async fn create_request(input: CreateRequestInput) -> Result<db::ApiRequest, String> {
    let id = uuid::Uuid::new_v4().to_string();
    db::create_request(
        &id,
        &input.collection_id,
        &input.name,
        input.config.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_request(input: UpdateRequestInput) -> Result<db::ApiRequest, String> {
    db::update_request(
        &input.id,
        input.name.as_deref(),
        input.config.as_deref(),
        input.collection_id.as_deref(),
        input.sort_order,
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_request(id: String) -> Result<(), String> {
    db::delete_request(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_requests(collection_id: String) -> Result<Vec<db::ApiRequest>, String> {
    db::list_requests(&collection_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_request(id: String) -> Result<Option<db::ApiRequest>, String> {
    db::get_request(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn duplicate_request(id: String) -> Result<db::ApiRequest, String> {
    let new_id = uuid::Uuid::new_v4().to_string();
    db::duplicate_request(&id, &new_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn execute_request(input: ExecuteRequestInput) -> Result<http::HttpResponse, String> {
    let config: http::types::RequestConfig = serde_json::from_str(&input.config)
        .map_err(|e| format!("Invalid request config: {}", e))?;

    let env_variables = input.env_variables.unwrap_or_default();
    http::executor::execute(&config, &env_variables).await
}
