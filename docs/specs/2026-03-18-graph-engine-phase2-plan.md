# Graph Engine Phase 2 — Algorithms + UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add graph intelligence (Louvain clustering, centrality, filtering, search, path highlighting) and polished UX (toolbar, hover tooltips, keyboard shortcuts, LOD labels) to the Phase 1 graph engine.

**Architecture:** Graphology algorithms compute node attributes (community, centrality) at load time. A `graphAlgorithms.ts` utility layer provides pure functions that read/write graphology attributes. The `GraphToolbar` component (React + Ant Design overlay) drives filter/search state in `graphStore`. The renderer reads a `visibleSet` to show/hide nodes via scale=0. Hover + keyboard events are handled in R3F components and surfaced to React overlays.

**Tech Stack:** graphology-communities-louvain, graphology-shortest-path, graphology-metrics, existing R3F + graphology + Zustand stack

**Spec:** `docs/specs/2026-03-18-graph-engine-enhancement-design.md` — Sections 4 + 5

**Depends on:** Phase 1 complete (graphStore, graphDataTransform, GraphCanvas, GraphNodes, GraphEdges all working)

---

## File Map

| File | Responsibility | Status |
|------|---------------|--------|
| `src/app/utils/graphAlgorithms.ts` | Pure functions: Louvain clustering, degree centrality, fuzzy search, visible set computation, path finding | **Create** |
| `src/app/stores/graphStore.ts` | Extend with: filters, searchQuery, searchResults, hoveredNodeId, selectionHistory, pathNodes, visibleSet | **Modify** |
| `src/app/components/graph/GraphToolbar.tsx` | Search bar + transport controls + filter toggles (React overlay on canvas) | **Create** |
| `src/app/components/graph/GraphTooltip.tsx` | Hover tooltip overlay showing node details | **Create** |
| `src/app/components/graph/GraphLabels.tsx` | LOD text labels using Three.js Sprites | **Create** |
| `src/app/components/graph/GraphCanvas.tsx` | Integrate algorithms at load, pass visibleSet to renderer, add hover/keyboard handlers | **Modify** |
| `src/app/components/graph/GraphNodes.tsx` | Accept `visibleSet`, `hoveredNodeId`, `pathNodeIds` for opacity/emissive effects | **Modify** |
| `src/app/components/graph/GraphEdges.tsx` | Accept `visibleEdges` filtering | **Modify** |
| `package.json` | Add graphology algorithm packages | **Modify** |

---

## Task 1: Install Phase 2 Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install graphology algorithm packages**

```bash
cd /Users/gwddeveloper/opensource/piu
bun add graphology-communities-louvain graphology-shortest-path graphology-metrics
```

- [ ] **Step 2: Verify installed**

```bash
ls node_modules/graphology-communities-louvain/index.js && ls node_modules/graphology-shortest-path/index.js && echo "OK"
```

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: add graphology algorithm packages for Phase 2"
```

---

## Task 2: Create graphAlgorithms.ts

**Files:**
- Create: `src/app/utils/graphAlgorithms.ts`

All graph algorithm logic lives here as pure functions that operate on a graphology `Graph` instance. No React, no Zustand — just graph math.

- [ ] **Step 1: Create the file**

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add src/app/utils/graphAlgorithms.ts
git commit -m "feat: add graphAlgorithms utility — Louvain, centrality, search, filtering, pathfinding"
```

---

## Task 3: Extend graphStore with Phase 2 State

**Files:**
- Modify: `src/app/stores/graphStore.ts`

Add filter state, search state, hover state, selection history, path highlight, and visible set.

- [ ] **Step 1: Rewrite graphStore.ts**

Replace entire contents of `src/app/stores/graphStore.ts`:

