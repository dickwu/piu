# Graph Engine Enhancement — Design Spec

**Date:** 2026-03-18
**Status:** Approved
**Scope:** Replace react-force-graph-3d with custom Graphology + React Three Fiber renderer, add GraphRAG intelligence layer

---

## Overview

PIU's 3D API & Model Map currently uses `react-force-graph-3d` (Three.js + d3-force-3d) for graph visualization. This spec redesigns the graph engine to support 1,000+ nodes with four enhancement areas: performance, discoverability, visual clutter reduction, and visual polish — plus an optional GraphRAG intelligence layer for natural-language graph exploration.

### Decision Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Data layer | Graphology | Richest JS graph algorithm library (Louvain, Dijkstra, centrality, subgraph ops) |
| Physics engine | ForceAtlas2 via Web Worker | Better clustering than d3-force; built-in `FA2LayoutSupervisor` for off-thread physics |
| Renderer | React Three Fiber + InstancedMesh | 3 draw calls for any graph size vs ~2N with current approach |
| 3D strategy | ForceAtlas2 2D + entity-type z-layering | Deterministic depth, cleaner visual separation than tangled 3D physics |
| GraphRAG | Phase 4 (optional, additive) | ~70% of useful queries answered by pure graph algorithms; LLM only for semantic matching |

---

## Section 1: Data Layer — Graphology Graph

### Current Flow

```
Rust build_graph() -> JSON {nodes[], edges[]} -> react-force-graph-3d consumes directly
```

### New Flow

```
Rust build_graph() -> JSON {nodes[], edges[]}
  -> graphology.Graph instance (frontend)
    -> algorithms (clustering, pathfinding, centrality)
    -> renderer reads positions from graphology
    -> SQLite cache unchanged (positions still saved via Rust)
```

### Graph Configuration

- **Graph type:** `graphology.Graph` (mixed, allows directed + undirected)
- **Location:** Frontend only. Rust backend still builds raw topology from DB.
- **Node attributes:** `entity_type`, `entity_id`, `label`, `properties`, `community`, `centrality`, `x`, `y`, `z`
- **Edge attributes:** `edge_type`, `label`, `color`, `width`, `community_crossing`

### New Capabilities

| Package | Purpose |
|---------|---------|
| `graphology` | Core graph data structure |
| `graphology-communities-louvain` | Auto-cluster into communities |
| `graphology-shortest-path` | Dijkstra between any two nodes |
| `graphology-metrics` | Betweenness centrality (node importance ranking) |
| `graphology-operators` | Subgraph extraction for filtering |
| `graphology-layout-forceatlas2` | Web Worker physics engine |

### What Stays the Same

- Rust `build_project_graph` command builds topology from DB
- SQLite `graph_nodes` / `graph_edges` tables unchanged
- Position caching via `save_graph_positions` unchanged

---

## Section 2: Physics Engine — ForceAtlas2 Web Worker

### Why ForceAtlas2 over d3-force

| | d3-force-3d (current) | ForceAtlas2 (proposed) |
|-|----------------------|----------------------|
| Designed for | Social networks | Any graph topology |
| Clustering behavior | Nodes drift apart | Naturally forms tight communities |
| Overlap prevention | None built-in | `adjustSizes` option |
| Gravity | Uniform pull to center | `strongGravityMode` prevents disconnected components flying away |
| Web Worker | Manual setup needed | Built-in `ForceSupervisor` |
| 3D | Native 3D | 2D only — extended with z-layering |

### 3D Strategy: ForceAtlas2 2D + Entity-Type Z-Layering

ForceAtlas2 runs in 2D (x, y). The z-axis is assigned deterministically based on entity type and community:

- Collections: z = 0 (center layer)
- Requests: z = +/- 50 (spread by collection membership)
- Models: z = +/- 100 (outer layer)

This creates a **layered 3D space** rather than a tangled 3D ball. FA2's 2D clustering is superior to d3-force's 3D, and the z-layering improves visual readability.

### Data Flow

```
graphology.Graph instance
    |
ForceSupervisor (Web Worker)
    | streams {nodeId: x, y} every ~16ms
Main thread: assign z from entity_type/community
    |
Update InstancedMesh matrices
    |
Three.js renders at 60fps
```

