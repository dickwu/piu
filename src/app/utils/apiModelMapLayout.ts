import dagre from '@dagrejs/dagre';
import type { Node, Edge } from '@xyflow/react';
import type { Collection, ApiRequest, DataModel } from '../types';
import { parseConfig, parseModelFields, parseMixinModelIds } from '../types';

// ---------------------------------------------------------------------------
// Node data shapes
// ---------------------------------------------------------------------------

export interface CollectionNodeData extends Record<string, unknown> {
  name: string;
  pathPrefix: string | null;
  requestCount: number;
}

export interface RequestNodeData extends Record<string, unknown> {
  name: string;
  method: string;
  url: string;
}

export interface ModelNodeData extends Record<string, unknown> {
  name: string;
  fieldCount: number;
  fieldPreview: Array<{ name: string; type: string; required: boolean }>;
}

// ---------------------------------------------------------------------------
// Edge style constants
// ---------------------------------------------------------------------------

export const EDGE_STYLES = {
  'col-subcol': { stroke: '#8b8b99', strokeWidth: 1.5 },
  'col-request': { stroke: '#7a7a8e', strokeWidth: 1, strokeDasharray: '4 3' },
  'req-reqModel': { stroke: '#fbbf24', strokeWidth: 2 },
  'req-resModel': { stroke: '#34d399', strokeWidth: 2 },
  'model-inherits': { stroke: '#4a9eff', strokeWidth: 2 },
  'model-mixin': { stroke: '#9b59b6', strokeWidth: 1.5, strokeDasharray: '6 3' },
  'model-fieldRef': { stroke: '#2ecc71', strokeWidth: 1 },
} as const;

export type EdgeStyleKey = keyof typeof EDGE_STYLES;

// ---------------------------------------------------------------------------
// Internal geometry helpers
// ---------------------------------------------------------------------------

const COL_NODE_W = 180;
const COL_NODE_H = 60;
const REQ_NODE_W = 200;
const REQ_NODE_H = 52;
const MODEL_NODE_W = 180;
const MODEL_NODE_H = 80;

const API_ZONE_GAP = 300;
const DAGRE_NODESEP = 40;
const DAGRE_RANKSEP = 60;

interface ZoneBounds {
  maxX: number;
  minX: number;
}

/**
 * Compute the bounding box X extent of a set of laid-out dagre nodes.
 * Returns { minX: 0, maxX: 0 } for empty graphs.
 */
function computeZoneBounds(g: dagre.graphlib.Graph): ZoneBounds {
  const nodeIds = g.nodes();
  if (nodeIds.length === 0) {
    return { minX: 0, maxX: 0 };
  }

  let minX = Infinity;
  let maxX = -Infinity;

  for (const id of nodeIds) {
    const n = g.node(id) as { x: number; y: number; width: number; height: number } | undefined;
    if (!n) continue;
    const left = n.x - n.width / 2;
    const right = n.x + n.width / 2;
    if (left < minX) minX = left;
    if (right > maxX) maxX = right;
  }

  if (!isFinite(minX)) return { minX: 0, maxX: 0 };
  return { minX, maxX };
}

// ---------------------------------------------------------------------------
// Edge deduplication helper
// ---------------------------------------------------------------------------

function makeEdgeKey(source: string, target: string, type: EdgeStyleKey): string {
  return `${source}|${target}|${type}`;
}

// ---------------------------------------------------------------------------
// API zone builder
// ---------------------------------------------------------------------------

/**
 * Build dagre graph for the API zone (collections + requests).
 *
 * Only includes requests that actually belong to one of the provided
 * collections (via requestsByCollection / rootRequests).
 */