```typescript
import { create } from 'zustand';
import Graph from 'graphology';
import {
  type FilterState,
  type SearchResult,
  type CommunityInfo,
  DEFAULT_FILTERS,
} from '../utils/graphAlgorithms';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SelectedNode {
  nodeId: string;
  entityType: 'collection' | 'request' | 'model';
  entityId: string;
}

interface GraphStore {
  // --- Phase 1 (existing) ---
  graph: Graph | null;
  setGraph: (graph: Graph | null) => void;

  isComputing: boolean;
  setComputing: (value: boolean) => void;

  selectedNode: SelectedNode | null;
  setSelectedNode: (node: SelectedNode | null) => void;

  nodeIndexToId: string[];
  setNodeIndexToId: (mapping: string[]) => void;

  // --- Phase 2: Filters ---
  filters: FilterState;
  setFilters: (filters: FilterState) => void;
  updateFilter: <K extends keyof FilterState>(key: K, value: FilterState[K]) => void;
  resetFilters: () => void;

  // --- Phase 2: Search ---
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  searchResults: SearchResult[];
  setSearchResults: (results: SearchResult[]) => void;
  activeSearchIndex: number;
  setActiveSearchIndex: (index: number) => void;

  // --- Phase 2: Hover ---
  hoveredNodeId: string | null;
  setHoveredNodeId: (nodeId: string | null) => void;

  // --- Phase 2: Selection history (transport) ---
  selectionHistory: string[];
  selectionHistoryIndex: number;
  pushSelection: (nodeId: string) => void;
  navigateBack: () => void;
  navigateForward: () => void;

  // --- Phase 2: Path highlight ---
  pathNodeIds: Set<string>;
  setPathNodeIds: (ids: Set<string>) => void;
  clearPath: () => void;

  // --- Phase 2: Visible set ---
  visibleNodeIds: Set<string> | null; // null = show all
  setVisibleNodeIds: (ids: Set<string> | null) => void;

  // --- Phase 2: Communities ---
  communities: CommunityInfo[];
  setCommunities: (communities: CommunityInfo[]) => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useGraphStore = create<GraphStore>((set, get) => ({
  // Phase 1
  graph: null,
  setGraph: (graph) => set({ graph }),

  isComputing: false,
  setComputing: (value) => set({ isComputing: value }),

  selectedNode: null,
  setSelectedNode: (node) => set({ selectedNode: node }),

  nodeIndexToId: [],
  setNodeIndexToId: (mapping) => set({ nodeIndexToId: mapping }),

  // Phase 2: Filters
  filters: { ...DEFAULT_FILTERS },
  setFilters: (filters) => set({ filters }),
  updateFilter: (key, value) =>
    set((state) => ({ filters: { ...state.filters, [key]: value } })),
  resetFilters: () => set({ filters: { ...DEFAULT_FILTERS } }),

  // Phase 2: Search
  searchQuery: '',
  setSearchQuery: (query) => set({ searchQuery: query }),
  searchResults: [],
  setSearchResults: (results) => set({ searchResults: results }),
  activeSearchIndex: 0,
  setActiveSearchIndex: (index) => set({ activeSearchIndex: index }),

  // Phase 2: Hover
  hoveredNodeId: null,
  setHoveredNodeId: (nodeId) => set({ hoveredNodeId: nodeId }),

  // Phase 2: Selection history
  selectionHistory: [],
  selectionHistoryIndex: -1,
  pushSelection: (nodeId) => {
    const { selectionHistory, selectionHistoryIndex } = get();
    // Truncate forward history if we navigated back
    const truncated = selectionHistory.slice(0, selectionHistoryIndex + 1);
    set({
      selectionHistory: [...truncated, nodeId],
      selectionHistoryIndex: truncated.length,
    });
  },
  navigateBack: () => {
    const { selectionHistoryIndex } = get();
    if (selectionHistoryIndex > 0) {
      set({ selectionHistoryIndex: selectionHistoryIndex - 1 });
    }
  },
  navigateForward: () => {
    const { selectionHistory, selectionHistoryIndex } = get();
    if (selectionHistoryIndex < selectionHistory.length - 1) {
      set({ selectionHistoryIndex: selectionHistoryIndex + 1 });
    }
  },

  // Phase 2: Path highlight
  pathNodeIds: new Set(),
  setPathNodeIds: (ids) => set({ pathNodeIds: ids }),
  clearPath: () => set({ pathNodeIds: new Set() }),

  // Phase 2: Visible set
  visibleNodeIds: null,
  setVisibleNodeIds: (ids) => set({ visibleNodeIds: ids }),

  // Phase 2: Communities
  communities: [],
  setCommunities: (communities) => set({ communities }),
}));
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: No errors (graphAlgorithms types are imported correctly).

- [ ] **Step 3: Commit**

```bash
git add src/app/stores/graphStore.ts
git commit -m "feat: extend graphStore with Phase 2 state — filters, search, hover, path, history"
```

---

## Task 4: Integrate Algorithms into GraphCanvas

**Files:**
- Modify: `src/app/components/graph/GraphCanvas.tsx`

After building the graphology instance and before rendering, run Louvain and degree centrality. Pass `visibleNodeIds` and `hoveredNodeId` to child components.

- [ ] **Step 1: Add imports at top of GraphCanvas.tsx**

Add after existing imports:

```typescript
import {
  assignCommunities,
  assignDegreeCentrality,
  computeVisibleSet,
  computeVisibleEdges,
} from '../../utils/graphAlgorithms';
```

- [ ] **Step 2: In the data-load effect, after `assignZLayer(graph)` and before `setNodeData`, add algorithm calls**

After `assignZLayer(graph);` and `setGraph(graph);`, add:

```typescript
// Run Louvain community detection
const communityInfo = assignCommunities(graph);
setCommunities(communityInfo);

