use std::collections::HashMap;

use super::{get_connection, DbResult};
use serde::{Deserialize, Serialize};

type PositionCache = HashMap<String, (Option<f64>, Option<f64>, Option<f64>)>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphNode {
    pub id: String,
    pub project_id: String,
    pub entity_type: String, // "collection" | "request" | "model"
    pub entity_id: String,
    pub label: String,
    pub properties: String, // JSON blob
    pub size: f64,
    pub color: String,
    pub fx: Option<f64>,
    pub fy: Option<f64>,
    pub fz: Option<f64>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphEdge {
    pub id: String,
    pub project_id: String,
    pub source_id: String,
    pub target_id: String,
    pub edge_type: String, // "col-subcol" | "col-request" | etc.
    pub label: String,
    pub properties: String, // JSON blob
    pub created_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NodePositionUpdate {
    pub id: String,
    pub fx: f64,
    pub fy: f64,
    pub fz: f64,
}

// ---------------------------------------------------------------------------
// Table DDL
// ---------------------------------------------------------------------------

pub fn get_table_sql() -> &'static str {
    "
    CREATE TABLE IF NOT EXISTS graph_nodes (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        label TEXT NOT NULL,
        properties TEXT NOT NULL DEFAULT '{}',
        size REAL NOT NULL DEFAULT 1.0,
        color TEXT NOT NULL DEFAULT '#888',
        fx REAL,
        fy REAL,
        fz REAL,
        created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_graph_nodes_project ON graph_nodes(project_id);
    CREATE INDEX IF NOT EXISTS idx_graph_nodes_entity ON graph_nodes(entity_type, entity_id);

    CREATE TABLE IF NOT EXISTS graph_edges (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        source_id TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
        target_id TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
        edge_type TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        properties TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_graph_edges_project ON graph_edges(project_id);
    CREATE INDEX IF NOT EXISTS idx_graph_edges_source ON graph_edges(source_id);
    CREATE INDEX IF NOT EXISTS idx_graph_edges_target ON graph_edges(target_id);
    "
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

/// Replace all graph data for a project in a single transaction.
/// Preserves cached fx/fy/fz positions by matching node IDs.
pub async fn replace_project_graph(
    project_id: &str,
    nodes: &[GraphNode],
    edges: &[GraphEdge],
) -> DbResult<()> {
    let conn = get_connection()?.lock().await;

    // 1. Read existing node positions into a HashMap before deleting
    let mut rows = conn
        .query(
            "SELECT id, fx, fy, fz FROM graph_nodes WHERE project_id = ?1",
            turso::params![project_id],
        )
        .await?;

    let mut cached_positions: PositionCache = HashMap::new();

    while let Some(row) = rows.next().await? {
        let id: String = row.get(0)?;
        let fx: Option<f64> = row.get(1)?;
        let fy: Option<f64> = row.get(2)?;
        let fz: Option<f64> = row.get(3)?;
        cached_positions.insert(id, (fx, fy, fz));
    }
    drop(rows);

    // 2. Transaction: delete old data, insert new data
    conn.execute("BEGIN IMMEDIATE", ()).await?;

    let result: Result<(), Box<dyn std::error::Error + Send + Sync>> = async {
        // Delete edges first (FK references nodes)
        conn.execute(
            "DELETE FROM graph_edges WHERE project_id = ?1",
            turso::params![project_id],
        )
        .await?;

        // Delete old nodes
        conn.execute(
            "DELETE FROM graph_nodes WHERE project_id = ?1",
            turso::params![project_id],
        )
        .await?;

        // Insert new nodes (restoring cached positions where available)
        for node in nodes {
            let (fx, fy, fz) = cached_positions
                .get(&node.id)
                .cloned()
                .unwrap_or((node.fx, node.fy, node.fz));

            conn.execute(
                "INSERT INTO graph_nodes (id, project_id, entity_type, entity_id, label, properties, size, color, fx, fy, fz, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                turso::params![
                    node.id.as_str(),
                    node.project_id.as_str(),
                    node.entity_type.as_str(),
                    node.entity_id.as_str(),
                    node.label.as_str(),
                    node.properties.as_str(),
                    node.size,
                    node.color.as_str(),
                    fx,
                    fy,
                    fz,
                    node.created_at
                ],
            )
            .await?;
        }

        // Insert new edges
        for edge in edges {
            conn.execute(
                "INSERT INTO graph_edges (id, project_id, source_id, target_id, edge_type, label, properties, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                turso::params![
                    edge.id.as_str(),
                    edge.project_id.as_str(),
                    edge.source_id.as_str(),
                    edge.target_id.as_str(),
                    edge.edge_type.as_str(),
                    edge.label.as_str(),
                    edge.properties.as_str(),
                    edge.created_at
                ],
            )
            .await?;
        }

        Ok(())
    }
    .await;

    match result {
        Ok(()) => {
            conn.execute("COMMIT", ()).await?;
            Ok(())
        }
        Err(e) => {
            let _ = conn.execute("ROLLBACK", ()).await;
            Err(e)
        }
    }
}

/// List all graph nodes for a project.
pub async fn list_graph_nodes(project_id: &str) -> DbResult<Vec<GraphNode>> {
    let conn = get_connection()?.lock().await;
    let mut rows = conn
        .query(
            "SELECT id, project_id, entity_type, entity_id, label, properties, size, color, fx, fy, fz, created_at
             FROM graph_nodes WHERE project_id = ?1 ORDER BY entity_type, label",
            turso::params![project_id],
        )
        .await?;

    let mut nodes = Vec::new();
    while let Some(row) = rows.next().await? {
        nodes.push(GraphNode {
            id: row.get(0)?,
            project_id: row.get(1)?,
            entity_type: row.get(2)?,
            entity_id: row.get(3)?,
            label: row.get(4)?,
            properties: row.get(5)?,
            size: row.get(6)?,
            color: row.get(7)?,
            fx: row.get(8)?,
            fy: row.get(9)?,
            fz: row.get(10)?,
            created_at: row.get(11)?,
        });
    }

    Ok(nodes)
}

/// List all graph edges for a project.
pub async fn list_graph_edges(project_id: &str) -> DbResult<Vec<GraphEdge>> {
    let conn = get_connection()?.lock().await;
    let mut rows = conn
        .query(
            "SELECT id, project_id, source_id, target_id, edge_type, label, properties, created_at
             FROM graph_edges WHERE project_id = ?1",
            turso::params![project_id],
        )
        .await?;

    let mut edges = Vec::new();
    while let Some(row) = rows.next().await? {
        edges.push(GraphEdge {
            id: row.get(0)?,
            project_id: row.get(1)?,
            source_id: row.get(2)?,
            target_id: row.get(3)?,
            edge_type: row.get(4)?,
            label: row.get(5)?,
            properties: row.get(6)?,
            created_at: row.get(7)?,
        });
    }

    Ok(edges)
}

/// Batch-update node positions (fx, fy, fz).
pub async fn update_node_positions(updates: &[NodePositionUpdate]) -> DbResult<()> {
    if updates.is_empty() {
        return Ok(());
    }

    let conn = get_connection()?.lock().await;

    conn.execute("BEGIN IMMEDIATE", ()).await?;

    let result: Result<(), Box<dyn std::error::Error + Send + Sync>> = async {
        for update in updates {
            conn.execute(
                "UPDATE graph_nodes SET fx = ?1, fy = ?2, fz = ?3 WHERE id = ?4",
                turso::params![update.fx, update.fy, update.fz, update.id.as_str()],
            )
            .await?;
        }
        Ok(())
    }
    .await;

    match result {
        Ok(()) => {
            conn.execute("COMMIT", ()).await?;
            Ok(())
        }
        Err(e) => {
            let _ = conn.execute("ROLLBACK", ()).await;
            Err(e)
        }
    }
}

/// Clear all graph data for a project.
pub async fn clear_project_graph(project_id: &str) -> DbResult<()> {
    let conn = get_connection()?.lock().await;

    // Edges first (FK on nodes)
    conn.execute(
        "DELETE FROM graph_edges WHERE project_id = ?1",
        turso::params![project_id],
    )
    .await?;

    conn.execute(
        "DELETE FROM graph_nodes WHERE project_id = ?1",
        turso::params![project_id],
    )
    .await?;

    Ok(())
}
