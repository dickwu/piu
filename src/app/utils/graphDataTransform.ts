import Graph from 'graphology';
import {
  EDGE_STYLES,
  type CollectionNodeData,
  type RequestNodeData,
  type ModelNodeData,
  type EdgeStyleKey,
} from './apiModelMapLayout';

// ---------------------------------------------------------------------------
// Types matching Rust GraphNode/GraphEdge structs (unchanged from before)
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
// Build a graphology Graph from Rust JSON
// ---------------------------------------------------------------------------

export function buildGraphologyInstance(data: RustProjectGraphData): Graph {
  const graph = new Graph({ multi: false, type: 'directed', allowSelfLoops: false });

  for (const node of data.nodes) {
    let properties: Record<string, unknown> = {};
    try {
      properties = JSON.parse(node.properties);
    } catch {
      // fallback to empty
    }

    graph.addNode(node.id, {
      entity_type: node.entity_type,
      entity_id: node.entity_id,
      label: node.label,
      properties,
      size: node.size,
      color: node.color,
      x: node.fx ?? undefined,
      y: node.fy ?? undefined,
      z: 0,
    });
  }

  for (const edge of data.edges) {
    if (!graph.hasNode(edge.source_id) || !graph.hasNode(edge.target_id)) continue;

    const style = EDGE_STYLES[edge.edge_type as EdgeStyleKey] ?? {
      stroke: '#555',
      strokeWidth: 1,
    };

    graph.addEdge(edge.source_id, edge.target_id, {
      edge_type: edge.edge_type,
      label: edge.label,
      color: style.stroke,
      width: style.strokeWidth,
    });
  }

  return graph;
}

// ---------------------------------------------------------------------------
// Check if any node has cached positions
// ---------------------------------------------------------------------------

export function hasCachedPositions(graph: Graph): boolean {
  let found = false;
  graph.someNode((_node, attrs) => {
    if (typeof attrs.x === 'number' && typeof attrs.y === 'number') {
      found = true;
      return true;
    }
    return false;
  });
  return found;
}

// ---------------------------------------------------------------------------
// Extract positions for SQLite save
// ---------------------------------------------------------------------------

export interface PositionForSave {
  id: string;
  fx: number;
  fy: number;
  fz: number;
}

export function extractPositionsForSave(graph: Graph): PositionForSave[] {
  const positions: PositionForSave[] = [];
  graph.forEachNode((node, attrs) => {
    if (typeof attrs.x === 'number' && typeof attrs.y === 'number') {
      positions.push({
        id: node,
        fx: attrs.x,
        fy: attrs.y,
        fz: typeof attrs.z === 'number' ? attrs.z : 0,
      });
    }
  });
  return positions;
}

// ---------------------------------------------------------------------------
// Extract node data for MapDetailPanel
// ---------------------------------------------------------------------------

export function extractNodeData(
  graph: Graph,
  nodeId: string,
): CollectionNodeData | RequestNodeData | ModelNodeData {
  const attrs = graph.getNodeAttributes(nodeId);
  const props = (attrs.properties ?? {}) as Record<string, unknown>;

  switch (attrs.entity_type) {
    case 'collection':
      return {
        name: (props.name as string) ?? attrs.label,
        pathPrefix: (props.pathPrefix as string | null) ?? null,
        requestCount: (props.requestCount as number) ?? 0,
      };

    case 'request':
      return {
        name: (props.name as string) ?? attrs.label,
        method: (props.method as string) ?? 'GET',
        url: (props.url as string) ?? '',
      };

    case 'model': {
      const fieldPreview = Array.isArray(props.fieldPreview)
        ? (props.fieldPreview as Array<{ name: string; type: string; required: boolean }>)
        : [];
      return {
        name: (props.name as string) ?? attrs.label,
        fieldCount: (props.fieldCount as number) ?? 0,
        fieldPreview,
      };
    }

    default:
      return {
        name: attrs.label ?? nodeId,
        method: 'GET',
        url: '',
      };
  }
}
