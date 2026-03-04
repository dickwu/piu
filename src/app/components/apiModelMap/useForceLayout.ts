'use client';

import { useEffect, useState, useCallback } from 'react';
import { type Node, type Edge, type NodeChange, applyNodeChanges } from '@xyflow/react';
import { invoke } from '@tauri-apps/api/core';
import { NODE_RADIUS } from '../../utils/apiModelMapLayout';

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
): {
  nodes: Node[];
  onNodesChange: (changes: NodeChange[]) => void;
} {
  const [nodes, setNodes] = useState<Node[]>(initialNodes);

  useEffect(() => {
    if (initialNodes.length === 0) {
      setNodes([]);
      return;
    }

    // Show initial nodes immediately (circular positions)
    setNodes(initialNodes);

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
        // Silently fall back to circular layout — initial positions
        // were already set via setNodes(initialNodes) above.
      });

    return () => {
      cancelled = true;
    };
  }, [initialNodes, initialEdges]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((prev) => applyNodeChanges(changes, prev));
  }, []);

  return { nodes, onNodesChange };
}
