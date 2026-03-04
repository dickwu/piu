import MultiDirectedGraph from 'graphology';
import type { Collection, ApiRequest, DataModel } from '../types';
import { parseConfig, parseModelFields, parseMixinModelIds } from '../types';

// ---------------------------------------------------------------------------
// Re-export shared constants from layout module
// ---------------------------------------------------------------------------

export {
  EDGE_STYLES,
  NODE_RADIUS,
  NODE_DIAMETER,
  type CollectionNodeData,
  type RequestNodeData,
  type ModelNodeData,
  type EdgeStyleKey,
} from './apiModelMapLayout';

import {
  EDGE_STYLES,
  NODE_RADIUS,
  type CollectionNodeData,
  type RequestNodeData,
  type ModelNodeData,
  type EdgeStyleKey,
} from './apiModelMapLayout';

// ---------------------------------------------------------------------------
// Sigma node/edge attribute types
// ---------------------------------------------------------------------------

export type NodeCategory = 'collection' | 'request' | 'model';

export interface SigmaNodeAttributes {
  x: number;
  y: number;
  size: number;
  color: string;
  borderColor: string;
  label: string;
  type: string;
  nodeCategory: NodeCategory;
  subtitle: string;
  methodColor?: string;
  nodeData: CollectionNodeData | RequestNodeData | ModelNodeData;
}

export interface SigmaEdgeAttributes {
  size: number;
  color: string;
  label: string;
  type: string;
  edgeCategory: EdgeStyleKey;
}

// ---------------------------------------------------------------------------
// Node color constants
// ---------------------------------------------------------------------------

const NODE_COLORS: Record<NodeCategory, { fill: string; border: string }> = {
  collection: { fill: 'rgba(251, 191, 36, 0.15)', border: '#fbbf24' },
  request: { fill: 'rgba(52, 211, 153, 0.15)', border: '#34d399' },
  model: { fill: 'rgba(74, 158, 255, 0.15)', border: '#4a9eff' },
};

const METHOD_COLORS: Record<string, string> = {
  GET: '#34d399',
  POST: '#fbbf24',
  PUT: '#4a9eff',
  DELETE: '#ff4d4f',
  PATCH: '#9b59b6',
};

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
// Helpers (extracted from apiModelMapLayout.ts to avoid duplication)
// ---------------------------------------------------------------------------

function circularPosition(index: number, total: number): { x: number; y: number } {
  if (total === 0) return { x: 0, y: 0 };
  const R = Math.max(200, total * 15);
  const angle = (2 * Math.PI * index) / total;
  return {
    x: Math.cos(angle) * R,
    y: Math.sin(angle) * R,
  };
}

function makeEdgeKey(source: string, target: string, type: EdgeStyleKey): string {
  return `${source}|${target}|${type}`;
}

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
// Main builder: produces a graphology MultiDirectedGraph
// ---------------------------------------------------------------------------

