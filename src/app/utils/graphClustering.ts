import Graph from 'graphology';

// ---------------------------------------------------------------------------
// Color palette — 24 distinct hues for dark backgrounds
// ---------------------------------------------------------------------------

const CLUSTER_PALETTE: string[] = [
  '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
  '#14b8a6', '#e11d48', '#a78bfa', '#34d399', '#60a5fa',
  '#fb7185', '#fbbf24', '#4ade80', '#38bdf8', '#c084fc',
  '#fb923c', '#a3e635', '#22d3ee', '#f472b6',
];

const MIN_CLUSTER_SIZE_FOR_SPLIT = 3;
const MIN_GRAPH_SIZE_FOR_CLUSTERING = 5;
const CLUSTER_GAP = 30;
const SPREAD_MAX_ITERATIONS = 50;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ClusterInfo {
  id: string;
  name: string;
  color: string;
  nodeIds: Set<string>;
  centroid: { x: number; y: number };
}

// ---------------------------------------------------------------------------
// Helper: extract the first meaningful URL path segment
// ---------------------------------------------------------------------------

function extractFirstPathSegment(url: string): string {
  // Strip protocol + host (anything up to and including the first "/")
  const withoutProtocol = url.replace(/^https?:\/\/[^/]+/, '');

  // Strip leading "/"
  const stripped = withoutProtocol.replace(/^\/+/, '');

  // Take text before the next "/"
  const segment = stripped.split('/')[0] ?? '';

  // Strip template params like {{userId}} and :param patterns
  const cleaned = segment
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/:[a-zA-Z_][a-zA-Z0-9_]*/g, '')
    .trim();

  return cleaned === '' ? '_root' : cleaned;
}

// ---------------------------------------------------------------------------
// Helper: compute centroid for a set of node IDs
// ---------------------------------------------------------------------------

function computeCentroid(
  nodeIds: Set<string>,
  graph: Graph,
): { x: number; y: number } {
  let sumX = 0;
  let sumY = 0;
  let count = 0;

  for (const id of nodeIds) {
    const x = graph.getNodeAttribute(id, 'x') as number | undefined;
    const y = graph.getNodeAttribute(id, 'y') as number | undefined;
    if (x !== undefined && y !== undefined) {
      sumX += x;
      sumY += y;
      count++;
    }
  }

  if (count === 0) return { x: 0, y: 0 };
  return { x: sumX / count, y: sumY / count };
}

// ---------------------------------------------------------------------------
// Helper: pick the primary URL prefix for a set of node IDs (request nodes)
// ---------------------------------------------------------------------------

function dominantUrlPrefix(nodeIds: Set<string>, graph: Graph): string {
  const counts = new Map<string, number>();
  for (const id of nodeIds) {
    const entityType = graph.getNodeAttribute(id, 'entity_type') as string;
    if (entityType !== 'request') continue;
    const props = (graph.getNodeAttribute(id, 'properties') ?? {}) as Record<string, unknown>;
    const url = (props.url as string) ?? '';
    if (!url) continue;
    const seg = extractFirstPathSegment(url);
    counts.set(seg, (counts.get(seg) ?? 0) + 1);
  }
  if (counts.size === 0) return '';
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return sorted[0][0];
}

// ---------------------------------------------------------------------------
// Step 1 + 2: Build initial sub-clusters from Louvain communities
// ---------------------------------------------------------------------------

interface RawCluster {
  nodeIds: Set<string>;
  urlPrefix: string; // dominant URL prefix (may be '')
}

function buildRawClusters(graph: Graph): RawCluster[] {
  // Group node IDs by community_rank
  const byRank = new Map<number, string[]>();
  graph.forEachNode((nodeId, attrs) => {
    const rank = attrs.community_rank as number ?? 0;
    const list = byRank.get(rank) ?? [];
    list.push(nodeId);
    byRank.set(rank, list);
  });

  const raw: RawCluster[] = [];

  for (const [, members] of byRank) {
    // Separate request nodes from others
    const requestNodes = members.filter((id) => {
      const entityType = graph.getNodeAttribute(id, 'entity_type') as string;
      return entityType === 'request';
    });
    const otherNodes = members.filter((id) => {
      const entityType = graph.getNodeAttribute(id, 'entity_type') as string;
      return entityType !== 'request';
    });

    // Step 2: URL-prefix split — bucket request nodes by first URL path segment
    const buckets = new Map<string, string[]>();
    for (const id of requestNodes) {
      const props = (graph.getNodeAttribute(id, 'properties') ?? {}) as Record<string, unknown>;
      const url = (props.url as string) ?? '';
      const seg = url ? extractFirstPathSegment(url) : '_root';
      const bucket = buckets.get(seg) ?? [];
      bucket.push(id);
      buckets.set(seg, bucket);
    }

    // Identify buckets large enough to warrant splitting
    const largeBuckets: Array<[string, string[]]> = [];
    const smallBucketNodes: string[] = [];

    for (const [seg, ids] of buckets) {
      if (ids.length >= MIN_CLUSTER_SIZE_FOR_SPLIT) {
        largeBuckets.push([seg, ids]);
      } else {
        smallBucketNodes.push(...ids);
      }
    }

    if (largeBuckets.length >= 2) {
      // Split into per-prefix sub-clusters
      for (const [seg, ids] of largeBuckets) {
        raw.push({ nodeIds: new Set(ids), urlPrefix: seg });
      }
      // Remainder: non-request + small buckets, combined with "other" nodes
      const remainderIds = [...otherNodes, ...smallBucketNodes];
      if (remainderIds.length > 0) {
        const remainderSet = new Set(remainderIds);
        const prefix = dominantUrlPrefix(remainderSet, graph);
        raw.push({ nodeIds: remainderSet, urlPrefix: prefix });
      }
    } else {
      // No split — keep community as one cluster
      const allSet = new Set(members);
      const prefix = dominantUrlPrefix(allSet, graph);
      raw.push({ nodeIds: allSet, urlPrefix: prefix });
    }
  }

  return raw;
}

