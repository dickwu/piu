use std::collections::{HashMap, HashSet};

use crate::db::{ApiRequest, Collection, DataModel};

// ---------------------------------------------------------------------------
// Core type
// ---------------------------------------------------------------------------

/// A pure-data representation of an entity relationship.
/// Consumed by both the graph visualization pipeline and the relations table.
#[derive(Debug, Clone)]
pub struct EntityRelation {
    pub source_type: String,
    pub source_id: String,
    pub target_type: String,
    pub target_id: String,
    pub relation: String,
    pub label: Option<String>,
}

// ---------------------------------------------------------------------------
// JSON parsing helpers (safe, never panic)
// ---------------------------------------------------------------------------

/// Parse the request config JSON to extract method, url, requestModelId, responseModelId.
pub fn parse_request_config(config_json: &str) -> serde_json::Value {
    serde_json::from_str(config_json).unwrap_or_else(|_| {
        serde_json::json!({
            "method": "GET",
            "url": "",
        })
    })
}

/// Parse model fields JSON array, filtering to entries that have a `name` key.
pub fn parse_model_fields(fields_json: &str) -> Vec<serde_json::Value> {
    serde_json::from_str::<Vec<serde_json::Value>>(fields_json)
        .unwrap_or_default()
        .into_iter()
        .filter(|f| f.get("name").and_then(|v| v.as_str()).is_some())
        .collect()
}

/// Parse mixin_model_ids JSON array into a Vec of String IDs.
pub fn parse_mixin_ids(json: &str) -> Vec<String> {
    serde_json::from_str::<Vec<serde_json::Value>>(json)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|v| v.as_str().map(String::from))
        .collect()
}

// ---------------------------------------------------------------------------
// Cycle detection helpers
// ---------------------------------------------------------------------------

fn has_collection_ancestor_cycle(
    start_id: &str,
    collection_by_id: &HashMap<&str, &Collection>,
) -> bool {
    let mut visited = HashSet::new();
    let mut cursor: Option<&str> = Some(start_id);
    while let Some(id) = cursor {
        if visited.contains(id) {
            return true;
        }
        visited.insert(id.to_string());
        cursor = collection_by_id
            .get(id)
            .and_then(|c| c.parent_id.as_deref());
    }
    false
}

fn has_model_inheritance_cycle(start_id: &str, model_by_id: &HashMap<&str, &DataModel>) -> bool {
    let mut visited = HashSet::new();
    let mut cursor: Option<&str> = Some(start_id);
    while let Some(id) = cursor {
        if visited.contains(id) {
            return true;
        }
        visited.insert(id.to_string());
        cursor = model_by_id
            .get(id)
            .and_then(|m| m.parent_model_id.as_deref());
    }
    false
}

// ---------------------------------------------------------------------------
// Core extraction function
// ---------------------------------------------------------------------------

