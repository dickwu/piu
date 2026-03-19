# Graph Auto-Fusion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add automatic semantic node clustering with metaball SDF visualization to PIU's graph view, converting from 3D to 2D orthographic rendering.

**Architecture:** Keep R3F/Three.js as the renderer but switch to OrthographicCamera (2D). Add a 4-step clustering algorithm (Louvain + URL refinement) that produces `ClusterInfo` groups. Render cluster boundaries via a fullscreen SDF fragment shader. Two view modes: overview (dimmed nodes inside metaball blobs) and focus (zoom into one cluster with stub edges to others).

**Tech Stack:** React Three Fiber, Three.js (OrthographicCamera, RawShaderMaterial, InstancedMesh), graphology + graphology-communities-louvain, Zustand, GLSL ES 3.0

**Spec:** `docs/specs/2026-03-19-graph-auto-fusion-design.md` (Rev 3)

**Note:** PIU has no test infrastructure yet. Steps use manual verification (`bun tauri dev` visual checks) instead of unit tests.

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/app/utils/graphClustering.ts` | 4-step clustering algorithm: Louvain base → URL-prefix split → small-community merge → palette assignment. Exports `computeClusters()` and `ClusterInfo` type. |
| `src/app/components/graph/GraphClusterMetaballs.tsx` | R3F component: fullscreen quad with `RawShaderMaterial` that renders metaball SDF per cluster. Updates NDC positions in `useFrame`. |
| `src/app/components/graph/GraphStubEdges.tsx` | R3F component: InstancedMesh cylinders showing external connections during focus mode. Reuses orientation math from `GraphEdges.tsx`. |

### Modified Files

| File | Changes |
|------|---------|
| `src/app/stores/graphStore.ts` | Add Phase 4 cluster state: `clusterMode`, `clusters`, `focusedClusterId`, `focusOverrideNodeIds`, `preFocusZoom`, `preFocusPosition` |
| `src/app/utils/graphDataTransform.ts` | Remove `Z_LAYER` constant, `assignZLayer()` export. Set z=0 in `buildGraphologyInstance()`. |
| `src/app/components/graph/GraphCanvas.tsx` | OrthographicCamera, `camera.layers.enable(1)`, cluster orchestration, `effectiveVisibleIds`, click branching, import `GraphClusterMetaballs` + `GraphStubEdges` |
| `src/app/components/graph/GraphNodes.tsx` | z=0 for positions. In overview mode: apply 0.6x scale + 0.4x color dimming. |
| `src/app/components/graph/GraphEdges.tsx` | z=0 for positions. Hidden when `clusterMode === 'overview'`. |
| `src/app/components/graph/GraphToolbar.tsx` | Cluster toggle button, "Back to overview" button, cluster dropdown. |
| `src/app/components/graph/GraphTooltip.tsx` | Show cluster info on hover in overview mode. |
| `src/app/components/graph/GraphMinimap.tsx` | Draw bounding circles for clusters in overview mode. |
| `src/app/utils/graphQueryEngine.ts` | Add `fuse`/`unfuse`/`focus <name>` patterns. |

---

## Task 1: Add Phase 4 Cluster State to graphStore

**Files:**
- Modify: `src/app/stores/graphStore.ts:14-80` (interface), `src/app/stores/graphStore.ts:86-165` (implementation)

- [ ] **Step 1: Add ClusterInfo import and Phase 4 fields to the interface**

**Note:** `ClusterInfo` is defined in `graphClustering.ts` (Task 3). Since Task 3 hasn't been created yet, add a temporary local type here. Task 3 will replace it with an import from `graphClustering.ts`.

Add after the `SelectedNode` interface (line 14):

```typescript
// TEMPORARY — will be replaced by import from '../utils/graphClustering' in Task 3
export interface ClusterInfo {
  id: string;
  name: string;
  color: string;
  nodeIds: Set<string>;
  centroid: { x: number; y: number };
}
```

Add to the `GraphStore` interface after `clearFitView` (line 79):

```typescript
// --- Phase 4: Cluster fusion ---
clusterMode: 'overview' | 'focus' | 'off';
setClusterMode: (mode: 'overview' | 'focus' | 'off') => void;

clusters: Map<string, ClusterInfo>;
setClusters: (clusters: Map<string, ClusterInfo>) => void;

focusedClusterId: string | null;
setFocusedClusterId: (id: string | null) => void;

focusOverrideNodeIds: Set<string> | null;
setFocusOverrideNodeIds: (ids: Set<string> | null) => void;

preFocusZoom: number;
preFocusPosition: { x: number; y: number };
setPreFocusState: (zoom: number, position: { x: number; y: number }) => void;
```

- [ ] **Step 2: Add Phase 4 implementation to the store**

Add after the `clearFitView` implementation (line 164):

```typescript
// Phase 4: Cluster fusion
clusterMode: 'off',
setClusterMode: (mode) => set({ clusterMode: mode }),

clusters: new Map(),
setClusters: (clusters) => set({ clusters }),

focusedClusterId: null,
setFocusedClusterId: (id) => set({ focusedClusterId: id }),

focusOverrideNodeIds: null,
setFocusOverrideNodeIds: (ids) => set({ focusOverrideNodeIds: ids }),

preFocusZoom: 1.5,
preFocusPosition: { x: 0, y: 0 },
setPreFocusState: (zoom, position) => set({ preFocusZoom: zoom, preFocusPosition: position }),
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd src-tauri && cargo check 2>&1 | head -5` (backend unchanged, just sanity).
Run: `npx tsc --noEmit 2>&1 | grep -c "error"` — should be 0 new errors from this change.

- [ ] **Step 4: Commit**

```bash
git add src/app/stores/graphStore.ts
git commit -m "feat(graph): add Phase 4 cluster fusion state to graphStore"
```

---

## Task 2: Remove Z-Layers and Switch to Orthographic Camera

**Files:**
- Modify: `src/app/utils/graphDataTransform.ts:49-53` (remove Z_LAYER), `src/app/utils/graphDataTransform.ts:122-127` (remove assignZLayer)
- Modify: `src/app/components/graph/GraphCanvas.tsx:30,342,644` (remove assignZLayer import/call, swap camera)
- Modify: `src/app/components/graph/GraphNodes.tsx:61` (z=0)
- Modify: `src/app/components/graph/GraphEdges.tsx:53-54` (z=0)

- [ ] **Step 1: Remove Z_LAYER and assignZLayer from graphDataTransform.ts**

Delete the `Z_LAYER` constant (lines 49-53). Delete the `assignZLayer` function (lines 122-127). Remove `assignZLayer` from the exports.

In `buildGraphologyInstance`, change line 79:
```typescript
// Before:
z: node.fz ?? Z_LAYER[node.entity_type] ?? 0,
// After:
z: 0,
```

- [ ] **Step 2: Remove assignZLayer import and call from GraphCanvas.tsx**

Remove `assignZLayer` from the import on line 30. Remove `assignZLayer(graph)` call on line 342.

- [ ] **Step 3: Switch Canvas camera to OrthographicCamera**

In `GraphCanvas.tsx`, add import:
```typescript
import { OrbitControls, OrthographicCamera } from '@react-three/drei';
```

Replace the `<Canvas>` tag (line 642-647). **Remove the `camera={...}` prop** — it conflicts with `<OrthographicCamera makeDefault>`:
```typescript
<Canvas
  style={{ position: 'absolute', inset: 0 }}
  gl={{ antialias: true }}
  onPointerMissed={handleDeselect}
