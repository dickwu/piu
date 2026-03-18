'use client';

import { useRef, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import { useGraphStore } from '../../stores/graphStore';

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
  onNodeClick: (nodeId: string, event?: { shiftKey?: boolean }) => void;
  onNodeHover: (nodeId: string | null) => void;
  onPointerMissed: () => void;
}

const _dummy = new THREE.Object3D();
const _color = new THREE.Color();

export function GraphNodes({
  nodes, selectedNodeId, hoveredNodeId, visibleNodeIds, pathNodeIds,
  onNodeClick, onNodeHover, onPointerMissed,
}: GraphNodesProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

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

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || nodes.length === 0) return;

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const isVisible = !visibleNodeIds || visibleNodeIds.has(node.id);
      const scale = isVisible ? node.size : 0;

      _dummy.position.set(node.x, node.y, node.z);
      _dummy.scale.set(scale, scale, scale);
      _dummy.updateMatrix();
      mesh.setMatrixAt(i, _dummy.matrix);

      const inPath = pathNodeIds.size === 0 || pathNodeIds.has(node.id);
      const dimFactor = inPath ? 1.0 : 0.25;

      _color.set(node.color);
      _color.multiplyScalar(dimFactor);
      mesh.setColorAt(i, _color);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.count = nodes.length;
  }, [nodes, visibleNodeIds, pathNodeIds]);

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
