'use client';

import { useEffect, useState, useCallback } from 'react';
import { type Node, type Edge, type NodeChange, applyNodeChanges } from '@xyflow/react';
import { invoke } from '@tauri-apps/api/core';
import { NODE_RADIUS } from '../../utils/apiModelMapLayout';
import { useLayoutComputeStore } from '../../stores/layoutComputeStore';

// IPC types matching Rust structs
interface LayoutNode {
  id: string;
  x: number;
  y: number;
}

interface LayoutEdge {
  source: string;
  target: string;
}

interface LayoutPosition {
  id: string;
  x: number;
  y: number;
}

interface GraphLayoutInput {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  project_id: string | null;
  config: {
    link_distance: number;
    link_strength: number;
    charge_strength: number;
    collision_radius: number;
    alpha_decay: number;
    alpha_min: number;
    velocity_decay: number;
    max_iterations: number;
  };
}

export function useForceLayout(
  initialNodes: Node[],
  initialEdges: Edge[],
  projectId: string | null,
): {
  nodes: Node[];
  onNodesChange: (changes: NodeChange[]) => void;
  isComputing: boolean;
} {
  const [nodes, setNodes] = useState<Node[]>(initialNodes);
  const [isComputing, setIsComputing] = useState(false);

  useEffect(() => {
    if (initialNodes.length === 0) {
      setNodes([]);
      setIsComputing(false);
      useLayoutComputeStore.getState().setComputing(false);
      return;
    }

    // Show initial nodes immediately (circular positions)
    setNodes(initialNodes);
    setIsComputing(true);
    useLayoutComputeStore.getState().setComputing(true);

    let cancelled = false;

    const input: GraphLayoutInput = {
      nodes: initialNodes.map((n) => ({
        id: n.id,
        x: n.position.x,
        y: n.position.y,
      })),
      edges: initialEdges.map((e) => ({
        source: e.source,
        target: e.target,
      })),
      project_id: projectId,
      config: {
        link_distance: 180,
        link_strength: 0.5,
        charge_strength: -400,
        collision_radius: NODE_RADIUS + 20,
        alpha_decay: 0.02,
        alpha_min: 0.001,
        velocity_decay: 0.4,
        max_iterations: 300,
      },
    };

    invoke<LayoutPosition[]>('compute_graph_layout', { input })
      .then((positions) => {
        if (cancelled) return;

        const posMap = new Map<string, { x: number; y: number }>();
        for (const pos of positions) {
          posMap.set(pos.id, { x: pos.x, y: pos.y });
        }

        setNodes((prev) =>
          prev.map((node) => {
            const pos = posMap.get(node.id);
            if (!pos) return node;
            return { ...node, position: { x: pos.x, y: pos.y } };
          }),
        );
      })
      .catch(() => {
        // Fall back to circular layout — initial positions
        // were already set via setNodes(initialNodes) above.
      })
      .finally(() => {
        if (!cancelled) {
          setIsComputing(false);
          useLayoutComputeStore.getState().setComputing(false);
        }
      });

    return () => {
      cancelled = true;
      // Reset global state on cleanup to avoid stale indicator
      useLayoutComputeStore.getState().setComputing(false);
    };
  }, [initialNodes, initialEdges, projectId]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((prev) => applyNodeChanges(changes, prev));
  }, []);

  return { nodes, onNodesChange, isComputing };
}