function buildApiGraph(
  collections: Collection[],
  requestsByCollection: Map<string, ApiRequest[]>,
  rootRequests: ApiRequest[],
): dagre.graphlib.Graph {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: DAGRE_NODESEP, ranksep: DAGRE_RANKSEP });
  g.setDefaultEdgeLabel(() => ({}));

  const collectionIds = new Set(collections.map((c) => c.id));

  // Add collection nodes
  for (const col of collections) {
    const requests = requestsByCollection.get(col.id) ?? [];
    g.setNode(`col:${col.id}`, { width: COL_NODE_W, height: COL_NODE_H });
    // Add request nodes under this collection
    for (const req of requests) {
      g.setNode(`req:${req.id}`, { width: REQ_NODE_W, height: REQ_NODE_H });
    }
  }

  // Add root request nodes (requests not in any collection)
  for (const req of rootRequests) {
    g.setNode(`req:${req.id}`, { width: REQ_NODE_W, height: REQ_NODE_H });
  }

  // Add col → sub-col edges (with cycle detection via visited set)
  for (const col of collections) {
    if (col.parent_id !== null && collectionIds.has(col.parent_id)) {
      const visited = new Set<string>();
      let cursor: string | null = col.parent_id;
      let isCyclic = false;

      while (cursor !== null) {
        if (visited.has(cursor)) {
          isCyclic = true;
          break;
        }
        visited.add(cursor);
        const parent = collections.find((c) => c.id === cursor);
        cursor = parent?.parent_id ?? null;
      }

      if (!isCyclic) {
        g.setEdge(`col:${col.parent_id}`, `col:${col.id}`);
      }
    }
  }

  // Add col → request edges
  for (const col of collections) {
    const requests = requestsByCollection.get(col.id) ?? [];
    for (const req of requests) {
      g.setEdge(`col:${col.id}`, `req:${req.id}`);
    }
  }

  return g;
}

// ---------------------------------------------------------------------------
// Model zone builder
// ---------------------------------------------------------------------------

/**
 * Build dagre graph for the model zone.
 */
function buildModelGraph(models: DataModel[]): dagre.graphlib.Graph {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: DAGRE_NODESEP, ranksep: DAGRE_RANKSEP });
  g.setDefaultEdgeLabel(() => ({}));

  const modelIds = new Set(models.map((m) => m.id));

  for (const model of models) {
    g.setNode(`model:${model.id}`, { width: MODEL_NODE_W, height: MODEL_NODE_H });
  }

  // Inheritance edges (parent → child) with cycle detection
  for (const model of models) {
    if (model.parent_model_id !== null && modelIds.has(model.parent_model_id)) {
      // Walk up the parent chain to detect cycles
      const visited = new Set<string>();
      let cursor: string | null = model.parent_model_id;
      let isCyclic = false;

      while (cursor !== null) {
        if (visited.has(cursor)) {
          isCyclic = true;
          break;
        }
        visited.add(cursor);
        const parent = models.find((m) => m.id === cursor);
        cursor = parent?.parent_model_id ?? null;
      }

      if (!isCyclic) {
        g.setEdge(`model:${model.parent_model_id}`, `model:${model.id}`);
      }
    }
  }

  return g;
}

// ---------------------------------------------------------------------------
// React Flow node / edge builders
// ---------------------------------------------------------------------------

function buildCollectionNode(
  col: Collection,
  x: number,
  y: number,
  requestsByCollection: Map<string, ApiRequest[]>,
): Node<CollectionNodeData> {
  const requests = requestsByCollection.get(col.id) ?? [];
  return {
    id: `col:${col.id}`,
    type: 'collectionNode',
    position: { x, y },
    data: {
      name: col.name,
      pathPrefix: col.path_prefix,
      requestCount: requests.length,
    },
    style: { width: COL_NODE_W, height: COL_NODE_H },
  };
}

function buildRequestNode(
  req: ApiRequest,
  x: number,
  y: number,
  parsedConfigCache: Map<string, ReturnType<typeof parseConfig>>,
): Node<RequestNodeData> {
  const cfg = parsedConfigCache.get(req.id) ?? parseConfig(req.config);
  return {
    id: `req:${req.id}`,
    type: 'requestNode',
    position: { x, y },
    data: {
      name: req.name,
      method: cfg.method,
      url: cfg.url,
    },
    style: { width: REQ_NODE_W, height: REQ_NODE_H },
  };
}

function buildModelNode(
  model: DataModel,
  x: number,
  y: number,
): Node<ModelNodeData> {
  const fields = parseModelFields(model.fields);
  const fieldPreview = fields.map((f) => ({
    name: f.name,
    type: f.field_type,
    required: f.required,
  }));

  return {
    id: `model:${model.id}`,
    type: 'modelNode',
    position: { x, y },
    data: {
      name: model.name,
      fieldCount: fields.length,
      fieldPreview,
    },
    style: { width: MODEL_NODE_W, height: MODEL_NODE_H },
  };
}

