# Sigma.js v3 Graph Engine Swap — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace React Three Fiber graph rendering with Sigma.js v3, porting GitNexus's reducer-based architecture while preserving all PIU graph features (clustering, animations, highlights, keyboard shortcuts).

**Architecture:** Sigma.js v3 handles WebGL rendering via node/edge reducers that read Zustand state. A `useSigma` hook owns the Sigma lifecycle, ForceAtlas2 layout, camera control, and event handlers. The existing graphology data pipeline (Rust → graphDataTransform → graphAlgorithms → graphClustering) is unchanged.

**Tech Stack:** sigma v3, @sigma/edge-curve, graphology (existing), ForceAtlas2 (existing), Zustand 5 (existing), React 19 (existing)

**Spec:** `docs/superpowers/specs/2026-03-23-sigma-graph-engine-swap-design.md`

**Codex findings incorporated:**
1. Route generic query highlights to `highlightedNodeIds`; reserve `pathNodeIds` for `QueryResult.type === 'path'` only
2. Defer `spreadClusters()` until after FA2 layout completes (stamp `communityColor` pre-render, centroids post-layout)
3. Keep community assignment in `graphAlgorithms.ts` (single canonical source)
4. Seed random `x/y` for fresh graphs before `sigma.setGraph()`
5. Keep `fz: 0` (not null) in `extractPositionsForSave`
6. Stub edges in focus mode: accepted regression (not implemented)
7. Keep `filters` object as single source of truth for visibility
8. Use `sigma.graphToViewport({ x, y })` object form

**No test infrastructure exists in this project.** Verification is via `bun tauri dev` build check and manual visual inspection.

---

## File Map

### Delete (5 files)
- `src/app/components/graph/GraphClusterMetaballs.tsx`
- `src/app/components/graph/GraphStubEdges.tsx`
- `src/app/components/graph/GraphNodes.tsx`
- `src/app/components/graph/GraphEdges.tsx`
- `src/app/components/graph/GraphMinimap.tsx`

### Create (3 files)
- `src/app/utils/graphConstants.ts` — Color palettes, sizes, edge styles, animation config
- `src/app/hooks/useSigma.ts` — Core hook: Sigma init, reducers, layout, camera, events
- `src/app/components/graph/GraphClusterLabels.tsx` — Cluster label overlays

### Rewrite (2 files)
- `src/app/components/graph/GraphCanvas.tsx` — R3F Canvas → Sigma container
- `src/app/stores/graphStore.ts` — Remove R3F fields, add graphError + visibleEdgeTypes

### Modify (4 files)
- `src/app/utils/graphDataTransform.ts` — Remove `z: 0`, seed random positions
- `src/app/utils/graphThemeConfig.ts` — Remove blob fields
- `src/app/components/graph/GraphToolbar.tsx` — Rewire to SigmaControls
- `src/app/components/graph/GraphTooltip.tsx` — Sigma events instead of R3F

---

### Task 1: Swap Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Remove R3F packages**

```bash
cd /Users/gwddeveloper/opensource/piu
bun remove @react-three/fiber @react-three/drei @react-three/postprocessing three postprocessing
```

- [ ] **Step 2: Remove R3F type packages**

```bash
bun remove @types/three
```

- [ ] **Step 3: Add Sigma packages**

```bash
bun add sigma@^3 @sigma/edge-curve@^3
```

- [ ] **Step 4: Verify package.json**

Confirm `package.json` no longer has `three`, `@react-three/*`, `postprocessing`, `@types/three`. Confirm `sigma` and `@sigma/edge-curve` are present.

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: swap R3F dependencies for Sigma.js v3"
```

---

### Task 2: Create graphConstants.ts

**Files:**
- Create: `src/app/utils/graphConstants.ts`

This file consolidates all graph visual constants in one place (GitNexus pattern).

- [ ] **Step 1: Create the constants file**

```typescript
// src/app/utils/graphConstants.ts
// Consolidated visual constants for graph rendering (GitNexus pattern)

// --- Animation Config ---
export const ANIMATION_CONFIG = {
  pulse:  { color: '#06b6d4', duration: 2000, baseScale: 1.5, oscillation: 0.8 },
  ripple: { color: '#ef4444', duration: 3000, baseScale: 1.3, oscillation: 1.2 },
  glow:   { color: '#a855f7', duration: 4000, baseScale: 1.4, oscillation: 0.6 },
} as const