>
  <OrthographicCamera makeDefault zoom={1.5} near={-100} far={100} position={[0, 0, 10]} />
```

Remove the lighting (lines 649-650 — `MeshBasicMaterial` doesn't need lights):
```typescript
// DELETE these two lines:
<ambientLight intensity={0.6} />
<directionalLight position={[200, 200, 200]} intensity={0.8} />
```

- [ ] **Step 4: Update CameraController for orthographic**

In the `CameraController` component (line 135), update `OrbitControls`:
```typescript
return <OrbitControls ref={controlsRef} makeDefault enableRotate={false} enableDamping dampingFactor={0.1} />;
```

Also update `setFlyTarget` calls (lines 157-161) to always use z=10 (camera stays at z=10 in 2D mode):
```typescript
setFlyTarget(new THREE.Vector3(x, y, 10)); // was: new THREE.Vector3(x, y, z)
```

Update the fly-to logic in `useFrame` (lines 187-194) — remove the perspective-specific "move camera closer" code and use position lerp instead:
```typescript
// Remove the currentOffset/desiredPos block (lines 188-194).
// Replace with:
camera.position.lerp(
  new THREE.Vector3(flyTarget.x, flyTarget.y, 10),
  ease * 0.5
);
```

- [ ] **Step 5: Set z=0 in collectNodeData**

In `GraphCanvas.tsx` `collectNodeData()` (line 100), change:
```typescript
// Before:
z: typeof attrs.z === 'number' ? attrs.z : 0,
// After:
z: 0,
```

- [ ] **Step 6: Verify with `bun tauri dev`**

Open the app, navigate to a project with graph data. Confirm:
- Graph renders in 2D (no depth perspective)
- Pan and zoom work (no rotation)
- Nodes are all on the same plane
- FA2 layout still runs and positions nodes

- [ ] **Step 7: Commit**

```bash
git add src/app/utils/graphDataTransform.ts src/app/components/graph/GraphCanvas.tsx src/app/components/graph/GraphNodes.tsx src/app/components/graph/GraphEdges.tsx
git commit -m "refactor(graph): switch to 2D orthographic camera, remove z-layers"
```

---

## Task 3: Implement Semantic Clustering Algorithm

**Files:**
- Create: `src/app/utils/graphClustering.ts`

- [ ] **Step 1: Create graphClustering.ts with ClusterInfo type and computeClusters function**

```typescript
import Graph from 'graphology';

// Re-export for store consumers
export interface ClusterInfo {
  id: string;
  name: string;
  color: string;
  nodeIds: Set<string>;
  centroid: { x: number; y: number };
}

const CLUSTER_PALETTE = [
  '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
  '#14b8a6', '#e11d48', '#a855f7', '#0ea5e9', '#d946ef',
  '#22c55e', '#eab308', '#f43f5e', '#2dd4bf', '#818cf8',
  '#fb923c', '#4ade80', '#38bdf8', '#c084fc',
];

const MIN_CLUSTER_SIZE_FOR_SPLIT = 3;
const MIN_GRAPH_SIZE_FOR_CLUSTERING = 5;

/**
 * 4-step clustering: Louvain → URL-prefix split → small-community merge → palette.
 * Requires that `assignCommunities(graph)` has already been called.
 */
export function computeClusters(graph: Graph): Map<string, ClusterInfo> {
  if (graph.order < MIN_GRAPH_SIZE_FOR_CLUSTERING) return new Map();

  // Step 1: Group nodes by Louvain community_rank
  const communityGroups = new Map<number, Set<string>>();
  graph.forEachNode((nodeId, attrs) => {
    const rank = (attrs.community_rank as number) ?? 0;
    if (!communityGroups.has(rank)) communityGroups.set(rank, new Set());
    communityGroups.get(rank)!.add(nodeId);
  });

  // Step 2: URL-prefix split
  let nextClusterId = 0;
  const clusters = new Map<string, Set<string>>();

  for (const [_rank, nodeIds] of communityGroups) {
    const prefixBuckets = new Map<string, Set<string>>();
    const nonRequestNodes = new Set<string>();

    for (const nodeId of nodeIds) {
      const attrs = graph.getNodeAttributes(nodeId);
      if (attrs.entity_type === 'request') {
        const props = (attrs.properties ?? {}) as Record<string, unknown>;
        const url = (props.url as string) ?? '';
        const prefix = extractFirstPathSegment(url);
        if (!prefixBuckets.has(prefix)) prefixBuckets.set(prefix, new Set());
        prefixBuckets.get(prefix)!.add(nodeId);
      } else {
        nonRequestNodes.add(nodeId);
      }
    }

    // Check if we should split
    const significantPrefixes = [...prefixBuckets.entries()]
      .filter(([, nodes]) => nodes.size >= MIN_CLUSTER_SIZE_FOR_SPLIT);

    if (significantPrefixes.length >= 2) {
      // Split into sub-clusters by prefix
      for (const [, prefixNodes] of significantPrefixes) {
        const cid = `cluster-${nextClusterId++}`;
        clusters.set(cid, prefixNodes);
      }
      // Remaining small-prefix requests + non-request nodes go into one cluster
      const remainder = new Set<string>(nonRequestNodes);
      for (const [, prefixNodes] of prefixBuckets) {
        if (prefixNodes.size < MIN_CLUSTER_SIZE_FOR_SPLIT) {
          for (const n of prefixNodes) remainder.add(n);
        }
      }
      if (remainder.size > 0) {
        const cid = `cluster-${nextClusterId++}`;
        clusters.set(cid, remainder);
      }
    } else {
      // Keep as one cluster
      const cid = `cluster-${nextClusterId++}`;
      clusters.set(cid, nodeIds);
    }
  }

  // Attach models to the cluster of the request that references them most
  attachModelsToRequestClusters(graph, clusters);

  // Step 3: Merge small clusters with shared prefix
  mergeSmallClusters(graph, clusters);

  // Step 4: Assign palette + compute names + centroids
  return buildClusterInfoMap(graph, clusters);
}

