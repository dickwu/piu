use crate::db;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct CreateEnvironmentInput {
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateEnvironmentInput {
    pub id: String,
    pub name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct EnvVariableInput {
    pub id: String,
    pub key: String,
    pub value: String,
    pub enabled: bool,
}

#[derive(Debug, Deserialize)]
pub struct SetEnvVariablesInput {
    pub environment_id: String,
    pub variables: Vec<EnvVariableInput>,
}

#[tauri::command]
pub async fn create_environment(input: CreateEnvironmentInput) -> Result<db::Environment, String> {
    let id = uuid::Uuid::new_v4().to_string();
    db::create_environment(&id, &input.name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_environment(input: UpdateEnvironmentInput) -> Result<db::Environment, String> {
    db::update_environment(&input.id, input.name.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_environment(id: String) -> Result<(), String> {
    db::delete_environment(&id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_environments() -> Result<Vec<db::Environment>, String> {
    db::list_environments().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_active_environment(id: String) -> Result<(), String> {
    db::set_active_environment(&id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_active_environment() -> Result<Option<db::Environment>, String> {
    db::get_active_environment()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_env_variables(input: SetEnvVariablesInput) -> Result<(), String> {
    let variables: Vec<(String, String, String, bool)> = input
        .variables
        .into_iter()
        .map(|v| (v.id, v.key, v.value, v.enabled))
        .collect();

    db::set_env_variables(&input.environment_id, variables)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_env_variables(environment_id: String) -> Result<Vec<db::EnvVariable>, String> {
    db::list_env_variables(&environment_id)
        .await
        .map_err(|e| e.to_string())
}