### Convergence + Caching

1. Worker starts, streams positions, renderer updates in real-time
2. Worker detects convergence (energy below threshold), stops
3. Main thread saves final `{x, y, z}` to SQLite via `save_graph_positions`
4. Next load: if cached positions exist, skip physics entirely

### FA2LayoutSupervisor Lifecycle

`graphology-layout-forceatlas2/worker` exports `FA2LayoutSupervisor` (default export). It internally spawns a Blob-URL Web Worker and writes x/y positions directly back into the graphology graph instance on every frame. There is no `postMessage` interface or `converged` event — convergence must be detected manually.

```typescript
import FA2Layout from 'graphology-layout-forceatlas2/worker';

// Create supervisor — it owns an internal Web Worker
const layout = new FA2Layout(graph, {
  settings: FA2Layout.inferSettings(graph),
});

layout.start(); // begins writing x/y to graph node attributes

// Read positions in rAF loop and push to renderer
function tick() {
  if (!layout.isRunning()) return;
  updateRendererFromGraph(graph);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// Convergence: stop after timeout (no built-in convergence callback)
const MAX_LAYOUT_MS = 10_000;
const timer = setTimeout(() => {
  layout.stop();
  cachePositionsToSQLite();
}, MAX_LAYOUT_MS);

// Cleanup on unmount / project switch (CRITICAL: prevents Blob URL leak)
function cleanup() {
  layout.kill();
  clearTimeout(timer);
}
```

**Cleanup contract:** `layout.kill()` MUST be called in `useEffect` return or equivalent when:
- The graph modal/panel unmounts (`destroyOnHidden`)
- The user switches projects while layout is running
- The component re-renders with a new `projectId` (kill old, create new)

Without this, each open/close cycle leaks a Blob URL Web Worker.

---

## Section 3: Renderer — Custom React Three Fiber with InstancedMesh

### Performance Comparison

| | Current (react-force-graph-3d) | Proposed (R3F InstancedMesh) |
|-|-------------------------------|------------------------------|
| Draw calls for 1,000 nodes | ~2,000+ (sphere + SpriteText each) | **3** (node mesh + label mesh + edge mesh) |
| Draw calls for 10,000 nodes | ~20,000+ (WebGL limit) | **3** (same) |
| Label rendering | SpriteText (canvas texture per node) | InstancedMesh with shared atlas texture |
| Post-processing | Not supported | `@react-three/postprocessing` (bloom, SSAO) |

### Scene Structure

```tsx
<Canvas>
  <ambientLight />
  <pointLight />

  {/* 1 draw call: all node spheres */}
  <instancedMesh ref={nodesMeshRef} args={[sphereGeo, nodeMaterial, nodeCount]} />

  {/* 1 draw call: all node labels (LOD-controlled) */}
  <LODLabels nodes={visibleNodes} cameraDistance={distance} />

  {/* 1 draw call: all edges as instanced cylinders */}
  <instancedMesh ref={edgesMeshRef} args={[cylinderGeo, edgeMaterial, edgeCount]} />

  {/* Directional arrows */}
  <EdgeArrows edges={directedEdges} />

  {/* Post-processing */}
  <EffectComposer>
    <Bloom luminanceThreshold={0.8} intensity={0.3} />
  </EffectComposer>

  <OrbitControls />
</Canvas>
```

### Node Rendering

- **Geometry:** Shared `SphereGeometry(1, 16, 16)` — size via scale in instance matrix
- **Color:** `InstancedBufferAttribute` of RGB per node — updated on community/filter change
- **Selection:** Emissive glow via material uniform
- **Hover:** `onPointerOver` changes cursor + shows tooltip overlay (React, not Three.js)

### Edge Rendering

- **Geometry:** Thin cylinder `CylinderGeometry(0.05, 0.05, 1, 4)` oriented source-to-target via lookAt matrix
- **Color:** Per-instance attribute matching `EDGE_STYLES`
- **Directional arrows:** Small cone InstancedMesh at `relPos=0.85`
- **Dashed edges:** Separate InstancedMesh with `LineDashedMaterial`
- **Curved edges:** The current `linkCurvature={0.15}` renders bezier curves. Instanced cylinders are straight — this is an intentional visual simplification. Curved edges would require per-edge `TubeGeometry` (not instanceable). Accept straight edges for the performance gain; revisit if visual feedback demands curves.

