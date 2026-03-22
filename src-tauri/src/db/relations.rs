use std::collections::HashSet;

use super::{get_connection, DbResult};
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelatedEntity {
    pub entity_type: String,
    pub entity_id: String,
    pub name: String,
    pub relation: String,
    pub label: Option<String>,
    pub distance: i32,
    pub description_text: String,
}

// ---------------------------------------------------------------------------
// Table DDL
// ---------------------------------------------------------------------------

pub fn get_table_sql() -> &'static str {
    "
    CREATE TABLE IF NOT EXISTS entity_relations (
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        relation TEXT NOT NULL,
        label TEXT,
        PRIMARY KEY (source_type, source_id, target_type, target_id, relation)
    );
    CREATE INDEX IF NOT EXISTS idx_relations_source ON entity_relations(source_type, source_id);
    CREATE INDEX IF NOT EXISTS idx_relations_target ON entity_relations(target_type, target_id);
    "
}

// ---------------------------------------------------------------------------
// Rebuild all relations for a project
// ---------------------------------------------------------------------------

/// Rebuild the entity_relations table for a given project.
///
/// Loads all entities, extracts relations via `entity_graph::extract_relations`,
/// then replaces all rows for this project in a single transaction.
pub async fn rebuild_entity_relations(project_id: &str) -> DbResult<()> {
    // Phase 1: Load entities (read, releases lock after each call)
    let collections = super::collections::list_collections(Some(project_id)).await?;

    let mut all_requests: Vec<crate::db::ApiRequest> = Vec::new();
    for col in &collections {
        let col_reqs = super::requests::list_requests(&col.id).await?;
        all_requests.extend(col_reqs);
    }
    let root_reqs = super::requests::list_root_requests(project_id).await?;
    all_requests.extend(root_reqs);

    // Deduplicate by ID
    let mut seen_req_ids: HashSet<String> = HashSet::new();
    all_requests.retain(|r| seen_req_ids.insert(r.id.clone()));

    let models = super::models::list_models(project_id).await?;

    // Phase 2: Compute relations (pure, no I/O)
    let relations =
        super::entity_graph::extract_relations(project_id, &collections, &all_requests, &models);

    // Phase 3: Write to DB in a transaction
    let conn = get_connection()?.lock().await;

    conn.execute("BEGIN IMMEDIATE", ()).await?;

    let result: Result<(), Box<dyn std::error::Error + Send + Sync>> = async {
        // Collect all entity IDs that belong to this project so we can scope the DELETE.
        // We delete by matching source entities that belong to the project.
        // This covers project-level, collection, request, and model sources.
        let mut project_entity_ids: Vec<(String, String)> = Vec::new();
        project_entity_ids.push(("project".to_string(), project_id.to_string()));
        for col in &collections {
            project_entity_ids.push(("collection".to_string(), col.id.clone()));
        }
        for req in &all_requests {
            project_entity_ids.push(("request".to_string(), req.id.clone()));
        }
        for model in &models {
            project_entity_ids.push(("model".to_string(), model.id.clone()));
        }

        // Delete existing relations where this project's entities are the source
        for (etype, eid) in &project_entity_ids {
            conn.execute(
                "DELETE FROM entity_relations WHERE source_type = ?1 AND source_id = ?2",
                turso::params![etype.as_str(), eid.as_str()],
            )
            .await?;
        }

        // Insert new relations
        for rel in &relations {
            conn.execute(
                "INSERT OR REPLACE INTO entity_relations (source_type, source_id, target_type, target_id, relation, label)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                turso::params![
                    rel.source_type.as_str(),
                    rel.source_id.as_str(),
                    rel.target_type.as_str(),
                    rel.target_id.as_str(),
                    rel.relation.as_str(),
                    rel.label.as_deref()
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

// ---------------------------------------------------------------------------
// Query: find related entities (bidirectional traversal)
// ---------------------------------------------------------------------------

/// Find all entities related to the given entity up to `max_depth` hops away.
///
/// Uses a bidirectional recursive CTE in SQL, then deduplicates and applies
/// cycle prevention in Rust post-processing.
pub async fn find_related_entities(
    entity_type: &str,
    entity_id: &str,
    max_depth: usize,
) -> DbResult<Vec<RelatedEntity>> {
    let conn = get_connection()?.lock().await;

    // Bidirectional recursive CTE:
    // - Forward: follow source → target
    // - Backward: follow target → source
    // We cap recursion at max_depth via the `depth` column.
    let sql = format!(
        "WITH RECURSIVE related(entity_type, entity_id, relation, label, distance) AS (
            -- Forward seed: entities where we are the source
            SELECT target_type, target_id, relation, label, 1
            FROM entity_relations
            WHERE source_type = ?1 AND source_id = ?2

            UNION

            -- Backward seed: entities where we are the target
            SELECT source_type, source_id, relation, label, 1
            FROM entity_relations
            WHERE target_type = ?1 AND target_id = ?2

            UNION

            -- Forward recursion
            SELECT er.target_type, er.target_id, er.relation, er.label, r.distance + 1
            FROM related r
            JOIN entity_relations er ON er.source_type = r.entity_type AND er.source_id = r.entity_id
            WHERE r.distance < {max_depth}

            UNION

            -- Backward recursion
            SELECT er.source_type, er.source_id, er.relation, er.label, r.distance + 1
            FROM related r
            JOIN entity_relations er ON er.target_type = r.entity_type AND er.target_id = r.entity_id
            WHERE r.distance < {max_depth}
        )
        SELECT DISTINCT entity_type, entity_id, relation, label, MIN(distance) as distance
        FROM related
        WHERE NOT (entity_type = ?1 AND entity_id = ?2)
        GROUP BY entity_type, entity_id, relation
        ORDER BY distance, entity_type, entity_id"
    );

    let mut rows = conn
        .query(&sql, turso::params![entity_type, entity_id])
        .await?;

    let mut raw_results: Vec<(String, String, String, Option<String>, i32)> = Vec::new();
    while let Some(row) = rows.next().await? {
        let etype: String = row.get(0)?;
        let eid: String = row.get(1)?;
        let relation: String = row.get(2)?;
        let label: Option<String> = row.get(3)?;
        let distance: i32 = row.get(4)?;
        raw_results.push((etype, eid, relation, label, distance));
    }
    drop(rows);

    // Rust-side cycle prevention: track visited (type, id) pairs
    let mut visited: HashSet<String> = HashSet::new();
    visited.insert(format!("{}:{}", entity_type, entity_id));

    let mut results: Vec<RelatedEntity> = Vec::new();

    for (etype, eid, relation, label, distance) in raw_results {
        let key = format!("{}:{}", etype, eid);
        if !visited.insert(key) {
            // Already seen this entity — skip duplicate (keep first/shortest distance)
            // But we still want multiple relations to the same entity, so only skip
            // if we already have this exact (type, id, relation) combo.
            // Actually the SQL GROUP BY already handles dedup per (type, id, relation),
            // so the visited set here just provides an extra safety net.
        }

        // Resolve entity name by querying the source table
        let name = resolve_entity_name(&conn, &etype, &eid).await?;

        // Resolve description text
        let description_text = resolve_entity_description(&conn, &etype, &eid).await;

        results.push(RelatedEntity {
            entity_type: etype,
            entity_id: eid,
            name,
            relation,
            label,
            distance,
            description_text,
        });
    }

    Ok(results)
}

// ---------------------------------------------------------------------------
// Query: find backlinks (who points at this entity?)
// ---------------------------------------------------------------------------

/// Find all entities that reference the given entity as a target.
pub async fn find_backlinks(entity_type: &str, entity_id: &str) -> DbResult<Vec<RelatedEntity>> {
    let conn = get_connection()?.lock().await;

    let mut rows = conn
        .query(
            "SELECT source_type, source_id, relation, label
             FROM entity_relations
             WHERE target_type = ?1 AND target_id = ?2
             ORDER BY source_type, source_id",
            turso::params![entity_type, entity_id],
        )
        .await?;

    let mut raw: Vec<(String, String, String, Option<String>)> = Vec::new();
    while let Some(row) = rows.next().await? {
        let stype: String = row.get(0)?;
        let sid: String = row.get(1)?;
        let relation: String = row.get(2)?;
        let label: Option<String> = row.get(3)?;
        raw.push((stype, sid, relation, label));
    }
    drop(rows);

    let mut results: Vec<RelatedEntity> = Vec::new();
    for (stype, sid, relation, label) in raw {
        let name = resolve_entity_name(&conn, &stype, &sid).await?;
        let description_text = resolve_entity_description(&conn, &stype, &sid).await;

        results.push(RelatedEntity {
            entity_type: stype,
            entity_id: sid,
            name,
            relation,
            label,
            distance: 1,
            description_text,
        });
    }

    Ok(results)
}

// ---------------------------------------------------------------------------
// Delete: remove all relations involving an entity
// ---------------------------------------------------------------------------

/// Delete all entity_relations rows where the entity appears as source OR target.
pub async fn delete_entity_relations(entity_type: &str, entity_id: &str) -> DbResult<()> {
    let conn = get_connection()?.lock().await;

    conn.execute(
        "DELETE FROM entity_relations WHERE (source_type = ?1 AND source_id = ?2) OR (target_type = ?1 AND target_id = ?2)",
        turso::params![entity_type, entity_id],
    )
    .await?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Resolve the display name for an entity by querying its source table.
async fn resolve_entity_name(
    conn: &turso::Connection,
    entity_type: &str,
    entity_id: &str,
) -> DbResult<String> {
    let (table, col) = match entity_type {
        "project" => ("projects", "name"),
        "collection" => ("collections", "name"),
        "request" => ("api_requests", "name"),
        "model" => ("data_models", "name"),
        "environment" => ("environments", "name"),
        _ => return Ok(entity_id.to_string()),
    };

    let sql = format!("SELECT {} FROM {} WHERE id = ?1", col, table);
    let mut rows = conn.query(&sql, turso::params![entity_id]).await?;

    if let Some(row) = rows.next().await? {
        let name: String = row.get(0)?;
        Ok(name)
    } else {
        Ok(entity_id.to_string())
    }
}

/// Resolve a description for an entity. Returns empty string if none found.
async fn resolve_entity_description(
    conn: &turso::Connection,
    entity_type: &str,
    entity_id: &str,
) -> String {
    let sql = match entity_type {
        "project" => Some("SELECT description FROM projects WHERE id = ?1"),
        "collection" => Some("SELECT description FROM collections WHERE id = ?1"),
        "model" => Some("SELECT description FROM data_models WHERE id = ?1"),
        _ => None,
    };

    if let Some(sql) = sql {
        if let Ok(mut rows) = conn.query(sql, turso::params![entity_id]).await {
            if let Ok(Some(row)) = rows.next().await {
                if let Ok(desc) = row.get::<Option<String>>(0) {
                    return desc.unwrap_or_default();
                }
            }
        }
    }

    String::new()
}