// Compute degree centrality (updates node sizes)
assignDegreeCentrality(graph);
```

This must happen in BOTH the cached-positions branch AND after FA2 stops.

- [ ] **Step 3: Subscribe to filter changes and recompute visibleSet**

Add a `useEffect` that recomputes the visible set whenever `filters` change:

```typescript
const filters = useGraphStore((s) => s.filters);
const setVisibleNodeIds = useGraphStore((s) => s.setVisibleNodeIds);

useEffect(() => {
  const graph = graphRef.current;
  if (!graph) return;

  // Check if any filter is actually active
  const isDefault = filters.showCollections && filters.showRequests && filters.showModels
    && filters.methods.length === 0 && filters.edgeTypes.length === 0
    && filters.communityId === null;

  if (isDefault) {
    setVisibleNodeIds(null); // null = show all
  } else {
    setVisibleNodeIds(computeVisibleSet(graph, filters));
  }
}, [filters, setVisibleNodeIds]);
```

- [ ] **Step 4: Pass new props to GraphNodes and GraphEdges**

```tsx
<GraphNodes
  nodes={nodeData}
  selectedNodeId={selectedNode?.nodeId ?? null}
  hoveredNodeId={hoveredNodeId}
  visibleNodeIds={visibleNodeIds}
  pathNodeIds={pathNodeIds}
  onNodeClick={handleNodeClick}
  onNodeHover={handleNodeHover}
  onPointerMissed={handleDeselect}
/>
```

Add the hover handler:

```typescript
const hoveredNodeId = useGraphStore((s) => s.hoveredNodeId);
const setHoveredNodeId = useGraphStore((s) => s.setHoveredNodeId);
const visibleNodeIds = useGraphStore((s) => s.visibleNodeIds);
const pathNodeIds = useGraphStore((s) => s.pathNodeIds);