export type AnimationTypeName = keyof typeof ANIMATION_CONFIG

// --- Node Size Multipliers (reducer) ---
export const NODE_SIZE = {
  selected: 1.8,
  selectedNeighbor: 1.3,
  pathHighlight: 1.6,
  blastRadius: 1.8,
  blastHighlight: 1.4,
  highlight: 1.6,
  overviewScale: 0.8,
  dimmed: {
    blastRadius: 0.4,
    highlight: 0.5,
    selection: 0.6,
  },
} as const

// --- Dim Amounts (0 = fully dimmed to background, 1 = full color) ---
export const DIM_AMOUNT = {
  blastRadius: 0.15,
  highlight: 0.20,
  selection: 0.25,
} as const

// --- Edge Width Multipliers (reducer) ---
export const EDGE_WIDTH = {
  pathHighlight: 3,
  highlightBoth: 3,
  highlightOne: 1,
  highlightNeither: 0.2,
  selectionConnected: 4,
  selectionDisconnected: 0.3,
} as const

// --- Path Highlight ---
export const PATH_HIGHLIGHT_COLOR = '#f59e0b'

// --- Sigma Camera ---
export const CAMERA = {
  minRatio: 0.002,
  maxRatio: 50,
  zoomDuration: 200,
  focusDuration: 400,
  resetDuration: 300,
  focusRatio: 0.15,
} as const

// --- Edge Curve ---
export const EDGE_CURVATURE = 0.15

// --- ForceAtlas2 ---
export const FA2_TIMEOUT_MS = 15_000
export const FA2_SCALING_MULTIPLIER = 3
export const FA2_GRAVITY_MULTIPLIER = 0.5
export const NOVERLAP_MAX_ITERATIONS = 200
export const NOVERLAP_MARGIN = 14
```

- [ ] **Step 2: Commit**

```bash
git add src/app/utils/graphConstants.ts
git commit -m "feat: add graphConstants.ts with consolidated visual config"
```

---

### Task 3: Update graphStore.ts

**Files:**
- Modify: `src/app/stores/graphStore.ts`

Remove R3F-specific fields, add `graphError` and `visibleEdgeTypes`. Keep `filters` as the source of truth. Keep `selectionHistoryIndex`.

- [ ] **Step 1: Remove R3F fields from interface and implementation**

Remove these fields and their setters from both the `GraphStore` interface (lines 49-50, 91-97, 109-114) and the store implementation (lines 147-148, 207-214, 226-231):
- `nodeIndexToId` / `setNodeIndexToId`
- `bloomEnabled` / `setBloomEnabled`
- `fitViewRequested` / `requestFitView` / `clearFitView`
- `focusOverrideNodeIds` / `setFocusOverrideNodeIds`
- `preFocusZoom` / `preFocusPosition` / `setPreFocusState`

- [ ] **Step 2: Add new fields to interface**

Add to the `GraphStore` interface:

```typescript
  // --- Sigma state ---
  graphError: string | null;
  setGraphError: (error: string | null) => void;

  visibleEdgeTypes: Set<string>;
  setVisibleEdgeTypes: (types: Set<string>) => void;
```

- [ ] **Step 3: Add new fields to implementation**

Add to the store:

```typescript
  // Sigma state
  graphError: null,
  setGraphError: (error) => set({ graphError: error }),

  visibleEdgeTypes: new Set(['col-subcol', 'col-request', 'req-reqModel', 'req-resModel', 'model-inherits', 'model-mixin', 'model-fieldRef']),
  setVisibleEdgeTypes: (types) => set({ visibleEdgeTypes: types }),