function extractFirstPathSegment(url: string): string {
  const cleaned = url.replace(/^\/?/, '');
  const firstSlash = cleaned.indexOf('/');
  const segment = firstSlash >= 0 ? cleaned.slice(0, firstSlash) : cleaned;
  // Strip template params
  return segment.replace(/\{\{.*?\}\}/g, '').replace(/:.+/, '') || '_root';
}

function attachModelsToRequestClusters(
  graph: Graph,
  clusters: Map<string, Set<string>>,
): void {
  // Find model nodes not yet in any cluster
  const assignedNodes = new Set<string>();
  for (const nodeIds of clusters.values()) {
    for (const n of nodeIds) assignedNodes.add(n);
  }

  graph.forEachNode((nodeId, attrs) => {
    if (attrs.entity_type !== 'model' || assignedNodes.has(nodeId)) return;

    // Count edges to each cluster
    const clusterEdgeCounts = new Map<string, number>();
    graph.forEachEdge(nodeId, (_edge, _eAttrs, source, target) => {
      const neighbor = source === nodeId ? target : source;
      for (const [cid, nodeIds] of clusters) {
        if (nodeIds.has(neighbor)) {
          clusterEdgeCounts.set(cid, (clusterEdgeCounts.get(cid) ?? 0) + 1);
        }
      }
    });

    // Attach to cluster with most edges
    let bestCluster = '';
    let bestCount = 0;
    for (const [cid, count] of clusterEdgeCounts) {
      if (count > bestCount) {
        bestCluster = cid;
        bestCount = count;
      }
    }

    if (bestCluster) {
      clusters.get(bestCluster)!.add(nodeId);
    }
  });
}

function mergeSmallClusters(
  graph: Graph,
  clusters: Map<string, Set<string>>,
): void {
  const smallClusters = [...clusters.entries()]
    .filter(([, nodes]) => nodes.size <= 3);

  for (let i = 0; i < smallClusters.length; i++) {
    const [cidA, nodesA] = smallClusters[i];
    if (!clusters.has(cidA)) continue; // already merged

    const prefixA = getDominantPrefix(graph, nodesA);

    for (let j = i + 1; j < smallClusters.length; j++) {
      const [cidB, nodesB] = smallClusters[j];
      if (!clusters.has(cidB)) continue;

      const prefixB = getDominantPrefix(graph, nodesB);
      if (prefixA && prefixB && prefixA === prefixB) {
        // Merge B into A
        for (const n of nodesB) nodesA.add(n);
        clusters.delete(cidB);
      }
    }
  }
}

function getDominantPrefix(graph: Graph, nodeIds: Set<string>): string | null {
  const counts = new Map<string, number>();
  for (const nodeId of nodeIds) {
    const attrs = graph.getNodeAttributes(nodeId);
    if (attrs.entity_type === 'request') {
      const props = (attrs.properties ?? {}) as Record<string, unknown>;
      const url = (props.url as string) ?? '';
      const prefix = extractFirstPathSegment(url);
      counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
    }
  }
  let best = '';
  let bestCount = 0;
  for (const [prefix, count] of counts) {
    if (count > bestCount) {
      best = prefix;
      bestCount = count;
    }
  }
  return best || null;
}

function getClusterName(graph: Graph, nodeIds: Set<string>): string {
  // Priority 1: collection name
  for (const nodeId of nodeIds) {
    const attrs = graph.getNodeAttributes(nodeId);
    if (attrs.entity_type === 'collection') {
      const props = (attrs.properties ?? {}) as Record<string, unknown>;
      return (props.name as string) ?? (attrs.label as string) ?? 'Collection';
    }
  }
  // Priority 2: dominant URL prefix
  const prefix = getDominantPrefix(graph, nodeIds);
  if (prefix && prefix !== '_root') {
    return `/${prefix}`;
  }
  return 'Cluster';
}

function buildClusterInfoMap(
  graph: Graph,
  clusters: Map<string, Set<string>>,
): Map<string, ClusterInfo> {
  // Sort clusters by size (largest first) for stable palette
  const sorted = [...clusters.entries()]
    .sort((a, b) => b[1].size - a[1].size);

  const result = new Map<string, ClusterInfo>();
  const usedNames = new Set<string>();

  for (let i = 0; i < sorted.length; i++) {
    const [cid, nodeIds] = sorted[i];

    // Compute centroid
    let cx = 0;
    let cy = 0;
    let count = 0;
    for (const nodeId of nodeIds) {
      const attrs = graph.getNodeAttributes(nodeId);
      cx += typeof attrs.x === 'number' ? attrs.x : 0;
      cy += typeof attrs.y === 'number' ? attrs.y : 0;
      count++;
    }
    if (count > 0) {
      cx /= count;
      cy /= count;
    }

    // Generate unique name
    let name = getClusterName(graph, nodeIds);
    if (usedNames.has(name)) {
      let suffix = 2;
      while (usedNames.has(`${name} ${suffix}`)) suffix++;
      name = `${name} ${suffix}`;
    }
    usedNames.add(name);

    result.set(cid, {
      id: cid,
      name,
      color: CLUSTER_PALETTE[i % CLUSTER_PALETTE.length],
      nodeIds,
      centroid: { x: cx, y: cy },
    });
  }

  return result;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep "graphClustering"` — should show no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/utils/graphClustering.ts
git commit -m "feat(graph): add 4-step semantic clustering algorithm"
```

---

## Task 4: Implement Metaball SDF Shader Renderer

**Files:**
- Create: `src/app/components/graph/GraphClusterMetaballs.tsx`

- [ ] **Step 1: Create the metaball shader component**

```typescript
'use client';

import { useRef, useMemo, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { ClusterInfo } from '../../utils/graphClustering';
import type { GraphNodeData } from './GraphNodes';

const MAX_NODES = 512;
const MAX_CLUSTERS = 24;

// Pre-allocated scratch objects (avoid per-frame GC)
const _mvp = new THREE.Matrix4();
const _v4 = new THREE.Vector4();

const vertexShader = `#version 300 es
in vec3 position;
in vec2 uv;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0); // clip-space fullscreen quad
}
`;

const fragmentShader = `#version 300 es
precision highp float;

