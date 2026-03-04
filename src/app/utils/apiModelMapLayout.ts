import { MarkerType } from '@xyflow/react';
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
// Edge label mapping
// ---------------------------------------------------------------------------

const EDGE_LABELS: Record<EdgeStyleKey, string> = {
  'col-subcol': 'SUBCOL',
  'col-request': 'REQUEST',
  'req-reqModel': 'REQ_BODY',
  'req-resModel': 'RESPONSE',
  'model-inherits': 'INHERITS',
  'model-mixin': 'MIXIN',
  'model-fieldRef': '',
};

// ---------------------------------------------------------------------------
// Geometry constants
// ---------------------------------------------------------------------------

export const NODE_RADIUS = 35;
export const NODE_DIAMETER = NODE_RADIUS * 2;

// ---------------------------------------------------------------------------
// Force simulation types
// ---------------------------------------------------------------------------

export interface ForceSimulationNode {
  id: string;
  x: number;
  y: number;
  fx?: number | null;
  fy?: number | null;
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
// Circular initial position helper
// ---------------------------------------------------------------------------

/**
 * Compute an initial position on a circle for a given node index.
 * Radius scales with node count so nodes have reasonable spacing.
 */
function circularPosition(index: number, total: number): { x: number; y: number } {
  if (total === 0) return { x: 0, y: 0 };
  const R = Math.max(200, total * 15);
  const angle = (2 * Math.PI * index) / total;
  return {
    x: Math.cos(angle) * R,
    y: Math.sin(angle) * R,
  };
}

// ---------------------------------------------------------------------------
// React Flow node builders
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
  };
}

// ---------------------------------------------------------------------------
// Force link extraction helper
// ---------------------------------------------------------------------------

/**
 * Extract a simple { source, target } array from React Flow edges,
 * suitable for use with d3-force link forces.
 */
export function extractForceLinks(edges: Edge[]): Array<{ source: string; target: string }> {
  return edges.map((e) => ({ source: e.source, target: e.target }));
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

/**
 * Pure layout engine: transforms store data into React Flow nodes and edges
 * with circular initial positions for force-directed simulation.
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
  // 1. Build lookup maps (shared by node builder and edge assembly)
  // -------------------------------------------------------------------------
  const allRequests = collectAllRequests(collections, requestsByCollection, rootRequests);
  const collectionById = new Map(collections.map((c) => [c.id, c]));
  const modelById = new Map(models.map((m) => [m.id, m]));

  // -------------------------------------------------------------------------
  // 2. Count total nodes for circular layout radius calculation
  // -------------------------------------------------------------------------
  let totalRequestCount = 0;
  for (const col of collections) {
    totalRequestCount += (requestsByCollection.get(col.id) ?? []).length;
  }
  const totalNodeCount =
    collections.length + totalRequestCount + rootRequests.length + models.length;

  // -------------------------------------------------------------------------
  // 3. Assemble React Flow nodes with circular initial positions
  // -------------------------------------------------------------------------
  const nodes: Node[] = [];
  let nodeIndex = 0;

  // Collection nodes
  for (const col of collections) {
    const pos = circularPosition(nodeIndex, totalNodeCount);
    nodes.push(buildCollectionNode(col, pos.x, pos.y, requestsByCollection));
    nodeIndex += 1;
  }

  // Request nodes from collections
  for (const col of collections) {
    const requests = requestsByCollection.get(col.id) ?? [];
    for (const req of requests) {
      const pos = circularPosition(nodeIndex, totalNodeCount);
      nodes.push(buildRequestNode(req, pos.x, pos.y, parsedConfigs));
      nodeIndex += 1;
    }
  }

  // Root request nodes
  for (const req of rootRequests) {
    const pos = circularPosition(nodeIndex, totalNodeCount);
    nodes.push(buildRequestNode(req, pos.x, pos.y, parsedConfigs));
    nodeIndex += 1;
  }

  // Model nodes
  for (const model of models) {
    const pos = circularPosition(nodeIndex, totalNodeCount);
    nodes.push(buildModelNode(model, pos.x, pos.y));
    nodeIndex += 1;
  }

  // -------------------------------------------------------------------------
  // 4. Assemble React Flow edges (deduplicated, with labels and arrowheads)
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
      type: 'labeledEdge',
      label: label || EDGE_LABELS[edgeType] || undefined,
      style,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: style.stroke,
        width: 15,
        height: 15,
      },
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