export function buildGraphologyData(
  collections: Collection[],
  requestsByCollection: Map<string, ApiRequest[]>,
  rootRequests: ApiRequest[],
  models: DataModel[],
): MultiDirectedGraph<SigmaNodeAttributes, SigmaEdgeAttributes> {
  const graph = new MultiDirectedGraph<SigmaNodeAttributes, SigmaEdgeAttributes>();

  // Pre-parse request configs
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

  // Lookup maps
  const allRequests = collectAllRequests(collections, requestsByCollection, rootRequests);
  const collectionById = new Map(collections.map((c) => [c.id, c]));
  const modelById = new Map(models.map((m) => [m.id, m]));

  // Count total nodes for circular radius
  let totalRequestCount = 0;
  for (const col of collections) {
    totalRequestCount += (requestsByCollection.get(col.id) ?? []).length;
  }
  const totalNodeCount =
    collections.length + totalRequestCount + rootRequests.length + models.length;

  const nodeSize = NODE_RADIUS;
  let nodeIndex = 0;

  // --- Collection nodes ---
  for (const col of collections) {
    const pos = circularPosition(nodeIndex, totalNodeCount);
    const requests = requestsByCollection.get(col.id) ?? [];
    const nodeData: CollectionNodeData = {
      name: col.name,
      pathPrefix: col.path_prefix,
      requestCount: requests.length,
    };
    graph.addNode(`col:${col.id}`, {
      x: pos.x,
      y: pos.y,
      size: nodeSize,
      color: NODE_COLORS.collection.fill,
      borderColor: NODE_COLORS.collection.border,
      label: col.name,
      type: 'border',
      nodeCategory: 'collection',
      subtitle: `${requests.length} req`,
      nodeData,
    });
    nodeIndex += 1;
  }

  // --- Request nodes (from collections) ---
  for (const col of collections) {
    const requests = requestsByCollection.get(col.id) ?? [];
    for (const req of requests) {
      const pos = circularPosition(nodeIndex, totalNodeCount);
      const cfg = parsedConfigs.get(req.id) ?? parseConfig(req.config);
      const method = cfg.method.toUpperCase();
      const methodColor = METHOD_COLORS[method] ?? '#34d399';
      const nodeData: RequestNodeData = {
        name: req.name,
        method: cfg.method,
        url: cfg.url,
      };
      graph.addNode(`req:${req.id}`, {
        x: pos.x,
        y: pos.y,
        size: nodeSize,
        color: NODE_COLORS.request.fill,
        borderColor: methodColor,
        label: req.name,
        type: 'border',
        nodeCategory: 'request',
        subtitle: method,
        methodColor,
        nodeData,
      });
      nodeIndex += 1;
    }
  }

  // --- Root request nodes ---
  for (const req of rootRequests) {
    const pos = circularPosition(nodeIndex, totalNodeCount);
    const cfg = parsedConfigs.get(req.id) ?? parseConfig(req.config);
    const method = cfg.method.toUpperCase();
    const methodColor = METHOD_COLORS[method] ?? '#34d399';
    const nodeData: RequestNodeData = {
      name: req.name,
      method: cfg.method,
      url: cfg.url,
    };
    graph.addNode(`req:${req.id}`, {
      x: pos.x,
      y: pos.y,
      size: nodeSize,
      color: NODE_COLORS.request.fill,
      borderColor: methodColor,
      label: req.name,
      type: 'border',
      nodeCategory: 'request',
      subtitle: method,
      methodColor,
      nodeData,
    });
    nodeIndex += 1;
  }

  // --- Model nodes ---
  for (const model of models) {
    const pos = circularPosition(nodeIndex, totalNodeCount);
    const fields = parseModelFields(model.fields);
    const fieldPreview = fields.map((f) => ({
      name: f.name,
      type: f.field_type,
      required: f.required,
    }));
    const nodeData: ModelNodeData = {
      name: model.name,
      fieldCount: fields.length,
      fieldPreview,
    };
    graph.addNode(`model:${model.id}`, {
      x: pos.x,
      y: pos.y,
      size: nodeSize,
      color: NODE_COLORS.model.fill,
      borderColor: NODE_COLORS.model.border,
      label: model.name,
      type: 'border',
      nodeCategory: 'model',
      subtitle: `${fields.length} fields`,
      nodeData,
    });
    nodeIndex += 1;
  }

  // -------------------------------------------------------------------------
  // Edges (deduplicated, labeled, with arrow type)
  // -------------------------------------------------------------------------

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

    if (!graph.hasNode(source) || !graph.hasNode(target)) return;

    const style = EDGE_STYLES[edgeType];
    graph.addEdgeWithKey(key, source, target, {
      size: style.strokeWidth,
      color: style.stroke,
      label: label || EDGE_LABELS[edgeType] || '',
      type: 'curvedArrow',
      edgeCategory: edgeType,
    });
  }

  // col → sub-col
  for (const col of collections) {
    if (col.parent_id !== null && collectionIds.has(col.parent_id)) {
      if (!hasCollectionAncestorCycle(col.parent_id, collectionById)) {
        addEdge(`col:${col.parent_id}`, `col:${col.id}`, 'col-subcol');
      }
    }
  }

  // col → request
  for (const col of collections) {
    const requests = requestsByCollection.get(col.id) ?? [];
    for (const req of requests) {
      addEdge(`col:${col.id}`, `req:${req.id}`, 'col-request');
    }
  }

  // request → model (req body + response model)
  for (const [reqId, req] of allRequests) {
    const cfg = parsedConfigs.get(reqId) ?? parseConfig(req.config);
    if (cfg.requestModelId && modelIds.has(cfg.requestModelId)) {
      addEdge(`req:${reqId}`, `model:${cfg.requestModelId}`, 'req-reqModel');
    }
    if (cfg.responseModelId && modelIds.has(cfg.responseModelId)) {
      addEdge(`req:${reqId}`, `model:${cfg.responseModelId}`, 'req-resModel');
    }
  }

  // model → model inheritance
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

  // model → mixin
  for (const model of models) {
    const mixinIds = parseMixinModelIds(model.mixin_model_ids);
    for (const mixinId of mixinIds) {
      if (modelIds.has(mixinId)) {
        addEdge(`model:${model.id}`, `model:${mixinId}`, 'model-mixin');
      }
    }
  }

  // model → field reference
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

  return graph;
}
