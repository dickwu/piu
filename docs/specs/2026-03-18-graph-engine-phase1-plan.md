# Graph Engine Phase 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `react-force-graph-3d` with a custom Graphology + React Three Fiber renderer that achieves visual parity with the current graph while supporting 10x scale (1,000+ nodes at 60fps).

**Architecture:** Rust backend remains unchanged — it builds graph topology from SQLite and returns `{nodes[], edges[]}` JSON. The frontend builds a `graphology.Graph` instance from this JSON, runs ForceAtlas2 layout in a Web Worker, and renders via React Three Fiber using InstancedMesh (3 draw calls total regardless of node count). Position caching to SQLite is preserved.

**Tech Stack:** graphology, graphology-layout-forceatlas2, @react-three/fiber, @react-three/drei, three (existing), zustand (existing), tauri invoke (existing)

**Spec:** `docs/specs/2026-03-18-graph-engine-enhancement-design.md`

---

## File Map

| File | Responsibility | Status |
|------|---------------|--------|
| `src/app/stores/graphStore.ts` | Zustand store: graphology instance, layout state (`isComputing`), selected node, node-index mapping | **Create** |
| `src/app/utils/graphDataTransform.ts` | Transform Rust JSON `{nodes[], edges[]}` into graphology `Graph` instance; z-axis assignment; position extraction for SQLite save | **Rewrite** |
| `src/app/components/graph/GraphCanvas.tsx` | R3F `<Canvas>` scene: lighting, OrbitControls, background, pointer events | **Create** |
| `src/app/components/graph/GraphNodes.tsx` | InstancedMesh for all node spheres with per-instance color + scale | **Create** |
| `src/app/components/graph/GraphEdges.tsx` | InstancedMesh for all edge cylinders oriented source-to-target | **Create** |
| `src/app/components/GraphCenterPanel.tsx` | Swap `ForceGraph3DCanvas` import to new `GraphCanvas` via `dynamic(ssr:false)` | **Modify** |
| `src/app/components/apiModelMap/ApiModelMapFlow.tsx` | Same swap for the modal variant | **Modify** |
| `src/app/components/StatusBar.tsx` | Update `useLayoutComputeStore` import to `useGraphStore` | **Modify** |
| `src/app/stores/layoutComputeStore.ts` | Remove after migration | **Delete** |
| `package.json` | Add graphology + R3F deps, remove react-force-graph-3d + three-spritetext | **Modify** |

**Kept unchanged:** `apiModelMapLayout.ts` (edge styles, node data types), `MapDetailPanel.tsx`, `MapLegend.tsx`, all Rust backend code (`graph_commands.rs`, `db/graph.rs`).

---

## Task 1: Install Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add new packages**

```bash
cd /Users/gwddeveloper/opensource/piu
bun add graphology graphology-types graphology-layout-forceatlas2 @react-three/fiber @react-three/drei
```

Note: `graphology-types` is a required peer dependency for both `graphology` and `graphology-layout-forceatlas2`. Bun does not auto-install peers. Graphology ships its own types — do NOT install `@types/graphology` (it does not exist on npm).

- [ ] **Step 2: Remove old packages**

```bash
bun remove react-force-graph-3d three-spritetext
```

Note: Do NOT remove `three` or `@types/three` — R3F depends on them.

- [ ] **Step 3: Verify packages installed**

```bash
ls node_modules/graphology/dist/graphology.d.ts && ls node_modules/@react-three/fiber/dist/index.js && echo "OK"
```

Expected: `OK`. Note: Do NOT run `bun run dev` yet — Next.js Turbopack will fail because existing files still import the removed `react-force-graph-3d`. That's expected and will be fixed in Task 7.

Note: `@react-three/fiber@9.x` requires `react >=19 <19.3`. The project uses `react ^19.2.4` which satisfies this today.

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lockb
git commit -m "chore: swap graph deps — add graphology + R3F, remove react-force-graph-3d"
```

---

## Task 2: Create graphStore (Zustand)

**Files:**
- Create: `src/app/stores/graphStore.ts`
- Modify: `src/app/components/StatusBar.tsx` (update import)

- [ ] **Step 1: Create the store**

Create `src/app/stores/graphStore.ts`:

```typescript
import { create } from 'zustand';
import Graph from 'graphology';

interface SelectedNode {
  nodeId: string;
  entityType: 'collection' | 'request' | 'model';
  entityId: string;
}

interface GraphStore {
  /** The graphology instance. Null until graph data loads. */
  graph: Graph | null;
  setGraph: (graph: Graph | null) => void;

