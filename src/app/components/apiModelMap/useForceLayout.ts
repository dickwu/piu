'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { type Node, type Edge, type NodeChange, applyNodeChanges } from '@xyflow/react';
import * as d3Force from 'd3-force';
import { NODE_RADIUS } from '../../utils/apiModelMapLayout';

// ---------------------------------------------------------------------------
// Internal simulation node type
// ---------------------------------------------------------------------------

interface SimNode extends d3Force.SimulationNodeDatum {
  id: string;
  x: number;
  y: number;
  fx?: number | null;
  fy?: number | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useForceLayout(
  initialNodes: Node[],
  initialEdges: Edge[],
): {
  nodes: Node[];
  onNodesChange: (changes: NodeChange[]) => void;
  onNodeDragStart: (_event: React.MouseEvent, node: Node) => void;
  onNodeDrag: (_event: React.MouseEvent, node: Node) => void;
  onNodeDragStop: (_event: React.MouseEvent, node: Node) => void;
  isSimulating: boolean;
} {
  const [nodes, setNodes] = useState<Node[]>(initialNodes);
  const [isSimulating, setIsSimulating] = useState(false);

  const simulationRef = useRef<d3Force.Simulation<SimNode, d3Force.SimulationLinkDatum<SimNode>> | null>(null);
  const simNodeMapRef = useRef<Map<string, SimNode>>(new Map());
  const rafIdRef = useRef<number | null>(null);

  // -----------------------------------------------------------------------
  // Simulation setup — re-run when inputs change
  // -----------------------------------------------------------------------

  useEffect(() => {
    // Tear down any prior simulation
    if (simulationRef.current) {
      simulationRef.current.stop();
    }
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    // Edge case: nothing to simulate
    if (initialNodes.length === 0) {
      setNodes([]);
      setIsSimulating(false);
      return;
    }

    // Seed state from the new initial nodes
    setNodes(initialNodes);

    // Build simulation nodes & links
    const simNodes: SimNode[] = initialNodes.map((n) => ({
      id: n.id,
      x: n.position.x,
      y: n.position.y,
    }));

    const simNodeMap = new Map<string, SimNode>();
    for (const sn of simNodes) {
      simNodeMap.set(sn.id, sn);
    }
    simNodeMapRef.current = simNodeMap;

    const simLinks = initialEdges.map((e) => ({
      source: e.source,
      target: e.target,
    }));

    // Create the force simulation
    const simulation = d3Force
      .forceSimulation(simNodes)
      .force(
        'link',
        d3Force
          .forceLink(simLinks)
          .id((d: any) => d.id)
          .distance(180)
          .strength(0.5),
      )
      .force('charge', d3Force.forceManyBody().strength(-400))
      .force('center', d3Force.forceCenter(0, 0))
      .force('collision', d3Force.forceCollide().radius(NODE_RADIUS + 20))
      .alphaDecay(0.02);

    simulationRef.current = simulation;
    setIsSimulating(true);

    // Tick handler — batched via requestAnimationFrame
    simulation.on('tick', () => {
      if (rafIdRef.current !== null) return;
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        setNodes((prev) =>
          prev.map((node) => {
            const simNode = simNodeMap.get(node.id);
            if (!simNode || (simNode.x === undefined && simNode.y === undefined)) {
              return node;
            }
            return {
              ...node,
              position: { x: simNode.x ?? 0, y: simNode.y ?? 0 },
            };
          }),
        );
      });
    });

    // Track whether the simulation is still active
    const alphaCheckInterval = setInterval(() => {
      if (simulation.alpha() <= simulation.alphaMin()) {
        setIsSimulating(false);
        clearInterval(alphaCheckInterval);
      }
    }, 200);

    // Cleanup
    return () => {
      clearInterval(alphaCheckInterval);
      simulation.stop();
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      simulationRef.current = null;
    };
  }, [initialNodes, initialEdges]);

  // -----------------------------------------------------------------------
  // onNodesChange — apply ReactFlow state changes (selection, drag position)
  // -----------------------------------------------------------------------

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((prev) => applyNodeChanges(changes, prev));
  }, []);

  // -----------------------------------------------------------------------
  // Drag handlers
  // -----------------------------------------------------------------------

  const onNodeDragStart = useCallback((_event: React.MouseEvent, node: Node) => {
    const simNode = simNodeMapRef.current.get(node.id);
    if (!simNode) return;

    simNode.fx = simNode.x;
    simNode.fy = simNode.y;

    simulationRef.current?.alphaTarget(0.3).restart();
    setIsSimulating(true);
  }, []);

  const onNodeDrag = useCallback((_event: React.MouseEvent, node: Node) => {
    const simNode = simNodeMapRef.current.get(node.id);
    if (!simNode) return;

    simNode.fx = node.position.x;
    simNode.fy = node.position.y;
  }, []);

  const onNodeDragStop = useCallback((_event: React.MouseEvent, node: Node) => {
    const simNode = simNodeMapRef.current.get(node.id);
    if (!simNode) return;

    simNode.fx = null;
    simNode.fy = null;

    simulationRef.current?.alphaTarget(0);
  }, []);

  return {
    nodes,
    onNodesChange,
    onNodeDragStart,
    onNodeDrag,
    onNodeDragStop,
    isSimulating,
  };
}
