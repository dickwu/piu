# Graph Auto-Fusion with Metaball Cluster Visualization

**Date**: 2026-03-19
**Status**: Draft
**Scope**: Graph visualization — semantic clustering, 2D mode, metaball boundaries, focus/overview interaction

## Summary

Enhance PIU's graph visualization with automatic semantic node fusion. Nodes are grouped into clusters using Louvain community detection refined by URL/name similarity. Clusters are rendered as smooth organic metaball boundaries (SDF fragment shader) behind dimmed member nodes. The graph switches from 3D perspective to 2D orthographic (still using Three.js/R3F). Users can focus into a cluster to see its internal structure, with stub edges showing external connections.

## Requirements

1. **Always-on automatic fusion** — graph launches with nodes already clustered
2. **Semantic clustering** — Louvain communities refined by URL path prefix similarity
3. **Metaball visual boundaries** — smooth organic translucent blobs wrapping cluster members
4. **Focus mode** — click a cluster to zoom in, hide other clusters, show internal edges + stub edges to external clusters
5. **Overview mode** — no inter-cluster edges, clean cluster bubbles floating in space
6. **2D rendering** — orthographic camera, all nodes at z=0, Three.js/R3F retained as renderer

## Non-Goals

- LLM-powered semantic analysis (no external API calls)
- 3D depth layers (removed in favor of 2D)
- Persistent cluster assignments (recomputed on each graph rebuild)
- Drag-to-rearrange clusters

---

## Section 1: Camera & Coordinate System

### Current State

- `PerspectiveCamera` with `OrbitControls` (full 3D rotation)
- Z-layers: collections=0, requests=50, models=100
- FA2 layout produces 2D (x,y) positions; z is assigned per entity type

### Changes

| File | Change |
|------|--------|
| `GraphCanvas.tsx` | Replace `<PerspectiveCamera>` with `<OrthographicCamera>` from drei |
| `GraphCanvas.tsx` | `OrbitControls`: add `enableRotate={false}`, keep pan/zoom |
| `graphDataTransform.ts` | Remove `assignZLayer()` call and `Z_LAYER` constant |
| `GraphNodes.tsx:61` | `_dummy.position.set(node.x, node.y, 0)` — always z=0 |
| `GraphEdges.tsx` | Edge z-positions also set to 0 |
| Rust `graph_commands.rs` | `fz` field still saved but ignored by frontend |

FA2 layout requires no changes — it already produces 2D coordinates. Position persistence continues to save x,y; fz is always 0.

---

## Section 2: Semantic Clustering Algorithm

### New File: `src/app/utils/graphClustering.ts`

**Input**: graphology `Graph` instance (with Louvain `community` attributes already assigned)

**Output**: `Map<string, ClusterInfo>` where:
```typescript
interface ClusterInfo {
  id: string;
  name: string;         // e.g., "Users API"
  color: string;        // from community palette
  nodeIds: Set<string>; // all member node IDs
  centroid: { x: number; y: number }; // average position
}
```

### Algorithm: 3-Step Refinement

**Step 1 — Louvain base**: Start with existing `assignCommunities()` output. Each node has a `community_rank` attribute.

**Step 2 — URL-prefix split**: Within each Louvain community, group request nodes by their first URL path segment (e.g., `/users/...`, `/auth/...`). If a community contains requests from 2+ distinct path prefixes with significant counts (>3 each), split into sub-clusters.

**Step 3 — Small-community merge**: Across Louvain communities, if two small communities (<=3 nodes) share a common path prefix, merge them.

### Cluster Naming

Derived from:
1. Primary collection name in the cluster (if one exists)
2. Dominant URL prefix (if no collection)
3. Fallback: `"Cluster N"`

### Invariants

- Every node belongs to exactly one cluster
- Models attach to the cluster of the request that references them most (by edge count)
- Minimum cluster size for metaball rendering: 2 nodes
- Single-node clusters render as normal ungrouped nodes

---

## Section 3: Metaball Cluster Renderer

### New File: `src/app/components/graph/GraphClusterMetaballs.tsx`

A fullscreen quad behind all nodes that renders smooth organic cluster boundaries via a GPU fragment shader.

### Architecture

