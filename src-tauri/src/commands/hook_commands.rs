use crate::db;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct CreateEnvHookInput {
    pub environment_id: String,
    pub source_request_id: String,
    pub response_location: String,
    pub selector: String,
    #[serde(default = "default_value_template")]
    pub value_template: String,
    pub expires_in: Option<i64>,
    #[serde(default = "default_array_strategy")]
    pub array_strategy: String,
    #[serde(default)]
    pub target_variable_ids: Vec<String>,
}

fn default_value_template() -> String {
    "{{value}}".to_string()
}

fn default_array_strategy() -> String {
    "pick".to_string()
}

#[derive(Debug, Deserialize)]
pub struct UpdateEnvHookInput {
    pub id: String,
    pub source_request_id: Option<String>,
    pub response_location: Option<String>,
    pub selector: Option<String>,
    pub value_template: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_nullable_i64")]
    pub expires_in: Option<Option<i64>>,
    pub array_strategy: Option<String>,
    pub enabled: Option<bool>,
    pub target_variable_ids: Option<Vec<String>>,
}

fn deserialize_optional_nullable_i64<'de, D>(
    deserializer: D,
) -> Result<Option<Option<i64>>, D::Error>
where
    D: serde::de::Deserializer<'de>,
{
    Ok(Some(Option::deserialize(deserializer)?))
}

#[tauri::command]
pub async fn create_env_hook(input: CreateEnvHookInput) -> Result<db::EnvHook, String> {
    let id = uuid::Uuid::new_v4().to_string();
    db::create_hook(
        &id,
        &input.environment_id,
        &input.source_request_id,
        &input.response_location,
        &input.selector,
        &input.value_template,
        input.expires_in,
        &input.array_strategy,
        &input.target_variable_ids,
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_env_hooks(environment_id: String) -> Result<Vec<db::EnvHook>, String> {
    db::list_hooks(&environment_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_env_hook_targets(hook_id: String) -> Result<Vec<db::EnvHookTarget>, String> {
    db::list_hook_targets(&hook_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_env_hook(input: UpdateEnvHookInput) -> Result<db::EnvHook, String> {
    let target_ids = input.target_variable_ids.as_deref();
    db::update_hook(
        &input.id,
        input.source_request_id.as_deref(),
        input.response_location.as_deref(),
        input.selector.as_deref(),
        input.value_template.as_deref(),
        input.expires_in,
        input.array_strategy.as_deref(),
        input.enabled,
        target_ids,
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_env_hook(id: String) -> Result<(), String> {
    db::delete_hook(&id).await.map_err(|e| e.to_string())
}