### LOD (Level of Detail) for Labels

| Camera distance | Renders |
|----------------|---------|
| < 200 units | Full labels (truncated 20 chars) + type markers |
| 200-500 units | Type marker only (C / M / GET / POST) |
| > 500 units | Colored spheres only |

### Interaction Mapping

| Current | New |
|---------|-----|
| `onNodeClick` -> MapDetailPanel | `onClick` on InstancedMesh -> resolve `instanceId` via stable index mapping -> MapDetailPanel |
| `onBackgroundClick` -> deselect | `onPointerMissed` on Canvas -> deselect |
| Node drag | `onPointerDown` + `onPointerMove` -> update graphology -> re-render |
| Orbit controls | `@react-three/drei` OrbitControls |

**InstancedMesh click detection notes:**
- Three.js raycasting on InstancedMesh returns `intersection.instanceId` (an integer index).
- A stable `nodeIndexToId: string[]` mapping must be maintained. This array maps the InstancedMesh matrix index to the graphology node ID. It must NOT be reshuffled between filter changes.
- When filters hide nodes (scale=0), `three >=0.152` correctly skips zero-scale instances in raycasting. Verify this is working since the project uses `three ^0.183.2`.
- R3F's `onClick` event delegation works on InstancedMesh — the event object includes `instanceId` on the intersection.

### Package Changes

**Add:**
```
@react-three/fiber
@react-three/drei
@react-three/postprocessing
```

**Remove:**
```
react-force-graph-3d
three-spritetext
```

---

## Section 4: Graph Algorithms — Clustering, Pathfinding, Filtering

### 4A: Community Detection (Clustering)

**Algorithm:** Louvain via `graphology-communities-louvain`

**When:** After graph data loads, before first render. Cached as node attributes.

```typescript
import louvain from 'graphology-communities-louvain';
louvain.assign(graph);
```

**Visual effect:**
- Each community gets a distinct hue (palette of 8-12 colors)
- Nodes tinted with community hue (blended with entity-type color)
- Cross-community edges dimmed (lower opacity)
- Optional: convex hull outlines around clusters (semi-transparent 3D shells)

**Community labels:** Floating text above cluster centroid — auto-generated from most common collection name + node counts.

**Stability note:** Louvain is stochastic — two runs on the same graph may produce different community IDs. To keep colors stable across sessions: sort communities by size (largest = community 0) and assign palette by that rank, not by raw community ID. Alternatively, cache community assignments in SQLite alongside node positions.

### 4B: Shortest Path

**Algorithm:** Dijkstra via `graphology-shortest-path`

**Trigger:** User selects two nodes (shift+click second), or search query "path from X to Y"

**Visual effect:**
- Path nodes + edges glow bright (emissive boost)
- Non-path nodes dim to 20% opacity
- Animated particle flow along path edges
- Detail panel shows path summary with hop count

### 4C: Centrality (Node Importance)

**Algorithm:** Betweenness centrality via `graphology-metrics/centrality/betweenness`

**When:** After graph loads, cached as node attribute.

**Performance note:** Betweenness centrality is O(V * E). On a 1,000-node, 3,000-edge graph this can take 300ms-1s. To avoid blocking the main thread:
- For graphs < 500 nodes: run synchronously (< 100ms)
- For graphs >= 500 nodes: use `scheduler.postTask` or `setTimeout(0)` chunking to yield to the event loop
- Alternative: use degree centrality (O(E), much faster) as a good approximation for most API graph shapes

Import path: `import betweennessCentrality from 'graphology-metrics/centrality/betweenness'`

**Visual effect:**
- Node size scales with centrality
- Search results sorted by importance
- Tooltip shows centrality rank

### 4D: Filtering

**Mechanism:** `graphology-operators` subgraph extraction + renderer visibility toggle.

