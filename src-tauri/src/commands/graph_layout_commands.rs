use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
pub struct LayoutNode {
    pub id: String,
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LayoutEdge {
    pub source: String,
    pub target: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ForceLayoutConfig {
    pub link_distance: f64,
    pub link_strength: f64,
    pub charge_strength: f64,
    pub collision_radius: f64,
    pub alpha_decay: f64,
    pub alpha_min: f64,
    pub velocity_decay: f64,
    pub max_iterations: usize,
}

impl Default for ForceLayoutConfig {
    fn default() -> Self {
        Self {
            link_distance: 180.0,
            link_strength: 0.5,
            charge_strength: -400.0,
            collision_radius: 55.0,
            alpha_decay: 0.02,
            alpha_min: 0.001,
            velocity_decay: 0.4,
            max_iterations: 300,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct GraphLayoutInput {
    pub nodes: Vec<LayoutNode>,
    pub edges: Vec<LayoutEdge>,
    pub config: Option<ForceLayoutConfig>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LayoutPosition {
    pub id: String,
    pub x: f64,
    pub y: f64,
}

fn validate_finite(value: f64, name: &str) -> Result<(), String> {
    if !value.is_finite() {
        return Err(format!(
            "Config parameter '{}' must be a finite number",
            name
        ));
    }
    Ok(())
}

fn validate_config(config: &ForceLayoutConfig) -> Result<(), String> {
    validate_finite(config.link_distance, "link_distance")?;
    validate_finite(config.link_strength, "link_strength")?;
    validate_finite(config.charge_strength, "charge_strength")?;
    validate_finite(config.collision_radius, "collision_radius")?;
    validate_finite(config.alpha_decay, "alpha_decay")?;
    validate_finite(config.alpha_min, "alpha_min")?;
    validate_finite(config.velocity_decay, "velocity_decay")?;

    if config.link_distance < 0.0 {
        return Err("link_distance must be non-negative".to_string());
    }
    if config.link_strength < 0.0 || config.link_strength > 1.0 {
        return Err("link_strength must be between 0.0 and 1.0".to_string());
    }
    if config.collision_radius < 0.0 {
        return Err("collision_radius must be non-negative".to_string());
    }
    if config.alpha_decay <= 0.0 || config.alpha_decay >= 1.0 {
        return Err("alpha_decay must be between 0.0 and 1.0 (exclusive)".to_string());
    }
    if config.alpha_min < 0.0 || config.alpha_min >= 1.0 {
        return Err("alpha_min must be between 0.0 and 1.0".to_string());
    }
    if config.velocity_decay < 0.0 || config.velocity_decay > 1.0 {
        return Err("velocity_decay must be between 0.0 and 1.0".to_string());
    }
    const MAX_ALLOWED_ITERATIONS: usize = 10_000;
    if config.max_iterations == 0 || config.max_iterations > MAX_ALLOWED_ITERATIONS {
        return Err(format!(
            "max_iterations must be between 1 and {}",
            MAX_ALLOWED_ITERATIONS
        ));
    }

    Ok(())
}

fn validate_nodes(nodes: &[LayoutNode]) -> Result<(), String> {
    for node in nodes {
        if !node.x.is_finite() {
            return Err(format!("Node '{}' has non-finite x coordinate", node.id));
        }
        if !node.y.is_finite() {
            return Err(format!("Node '{}' has non-finite y coordinate", node.id));
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn compute_graph_layout(input: GraphLayoutInput) -> Result<Vec<LayoutPosition>, String> {
    if input.nodes.is_empty() {
        return Ok(Vec::new());
    }

    let config = input.config.unwrap_or_default();
    validate_config(&config)?;
    validate_nodes(&input.nodes)?;

    let result: Result<Vec<LayoutPosition>, String> = tokio::task::spawn_blocking(move || {
        crate::force_layout::run_simulation(input.nodes, input.edges, &config)
    })
    .await
    .map_err(|e| format!("Layout computation failed: {}", e))?;

    result
}
