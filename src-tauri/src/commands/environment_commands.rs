use crate::db;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct CreateEnvironmentInput {
    pub name: String,
    pub project_id: Option<String>,
    pub host: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateEnvironmentInput {
    pub id: String,
    pub name: Option<String>,
    #[serde(
        default,
        deserialize_with = "super::collection_commands::deserialize_optional_nullable"
    )]
    pub host: Option<Option<String>>,
}

#[derive(Debug, Deserialize)]
pub struct EnvVariableInput {
    pub id: String,
    pub key: String,
    pub value: String,
    pub enabled: bool,
    #[serde(default = "default_match_paths")]
    pub match_paths: String,
    #[serde(default = "default_target_location")]
    pub target_location: String,
    pub expires_at: Option<i64>,
    #[serde(default)]
    pub priority: i64,
}

fn default_match_paths() -> String {
    r#"["*"]"#.to_string()
}

fn default_target_location() -> String {
    "url-path".to_string()
}

#[derive(Debug, Deserialize)]
pub struct SetEnvVariablesInput {
    pub environment_id: String,
    pub variables: Vec<EnvVariableInput>,
}

#[derive(Debug, Deserialize)]
pub struct SetActiveEnvironmentInput {
    pub id: String,
    pub project_id: String,
}

#[tauri::command]
pub async fn create_environment(input: CreateEnvironmentInput) -> Result<db::Environment, String> {
    let id = uuid::Uuid::new_v4().to_string();
    db::create_environment(
        &id,
        &input.name,
        input.project_id.as_deref(),
        input.host.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_environment(input: UpdateEnvironmentInput) -> Result<db::Environment, String> {
    let host_ref = input.host.as_ref().map(|opt| opt.as_deref());
    db::update_environment(&input.id, input.name.as_deref(), host_ref)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_environment(id: String) -> Result<(), String> {
    db::delete_environment(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_environments(project_id: Option<String>) -> Result<Vec<db::Environment>, String> {
    db::list_environments(project_id.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_active_environment(input: SetActiveEnvironmentInput) -> Result<(), String> {
    db::set_active_environment(&input.id, &input.project_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_active_environment(project_id: String) -> Result<Option<db::Environment>, String> {
    db::get_active_environment(&project_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_env_variables(input: SetEnvVariablesInput) -> Result<(), String> {
    let variables: Vec<db::EnvVariableTuple> = input
        .variables
        .into_iter()
        .map(|v| {
            (
                v.id,
                v.key,
                v.value,
                v.enabled,
                v.match_paths,
                v.target_location,
                v.expires_at,
                v.priority,
            )
        })
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