```

- [ ] **Step 4: Verify no TypeScript errors in this file**

```bash
cd /Users/gwddeveloper/opensource/piu && npx tsc --noEmit src/app/stores/graphStore.ts 2>&1 | head -20
```

Note: Build will have errors from files that import removed fields — those are fixed in later tasks.

- [ ] **Step 5: Commit**

```bash
git add src/app/stores/graphStore.ts
git commit -m "refactor: remove R3F-specific fields from graphStore, add Sigma state"
```

---

### Task 4: Update graphDataTransform.ts

**Files:**
- Modify: `src/app/utils/graphDataTransform.ts`

Remove `z: 0` from node attributes. Seed random `x/y` for nodes without cached positions. Keep `fz: 0` in position save.

- [ ] **Step 1: Remove z attribute from addNode (line 100)**

Change `graph.addNode` call at line 91-101 — remove `z: 0`:

```typescript
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
```

- [ ] **Step 2: Add seedRandomPositions helper**

Add after `buildGraphologyInstance`:

```typescript
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
```

- [ ] **Step 3: Keep fz: 0 in extractPositionsForSave (line 158)**

Change line 158 to always emit `fz: 0`:

```typescript
        fz: 0,
```

- [ ] **Step 4: Commit**

```bash
git add src/app/utils/graphDataTransform.ts
git commit -m "refactor: remove z attr, add seedRandomPositions, fix fz to 0"
```

---

### Task 5: Update graphThemeConfig.ts

**Files:**
- Modify: `src/app/utils/graphThemeConfig.ts`

Remove blob-specific fields from the interface and both theme objects.

- [ ] **Step 1: Remove blob fields from interface (lines 11-14)**

Remove from `GraphThemeConfig`:
- `blobFillAlpha: number`
- `blobStrokeAlpha: number`
- `blobStrokeWidth: number`
- `bloomAvailable: boolean`

- [ ] **Step 2: Remove blob fields from DARK_THEME (lines 42-45)**

Remove:
```
  blobFillAlpha: 0.04,
  blobStrokeAlpha: 0.18,
  blobStrokeWidth: 1.2,
  bloomAvailable: true,
```

- [ ] **Step 3: Remove blob fields from LIGHT_THEME (lines 57-60)**

Remove the same four fields from `LIGHT_THEME`.

- [ ] **Step 4: Commit**

```bash
git add src/app/utils/graphThemeConfig.ts
git commit -m "refactor: remove blob/bloom fields from graph theme config"
```

---

### Task 6: Delete R3F Component Files

**Files:**
- Delete: `src/app/components/graph/GraphClusterMetaballs.tsx`
- Delete: `src/app/components/graph/GraphStubEdges.tsx`
- Delete: `src/app/components/graph/GraphNodes.tsx`
- Delete: `src/app/components/graph/GraphEdges.tsx`
- Delete: `src/app/components/graph/GraphMinimap.tsx`

- [ ] **Step 1: Delete all 5 files**

```bash
cd /Users/gwddeveloper/opensource/piu
rm src/app/components/graph/GraphClusterMetaballs.tsx
rm src/app/components/graph/GraphStubEdges.tsx
rm src/app/components/graph/GraphNodes.tsx
rm src/app/components/graph/GraphEdges.tsx
rm src/app/components/graph/GraphMinimap.tsx
```

- [ ] **Step 2: Commit**

```bash
git add -A src/app/components/graph/GraphClusterMetaballs.tsx \
           src/app/components/graph/GraphStubEdges.tsx \
           src/app/components/graph/GraphNodes.tsx \
           src/app/components/graph/GraphEdges.tsx \
           src/app/components/graph/GraphMinimap.tsx
git commit -m "refactor: delete R3F graph rendering components"
```

---

### Task 7: Create useSigma Hook

**Files:**
- Create: `src/app/hooks/useSigma.ts`

This is the core hook — Sigma lifecycle, node/edge reducers, ForceAtlas2 layout, camera animation, event handlers. Port from GitNexus pattern, adapted for PIU data model.

- [ ] **Step 1: Create the hook file**

Create `src/app/hooks/useSigma.ts`. The hook signature:

```typescript
import { useEffect, useRef, useCallback, type RefObject } from 'react'
import Sigma from 'sigma'
import { NodeCircleProgram } from 'sigma/rendering'
import { EdgeCurveProgram } from '@sigma/edge-curve'
import Graph from 'graphology'
import FA2LayoutSupervisor from 'graphology-layout-forceatlas2/worker'
import { inferSettings } from 'graphology-layout-forceatlas2'
import noverlap from 'graphology-layout-noverlap'
import { invoke } from '@tauri-apps/api/core'

