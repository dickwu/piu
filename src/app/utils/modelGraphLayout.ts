import type { DataModel } from '../types';
import { parseModelFields, parseMixinModelIds } from '../types';

export const NODE_W = 150;
export const NODE_H = 56;
const H_GAP = 70;
const ROW_HEIGHT = 120;

export interface GraphNode {
  model: DataModel;
  x: number;
  y: number;
  level: number;
}

export interface GraphEdge {
  fromId: string;
  toId: string;
  type: 'inherits' | 'mixin' | 'field_ref';
  label?: string;
}

export interface ModelGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Compute node positions (Three.js world units) and edges from a flat DataModel list.
 * Layout: hierarchical top-down, y positive = up, roots at top.
 * Isolated models (no parent and no one refers to them as parent) float below.
 */
export function computeModelGraph(models: DataModel[]): ModelGraph {
  if (models.length === 0) return { nodes: [], edges: [] };

  const modelMap = new Map(models.map((m) => [m.id, m]));
  const childMap = new Map<string, string[]>();

  for (const m of models) {
    if (m.parent_model_id) {
      const siblings = childMap.get(m.parent_model_id) ?? [];
      siblings.push(m.id);
      childMap.set(m.parent_model_id, siblings);
    }
  }

  // Roots: models with no parent (or invalid parent)
  const roots = models.filter(
    (m) => !m.parent_model_id || !modelMap.has(m.parent_model_id),
  );

  // DFS to assign levels and detect tree members
  const levels = new Map<string, number>();
  const visited = new Set<string>();

  function dfsLevel(id: string, level: number) {
    if (visited.has(id)) return; // cycle guard
    visited.add(id);
    levels.set(id, level);
    for (const childId of childMap.get(id) ?? []) {
      dfsLevel(childId, level + 1);
    }
  }

  for (const root of roots) {
    dfsLevel(root.id, 0);
  }

  // Orphans: models not reached by DFS (not connected to any root via parent chain)
  const orphans = models.filter((m) => !levels.has(m.id));
  let maxLevel = 0;
  for (const lvl of levels.values()) {
    if (lvl > maxLevel) maxLevel = lvl;
  }
  for (const orphan of orphans) {
    levels.set(orphan.id, maxLevel + 2);
  }

  // Compute subtree width recursively (memoized)
  const subtreeWidthCache = new Map<string, number>();

  function subtreeWidth(id: string): number {
    if (subtreeWidthCache.has(id)) return subtreeWidthCache.get(id)!;
    const children = childMap.get(id) ?? [];
    let width: number;
    if (children.length === 0) {
      width = NODE_W;
    } else {
      const childWidths = children.map(subtreeWidth);
      const total = childWidths.reduce((a, b) => a + b, 0) + H_GAP * (children.length - 1);
      width = Math.max(NODE_W, total);
    }
    subtreeWidthCache.set(id, width);
    return width;
  }

  // Assign x positions
  const positions = new Map<string, { x: number; y: number }>();

  function assignX(id: string, cx: number, y: number) {
    positions.set(id, { x: cx, y });
    const children = childMap.get(id) ?? [];
    if (children.length === 0) return;
    const childWidths = children.map(subtreeWidth);
    const total = childWidths.reduce((a, b) => a + b, 0) + H_GAP * (children.length - 1);
    let startX = cx - total / 2;
    for (let i = 0; i < children.length; i++) {
      assignX(children[i], startX + childWidths[i] / 2, y - ROW_HEIGHT);
      startX += childWidths[i] + H_GAP;
    }
  }

  // Lay out each root tree side by side
  const rootWidths = roots.map((r) => subtreeWidth(r.id));
  const totalRootWidth = rootWidths.reduce((a, b) => a + b, 0) + H_GAP * (roots.length - 1);
  let startX = -totalRootWidth / 2;
  for (let i = 0; i < roots.length; i++) {
    assignX(roots[i].id, startX + rootWidths[i] / 2, 0);
    startX += rootWidths[i] + H_GAP;
  }

  // Place orphans in a row below
  const orphanY = -(maxLevel + 2) * ROW_HEIGHT;
  const orphanTotalW = orphans.length * NODE_W + (orphans.length - 1) * H_GAP;
  let orphanX = -orphanTotalW / 2;
  for (const orphan of orphans) {
    positions.set(orphan.id, { x: orphanX + NODE_W / 2, y: orphanY });
    orphanX += NODE_W + H_GAP;
  }

  // Build GraphNode list
  const nodes: GraphNode[] = models.map((model) => {
    const pos = positions.get(model.id) ?? { x: 0, y: 0 };
    return {
      model,
      x: pos.x,
      y: pos.y,
      level: levels.get(model.id) ?? 0,
    };
  });

  // Build edges
  const edges: GraphEdge[] = [];
  const seenEdges = new Set<string>();

  function addEdge(e: GraphEdge) {
    const key = `${e.fromId}:${e.toId}:${e.type}`;
    if (!seenEdges.has(key)) {
      seenEdges.add(key);
      edges.push(e);
    }
  }

  for (const model of models) {
    // Inheritance edge: parent → child
    if (model.parent_model_id && modelMap.has(model.parent_model_id)) {
      addEdge({ fromId: model.parent_model_id, toId: model.id, type: 'inherits' });
    }

    // Mixin edges: model → mixin (model "uses" mixin)
    const mixinIds = parseMixinModelIds(model.mixin_model_ids);
    for (const mixinId of mixinIds) {
      if (modelMap.has(mixinId)) {
        addEdge({ fromId: model.id, toId: mixinId, type: 'mixin' });
      }
    }

    // Field reference edges
    const fields = parseModelFields(model.fields);
    for (const field of fields) {
      if (field.ref_model_id && modelMap.has(field.ref_model_id)) {
        addEdge({
          fromId: model.id,
          toId: field.ref_model_id,
          type: 'field_ref',
          label: field.name,
        });
      }
    }
  }

  return { nodes, edges };
}
