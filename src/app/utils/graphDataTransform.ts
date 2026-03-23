import Graph from 'graphology';
import {
  EDGE_STYLES,
  type CollectionNodeData,
  type RequestNodeData,
  type ModelNodeData,
  type EdgeStyleKey,
} from './apiModelMapLayout';

const NODE_SIZE_FLOOR = 2;

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

// Target half-extent: positions will be normalized to roughly [-TARGET, +TARGET]
// so the default camera (zoom 1.5, origin 0,0) can see the entire graph.
const POSITION_TARGET_EXTENT = 300;

export function buildGraphologyInstance(data: RustProjectGraphData): Graph {
  const graph = new Graph({ multi: false, type: 'directed', allowSelfLoops: false });

  // Compute bounding box of cached positions (if any) for normalization
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let posCount = 0;
  for (const node of data.nodes) {
    if (node.fx != null && node.fy != null) {
      if (node.fx < minX) minX = node.fx;
      if (node.fx > maxX) maxX = node.fx;
      if (node.fy < minY) minY = node.fy;
      if (node.fy > maxY) maxY = node.fy;
      posCount++;
    }
  }

  const needsNormalize = posCount > 0;
  const cx = needsNormalize ? (minX + maxX) / 2 : 0;
  const cy = needsNormalize ? (minY + maxY) / 2 : 0;
  const extent = Math.max(maxX - minX, maxY - minY, 1);
  const scale = extent > POSITION_TARGET_EXTENT * 2 ? (POSITION_TARGET_EXTENT * 2) / extent : 1;

  for (const node of data.nodes) {
    let properties: Record<string, unknown> = {};
    try {
      properties = JSON.parse(node.properties);
    } catch {
      // fallback to empty
    }

    // Center and scale positions so the graph fits the default camera view
    const rawX = node.fx ?? undefined;
    const rawY = node.fy ?? undefined;
    const x = rawX !== undefined && needsNormalize ? (rawX - cx) * scale : rawX;
    const y = rawY !== undefined && needsNormalize ? (rawY - cy) * scale : rawY;

    graph.addNode(node.id, {
      entity_type: node.entity_type,
      entity_id: node.entity_id,
      label: node.label,
      properties,
      size: Math.max(node.size, NODE_SIZE_FLOOR),
      color: node.color,
      x,
      y,
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

/**
 * Sigma requires x/y on every node. For fresh graphs (no cached positions),
 * seed random coordinates so FA2 has a starting point.
 */
export function seedRandomPositions(graph: Graph): void {
  const spread = Math.sqrt(graph.order) * 40
  graph.forEachNode((node, attrs) => {
    if (typeof attrs.x !== 'number' || typeof attrs.y !== 'number') {
      graph.setNodeAttribute(node, 'x', (Math.random() - 0.5) * spread)
      graph.setNodeAttribute(node, 'y', (Math.random() - 0.5) * spread)
    }
  })
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
        fz: 0,
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
