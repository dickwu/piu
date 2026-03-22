'use client';

import { useRef, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { useGraphStore } from '../../stores/graphStore';
import { getGraphTheme } from '../../utils/graphThemeConfig';
import { dimColor, brightenColor } from '../../utils/graphColorUtils';

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
  hoveredNodeId: string | null;
  visibleNodeIds: Set<string> | null; // null = all visible
  pathNodeIds: Set<string>;
  clusterMode: 'overview' | 'focus' | 'off';
  graphTheme: 'dark' | 'light';
  onNodeClick: (nodeId: string, event?: { shiftKey?: boolean }) => void;
  onNodeHover: (nodeId: string | null) => void;
  onPointerMissed: () => void;
}

const _dummy = new THREE.Object3D();
const _color = new THREE.Color();

const NODE_SIZE_MIN = 1.5;
const NODE_SIZE_MAX = 6.0;
const NODE_SIZE_SCALE = 0.5;

export function GraphNodes({
  nodes, selectedNodeId, hoveredNodeId, visibleNodeIds, pathNodeIds, clusterMode, graphTheme,
  onNodeClick, onNodeHover, onPointerMissed,
}: GraphNodesProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  // Subscribe to highlight state from store
  const highlightedNodeIds = useGraphStore((s) => s.highlightedNodeIds);
  const blastRadiusNodeIds = useGraphStore((s) => s.blastRadiusNodeIds);
  const graph = useGraphStore((s) => s.graph);

  const sphereGeo = useMemo(() => new THREE.SphereGeometry(1, 16, 16), []);
  const material = useMemo(
    () => new THREE.MeshBasicMaterial(),
    [],
  );

  useEffect(() => {
    return () => {
      sphereGeo.dispose();
      material.dispose();
    };
  }, [sphereGeo, material]);

  // Build neighbor set for selection highlighting
  const neighborSet = useMemo(() => {
    if (!selectedNodeId || !graph) return new Set<string>();
    const neighbors = new Set<string>();
    if (graph.hasNode(selectedNodeId)) {
      graph.forEachNeighbor(selectedNodeId, (n) => neighbors.add(n));
    }
    return neighbors;
  }, [selectedNodeId, graph]);

  // ---------------------------------------------------------------------------
  // Baseline rendering — full priority highlight system (GitNexus-style)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || nodes.length === 0) return;

    const config = getGraphTheme(graphTheme);
    const overviewDim = clusterMode === 'overview' ? 0.4 : 1.0;

    const hasHighlights = (highlightedNodeIds?.size ?? 0) > 0;
    const hasBlast = (blastRadiusNodeIds?.size ?? 0) > 0;
    const hasSelection = selectedNodeId !== null;
    const hasPath = pathNodeIds.size > 0;
    const anyActive = hasHighlights || hasBlast || hasSelection;

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const isVisible = !visibleNodeIds || visibleNodeIds.has(node.id);

      let nodeSize: number;
      let nodeColor: string;

      if (!isVisible) {
        nodeSize = 0;
        nodeColor = '#000000';
      } else {
        const baseSize = Math.max(
          NODE_SIZE_MIN,
          Math.min(node.size * NODE_SIZE_SCALE, NODE_SIZE_MAX),
        );
        const baseColor = node.color || config.nodeColor;

        // Priority 1: Animation — handled by useFrame below
        // Priority 2: Blast radius (red)
        if (hasBlast && blastRadiusNodeIds!.has(node.id)) {
          nodeSize = baseSize * 1.8;
          nodeColor = '#ef4444';
        }
        // Priority 3: Query highlight (cyan)
        else if (hasHighlights && highlightedNodeIds!.has(node.id)) {
          nodeSize = baseSize * 1.6;
          nodeColor = '#06b6d4';
        }
        // Priority 4: Selected node
        else if (hasSelection && selectedNodeId === node.id) {
          nodeSize = baseSize * 1.8;
          nodeColor = brightenColor(baseColor, 1.3);
        }
        // Priority 5: Neighbor of selected
        else if (hasSelection && neighborSet.has(node.id)) {
          nodeSize = baseSize * 1.3;
          nodeColor = baseColor;
        }
        // Dimmed: any highlight system active, node not part of it
        else if (anyActive) {
          nodeSize = baseSize * 0.5;
          nodeColor = dimColor(baseColor, 0.25, graphTheme);
        }
        // Path active (no other highlight): keep path nodes visible
        else if (hasPath && pathNodeIds.has(node.id)) {
          nodeSize = baseSize;
          nodeColor = baseColor;
        }
        // Path active: dim non-path nodes
        else if (hasPath) {
          nodeSize = baseSize;
          nodeColor = dimColor(baseColor, 0.25, graphTheme);
        }
        // Default: per-node color, normal size
        else {
          nodeSize = baseSize;
          nodeColor = baseColor;
        }

        nodeSize *= overviewDim;
      }

      _dummy.position.set(node.x, node.y, node.z);
      _dummy.scale.setScalar(nodeSize);
      _dummy.updateMatrix();
      mesh.setMatrixAt(i, _dummy.matrix);

      _color.set(nodeColor);
      mesh.setColorAt(i, _color);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.count = nodes.length;
  }, [nodes, visibleNodeIds, pathNodeIds, clusterMode, graphTheme,
    selectedNodeId, highlightedNodeIds, blastRadiusNodeIds, neighborSet]);

  // ---------------------------------------------------------------------------
  // Animation tick — per-frame sine-wave updates for animated nodes
  // Reads from store via getState() to avoid re-render subscriptions
  // ---------------------------------------------------------------------------

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh || nodes.length === 0) return;

    const currentAnimations = useGraphStore.getState().animatedNodes;
    if (currentAnimations.size === 0) return;

    const now = Date.now();
    let needsUpdate = false;

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const anim = currentAnimations.get(node.id);
      if (!anim) continue;

      const isVisible = !visibleNodeIds || visibleNodeIds.has(node.id);
      if (!isVisible) continue;

      const elapsed = now - anim.startTime;
      const progress = Math.min(elapsed / anim.duration, 1);
      // Sine-wave oscillation: 4 full cycles over the duration
      const phase = (Math.sin(progress * Math.PI * 4) + 1) / 2;

      const baseSize = Math.max(
        NODE_SIZE_MIN,
        Math.min(node.size * NODE_SIZE_SCALE, NODE_SIZE_MAX),
      );
      let animSize: number;
      let animColor: string;

      if (anim.type === 'pulse') {
        // Cyan pulse for search results
        animSize = baseSize * (1.5 + phase * 0.8);
        animColor = phase > 0.5 ? '#06b6d4' : '#22d3ee';
      } else if (anim.type === 'ripple') {
        // Red ripple for blast radius
        animSize = baseSize * (1.3 + phase * 1.2);
        animColor = phase > 0.5 ? '#ef4444' : '#f87171';
      } else {
        // Purple glow for highlight
        animSize = baseSize * (1.4 + phase * 0.6);
        animColor = phase > 0.5 ? '#a855f7' : '#c084fc';
      }

      _dummy.position.set(node.x, node.y, node.z);
      _dummy.scale.setScalar(animSize);
      _dummy.updateMatrix();
      mesh.setMatrixAt(i, _dummy.matrix);

      _color.set(animColor);
      mesh.setColorAt(i, _color);

      needsUpdate = true;
    }

    if (needsUpdate) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  });

  // ---------------------------------------------------------------------------
  // Click / hover handlers
  // ---------------------------------------------------------------------------

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

  if (nodes.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[sphereGeo, material, nodes.length]}
      onClick={handleClick}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
      onPointerMissed={onPointerMissed}
    />
  );
}