- Single `<mesh>` with `PlaneGeometry` covering the orthographic viewport, placed at z=-1 (behind nodes at z=0)
- Custom `ShaderMaterial` with metaball SDF fragment shader
- Cluster data passed as uniforms:
  - `u_nodePositions: vec2[]` — all node x,y positions
  - `u_nodeCluster: int[]` — cluster index per node
  - `u_clusterColors: vec3[]` — RGB per cluster
  - `u_nodeCount: int` — total node count
  - `u_blobRadius: float` — controls blob size (default 28.0)
  - `u_threshold: float` — SDF cutoff (default 1.0)
  - `u_resolution: vec2` — viewport size

### Fragment Shader Logic (per pixel)

```glsl
float maxField = 0.0;
int maxCluster = -1;

for (int i = 0; i < u_nodeCount; i++) {
    vec2 diff = gl_FragCoord.xy - u_nodePositions[i];
    float distSq = dot(diff, diff);
    float r = u_blobRadius;
    float field = (r * r) / distSq;

    // Accumulate per-cluster
    // (simplified: track highest-field cluster per pixel)
    if (field > maxField) {
        maxField = field;
        maxCluster = u_nodeCluster[i];
    }
}

if (maxField > u_threshold && maxCluster >= 0) {
    float alpha = min((maxField - u_threshold) * 0.3, 1.0);
    alpha = min(alpha, 0.18); // translucent
    gl_FragColor = vec4(u_clusterColors[maxCluster], alpha);
} else {
    discard;
}
```

### Performance

- Typical PIU project: <200 nodes → shader iterates ~200 positions per pixel — trivially fast
- If node count exceeds 500: reduce resolution (sample every 2nd pixel)
- WebGL2 uniform array limit: typically 1024 vec2s — well above ceiling
- `raycast={() => null}` — clicks pass through to nodes

### Update Cadence

- Node positions updated via uniforms in `useFrame` when FA2 layout runs
- During layout animation, blobs smoothly morph as nodes settle
- Only active when `clusterMode !== 'off'`

---

## Section 4: Dual View Modes

### Store Additions (`graphStore.ts`)

```typescript
// --- Phase 4: Cluster fusion ---
clusterMode: 'overview' | 'focus' | 'off';
setClusterMode: (mode: 'overview' | 'focus' | 'off') => void;

clusters: Map<string, ClusterInfo>;
setClusters: (clusters: Map<string, ClusterInfo>) => void;

focusedClusterId: string | null;
setFocusedClusterId: (id: string | null) => void;
```

### Overview Mode (default when fusion is on)

| Aspect | Behavior |
|--------|----------|
| Nodes | Visible at reduced size (0.6x) and dimmed color (0.4x multiply) inside metaball blobs |
| Edges | Hidden — no inter-cluster edges |
| Cluster labels | `<Html>` elements (drei) at each cluster centroid showing cluster name |
| Metaball shader | Active for all clusters |
| Click behavior | Clicking a node triggers focus on that node's cluster |

### Focus Mode (triggered by cluster click)

| Aspect | Behavior |
|--------|----------|
| Visible nodes | Only the focused cluster's members (`visibleNodeIds` filtered) |
| Node rendering | Full size (1.0x), full color |
| Internal edges | Visible for the focused cluster |
| Stub edges | Short thick cylinders from boundary nodes → external cluster centroids, labeled with target cluster name |
| Camera | Tweens to frame the focused cluster's bounding box |
| Metaball | Only focused cluster's blob rendered |
| Navigation | "Back to overview" button; integrates with `selectionHistory` |

### New Component: `GraphStubEdges.tsx`

Renders stub edges during focus mode:
- For each edge connecting a focused node to an external node, render a thick cylinder (width 3.0) from the focused node toward the external cluster's centroid
- Cylinder length: fixed short stub (not reaching the centroid, just pointing toward it)
- Color: the external cluster's color
- Label: external cluster name (via drei `<Html>`)

### Camera Transitions

- Overview → Focus: lerp camera position/zoom in `useFrame` over ~400ms to frame the focused cluster's bounding box with padding
- Focus → Overview: lerp back to fit-all view over ~400ms
- Uses the orthographic camera's `zoom` and `position` properties

---

## Section 5: Interaction & Toolbar Integration