/// Extract all entity relationships for a project from in-memory entity data.
///
/// This is a pure function with no I/O — it operates entirely on the provided
/// slices. Both the graph visualization pipeline and the relations table
/// consume its output.
pub fn extract_relations(
    project_id: &str,
    collections: &[Collection],
    requests: &[ApiRequest],
    models: &[DataModel],
) -> Vec<EntityRelation> {
    let mut relations: Vec<EntityRelation> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    // Build lookup sets and maps
    let collection_ids: HashSet<&str> = collections.iter().map(|c| c.id.as_str()).collect();
    let model_ids: HashSet<&str> = models.iter().map(|m| m.id.as_str()).collect();
    let collection_by_id: HashMap<&str, &Collection> =
        collections.iter().map(|c| (c.id.as_str(), c)).collect();
    let model_by_id: HashMap<&str, &DataModel> =
        models.iter().map(|m| (m.id.as_str(), m)).collect();

    // Dedup helper — ensures each (source, target, relation) triple is emitted once
    let mut add = |source_type: &str,
                   source_id: &str,
                   target_type: &str,
                   target_id: &str,
                   relation: &str,
                   label: Option<&str>| {
        let key = format!(
            "{}:{}|{}:{}|{}",
            source_type, source_id, target_type, target_id, relation
        );
        if seen.contains(&key) {
            return;
        }
        seen.insert(key);
        relations.push(EntityRelation {
            source_type: source_type.to_string(),
            source_id: source_id.to_string(),
            target_type: target_type.to_string(),
            target_id: target_id.to_string(),
            relation: relation.to_string(),
            label: label.map(|s| s.to_string()),
        });
    };

    // -------------------------------------------------------------------
    // 1. project → collection (from collections.project_id)
    // -------------------------------------------------------------------
    for col in collections {
        if col.project_id.as_deref() == Some(project_id) {
            add(
                "project",
                project_id,
                "collection",
                &col.id,
                "contains",
                None,
            );
        }
    }

    // -------------------------------------------------------------------
    // 2. collection → sub-collection (from collections.parent_id)
    // -------------------------------------------------------------------
    for col in collections {
        if let Some(ref parent_id) = col.parent_id {
            if collection_ids.contains(parent_id.as_str())
                && !has_collection_ancestor_cycle(parent_id, &collection_by_id)
            {
                add(
                    "collection",
                    parent_id,
                    "collection",
                    &col.id,
                    "contains",
                    None,
                );
            }
        }
    }

    // Group requests for collection membership checks
    let mut requests_by_collection: HashMap<&str, Vec<&ApiRequest>> = HashMap::new();
    let mut root_requests: Vec<&ApiRequest> = Vec::new();

    for req in requests {
        if let Some(ref col_id) = req.collection_id {
            if collection_ids.contains(col_id.as_str()) {
                requests_by_collection
                    .entry(col_id.as_str())
                    .or_default()
                    .push(req);
            } else {
                root_requests.push(req);
            }
        } else {
            root_requests.push(req);
        }
    }

    // -------------------------------------------------------------------
    // 3. collection → request (from requests.collection_id)
    // -------------------------------------------------------------------
    for col in collections {
        if let Some(reqs) = requests_by_collection.get(col.id.as_str()) {
            for req in reqs {
                add("collection", &col.id, "request", &req.id, "contains", None);
            }
        }
    }

    // -------------------------------------------------------------------
    // 4. project → request (root requests with no collection)
    // -------------------------------------------------------------------
    for req in &root_requests {
        add("project", project_id, "request", &req.id, "contains", None);
    }

    // Pre-parse all request configs
    let parsed_configs: HashMap<&str, serde_json::Value> = requests
        .iter()
        .map(|r| (r.id.as_str(), parse_request_config(&r.config)))
        .collect();

    // -------------------------------------------------------------------
    // 5. request → model (request body via requestModelId)
    // -------------------------------------------------------------------
    for req in requests {
        let cfg = &parsed_configs[req.id.as_str()];

        if let Some(req_model_id) = cfg.get("requestModelId").and_then(|v| v.as_str()) {
            if model_ids.contains(req_model_id) {
                add(
                    "request",
                    &req.id,
                    "model",
                    req_model_id,
                    "uses_request_model",
                    None,
                );
            }
        }

        // ---------------------------------------------------------------
        // 6. request → model (response via responseModelId)
        // ---------------------------------------------------------------
        if let Some(res_model_id) = cfg.get("responseModelId").and_then(|v| v.as_str()) {
            if model_ids.contains(res_model_id) {
                add(
                    "request",
                    &req.id,
                    "model",
                    res_model_id,
                    "uses_response_model",
                    None,
                );
            }
        }
    }

    // -------------------------------------------------------------------
    // 7. model → model (inheritance via parent_model_id)
    // -------------------------------------------------------------------
    for model in models {
        if let Some(ref parent_id) = model.parent_model_id {
            if model_ids.contains(parent_id.as_str())
                && !has_model_inheritance_cycle(parent_id, &model_by_id)
            {
                add("model", parent_id, "model", &model.id, "inherits", None);
            }
        }
    }

    // -------------------------------------------------------------------
    // 8. model → model (mixin via mixin_model_ids)
    // -------------------------------------------------------------------
    for model in models {
        for mixin_id in parse_mixin_ids(&model.mixin_model_ids) {
            if model_ids.contains(mixin_id.as_str()) {
                add("model", &model.id, "model", &mixin_id, "mixes_in", None);
            }
        }
    }

    // -------------------------------------------------------------------
    // 9. model → model (field ref via fields[].ref_model_id)
    // -------------------------------------------------------------------
    for model in models {
        for field in parse_model_fields(&model.fields) {
            if let Some(ref_id) = field.get("ref_model_id").and_then(|v| v.as_str()) {
                if model_ids.contains(ref_id) {
                    let field_name = field.get("name").and_then(|v| v.as_str()).unwrap_or("");
                    add(
                        "model",
                        &model.id,
                        "model",
                        ref_id,
                        "references_field",
                        Some(field_name),
                    );
                }
            }
        }
    }

    relations
}