import { useGraphStore } from '../stores/graphStore'
import { dimColor, brightenColor } from '../utils/graphColorUtils'
import { getGraphTheme } from '../utils/graphThemeConfig'
import {
  hasCachedPositions,
  extractPositionsForSave,
  seedRandomPositions,
} from '../utils/graphDataTransform'
import { spreadClusters } from '../utils/graphClustering'
import {
  ANIMATION_CONFIG,
  NODE_SIZE,
  DIM_AMOUNT,
  EDGE_WIDTH,
  PATH_HIGHLIGHT_COLOR,
  CAMERA,
  EDGE_CURVATURE,
  FA2_TIMEOUT_MS,
  FA2_SCALING_MULTIPLIER,
  FA2_GRAVITY_MULTIPLIER,
  NOVERLAP_MAX_ITERATIONS,
  NOVERLAP_MARGIN,
} from '../utils/graphConstants'

export interface SigmaControls {
  zoomIn: () => void
  zoomOut: () => void
  resetView: () => void
  focusNode: (nodeId: string) => void
  focusCluster: (clusterId: string) => void
  restartLayout: () => void
  sigmaRef: RefObject<Sigma | null>
}
```

- [ ] **Step 2: Implement Sigma initialization with error handling**

Inside the hook, create and destroy Sigma in a `useEffect`:
- Create Sigma with `NodeCircleProgram` and `EdgeCurveProgram`
- Catch WebGL errors, set `graphStore.setGraphError()`
- Cleanup: terminate FA2 supervisor first, then kill Sigma
- Set `sigmaRef.current` on success

Key config (from spec):
```typescript
const sigma = new Sigma(graph, container, {
  allowInvalidContainer: true,
  zIndex: true,
  hideEdgesOnMove: true,
  minCameraRatio: CAMERA.minRatio,
  maxCameraRatio: CAMERA.maxRatio,
  defaultNodeType: 'circle',
  defaultEdgeType: 'curve',
  nodeProgramClasses: { circle: NodeCircleProgram },
  edgeProgramClasses: { curve: EdgeCurveProgram },
  nodeReducer,
  edgeReducer,
})
```

- [ ] **Step 3: Implement nodeReducer**

Priority chain (first match wins):
1. Hidden check — `filters.showCollections/showRequests/showModels` + `visibleNodeIds`
2. Active animation — read `animatedNodes`, compute sine oscillation
3. Cluster focus — show focused cluster, hide rest
4. Path highlight — `pathNodeIds` (path-only, not generic queries): golden `#f59e0b` + 1.6x
5. Blast radius — red + cyan + dim
6. Highlight — cyan + dim
7. Selection — selected + neighbors bright, rest dim
8. Default — pass through

Use `dimColor(color, amount, graphTheme)` for all dimming. Read theme from `graphStore.graphTheme`.

- [ ] **Step 4: Implement edgeReducer**

Priority chain:
1. Type filter — `visibleEdgeTypes`
2. Cluster focus — intra-cluster visible, cross-cluster hidden
3. Path highlight — golden + 3x width for consecutive path edges
4. Highlight/blast — both endpoints = bright, one = dim, neither = very dim
5. Selection — connected = bright + 4x, not connected = very dim

- [ ] **Step 5: Implement ForceAtlas2 lifecycle**

```
graph set → seedRandomPositions() if no cached positions
          → FA2 worker start (inferSettings * scaling/gravity)
          → setTimeout(FA2_TIMEOUT_MS) → worker.stop()
          → noverlap.assign(graph, { maxIterations, margin })
          → spreadClusters(graph, clusters) [AFTER layout, per Codex #2]
          → extractPositionsForSave → invoke('save_graph_positions')
          → sigma.refresh()
```

- [ ] **Step 6: Implement camera control functions**

```typescript
const zoomIn = () => sigma?.camera.animatedZoom({ duration: CAMERA.zoomDuration })
const zoomOut = () => sigma?.camera.animatedUnzoom({ duration: CAMERA.zoomDuration })
const resetView = () => sigma?.camera.animatedReset({ duration: CAMERA.resetDuration })

const focusNode = (nodeId: string) => {
  if (!sigma || !graph.hasNode(nodeId)) return
  const attrs = graph.getNodeAttributes(nodeId)
  sigma.camera.animate(
    { x: attrs.x, y: attrs.y, ratio: CAMERA.focusRatio },
    { duration: CAMERA.focusDuration }
  )
}

const focusCluster = (clusterId: string) => {
  // compute bounding box of cluster nodes, animate camera to center
}
```