| Filter | UI Control | Effect |
|--------|-----------|--------|
| Entity type | Toggle: Collection / Request / Model | Hide/show all of type |
| HTTP method | Checkboxes: GET / POST / PUT / DELETE / PATCH | Filter request nodes |
| Edge type | Checkboxes per edge style | Hide/show relationship types |
| Community | Click community label | Isolate that community |
| Search match | Text input with fuzzy match | Highlight matches, dim rest |

**Implementation:** A `visibleSet: Set<string>` derived from filter state. Renderer hides filtered nodes by setting instance scale to 0 (no InstancedMesh rebuild needed).

### 4E: Search + Highlight

Fuzzy text search over node labels + properties with highlighted results.

- Dropdown with matches grouped by entity type
- Keyboard: `Cmd+F` opens, `Enter` cycles matches, `Escape` clears
- Camera flies to selected match (300ms ease-in-out)
- Matched nodes pulse, non-matched dim to 25% opacity

---

## Section 5: Graph Toolbar — Search + Transport + Progressive Disclosure

### Design Philosophy: Progressive Clarity

Grounded in Apple HIG principles adapted for Tauri desktop:

> **HIG — Layout:** "Place items to convey their relative importance... make essential information easy to find."

> **HIG — Materials:** "Materials help visually separate foreground elements... establishing visual hierarchy."

> **HIG — Motion:** "Add motion purposefully... Aim for brevity and precision."

The 3D canvas is hero content. Controls float above with translucent materials, appearing secondary until needed. On hover, controls gain opacity and reveal labels — progressive disclosure through opacity, not layout shift.

### Toolbar Layout

```
[Search bar] ——————————— [Transport controls] —— [Filter toggles] —— [Settings]
```

**Material:** `backdrop-filter: blur(12px)`, `background: rgba(17, 19, 32, 0.6)` at rest -> `rgba(17, 19, 32, 0.88)` on hover. Border: `rgba(255,255,255,0.08)` -> `rgba(255,255,255,0.14)` on hover. Transition: 200ms ease-out.

### 5A: Search Bar

| Rule | Implementation | HIG Principle |
|------|---------------|---------------|
| Single location | One search bar, top-left | "Make content searchable through a single location" |
| Scope indicator | Placeholder: "Search collections, requests, models..." | "Clearly display the current scope" |
| Suggestions | Dropdown with fuzzy matches grouped by entity type | "Provide suggestions to make searching easier" |
| Keyboard | `Cmd+F` focuses, `Escape` clears | Desktop convention |
| Result cycling | `Enter` / `Shift+Enter` cycles matches | Standard find-next |

**Visual states:**
- **Idle:** 60% opacity, blurred bg, placeholder text
- **Focused:** 100% opacity, focus ring (accent color), recent searches dropdown
- **Typing:** Live results dropdown grouped by entity type with colored dots
- **Active match:** "2 of 5 matches" indicator with up/down arrows, camera flies to match

### 5B: Transport Controls

```
[Prev] [Home] [Next] [Reset]
```

| Button | Action | Keyboard |
|--------|--------|----------|
| Prev | Navigate back in selection history | `Alt+Left` |
| Home | Fit all nodes in view | `Cmd+0` |
| Next | Navigate forward in selection history | `Alt+Right` |
| Reset | Re-run layout (clear cached positions) | `Cmd+R` |

**Progressive disclosure:** Icons only at 50% opacity by default. On toolbar hover, labels fade in (150ms), opacity goes to 100%. Click feedback: brief opacity dip (100% -> 70% -> 100%, 100ms).

### 5C: Filter Toggles

- Default: Single letters `C R M` with colored dots, all active
- On hover: Full labels "Collections Requests Models + More"
- Toggled off: Strikethrough + dimmed
- "More" popover: HTTP method checkboxes, edge type checkboxes, community checkboxes

### 5D: Hover Interactions on Graph Nodes

Three concentric interaction zones:

| Zone | Trigger | Effect |
|------|---------|--------|
| **Far** (default) | No pointer near | Entity-type color, centrality-based size, LOD labels |
| **Near** (~40px) | Pointer approaching | Node brightens (+0.15 emissive), hidden labels fade in, neighbors brighten slightly, connected edges full opacity |
| **On** (directly over) | Pointer on node | Tooltip appears (name, type, method/fields), connected nodes get colored halos, unconnected nodes dim to 15% |

