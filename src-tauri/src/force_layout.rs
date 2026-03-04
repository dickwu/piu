use std::collections::HashMap;

use crate::commands::graph_layout_commands::{
    ForceLayoutConfig, LayoutEdge, LayoutNode, LayoutPosition,
};

struct SimNode {
    id: String,
    x: f64,
    y: f64,
    vx: f64,
    vy: f64,
}

struct SimLink {
    source_idx: usize,
    target_idx: usize,
}

/// Maximum force magnitude applied per tick to prevent numerical explosion.
const MAX_FORCE_PER_TICK: f64 = 1000.0;

/// Clamp a force value to prevent runaway velocities.
fn clamp_force(value: f64) -> f64 {
    value.clamp(-MAX_FORCE_PER_TICK, MAX_FORCE_PER_TICK)
}

fn apply_link_force(
    nodes: &mut [SimNode],
    links: &[SimLink],
    link_counts: &[usize],
    config: &ForceLayoutConfig,
) {
    for link in links {
        let (sx, sy) = (nodes[link.source_idx].x, nodes[link.source_idx].y);
        let (tx, ty) = (nodes[link.target_idx].x, nodes[link.target_idx].y);

        let mut dx = tx - sx;
        let mut dy = ty - sy;
        let dist = (dx * dx + dy * dy).sqrt();

        // Guard against near-zero distance: use deterministic fallback direction
        if dist < 1e-6 {
            dx = 1.0;
            dy = 0.0;
        } else {
            dx /= dist;
            dy /= dist;
        }

        let displacement = if dist < 1e-6 {
            config.link_distance
        } else {
            dist - config.link_distance
        };

        let force = displacement * config.link_strength;

        // Bias: nodes with more links move less
        let source_count = link_counts[link.source_idx] as f64;
        let target_count = link_counts[link.target_idx] as f64;
        let total = source_count + target_count;
        let bias = if total > 0.0 {
            source_count / total
        } else {
            0.5
        };

        let fx = clamp_force(force * dx);
        let fy = clamp_force(force * dy);

        nodes[link.source_idx].vx += fx * bias;
        nodes[link.source_idx].vy += fy * bias;
        nodes[link.target_idx].vx -= fx * (1.0 - bias);
        nodes[link.target_idx].vy -= fy * (1.0 - bias);
    }
}

fn apply_charge_force(nodes: &mut [SimNode], alpha: f64, config: &ForceLayoutConfig) {
    let len = nodes.len();
    if len < 2 {
        return;
    }

    // Collect positions to avoid borrow conflicts
    let positions: Vec<(f64, f64)> = nodes.iter().map(|n| (n.x, n.y)).collect();

    for i in 0..len {
        let mut fx = 0.0_f64;
        let mut fy = 0.0_f64;

        for j in 0..len {
            if i == j {
                continue;
            }

            // d3-force convention: dx = quad.x - node.x (from i toward j)
            // With negative charge_strength, this produces repulsion (away from j)
            let mut dx = positions[j].0 - positions[i].0;
            let mut dy = positions[j].1 - positions[i].1;

            // Deterministic antisymmetric jitter for coincident nodes: break symmetry
            // so repulsion produces a non-zero direction vector. The sign flip
            // ensures pair (i,j) and (j,i) get exactly opposite jitter vectors,
            // preserving momentum balance.
            if dx * dx + dy * dy < 1e-12 {
                let base_angle = (i.min(j) as f64 - i.max(j) as f64) * 0.1;
                let sign = if i < j { 1.0 } else { -1.0 };
                dx = sign * base_angle.cos() * 1e-3;
                dy = sign * base_angle.sin() * 1e-3;
            }

            // Prevent division by zero: enforce minimum distance squared of 1.0
            let dist_sq = (dx * dx + dy * dy).max(1.0);
            let dist = dist_sq.sqrt();

            // Coulomb-style repulsion: strength * alpha / dist_sq, applied along unit vector
            let force_magnitude = config.charge_strength * alpha / dist_sq;
            fx += clamp_force(force_magnitude * (dx / dist));
            fy += clamp_force(force_magnitude * (dy / dist));
        }

        nodes[i].vx += fx;
        nodes[i].vy += fy;
    }
}

fn apply_center_force(nodes: &mut [SimNode]) {
    if nodes.is_empty() {
        return;
    }

    let len = nodes.len() as f64;
    let cx: f64 = nodes.iter().map(|n| n.x).sum::<f64>() / len;
    let cy: f64 = nodes.iter().map(|n| n.y).sum::<f64>() / len;

    for node in nodes.iter_mut() {
        node.vx -= cx;
        node.vy -= cy;
    }
}