  /** Whether FA2 layout is currently running. */
  isComputing: boolean;
  setComputing: (value: boolean) => void;

  /** Currently selected node (click). */
  selectedNode: SelectedNode | null;
  setSelectedNode: (node: SelectedNode | null) => void;

  /**
   * Stable mapping from InstancedMesh index to graphology node ID.
   * MUST NOT be reshuffled between filter changes.
   */
  nodeIndexToId: string[];
  setNodeIndexToId: (mapping: string[]) => void;
}

export const useGraphStore = create<GraphStore>((set) => ({
  graph: null,
  setGraph: (graph) => set({ graph }),

  isComputing: false,
  setComputing: (value) => set({ isComputing: value }),

  selectedNode: null,
  setSelectedNode: (node) => set({ selectedNode: node }),

  nodeIndexToId: [],
  setNodeIndexToId: (mapping) => set({ nodeIndexToId: mapping }),
}));
```

- [ ] **Step 2: Update StatusBar.tsx import**

In `src/app/components/StatusBar.tsx`, replace:

```typescript
import { useLayoutComputeStore } from '../stores/layoutComputeStore';
```

with:

```typescript
import { useGraphStore } from '../stores/graphStore';
```

And replace the usage:

```typescript
const layoutComputing = useLayoutComputeStore((s) => s.isComputing);
```

with:

```typescript
const layoutComputing = useGraphStore((s) => s.isComputing);
```

- [ ] **Step 3: Verify no other files import layoutComputeStore except ForceGraph3DCanvas**

ForceGraph3DCanvas will be rewritten in Task 5, so we can safely leave its broken import for now.

- [ ] **Step 4: Commit**

```bash
git add src/app/stores/graphStore.ts src/app/components/StatusBar.tsx
git commit -m "feat: add graphStore zustand store, migrate StatusBar from layoutComputeStore"
```

---

## Task 3: Rewrite graphDataTransform.ts

**Files:**
- Rewrite: `src/app/utils/graphDataTransform.ts`

This file currently transforms Rust JSON into `react-force-graph-3d` compatible flat arrays. The rewrite transforms into a `graphology.Graph` instance instead.

- [ ] **Step 1: Rewrite the file**

Replace entire contents of `src/app/utils/graphDataTransform.ts`:

```typescript
import Graph from 'graphology';
import {
  EDGE_STYLES,
  type CollectionNodeData,
  type RequestNodeData,
  type ModelNodeData,
  type EdgeStyleKey,
} from './apiModelMapLayout';

// ---------------------------------------------------------------------------
// Types matching Rust GraphNode/GraphEdge structs (unchanged from before)
// ---------------------------------------------------------------------------

export interface RustGraphNode {
  id: string;
  project_id: string;
  entity_type: 'collection' | 'request' | 'model';
  entity_id: string;
  label: string;
  properties: string; // JSON blob
  size: number;
  color: string;
  fx: number | null;
  fy: number | null;
  fz: number | null;
  created_at: number;
}

export interface RustGraphEdge {
  id: string;
  project_id: string;
  source_id: string;
  target_id: string;
  edge_type: string;
  label: string;
  properties: string; // JSON blob
  created_at: number;
}

export interface RustProjectGraphData {
  nodes: RustGraphNode[];
  edges: RustGraphEdge[];
}

// ---------------------------------------------------------------------------
// Z-axis layering constants (entity type -> z offset)
// ---------------------------------------------------------------------------

const Z_LAYER: Record<string, number> = {
  collection: 0,
  request: 50,
  model: 100,
};

// ---------------------------------------------------------------------------
// Build a graphology Graph from Rust JSON
// ---------------------------------------------------------------------------

export function buildGraphologyInstance(data: RustProjectGraphData): Graph {
  const graph = new Graph({ multi: false, type: 'directed', allowSelfLoops: false });

  for (const node of data.nodes) {
    let properties: Record<string, unknown> = {};
    try {
      properties = JSON.parse(node.properties);
    } catch {
      // fallback to empty
    }

    graph.addNode(node.id, {
      entity_type: node.entity_type,
      entity_id: node.entity_id,
      label: node.label,
      properties,
      size: node.size,
      color: node.color,
      // Positions: use cached if available, otherwise undefined (FA2 will assign)
      x: node.fx ?? undefined,
      y: node.fy ?? undefined,
      z: node.fz ?? Z_LAYER[node.entity_type] ?? 0,
    });
  }

  for (const edge of data.edges) {
    // Skip edges referencing missing nodes
    if (!graph.hasNode(edge.source_id) || !graph.hasNode(edge.target_id)) continue;

    const style = EDGE_STYLES[edge.edge_type as EdgeStyleKey] ?? {
      stroke: '#555',
      strokeWidth: 1,
    };

    graph.addEdge(edge.source_id, edge.target_id, {
      edge_type: edge.edge_type,
      label: edge.label,
      color: style.stroke,
      width: style.strokeWidth,
    });
  }

  return graph;
}

