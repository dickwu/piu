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
  onNodeClick: (nodeId: string) => void;
  onPointerMissed: () => void;
}

const _dummy = new THREE.Object3D();
const _color = new THREE.Color();

export function GraphNodes({ nodes, selectedNodeId, onNodeClick, onPointerMissed }: GraphNodesProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const sphereGeo = useMemo(() => new THREE.SphereGeometry(1, 16, 16), []);
  const material = useMemo(
    () => new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 30 }),
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
    mesh.geometry.setAttribute(
      'instanceColor',
      new THREE.InstancedBufferAttribute(colorAttr, 3),
    );
    mesh.count = nodes.length;
  }, [nodes]);

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
