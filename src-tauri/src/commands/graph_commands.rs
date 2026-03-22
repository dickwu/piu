use serde::Serialize;
use std::collections::{HashMap, HashSet};

use crate::db::entity_graph::{self, EntityRelation};
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
// EntityRelation → visual graph mapping
// ---------------------------------------------------------------------------

/// Convert an `EntityRelation` into (source_graph_id, target_graph_id, visual_edge_type).
///
/// The graph nodes use prefixed IDs (`col:`, `req:`, `model:`) while
/// `EntityRelation` uses raw entity IDs. This function bridges the two.
fn relation_to_graph_ids(rel: &EntityRelation) -> (String, String, String) {
    let prefix = |etype: &str, eid: &str| -> String {
        match etype {
            "collection" => format!("col:{}", eid),
            "request" => format!("req:{}", eid),
            "model" => format!("model:{}", eid),
            // project nodes are not rendered — edges from/to projects are skipped
            // by the node_ids filter in build_graph
            _ => format!("{}:{}", etype, eid),
        }
    };

    let source = prefix(&rel.source_type, &rel.source_id);
    let target = prefix(&rel.target_type, &rel.target_id);

    let visual_type = match rel.relation.as_str() {
        "contains" => {
            // Determine visual type from source/target entity types
            match (rel.source_type.as_str(), rel.target_type.as_str()) {
                ("collection", "collection") => "col-subcol".to_string(),
                ("collection", "request") => "col-request".to_string(),
                _ => "contains".to_string(),
            }
        }
        "uses_request_model" => "req-reqModel".to_string(),
        "uses_response_model" => "req-resModel".to_string(),
        "inherits" => "model-inherits".to_string(),
        "mixes_in" => "model-mixin".to_string(),
        "references_field" => "model-fieldRef".to_string(),
        other => other.to_string(),
    };

    (source, target, visual_type)
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

    // Build lookup for request grouping (used for collection node sizing)
    let collection_ids: HashSet<&str> = collections.iter().map(|c| c.id.as_str()).collect();

    // Group requests by collection
    let mut requests_by_collection: HashMap<String, Vec<&crate::db::ApiRequest>> = HashMap::new();

    for req in requests {
        if let Some(ref col_id) = req.collection_id {
            if collection_ids.contains(col_id.as_str()) {
                requests_by_collection
                    .entry(col_id.clone())
                    .or_default()
                    .push(req);
            }
        }
    }

    // Pre-parse all request configs (uses shared JSON parser)
    let mut parsed_configs: HashMap<String, serde_json::Value> = HashMap::new();
    for req in requests {
        parsed_configs.insert(
            req.id.clone(),
            entity_graph::parse_request_config(&req.config),
        );
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
        let fields = entity_graph::parse_model_fields(&model.fields);
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
    // Edges: extract via shared entity_graph module, then convert to visual
    // -----------------------------------------------------------------------
    let relations = entity_graph::extract_relations(project_id, collections, requests, models);
    let node_ids: HashSet<String> = nodes.iter().map(|n| n.id.clone()).collect();
    let mut seen_edges: HashSet<String> = HashSet::new();

    let edges: Vec<GraphEdge> = relations
        .iter()
        .filter_map(|rel| {
            let (source, target, visual_type) = relation_to_graph_ids(rel);

            // Skip edges whose endpoints are not in the node set
            if !node_ids.contains(&source) || !node_ids.contains(&target) {
                return None;
            }

            let key = format!("{}|{}|{}", source, target, visual_type);
            if !seen_edges.insert(key.clone()) {
                return None;
            }

            let style = edge_style(&visual_type);
            let lbl = rel
                .label
                .as_deref()
                .unwrap_or_else(|| edge_label(&visual_type));

            let properties = serde_json::json!({
                "stroke": style.stroke,
                "strokeWidth": style.stroke_width,
            });

            Some(GraphEdge {
                id: key,
                project_id: project_id.to_string(),
                source_id: source,
                target_id: target,
                edge_type: visual_type,
                label: lbl.to_string(),
                properties: properties.to_string(),
                created_at: now,
            })
        })
        .collect();

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