const int MAX_NODES = 512;
const int MAX_CLUSTERS = 24;

uniform vec2 u_nodePositions[MAX_NODES];
uniform float u_nodeCluster[MAX_NODES];
uniform vec3 u_clusterColors[MAX_CLUSTERS];
uniform int u_nodeCount;
uniform float u_blobRadius;
uniform float u_threshold;

in vec2 vUv;
out vec4 fragColor;

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;

  float clusterField[MAX_CLUSTERS];
  for (int c = 0; c < MAX_CLUSTERS; c++) clusterField[c] = 0.0;

  for (int i = 0; i < MAX_NODES; i++) {
    if (i >= u_nodeCount) break;
    vec2 diff = ndc - u_nodePositions[i];
    float distSq = dot(diff, diff);
    float r = u_blobRadius;
    float field = (r * r) / max(distSq, 0.0001);
    int cluster = int(u_nodeCluster[i]);
    if (cluster >= 0 && cluster < MAX_CLUSTERS) {
      clusterField[cluster] += field;
    }
  }

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
    alpha = min(alpha, 0.18);
    fragColor = vec4(u_clusterColors[maxCluster], alpha);
  } else {
    discard;
  }
}
`;

interface GraphClusterMetaballsProps {
  nodes: GraphNodeData[];
  clusters: Map<string, ClusterInfo>;
  enabled: boolean;
  focusedClusterId: string | null;
}

export function GraphClusterMetaballs({
  nodes,
  clusters,
  enabled,
  focusedClusterId,
}: GraphClusterMetaballsProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const { camera } = useThree();

  // Build cluster index lookup: nodeId → cluster index (0-based)
  const clusterIndex = useMemo(() => {
    const map = new Map<string, number>();
    const clusterArr = [...clusters.values()];
    for (let ci = 0; ci < clusterArr.length; ci++) {
      // In focus mode, only include the focused cluster
      if (focusedClusterId && clusterArr[ci].id !== focusedClusterId) continue;
      for (const nodeId of clusterArr[ci].nodeIds) {
        map.set(nodeId, ci);
      }
    }
    return map;
  }, [clusters, focusedClusterId]);

  // Pre-allocate uniform arrays
  const uniforms = useMemo(() => {
    const posArr = new Float32Array(MAX_NODES * 2).fill(99999.0);
    const clusterArr = new Float32Array(MAX_NODES).fill(-1);
    const colorArr = new Float32Array(MAX_CLUSTERS * 3).fill(0);

    return {
      u_nodePositions: { value: posArr },
      u_nodeCluster: { value: clusterArr },
      u_clusterColors: { value: colorArr },
      u_nodeCount: { value: 0 },
      u_blobRadius: { value: 0.08 },
      u_threshold: { value: 1.0 },
    };
  }, []);

  // Update cluster colors when clusters change
  useMemo(() => {
    const clusterArr = [...clusters.values()];
    const colorArr = uniforms.u_clusterColors.value as Float32Array;
    for (let i = 0; i < MAX_CLUSTERS; i++) {
      if (i < clusterArr.length) {
        const c = new THREE.Color(clusterArr[i].color);
        colorArr[i * 3] = c.r;
        colorArr[i * 3 + 1] = c.g;
        colorArr[i * 3 + 2] = c.b;
      }
    }
  }, [clusters, uniforms]);

  // Assign mesh to layer 1 (excluded from bloom) — must use ref, not JSX prop
  useEffect(() => {
    if (meshRef.current) {
      meshRef.current.layers.set(1);
    }
  }, []);

  // Update node positions in NDC every frame
  useFrame(() => {
    if (!enabled || nodes.length === 0) return;

    camera.updateMatrixWorld();
    _mvp.copy(camera.projectionMatrix).multiply(camera.matrixWorldInverse);

    const posArr = uniforms.u_nodePositions.value as Float32Array;
    const clusterArr = uniforms.u_nodeCluster.value as Float32Array;
    let count = 0;

    for (let i = 0; i < nodes.length && count < MAX_NODES; i++) {
      const node = nodes[i];
      const ci = clusterIndex.get(node.id);
      if (ci === undefined) continue;

      _v4.set(node.x, node.y, 0, 1).applyMatrix4(_mvp);
      posArr[count * 2] = _v4.x / _v4.w;
      posArr[count * 2 + 1] = _v4.y / _v4.w;
      clusterArr[count] = ci;
      count++;
    }

    // Pad remaining with far-away positions
    for (let i = count; i < MAX_NODES; i++) {
      posArr[i * 2] = 99999.0;
      posArr[i * 2 + 1] = 99999.0;
      clusterArr[i] = -1;
    }

    uniforms.u_nodeCount.value = count;
  });

  if (!enabled || clusters.size === 0) return null;

  return (
    <mesh
      ref={meshRef}
      position={[0, 0, -1]}
      frustumCulled={false}
      raycast={() => null}
    >
      <planeGeometry args={[2, 2]} />
      <rawShaderMaterial
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        side={THREE.DoubleSide}
        glslVersion={THREE.GLSL3}
      />
    </mesh>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep "GraphClusterMetaballs"` — should show no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/components/graph/GraphClusterMetaballs.tsx
