'use client';

import { useRef, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useGraphStore } from '../../stores/graphStore';
import { getGraphTheme } from '../../utils/graphThemeConfig';
import { dimColor, brightenColor } from '../../utils/graphColorUtils';

export interface GraphEdgeData {
  sourceId: string;
  targetId: string;
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
  hidden?: boolean;
  graphTheme: 'dark' | 'light';
}

const _start = new THREE.Vector3();
const _end = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _dummy = new THREE.Object3D();
const _color = new THREE.Color();
const _up = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();

export function GraphEdges({ edges, hidden, graphTheme }: GraphEdgesProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  // Subscribe to highlight state from store
  const selectedNode = useGraphStore((s) => s.selectedNode);
  const highlightedNodeIds = useGraphStore((s) => s.highlightedNodeIds);
  const blastRadiusNodeIds = useGraphStore((s) => s.blastRadiusNodeIds);

  const cylinderGeo = useMemo(() => new THREE.CylinderGeometry(0.05, 0.05, 1, 4), []);
  const material = useMemo(
    () => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.08 }),
    [],
  );

  useEffect(() => {
    return () => {
      cylinderGeo.dispose();
      material.dispose();
    };
  }, [cylinderGeo, material]);

  // ---------------------------------------------------------------------------
  // Edge rendering with selection-aware highlight (GitNexus-style)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || edges.length === 0) return;

    const config = getGraphTheme(graphTheme);

    const hasSelection = selectedNode !== null;
    const hasHighlights = (highlightedNodeIds?.size ?? 0) > 0;
    const hasBlast = (blastRadiusNodeIds?.size ?? 0) > 0;
    const anyActive = hasSelection || hasHighlights || hasBlast;

    // Boost opacity when highlights are active so connected edges stand out
    material.opacity = anyActive ? 0.4 : config.edgeOpacity;
    material.needsUpdate = true;

    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i];

      _start.set(edge.sourceX, edge.sourceY, edge.sourceZ);
      _end.set(edge.targetX, edge.targetY, edge.targetZ);

      _mid.addVectors(_start, _end).multiplyScalar(0.5);

      _dir.subVectors(_end, _start);
      const length = _dir.length();

      _dir.normalize();
      _quat.setFromUnitVectors(_up, _dir);

      // Determine edge color and width based on highlight state
      let edgeColor: string;
      let widthScale = 1;

      if (anyActive) {
        const isConnected = hasSelection
          && (edge.sourceId === selectedNode!.nodeId
            || edge.targetId === selectedNode!.nodeId);
        const bothBlast = hasBlast
          && blastRadiusNodeIds!.has(edge.sourceId)
          && blastRadiusNodeIds!.has(edge.targetId);
        const bothHighlighted = hasHighlights
          && highlightedNodeIds!.has(edge.sourceId)
          && highlightedNodeIds!.has(edge.targetId);

        if (bothBlast) {
          edgeColor = '#ef4444';
          widthScale = 3;
        } else if (bothHighlighted) {
          edgeColor = '#06b6d4';
          widthScale = 3;
        } else if (isConnected) {
          edgeColor = brightenColor(edge.color || '#555555', 1.5);
          widthScale = 4;
        } else {
          edgeColor = dimColor(edge.color || '#555555', 0.08, graphTheme);
          widthScale = 0.3;
        }
      } else {
        edgeColor = config.edgeColor;
      }

      _dummy.position.copy(_mid);
      _dummy.quaternion.copy(_quat);
      _dummy.scale.set(edge.width * widthScale, length, edge.width * widthScale);
      _dummy.updateMatrix();
      mesh.setMatrixAt(i, _dummy.matrix);

      _color.set(edgeColor);
      mesh.setColorAt(i, _color);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.count = edges.length;
  }, [edges, graphTheme, material, selectedNode, highlightedNodeIds, blastRadiusNodeIds]);

  if (edges.length === 0 || hidden) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[cylinderGeo, material, edges.length]}
      raycast={() => null}
    />
  );
}
