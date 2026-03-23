# Sigma.js v3 Graph Engine Swap

**Date:** 2026-03-23
**Status:** Approved
**Scope:** Replace React Three Fiber rendering with Sigma.js v3, adopt GitNexus architecture patterns

## Summary

Replace PIU's graph rendering engine from React Three Fiber (Three.js InstancedMesh + custom GLSL metaball shader + bloom post-processing) with Sigma.js v3 (WebGL node/edge programs + reducer-based visual state). Port GitNexus's `useSigma` hook pattern, node/edge reducer architecture, animation system, and highlight/dimming logic. Keep PIU's data pipeline (Rust backend, graphology, ForceAtlas2/Noverlap, Louvain clustering, query engine) unchanged. Implement overview/focus cluster navigation via Sigma reducers and camera animation.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Rendering engine | Sigma.js v3 | WebGL node/edge programs out of the box, reducer pattern for all visual state, no custom shaders to maintain |
| Cluster visualization | Community coloring (GitNexus style) | Replace GLSL SDF metaball shader; clusters visible through shared node colors + dimming |
| Overview/focus mode | Keep, via Sigma reducers | Node reducer hides non-focused nodes; camera animates to cluster bounding box |
| Existing unstaged changes | Discard (clean slate from d6a18fc) | Sigma swap rewrites all graph rendering files; in-progress R3F changes are throwaway |
| Edge rendering | @sigma/edge-curve (curved Bezier) | Visual variety, matches GitNexus aesthetic |
| Bloom post-processing | Dropped | Sigma has no built-in post-processing; community coloring + dimming provides sufficient visual hierarchy |
| Minimap | Dropped (rebuild later if needed) | Current Canvas 2D minimap is tightly coupled to R3F coordinate system |

## Dependency Changes

### Remove
- `@react-three/fiber` — R3F scene host
- `@react-three/drei` — OrthographicCamera, OrbitControls, Html
- `@react-three/postprocessing` — Bloom effect
- `three` — Three.js core
- `postprocessing` — Bloom dependency

### Add
- `sigma` (v3) — WebGL graph rendering with reducers
- `@sigma/edge-curve` — Curved Bezier edge program
- `@sigma/node-border` (optional) — Bordered node program for highlights

### Unchanged
- `graphology`, `graphology-types` — Graph data structure
- `graphology-layout-forceatlas2` — Layout algorithm (web worker)
- `graphology-layout-noverlap` — Overlap removal
- `graphology-communities-louvain` — Community detection
- `graphology-shortest-path` — Path finding
- All other existing graphology utilities

## File Map

### Deleted (6 files)
| File | Reason |
|------|--------|
| `src/app/components/graph/GraphClusterMetaballs.tsx` | GLSL SDF shader replaced by community coloring in reducers |
| `src/app/components/graph/GraphStubEdges.tsx` | R3F stub edge cylinders; focus mode hides cross-cluster edges via reducer |
| `src/app/components/graph/GraphNodes.tsx` | InstancedMesh sphere rendering replaced by Sigma NodeCircleProgram |
| `src/app/components/graph/GraphEdges.tsx` | InstancedMesh cylinder rendering replaced by @sigma/edge-curve |
| `src/app/components/graph/GraphMinimap.tsx` | Canvas 2D minimap coupled to R3F coordinates; rebuild later if needed |
| `src/app/utils/graphColorUtils.ts` | dimColor/brightenColor inlined into reducer logic |

### Created (2 files)
| File | Purpose |
|------|---------|
| `src/app/hooks/useSigma.ts` | Core hook: Sigma initialization, layout lifecycle, reducers, camera control, events |
| `src/app/utils/graphConstants.ts` | Color palettes, size hierarchy, edge styles, animation config (from GitNexus pattern) |

### Rewritten (2 files)
| File | Change |
|------|--------|
| `src/app/components/graph/GraphCanvas.tsx` | R3F `<Canvas>` replaced with Sigma container div + overlay UI; wires graphStore to useSigma |
| `src/app/stores/graphStore.ts` | Drop R3F-specific state (nodeData/edgeData arrays, animation frame refs, camera refs); add visibleEdgeTypes |