- [ ] **Step 7: Implement event handlers**

Wire to Sigma events:
- `clickNode`: set `selectedNode` (or `focusedClusterId` in overview mode)
- `clickStage`: clear selection
- `enterNode`: set `hoveredNodeId`
- `leaveNode`: clear `hoveredNodeId`

- [ ] **Step 8: Implement animation loop**

`requestAnimationFrame` that calls `sigma.refresh()` while `animatedNodes.size > 0`. Auto-stops when empty.

- [ ] **Step 9: Return SigmaControls**

```typescript
return { zoomIn, zoomOut, resetView, focusNode, focusCluster, restartLayout, sigmaRef }
```

- [ ] **Step 10: Commit**

```bash
git add src/app/hooks/useSigma.ts
git commit -m "feat: add useSigma hook — Sigma lifecycle, reducers, layout, camera"
```

---

### Task 8: Create GraphClusterLabels Component

**Files:**
- Create: `src/app/components/graph/GraphClusterLabels.tsx`

Renders HTML overlay labels at cluster centroids in overview mode.

- [ ] **Step 1: Create the component**

```typescript
'use client'

import { useEffect, useState, type RefObject } from 'react'
import type Sigma from 'sigma'
import { useGraphStore } from '../../stores/graphStore'

interface LabelPosition {
  id: string
  name: string
  color: string
  nodeCount: number
  x: number
  y: number
  visible: boolean
}

interface Props {
  sigmaRef: RefObject<Sigma | null>
}

export function GraphClusterLabels({ sigmaRef }: Props) {
  const clusters = useGraphStore((s) => s.clusters)
  const clusterMode = useGraphStore((s) => s.clusterMode)
  const [labels, setLabels] = useState<LabelPosition[]>([])

  useEffect(() => {
    const sigma = sigmaRef.current
    if (!sigma || clusterMode !== 'overview') {
      setLabels([])
      return
    }

    const updatePositions = () => {
      const next: LabelPosition[] = []
      for (const [id, cluster] of clusters) {
        const vp = sigma.graphToViewport({ x: cluster.centroid.x, y: cluster.centroid.y })
        const dims = sigma.getDimensions()
        const visible =
          vp.x >= -50 && vp.x <= dims.width + 50 &&
          vp.y >= -50 && vp.y <= dims.height + 50
        next.push({
          id,
          name: cluster.name,
          color: cluster.color,
          nodeCount: cluster.nodeIds.size,
          x: vp.x,
          y: vp.y,
          visible,
        })
      }
      setLabels(next)
    }

    sigma.on('afterRender', updatePositions)
    updatePositions()

    return () => { sigma.off('afterRender', updatePositions) }
  }, [sigmaRef, clusters, clusterMode])

  if (clusterMode !== 'overview') return null

  return (
    <>
      {labels.filter((l) => l.visible).map((label) => (
        <div
          key={label.id}
          style={{
            position: 'absolute',
            left: label.x,
            top: label.y,
            transform: 'translate(-50%, -50%)',
            padding: '4px 8px',
            borderRadius: 6,
            background: 'rgba(0,0,0,0.7)',
            border: `1px solid ${label.color}`,
            color: '#f5f5f7',
            fontSize: 11,
            fontWeight: 600,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            zIndex: 10,
          }}
        >
          {label.name} ({label.nodeCount})
        </div>
      ))}
    </>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/components/graph/GraphClusterLabels.tsx
git commit -m "feat: add GraphClusterLabels overlay component"
```

---

### Task 9: Rewrite GraphCanvas.tsx

**Files:**
- Rewrite: `src/app/components/graph/GraphCanvas.tsx`

Replace the entire R3F `<Canvas>` setup with a Sigma container div. Wire `useSigma`, render cluster labels, toolbar, tooltip, detail panel. Keep keyboard shortcuts. Show loading/error states.

- [ ] **Step 1: Rewrite the component**

Key structure:

