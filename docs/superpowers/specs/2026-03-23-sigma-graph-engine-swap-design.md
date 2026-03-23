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

### Unchanged
- `graphology`, `graphology-types` — Graph data structure
- `graphology-layout-forceatlas2` — Layout algorithm (web worker)
- `graphology-layout-noverlap` — Overlap removal
- `graphology-communities-louvain` — Community detection
- `graphology-shortest-path` — Path finding
- All other existing graphology utilities

## File Map

### Deleted (5 files)
| File | Reason |
|------|--------|
| `src/app/components/graph/GraphClusterMetaballs.tsx` | GLSL SDF shader replaced by community coloring in reducers |
| `src/app/components/graph/GraphStubEdges.tsx` | R3F stub edge cylinders; focus mode hides cross-cluster edges via reducer |
| `src/app/components/graph/GraphNodes.tsx` | InstancedMesh sphere rendering replaced by Sigma NodeCircleProgram |
| `src/app/components/graph/GraphEdges.tsx` | InstancedMesh cylinder rendering replaced by @sigma/edge-curve |
| `src/app/components/graph/GraphMinimap.tsx` | Canvas 2D minimap coupled to R3F coordinates; rebuild later if needed |

### Created (3 files)
| File | Purpose |
|------|---------|
| `src/app/hooks/useSigma.ts` | Core hook: Sigma initialization, layout lifecycle, reducers, camera control, events |
| `src/app/utils/graphConstants.ts` | Color palettes, size hierarchy, edge styles, animation config (from GitNexus pattern) |
| `src/app/components/graph/GraphClusterLabels.tsx` | React component rendering HTML overlay labels at cluster centroids; listens to Sigma camera events to reposition |

### Rewritten (2 files)
| File | Change |
|------|--------|
| `src/app/components/graph/GraphCanvas.tsx` | R3F `<Canvas>` replaced with Sigma container div + overlay UI; wires graphStore to useSigma; renders `<GraphClusterLabels>` in overview mode; shows `<Spin>` during layout and error state on WebGL failure |
| `src/app/stores/graphStore.ts` | Remove R3F-specific fields (see GraphStore Changes section); add `visibleEdgeTypes` |

### Modified (5 files)
| File | Change |
|------|--------|
| `src/app/components/graph/GraphToolbar.tsx` | Rewire zoom/layout/reset controls to Sigma camera API via `SigmaControls` |
| `src/app/components/graph/GraphTooltip.tsx` | Sigma enterNode/leaveNode events instead of R3F pointerOver/pointerOut |
| `src/app/utils/graphDataTransform.ts` | Remove `z: 0` attribute from nodes; stop populating `fz` in `extractPositionsForSave` (keep field as `null` for backward compat); no other changes — `x`, `y`, `size`, `color` are already set as graphology attributes |
| `src/app/utils/graphClustering.ts` | After cluster assignment, write `communityColor` attribute to each node in graphology. This runs after `buildGraphologyInstance()` and before `sigma.setGraph()` |
| `src/app/utils/graphThemeConfig.ts` | Remove blob-specific fields (`blobFillAlpha`, `blobStrokeAlpha`, `bloomAvailable`). Keep `background`, `edgeColor`, `labelColor`, `clusterPalette` fields. Both `DARK_THEME` and `LIGHT_THEME` configs remain; Sigma reads `graphTheme` from store to determine dimming target and label colors |
| `src/app/utils/graphColorUtils.ts` | Keep file. Update `dimColor` to use theme background from `graphThemeConfig` (dark: `#111320`, light: `#f3f4f6`). `brightenColor` stays unchanged. Both functions are imported by `useSigma` reducers |

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

1. **Sigma lifecycle** — Create instance on mount. Set graph when available. Destroy on unmount: terminate FA2 worker first (to stop position writes), then destroy Sigma instance. If WebGL context is unavailable, set `graphStore.graphError` to display an error overlay in GraphCanvas.

2. **Node reducer** — Called per-node per-frame by Sigma. Priority chain (first match wins):
   - **(a) Hidden check** — filtered by `visibleEntityTypes` or `visibleNodeIds`
   - **(b) Active animation** — pulse/ripple/glow with sine oscillation on size/color
   - **(c) Cluster focus mode** — focused cluster nodes visible, all others `hidden: true`
   - **(d) Path highlight** — `pathNodeIds` set: path nodes get golden color `#f59e0b` + 1.6x size, non-path nodes dimmed
   - **(e) Blast radius mode** — `blastRadiusNodeIds`: blast nodes red + 1.8x, `highlightedNodeIds` cyan + 1.4x, rest dimmed to 15% + 0.4x
   - **(f) Highlight mode** — `highlightedNodeIds` only: highlighted nodes cyan + 1.6x, rest dimmed to 20% + 0.5x
   - **(g) Selection mode** — selected node full color + 1.8x, neighbors full color + 1.3x, rest dimmed to 25% + 0.6x
   - **(h) Default** — node renders at base color and size from graphology attributes

   Dimming uses `dimColor(hex, amount, theme)` from `graphColorUtils.ts`, blending toward the current theme background.

