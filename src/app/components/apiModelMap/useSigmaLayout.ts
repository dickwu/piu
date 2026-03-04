'use client';

import { useEffect, useRef, useState } from 'react';
import { useCamera, useSigma } from '@react-sigma/core';
import { invoke } from '@tauri-apps/api/core';
import { NODE_RADIUS } from '../../utils/apiModelMapGraph';
import { useLayoutComputeStore } from '../../stores/layoutComputeStore';
import type MultiDirectedGraph from 'graphology';
import type { SigmaNodeAttributes, SigmaEdgeAttributes } from '../../utils/apiModelMapGraph';

// ---------------------------------------------------------------------------
// IPC types matching Rust structs
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Force-directed layout simulation parameters
// ---------------------------------------------------------------------------

const LAYOUT_LINK_DISTANCE = 180;
const LAYOUT_LINK_STRENGTH = 0.5;
const LAYOUT_CHARGE_STRENGTH = -400;
const LAYOUT_COLLISION_RADIUS = NODE_RADIUS + 20;
const LAYOUT_ALPHA_DECAY = 0.02;
const LAYOUT_ALPHA_MIN = 0.001;
const LAYOUT_VELOCITY_DECAY = 0.4;
const LAYOUT_MAX_ITERATIONS = 300;

/** Delay before camera reset after positions are applied (ms) */
const CAMERA_RESET_DELAY = 50;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSigmaLayout(
  graph: MultiDirectedGraph<SigmaNodeAttributes, SigmaEdgeAttributes>,
  projectId: string | null,
): {
  isComputing: boolean;
  error: string | null;
} {
  const sigma = useSigma<SigmaNodeAttributes, SigmaEdgeAttributes>();
  const { reset } = useCamera();
  const [isComputing, setIsComputing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runIdRef = useRef(0);
  const cameraTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const nodeCount = graph.order;
    if (nodeCount === 0) {
      setIsComputing(false);
      setError(null);
      useLayoutComputeStore.getState().setComputing(false);
      return;
    }

    const runId = ++runIdRef.current;
    setIsComputing(true);
    setError(null);
    useLayoutComputeStore.getState().setComputing(true);

    // Build IPC input from graphology data (read from source graph)
    const nodes: LayoutNode[] = [];
    graph.forEachNode((nodeId, attrs) => {
      nodes.push({ id: nodeId, x: attrs.x, y: attrs.y });
    });

    const edges: LayoutEdge[] = [];
    graph.forEachEdge((_edgeId, _attrs, source, target) => {
      edges.push({ source, target });
    });

    const input: GraphLayoutInput = {
      nodes,
      edges,
      project_id: projectId,
      config: {
        link_distance: LAYOUT_LINK_DISTANCE,
        link_strength: LAYOUT_LINK_STRENGTH,
        charge_strength: LAYOUT_CHARGE_STRENGTH,
        collision_radius: LAYOUT_COLLISION_RADIUS,
        alpha_decay: LAYOUT_ALPHA_DECAY,
        alpha_min: LAYOUT_ALPHA_MIN,
        velocity_decay: LAYOUT_VELOCITY_DECAY,
        max_iterations: LAYOUT_MAX_ITERATIONS,
      },
    };

    invoke<LayoutPosition[]>('compute_graph_layout', { input })
      .then((positions) => {
        if (runIdRef.current !== runId) return;

        // Apply positions to Sigma's internal graph (not the source graph).
        // loadGraph() copies data, so we must mutate the rendered instance.
        const sigmaGraph = sigma.getGraph();
        for (const pos of positions) {
          if (sigmaGraph.hasNode(pos.id)) {
            sigmaGraph.setNodeAttribute(pos.id, 'x', pos.x);
            sigmaGraph.setNodeAttribute(pos.id, 'y', pos.y);
          }
        }

        // Camera reset works immediately — positions are data, not DOM
        cameraTimerRef.current = setTimeout(() => {
          if (runIdRef.current === runId) {
            reset({ duration: 300 });
          }
        }, CAMERA_RESET_DELAY);
      })
      .catch((err: unknown) => {
        if (runIdRef.current !== runId) return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
      })
      .finally(() => {
        if (runIdRef.current !== runId) return;
        setIsComputing(false);
        useLayoutComputeStore.getState().setComputing(false);
      });

    return () => {
      // Invalidate in-flight async to prevent late then/catch/finally from
      // executing state updates after unmount or re-run.
      ++runIdRef.current;
      clearTimeout(cameraTimerRef.current);
      useLayoutComputeStore.getState().setComputing(false);
    };
  }, [graph, projectId, sigma, reset]);

  return { isComputing, error };
}