// ---------------------------------------------------------------------------
// Check if any node has cached positions
// ---------------------------------------------------------------------------

export function hasCachedPositions(graph: Graph): boolean {
  let found = false;
  graph.someNode((_node, attrs) => {
    if (typeof attrs.x === 'number' && typeof attrs.y === 'number') {
      found = true;
      return true; // stop iteration
    }
    return false;
  });
  return found;
}

// ---------------------------------------------------------------------------
// Assign z-axis based on entity type (called after FA2 produces x/y)
// ---------------------------------------------------------------------------

export function assignZLayer(graph: Graph): void {
  graph.forEachNode((node, attrs) => {
    const z = Z_LAYER[attrs.entity_type as string] ?? 0;
    graph.setNodeAttribute(node, 'z', z);
  });
}

// ---------------------------------------------------------------------------
// Extract positions for SQLite save (same shape as current save_graph_positions)
// ---------------------------------------------------------------------------

export interface PositionForSave {
  id: string;
  fx: number;
  fy: number;
  fz: number;
}

export function extractPositionsForSave(graph: Graph): PositionForSave[] {
  const positions: PositionForSave[] = [];
  graph.forEachNode((node, attrs) => {
    if (typeof attrs.x === 'number' && typeof attrs.y === 'number') {
      positions.push({
        id: node,
        fx: attrs.x,
        fy: attrs.y,
        fz: typeof attrs.z === 'number' ? attrs.z : 0,
      });
    }
  });
  return positions;
}

// ---------------------------------------------------------------------------
// Extract node data for MapDetailPanel (same interface as before)
// ---------------------------------------------------------------------------

