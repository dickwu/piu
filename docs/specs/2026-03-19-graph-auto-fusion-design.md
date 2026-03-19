# Graph Auto-Fusion with Metaball Cluster Visualization

**Date**: 2026-03-19
**Status**: Draft (Rev 2 — addresses spec review findings)
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
| `GraphCanvas.tsx` | Replace `<PerspectiveCamera>` with `<OrthographicCamera makeDefault zoom={1.5} near={-100} far={100} />` from drei. Frustum is auto-computed from viewport size by drei — `zoom` controls the world-units-per-pixel ratio. Initial `zoom={1.5}` provides a sensible default for FA2 coordinate ranges (±100–300 units). |
| `GraphCanvas.tsx` | `OrbitControls`: add `enableRotate={false}`, keep pan/zoom. Zoom changes `camera.zoom` (not camera position). `camera.updateProjectionMatrix()` is called automatically by drei's `OrbitControls`. |
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

**Step 3 — Small-community merge**: Across Louvain communities, if two small communities (<=3 nodes) share a common path prefix, merge them. The merged cluster inherits the name of the larger community.

**Step 4 — Independent palette assignment**: After all refinement steps complete, `graphClustering.ts` assigns its own color palette to the final clusters (sorted by size, largest first). These colors are independent of the `community_color` attributes set by `assignCommunities()` — the Louvain node attributes remain unchanged, but the cluster renderer uses the `ClusterInfo.color` from this step.

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

- Uses `RawShaderMaterial` on a clip-space fullscreen quad (vertex shader outputs `gl_Position` directly in NDC — no model/view/projection needed). This ensures the quad always covers the full screen regardless of camera zoom/pan.
- Placed at z=-1 (behind nodes at z=0)
- **Bloom exclusion**: The metaball mesh is assigned to `layers.set(1)` (a non-default layer). The `EffectComposer` + `Bloom` pass only processes layer 0 (the default). This prevents the bloom pass from applying glow to the cluster blobs.
- `raycast={() => null}` — clicks pass through to nodes

### Uniform Contract

Compile-time constant: `const int MAX_NODES = 512;`

All arrays are declared at this fixed size. For graphs with fewer nodes, the remaining slots are padded with `vec2(99999.0)` (positions far off-screen that contribute negligible field values). The `u_nodeCount` uniform tells the loop when to stop iterating.

| Uniform | Type | Description |
|---------|------|-------------|
| `u_nodePositions[MAX_NODES]` | `vec2` | Node positions in **NDC** (see Coordinate Space below) |
| `u_nodeCluster[MAX_NODES]` | `int` | Cluster index per node (0-based) |
| `u_clusterColors[MAX_CLUSTERS]` | `vec3` | RGB per cluster (`MAX_CLUSTERS = 24`) |
| `u_nodeCount` | `int` | Actual node count (loop bound) |
| `u_clusterCount` | `int` | Actual cluster count |
| `u_blobRadius` | `float` | Controls blob size in NDC units (default 0.08) |
| `u_threshold` | `float` | SDF cutoff (default 1.0) |

### Coordinate Space

Node positions must be in **Normalized Device Coordinates (NDC)**, not world space. In `useFrame`, before uploading uniforms, each node's world position is projected:

```typescript
// In useFrame callback:
const mvp = camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse);
const v = new THREE.Vector4(node.x, node.y, 0, 1).applyMatrix4(mvp);
ndcPositions[i] = [v.x / v.w, v.y / v.w]; // range [-1, 1]
```

The fragment shader uses `vUv` (0→1 range from the fullscreen quad) remapped to NDC (-1→1) for the per-pixel distance comparison. This ensures the metaball field is camera-independent.

### Fragment Shader Logic (per pixel)

The shader **accumulates** field values per cluster (not per node). This is what makes nearby same-cluster nodes merge into one smooth blob:

