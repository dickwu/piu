import Graph from 'graphology';
import { findShortestPath, searchNodes } from './graphAlgorithms';

// ---------------------------------------------------------------------------
// Query result types
// ---------------------------------------------------------------------------

export type QueryResultType = 'path' | 'nodes' | 'community' | 'text' | 'search';

export interface QueryResult {
  type: QueryResultType;
  title: string;
  description: string;
  /** Node IDs to highlight on the graph */
  highlightNodes: string[];
  /** If type is 'path', the ordered path */
  path?: string[];
  /** If type is 'community', the community ID */
  communityId?: number;
}

// ---------------------------------------------------------------------------
// Query patterns (regex-based classification)
// ---------------------------------------------------------------------------

interface QueryPattern {
  regex: RegExp;
  handler: (graph: Graph, match: RegExpMatchArray) => QueryResult | null;
}

// ---------------------------------------------------------------------------
// Pattern handlers
// ---------------------------------------------------------------------------

function findNodeByFuzzyName(graph: Graph, name: string): string | null {
  const lower = name.toLowerCase().trim();
  let bestMatch: string | null = null;
  let bestScore = Infinity;

  graph.forEachNode((nodeId, attrs) => {
    const label = (attrs.label as string ?? '').toLowerCase();
    const idx = label.indexOf(lower);
    if (idx !== -1 && idx < bestScore) {
      bestScore = idx;
      bestMatch = nodeId;
    }
  });

  return bestMatch;
}

const PATTERNS: QueryPattern[] = [
  // "path from X to Y" / "route from X to Y" / "connect X to Y"
  {
    regex: /(?:path|route|connect(?:ion)?)\s+(?:from\s+)?(.+?)\s+to\s+(.+)/i,
    handler: (graph, match) => {
      const sourceNode = findNodeByFuzzyName(graph, match[1]);
      const targetNode = findNodeByFuzzyName(graph, match[2]);
      if (!sourceNode || !targetNode) {
        return {
          type: 'text',
          title: 'Path not found',
          description: `Could not find nodes matching "${match[1]}" and/or "${match[2]}"`,
          highlightNodes: [],
        };
      }
      const path = findShortestPath(graph, sourceNode, targetNode);
      if (!path) {
        return {
          type: 'text',
          title: 'No path exists',
          description: `No connection between "${match[1]}" and "${match[2]}"`,
          highlightNodes: [sourceNode, targetNode],
        };
      }
      const labels = path.map(id => graph.getNodeAttribute(id, 'label') as string);
      return {
        type: 'path',
        title: `Path: ${labels[0]} → ${labels[labels.length - 1]}`,
        description: `${path.length} nodes, ${path.length - 1} hops: ${labels.join(' → ')}`,
        highlightNodes: path,
        path,
      };
    },
  },

  // "most connected" / "most important" / "top nodes"
  {
    regex: /(?:most\s+(?:connected|important)|top\s+nodes?|highest\s+centrality)/i,
    handler: (graph) => {
      const nodes: Array<{ id: string; label: string; degree: number }> = [];
      graph.forEachNode((id, attrs) => {
        nodes.push({ id, label: attrs.label as string, degree: graph.degree(id) });
      });
      nodes.sort((a, b) => b.degree - a.degree);
      const top5 = nodes.slice(0, 5);
      return {
        type: 'nodes',
        title: 'Most connected nodes',
        description: top5.map((n, i) => `${i + 1}. ${n.label} (${n.degree} connections)`).join('\n'),
        highlightNodes: top5.map(n => n.id),
      };
    },
  },

  // "endpoints using model X" / "requests with model X" / "who uses X"
  {
    regex: /(?:endpoints?|requests?|who)\s+(?:using|with|uses?)\s+(?:model\s+)?(.+)/i,
    handler: (graph, match) => {
      const modelNode = findNodeByFuzzyName(graph, match[1]);
      if (!modelNode) {
        return { type: 'text', title: 'Not found', description: `No model matching "${match[1]}"`, highlightNodes: [] };
      }
      // Find all nodes connected to this model
      const neighbors: string[] = [];
      graph.forEachNeighbor(modelNode, (neighbor, attrs) => {
        if (attrs.entity_type === 'request') neighbors.push(neighbor);
      });
      const labels = neighbors.map(id => graph.getNodeAttribute(id, 'label') as string);
      return {
        type: 'nodes',
        title: `Endpoints using ${graph.getNodeAttribute(modelNode, 'label')}`,
        description: labels.length > 0 ? labels.join(', ') : 'No request endpoints found',
        highlightNodes: [modelNode, ...neighbors],
      };
    },
  },

  // "show cluster N" / "community N" / "group N"
  {
    regex: /(?:show\s+)?(?:cluster|community|group)\s+(\d+)/i,
    handler: (graph, match) => {
      const communityId = parseInt(match[1], 10);
      const nodes: string[] = [];
      graph.forEachNode((id, attrs) => {
        if ((attrs.community_rank as number) === communityId) nodes.push(id);
      });
      if (nodes.length === 0) {
        return { type: 'text', title: 'Not found', description: `No community with rank ${communityId}`, highlightNodes: [] };
      }
      return {
        type: 'community',
        title: `Community ${communityId} (${nodes.length} nodes)`,
        description: `Isolated view of cluster ${communityId}`,
        highlightNodes: nodes,
        communityId,
      };
    },
  },

  // "collections" / "all models" / "all requests"
  {
    regex: /^(?:all\s+)?(collections?|models?|requests?|endpoints?)$/i,
    handler: (graph, match) => {
      const raw = match[1].toLowerCase().replace(/s$/, '');
      const entityType = raw === 'endpoint' ? 'request' : raw;
      const nodes: string[] = [];
      graph.forEachNode((id, attrs) => {
        if (attrs.entity_type === entityType) nodes.push(id);
      });
      return {
        type: 'nodes',
        title: `All ${entityType}s (${nodes.length})`,
        description: nodes.map(id => graph.getNodeAttribute(id, 'label') as string).slice(0, 10).join(', ') + (nodes.length > 10 ? '...' : ''),
        highlightNodes: nodes,
      };
    },
  },

  // "GET endpoints" / "POST requests" / "DELETE"
  {
    regex: /^(GET|POST|PUT|DELETE|PATCH)\s*(?:endpoints?|requests?)?$/i,
    handler: (graph, match) => {
      const method = match[1].toUpperCase();
      const nodes: string[] = [];
      graph.forEachNode((id, attrs) => {
        if (attrs.entity_type !== 'request') return;
        const props = (attrs.properties ?? {}) as Record<string, unknown>;
        if (((props.method as string) ?? 'GET').toUpperCase() === method) nodes.push(id);
      });
      return {
        type: 'nodes',
        title: `${method} endpoints (${nodes.length})`,
        description: nodes.map(id => graph.getNodeAttribute(id, 'label') as string).slice(0, 10).join(', ') + (nodes.length > 10 ? '...' : ''),
        highlightNodes: nodes,
      };
    },
  },
];

// ---------------------------------------------------------------------------
// Main query function
// ---------------------------------------------------------------------------

/**
 * Process a natural-language query against the graph.
 * Returns a structured QueryResult, or null if the query doesn't match any pattern
 * (in which case, fall back to fuzzy search).
 */
export function executeGraphQuery(graph: Graph, query: string): QueryResult | null {
  const trimmed = query.trim();
  if (!trimmed) return null;

  for (const pattern of PATTERNS) {
    const match = trimmed.match(pattern.regex);
    if (match) {
      return pattern.handler(graph, match);
    }
  }

  // No pattern matched — return null to signal fallback to fuzzy search
  return null;
}