git commit -m "feat(graph): add metaball SDF shader renderer component"
```

---

## Task 5: Wire Overview Mode into GraphCanvas

**Files:**
- Modify: `src/app/components/graph/GraphCanvas.tsx`
- Modify: `src/app/components/graph/GraphNodes.tsx`
- Modify: `src/app/components/graph/GraphEdges.tsx`

- [ ] **Step 1: Import clustering + metaballs in GraphCanvas.tsx**

Add imports at the top of `GraphCanvas.tsx`:
```typescript
import { computeClusters } from '../../utils/graphClustering';
import { GraphClusterMetaballs } from './GraphClusterMetaballs';
```

- [ ] **Step 2: Call computeClusters after assignCommunities**

**For cached positions path only** (line 357-358 area, after `assignCommunities` and `assignDegreeCentrality`), add:
```typescript
const clusterMap = computeClusters(graph);
useGraphStore.getState().setClusters(clusterMap);
if (clusterMap.size >= 2) {
  useGraphStore.getState().setClusterMode('overview');
} else {
  useGraphStore.getState().setClusterMode('off');
}
```

**For the FA2 path**, do NOT call `computeClusters` here — FA2 hasn't converged yet, so positions are random noise. Instead, add the clustering call inside `stopLayout()` (lines 299-312), after the final position snapshot:
```typescript
const stopLayout = useCallback(
  (graph: Graph) => {
    killLayout();
    setNodeData(collectNodeData(graph));
    setEdgeData(collectEdgeData(graph));
    savePositions(graph);

    // Clustering runs AFTER FA2 converges — positions are now valid
    const clusterMap = computeClusters(graph);
    useGraphStore.getState().setClusters(clusterMap);
    if (clusterMap.size >= 2) {
      useGraphStore.getState().setClusterMode('overview');
    } else {
      useGraphStore.getState().setClusterMode('off');
    }

    setIsComputingLocal(false);
    setComputing(false);
  },
  [killLayout, savePositions, setComputing],
);
```

**Note:** The `>= 2` threshold ensures single-cluster graphs don't enter overview mode. This is the final condition (no need for Task 12 refinement).

- [ ] **Step 3: Compute effectiveVisibleIds and pass to GraphNodes**

Add store selectors in the component:
```typescript
const clusterMode = useGraphStore((s) => s.clusterMode);
const clusters = useGraphStore((s) => s.clusters);
const focusedClusterId = useGraphStore((s) => s.focusedClusterId);
const focusOverrideNodeIds = useGraphStore((s) => s.focusOverrideNodeIds);
```

Compute effective visible set before the JSX:
```typescript
const effectiveVisibleIds = focusOverrideNodeIds ?? visibleNodeIds;
```

Pass `effectiveVisibleIds` instead of `visibleNodeIds` to `<GraphNodes>`:
```typescript
<GraphNodes
  ...
  visibleNodeIds={effectiveVisibleIds}
  clusterMode={clusterMode}
  ...
/>
```

- [ ] **Step 4: Add clusterMode prop to GraphNodes for dimming**

In `GraphNodes.tsx`, add `clusterMode` to the props interface:
```typescript
interface GraphNodesProps {
  // ... existing props
  clusterMode: 'overview' | 'focus' | 'off';
}
```

In the render effect (line 56-77), after the `dimFactor` calculation, add overview dimming:
```typescript
const inPath = pathNodeIds.size === 0 || pathNodeIds.has(node.id);
const dimFactor = inPath ? 1.0 : 0.25;
const overviewDim = clusterMode === 'overview' ? 0.4 : 1.0;
const scaleFactor = clusterMode === 'overview' ? 0.6 : 1.0;

const scale = isVisible ? node.size * scaleFactor : 0;

_dummy.position.set(node.x, node.y, 0);
_dummy.scale.set(scale, scale, scale);
_dummy.updateMatrix();
mesh.setMatrixAt(i, _dummy.matrix);

_color.set(node.color);
_color.multiplyScalar(dimFactor * overviewDim);
mesh.setColorAt(i, _color);
```

- [ ] **Step 5: Hide edges in overview mode**

In `GraphEdges.tsx`, add a `hidden` prop:
```typescript
interface GraphEdgesProps {
  edges: GraphEdgeData[];
  hidden?: boolean;
}

