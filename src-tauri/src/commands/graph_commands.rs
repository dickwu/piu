use serde::Serialize;
use std::collections::{HashMap, HashSet};

use crate::db::graph::{GraphEdge, GraphNode, NodePositionUpdate};

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct ProjectGraphData {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

// ---------------------------------------------------------------------------
// Edge style constants (mirrors frontend EDGE_STYLES)
// ---------------------------------------------------------------------------

struct EdgeStyle {
    stroke: &'static str,
    stroke_width: f64,
}

fn edge_style(edge_type: &str) -> EdgeStyle {
    match edge_type {
        "col-subcol" => EdgeStyle {
            stroke: "#8b8b99",
            stroke_width: 1.2,
        },
        "col-request" => EdgeStyle {
            stroke: "#7a7a8e",
            stroke_width: 0.8,
        },
        "req-reqModel" => EdgeStyle {
            stroke: "#fbbf24",
            stroke_width: 1.5,
        },
        "req-resModel" => EdgeStyle {
            stroke: "#34d399",
            stroke_width: 1.5,
        },
        "model-inherits" => EdgeStyle {
            stroke: "#4a9eff",
            stroke_width: 1.5,
        },
        "model-mixin" => EdgeStyle {
            stroke: "#9b59b6",
            stroke_width: 1.0,
        },
        "model-fieldRef" => EdgeStyle {
            stroke: "#2ecc71",
            stroke_width: 0.8,
        },
        _ => EdgeStyle {
            stroke: "#555",
            stroke_width: 1.0,
        },
    }
}

fn edge_label(edge_type: &str) -> &'static str {
    match edge_type {
        "col-subcol" => "SUBCOL",
        "col-request" => "REQUEST",
        "req-reqModel" => "REQ_BODY",
        "req-resModel" => "RESPONSE",
        "model-inherits" => "INHERITS",
        "model-mixin" => "MIXIN",
        "model-fieldRef" => "",
        _ => "",
    }
}

// ---------------------------------------------------------------------------
// Node color constants
// ---------------------------------------------------------------------------

const COL_COLOR: &str = "#fbbf24";
const MODEL_COLOR: &str = "#4a9eff";

fn method_color(method: &str) -> &'static str {
    match method {
        "GET" => "#34d399",
        "POST" => "#fbbf24",
        "PUT" => "#4a9eff",
        "DELETE" => "#ff4d4f",
        "PATCH" => "#9b59b6",
        _ => "#34d399",
    }
}

// ---------------------------------------------------------------------------
// Cycle detection helpers
// ---------------------------------------------------------------------------