fn apply_collision_force(nodes: &mut [SimNode], config: &ForceLayoutConfig) {
    let len = nodes.len();
    if len < 2 {
        return;
    }

    let radius = config.collision_radius;
    if radius <= 0.0 {
        return;
    }

    let min_dist = radius * 2.0;

    // Collect positions for immutable access
    let positions: Vec<(f64, f64)> = nodes.iter().map(|n| (n.x, n.y)).collect();

    for i in 0..len {
        for j in (i + 1)..len {
            let dx = positions[i].0 - positions[j].0;
            let dy = positions[i].1 - positions[j].1;
            let raw_dist = (dx * dx + dy * dy).sqrt();

            if raw_dist < min_dist {
                // Deterministic tie-break for exact overlaps: use index difference
                let (nx, ny) = if raw_dist < 1e-6 {
                    // Tie-break: deterministic direction based on index
                    let angle = (i as f64 - j as f64) * 0.1;
                    (angle.cos(), angle.sin())
                } else {
                    (dx / raw_dist, dy / raw_dist)
                };

                let overlap = (min_dist - raw_dist) * 0.5;
                let push_x = nx * overlap;
                let push_y = ny * overlap;

                nodes[i].vx += push_x;
                nodes[i].vy += push_y;
                nodes[j].vx -= push_x;
                nodes[j].vy -= push_y;
            }
        }
    }
}

pub fn run_simulation(
    nodes: Vec<LayoutNode>,
    edges: Vec<LayoutEdge>,
    config: &ForceLayoutConfig,
) -> Result<Vec<LayoutPosition>, String> {
    if nodes.is_empty() {
        return Ok(Vec::new());
    }

    // Build id -> index lookup
    let id_to_idx: HashMap<&str, usize> = nodes
        .iter()
        .enumerate()
        .map(|(idx, node)| (node.id.as_str(), idx))
        .collect();

    // Initialize SimNodes with zero velocity
    let mut sim_nodes: Vec<SimNode> = nodes
        .iter()
        .map(|n| SimNode {
            id: n.id.clone(),
            x: n.x,
            y: n.y,
            vx: 0.0,
            vy: 0.0,
        })
        .collect();

    // Build SimLinks, skipping edges with unresolvable endpoints or self-loops
    let mut sim_links: Vec<SimLink> = Vec::new();
    let mut link_counts: Vec<usize> = vec![0; sim_nodes.len()];

    for edge in &edges {
        let source_idx = match id_to_idx.get(edge.source.as_str()) {
            Some(&idx) => idx,
            None => continue,
        };
        let target_idx = match id_to_idx.get(edge.target.as_str()) {
            Some(&idx) => idx,
            None => continue,
        };

        // Filter self-loops
        if source_idx == target_idx {
            continue;
        }

        link_counts[source_idx] += 1;
        link_counts[target_idx] += 1;

        sim_links.push(SimLink {
            source_idx,
            target_idx,
        });
    }

    // Simulation parameters
    let mut alpha = 1.0_f64;
    let alpha_decay = config.alpha_decay;
    let alpha_min = config.alpha_min;
    let velocity_mul = 1.0 - config.velocity_decay;
    let max_iterations = config.max_iterations;

    let mut iterations = 0_usize;

    // Main simulation loop
    while alpha > alpha_min && iterations < max_iterations {
        // Apply forces
        apply_link_force(&mut sim_nodes, &sim_links, &link_counts, config);
        apply_charge_force(&mut sim_nodes, alpha, config);
        apply_center_force(&mut sim_nodes);
        apply_collision_force(&mut sim_nodes, config);

        // Integrate: apply velocity to position, then decay velocity
        for node in sim_nodes.iter_mut() {
            node.vx *= velocity_mul;
            node.vy *= velocity_mul;
            node.x += node.vx;
            node.y += node.vy;
        }

        // Decay alpha (d3-force exact formula with alpha_target = 0)
        alpha *= 1.0 - alpha_decay;
        iterations += 1;
    }

    // Produce output positions with finite guard
    let positions: Vec<LayoutPosition> = sim_nodes
        .into_iter()
        .map(|n| {
            // Clamp non-finite values to origin to prevent NaN/Inf from reaching frontend
            let x = if n.x.is_finite() { n.x } else { 0.0 };
            let y = if n.y.is_finite() { n.y } else { 0.0 };
            LayoutPosition { id: n.id, x, y }
        })
        .collect();

    Ok(positions)
}
