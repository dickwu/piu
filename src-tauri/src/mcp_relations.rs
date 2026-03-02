use crate::db;
use serde::Serialize;
use std::collections::HashMap;

#[derive(Debug, Serialize)]
pub struct RelationNode {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub field_count: usize,
}

#[derive(Debug, Serialize)]
pub struct RelationEdge {
    pub from: String,
    pub to: String,
    pub edge_type: String, // "inherits" | "mixin" | "field_ref"
    pub label: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct RelationsGraph {
    pub nodes: Vec<RelationNode>,
    pub edges: Vec<RelationEdge>,
}

#[derive(Debug, Serialize)]
pub struct HierarchyResult {
    pub parent_chain: Vec<HierarchyNode>,
    pub children: Vec<HierarchyNode>,
    pub mixins: Vec<MixinEdge>,
}

#[derive(Debug, Serialize)]
pub struct HierarchyNode {
    pub id: String,
    pub name: String,
    pub depth: i32,
}

#[derive(Debug, Serialize)]
pub struct MixinEdge {
    pub id: String,
    pub name: String,
    pub relation: String, // "uses" | "used_by"
}

pub async fn get_model_relations(project_id: &str) -> Result<RelationsGraph, String> {
    let all_models = db::models::list_models(project_id)
        .await
        .map_err(|e| e.to_string())?;

    let mut nodes = Vec::new();
    let mut edges = Vec::new();

    for model in &all_models {
        let fields: Vec<serde_json::Value> = serde_json::from_str(&model.fields)
            .map_err(|e| format!("Malformed fields JSON for model '{}': {}", model.id, e))?;

        nodes.push(RelationNode {
            id: model.id.clone(),
            name: model.name.clone(),
            description: model.description.clone(),
            field_count: fields.len(),
        });

        // Parent edge
        if let Some(ref parent_id) = model.parent_model_id {
            edges.push(RelationEdge {
                from: model.id.clone(),
                to: parent_id.clone(),
                edge_type: "inherits".to_string(),
                label: None,
            });
        }

        // Mixin edges
        let mixin_ids: Vec<String> = serde_json::from_str(&model.mixin_model_ids).map_err(|e| {
            format!(
                "Malformed mixin_model_ids JSON for model '{}': {}",
                model.id, e
            )
        })?;
        for mixin_id in mixin_ids {
            edges.push(RelationEdge {
                from: model.id.clone(),
                to: mixin_id,
                edge_type: "mixin".to_string(),
                label: None,
            });
        }

        // Field ref edges
        for field in &fields {
            if let (Some(ref_id), Some(field_name)) = (
                field.get("ref_model_id").and_then(|v| v.as_str()),
                field.get("name").and_then(|v| v.as_str()),
            ) {
                edges.push(RelationEdge {
                    from: model.id.clone(),
                    to: ref_id.to_string(),
                    edge_type: "field_ref".to_string(),
                    label: Some(field_name.to_string()),
                });
            }
        }
    }

    Ok(RelationsGraph { nodes, edges })
}

pub async fn get_model_hierarchy(model_id: &str) -> Result<HierarchyResult, String> {
    let model = db::models::get_model(model_id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Model {} not found", model_id))?;

    let all_models = db::models::list_models(&model.project_id)
        .await
        .map_err(|e| e.to_string())?;
    let model_map: HashMap<String, db::models::DataModel> = all_models
        .iter()
        .map(|m| (m.id.clone(), m.clone()))
        .collect();

    // Walk parent chain UP
    let mut parent_chain = Vec::new();
    let mut current_id = model.parent_model_id.clone();
    let mut depth = -1i32;
    let mut visited = std::collections::HashSet::new();
    visited.insert(model_id.to_string());

    while let Some(pid) = current_id {
        if visited.contains(&pid) {
            break;
        }
        visited.insert(pid.clone());
        if let Some(parent) = model_map.get(&pid) {
            parent_chain.push(HierarchyNode {
                id: parent.id.clone(),
                name: parent.name.clone(),
                depth,
            });
            current_id = parent.parent_model_id.clone();
            depth -= 1;
        } else {
            break;
        }
        if depth < -10 {
            break;
        }
    }

    // Walk children DOWN (BFS)
    let mut children = Vec::new();
    let mut queue: Vec<(String, i32)> = vec![(model_id.to_string(), 1)];
    let mut child_visited = std::collections::HashSet::new();
    child_visited.insert(model_id.to_string());

    while let Some((current, d)) = queue.pop() {
        if d > 10 {
            continue;
        }
        for m in all_models.iter() {
            if m.parent_model_id.as_deref() == Some(&current) && !child_visited.contains(&m.id) {
                child_visited.insert(m.id.clone());
                children.push(HierarchyNode {
                    id: m.id.clone(),
                    name: m.name.clone(),
                    depth: d,
                });
                queue.push((m.id.clone(), d + 1));
            }
        }
    }

    // Mixins — both "uses" (this model's mixins) and "used_by" (models mixing this one in)
    let mut mixins = Vec::new();

    let own_mixin_ids: Vec<String> = serde_json::from_str(&model.mixin_model_ids).map_err(|e| {
        format!(
            "Malformed mixin_model_ids JSON for model '{}': {}",
            model_id, e
        )
    })?;
    for mid in &own_mixin_ids {
        if let Some(m) = model_map.get(mid) {
            mixins.push(MixinEdge {
                id: m.id.clone(),
                name: m.name.clone(),
                relation: "uses".to_string(),
            });
        }
    }

    for m in all_models.iter() {
        let their_mixins: Vec<String> = serde_json::from_str(&m.mixin_model_ids)
            .map_err(|e| format!("Malformed mixin_model_ids JSON for model '{}': {}", m.id, e))?;
        if their_mixins.contains(&model_id.to_string()) {
            mixins.push(MixinEdge {
                id: m.id.clone(),
                name: m.name.clone(),
                relation: "used_by".to_string(),
            });
        }
    }

    Ok(HierarchyResult {
        parent_chain,
        children,
        mixins,
    })
}

/// Sanitize a UUID for use as a Mermaid node identifier.
/// Uses first 8 chars of the UUID, prefixed with 'M_', stripping hyphens.
fn sanitize_id(id: &str) -> String {
    format!(
        "M_{}",
        id.chars().take(8).collect::<String>().replace('-', "")
    )
}

pub async fn generate_mermaid_diagram(project_id: &str) -> Result<String, String> {
    let graph = get_model_relations(project_id).await?;

    let model_map: HashMap<String, &RelationNode> =
        graph.nodes.iter().map(|n| (n.id.clone(), n)).collect();

    let mut lines = vec!["classDiagram".to_string()];

    // Load full models for field details
    let all_models = db::models::list_models(project_id)
        .await
        .map_err(|e| e.to_string())?;
    let full_map: HashMap<String, db::models::DataModel> =
        all_models.into_iter().map(|m| (m.id.clone(), m)).collect();

    // Render classes with field details
    for node in &graph.nodes {
        let safe_id = sanitize_id(&node.id);
        let safe_name = node.name.replace(['"', '`'], "'");

        lines.push(format!("    class {} [\"{}\"] {{", safe_id, safe_name));

        if let Some(model) = full_map.get(&node.id) {
            let fields: Vec<serde_json::Value> = serde_json::from_str(&model.fields)
                .map_err(|e| format!("Malformed fields JSON for model '{}': {}", model.id, e))?;
            for field in &fields {
                let name = field.get("name").and_then(|v| v.as_str()).unwrap_or("?");
                let ftype = field
                    .get("field_type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("any");
                let required = field
                    .get("required")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let req_marker = if required { "*" } else { "" };
                let safe_field_name = name.replace(' ', "_").replace('"', "");
                lines.push(format!(
                    "        +{} {}{}",
                    ftype, safe_field_name, req_marker
                ));
            }
        }

        lines.push("    }".to_string());
    }

    // Render edges
    for edge in &graph.edges {
        // Only render edges where both endpoints are known nodes
        if !model_map.contains_key(&edge.from) || !model_map.contains_key(&edge.to) {
            continue;
        }

        let from_id = sanitize_id(&edge.from);
        let to_id = sanitize_id(&edge.to);

        match edge.edge_type.as_str() {
            "inherits" => {
                lines.push(format!("    {} <|-- {} : inherits", to_id, from_id));
            }
            "mixin" => {
                lines.push(format!("    {} <|.. {} : mixin", to_id, from_id));
            }
            "field_ref" => {
                let label = edge.label.as_deref().unwrap_or("ref");
                lines.push(format!("    {} --> {} : {}", from_id, to_id, label));
            }
            _ => {}
        }
    }

    Ok(lines.join("\n"))
}
