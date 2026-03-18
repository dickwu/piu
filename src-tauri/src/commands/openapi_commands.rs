use crate::db;
use crate::openapi::builder;
use serde::Serialize;
use tauri::Emitter;

#[derive(Debug, Serialize)]
pub struct GenerateSpecResult {
    pub spec_json: String,
    pub generated_at: String,
    pub endpoint_count: usize,
    pub schema_count: usize,
}

#[tauri::command]
pub async fn generate_openapi_spec(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<GenerateSpecResult, String> {
    let result = builder::build_openapi_spec(&project_id).await?;

    // Emit data-changed event for frontend reactivity
    let _ = app.emit(
        "data-changed",
        serde_json::json!({
            "entity_type": "spec",
            "action": "updated",
            "entity_id": null,
            "project_id": &project_id,
        }),
    );

    Ok(GenerateSpecResult {
        spec_json: result.spec_json,
        generated_at: result.generated_at,
        endpoint_count: result.endpoint_count,
        schema_count: result.schema_count,
    })
}

#[tauri::command]
pub async fn get_openapi_spec(project_id: String) -> Result<Option<String>, String> {
    let result = db::get_spec(&project_id)
        .await
        .map_err(|e| format!("Failed to get spec: {}", e))?;
    Ok(result.map(|(json, _)| json))
}