// ---------------------------------------------------------------------------
// React Flow coordinate extractor from dagre graph
// ---------------------------------------------------------------------------

/**
 * Dagre positions nodes at their center. React Flow positions nodes at their
 * top-left corner. This converts center → top-left and applies an X offset.
 */
function dagreNodeToPosition(
  g: dagre.graphlib.Graph,
  nodeId: string,
  xOffset: number,
): { x: number; y: number } | null {
  const n = g.node(nodeId) as
    | { x: number; y: number; width: number; height: number }
    | undefined;
  if (!n) return null;
  return {
    x: n.x - n.width / 2 + xOffset,
    y: n.y - n.height / 2,
  };
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

/**
 * Pure layout engine: transforms store data into React Flow nodes and edges
 * using two independent dagre graphs (API zone left, Model zone right).
 *
 * All inputs are treated as read-only. No side effects.
 */
export function buildApiModelMap(
  collections: Collection[],
  requestsByCollection: Map<string, ApiRequest[]>,
  rootRequests: ApiRequest[],
  models: DataModel[],
): { nodes: Node[]; edges: Edge[] } {
  // -------------------------------------------------------------------------
  // 0. Pre-parse all request configs once — reused for node data and edges
  // -------------------------------------------------------------------------
  const parsedConfigs = new Map<string, ReturnType<typeof parseConfig>>();
  for (const col of collections) {
    const reqs = requestsByCollection.get(col.id) ?? [];
    for (const req of reqs) {
      parsedConfigs.set(req.id, parseConfig(req.config));
    }
  }
  for (const req of rootRequests) {
    parsedConfigs.set(req.id, parseConfig(req.config));
  }

  // -------------------------------------------------------------------------
  // 1. Build and run API zone dagre layout
  // -------------------------------------------------------------------------
  const apiGraph = buildApiGraph(collections, requestsByCollection, rootRequests);
  const hasApiNodes = apiGraph.nodes().length > 0;

  if (hasApiNodes) {
    dagre.layout(apiGraph);
  }

  const apiBounds = hasApiNodes ? computeZoneBounds(apiGraph) : { minX: 0, maxX: 0 };
  const apiXOffset = hasApiNodes ? -apiBounds.minX : 0;

  // -------------------------------------------------------------------------
  // 2. Build and run Model zone dagre layout
  // -------------------------------------------------------------------------
  const modelGraph = buildModelGraph(models);
  const hasModelNodes = modelGraph.nodes().length > 0;

  if (hasModelNodes) {
    dagre.layout(modelGraph);
  }

  const modelBounds = hasModelNodes ? computeZoneBounds(modelGraph) : { minX: 0, maxX: 0 };

  // Model zone starts after API zone (or at 0 if API zone is empty)
  const apiZoneWidth = hasApiNodes ? apiBounds.maxX - apiBounds.minX : 0;
  const modelXOffset = hasModelNodes
    ? apiZoneWidth + API_ZONE_GAP - modelBounds.minX
    : apiZoneWidth + API_ZONE_GAP;

  // -------------------------------------------------------------------------
  // 3. Assemble React Flow nodes
  // -------------------------------------------------------------------------
  const nodes: Node[] = [];

  // Collection nodes
  for (const col of collections) {
    const pos = dagreNodeToPosition(apiGraph, `col:${col.id}`, apiXOffset);
    if (!pos) continue;
    nodes.push(buildCollectionNode(col, pos.x, pos.y, requestsByCollection));
  }

  // Request nodes from collections
  for (const col of collections) {
    const requests = requestsByCollection.get(col.id) ?? [];
    for (const req of requests) {
      const pos = dagreNodeToPosition(apiGraph, `req:${req.id}`, apiXOffset);
      if (!pos) continue;
      nodes.push(buildRequestNode(req, pos.x, pos.y, parsedConfigs));
    }
  }

  // Root request nodes
  for (const req of rootRequests) {
    const pos = dagreNodeToPosition(apiGraph, `req:${req.id}`, apiXOffset);
    if (!pos) continue;
    nodes.push(buildRequestNode(req, pos.x, pos.y, parsedConfigs));
  }

  // Model nodes
  for (const model of models) {
    const pos = dagreNodeToPosition(modelGraph, `model:${model.id}`, modelXOffset);
    if (!pos) continue;
    nodes.push(buildModelNode(model, pos.x, pos.y));
  }

  // -------------------------------------------------------------------------
  // 4. Assemble React Flow edges (deduplicated)
  // -------------------------------------------------------------------------
  const edges: Edge[] = [];
  const seenEdges = new Set<string>();
  const collectionIds = new Set(collections.map((c) => c.id));
  const modelIds = new Set(models.map((m) => m.id));

  // Build a fast lookup from req.id → ApiRequest for model link edges
  const allRequests = new Map<string, ApiRequest>();
  for (const col of collections) {
    const reqs = requestsByCollection.get(col.id) ?? [];
    for (const req of reqs) {
      allRequests.set(req.id, req);
    }
  }
  for (const req of rootRequests) {
    allRequests.set(req.id, req);
  }

  function addEdge(
    source: string,
    target: string,
    edgeType: EdgeStyleKey,
    label?: string,
  ): void {
    const key = makeEdgeKey(source, target, edgeType);
    if (seenEdges.has(key)) return;
    seenEdges.add(key);

    const style = EDGE_STYLES[edgeType];
    edges.push({
      id: key,
      source,
      target,
      type: 'smoothstep',
      label,
      style,
      data: { edgeType },
    });
  }

  // col → sub-col edges
  for (const col of collections) {
    if (col.parent_id !== null && collectionIds.has(col.parent_id)) {
      // Re-use the same cycle detection as the graph builder
      const visited = new Set<string>();
      let cursor: string | null = col.parent_id;
      let isCyclic = false;

      while (cursor !== null) {
        if (visited.has(cursor)) {
          isCyclic = true;
          break;
        }
        visited.add(cursor);
        const parent = collections.find((c) => c.id === cursor);
        cursor = parent?.parent_id ?? null;
      }

      if (!isCyclic) {
        addEdge(`col:${col.parent_id}`, `col:${col.id}`, 'col-subcol');
      }
    }
  }

  // col → request edges
  for (const col of collections) {
    const requests = requestsByCollection.get(col.id) ?? [];
    for (const req of requests) {
      addEdge(`col:${col.id}`, `req:${req.id}`, 'col-request');
    }
  }

  // request → model edges (req-reqModel and req-resModel)
  for (const [reqId, req] of allRequests) {
    const cfg = parsedConfigs.get(reqId) ?? parseConfig(req.config);

    if (cfg.requestModelId && modelIds.has(cfg.requestModelId)) {
      addEdge(`req:${reqId}`, `model:${cfg.requestModelId}`, 'req-reqModel');
    }

    if (cfg.responseModelId && modelIds.has(cfg.responseModelId)) {
      addEdge(`req:${reqId}`, `model:${cfg.responseModelId}`, 'req-resModel');
    }
  }

  // model → model inheritance edges
  for (const model of models) {
    if (model.parent_model_id !== null && modelIds.has(model.parent_model_id)) {
      const visited = new Set<string>();
      let cursor: string | null = model.parent_model_id;
      let isCyclic = false;

      while (cursor !== null) {
        if (visited.has(cursor)) {
          isCyclic = true;
          break;
        }
        visited.add(cursor);
        const parent = models.find((m) => m.id === cursor);
        cursor = parent?.parent_model_id ?? null;
      }

      if (!isCyclic) {
        addEdge(
          `model:${model.parent_model_id}`,
          `model:${model.id}`,
          'model-inherits',
        );
      }
    }
  }

  // model → mixin edges
  for (const model of models) {
    const mixinIds = parseMixinModelIds(model.mixin_model_ids);
    for (const mixinId of mixinIds) {
      if (modelIds.has(mixinId)) {
        addEdge(`model:${model.id}`, `model:${mixinId}`, 'model-mixin');
      }
    }
  }

  // model → field reference edges
  for (const model of models) {
    const fields = parseModelFields(model.fields);
    for (const field of fields) {
      if (field.ref_model_id && modelIds.has(field.ref_model_id)) {
        addEdge(
          `model:${model.id}`,
          `model:${field.ref_model_id}`,
          'model-fieldRef',
          field.name,
        );
      }
    }
  }

  return { nodes, edges };
}