const handleNodeHover = useCallback((nodeId: string | null) => {
  setHoveredNodeId(nodeId);
}, [setHoveredNodeId]);
```

- [ ] **Step 5: Commit**

```bash
git add src/app/components/graph/GraphCanvas.tsx
git commit -m "feat: integrate Louvain + centrality into graph load, add filter/hover plumbing"
```

---

## Task 5: Update GraphNodes for Filtering + Hover Effects

**Files:**
- Modify: `src/app/components/graph/GraphNodes.tsx`

Accept new props for visibility, hover, and path highlighting. Nodes not in `visibleNodeIds` get scale=0. Hovered node gets emissive boost. Path nodes get distinct treatment.

- [ ] **Step 1: Update props interface**

```typescript
interface GraphNodesProps {
  nodes: GraphNodeData[];
  selectedNodeId: string | null;
  hoveredNodeId: string | null;
  visibleNodeIds: Set<string> | null; // null = all visible
  pathNodeIds: Set<string>;
  onNodeClick: (nodeId: string) => void;
  onNodeHover: (nodeId: string | null) => void;
  onPointerMissed: () => void;
}
```

- [ ] **Step 2: Update the instance matrix effect to handle visibility**

In the loop where matrices are set, add visibility check:

```typescript
for (let i = 0; i < nodes.length; i++) {
  const node = nodes[i];
  const isVisible = !visibleNodeIds || visibleNodeIds.has(node.id);
  const scale = isVisible ? node.size : 0; // scale=0 hides the instance

  _dummy.position.set(node.x, node.y, node.z);
  _dummy.scale.set(scale, scale, scale);
  _dummy.updateMatrix();
  mesh.setMatrixAt(i, _dummy.matrix);

  // Dim nodes not in path when path is active
  const inPath = pathNodeIds.size === 0 || pathNodeIds.has(node.id);
  const dimFactor = inPath ? 1.0 : 0.25;

  _color.set(node.color);
  colorAttr[i * 3] = _color.r * dimFactor;
  colorAttr[i * 3 + 1] = _color.g * dimFactor;
  colorAttr[i * 3 + 2] = _color.b * dimFactor;
}
```

Add `visibleNodeIds` and `pathNodeIds` to the effect dependencies.

- [ ] **Step 3: Add onPointerOver/onPointerOut for hover**

```typescript
const handlePointerOver = (e: ThreeEvent<PointerEvent>) => {
  e.stopPropagation();
  const instanceId = e.instanceId;
  if (instanceId === undefined) return;
  const nodeIndexToId = useGraphStore.getState().nodeIndexToId;
  const nodeId = nodeIndexToId[instanceId];
  if (nodeId) onNodeHover(nodeId);
};

const handlePointerOut = () => {
  onNodeHover(null);
};
```

Add to the `<instancedMesh>`:
```tsx
onPointerOver={handlePointerOver}
onPointerOut={handlePointerOut}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/components/graph/GraphNodes.tsx
git commit -m "feat: add visibility, hover, and path dimming to GraphNodes"
```

---

## Task 6: Create GraphToolbar

**Files:**
- Create: `src/app/components/graph/GraphToolbar.tsx`

The floating toolbar overlay with search bar, transport controls, and filter toggles. Uses Ant Design components, positioned absolutely over the canvas.

- [ ] **Step 1: Create the file**

Create `src/app/components/graph/GraphToolbar.tsx` with:

- A search `<Input>` with fuzzy match results dropdown
- Transport buttons: Prev (Alt+Left), Home (Cmd+0), Next (Alt+Right), Reset (Cmd+R)
- Entity type toggle buttons: C / R / M with colored indicators
- Progressive disclosure: toolbar at 60% opacity by default, 100% on hover
- Search results grouped by entity type with colored dots
- "N of M matches" indicator when searching

The toolbar is a React overlay (not inside R3F `<Canvas>`). It reads/writes graphStore state:
- `searchQuery`, `setSearchQuery`, `searchResults`, `setSearchResults`, `activeSearchIndex`, `setActiveSearchIndex`
- `filters`, `updateFilter`, `resetFilters`
- `navigateBack`, `navigateForward`, `selectionHistory`, `selectionHistoryIndex`

On search input change, call `searchNodes(graph, query)` from graphAlgorithms.

Transport "Reset" should call a callback prop `onResetLayout` that GraphCanvas provides.
Transport "Home" should call a callback prop `onFitView`.

- [ ] **Step 2: Commit**

```bash
git add src/app/components/graph/GraphToolbar.tsx
git commit -m "feat: add GraphToolbar with search, transport controls, and filter toggles"
```

---

## Task 7: Wire GraphToolbar into GraphCanvas

**Files:**
- Modify: `src/app/components/graph/GraphCanvas.tsx`

- [ ] **Step 1: Import and render GraphToolbar**

Add import:
```typescript
import { GraphToolbar } from './GraphToolbar';
```

Add inside the main render `<div>`, above the canvas:

```tsx
<GraphToolbar
  onResetLayout={handleResetLayout}
  onFitView={handleFitView}
  onFlyToNode={handleFlyToNode}