```tsx
'use client'

import { useEffect, useRef, useCallback } from 'react'
import { Flex, Spin, Empty } from 'antd'
import { LoadingOutlined, WarningOutlined } from '@ant-design/icons'
import { invoke } from '@tauri-apps/api/core'
import Graph from 'graphology'

import { useSigma } from '../../hooks/useSigma'
import { useGraphStore } from '../../stores/graphStore'
import GraphToolbar from './GraphToolbar'
import GraphTooltip from './GraphTooltip'
import { GraphClusterLabels } from './GraphClusterLabels'
import { MapDetailPanel } from '../apiModelMap/MapDetailPanel'
import { MapLegend } from '../apiModelMap/MapLegend'
import {
  buildGraphologyInstance,
  seedRandomPositions,
  extractNodeData,
  type RustProjectGraphData,
} from '../../utils/graphDataTransform'
import {
  assignCommunities,
  assignDegreeCentrality,
  computeVisibleSet,
  findShortestPath,
} from '../../utils/graphAlgorithms'
import { computeClusters, findClusterForNode } from '../../utils/graphClustering'
import { getGraphTheme } from '../../utils/graphThemeConfig'
```

The component:
- Loads graph data via `invoke('build_project_graph')`
- Builds graphology instance, seeds random positions, assigns communities
- Calls `useSigma(containerRef, graph, ...)`
- Renders: Sigma container div, `<GraphClusterLabels>`, `<GraphToolbar>`, `<GraphTooltip>`, `<MapDetailPanel>`, `<MapLegend>`
- Shows `<Spin>` during layout, error overlay on `graphError`
- Keyboard shortcuts: Cmd+F, Escape, Alt+Left/Right, 1/2/3, T, Shift+Click

The container div:
```tsx
<div
  ref={containerRef}
  style={{
    width: '100%',
    height: '100%',
    background: theme.background,
    position: 'relative',
  }}
>
  <GraphClusterLabels sigmaRef={controls.sigmaRef} />
</div>
```

- [ ] **Step 2: Port keyboard shortcuts**

Move keyboard handler from current implementation. Keep same key bindings:
- `Cmd/Ctrl+F` → focus search
- `Escape` → exit focus → clear search → deselect
- `Alt+Left/Right` → navigateBack/navigateForward
- `1/2/3` → toggle entity type visibility
- `T` → toggle theme
- `Shift+Click` → handled in useSigma clickNode event

- [ ] **Step 3: Port data loading effect**

Keep the existing `useEffect` that:
1. Calls `invoke('build_project_graph', { projectId })`
2. Builds graphology: `buildGraphologyInstance(data)`
3. Seeds positions: `seedRandomPositions(graph)`
4. Assigns communities: `assignCommunities(graph)`
5. Assigns centrality: `assignDegreeCentrality(graph)`
6. Computes clusters: `computeClusters(graph, communities)`
7. Sets store: `setGraph(graph)`, `setClusters(clusters)`, `setCommunities(communities)`

Key: `spreadClusters()` is NOT called here — it's called in `useSigma` after FA2 layout completes (Codex fix #2).

- [ ] **Step 4: Port search/query result handling**

