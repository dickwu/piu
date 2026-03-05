import type { Collection, ApiRequest, DataModel } from '../types';
import { parseConfig, parseModelFields, parseMixinModelIds } from '../types';

// ---------------------------------------------------------------------------
// Node data shapes (used by MapDetailPanel, graphDataTransform)
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
  'col-subcol': { stroke: '#8b8b99', strokeWidth: 1.2 },
  'col-request': { stroke: '#7a7a8e', strokeWidth: 0.8, strokeDasharray: '4 3' },
  'req-reqModel': { stroke: '#fbbf24', strokeWidth: 1.5 },
  'req-resModel': { stroke: '#34d399', strokeWidth: 1.5 },
  'model-inherits': { stroke: '#4a9eff', strokeWidth: 1.5 },
  'model-mixin': { stroke: '#9b59b6', strokeWidth: 1, strokeDasharray: '6 3' },
  'model-fieldRef': { stroke: '#2ecc71', strokeWidth: 0.8 },
} as const;

export type EdgeStyleKey = keyof typeof EDGE_STYLES;

// ---------------------------------------------------------------------------
// Geometry constants
// ---------------------------------------------------------------------------

/** Node size in Sigma graph units (not pixels). Sigma scales this via camera. */
export const NODE_RADIUS = 12;
export const NODE_DIAMETER = NODE_RADIUS * 2;