/>
```

- [ ] **Step 2: Implement handler callbacks**

```typescript
const handleResetLayout = useCallback(() => {
  // Clear cached positions and re-trigger data load
  if (!projectId) return;
  const graph = graphRef.current;
  if (graph) {
    graph.forEachNode((node) => {
      graph.removeNodeAttribute(node, 'x');
      graph.removeNodeAttribute(node, 'y');
    });
  }
  invoke('save_graph_positions', { positions: [] }).catch(() => {});
  // Trigger refresh by incrementing refreshKey externally — or re-run the load effect
  setNodeData([]);
  setEdgeData([]);
  // Re-trigger load
}, [projectId]);
```

Note: `handleFitView` and `handleFlyToNode` require access to the OrbitControls ref. Add a `controlsRef` via R3F's `useRef` on `<OrbitControls>` and use `controls.reset()` for fit-view.

- [ ] **Step 3: Commit**

```bash
git add src/app/components/graph/GraphCanvas.tsx
git commit -m "feat: wire GraphToolbar into GraphCanvas with reset/fit/flyTo handlers"
```

---

## Task 8: Create GraphTooltip

**Files:**
- Create: `src/app/components/graph/GraphTooltip.tsx`

A floating tooltip that appears when hovering a node. Shows: entity type badge, name, method (for requests), URL path, field count (for models), connected relationships.

- [ ] **Step 1: Create the file**

The tooltip reads `hoveredNodeId` from graphStore. When non-null, it:
1. Reads node attributes from `graph.getNodeAttributes(hoveredNodeId)`
2. Reads connected edges via `graph.forEachEdge(hoveredNodeId, ...)`
3. Positions itself near the mouse (use a ref to track pointer position)
4. Uses the same translucent material as the toolbar: `backdrop-filter: blur(12px)`, `rgba(17, 19, 32, 0.88)`
5. Appears after 200ms delay (debounce rapid mouse movements)

The tooltip is a React overlay positioned absolutely.

- [ ] **Step 2: Wire into GraphCanvas**

Add `<GraphTooltip />` inside the main render div (after canvas, before MapDetailPanel).

- [ ] **Step 3: Commit**

```bash
git add src/app/components/graph/GraphTooltip.tsx src/app/components/graph/GraphCanvas.tsx
git commit -m "feat: add GraphTooltip hover overlay with node details"
```

---

## Task 9: Add Path Highlighting

**Files:**
- Modify: `src/app/components/graph/GraphCanvas.tsx`

Shift+click a second node triggers Dijkstra shortest path, highlighting the path.

- [ ] **Step 1: Import findShortestPath**

```typescript
import { findShortestPath } from '../../utils/graphAlgorithms';
```

- [ ] **Step 2: Modify handleNodeClick**

If shift is held and a node is already selected, compute path instead of changing selection:

```typescript
const handleNodeClick = useCallback(
  (nodeId: string, event?: { shiftKey?: boolean }) => {
    const graph = graphRef.current;
    if (!graph || !graph.hasNode(nodeId)) return;

    const current = useGraphStore.getState().selectedNode;

    // Shift+click: find path between current and clicked node
    if (event?.shiftKey && current && current.nodeId !== nodeId) {
      const path = findShortestPath(graph, current.nodeId, nodeId);
      if (path) {
        useGraphStore.getState().setPathNodeIds(new Set(path));
      }
      return;
    }

    // Normal click: select node, clear path
    useGraphStore.getState().clearPath();
    const attrs = graph.getNodeAttributes(nodeId);
    const entityType = attrs.entity_type as 'collection' | 'request' | 'model';
    const entityId = attrs.entity_id as string;
    setSelectedNode({ nodeId, entityType, entityId });
    useGraphStore.getState().pushSelection(nodeId);
  },
  [],
);
```

- [ ] **Step 3: Update GraphNodes click handler to pass shiftKey**

In GraphNodes.tsx, update the click handler to forward the shift key state:

```typescript
const handleClick = (e: ThreeEvent<MouseEvent>) => {
  e.stopPropagation();
  const instanceId = e.instanceId;
  if (instanceId === undefined) return;
  const nodeIndexToId = useGraphStore.getState().nodeIndexToId;
  const nodeId = nodeIndexToId[instanceId];
  if (nodeId) {
    onNodeClick(nodeId, { shiftKey: e.nativeEvent.shiftKey });
  }
};
```

Update the `onNodeClick` prop type: `onNodeClick: (nodeId: string, event?: { shiftKey?: boolean }) => void`

- [ ] **Step 4: Commit**

```bash
git add src/app/components/graph/GraphCanvas.tsx src/app/components/graph/GraphNodes.tsx
git commit -m "feat: add shift+click path highlighting via Dijkstra"
```

---

## Task 10: Add Keyboard Shortcuts

**Files:**
- Modify: `src/app/components/graph/GraphCanvas.tsx`

- [ ] **Step 1: Add a useEffect for keyboard listeners**

```typescript
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    const isMeta = e.metaKey || e.ctrlKey;

    // Cmd+F — focus search bar
    if (isMeta && e.key === 'f') {
      e.preventDefault();
      // The search input ref is inside GraphToolbar — use a store flag or DOM query
      const searchInput = document.querySelector<HTMLInputElement>('[data-graph-search]');
      searchInput?.focus();
      return;
    }

    // Escape — clear search, deselect, close panel
    if (e.key === 'Escape') {
      const { searchQuery, setSearchQuery, setSearchResults, clearPath } = useGraphStore.getState();
      if (searchQuery) {
        setSearchQuery('');
        setSearchResults([]);
      } else {
        setSelectedNode(null);
        clearPath();
      }
      return;
    }

    // Alt+Left — navigate back
    if (e.altKey && e.key === 'ArrowLeft') {
      e.preventDefault();
      useGraphStore.getState().navigateBack();
      return;
    }

    // Alt+Right — navigate forward
    if (e.altKey && e.key === 'ArrowRight') {
      e.preventDefault();
      useGraphStore.getState().navigateForward();
      return;
    }

    // 1/2/3 — toggle entity type visibility (only when not focused on input)
    if (document.activeElement?.tagName !== 'INPUT') {
      if (e.key === '1') {
        const { filters, updateFilter } = useGraphStore.getState();
        updateFilter('showCollections', !filters.showCollections);
      }
      if (e.key === '2') {
        const { filters, updateFilter } = useGraphStore.getState();
        updateFilter('showRequests', !filters.showRequests);
      }
      if (e.key === '3') {
        const { filters, updateFilter } = useGraphStore.getState();
        updateFilter('showModels', !filters.showModels);
      }
    }
  };

  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, [setSelectedNode]);