export function extractNodeData(
  graph: Graph,
  nodeId: string,
): CollectionNodeData | RequestNodeData | ModelNodeData {
  const attrs = graph.getNodeAttributes(nodeId);
  const props = (attrs.properties ?? {}) as Record<string, unknown>;

  switch (attrs.entity_type) {
    case 'collection':
      return {
        name: (props.name as string) ?? attrs.label,
        pathPrefix: (props.pathPrefix as string | null) ?? null,
        requestCount: (props.requestCount as number) ?? 0,
      };

    case 'request':
      return {
        name: (props.name as string) ?? attrs.label,
        method: (props.method as string) ?? 'GET',
        url: (props.url as string) ?? '',
      };

    case 'model': {
      const fieldPreview = Array.isArray(props.fieldPreview)
        ? (props.fieldPreview as Array<{ name: string; type: string; required: boolean }>)
        : [];
      return {
        name: (props.name as string) ?? attrs.label,
        fieldCount: (props.fieldCount as number) ?? 0,
        fieldPreview,
      };
    }

    default:
      return {
        name: attrs.label ?? nodeId,
        method: 'GET',
        url: '',
      };
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/gwddeveloper/opensource/piu && npx tsc --noEmit src/app/utils/graphDataTransform.ts 2>&1 | head -20
```

Note: May show errors from files that import the old exports. That's expected — ForceGraph3DCanvas will be rewritten next.

- [ ] **Step 3: Commit**

```bash
git add src/app/utils/graphDataTransform.ts
git commit -m "refactor: rewrite graphDataTransform for graphology instances"
```

---

## Task 4: Create GraphNodes component (InstancedMesh)

**Files:**
- Create: `src/app/components/graph/GraphNodes.tsx`

- [ ] **Step 1: Create the directory and file**

```bash
mkdir -p /Users/gwddeveloper/opensource/piu/src/app/components/graph
```

Create `src/app/components/graph/GraphNodes.tsx`:

```typescript
'use client';

import { useRef, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { ThreeEvent } from '@react-three/fiber';
import { useGraphStore } from '../../stores/graphStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GraphNodeData {
  id: string;
  x: number;
  y: number;
  z: number;
  size: number;
  color: string;
  entityType: string;
  entityId: string;
}

interface GraphNodesProps {
  nodes: GraphNodeData[];
  selectedNodeId: string | null;
  onNodeClick: (nodeId: string) => void;
  onPointerMissed: () => void;
}

// ---------------------------------------------------------------------------
// Shared geometry + temp objects (created once, reused)
// ---------------------------------------------------------------------------

const _dummy = new THREE.Object3D();
const _color = new THREE.Color();

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GraphNodes({ nodes, selectedNodeId, onNodeClick, onPointerMissed }: GraphNodesProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const sphereGeo = useMemo(() => new THREE.SphereGeometry(1, 16, 16), []);
  const material = useMemo(
    () =>
      new THREE.MeshPhongMaterial({
        vertexColors: true,
        shininess: 30,
      }),
    [],
  );

  // Dispose GPU resources on unmount
  useEffect(() => {
    return () => {
      sphereGeo.dispose();
      material.dispose();
    };
  }, [sphereGeo, material]);

  // Update instance matrices and colors whenever nodes change
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || nodes.length === 0) return;

    const colorAttr = new Float32Array(nodes.length * 3);

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const scale = node.size;

      _dummy.position.set(node.x, node.y, node.z);
      _dummy.scale.set(scale, scale, scale);
      _dummy.updateMatrix();
      mesh.setMatrixAt(i, _dummy.matrix);

      _color.set(node.color);
      colorAttr[i * 3] = _color.r;
      colorAttr[i * 3 + 1] = _color.g;
      colorAttr[i * 3 + 2] = _color.b;
    }

    mesh.instanceMatrix.needsUpdate = true;

    // Per-instance color via InstancedBufferAttribute
    mesh.geometry.setAttribute(
      'instanceColor',
      new THREE.InstancedBufferAttribute(colorAttr, 3),
    );

    mesh.count = nodes.length;
  }, [nodes, material]);

  // Update emissive for selected node
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    // Reset emissive — selection highlighting is done via a separate pass
    // For Phase 1, we keep it simple: no per-instance emissive
    // The selected node is indicated by the MapDetailPanel opening
  }, [selectedNodeId]);

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const instanceId = e.instanceId;
    if (instanceId === undefined) return;
    const nodeIndexToId = useGraphStore.getState().nodeIndexToId;
    const nodeId = nodeIndexToId[instanceId];
    if (nodeId) {
      onNodeClick(nodeId);
    }
  };

  if (nodes.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[sphereGeo, material, nodes.length]}
      onClick={handleClick}
      onPointerMissed={onPointerMissed}
    />
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/components/graph/GraphNodes.tsx
git commit -m "feat: add GraphNodes InstancedMesh component"
```

---

## Task 5: Create GraphEdges component (InstancedMesh)

**Files:**
- Create: `src/app/components/graph/GraphEdges.tsx`

- [ ] **Step 1: Create the file**

Create `src/app/components/graph/GraphEdges.tsx`:

```typescript
'use client';

import { useRef, useEffect, useMemo } from 'react';
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GraphEdgeData {
  sourceX: number;
  sourceY: number;
  sourceZ: number;
  targetX: number;
  targetY: number;
  targetZ: number;
  color: string;
  width: number;
}

interface GraphEdgesProps {
  edges: GraphEdgeData[];
}

// ---------------------------------------------------------------------------
// Shared temp objects
// ---------------------------------------------------------------------------