```glsl
#version 300 es
precision highp float;

const int MAX_NODES = 512;
const int MAX_CLUSTERS = 24;

uniform vec2 u_nodePositions[MAX_NODES];
uniform int u_nodeCluster[MAX_NODES];
uniform vec3 u_clusterColors[MAX_CLUSTERS];
uniform int u_nodeCount;
uniform float u_blobRadius;
uniform float u_threshold;

in vec2 vUv;
out vec4 fragColor;

void main() {
    vec2 ndc = vUv * 2.0 - 1.0; // map UV [0,1] → NDC [-1,1]

    // Accumulate field per cluster
    float clusterField[MAX_CLUSTERS];
    for (int c = 0; c < MAX_CLUSTERS; c++) clusterField[c] = 0.0;

    for (int i = 0; i < MAX_NODES; i++) {
        if (i >= u_nodeCount) break;
        vec2 diff = ndc - u_nodePositions[i];
        float distSq = dot(diff, diff);
        float r = u_blobRadius;
        float field = (r * r) / max(distSq, 0.0001);
        int cluster = u_nodeCluster[i];
        clusterField[cluster] += field; // ACCUMULATE per cluster
    }

    // Find dominant cluster
    float maxField = 0.0;
    int maxCluster = -1;
    for (int c = 0; c < MAX_CLUSTERS; c++) {
        if (clusterField[c] > maxField) {
            maxField = clusterField[c];
            maxCluster = c;
        }
    }

    if (maxField > u_threshold && maxCluster >= 0) {
        float alpha = min((maxField - u_threshold) * 0.3, 1.0);
        alpha = min(alpha, 0.18); // translucent
        fragColor = vec4(u_clusterColors[maxCluster], alpha);
    } else {
        discard;
    }
}
```

### Performance

- Typical PIU project: <200 nodes, <12 clusters → shader iterates ~200 positions + 12 cluster comparisons per pixel — trivially fast on any GPU
- **Node count threshold guard**: If node count exceeds 300, render metaball quad at half resolution (attach to a smaller `WebGLRenderTarget`, then blit to screen). If node count exceeds 500, fall back to Canvas2D bounding circles (like minimap).
- WebGL2 uniform limit for `vec2[512]`: 512 * 2 = 1024 floats ≈ 256 `vec4` slots. WebGL2 guarantees `gl_MaxVertexUniformVectors >= 256` and `gl_MaxFragmentUniformVectors >= 224`. For 512-node arrays, this is tight — if the target platform's fragment uniform limit is hit, reduce `MAX_NODES` to 256 or switch to a `DataTexture` (1D float texture) for positions. Check via `gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS)` at init time.

### Update Cadence

- Node NDC positions recalculated and uploaded in `useFrame` when FA2 layout runs or camera changes
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