fn has_collection_ancestor_cycle(
    start_id: &str,
    collection_by_id: &HashMap<String, &crate::db::Collection>,
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

fn has_model_inheritance_cycle(
    start_id: &str,
    model_by_id: &HashMap<String, &crate::db::DataModel>,
) -> bool {
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
// JSON parsing helpers (safe, never panic)
// ---------------------------------------------------------------------------

/// Parse the request config JSON to extract method, url, requestModelId, responseModelId
fn parse_request_config(config_json: &str) -> serde_json::Value {
    serde_json::from_str(config_json).unwrap_or_else(|_| {
        serde_json::json!({
            "method": "GET",
            "url": "",
        })
    })
}

/// Parse model fields JSON array
fn parse_model_fields(fields_json: &str) -> Vec<serde_json::Value> {
    serde_json::from_str::<Vec<serde_json::Value>>(fields_json)
        .unwrap_or_default()
        .into_iter()
        .filter(|f| f.get("name").and_then(|v| v.as_str()).is_some())
        .collect()
}

/// Parse mixin_model_ids JSON array
fn parse_mixin_ids(json: &str) -> Vec<String> {
    serde_json::from_str::<Vec<serde_json::Value>>(json)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|v| v.as_str().map(String::from))
        .collect()
}

// ---------------------------------------------------------------------------
// Graph builder (core logic)
// ---------------------------------------------------------------------------

fn build_graph(
    project_id: &str,
    collections: &[crate::db::Collection],
    requests: &[crate::db::ApiRequest],
    models: &[crate::db::DataModel],
) -> (Vec<GraphNode>, Vec<GraphEdge>) {
    let now = chrono::Utc::now().timestamp_millis();
    let mut nodes: Vec<GraphNode> = Vec::new();
    let mut edges: Vec<GraphEdge> = Vec::new();
    let mut seen_edges: HashSet<String> = HashSet::new();

    // Build lookup maps
    let collection_ids: HashSet<&str> = collections.iter().map(|c| c.id.as_str()).collect();
    let model_ids: HashSet<&str> = models.iter().map(|m| m.id.as_str()).collect();
    let collection_by_id: HashMap<String, &crate::db::Collection> =
        collections.iter().map(|c| (c.id.clone(), c)).collect();
    let model_by_id: HashMap<String, &crate::db::DataModel> =
        models.iter().map(|m| (m.id.clone(), m)).collect();

    // Group requests by collection
    let mut requests_by_collection: HashMap<String, Vec<&crate::db::ApiRequest>> = HashMap::new();
    let mut root_requests: Vec<&crate::db::ApiRequest> = Vec::new();

    for req in requests {
        if let Some(ref col_id) = req.collection_id {
            if collection_ids.contains(col_id.as_str()) {
                requests_by_collection
                    .entry(col_id.clone())
                    .or_default()
                    .push(req);
            } else {
                root_requests.push(req);
            }
        } else {
            root_requests.push(req);
        }
    }

    // Pre-parse all request configs
    let mut parsed_configs: HashMap<String, serde_json::Value> = HashMap::new();
    for req in requests {
        parsed_configs.insert(req.id.clone(), parse_request_config(&req.config));
    }

    // -----------------------------------------------------------------------
    // Node creation — Collection nodes
    // -----------------------------------------------------------------------
    for col in collections {
        let req_count = requests_by_collection
            .get(&col.id)
            .map(|r| r.len())
            .unwrap_or(0);

        let properties = serde_json::json!({
            "name": col.name,
            "pathPrefix": col.path_prefix,
            "requestCount": req_count,
        });

        // Size scales with request count (min 3, max 12)
        let size = 3.0 + (req_count as f64).sqrt().min(9.0);

        nodes.push(GraphNode {
            id: format!("col:{}", col.id),
            project_id: project_id.to_string(),
            entity_type: "collection".to_string(),
            entity_id: col.id.clone(),
            label: col.name.clone(),
            properties: properties.to_string(),
            size,
            color: COL_COLOR.to_string(),
            fx: None,
            fy: None,
            fz: None,
            created_at: now,
        });
    }

    // -----------------------------------------------------------------------
    // Node creation — Request nodes
    // -----------------------------------------------------------------------
    for req in requests {
        let cfg = parsed_configs
            .get(&req.id)
            .cloned()
            .unwrap_or_else(|| serde_json::json!({"method": "GET", "url": ""}));

        let method = cfg
            .get("method")
            .and_then(|v| v.as_str())
            .unwrap_or("GET")
            .to_uppercase();
        let url = cfg
            .get("url")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let m_color = method_color(&method);

        let properties = serde_json::json!({
            "name": req.name,
            "method": method,
            "url": url,
            "methodColor": m_color,
        });

        nodes.push(GraphNode {
            id: format!("req:{}", req.id),
            project_id: project_id.to_string(),
            entity_type: "request".to_string(),
            entity_id: req.id.clone(),
            label: req.name.clone(),
            properties: properties.to_string(),
            size: 2.0,
            color: m_color.to_string(),
            fx: None,
            fy: None,
            fz: None,
            created_at: now,
        });
    }

    // -----------------------------------------------------------------------
    // Node creation — Model nodes
    // -----------------------------------------------------------------------
    for model in models {
        let fields = parse_model_fields(&model.fields);
        let field_preview: Vec<serde_json::Value> = fields
            .iter()
            .map(|f| {
                serde_json::json!({
                    "name": f.get("name").and_then(|v| v.as_str()).unwrap_or(""),
                    "type": f.get("field_type").and_then(|v| v.as_str()).unwrap_or(""),
                    "required": f.get("required").and_then(|v| v.as_bool()).unwrap_or(false),
                })
            })
            .collect();

        let properties = serde_json::json!({
            "name": model.name,
            "fieldCount": fields.len(),
            "fieldPreview": field_preview,
            "description": model.description,
        });

        let size = 2.0 + (fields.len() as f64 * 0.3).min(6.0);

        nodes.push(GraphNode {
            id: format!("model:{}", model.id),
            project_id: project_id.to_string(),
            entity_type: "model".to_string(),
            entity_id: model.id.clone(),
            label: model.name.clone(),
            properties: properties.to_string(),
            size,
            color: MODEL_COLOR.to_string(),
            fx: None,
            fy: None,
            fz: None,
            created_at: now,
        });
    }

    // -----------------------------------------------------------------------
    // Edge helper
    // -----------------------------------------------------------------------
    let node_ids: HashSet<String> = nodes.iter().map(|n| n.id.clone()).collect();

    let mut add_edge =
        |source: &str, target: &str, edge_type: &str, label_override: Option<&str>| {
            let key = format!("{}|{}|{}", source, target, edge_type);
            if seen_edges.contains(&key) {
                return;
            }
            if !node_ids.contains(source) || !node_ids.contains(target) {
                return;
            }
            seen_edges.insert(key.clone());

            let style = edge_style(edge_type);
            let lbl = label_override.unwrap_or_else(|| edge_label(edge_type));

            let properties = serde_json::json!({
                "stroke": style.stroke,
                "strokeWidth": style.stroke_width,
            });

            edges.push(GraphEdge {
                id: key,
                project_id: project_id.to_string(),
                source_id: source.to_string(),
                target_id: target.to_string(),
                edge_type: edge_type.to_string(),
                label: lbl.to_string(),
                properties: properties.to_string(),
                created_at: now,
            });
        };

    // -----------------------------------------------------------------------
    // Edges: collection → sub-collection
    // -----------------------------------------------------------------------
    for col in collections {
        if let Some(ref parent_id) = col.parent_id {
            if collection_ids.contains(parent_id.as_str())
                && !has_collection_ancestor_cycle(parent_id, &collection_by_id)
            {
                add_edge(
                    &format!("col:{}", parent_id),
                    &format!("col:{}", col.id),
                    "col-subcol",
                    None,
                );
            }
        }
    }

    // -----------------------------------------------------------------------
    // Edges: collection → request
    // -----------------------------------------------------------------------
    for col in collections {
        if let Some(reqs) = requests_by_collection.get(&col.id) {
            for req in reqs {
                add_edge(
                    &format!("col:{}", col.id),
                    &format!("req:{}", req.id),
                    "col-request",
                    None,
                );
            }
        }
    }

    // -----------------------------------------------------------------------
    // Edges: request → model (request body + response model)
    // -----------------------------------------------------------------------
    for req in requests {
        let cfg = &parsed_configs[&req.id];

        if let Some(req_model_id) = cfg.get("requestModelId").and_then(|v| v.as_str()) {
            if model_ids.contains(req_model_id) {
                add_edge(
                    &format!("req:{}", req.id),
                    &format!("model:{}", req_model_id),
                    "req-reqModel",
                    None,
                );
            }
        }

        if let Some(res_model_id) = cfg.get("responseModelId").and_then(|v| v.as_str()) {
            if model_ids.contains(res_model_id) {
                add_edge(
                    &format!("req:{}", req.id),
                    &format!("model:{}", res_model_id),
                    "req-resModel",
                    None,
                );
            }
        }
    }

    // -----------------------------------------------------------------------
    // Edges: model → model (inheritance)
    // -----------------------------------------------------------------------
    for model in models {
        if let Some(ref parent_id) = model.parent_model_id {
            if model_ids.contains(parent_id.as_str())
                && !has_model_inheritance_cycle(parent_id, &model_by_id)
            {
                add_edge(
                    &format!("model:{}", parent_id),
                    &format!("model:{}", model.id),
                    "model-inherits",
                    None,
                );
            }
        }
    }

    // -----------------------------------------------------------------------
    // Edges: model → mixin
    // -----------------------------------------------------------------------
    for model in models {
        for mixin_id in parse_mixin_ids(&model.mixin_model_ids) {
            if model_ids.contains(mixin_id.as_str()) {
                add_edge(
                    &format!("model:{}", model.id),
                    &format!("model:{}", mixin_id),
                    "model-mixin",
                    None,
                );
            }
        }
    }

    // -----------------------------------------------------------------------
    // Edges: model → field reference
    // -----------------------------------------------------------------------
    for model in models {
        for field in parse_model_fields(&model.fields) {
            if let Some(ref_id) = field.get("ref_model_id").and_then(|v| v.as_str()) {
                if model_ids.contains(ref_id) {
                    let field_name = field.get("name").and_then(|v| v.as_str()).unwrap_or("");
                    add_edge(
                        &format!("model:{}", model.id),
                        &format!("model:{}", ref_id),
                        "model-fieldRef",
                        Some(field_name),
                    );
                }
            }
        }
    }

    (nodes, edges)
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn build_project_graph(project_id: String) -> Result<ProjectGraphData, String> {
    // Load all entities from DB
    let collections = crate::db::list_collections(Some(&project_id))
        .await
        .map_err(|e| e.to_string())?;

    // Load requests per collection + root requests
    let mut all_requests: Vec<crate::db::ApiRequest> = Vec::new();
    for col in &collections {
        let col_reqs = crate::db::list_requests(&col.id)
            .await
            .map_err(|e| e.to_string())?;
        all_requests.extend(col_reqs);
    }
    let root_reqs = crate::db::list_root_requests(&project_id)
        .await
        .map_err(|e| e.to_string())?;
    all_requests.extend(root_reqs);

    // Deduplicate by ID (a request could theoretically appear in multiple queries)
    let mut seen_req_ids: HashSet<String> = HashSet::new();
    all_requests.retain(|r| seen_req_ids.insert(r.id.clone()));

    let requests = all_requests;

    let models = crate::db::list_models(&project_id)
        .await
        .map_err(|e| e.to_string())?;

    // Build graph topology (CPU-bound, but fast for <10K nodes)
    let (nodes, edges) = build_graph(&project_id, &collections, &requests, &models);

    // Persist to LPG tables (preserves cached positions)
    crate::db::replace_project_graph(&project_id, &nodes, &edges)
        .await
        .map_err(|e| e.to_string())?;

    // Re-read from DB to get the merged positions
    let final_nodes = crate::db::list_graph_nodes(&project_id)
        .await
        .map_err(|e| e.to_string())?;

    let final_edges = crate::db::list_graph_edges(&project_id)
        .await
        .map_err(|e| e.to_string())?;

    Ok(ProjectGraphData {
        nodes: final_nodes,
        edges: final_edges,
    })
}

#[tauri::command]
pub async fn save_graph_positions(positions: Vec<NodePositionUpdate>) -> Result<(), String> {
    crate::db::update_node_positions(&positions)
        .await
        .map_err(|e| e.to_string())
}
