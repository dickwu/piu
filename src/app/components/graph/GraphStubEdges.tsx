'use client';

import { useRef, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { ClusterInfo } from '../../utils/graphClustering';
import type Graph from 'graphology';

interface GraphStubEdgesProps {
  focusedClusterId: string | null;
  clusters: Map<string, ClusterInfo>;
  graph: Graph | null;
}

interface StubData {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  color: string;
}

const STUB_LENGTH = 30;

const _start = new THREE.Vector3();
const _end = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _dummy = new THREE.Object3D();
const _color = new THREE.Color();
const _up = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();

function computeStubs(
  focusedClusterId: string,
  clusters: Map<string, ClusterInfo>,
  graph: Graph,
): StubData[] {
  const focusedCluster = clusters.get(focusedClusterId);
  if (!focusedCluster) return [];

  const stubs: StubData[] = [];
  const seen = new Set<string>();

  for (const nodeId of focusedCluster.nodeIds) {
    const nodeX = graph.getNodeAttribute(nodeId, 'x') as number | undefined;
    const nodeY = graph.getNodeAttribute(nodeId, 'y') as number | undefined;
    if (nodeX === undefined || nodeY === undefined) continue;

    graph.forEachEdge(nodeId, (_edge, _attrs, source, target) => {
      const externalNodeId = source === nodeId ? target : source;

      if (focusedCluster.nodeIds.has(externalNodeId)) return;

      let targetClusterId: string | null = null;
      for (const [cid, cluster] of clusters) {
        if (cid === focusedClusterId) continue;
        if (cluster.nodeIds.has(externalNodeId)) {
          targetClusterId = cid;
          break;
        }
      }

      if (!targetClusterId) return;

      const key = `${nodeId}->${targetClusterId}`;
      if (seen.has(key)) return;
      seen.add(key);

      const targetCluster = clusters.get(targetClusterId);
      if (!targetCluster) return;

      const dx = targetCluster.centroid.x - nodeX;
      const dy = targetCluster.centroid.y - nodeY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist === 0) return;

      const nx = dx / dist;
      const ny = dy / dist;

      stubs.push({
        fromX: nodeX,
        fromY: nodeY,
        toX: nodeX + nx * STUB_LENGTH,
        toY: nodeY + ny * STUB_LENGTH,
        color: targetCluster.color,
      });
    });
  }

  return stubs;
}

export function GraphStubEdges({ focusedClusterId, clusters, graph }: GraphStubEdgesProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

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

  const stubs = useMemo<StubData[]>(() => {
    if (!focusedClusterId || !graph) return [];
    return computeStubs(focusedClusterId, clusters, graph);
  }, [focusedClusterId, clusters, graph]);

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
      args={[cylinderGeo, material, stubs.length]}
      raycast={() => null}
    />
  );
}