// Focus mode uses a separate override set that takes priority over
// the filter-derived visibleNodeIds. This avoids conflicts with
// existing FilterState.communityId and entity type toggles.
focusOverrideNodeIds: Set<string> | null; // null = no override
setFocusOverrideNodeIds: (ids: Set<string> | null) => void;
```

**Effective visible set** (computed in `GraphCanvas.tsx`):
```typescript
const effectiveVisibleIds = focusOverrideNodeIds ?? visibleNodeIds;
```
When `focusOverrideNodeIds` is non-null (focus mode), it takes priority. Filter-derived `visibleNodeIds` is preserved but not applied until focus mode exits. This means entering focus mode does NOT clear the user's active filters — they're restored when returning to overview.

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

### Camera Transitions (Orthographic-Specific)

Orthographic zoom works via `camera.zoom` (a multiplier), NOT by moving the camera closer. `camera.updateProjectionMatrix()` must be called after each zoom change.

- **Overview → Focus**: In `useFrame`, lerp both `camera.position` (x,y to cluster centroid) and `camera.zoom` (to a value that frames the cluster's bounding box with 20% padding) over ~400ms. Call `camera.updateProjectionMatrix()` each frame during the transition. Target zoom = `min(viewportWidth / clusterWidth, viewportHeight / clusterHeight) * 0.8`.
- **Focus → Overview**: Lerp `camera.position` back to (0,0,10) and `camera.zoom` back to the stored pre-focus value over ~400ms.
- Store `preFocusZoom: number` and `preFocusPosition: {x,y}` in the graph store to restore on back-navigation.

### GraphStubEdges.tsx — Shared Geometry

Stub edges reuse the same cylinder orientation math from `GraphEdges.tsx` (`setFromUnitVectors(_up, _dir)`) to avoid code duplication. Extract the shared `orientCylinder(from, to)` helper into a utility or keep it as a shared constant.

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
| Overview | Draw cluster regions as filled translucent bounding circles (centroid + max-distance-to-member as radius). No convex hull library needed — simple Euclidean distance calculation. |
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

### Click Branching Implementation

The existing `handleNodeClick` in `GraphCanvas.tsx` currently calls `setSelectedNode()` and `pushSelection()`. In cluster mode, this must branch:

```typescript
function handleNodeClick(nodeId: string, event?: { shiftKey?: boolean }) {
  const { clusterMode, clusters } = useGraphStore.getState();

  if (clusterMode === 'overview' && !event?.shiftKey) {
    // Find which cluster this node belongs to
    const clusterId = findClusterForNode(nodeId, clusters);
    if (clusterId) {
      focusCluster(clusterId); // sets focusedClusterId, focusOverrideNodeIds, clusterMode='focus'
    }
    return; // do NOT select the individual node
  }

  // All other cases: existing behavior (select node, push history)
  // ... existing setSelectedNode + pushSelection logic
}
```

The `GraphNodes.tsx` component itself is unchanged — it still calls `onNodeClick(nodeId, event)`. The branching happens in the parent (`GraphCanvas.tsx`).

---

## Section 6: Error Handling & Edge Cases

| Scenario | Handling |
|----------|---------|
| Empty graph (0 nodes) | `graphClustering.ts` returns an empty `Map`. Metaball shader not activated. Cluster toggle disabled. |
| Small graph (< 5 nodes) | Skip clustering, show all nodes ungrouped. Cluster toggle disabled with tooltip. |
| Single-node clusters | No metaball blob rendered. Node shown normally. |
| All nodes in one cluster | Single metaball blob covers the entire graph. Focus mode still works (clicking zooms to fit that one cluster). |
| Empty clusters after filtering | Hide that cluster's blob. Recalculate visible clusters on filter change. |
| FA2 still running | Metaball positions update every frame via `useFrame`. Blobs morph smoothly. |
| Rapid cluster mode toggling | Debounce `setClusterMode` (100ms). Camera transitions cancel cleanly if a new transition starts. |
| Window resize during focus mode | `camera.updateProjectionMatrix()` is called on resize. Focus bounding box is recalculated. |
| Node count > 300 | Render metaball to half-resolution `WebGLRenderTarget`, blit to screen. |
| Node count > 500 | Disable metaball shader. Fall back to Canvas2D bounding circles (like minimap). |
| Fragment uniform limit exceeded | Check `gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS)` at init. If < 256, reduce `MAX_NODES` to 256 or switch to `DataTexture` for position data. |

### Persistence

| Data | Storage | Notes |
|------|---------|-------|
| Cluster mode preference | `app_state` SQLite table | `'overview'` or `'off'` |
| Cluster assignments | Not persisted | Recomputed on each graph rebuild |
| Node positions | `graph_nodes.fx, fy` | Existing behavior, fz always 0 now |

### Performance Guard

Performance degradation is triggered by **node count thresholds** (deterministic, not frame-rate heuristics — `useFrame` delta reflects total frame cost, not just the metaball shader):

| Node Count | Strategy |
|------------|----------|
| 0–300 | Full-resolution metaball shader |
| 301–500 | Half-resolution render target, blit to screen |
| 500+ | Disable shader, Canvas2D bounding circles fallback |

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
