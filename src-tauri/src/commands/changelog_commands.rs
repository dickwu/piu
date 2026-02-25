use crate::db;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct GetChangelogInput {
    pub entity_type: Option<String>,
    pub entity_id: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[tauri::command]
pub async fn get_changelog(input: GetChangelogInput) -> Result<Vec<db::ChangelogEntry>, String> {
    let limit = input.limit.unwrap_or(50);
    let offset = input.offset.unwrap_or(0);

    db::get_changelog(
        input.entity_type.as_deref(),
        input.entity_id.as_deref(),
        limit,
        offset,
    )
    .await
    .map_err(|e| e.to_string())
}
