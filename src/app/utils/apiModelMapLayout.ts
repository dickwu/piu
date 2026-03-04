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
// Internal geometry constants
// ---------------------------------------------------------------------------

const COL_NODE_W = 180;
const COL_NODE_H = 60;
const REQ_NODE_W = 200;
const REQ_NODE_H = 52;
const MODEL_NODE_W = 180;
const MODEL_NODE_H = 80;

const DAGRE_NODESEP = 50;
const DAGRE_RANKSEP = 70;

// ---------------------------------------------------------------------------
// Graph bounds helper
// ---------------------------------------------------------------------------

interface GraphBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * Compute the bounding box (X and Y) of all laid-out dagre nodes.
 * Returns zeroed bounds for empty graphs.
 */
function computeGraphBounds(g: dagre.graphlib.Graph): GraphBounds {
  const nodeIds = g.nodes();
  if (nodeIds.length === 0) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const id of nodeIds) {
    const n = g.node(id) as { x: number; y: number; width: number; height: number } | undefined;
    if (!n) continue;
    const left = n.x - n.width / 2;
    const right = n.x + n.width / 2;
    const top = n.y - n.height / 2;
    const bottom = n.y + n.height / 2;
    if (left < minX) minX = left;
    if (right > maxX) maxX = right;
    if (top < minY) minY = top;
    if (bottom > maxY) maxY = bottom;
  }

  if (!isFinite(minX)) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  return { minX, maxX, minY, maxY };
}

// ---------------------------------------------------------------------------
// Edge deduplication helper
// ---------------------------------------------------------------------------

function makeEdgeKey(source: string, target: string, type: EdgeStyleKey): string {
  return `${source}|${target}|${type}`;
}

// ---------------------------------------------------------------------------
// Cycle detection helpers
// ---------------------------------------------------------------------------

/**
 * Check if the ancestor chain starting from `startId` contains a cycle.
 * Uses a pre-built lookup map for O(1) parent resolution.
 */
function hasCollectionAncestorCycle(
  startId: string,
  collectionById: Map<string, Collection>,
): boolean {
  const visited = new Set<string>();
  let cursor: string | null = startId;

  while (cursor !== null) {
    if (visited.has(cursor)) return true;
    visited.add(cursor);
    const parent = collectionById.get(cursor);
    cursor = parent?.parent_id ?? null;
  }

  return false;
}

/**
 * Check if the model inheritance chain starting from `startId` contains a cycle.
 * Uses a pre-built lookup map for O(1) parent resolution.
 */