// ---------------------------------------------------------------------------
// Step 3: Attach unassigned model nodes
// ---------------------------------------------------------------------------

function attachModelNodes(raw: RawCluster[], graph: Graph): void {
  // Collect all currently unassigned model nodes
  const assigned = new Set<string>();
  for (const cluster of raw) {
    for (const id of cluster.nodeIds) {
      assigned.add(id);
    }
  }

  graph.forEachNode((nodeId, attrs) => {
    const entityType = attrs.entity_type as string;
    if (entityType !== 'model') return;
    if (assigned.has(nodeId)) return;

    // Count edges to each cluster
    const clusterEdgeCounts = raw.map((cluster) => {
      let count = 0;
      graph.forEachNeighbor(nodeId, (neighbor) => {
        if (cluster.nodeIds.has(neighbor)) count++;
      });
      return count;
    });

    const maxCount = Math.max(...clusterEdgeCounts);
    if (maxCount === 0) {
      // No edges — attach to the largest cluster
      let maxSize = -1;
      let bestIdx = 0;
      raw.forEach((cluster, idx) => {
        if (cluster.nodeIds.size > maxSize) {
          maxSize = cluster.nodeIds.size;
          bestIdx = idx;
        }
      });
      raw[bestIdx].nodeIds.add(nodeId);
    } else {
      const bestIdx = clusterEdgeCounts.indexOf(maxCount);
      raw[bestIdx].nodeIds.add(nodeId);
    }
  });
}

// ---------------------------------------------------------------------------
// Step 4: Merge small clusters sharing a URL prefix
// ---------------------------------------------------------------------------

function mergeSmallClusters(raw: RawCluster[]): RawCluster[] {
  const SMALL_THRESHOLD = 3;
  let changed = true;

  while (changed) {
    changed = false;
    const result: RawCluster[] = [];
    const merged = new Set<number>();

    for (let i = 0; i < raw.length; i++) {
      if (merged.has(i)) continue;
      const clusterA = raw[i];

      if (clusterA.nodeIds.size > SMALL_THRESHOLD) {
        result.push(clusterA);
        continue;
      }

      // Find a partner with the same URL prefix that is also small
      let partner = -1;
      for (let j = i + 1; j < raw.length; j++) {
        if (merged.has(j)) continue;
        const clusterB = raw[j];
        if (
          clusterB.nodeIds.size <= SMALL_THRESHOLD &&
          clusterA.urlPrefix !== '' &&
          clusterA.urlPrefix === clusterB.urlPrefix
        ) {
          partner = j;
          break;
        }
      }

      if (partner !== -1) {
        const mergedSet = new Set([...clusterA.nodeIds, ...raw[partner].nodeIds]);
        result.push({ nodeIds: mergedSet, urlPrefix: clusterA.urlPrefix });
        merged.add(partner);
        changed = true;
      } else {
        result.push(clusterA);
      }
    }

    raw = result;
  }

  return raw;
}

// ---------------------------------------------------------------------------
// Step 5: Cluster naming
// ---------------------------------------------------------------------------

function clusterName(
  nodeIds: Set<string>,
  urlPrefix: string,
  graph: Graph,
  usedNames: Set<string>,
): string {
  let base = '';

  // Priority 1: primary collection name in the cluster
  for (const id of nodeIds) {
    const entityType = graph.getNodeAttribute(id, 'entity_type') as string;
    if (entityType === 'collection') {
      const label = graph.getNodeAttribute(id, 'label') as string | undefined;
      if (label) {
        base = label;
        break;
      }
    }
  }

  // Priority 2: dominant URL prefix
  if (!base && urlPrefix && urlPrefix !== '_root') {
    base = `/${urlPrefix}`;
  }

  // Fallback
  if (!base) {
    base = 'Cluster';
  }

  // Append suffix number if name already used
  let name = base;
  let suffix = 2;
  while (usedNames.has(name)) {
    name = `${base} ${suffix}`;
    suffix++;
  }
  usedNames.add(name);
  return name;
}

