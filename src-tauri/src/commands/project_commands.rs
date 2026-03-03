use crate::db;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct CreateProjectInput {
    pub name: String,
    pub description: Option<String>,
    pub source_repo_url: Option<String>,
    pub source_commit_id: Option<String>,
    pub backend_type: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateProjectInput {
    pub id: String,
    pub name: Option<String>,
    #[serde(
        default,
        deserialize_with = "super::collection_commands::deserialize_optional_nullable"
    )]
    pub description: Option<Option<String>>,
    pub sort_order: Option<i64>,
    #[serde(
        default,
        deserialize_with = "super::collection_commands::deserialize_optional_nullable"
    )]
    pub source_repo_url: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "super::collection_commands::deserialize_optional_nullable"
    )]
    pub source_commit_id: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "super::collection_commands::deserialize_optional_nullable"
    )]
    pub backend_type: Option<Option<String>>,
}

#[tauri::command]
pub async fn create_project(input: CreateProjectInput) -> Result<db::Project, String> {
    let id = uuid::Uuid::new_v4().to_string();
    db::create_project(
        &id,
        &input.name,
        input.description.as_deref(),
        input.source_repo_url.as_deref(),
        input.source_commit_id.as_deref(),
        input.backend_type.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_project(input: UpdateProjectInput) -> Result<db::Project, String> {
    let description_ref = input.description.as_ref().map(|opt| opt.as_deref());
    let source_repo_url_ref = input.source_repo_url.as_ref().map(|opt| opt.as_deref());
    let source_commit_id_ref = input.source_commit_id.as_ref().map(|opt| opt.as_deref());
    let backend_type_ref = input.backend_type.as_ref().map(|opt| opt.as_deref());
    db::update_project(
        &input.id,
        input.name.as_deref(),
        description_ref,
        input.sort_order,
        source_repo_url_ref,
        source_commit_id_ref,
        backend_type_ref,
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_project(id: String) -> Result<(), String> {
    db::delete_project(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_projects() -> Result<Vec<db::Project>, String> {
    db::list_projects().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_active_project() -> Result<Option<String>, String> {
    db::get_app_state("active_project_id")
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_active_project(id: String) -> Result<(), String> {
    db::set_app_state("active_project_id", &id)
        .await
        .map_err(|e| e.to_string())
}