function hasModelInheritanceCycle(
  startId: string,
  modelById: Map<string, DataModel>,
): boolean {
  const visited = new Set<string>();
  let cursor: string | null = startId;

  while (cursor !== null) {
    if (visited.has(cursor)) return true;
    visited.add(cursor);
    const parent = modelById.get(cursor);
    cursor = parent?.parent_model_id ?? null;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Request lookup helper
// ---------------------------------------------------------------------------

/**
 * Build a fast lookup map from request ID to ApiRequest,
 * collecting from both collection-owned and root requests.
 */
function collectAllRequests(
  collections: Collection[],
  requestsByCollection: Map<string, ApiRequest[]>,
  rootRequests: ApiRequest[],
): Map<string, ApiRequest> {
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
  return allRequests;
}

// ---------------------------------------------------------------------------
// Unified dagre graph builder
// ---------------------------------------------------------------------------

/**
 * Build a single dagre multigraph containing ALL node types (collections,
 * requests, models) and the 5 acyclic backbone edge types:
 *   col→subcol, col→request, req→reqModel, req→resModel, model→inherits
 *
 * Mixin and fieldRef edges are excluded because they can create cycles.
 */
function buildUnifiedGraph(
  collections: Collection[],
  requestsByCollection: Map<string, ApiRequest[]>,
  rootRequests: ApiRequest[],
  models: DataModel[],
  parsedConfigs: Map<string, ReturnType<typeof parseConfig>>,
  allRequests: Map<string, ApiRequest>,
  collectionById: Map<string, Collection>,
  modelById: Map<string, DataModel>,
): dagre.graphlib.Graph {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: 'TB', nodesep: DAGRE_NODESEP, ranksep: DAGRE_RANKSEP });
  g.setDefaultEdgeLabel(() => ({}));

  const collectionIds = new Set(collections.map((c) => c.id));
  const modelIds = new Set(models.map((m) => m.id));

  // -- Add collection nodes --
  for (const col of collections) {
    g.setNode(`col:${col.id}`, { width: COL_NODE_W, height: COL_NODE_H });
  }

  // -- Add request nodes --
  for (const col of collections) {
    const reqs = requestsByCollection.get(col.id) ?? [];
    for (const req of reqs) {
      g.setNode(`req:${req.id}`, { width: REQ_NODE_W, height: REQ_NODE_H });
    }
  }
  for (const req of rootRequests) {
    g.setNode(`req:${req.id}`, { width: REQ_NODE_W, height: REQ_NODE_H });
  }

  // -- Add model nodes --
  for (const model of models) {
    g.setNode(`model:${model.id}`, { width: MODEL_NODE_W, height: MODEL_NODE_H });
  }

  // -- Edge type 1: col → sub-col (with cycle detection) --
  for (const col of collections) {
    if (col.parent_id !== null && collectionIds.has(col.parent_id)) {
      if (!hasCollectionAncestorCycle(col.parent_id, collectionById)) {
        g.setEdge(`col:${col.parent_id}`, `col:${col.id}`, {}, 'col-subcol');
      }
    }
  }

  // -- Edge type 2: col → request --
  for (const col of collections) {
    const reqs = requestsByCollection.get(col.id) ?? [];
    for (const req of reqs) {
      g.setEdge(`col:${col.id}`, `req:${req.id}`, {}, 'col-request');
    }
  }

  // -- Edge types 3 & 4: req → reqModel, req → resModel --
  for (const [reqId, req] of allRequests) {
    const cfg = parsedConfigs.get(reqId) ?? parseConfig(req.config);

    if (cfg.requestModelId && modelIds.has(cfg.requestModelId)) {
      g.setEdge(`req:${reqId}`, `model:${cfg.requestModelId}`, {}, 'req-reqModel');
    }

    if (cfg.responseModelId && modelIds.has(cfg.responseModelId)) {
      g.setEdge(`req:${reqId}`, `model:${cfg.responseModelId}`, {}, 'req-resModel');
    }
  }

  // -- Edge type 5: model → inherits (with cycle detection) --
  for (const model of models) {
    if (model.parent_model_id !== null && modelIds.has(model.parent_model_id)) {
      if (!hasModelInheritanceCycle(model.parent_model_id, modelById)) {
        g.setEdge(
          `model:${model.parent_model_id}`,
          `model:${model.id}`,
          {},
          'model-inherits',
        );
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
 * top-left corner. This converts center -> top-left and applies an offset.
 */
function dagreNodeToPosition(
  g: dagre.graphlib.Graph,
  nodeId: string,
  xOffset: number,
  yOffset: number,
): { x: number; y: number } | null {
  const n = g.node(nodeId) as
    | { x: number; y: number; width: number; height: number }
    | undefined;
  if (!n) return null;
  return {
    x: n.x - n.width / 2 + xOffset,
    y: n.y - n.height / 2 + yOffset,
  };
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

/**
 * Pure layout engine: transforms store data into React Flow nodes and edges
 * using a single unified dagre graph for all node types.
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
  // 1. Build lookup maps (shared by graph builder and edge assembly)
  // -------------------------------------------------------------------------
  const allRequests = collectAllRequests(collections, requestsByCollection, rootRequests);
  const collectionById = new Map(collections.map((c) => [c.id, c]));
  const modelById = new Map(models.map((m) => [m.id, m]));

  // -------------------------------------------------------------------------
  // 2. Build and run unified dagre layout (single graph, single layout call)
  // -------------------------------------------------------------------------
  const graph = buildUnifiedGraph(
    collections,
    requestsByCollection,
    rootRequests,
    models,
    parsedConfigs,
    allRequests,
    collectionById,
    modelById,
  );

  const hasNodes = graph.nodes().length > 0;

  if (hasNodes) {
    dagre.layout(graph);
  }

  // -------------------------------------------------------------------------
  // 3. Single offset calculation — normalize bounding box to origin
  // -------------------------------------------------------------------------
  const bounds = hasNodes
    ? computeGraphBounds(graph)
    : { minX: 0, maxX: 0, minY: 0, maxY: 0 };

  const xOffset = hasNodes ? -bounds.minX : 0;
  const yOffset = hasNodes ? -bounds.minY : 0;

  // -------------------------------------------------------------------------
  // 4. Assemble React Flow nodes
  // -------------------------------------------------------------------------
  const nodes: Node[] = [];

  // Collection nodes
  for (const col of collections) {
    const pos = dagreNodeToPosition(graph, `col:${col.id}`, xOffset, yOffset);
    if (!pos) continue;
    nodes.push(buildCollectionNode(col, pos.x, pos.y, requestsByCollection));
  }

  // Request nodes from collections
  for (const col of collections) {
    const requests = requestsByCollection.get(col.id) ?? [];
    for (const req of requests) {
      const pos = dagreNodeToPosition(graph, `req:${req.id}`, xOffset, yOffset);
      if (!pos) continue;
      nodes.push(buildRequestNode(req, pos.x, pos.y, parsedConfigs));
    }
  }

  // Root request nodes
  for (const req of rootRequests) {
    const pos = dagreNodeToPosition(graph, `req:${req.id}`, xOffset, yOffset);
    if (!pos) continue;
    nodes.push(buildRequestNode(req, pos.x, pos.y, parsedConfigs));
  }

  // Model nodes
  for (const model of models) {
    const pos = dagreNodeToPosition(graph, `model:${model.id}`, xOffset, yOffset);
    if (!pos) continue;
    nodes.push(buildModelNode(model, pos.x, pos.y));
  }

  // -------------------------------------------------------------------------
  // 5. Assemble React Flow edges (deduplicated)
  // -------------------------------------------------------------------------
  const edges: Edge[] = [];
  const seenEdges = new Set<string>();
  const collectionIds = new Set(collections.map((c) => c.id));
  const modelIds = new Set(models.map((m) => m.id));

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
      if (!hasCollectionAncestorCycle(col.parent_id, collectionById)) {
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
      if (!hasModelInheritanceCycle(model.parent_model_id, modelById)) {
        addEdge(
          `model:${model.parent_model_id}`,
          `model:${model.id}`,
          'model-inherits',
        );
      }
    }
  }

  // model → mixin edges (visual-only, NOT in dagre graph)
  for (const model of models) {
    const mixinIds = parseMixinModelIds(model.mixin_model_ids);
    for (const mixinId of mixinIds) {
      if (modelIds.has(mixinId)) {
        addEdge(`model:${model.id}`, `model:${mixinId}`, 'model-mixin');
      }
    }
  }

  // model → field reference edges (visual-only, NOT in dagre graph)
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