When `searchResults` change, route highlights correctly (Codex fix #1):
- `QueryResult.type === 'path'` → `setPathNodeIds(nodeIds)` + `triggerNodeAnimation(nodeIds, 'pulse')`
- All other types → `setHighlightedNodeIds(nodeIds)` + `triggerNodeAnimation(nodeIds, 'glow')`
- Never route generic query results to `pathNodeIds`

- [ ] **Step 5: Commit**

```bash
git add src/app/components/graph/GraphCanvas.tsx
git commit -m "feat: rewrite GraphCanvas with Sigma.js container and overlay UI"
```

---

### Task 10: Update GraphToolbar.tsx

**Files:**
- Modify: `src/app/components/graph/GraphToolbar.tsx`

Rewire zoom/layout/reset controls from R3F camera to `SigmaControls`.

- [ ] **Step 1: Update props interface**

Replace camera-related props with SigmaControls:

```typescript
interface Props {
  controls: SigmaControls | null
  // keep existing: onSearch, onFilterChange, etc.
}
```

- [ ] **Step 2: Rewire zoom buttons**

```typescript
// Was: camera.zoom *= 1.2
controls?.zoomIn()
// Was: camera.zoom *= 0.8
controls?.zoomOut()
// Was: requestFitView()
controls?.resetView()
// Was: restartLayout (custom ref)
controls?.restartLayout()
```

- [ ] **Step 3: Remove bloom toggle**

Remove the bloom enable/disable button since bloom is dropped.

- [ ] **Step 4: Commit**

```bash
git add src/app/components/graph/GraphToolbar.tsx
git commit -m "refactor: rewire GraphToolbar to SigmaControls"
```

---

### Task 11: Update GraphTooltip.tsx

**Files:**
- Modify: `src/app/components/graph/GraphTooltip.tsx`

Tooltip is now driven by `hoveredNodeId` from the store (set by Sigma enterNode/leaveNode events in useSigma). The component itself should not change much — it already reads `hoveredNodeId` from the store.

- [ ] **Step 1: Verify the component reads from store**

Check that `GraphTooltip` reads `hoveredNodeId` from `useGraphStore`. If it uses R3F-specific mechanisms (pointerOver from Three.js raycasting), rewire to store-only.

- [ ] **Step 2: Position tooltip using Sigma viewport coordinates**

If tooltip needs pixel position, accept `sigmaRef` and use:

```typescript
const sigma = sigmaRef.current
if (sigma && hoveredNodeId && graph.hasNode(hoveredNodeId)) {
  const attrs = graph.getNodeAttributes(hoveredNodeId)
  const pos = sigma.graphToViewport({ x: attrs.x, y: attrs.y })
  // position tooltip at pos.x, pos.y
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/components/graph/GraphTooltip.tsx
git commit -m "refactor: rewire GraphTooltip to Sigma viewport coordinates"
```

---

### Task 12: Discard Unstaged R3F Changes and Build Verify

**Files:**
- All modified graph files in working tree

- [ ] **Step 1: Discard unstaged changes from pre-existing R3F work**

The git status shows unstaged modifications to graph files from the previous R3F-style work. These are superseded by our Sigma rewrite. Verify all R3F files have been handled by our commits, then discard any remaining unstaged changes:

```bash
cd /Users/gwddeveloper/opensource/piu
git checkout -- src/app/components/graph/ src/app/utils/graphDataTransform.ts src/app/utils/graphThemeConfig.ts src-tauri/src/db/search.rs src-tauri/src/lib.rs src-tauri/src/db/mod.rs
```

Note: Only discard files that were already fully rewritten by our tasks. If `src-tauri/src/db/search.rs`, `src-tauri/src/lib.rs`, or `src-tauri/src/db/mod.rs` have meaningful changes unrelated to the graph, preserve them.

- [ ] **Step 2: Run Next.js build to check for TypeScript errors**

```bash
cd /Users/gwddeveloper/opensource/piu && bun run build 2>&1 | tail -30
```

Fix any import errors (dead imports to deleted files, missing Sigma types, etc.).

- [ ] **Step 3: Run cargo clippy on Rust side (should be clean)**

```bash
cd /Users/gwddeveloper/opensource/piu/src-tauri && cargo clippy --all-targets --all-features -- -D warnings 2>&1 | tail -20
```

- [ ] **Step 4: Start dev server and visually verify**

```bash
cd /Users/gwddeveloper/opensource/piu && bun tauri dev
```

Open the app, navigate to a project with graph data. Verify:
- Graph renders with Sigma (WebGL circles, curved edges)
- Nodes have correct colors by entity type
- ForceAtlas2 layout runs and positions stabilize
- Click node → selection highlights
- Hover → tooltip appears
- Keyboard shortcuts work (1/2/3 filter, T theme, Cmd+F search)
- Cluster overview mode shows community colors + labels
- Focus mode zooms to cluster, hides others

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete Sigma.js v3 graph engine swap

Replace React Three Fiber with Sigma.js v3 for graph rendering.
- Port GitNexus useSigma hook pattern with node/edge reducers
- Curved Bezier edges via @sigma/edge-curve
- Community coloring replaces metaball SDF shader
- Overview/focus cluster navigation via Sigma reducers
- Animation system (pulse/ripple/glow) via requestAnimationFrame
- Full keyboard shortcut parity
- Dark/light theme support preserved

Dropped: bloom post-processing, Canvas 2D minimap, stub edges in focus mode.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```