### Modified (4 files)
| File | Change |
|------|--------|
| `src/app/components/graph/GraphToolbar.tsx` | Rewire zoom/layout/reset controls to Sigma camera API |
| `src/app/components/graph/GraphTooltip.tsx` | Sigma enterNode/leaveNode events instead of R3F pointerOver/pointerOut |
| `src/app/utils/graphDataTransform.ts` | Set Sigma-specific node attributes (size, color, x, y) during graphology build |
| `src/app/utils/graphClustering.ts` | Output adds community color to node attributes for Sigma rendering |

### Unchanged (5+ files)
| File | Reason |
|------|--------|
| `src/app/utils/graphAlgorithms.ts` | Pure graphology operations, no rendering coupling |
| `src/app/utils/graphQueryEngine.ts` | Pure text/regex operations, no rendering coupling |
| `src-tauri/src/commands/graph_commands.rs` | Rust backend unchanged |
| `src-tauri/src/db/entity_graph.rs` | Relationship extraction unchanged |
| `src/app/utils/apiModelMapLayout.ts` | Shared type definitions unchanged |

## Architecture

### useSigma Hook

The core rendering hook, ported from GitNexus's pattern:

```
useSigma(containerRef, graph, graphStore) → SigmaControls
```

**Responsibilities:**
1. **Sigma lifecycle** — Create instance on mount with `{ allowInvalidContainer: true, zIndex: true, hideEdgesOnMove: true }`. Set graph when available. Destroy on unmount.
2. **Node reducer** — Called per-node per-frame. Priority chain:
   - Hidden check (filtered by visibleEntityTypes)
   - Active animation (pulse/ripple/glow with sine oscillation)
   - Cluster focus mode (focused cluster visible, others hidden)
   - Blast radius mode (red highlights + dimmed rest)
   - Highlight mode (cyan highlights + dimmed rest)
   - Selection mode (selected + neighbors bright, rest dimmed)
3. **Edge reducer** — Called per-edge per-frame. Priority chain:
   - Type visibility filter (visibleEdgeTypes)
   - Cluster focus (intra-cluster visible, cross-cluster hidden)
   - Highlight/blast radius (both endpoints highlighted = bright)
   - Selection (connected edges bright, rest dimmed)
4. **ForceAtlas2 lifecycle** — Start worker on graph set, stop after 15s timeout, run Noverlap post-pass, run cluster spread, cache positions via `invoke('save_graph_positions')`
5. **Camera animation** — `focusNode(id)` animates to node at ratio 0.15 over 400ms. `focusCluster(id)` computes bounding box, animates to center. `resetView()` animated reset.
6. **Event handlers** — clickNode (select or focus cluster), clickStage (deselect), enterNode (tooltip), leaveNode (hide tooltip)

**Returns:** `{ zoomIn, zoomOut, resetView, focusNode, focusCluster, restartLayout, sigma }`

### Node Rendering

Sigma's default `NodeCircleProgram` (WebGL circles):

| Entity Type | Color | Base Size |
|-------------|-------|-----------|
| `collection` | `#fbbf24` (amber) | `8 + sqrt(requestCount)` |
| `request` | HTTP method color (GET `#34d399`, POST `#fbbf24`, PUT `#60a5fa`, DELETE `#f87171`, PATCH `#a78bfa`) | `5` |
| `model` | `#4a9eff` (blue) | `5 + fieldCount * 0.3` |

In overview mode, node colors are overridden by community color (12-color cycling palette).

### Edge Rendering

`EdgeCurveProgram` from `@sigma/edge-curve`:
- Base curvature: `0.15`
- Colors by edge type (same palette as current)
- Width scaled by type importance: `col-subcol` thinnest, `model-inherits` thickest

### Dimming

`dimColor(hex, amount)` blends toward `#0a0a0f` (PIU dark background) by `(1 - amount)`. Inlined in reducers as a pure function (no separate utility file).

### Cluster Navigation

**Overview mode** (`clusterMode === 'overview'`):
- Node reducer overrides color to community color, scales size 0.8x
- HTML overlay labels at cluster centroid via `sigma.graphToViewport()`
- Click any node triggers `setFocusedClusterId` + camera animate to cluster bounding box