const _start = new THREE.Vector3();
const _end = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _dummy = new THREE.Object3D();
const _color = new THREE.Color();
const _up = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GraphEdges({ edges }: GraphEdgesProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  // Unit cylinder along Y axis — we'll orient it per instance
  const cylinderGeo = useMemo(() => new THREE.CylinderGeometry(0.05, 0.05, 1, 4), []);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.6,
      }),
    [],
  );

  // Dispose GPU resources on unmount
  useEffect(() => {
    return () => {
      cylinderGeo.dispose();
      material.dispose();
    };
  }, [cylinderGeo, material]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || edges.length === 0) return;

    const colorAttr = new Float32Array(edges.length * 3);

    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i];

      _start.set(edge.sourceX, edge.sourceY, edge.sourceZ);
      _end.set(edge.targetX, edge.targetY, edge.targetZ);

      // Midpoint = position
      _mid.addVectors(_start, _end).multiplyScalar(0.5);

      // Direction + length
      _dir.subVectors(_end, _start);
      const length = _dir.length();

      // Orient cylinder from Y-up to edge direction
      _dir.normalize();
      _quat.setFromUnitVectors(_up, _dir);

      _dummy.position.copy(_mid);
      _dummy.quaternion.copy(_quat);
      _dummy.scale.set(edge.width, length, edge.width);
      _dummy.updateMatrix();
      mesh.setMatrixAt(i, _dummy.matrix);

      _color.set(edge.color);
      colorAttr[i * 3] = _color.r;
      colorAttr[i * 3 + 1] = _color.g;
      colorAttr[i * 3 + 2] = _color.b;
    }

    mesh.instanceMatrix.needsUpdate = true;
    mesh.geometry.setAttribute(
      'instanceColor',
      new THREE.InstancedBufferAttribute(colorAttr, 3),
    );
    material.vertexColors = true;
    material.needsUpdate = true;

    mesh.count = edges.length;
  }, [edges, material]);

  if (edges.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[cylinderGeo, material, edges.length]}
      raycast={() => null}
    />
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/components/graph/GraphEdges.tsx
git commit -m "feat: add GraphEdges InstancedMesh component"
```

---

## Task 6: Create GraphCanvas (R3F scene + FA2 layout)

**Files:**
- Create: `src/app/components/graph/GraphCanvas.tsx`

This is the main orchestration component: loads graph data from Rust, builds graphology instance, runs FA2 layout, renders nodes + edges, handles selection.

- [ ] **Step 1: Create the file**

Create `src/app/components/graph/GraphCanvas.tsx`:

```typescript
'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { invoke } from '@tauri-apps/api/core';
import { Flex, Spin, Empty } from 'antd';
import { WarningOutlined } from '@ant-design/icons';
import Graph from 'graphology';
import FA2Layout from 'graphology-layout-forceatlas2/worker';
import { inferSettings } from 'graphology-layout-forceatlas2';

import { useGraphStore } from '../../stores/graphStore';
import {
  type RustProjectGraphData,
  buildGraphologyInstance,
  hasCachedPositions,
  assignZLayer,
  extractPositionsForSave,
  extractNodeData,
} from '../../utils/graphDataTransform';
import { GraphNodes, type GraphNodeData } from './GraphNodes';
import { GraphEdges, type GraphEdgeData } from './GraphEdges';
import { MapDetailPanel } from '../apiModelMap/MapDetailPanel';
import { MapLegend } from '../apiModelMap/MapLegend';

// ---------------------------------------------------------------------------
// Overlay styles (same as current ForceGraph3DCanvas)
// ---------------------------------------------------------------------------

const OVERLAY_BASE: import('react').CSSProperties = {
  position: 'absolute',
  top: 12,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 10,
  borderRadius: 8,
  padding: '8px 16px',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  backdropFilter: 'blur(8px)',
};