**Tooltip design:** Translucent material matching toolbar. Appears after 200ms hover delay. Shows: method badge + name, URL path (monospace), outgoing relationships.

**Click vs hover:** Hover previews (no panel change). Click opens MapDetailPanel (commits selection). Prevents disorienting constant panel shifts.

### 5E: Keyboard Navigation

| Shortcut | Action |
|----------|--------|
| `Cmd+F` | Focus search bar |
| `Escape` | Clear search / deselect / close panel |
| `Tab` | Cycle through nodes (by centrality rank) |
| `Enter` | Select focused node (opens detail panel) |
| `Alt+Left/Right` | Navigate selection history |
| `Cmd+0` | Fit all in view |
| `Cmd+R` | Re-run layout |
| `1` / `2` / `3` | Toggle Collection / Request / Model visibility |

---

## Section 6: GraphRAG Intelligence Layer (Phase 4)

### Architecture

```
User NL query -> Query classifier (local, no LLM)
  |
  +-- Structural query? -> graphology algorithm directly
  |     "path from login to user" -> Dijkstra
  |     "most connected model" -> centrality sort
  |
  +-- Semantic query? -> LLM interprets -> graph traversal
        "which endpoints handle authentication?" -> entity matching
  |
Results -> highlight nodes/edges + text summary in panel
```

### Query Routing

| Query Pattern | Route | LLM needed? |
|--------------|-------|-------------|
| "path from X to Y" | Dijkstra shortest path | No |
| "most connected / important nodes" | Betweenness centrality sort | No |
| "show cluster containing X" | Louvain community lookup | No |
| "which endpoints use model X" | Graph neighbor traversal | No |
| "what does this API do" | Community summaries | Yes (one-time gen) |
| "endpoints related to billing" | Semantic entity matching | Yes |
| "compare auth flow vs payment flow" | Multi-path + summary | Yes |

~70% of useful queries answered by pure graph algorithms.

### Community Summaries

Generated after Louvain clustering:
- **Without LLM:** "Cluster 1: 3 collections, 12 requests, 4 models (GET-heavy)"
- **With LLM:** "Authentication & session management - handles login, token refresh, and user verification"

Cached in SQLite. Re-generated only when graph topology changes.

### LLM Options

| Option | Pros | Cons |
|--------|------|------|
| **Claude API** | Best reasoning; no local infra | Requires internet; API cost |
| **Ollama sidecar** | Local; user controls model | User must install; variable quality |
| **No LLM** | Zero dependencies; instant | No NL semantic queries |

**Recommendation:** Ship without LLM (Phase 1-3). Add Claude API as default + optional Ollama for Phase 4.

---

## Phased Implementation

```
Phase 1: Core Graph Engine (foundation)
  - Replace react-force-graph-3d with R3F + InstancedMesh
  - Integrate graphology as data layer
  - ForceAtlas2 Web Worker (2D + z-layering)
  - Port existing interactions (click -> MapDetailPanel, legend)
  - Position caching (same SQLite flow)
  - Target: visual parity + 10x scale capacity

Phase 2: Algorithms + UX (discoverability + polish)
  - Louvain community detection + cluster coloring
  - Search bar with fuzzy match + result highlighting
  - Filter toggles (entity type, HTTP method, edge type)
  - Transport controls (prev/next/home/reset)
  - Hover progressive disclosure (tooltip, edge highlight, neighbor glow)
  - LOD labels
  - Path highlighting (shift+click two nodes)
  - Keyboard shortcuts
  - Target: full UX from Sections 4 + 5

Phase 3: Visual Polish (premium feel)
  - Bloom post-processing (behind a toggle — can degrade on integrated Intel GPUs)
  - Animated edge particles (flow direction)
  - Community hull outlines (3D shells)
  - Camera fly-to on search select
  - Minimap overlay
  - Target: production-quality visuals

Phase 4: GraphRAG Intelligence (optional)
  - NL query classifier
  - Community summary generation
  - Semantic entity matching
  - Temporal graph diff
  - Claude API + Ollama sidecar
  - Target: conversational graph exploration
```