// ---------------------------------------------------------------------------
// Public: spreadClusters — push overlapping clusters apart
// ---------------------------------------------------------------------------

export function spreadClusters(
  graph: Graph,
  clusters: Map<string, ClusterInfo>,
): Map<string, ClusterInfo> {
  const entries = [...clusters.entries()];
  if (entries.length < 2) return clusters;

  // Build working data: centroid + bounding radius per cluster
  const clusterData = entries.map(([id, cluster]) => {
    const centroid = computeCentroid(cluster.nodeIds, graph);
    let maxDist = 0;
    for (const nodeId of cluster.nodeIds) {
      const nx = graph.getNodeAttribute(nodeId, 'x') as number ?? 0;
      const ny = graph.getNodeAttribute(nodeId, 'y') as number ?? 0;
      const nodeSize = graph.getNodeAttribute(nodeId, 'size') as number ?? 2;
      const dist = Math.sqrt((nx - centroid.x) ** 2 + (ny - centroid.y) ** 2) + nodeSize;
      if (dist > maxDist) maxDist = dist;
    }
    return { id, cluster, cx: centroid.x, cy: centroid.y, radius: maxDist };
  });

  // Iterative repulsion
  for (let iter = 0; iter < SPREAD_MAX_ITERATIONS; iter++) {
    let anyOverlap = false;

    for (let i = 0; i < clusterData.length; i++) {
      for (let j = i + 1; j < clusterData.length; j++) {
        const a = clusterData[i];
        const b = clusterData[j];

        const dx = b.cx - a.cx;
        const dy = b.cy - a.cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minDist = a.radius + b.radius + CLUSTER_GAP;

        if (dist < minDist && dist > 0.001) {
          anyOverlap = true;
          const overlap = (minDist - dist) / 2;
          const nx = dx / dist;
          const ny = dy / dist;

          a.cx -= nx * overlap;
          a.cy -= ny * overlap;
          b.cx += nx * overlap;
          b.cy += ny * overlap;
        } else if (dist <= 0.001) {
          // Clusters at same position — push apart with jitter
          anyOverlap = true;
          const angle = (2 * Math.PI * i) / clusterData.length;
          a.cx += 5 * Math.cos(angle);
          a.cy += 5 * Math.sin(angle);
        }
      }
    }

    if (!anyOverlap) break;
  }

  // Apply displacements to node positions and rebuild cluster map with updated centroids
  const result = new Map<string, ClusterInfo>();

  for (const cd of clusterData) {
    const originalCentroid = computeCentroid(cd.cluster.nodeIds, graph);
    const offsetX = cd.cx - originalCentroid.x;
    const offsetY = cd.cy - originalCentroid.y;

    // Translate all nodes in this cluster as a rigid body
    for (const nodeId of cd.cluster.nodeIds) {
      const oldX = graph.getNodeAttribute(nodeId, 'x') as number ?? 0;
      const oldY = graph.getNodeAttribute(nodeId, 'y') as number ?? 0;
      graph.setNodeAttribute(nodeId, 'x', oldX + offsetX);
      graph.setNodeAttribute(nodeId, 'y', oldY + offsetY);
    }

    // Recompute centroid from final positions
    const newCentroid = computeCentroid(cd.cluster.nodeIds, graph);

    result.set(cd.id, {
      ...cd.cluster,
      centroid: newCentroid,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Public: computeClusters
// ---------------------------------------------------------------------------

export function computeClusters(graph: Graph): Map<string, ClusterInfo> {
  const result = new Map<string, ClusterInfo>();

  if (graph.order < MIN_GRAPH_SIZE_FOR_CLUSTERING) {
    return result;
  }

  // Steps 1 + 2: Build initial clusters from Louvain communities + URL-prefix split
  let raw = buildRawClusters(graph);

  // Step 3: Attach unassigned model nodes
  attachModelNodes(raw, graph);

  // Step 4: Merge small clusters sharing a URL prefix
  raw = mergeSmallClusters(raw);

  // Step 5: Sort by size (largest first), assign palette colors, build ClusterInfo
  raw.sort((a, b) => b.nodeIds.size - a.nodeIds.size);

  const usedNames = new Set<string>();

  raw.forEach((cluster, idx) => {
    const id = `cluster-${idx}`;
    const color = CLUSTER_PALETTE[idx % CLUSTER_PALETTE.length];
    const name = clusterName(cluster.nodeIds, cluster.urlPrefix, graph, usedNames);
    const centroid = computeCentroid(cluster.nodeIds, graph);

    result.set(id, {
      id,
      name,
      color,
      nodeIds: cluster.nodeIds,
      centroid,
    });
  });

  return result;
}

// ---------------------------------------------------------------------------
// Public: findClusterForNode
// ---------------------------------------------------------------------------

export function findClusterForNode(
  nodeId: string,
  clusters: Map<string, ClusterInfo>,
): string | null {
  for (const [clusterId, cluster] of clusters) {
    if (cluster.nodeIds.has(nodeId)) {
      return clusterId;
    }
  }
  return null;
}