const COMPUTING_STYLE: import('react').CSSProperties = {
  ...OVERLAY_BASE,
  background: 'rgba(10, 10, 15, 0.85)',
  border: '1px solid var(--border)',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface GraphCanvasProps {
  projectId: string | null;
  refreshKey: number;
  onEditModel: (modelId: string) => void;
  onDeleteModel: (modelId: string) => void;
  onOpenRequest?: (requestId: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers: extract renderable data from graphology instance
// ---------------------------------------------------------------------------

function collectNodeData(graph: Graph): GraphNodeData[] {
  const nodes: GraphNodeData[] = [];
  graph.forEachNode((id, attrs) => {
    nodes.push({
      id,
      x: typeof attrs.x === 'number' ? attrs.x : 0,
      y: typeof attrs.y === 'number' ? attrs.y : 0,
      z: typeof attrs.z === 'number' ? attrs.z : 0,
      size: typeof attrs.size === 'number' ? attrs.size : 2,
      color: typeof attrs.color === 'string' ? attrs.color : '#888',
      entityType: attrs.entity_type as string,
      entityId: attrs.entity_id as string,
    });
  });
  return nodes;
}

function collectEdgeData(graph: Graph): GraphEdgeData[] {
  const edges: GraphEdgeData[] = [];
  graph.forEachEdge((_edge, attrs, _source, _target, sAttrs, tAttrs) => {
    edges.push({
      sourceX: typeof sAttrs.x === 'number' ? sAttrs.x : 0,
      sourceY: typeof sAttrs.y === 'number' ? sAttrs.y : 0,
      sourceZ: typeof sAttrs.z === 'number' ? sAttrs.z : 0,
      targetX: typeof tAttrs.x === 'number' ? tAttrs.x : 0,
      targetY: typeof tAttrs.y === 'number' ? tAttrs.y : 0,
      targetZ: typeof tAttrs.z === 'number' ? tAttrs.z : 0,
      color: typeof attrs.color === 'string' ? attrs.color : '#555',
      width: typeof attrs.width === 'number' ? attrs.width : 1,
    });
  });
  return edges;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const MAX_LAYOUT_MS = 10_000;

export default function GraphCanvas({
  projectId,
  refreshKey,
  onEditModel,
  onDeleteModel,
  onOpenRequest,
}: GraphCanvasProps) {
  const layoutRef = useRef<FA2Layout | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number>(0);
  const positionsSavedRef = useRef(false);

  const setGraph = useGraphStore((s) => s.setGraph);
  const setComputing = useGraphStore((s) => s.setComputing);
  const setNodeIndexToId = useGraphStore((s) => s.setNodeIndexToId);
  const selectedNode = useGraphStore((s) => s.selectedNode);
  const setSelectedNode = useGraphStore((s) => s.setSelectedNode);

  const [nodeData, setNodeData] = useState<GraphNodeData[]>([]);
  const [edgeData, setEdgeData] = useState<GraphEdgeData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isComputing, setIsComputingLocal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cleanup function for FA2 layout
  const killLayout = useCallback(() => {
    if (layoutRef.current) {
      layoutRef.current.kill();
      layoutRef.current = null;
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
  }, []);

  // Load graph data from Rust backend
  useEffect(() => {
    if (!projectId) return;

    let cancelled = false;
    killLayout();

    setIsLoading(true);
    setError(null);
    setSelectedNode(null);
    positionsSavedRef.current = false;
    setIsComputingLocal(true);
    setComputing(true);

    invoke<RustProjectGraphData>('build_project_graph', { projectId })
      .then((data) => {
        if (cancelled) return;

        const graph = buildGraphologyInstance(data);
        setGraph(graph);

        // Build stable index mapping
        const indexToId = graph.nodes();
        setNodeIndexToId(indexToId);

        const cached = hasCachedPositions(graph);

        if (cached) {
          // Positions already cached — render immediately, no physics
          assignZLayer(graph);
          setNodeData(collectNodeData(graph));
          setEdgeData(collectEdgeData(graph));
          setIsComputingLocal(false);
          setComputing(false);
        } else {
          // Start FA2 layout in Web Worker
          const layout = new FA2Layout(graph, {
            settings: inferSettings(graph),
          });
          layoutRef.current = layout;
          layout.start();

          // rAF loop: read positions from graph, push to renderer
          function tick() {
            if (cancelled || !layoutRef.current) return;

            assignZLayer(graph);
            setNodeData(collectNodeData(graph));
            setEdgeData(collectEdgeData(graph));

            if (layoutRef.current.isRunning()) {
              rafRef.current = requestAnimationFrame(tick);
            }
          }
          rafRef.current = requestAnimationFrame(tick);

          // Stop after timeout
          timerRef.current = setTimeout(() => {
            if (cancelled) return;
            if (layoutRef.current) {
              layoutRef.current.stop();
              layoutRef.current = null;
            }

            assignZLayer(graph);
            setNodeData(collectNodeData(graph));
            setEdgeData(collectEdgeData(graph));
            setIsComputingLocal(false);
            setComputing(false);

            // Save positions to SQLite
            if (!positionsSavedRef.current) {
              positionsSavedRef.current = true;
              const positions = extractPositionsForSave(graph);
              if (positions.length > 0) {
                invoke('save_graph_positions', { positions }).catch(() => {});
              }
            }
          }, MAX_LAYOUT_MS);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setIsComputingLocal(false);
        setComputing(false);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
      killLayout();
    };
  }, [projectId, refreshKey, killLayout, setGraph, setComputing, setNodeIndexToId, setSelectedNode]);

  // Node click handler
  const handleNodeClick = useCallback(
    (nodeId: string) => {
      const graph = useGraphStore.getState().graph;
      if (!graph || !graph.hasNode(nodeId)) return;
      const attrs = graph.getNodeAttributes(nodeId);
      setSelectedNode({
        nodeId,
        entityType: attrs.entity_type as 'collection' | 'request' | 'model',
        entityId: attrs.entity_id as string,
      });
    },
    [setSelectedNode],
  );

  const handleBackgroundClick = useCallback(() => {
    setSelectedNode(null);
  }, [setSelectedNode]);

  const handleClosePanel = useCallback(() => {
    setSelectedNode(null);
  }, [setSelectedNode]);

  // Extract node data for detail panel
  const detailData = useMemo(() => {
    if (!selectedNode) return null;
    const graph = useGraphStore.getState().graph;
    if (!graph || !graph.hasNode(selectedNode.nodeId)) return null;
    return extractNodeData(graph, selectedNode.nodeId);
  }, [selectedNode]);

  // Extract entity ID from graph node ID (e.g. "model:abc" -> "abc")
  const extractEntityId = (nodeId: string): string => {
    const idx = nodeId.indexOf(':');
    return idx === -1 ? nodeId : nodeId.slice(idx + 1);
  };

  // ---------------------------------------------------------------------------
  // Render states
  // ---------------------------------------------------------------------------

  if (!projectId) {
    return (
      <Flex justify="center" align="center" style={{ width: '100%', flex: 1, minHeight: 0 }}>
        <Empty description="No project selected." />
      </Flex>
    );
  }

  if (isLoading) {
    return (
      <Flex justify="center" align="center" style={{ width: '100%', flex: 1, minHeight: 0 }}>
        <Spin size="large" />
      </Flex>
    );
  }

  if (error && nodeData.length === 0) {
    return (
      <Flex
        justify="center"
        align="center"
        vertical
        gap={8}
        style={{ width: '100%', flex: 1, minHeight: 0 }}
      >
        <WarningOutlined style={{ color: '#ff4d4f', fontSize: 24 }} />
        <span style={{ color: '#ff4d4f', fontSize: 13 }}>
          Failed to load graph: {error}
        </span>
      </Flex>
    );
  }

  if (nodeData.length === 0) {
    return (
      <Flex justify="center" align="center" style={{ width: '100%', flex: 1, minHeight: 0 }}>
        <Empty description="No collections or models yet." />
      </Flex>
    );
  }

  return (
    <div style={{ width: '100%', flex: 1, minHeight: 0, position: 'relative', touchAction: 'none' }}>
      <Canvas
        camera={{ position: [0, 0, 300], fov: 50, near: 1, far: 5000 }}
        style={{ background: 'rgba(10, 10, 15, 1)' }}
        onPointerMissed={handleBackgroundClick}
      >
        <ambientLight intensity={0.5} />
        <pointLight position={[100, 100, 200]} intensity={0.8} />

        <GraphNodes
          nodes={nodeData}
          selectedNodeId={selectedNode?.nodeId ?? null}
          onNodeClick={handleNodeClick}
          onPointerMissed={handleBackgroundClick}
        />
        <GraphEdges edges={edgeData} />

        <OrbitControls
          enablePan
          enableZoom
          enableRotate
          minDistance={20}
          maxDistance={2000}
        />
      </Canvas>

      {isComputing && (
        <div style={COMPUTING_STYLE}>
          <Spin size="small" />
          <span style={{ color: '#fbbf24', fontSize: 12, fontWeight: 500 }}>
            Computing layout...
          </span>
        </div>
      )}

      {error && !isComputing && nodeData.length > 0 && (
        <div style={{ ...COMPUTING_STYLE, border: '1px solid rgba(255, 77, 79, 0.4)', background: 'rgba(30, 10, 10, 0.85)' }}>
          <WarningOutlined style={{ color: '#ff4d4f', fontSize: 14 }} />
          <span style={{ color: '#ff4d4f', fontSize: 12, fontWeight: 500 }}>
            Layout error — {error}
          </span>
        </div>
      )}

      {selectedNode && detailData && (
        <MapDetailPanel
          nodeType={selectedNode.entityType}
          nodeData={detailData}
          nodeId={selectedNode.nodeId}
          onClose={handleClosePanel}
          onEditModel={onEditModel}
          onDeleteModel={onDeleteModel}
          onOpenRequest={onOpenRequest}
        />
      )}

      <MapLegend />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/components/graph/GraphCanvas.tsx
git commit -m "feat: add GraphCanvas with R3F + FA2LayoutSupervisor + InstancedMesh"
```

---

## Task 7: Wire Up — Swap Imports in GraphCenterPanel + ApiModelMapFlow

**Files:**
- Modify: `src/app/components/GraphCenterPanel.tsx`
- Modify: `src/app/components/apiModelMap/ApiModelMapFlow.tsx`

- [ ] **Step 1: Update GraphCenterPanel.tsx**

Replace the dynamic import at the top:

```typescript
const ForceGraph3DCanvas = dynamic(() => import('./apiModelMap/ForceGraph3DCanvas'), {
  ssr: false,
});
```

with:

```typescript
const GraphCanvas = dynamic(() => import('./graph/GraphCanvas'), {
  ssr: false,
});
```

Then replace all usages of `<ForceGraph3DCanvas` with `<GraphCanvas` in the JSX (same props — `projectId`, `refreshKey`, `onEditModel`, `onDeleteModel`, `onOpenRequest`).

Remove the `import { useLayoutComputeStore }` if present (already migrated in Task 2).

- [ ] **Step 2: Update ApiModelMapFlow.tsx**

Same swap:

```typescript
const ForceGraph3DCanvas = dynamic(() => import('./ForceGraph3DCanvas'), {
  ssr: false,
});
```

becomes:

```typescript
const GraphCanvas = dynamic(() => import('../graph/GraphCanvas'), {
  ssr: false,
});
```

Replace `<ForceGraph3DCanvas` with `<GraphCanvas` in JSX.

- [ ] **Step 3: Verify the app compiles**

```bash
bun run dev
```

Open the app, navigate to a project, toggle to Graph view. The 3D graph should render with the new engine. Verify:
- Nodes appear as colored spheres
- Edges appear as thin cylinders connecting nodes
- Orbit controls work (rotate, zoom, pan)
- Click a node -> MapDetailPanel opens
- Click background -> panel closes
- "Computing layout..." overlay shows during FA2, disappears after convergence
- Legend overlay still visible at bottom-left

- [ ] **Step 4: Commit**

```bash
git add src/app/components/GraphCenterPanel.tsx src/app/components/apiModelMap/ApiModelMapFlow.tsx
git commit -m "feat: wire GraphCanvas into GraphCenterPanel and ApiModelMapFlow"
```

---

## Task 8: Cleanup — Delete Old Files

**Files:**
- Delete: `src/app/components/apiModelMap/ForceGraph3DCanvas.tsx`
- Delete: `src/app/stores/layoutComputeStore.ts`

- [ ] **Step 1: Verify no remaining imports**

```bash
grep -r "ForceGraph3DCanvas\|layoutComputeStore" src/ --include="*.ts" --include="*.tsx"
```

Expected: No matches (or only the deleted files themselves).

- [ ] **Step 2: Delete the files**

```bash
rm src/app/components/apiModelMap/ForceGraph3DCanvas.tsx
rm src/app/stores/layoutComputeStore.ts
```

- [ ] **Step 3: Verify build**

```bash
bun run dev
```

App should start without errors.

- [ ] **Step 4: Commit**

```bash
git add -u
git commit -m "chore: remove old ForceGraph3DCanvas and layoutComputeStore"
```

---

## Task 9: Smoke Test — Verify Visual Parity

This is a manual verification task, not a code task.

- [ ] **Step 1: Open the app and load a project with collections + requests + models**

- [ ] **Step 2: Toggle to Graph view — verify nodes render**

Check:
- Collection nodes (amber spheres)
- Request nodes (colored by HTTP method: green=GET, amber=POST, blue=PUT, red=DELETE)
- Model nodes (blue spheres)
- Node sizes vary (collections larger based on request count, models based on field count)

- [ ] **Step 3: Verify edges render**

Check:
- Edges connect correct nodes
- Edge colors match the legend
- Edges are thin cylinders (straight — not curved like before, this is intentional)

- [ ] **Step 4: Verify interactions**

Check:
- Orbit: mouse drag rotates, scroll zooms, right-drag pans
- Click node: MapDetailPanel opens on right side
- Click background: panel closes
- Click a model node: Edit/Delete buttons in panel work
- Click a request node: "Open in Editor" button works

- [ ] **Step 5: Verify layout computation**

Check:
- "Computing layout..." overlay appears during first load
- After ~10 seconds, overlay disappears
- Close graph, reopen: positions are cached, no layout computation overlay

- [ ] **Step 6: Test the modal variant**

Open the graph via the modal button (if available). Same checks apply.

- [ ] **Step 7: Record any regressions**

If anything is broken, create a follow-up task. Do not block the commit — Phase 1 target is "visual parity", not "pixel-perfect match".

---

## Summary

| Task | Description | Files touched |
|------|-------------|---------------|
| 1 | Install deps | `package.json` |
| 2 | Create graphStore | `stores/graphStore.ts`, `StatusBar.tsx` |
| 3 | Rewrite graphDataTransform | `utils/graphDataTransform.ts` |
| 4 | Create GraphNodes | `components/graph/GraphNodes.tsx` |
| 5 | Create GraphEdges | `components/graph/GraphEdges.tsx` |
| 6 | Create GraphCanvas | `components/graph/GraphCanvas.tsx` |
| 7 | Wire up imports | `GraphCenterPanel.tsx`, `ApiModelMapFlow.tsx` |
| 8 | Delete old files | `ForceGraph3DCanvas.tsx`, `layoutComputeStore.ts` |
| 9 | Smoke test | Manual verification |

Total: 8 code tasks + 1 verification task. Each task produces a single commit.
