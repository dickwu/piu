import {
  EDGE_STYLES,
  type CollectionNodeData,
  type RequestNodeData,
  type ModelNodeData,
  type EdgeStyleKey,
} from './apiModelMapLayout';

// ---------------------------------------------------------------------------
// Types matching Rust GraphNode/GraphEdge structs
// ---------------------------------------------------------------------------

export interface RustGraphNode {
  id: string;
  project_id: string;
  entity_type: 'collection' | 'request' | 'model';
  entity_id: string;
  label: string;
  properties: string; // JSON blob
  size: number;
  color: string;
  fx: number | null;
  fy: number | null;
  fz: number | null;
  created_at: number;
}

export interface RustGraphEdge {
  id: string;
  project_id: string;
  source_id: string;
  target_id: string;
  edge_type: string;
  label: string;
  properties: string; // JSON blob
  created_at: number;
}

export interface RustProjectGraphData {
  nodes: RustGraphNode[];
  edges: RustGraphEdge[];
}

// ---------------------------------------------------------------------------
// react-force-graph-3d compatible types
// ---------------------------------------------------------------------------

export interface ForceGraphNode {
  id: string;
  entity_type: 'collection' | 'request' | 'model';
  entity_id: string;
  label: string;
  properties: Record<string, unknown>;
  size: number;
  color: string;
  fx?: number;
  fy?: number;
  fz?: number;
  // d3-force-3d adds these at runtime
  x?: number;
  y?: number;
  z?: number;
}

export interface ForceGraphLink {
  source: string;
  target: string;
  edge_type: string;
  label: string;
  color: string;
  width: number;
}

// ---------------------------------------------------------------------------
// Transform functions
// ---------------------------------------------------------------------------

/**
 * Transform Rust GraphNode[] into react-force-graph-3d compatible nodes.
 * If nodes have cached positions (fx/fy/fz), they are included so the
 * physics engine uses them as fixed positions.
 */
export function transformNodes(rustNodes: RustGraphNode[]): ForceGraphNode[] {
  return rustNodes.map((n) => {
    let properties: Record<string, unknown> = {};
    try {
      properties = JSON.parse(n.properties);
    } catch {
      // Fallback to empty properties
    }

    const node: ForceGraphNode = {
      id: n.id,
      entity_type: n.entity_type,
      entity_id: n.entity_id,
      label: n.label,
      properties,
      size: n.size,
      color: n.color,
    };

    // Include cached positions if available
    if (n.fx !== null) node.fx = n.fx;
    if (n.fy !== null) node.fy = n.fy;
    if (n.fz !== null) node.fz = n.fz;

    return node;
  });
}

/**
 * Transform Rust GraphEdge[] into react-force-graph-3d compatible links.
 * Maps source_id/target_id → source/target and applies EDGE_STYLES colors.
 */
export function transformEdgesToLinks(rustEdges: RustGraphEdge[]): ForceGraphLink[] {
  return rustEdges.map((edge) => {
    const style = EDGE_STYLES[edge.edge_type as EdgeStyleKey] ?? {
      stroke: '#555',
      strokeWidth: 1,
    };
    return {
      source: edge.source_id,
      target: edge.target_id,
      edge_type: edge.edge_type,
      label: edge.label,
      color: style.stroke,
      width: style.strokeWidth,
    };
  });
}

/**
 * Check if any node has cached positions (fx/fy/fz).
 * If so, we can skip the physics warm-up phase.
 */
export function hasCachedPositions(nodes: RustGraphNode[]): boolean {
  return nodes.some((n) => n.fx !== null && n.fy !== null && n.fz !== null);
}

/**
 * Extract node data for MapDetailPanel from a ForceGraphNode's properties.
 */
export function extractNodeData(
  node: ForceGraphNode,
): CollectionNodeData | RequestNodeData | ModelNodeData {
  const props = node.properties;

  switch (node.entity_type) {
    case 'collection':
      return {
        name: (props.name as string) ?? node.label,
        pathPrefix: (props.pathPrefix as string | null) ?? null,
        requestCount: (props.requestCount as number) ?? 0,
      };

    case 'request':
      return {
        name: (props.name as string) ?? node.label,
        method: (props.method as string) ?? 'GET',
        url: (props.url as string) ?? '',
      };

    case 'model': {
      const fieldPreview = Array.isArray(props.fieldPreview)
        ? (props.fieldPreview as Array<{ name: string; type: string; required: boolean }>)
        : [];
      return {
        name: (props.name as string) ?? node.label,
        fieldCount: (props.fieldCount as number) ?? 0,
        fieldPreview,
      };
    }
  }
}
