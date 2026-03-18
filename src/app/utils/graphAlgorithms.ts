import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';
import { bidirectional } from 'graphology-shortest-path/unweighted';

// ---------------------------------------------------------------------------
// Community palette (12 distinct hues for dark background)
// ---------------------------------------------------------------------------

const COMMUNITY_PALETTE = [
  '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
  '#14b8a6', '#e11d48',
];

// ---------------------------------------------------------------------------
// Louvain community detection
// ---------------------------------------------------------------------------

export interface CommunityInfo {
  id: number;
  size: number;
  color: string;
}

/**
 * Run Louvain on the graph and assign `community` attribute to each node.
 * Returns community info sorted by size (largest first) for stable palette assignment.
 */
export function assignCommunities(graph: Graph): CommunityInfo[] {
  // Run Louvain — assigns raw community IDs to node attribute 'community'
  louvain.assign(graph);

  // Count sizes per community
  const sizeMap = new Map<number, number>();
  graph.forEachNode((_node, attrs) => {
    const c = attrs.community as number;
    sizeMap.set(c, (sizeMap.get(c) ?? 0) + 1);
  });

  // Sort by size descending for stable palette assignment
  const sorted = [...sizeMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, size], rank) => ({
      id,
      size,
      color: COMMUNITY_PALETTE[rank % COMMUNITY_PALETTE.length],
    }));

  // Build stable rank map: raw community ID → palette index
  const rankMap = new Map<number, number>();
  sorted.forEach((c, rank) => rankMap.set(c.id, rank));

  // Assign community_color to each node
  graph.forEachNode((node, attrs) => {
    const rawId = attrs.community as number;
    const rank = rankMap.get(rawId) ?? 0;
    graph.setNodeAttribute(node, 'community_rank', rank);
    graph.setNodeAttribute(node, 'community_color', COMMUNITY_PALETTE[rank % COMMUNITY_PALETTE.length]);
  });

  return sorted;
}

// ---------------------------------------------------------------------------
// Degree centrality (O(E) — fast approximation of betweenness)
// ---------------------------------------------------------------------------

/**
 * Compute degree centrality and assign as node attribute.
 * Normalizes to [0, 1] range. Updates node `size` based on centrality.
 */
export function assignDegreeCentrality(graph: Graph): void {
  const maxDegree = Math.max(1, ...graph.mapNodes((_n) => graph.degree(_n)));

  graph.forEachNode((node) => {
    const deg = graph.degree(node);
    const centrality = deg / maxDegree;
    graph.setNodeAttribute(node, 'centrality', centrality);

    // Scale node size: base size + centrality bonus
    const baseSize = graph.getNodeAttribute(node, 'size') as number ?? 3;
    const scaledSize = baseSize + centrality * 4;
    graph.setNodeAttribute(node, 'size', scaledSize);
  });
}

// ---------------------------------------------------------------------------
// Fuzzy search
// ---------------------------------------------------------------------------

export interface SearchResult {
  nodeId: string;
  label: string;
  entityType: string;
  score: number; // lower = better match
}

/**
 * Fuzzy search over node labels and properties.
 * Returns results sorted by relevance, grouped by entity type.
 */
export function searchNodes(graph: Graph, query: string): SearchResult[] {
  if (!query.trim()) return [];

  const lower = query.toLowerCase();
  const results: SearchResult[] = [];

  graph.forEachNode((nodeId, attrs) => {
    const label = (attrs.label as string) ?? '';
    const props = (attrs.properties ?? {}) as Record<string, unknown>;
    const url = (props.url as string) ?? '';
    const method = (props.method as string) ?? '';

    // Check label match
    const labelIdx = label.toLowerCase().indexOf(lower);
    if (labelIdx !== -1) {
      results.push({
        nodeId,
        label,
        entityType: attrs.entity_type as string,
        score: labelIdx, // earlier match = better
      });
      return;
    }

    // Check URL match
    if (url && url.toLowerCase().includes(lower)) {
      results.push({ nodeId, label, entityType: attrs.entity_type as string, score: 100 });
      return;
    }

    // Check method match
    if (method && method.toLowerCase().includes(lower)) {
      results.push({ nodeId, label, entityType: attrs.entity_type as string, score: 200 });
    }
  });

  return results.sort((a, b) => a.score - b.score);
}

// ---------------------------------------------------------------------------
// Filtering — compute visible set
// ---------------------------------------------------------------------------

export interface FilterState {
  showCollections: boolean;
  showRequests: boolean;
  showModels: boolean;
  methods: string[]; // empty = show all
  edgeTypes: string[]; // empty = show all
  communityId: number | null; // null = show all
}

export const DEFAULT_FILTERS: FilterState = {
  showCollections: true,
  showRequests: true,
  showModels: true,
  methods: [],
  edgeTypes: [],
  communityId: null,
};

/**
 * Compute the set of visible node IDs based on current filters.
 * Nodes not in the set should be hidden (scale=0 in InstancedMesh).
 */
export function computeVisibleSet(graph: Graph, filters: FilterState): Set<string> {
  const visible = new Set<string>();

  graph.forEachNode((nodeId, attrs) => {
    const entityType = attrs.entity_type as string;

    // Entity type filter
    if (entityType === 'collection' && !filters.showCollections) return;
    if (entityType === 'request' && !filters.showRequests) return;
    if (entityType === 'model' && !filters.showModels) return;

    // HTTP method filter (only applies to requests)
    if (entityType === 'request' && filters.methods.length > 0) {
      const props = (attrs.properties ?? {}) as Record<string, unknown>;
      const method = ((props.method as string) ?? 'GET').toUpperCase();
      if (!filters.methods.includes(method)) return;
    }

    // Community filter
    if (filters.communityId !== null) {
      if ((attrs.community as number) !== filters.communityId) return;
    }

    visible.add(nodeId);
  });

  return visible;
}

/**
 * Compute visible edges based on visible nodes and edge type filter.
 */
export function computeVisibleEdges(
  graph: Graph,
  visibleNodes: Set<string>,
  edgeTypeFilter: string[],
): Set<string> {
  const visible = new Set<string>();

  graph.forEachEdge((edgeId, attrs, source, target) => {
    // Both endpoints must be visible
    if (!visibleNodes.has(source) || !visibleNodes.has(target)) return;

    // Edge type filter
    if (edgeTypeFilter.length > 0) {
      const edgeType = attrs.edge_type as string;
      if (!edgeTypeFilter.includes(edgeType)) return;
    }

    visible.add(edgeId);
  });

  return visible;
}

// ---------------------------------------------------------------------------
// Shortest path
// ---------------------------------------------------------------------------

/**
 * Find shortest path between two nodes. Returns node IDs in path order,
 * or null if no path exists.
 */
export function findShortestPath(graph: Graph, source: string, target: string): string[] | null {
  try {
    const path = bidirectional(graph, source, target);
    return path;
  } catch {
    return null;
  }
}