```

- [ ] **Step 2: Commit**

```bash
git add src/app/components/graph/GraphCanvas.tsx
git commit -m "feat: add keyboard shortcuts — Cmd+F, Escape, Alt+arrows, 1/2/3 filters"
```

---

## Summary

| Task | Description | Files touched |
|------|-------------|---------------|
| 1 | Install deps | `package.json` |
| 2 | Create graphAlgorithms.ts | `utils/graphAlgorithms.ts` |
| 3 | Extend graphStore | `stores/graphStore.ts` |
| 4 | Integrate algorithms into GraphCanvas | `graph/GraphCanvas.tsx` |
| 5 | Update GraphNodes for filter/hover/path | `graph/GraphNodes.tsx` |
| 6 | Create GraphToolbar | `graph/GraphToolbar.tsx` |
| 7 | Wire GraphToolbar into GraphCanvas | `graph/GraphCanvas.tsx` |
| 8 | Create GraphTooltip | `graph/GraphTooltip.tsx`, `graph/GraphCanvas.tsx` |
| 9 | Add path highlighting | `graph/GraphCanvas.tsx`, `graph/GraphNodes.tsx` |
| 10 | Add keyboard shortcuts | `graph/GraphCanvas.tsx` |

Total: 10 tasks, each producing a single commit. Tasks 1-5 are foundational, 6-10 are UX features.

**Note:** LOD labels (`GraphLabels.tsx`) from the spec are deferred to a follow-up task. Three.js Sprite-based text labels in an InstancedMesh context require a text atlas or SDF font renderer, which is significant complexity. The search bar + hover tooltip cover the discoverability gap for now. LOD labels can be added as Task 11 or as Phase 2.5.
