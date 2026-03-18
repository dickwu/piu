'use client';

import { useRef, useEffect, useMemo } from 'react';
import * as THREE from 'three';

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

const _start = new THREE.Vector3();
const _end = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _dummy = new THREE.Object3D();
const _color = new THREE.Color();
const _up = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();

export function GraphEdges({ edges }: GraphEdgesProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const cylinderGeo = useMemo(() => new THREE.CylinderGeometry(0.05, 0.05, 1, 4), []);
  const material = useMemo(
    () => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.6 }),
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
    if (!mesh || edges.length === 0) return;

    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i];

      _start.set(edge.sourceX, edge.sourceY, edge.sourceZ);
      _end.set(edge.targetX, edge.targetY, edge.targetZ);

      _mid.addVectors(_start, _end).multiplyScalar(0.5);

      _dir.subVectors(_end, _start);
      const length = _dir.length();

      _dir.normalize();
      _quat.setFromUnitVectors(_up, _dir);

      _dummy.position.copy(_mid);
      _dummy.quaternion.copy(_quat);
      _dummy.scale.set(edge.width, length, edge.width);
      _dummy.updateMatrix();
      mesh.setMatrixAt(i, _dummy.matrix);

      _color.set(edge.color);
      mesh.setColorAt(i, _color);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.count = edges.length;
  }, [edges]);

  if (edges.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[cylinderGeo, material, edges.length]}
      raycast={() => null}
    />
  );
}