3. **Edge reducer** — Called per-edge per-frame. Priority chain:
   - **(a) Type visibility filter** — `visibleEdgeTypes`
   - **(b) Cluster focus** — intra-cluster edges visible, cross-cluster edges hidden
   - **(c) Path highlight** — edges connecting consecutive path nodes: golden + 3x width
   - **(d) Highlight/blast radius** — both endpoints highlighted: bright color + 3x; one endpoint: dim cyan + 1x; neither: very dim 0.2x
   - **(e) Selection** — connected to selected: brightened color + 4x; unconnected: very dim 0.3x

4. **ForceAtlas2 lifecycle** — Start worker on graph set, stop after 15s timeout, run Noverlap post-pass, run cluster spread, cache positions via `invoke('save_graph_positions')`. Cleanup: the `useEffect` cleanup function terminates the FA2 worker supervisor first, then destroys the Sigma instance. This prevents multiple concurrent layout workers during Next.js hot reload.

5. **Camera animation** — `focusNode(id)` animates to node at ratio 0.15 over 400ms. `focusCluster(id)` computes bounding box, animates to center. `resetView()` animated reset.

6. **Event handlers** — clickNode (select or focus cluster depending on mode), clickStage (deselect), enterNode (tooltip), leaveNode (hide tooltip).

7. **Animation loop** — `requestAnimationFrame` loop calling `sigma.refresh()` while any animation is active. Stops when `animatedNodes` map is empty.

**Returns:** `{ zoomIn, zoomOut, resetView, focusNode, focusCluster, restartLayout, sigmaRef }`

The raw `sigma` instance is NOT exposed as a direct value. Instead, `useSigma` returns a `sigmaRef: RefObject<Sigma | null>` populated internally when Sigma initializes. This ref is the only access point — it is passed from `GraphCanvas` to `GraphClusterLabels` for `graphToViewport()` coordinate conversion. All other camera and rendering operations go through the named control functions.

### Sigma Configuration

```typescript
const sigma = new Sigma(graph, container, {
  allowInvalidContainer: true,
  zIndex: true,
  hideEdgesOnMove: true,
  minCameraRatio: 0.002,
  maxCameraRatio: 50,
  defaultNodeType: 'circle',
  defaultEdgeType: 'curve',
  nodeProgramClasses: { circle: NodeCircleProgram },
  edgeProgramClasses: { curve: EdgeCurveProgram },
  nodeReducer,
  edgeReducer,
})
```

### Error Handling

If Sigma fails to initialize (WebGL context unavailable, container ref null):
- `useSigma` catches the error and sets `graphStore.graphError: string | null`
- `GraphCanvas` renders an error overlay with the message (replaces the current `ERROR_OVERLAY_STYLE` pattern from R3F)
- Layout and event handlers are no-ops when `sigma` is null

### Node Rendering

Sigma's default `NodeCircleProgram` (WebGL circles):

| Entity Type | Color | Base Size |
|-------------|-------|-----------|
| `collection` | `#fbbf24` (amber) | `8 + sqrt(requestCount)` |
| `request` | HTTP method color (GET `#34d399`, POST `#fbbf24`, PUT `#60a5fa`, DELETE `#f87171`, PATCH `#a78bfa`) | `5` |
| `model` | `#4a9eff` (blue) | `5 + fieldCount * 0.3` |

In overview mode, node colors are overridden by community color (12-color cycling palette from `graphThemeConfig`).

### Edge Rendering

`EdgeCurveProgram` from `@sigma/edge-curve`:
- Base curvature: `0.15`
- Colors by edge type (same palette as current)
- Width scaled by type importance: `col-subcol` thinnest, `model-inherits` thickest

### Dimming

`dimColor(hex, amount, theme)` from `graphColorUtils.ts`:
- Dark theme: blends toward `#111320`
- Light theme: blends toward `#f3f4f6`
- Imported by `useSigma` reducers. Theme determined by `graphStore.graphTheme`.

### Cluster Navigation

**Overview mode** (`clusterMode === 'overview'`):
- Node reducer overrides color to community color, scales size 0.8x
- `GraphClusterLabels` component renders positioned HTML divs at each cluster centroid
- Labels repositioned on Sigma `afterRender` event via `sigma.graphToViewport(centroidX, centroidY)`
- Click any node triggers `setFocusedClusterId(node.clusterId)` + camera animate to cluster bbox

**Focus mode** (`clusterMode === 'focus'`):
- Node reducer: focused cluster nodes at full color/size, others `hidden: true`
- Edge reducer: intra-cluster edges visible, cross-cluster edges hidden
- Escape key returns to overview mode

**Off mode** (`clusterMode === 'off'`):
- Standard selection/highlight behavior, no community color overrides

### GraphClusterLabels Component