export function GraphEdges({ edges, hidden }: GraphEdgesProps) {
  // ...
  if (edges.length === 0 || hidden) return null;
  // ...
```

In `GraphCanvas.tsx`, pass `hidden` based on cluster mode:
```typescript
<GraphEdges edges={edgeData} hidden={clusterMode === 'overview'} />
```

- [ ] **Step 6: Add GraphClusterMetaballs to the Canvas**

Inside the `<Canvas>` JSX, after `<GraphEdges>`, add:
```typescript
<GraphClusterMetaballs
  nodes={nodeData}
  clusters={clusters}
  enabled={clusterMode !== 'off'}
  focusedClusterId={focusedClusterId}
/>
```

- [ ] **Step 7: Add cluster name labels at centroids**

Import `Html` from drei and render cluster labels in overview mode. Inside the `<Canvas>`, after `<GraphClusterMetaballs>`:
```typescript
import { OrbitControls, OrthographicCamera, Html } from '@react-three/drei';

// In JSX:
{clusterMode === 'overview' && [...clusters.values()].map((cluster) => (
  cluster.nodeIds.size >= 2 && (
    <Html
      key={cluster.id}
      position={[cluster.centroid.x, cluster.centroid.y, 0.5]}
      center
      style={{
        color: cluster.color,
        fontSize: 12,
        fontWeight: 600,
        textShadow: '0 1px 4px rgba(0,0,0,0.8)',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {cluster.name}
    </Html>
  )
))}
```

- [ ] **Step 8: Enable camera layer 1 for metaball visibility**

In `CameraController`, add at the top of the component:
```typescript
useEffect(() => {
  camera.layers.enable(1);
}, [camera]);
```

- [ ] **Step 8: Verify with `bun tauri dev`**

Open the app. Confirm:
- Metaball blobs appear behind the dimmed nodes
- Nodes are smaller (0.6x) and dimmer in overview mode
- Edges are hidden in overview mode
- The graph is still functional (pan, zoom, hover)

- [ ] **Step 9: Commit**

```bash
git add src/app/components/graph/GraphCanvas.tsx src/app/components/graph/GraphNodes.tsx src/app/components/graph/GraphEdges.tsx
git commit -m "feat(graph): wire overview mode with metaball blobs and dimmed nodes"
```

---

## Task 6: Implement Focus Mode and Camera Transitions

**Files:**
- Modify: `src/app/components/graph/GraphCanvas.tsx`

- [ ] **Step 1: Add findClusterForNode to graphClustering.ts (shared utility)**

In `src/app/utils/graphClustering.ts`, add at the end of the file (this will be used by GraphCanvas, GraphTooltip, and others):
```typescript
/** Find which cluster a node belongs to. Returns cluster ID or null. */
export function findClusterForNode(
  nodeId: string,
  clusters: Map<string, ClusterInfo>,
): string | null {
  for (const [cid, cluster] of clusters) {
    if (cluster.nodeIds.has(nodeId)) return cid;
  }
  return null;
}
```

Then import it in `GraphCanvas.tsx`:
```typescript
import { computeClusters, findClusterForNode } from '../../utils/graphClustering';
```

- [ ] **Step 2: Modify handleNodeClick to branch on clusterMode**

Replace the existing `handleNodeClick` (lines 502-527) to add overview branching:
```typescript
const handleNodeClick = useCallback(
  (nodeId: string, event?: { shiftKey?: boolean }) => {
    const graph = graphRef.current;
    if (!graph || !graph.hasNode(nodeId)) return;

    const { clusterMode, clusters } = useGraphStore.getState();

    // Overview mode: clicking focuses the cluster, not the node
    if (clusterMode === 'overview' && !event?.shiftKey) {
      const clusterId = findClusterForNode(nodeId, clusters);
      if (clusterId) {
        const cluster = clusters.get(clusterId);
        if (cluster) {
          useGraphStore.getState().setFocusedClusterId(clusterId);
          useGraphStore.getState().setFocusOverrideNodeIds(cluster.nodeIds);
          useGraphStore.getState().setClusterMode('focus');
        }
      }
      return;
    }

    // Existing behavior: shift+click path, normal click select
    const current = useGraphStore.getState().selectedNode;
    if (event?.shiftKey && current && current.nodeId !== nodeId) {
      const path = findShortestPath(graph, current.nodeId, nodeId);
      if (path) {
        useGraphStore.getState().setPathNodeIds(new Set(path));
      }
      return;
    }

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

- [ ] **Step 3: Add camera transition state to CameraController**

In `CameraController`, add focus transition logic. Add a `focusTarget` state alongside the existing `flyTarget`:
```typescript
const clusterMode = useGraphStore((s) => s.clusterMode);
const focusedClusterId = useGraphStore((s) => s.focusedClusterId);
const clusters = useGraphStore((s) => s.clusters);

const [focusTransition, setFocusTransition] = useState<{
  targetPos: THREE.Vector3;
  targetZoom: number;
} | null>(null);
const focusProgress = useRef(0);

// Trigger transition when entering focus mode
useEffect(() => {
  if (clusterMode === 'focus' && focusedClusterId) {
    const cluster = clusters.get(focusedClusterId);
    if (!cluster) return;

    // Save pre-focus state
    const orthoCamera = camera as THREE.OrthographicCamera;
    useGraphStore.getState().setPreFocusState(
      orthoCamera.zoom,
      { x: camera.position.x, y: camera.position.y },
    );

    // Compute target zoom from bounding box (use store's graph, not graphRef — CameraController has no access to graphRef)
    const storeGraph = useGraphStore.getState().graph;
    const { minX, maxX, minY, maxY } = computeClusterBounds(cluster, storeGraph);
    const clusterW = Math.max(maxX - minX, 50);
    const clusterH = Math.max(maxY - minY, 50);
    const viewW = (orthoCamera.right - orthoCamera.left) / orthoCamera.zoom;
    const viewH = (orthoCamera.top - orthoCamera.bottom) / orthoCamera.zoom;
    const targetZoom = Math.min(viewW / clusterW, viewH / clusterH) * 0.8 * orthoCamera.zoom;

    setFocusTransition({
      targetPos: new THREE.Vector3(cluster.centroid.x, cluster.centroid.y, 10),
      targetZoom,
    });
    focusProgress.current = 0;
  }
}, [clusterMode, focusedClusterId]);

// Trigger return transition
useEffect(() => {
  if (clusterMode === 'overview') {
    const { preFocusZoom, preFocusPosition } = useGraphStore.getState();
    setFocusTransition({
      targetPos: new THREE.Vector3(preFocusPosition.x, preFocusPosition.y, 10),
      targetZoom: preFocusZoom,
    });
    focusProgress.current = 0;
  }
}, [clusterMode]);
```

Add the transition animation inside the **existing** `useFrame` (lines 173-199), **before** the existing fly-to code. Focus transitions take precedence — when active, skip the fly-to animation:
```typescript
// Focus transition (takes priority over search fly-to)
if (focusTransition && focusProgress.current < 1) {
  focusProgress.current = Math.min(1, focusProgress.current + delta * 2.5);
  const ease = 1 - Math.pow(1 - focusProgress.current, 3);

  camera.position.lerp(focusTransition.targetPos, ease);
  const orthoCamera = camera as THREE.OrthographicCamera;
  orthoCamera.zoom = THREE.MathUtils.lerp(
    orthoCamera.zoom,
    focusTransition.targetZoom,
    ease,
  );
  orthoCamera.updateProjectionMatrix();

  if (controls?.target) {
    const target2d = new THREE.Vector3(
      focusTransition.targetPos.x,
      focusTransition.targetPos.y,
      0,
    );
    controls.target.lerp(target2d, ease);
    controls.update();
  }

  if (focusProgress.current >= 1) {
    setFocusTransition(null);
  }
  return; // skip fly-to animation while focus transition is active
}

// Existing fly-to animation code follows (for search result navigation)...
```

- [ ] **Step 4: Add computeClusterBounds helper**

```typescript
function computeClusterBounds(
  cluster: { nodeIds: Set<string> },
  graph: Graph | null,
): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  if (!graph) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };

  for (const nodeId of cluster.nodeIds) {
    if (!graph.hasNode(nodeId)) continue;
    const attrs = graph.getNodeAttributes(nodeId);
    const x = typeof attrs.x === 'number' ? attrs.x : 0;
    const y = typeof attrs.y === 'number' ? attrs.y : 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  return { minX, maxX, minY, maxY };
}
```

- [ ] **Step 5: Verify with `bun tauri dev`**

Confirm:
- Clicking a node in overview mode zooms into that cluster
- Only the focused cluster's nodes are visible
- Camera smoothly transitions
- Edges reappear for the focused cluster's internal connections

- [ ] **Step 6: Commit**

```bash
git add src/app/components/graph/GraphCanvas.tsx
git commit -m "feat(graph): implement focus mode with camera transitions and click branching"
```

---

## Task 7: Implement Stub Edges Component

**Files:**
- Create: `src/app/components/graph/GraphStubEdges.tsx`
- Modify: `src/app/components/graph/GraphCanvas.tsx` (import + render)

- [ ] **Step 1: Create GraphStubEdges.tsx**

```typescript
'use client';

import { useRef, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { ClusterInfo } from '../../utils/graphClustering';

interface GraphStubEdgesProps {
  focusedClusterId: string | null;
  clusters: Map<string, ClusterInfo>;
  graph: import('graphology').default | null;
}

const _start = new THREE.Vector3();
const _end = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _dummy = new THREE.Object3D();
const _color = new THREE.Color();
const _up = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();

const STUB_LENGTH = 30;
// One stub per (boundary-node, target-cluster) pair — multiple boundary nodes
// can each have a stub to the same external cluster, creating a visual "fan".

interface StubEdge {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  color: string;
}

function computeStubEdges(
  focusedClusterId: string,
  clusters: Map<string, ClusterInfo>,
  graph: import('graphology').default,
): StubEdge[] {
  const focused = clusters.get(focusedClusterId);
  if (!focused) return [];

  const stubs: StubEdge[] = [];
  const seen = new Set<string>(); // avoid duplicate stubs per target cluster

  for (const nodeId of focused.nodeIds) {
    if (!graph.hasNode(nodeId)) continue;

    graph.forEachEdge(nodeId, (_edge, _attrs, source, target) => {
      const neighbor = source === nodeId ? target : source;
      if (focused.nodeIds.has(neighbor)) return; // internal edge

      // Find which cluster the neighbor belongs to
      for (const [cid, cluster] of clusters) {
        if (cid === focusedClusterId) continue;
        if (!cluster.nodeIds.has(neighbor)) continue;

        const key = `${nodeId}->${cid}`;
        if (seen.has(key)) return;
        seen.add(key);

        const nodeAttrs = graph.getNodeAttributes(nodeId);
        const fromX = typeof nodeAttrs.x === 'number' ? nodeAttrs.x : 0;
        const fromY = typeof nodeAttrs.y === 'number' ? nodeAttrs.y : 0;

        // Direction toward external cluster centroid, but only STUB_LENGTH long
        const dx = cluster.centroid.x - fromX;
        const dy = cluster.centroid.y - fromY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const scale = dist > 0 ? STUB_LENGTH / dist : 0;

        stubs.push({
          fromX,
          fromY,
          toX: fromX + dx * scale,
          toY: fromY + dy * scale,
          color: cluster.color,
        });
        break;
      }
    });
  }

  return stubs;
}

export function GraphStubEdges({ focusedClusterId, clusters, graph }: GraphStubEdgesProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const stubs = useMemo(() => {
    if (!focusedClusterId || !graph) return [];
    return computeStubEdges(focusedClusterId, clusters, graph);
  }, [focusedClusterId, clusters, graph]);

  const cylinderGeo = useMemo(() => new THREE.CylinderGeometry(0.15, 0.15, 1, 6), []);
  const material = useMemo(
    () => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.7 }),
    [],
  );

  useEffect(() => {
    return () => {
      cylinderGeo.dispose();
      material.dispose();
    };
  }, [cylinderGeo, material]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || stubs.length === 0) return;

    for (let i = 0; i < stubs.length; i++) {
      const stub = stubs[i];

      _start.set(stub.fromX, stub.fromY, 0);
      _end.set(stub.toX, stub.toY, 0);
      _mid.addVectors(_start, _end).multiplyScalar(0.5);
      _dir.subVectors(_end, _start);
      const length = _dir.length();
      _dir.normalize();
      _quat.setFromUnitVectors(_up, _dir);

      _dummy.position.copy(_mid);
      _dummy.quaternion.copy(_quat);
      _dummy.scale.set(3.0, length, 3.0);
      _dummy.updateMatrix();
      mesh.setMatrixAt(i, _dummy.matrix);

      _color.set(stub.color);
      mesh.setColorAt(i, _color);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.count = stubs.length;
  }, [stubs]);

  if (stubs.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[cylinderGeo, material, Math.max(stubs.length, 1)]}
      raycast={() => null}
    />
  );
}
```

- [ ] **Step 2: Add GraphStubEdges to GraphCanvas.tsx**

Import and render inside `<Canvas>`, after `<GraphClusterMetaballs>`:
```typescript
import { GraphStubEdges } from './GraphStubEdges';

// In JSX:
{clusterMode === 'focus' && (
  <GraphStubEdges
    focusedClusterId={focusedClusterId}
    clusters={clusters}
    graph={graphRef.current}
  />
)}
```

- [ ] **Step 3: Verify with `bun tauri dev`**

Click a node in overview mode to focus a cluster. Confirm:
- Thick colored stubs point from boundary nodes toward external clusters
- Stubs are short (not reaching the external centroid)
- Stubs use the external cluster's color

- [ ] **Step 4: Commit**

```bash
git add src/app/components/graph/GraphStubEdges.tsx src/app/components/graph/GraphCanvas.tsx
git commit -m "feat(graph): add stub edges showing external connections in focus mode"
```

---

## Task 8: Add Cluster Controls to Toolbar

**Files:**
- Modify: `src/app/components/graph/GraphToolbar.tsx`

- [ ] **Step 1: Read the current GraphToolbar.tsx**

Read the file to understand its structure and available props.

- [ ] **Step 2: Add cluster toggle button**

Add a "Cluster View" toggle button (e.g., using `GroupOutlined` icon from `@ant-design/icons`). It should:
- Read `clusterMode` and `clusters` from `useGraphStore`
- Toggle between `'overview'` and `'off'` when clicked
- Be disabled when `clusters.size === 0` with tooltip "Too few nodes to cluster"

- [ ] **Step 3: Add "Back to overview" button**

Visible only when `clusterMode === 'focus'`. Clicking it:
```typescript
useGraphStore.getState().setClusterMode('overview');
useGraphStore.getState().setFocusedClusterId(null);
useGraphStore.getState().setFocusOverrideNodeIds(null);
```

- [ ] **Step 4: Add cluster filter dropdown**

Add a `Select` (or `Dropdown`) component listing all clusters by name. Clicking one triggers focus mode on that cluster:
```typescript
const clusters = useGraphStore((s) => s.clusters);
const clusterOptions = [...clusters.values()].map((c) => ({
  label: c.name,
  value: c.id,
}));

// In JSX:
{clusterMode !== 'off' && clusterOptions.length > 0 && (
  <Select
    placeholder="Focus cluster..."
    options={clusterOptions}
    value={null}
    onChange={(clusterId) => {
      const cluster = clusters.get(clusterId);
      if (cluster) {
        useGraphStore.getState().setFocusedClusterId(clusterId);
        useGraphStore.getState().setFocusOverrideNodeIds(cluster.nodeIds);
        useGraphStore.getState().setClusterMode('focus');
      }
    }}
    size="small"
    style={{ width: 160 }}
    allowClear
    popupMatchSelectWidth={false}
  />
)}
```

- [ ] **Step 5: Add Escape key to exit focus mode**

In `GraphCanvas.tsx` keyboard handler (line 459), add before existing Escape handling:
```typescript
if (e.key === 'Escape') {
  const { clusterMode } = useGraphStore.getState();
  if (clusterMode === 'focus') {
    useGraphStore.getState().setClusterMode('overview');
    useGraphStore.getState().setFocusedClusterId(null);
    useGraphStore.getState().setFocusOverrideNodeIds(null);
    return;
  }
  // ... existing escape behavior
}
```

- [ ] **Step 5: Verify with `bun tauri dev`**

Confirm:
- Cluster toggle button appears and works
- "Back to overview" appears in focus mode
- Escape exits focus mode

- [ ] **Step 6: Commit**

```bash
git add src/app/components/graph/GraphToolbar.tsx src/app/components/graph/GraphCanvas.tsx
git commit -m "feat(graph): add cluster toggle and back-to-overview toolbar controls"
```

---

## Task 9: Update Tooltip for Cluster Info in Overview

**Files:**
- Modify: `src/app/components/graph/GraphTooltip.tsx`

- [ ] **Step 1: Read the current GraphTooltip.tsx**

Read the file to understand how it currently renders node info on hover.

- [ ] **Step 2: Add cluster info display in overview mode**

When `clusterMode === 'overview'` and a node is hovered, find that node's cluster and display:
- Cluster name
- Member count (e.g., "8 nodes")
- Breakdown by entity type (e.g., "1 collection, 5 requests, 2 models")
- Dominant HTTP methods (e.g., "GET-heavy")

Read `clusterMode` and `clusters` from `useGraphStore`. Use `findClusterForNode()` (extract to a shared utility or inline).

- [ ] **Step 3: Verify with `bun tauri dev`**

Hover over nodes in overview mode. Confirm cluster info appears instead of individual node info.

- [ ] **Step 4: Commit**

```bash
git add src/app/components/graph/GraphTooltip.tsx
git commit -m "feat(graph): show cluster info in tooltip during overview mode"
```

---

## Task 10: Update Minimap with Cluster Bounding Circles

**Files:**
- Modify: `src/app/components/graph/GraphMinimap.tsx`

- [ ] **Step 1: Read the current GraphMinimap.tsx**

Read the file to understand how it renders the Canvas2D minimap.

- [ ] **Step 2: Add cluster circle rendering**

When `clusterMode === 'overview'` or `'focus'`, draw translucent filled circles for each cluster:
- Center: cluster centroid (transformed to minimap coordinates)
- Radius: max distance from centroid to any member node (in minimap coordinates)
- Fill: cluster color at ~15% opacity
- Stroke: cluster color at ~40% opacity

In focus mode, dim all circles except the focused one.

- [ ] **Step 3: Verify with `bun tauri dev`**

Confirm cluster circles appear in the minimap, colored correctly.

- [ ] **Step 4: Commit**

```bash
git add src/app/components/graph/GraphMinimap.tsx
git commit -m "feat(graph): add cluster bounding circles to minimap"
```

---

## Task 11: Add Cluster Query Patterns

**Files:**
- Modify: `src/app/utils/graphQueryEngine.ts`

- [ ] **Step 1: Read the current graphQueryEngine.ts**

Read to understand the regex-based pattern system.

- [ ] **Step 2: Add fuse/unfuse/focus patterns**

Add three new patterns:
- `fuse` → `{ type: 'cluster_toggle', action: 'on' }`
- `unfuse` → `{ type: 'cluster_toggle', action: 'off' }`
- `focus <name>` → `{ type: 'cluster_focus', name: '<name>' }`

Update the existing `show cluster N` pattern to trigger focus mode instead of just filtering.

- [ ] **Step 3: Wire the query results to store actions in GraphToolbar**

In the search handler, when a cluster query result is returned, dispatch the corresponding store actions.

- [ ] **Step 4: Commit**

```bash
git add src/app/utils/graphQueryEngine.ts src/app/components/graph/GraphToolbar.tsx
git commit -m "feat(graph): add fuse/unfuse/focus query engine patterns"
```

---

## Task 12: Final Integration and Edge Cases

**Files:**
- Modify: `src/app/components/graph/GraphCanvas.tsx`

- [ ] **Step 1: Debounce cluster mode toggle**

Add a debounce ref to prevent rapid toggling:
```typescript
const lastModeChange = useRef(0);
// In setClusterMode wrapper:
const now = Date.now();
if (now - lastModeChange.current < 100) return;
lastModeChange.current = now;
```

- [ ] **Step 3: Handle deselect in focus mode**

When clicking empty space in focus mode, return to overview (not deselect):
```typescript
const handleDeselect = useCallback(() => {
  const { clusterMode } = useGraphStore.getState();
  if (clusterMode === 'focus') {
    useGraphStore.getState().setClusterMode('overview');
    useGraphStore.getState().setFocusedClusterId(null);
    useGraphStore.getState().setFocusOverrideNodeIds(null);
    return;
  }
  setSelectedNode(null);
  useGraphStore.getState().clearPath();
}, [setSelectedNode]);
```

- [ ] **Step 4: Full end-to-end verification**

Open `bun tauri dev` and verify the complete flow:
1. Graph loads → clusters auto-detected → metaball blobs visible
2. Nodes are dimmed and smaller inside blobs
3. No edges visible in overview
4. Hover shows cluster info
5. Click a node → focuses that cluster → camera zooms in
6. Internal edges visible in focus mode
7. Stub edges point toward other clusters
8. "Back to overview" button works
9. Escape key exits focus mode
10. Cluster toggle turns fusion off/on
11. Small graphs (<5 nodes) don't cluster
12. Minimap shows cluster circles

- [ ] **Step 5: Commit**

```bash
git add src/app/components/graph/GraphCanvas.tsx
git commit -m "feat(graph): add edge case guards and finalize integration"
```

---

## Task 13: Performance Guard for Large Graphs

**Files:**
- Modify: `src/app/components/graph/GraphClusterMetaballs.tsx`

- [ ] **Step 1: Add node count threshold check**

At the top of the `GraphClusterMetaballs` component, before the render:
```typescript
// Performance guard: disable shader for very large graphs
const nodeCountExceedsLimit = nodes.length > 500;

if (!enabled || clusters.size === 0 || nodeCountExceedsLimit) return null;
```

Also check the WebGL fragment uniform limit at init time:
```typescript
const { gl } = useThree();

useEffect(() => {
  const maxFragUniforms = gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS);
  if (maxFragUniforms < 256) {
    console.warn(
      `[GraphClusterMetaballs] Fragment uniform limit (${maxFragUniforms}) may be too low for ${MAX_NODES}-node arrays. Consider reducing MAX_NODES.`,
    );
  }
}, [gl]);
```

**Note:** The half-resolution `WebGLRenderTarget` blit path (spec Section 3, 301-500 nodes) is deferred to a future iteration. For now, the shader runs at full resolution for 0-500 nodes and is disabled above 500. This is a pragmatic choice since PIU projects typically have <200 nodes.

- [ ] **Step 2: Commit**

```bash
git add src/app/components/graph/GraphClusterMetaballs.tsx
git commit -m "feat(graph): add performance guard for large graphs"
```