### Toolbar (`GraphToolbar.tsx`)

| Control | Behavior |
|---------|----------|
| "Cluster View" toggle | Switches `clusterMode` between `'overview'` and `'off'` |
| "Back to overview" button | Visible only in focus mode; returns to overview |
| Cluster filter dropdown | Lists all clusters by name; click to focus directly |

### Tooltip (`GraphTooltip.tsx`)

| Mode | Hover behavior |
|------|---------------|
| Overview | Shows cluster info: name, member count, dominant methods, model count |
| Focus | Shows individual node info (existing behavior) |
| Off | Shows individual node info (existing behavior) |

### Minimap (`GraphMinimap.tsx`)

| Mode | Rendering |
|------|-----------|
| Overview | Draw cluster regions as filled translucent convex hull outlines |
| Focus | Highlight focused cluster region, dim the rest |

### Query Engine (`graphQueryEngine.ts`)

| Pattern | Action |
|---------|--------|
| `show cluster N` (existing) | Now triggers focus mode on cluster N |
| `fuse` / `unfuse` | Toggle cluster mode on/off |
| `focus <cluster-name>` | Focus the named cluster |

### Click Behavior Summary

| Mode | Click target | Action |
|------|-------------|--------|
| Overview | Any node | Focus on that node's cluster |
| Overview | Shift+click two nodes | Shortest path (crosses clusters) |
| Focus | Node in focused cluster | Select node (existing behavior) |
| Focus | Stub edge | Focus on the target cluster |
| Off | Any node | Select node (existing behavior) |

---

## Section 6: Error Handling & Edge Cases

| Scenario | Handling |
|----------|---------|
| Small graph (< 5 nodes) | Skip clustering, show all nodes ungrouped. Cluster toggle disabled with tooltip. |
| Single-node clusters | No metaball blob rendered. Node shown normally. |
| Empty clusters after filtering | Hide that cluster's blob. Recalculate visible clusters on filter change. |
| FA2 still running | Metaball positions update every frame via `useFrame`. Blobs morph smoothly. |
| Node count > 500 | Reduce shader resolution (sample every 2nd pixel) for 60fps. |
| WebGL uniform limit | Max 1024 vec2s — well above expected ceiling (<200 nodes). |

### Persistence

| Data | Storage | Notes |
|------|---------|-------|
| Cluster mode preference | `app_state` SQLite table | `'overview'` or `'off'` |
| Cluster assignments | Not persisted | Recomputed on each graph rebuild |
| Node positions | `graph_nodes.fx, fy` | Existing behavior, fz always 0 now |

### Performance Guard

If the shader drops below 30fps (detected via `useFrame` delta), automatically:
1. Halve the shader resolution
2. If still slow, disable metaball rendering and fall back to simple convex hull outlines (Canvas2D overlay like minimap)

---

## Files Changed (Summary)

### Modified Files

| File | Changes |
|------|---------|
| `src/app/components/graph/GraphCanvas.tsx` | Orthographic camera, cluster mode orchestration, camera transitions |
| `src/app/components/graph/GraphNodes.tsx` | z=0, dimming in overview mode |
| `src/app/components/graph/GraphEdges.tsx` | z=0, hidden in overview mode |
| `src/app/components/graph/GraphToolbar.tsx` | Cluster toggle, back button, cluster dropdown |
| `src/app/components/graph/GraphTooltip.tsx` | Cluster info on hover in overview mode |
| `src/app/components/graph/GraphMinimap.tsx` | Cluster hull rendering |
| `src/app/stores/graphStore.ts` | Phase 4 cluster state |
| `src/app/utils/graphDataTransform.ts` | Remove z-layer assignment |
| `src/app/utils/graphAlgorithms.ts` | Minor: export community data for clustering |
| `src/app/utils/graphQueryEngine.ts` | New cluster/fuse/focus patterns |

### New Files

| File | Purpose |
|------|---------|
| `src/app/utils/graphClustering.ts` | Semantic clustering algorithm (Louvain + URL refinement) |
| `src/app/components/graph/GraphClusterMetaballs.tsx` | Metaball SDF shader renderer |
| `src/app/components/graph/GraphStubEdges.tsx` | Stub edges for focus mode external connections |