**Focus mode** (`clusterMode === 'focus'`):
- Node reducer: focused cluster nodes at full color/size, others `hidden: true`
- Edge reducer: intra-cluster edges visible, cross-cluster edges hidden
- Escape key returns to overview mode

**Off mode** (`clusterMode === 'off'`):
- Standard selection/highlight behavior, no community color overrides

### Animation System

Driven by `requestAnimationFrame` loop calling `sigma.refresh()`:

| Animation | Color | Duration | Size Effect | Trigger |
|-----------|-------|----------|-------------|---------|
| `pulse` | `#06b6d4` (cyan) | 2000ms | 1.5x + 0.8x sine oscillation | Search results |
| `ripple` | `#ef4444` (red) | 3000ms | 1.3x + 1.2x sine oscillation | Blast radius |
| `glow` | `#a855f7` (purple) | 4000ms | 1.4x + 0.6x sine oscillation | Query highlights |

Auto-cleanup: animations are removed from `animatedNodes` map after their duration expires.

### GraphStore Changes

**Removed state:**
- `nodeData: GraphNodeData[]` — Sigma reads directly from graphology
- `edgeData: GraphEdgeData[]` — Sigma reads directly from graphology
- `setNodeData` / `setEdgeData` actions
- Animation frame refs (Sigma owns the render loop)
- Camera position/zoom refs (Sigma owns camera)

**Kept state (unchanged):**
- `graph: Graph | null`
- `selectedNodeId: string | null`
- `hoveredNodeId: string | null`
- `highlightedNodeIds: Set<string> | null`
- `blastRadiusNodeIds: Set<string> | null`
- `animatedNodes: Map<string, Animation>`
- `clusterMode: 'off' | 'overview' | 'focus'`
- `focusedClusterId: string | null`
- `clusters: Map<string, ClusterInfo>`
- `visibleEntityTypes: Set<string>`
- `searchQuery: string`
- `selectionHistory: string[]`

**New state:**
- `visibleEdgeTypes: Set<string>` — Edge type filter (currently implicit, now explicit)

## Data Flow

```
Rust backend (zero changes)
    |  invoke('build_project_graph')
    v
graphDataTransform.ts — buildGraphologyInstance()
    |  Adds x, y, size, color, label, entityType, communityColor attributes
    v
graphStore.setGraph(graph)
    |
    v
useSigma hook
    |  sigma.setGraph(graph)
    |  ForceAtlas2 worker starts
    |  Positions update in graphology → Sigma re-renders automatically
    |  nodeReducer / edgeReducer read graphStore → apply visual overrides
    v
Sigma WebGL canvas
    |  Events: clickNode, enterNode, clickStage
    v
graphStore actions (setSelectedNodeId, setHoveredNodeId, etc.)
    |  Store update → sigma.refresh() → reducers re-evaluate → canvas re-renders
```

## Keyboard Shortcuts (Unchanged)

| Key | Action |
|-----|--------|
| `Cmd/Ctrl+F` | Focus search |
| `Escape` | Exit focus → clear search → deselect |
| `Alt+Left/Right` | Navigate selection history |
| `1/2/3` | Toggle collection/request/model visibility |
| `T` | Toggle dark/light theme |
| `Shift+Click` | Shortest path between two nodes |

## Camera Configuration

| Setting | Value |
|---------|-------|
| `minCameraRatio` | `0.002` (deep zoom) |
| `maxCameraRatio` | `50` (far zoom out) |
| `hideEdgesOnMove` | `true` (performance) |
| `zIndex` | `true` (highlighted nodes on top) |
| Zoom animation | 200ms |
| Focus animation | 400ms |
| Reset animation | 300ms |

## What Is NOT Changing

- Rust backend (`graph_commands.rs`, `entity_graph.rs`) — zero changes
- Database schema — zero changes
- Clustering algorithm (Louvain + URL-prefix split + cluster spread)
- Query engine (regex pattern matching)
- Graph algorithms (community detection, centrality, shortest path)
- Position caching to SQLite
- The graph's data model (collections, requests, models, 7 edge types)
- GraphToolbar search/filter UI (just rewired to Sigma)
