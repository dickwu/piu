import type { Collection, ApiRequest, DataModel } from '../types';
import { parseConfig, parseModelFields, parseMixinModelIds } from '../types';

// ---------------------------------------------------------------------------
// Node data shapes (used by MapDetailPanel, apiModelMapGraph)
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
// Geometry constants
// ---------------------------------------------------------------------------

export const NODE_RADIUS = 35;
export const NODE_DIAMETER = NODE_RADIUS * 2;