**Dependencies:** Phase 1 blocks all others. Phase 4 can run parallel to Phases 2-3.

---

## File Changes

### Modified Files

| File | Change |
|------|--------|
| `src/app/components/apiModelMap/ForceGraph3DCanvas.tsx` | Rewrite as R3F component |
| `src/app/utils/graphDataTransform.ts` | Rewrite for graphology instance |
| `src/app/components/GraphCenterPanel.tsx` | Swap import; preserve `dynamic(() => import(...), { ssr: false })` wrapper for `GraphCanvas` |
| `src/app/components/apiModelMap/ApiModelMapFlow.tsx` | Swap `ForceGraph3DCanvas` import |
| `package.json` | Add graphology/R3F deps, remove react-force-graph-3d + three-spritetext. Note: `three` and `@types/three` already present — do not re-add. |
| `src/app/stores/layoutComputeStore.ts` | **Remove** — replaced by `graphStore.ts` which manages `isComputing` state |

### Kept Files

| File | Notes |
|------|-------|
| `src/app/utils/apiModelMapLayout.ts` | Edge styles + node data types still used |
| `src/app/components/apiModelMap/MapDetailPanel.tsx` | Unchanged, same props |
| `src/app/components/apiModelMap/MapLegend.tsx` | Enhanced with community colors |
| `src-tauri/src/commands/graph_commands.rs` | Rust graph builder unchanged |
| `src-tauri/src/db/graph.rs` | SQLite schema unchanged |

### New Files

```
# Phase 1
src/app/stores/graphStore.ts              -- graphology instance + Zustand wrapper (in stores/ per project convention)
src/app/components/graph/GraphCanvas.tsx  -- R3F Canvas + InstancedMesh renderer (MUST use dynamic(ssr:false) wrapper)
src/app/components/graph/GraphNodes.tsx   -- InstancedMesh node renderer
src/app/components/graph/GraphEdges.tsx   -- InstancedMesh edge renderer
src/app/utils/graphDataTransform.ts      -- (rewrite) transforms Rust JSON into graphology instance

# Phase 2
src/app/utils/graphAlgorithms.ts         -- clustering, pathfinding, centrality, filtering
src/app/components/graph/GraphLabels.tsx  -- LOD label renderer
src/app/components/graph/GraphToolbar.tsx -- Search + transport + filters
src/app/components/graph/GraphTooltip.tsx -- Hover tooltip overlay

# Phase 3
src/app/components/graph/GraphMinimap.tsx -- Minimap overlay
```

**SSR note:** `GraphCanvas.tsx` uses Three.js / R3F which access `window` at import time. It MUST be wrapped with `dynamic(() => import('./graph/GraphCanvas'), { ssr: false })` in `GraphCenterPanel.tsx` and `ApiModelMapFlow.tsx`, exactly as the current `ForceGraph3DCanvas` is.

**R3F peer dep note:** `@react-three/fiber@9.x` requires `react >=19 <19.3`. The project's `react ^19.2.4` satisfies this today. Document this constraint so future React upgrades don't break the graph.

---

## References

- [Graphology standard library](https://graphology.github.io/standard-library/)
- [Graphology Louvain communities](https://graphology.github.io/standard-library/communities-louvain.html)
- [Graphology ForceAtlas2 + Web Worker](https://graphology.github.io/standard-library/layout-forceatlas2.html)
- [Three.js InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html)
- [React Three Fiber](https://r3f.docs.pmnd.rs/)
- [Microsoft GraphRAG](https://microsoft.github.io/graphrag/)
- [LightRAG](https://github.com/HKUDS/LightRAG)
- [Graphiti temporal knowledge graphs](https://github.com/getzep/graphiti)
- [d3-force-reuse](https://twosixtech.com/blog/faster-force-directed-graph-layouts-by-reusing-force-approximations/)
- [Graph visualization UX best practices](https://cambridge-intelligence.com/graph-visualization-ux-how-to-avoid-wrecking-your-graph-visualization/)
- [cosmos.gl GPU graph engine](https://github.com/cosmosgl/graph)
- Apple HIG: Searching, Layout, Materials, Motion, Feedback, Focus and Selection, Color
