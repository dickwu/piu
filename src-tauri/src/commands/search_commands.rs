use crate::db;
use serde::Serialize;

#[derive(Serialize)]
pub struct SearchResultOutput {
    pub entity_type: String,
    pub entity_id: String,
    pub name: String,
    pub description_text: String,
    pub snippet: String,
    pub relevance_score: f64,
}

#[derive(Serialize)]
pub struct RelatedEntityOutput {
    pub entity_type: String,
    pub entity_id: String,
    pub name: String,
    pub relation: String,
    pub label: Option<String>,
    pub distance: i32,
    pub description_text: String,
}

#[tauri::command]
pub async fn search_entities(
    query: String,
    project_id: Option<String>,
    entity_type: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<SearchResultOutput>, String> {
    let limit = limit.unwrap_or(20).min(100);
    let results = db::search_entities(&query, project_id.as_deref(), entity_type.as_deref(), limit)
        .await
        .map_err(|e| e.to_string())?;
    Ok(results
        .into_iter()
        .map(|r| SearchResultOutput {
            entity_type: r.entity_type,
            entity_id: r.entity_id,
            name: r.name,
            description_text: r.description_text,
            snippet: r.snippet,
            relevance_score: r.relevance_score,
        })
        .collect())
}

#[tauri::command]
pub async fn find_related_entities(
    entity_type: String,
    entity_id: String,
    max_depth: Option<usize>,
) -> Result<Vec<RelatedEntityOutput>, String> {
    let max_depth = max_depth.unwrap_or(2).min(5);
    let results = db::find_related_entities(&entity_type, &entity_id, max_depth)
        .await
        .map_err(|e| e.to_string())?;
    Ok(results
        .into_iter()
        .map(|r| RelatedEntityOutput {
            entity_type: r.entity_type,
            entity_id: r.entity_id,
            name: r.name,
            relation: r.relation,
            label: r.label,
            distance: r.distance,
            description_text: r.description_text,
        })
        .collect())
}