New component: `src/app/components/graph/GraphClusterLabels.tsx`

Renders when `clusterMode === 'overview'`. Receives `sigmaRef` from `GraphCanvas`.

- Reads `clusters` map from `graphStore`
- On Sigma `afterRender` event, converts each cluster centroid from graph coordinates to viewport pixels via `sigma.graphToViewport()`
- Renders absolutely positioned `<div>` labels with cluster name, node count, and community color
- Labels hidden when off-screen or when camera ratio exceeds threshold (too far out)

### Animation System

Driven by `requestAnimationFrame` loop calling `sigma.refresh()`:

| Animation | Color | Duration | Size Effect | Trigger |
|-----------|-------|----------|-------------|---------|
| `pulse` | `#06b6d4` (cyan) | 2000ms | 1.5x + 0.8x sine oscillation | Search results |
| `ripple` | `#ef4444` (red) | 3000ms | 1.3x + 1.2x sine oscillation | Blast radius |
| `glow` | `#a855f7` (purple) | 4000ms | 1.4x + 0.6x sine oscillation | Query highlights |

Auto-cleanup: animations are removed from `animatedNodes` map after their duration expires. The `requestAnimationFrame` loop only runs while `animatedNodes.size > 0`.

### GraphStore Changes

**Removed fields:**
- `nodeIndexToId: string[]` / `setNodeIndexToId` — R3F InstancedMesh hit-testing index; Sigma handles hit-testing internally
- `fitViewRequested` / `requestFitView` / `clearFitView` — replaced by direct `SigmaControls.resetView()` calls
- `preFocusZoom` / `preFocusPosition` / `setPreFocusState` — Sigma camera state is internal; focus/unfocus handled by `useSigma` saving/restoring camera state in a ref
- `bloomEnabled` / `setBloomEnabled` — bloom is dropped
- `focusOverrideNodeIds` / `setFocusOverrideNodeIds` — merged into `highlightedNodeIds` (same visual effect)

**Kept state (unchanged):**
- `graph: Graph | null`
- `selectedNodeId: string | null`
- `hoveredNodeId: string | null`
- `highlightedNodeIds: Set<string> | null`
- `blastRadiusNodeIds: Set<string> | null`
- `pathNodeIds: Set<string> | null`
- `animatedNodes: Map<string, Animation>`
- `clusterMode: 'off' | 'overview' | 'focus'`
- `focusedClusterId: string | null`
- `clusters: Map<string, ClusterInfo>`
- `communities: CommunityInfo[]`
- `visibleEntityTypes: Set<string>`
- `visibleNodeIds: Set<string> | null`
- `searchQuery: string`
- `selectionHistory: string[]`
- `graphTheme: 'dark' | 'light'`

**New state:**
- `visibleEdgeTypes: Set<string>` — Edge type filter (currently implicit, now explicit)
- `graphError: string | null` — Sigma initialization error message

## Data Flow

```
Rust backend (zero changes)
    |  invoke('build_project_graph')
    v
graphDataTransform.ts — buildGraphologyInstance()
    |  Sets x, y, size, color, label, entityType on each node
    |  (x, y, size, color ALREADY set in current code; only change: remove z attribute)
    v
graphClustering.ts — assignClusters(graph)
    |  Runs Louvain + URL-prefix split + cluster spread
    |  Writes communityColor attribute to each node in graphology
    v
graphStore.setGraph(graph)
    |  graph now has all attributes Sigma needs
    v
useSigma hook — sigma.setGraph(graph)
    |  ForceAtlas2 worker starts → positions update in graphology → Sigma re-renders
    |  nodeReducer / edgeReducer read graphStore state → apply visual overrides
    v
Sigma WebGL canvas
    |  Events: clickNode, enterNode, clickStage
    v
graphStore actions (setSelectedNodeId, setHoveredNodeId, etc.)
    |  Store update → sigma.refresh() → reducers re-evaluate → canvas re-renders
```

**Key sequencing:** `communityColor` is written to graphology BEFORE `sigma.setGraph()`. This ensures the node reducer can read community colors from the first frame. If clustering runs asynchronously (e.g., for very large graphs), the reducer falls back to the node's base entity type color until `communityColor` is available, then `sigma.refresh()` is called after clustering completes.

## Theme Support

Both dark and light themes remain fully supported:

- `graphThemeConfig.ts` provides `DARK_THEME` and `LIGHT_THEME` objects
- Blob-specific fields (`blobFillAlpha`, `blobStrokeAlpha`, `bloomAvailable`) are removed
- Remaining fields: `background`, `edgeColor`, `edgeOpacity`, `labelColor`, `labelSize`, `clusterPalette` (24 colors)
- Sigma container background set via CSS to `theme.background`
- `dimColor()` reads the active theme to determine the blend target color
- `T` keyboard shortcut toggles `graphStore.graphTheme`, triggering `sigma.refresh()` which re-evaluates all reducers with the new theme

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
