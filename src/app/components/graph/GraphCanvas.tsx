'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import type { CSSProperties } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { invoke } from '@tauri-apps/api/core';
import { Flex, Spin, Empty } from 'antd';
import { LoadingOutlined, WarningOutlined } from '@ant-design/icons';
import Graph from 'graphology';
import FA2LayoutSupervisor from 'graphology-layout-forceatlas2/worker';
import { inferSettings } from 'graphology-layout-forceatlas2';

import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { GraphNodes } from './GraphNodes';
import type { GraphNodeData } from './GraphNodes';
import { GraphEdges } from './GraphEdges';
import type { GraphEdgeData } from './GraphEdges';
import GraphToolbar from './GraphToolbar';
import GraphTooltip from './GraphTooltip';
import { MapDetailPanel } from '../apiModelMap/MapDetailPanel';
import { MapLegend } from '../apiModelMap/MapLegend';
import { GraphMinimap } from './GraphMinimap';
import { useGraphStore } from '../../stores/graphStore';
import {
  type RustProjectGraphData,
  buildGraphologyInstance,
  hasCachedPositions,
  assignZLayer,
  extractPositionsForSave,
  extractNodeData,
} from '../../utils/graphDataTransform';
import {
  assignCommunities,
  assignDegreeCentrality,
  computeVisibleSet,
  findShortestPath,
} from '../../utils/graphAlgorithms';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FA2_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Overlay styles
// ---------------------------------------------------------------------------

const OVERLAY_BASE: CSSProperties = {
  position: 'absolute',
  top: 12,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 10,
  borderRadius: 8,
  padding: '8px 16px',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  backdropFilter: 'blur(8px)',
};

const COMPUTING_OVERLAY_STYLE: CSSProperties = {
  ...OVERLAY_BASE,
  background: 'rgba(10, 10, 15, 0.85)',
  border: '1px solid var(--border)',
};

const ERROR_OVERLAY_STYLE: CSSProperties = {
  ...OVERLAY_BASE,
  background: 'rgba(30, 10, 10, 0.85)',
  border: '1px solid rgba(255, 77, 79, 0.4)',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface GraphCanvasProps {
  projectId: string | null;
  refreshKey: number;
  onEditModel: (modelId: string) => void;
  onDeleteModel: (modelId: string) => void;
  onOpenRequest?: (requestId: string) => void;
}

// ---------------------------------------------------------------------------
// Helper: collect GraphNodeData[] from a graphology instance
// ---------------------------------------------------------------------------

function collectNodeData(graph: Graph): GraphNodeData[] {
  const nodes: GraphNodeData[] = [];
  graph.forEachNode((nodeId, attrs) => {
    nodes.push({
      id: nodeId,
      x: typeof attrs.x === 'number' ? attrs.x : 0,
      y: typeof attrs.y === 'number' ? attrs.y : 0,
      z: typeof attrs.z === 'number' ? attrs.z : 0,
      size: typeof attrs.size === 'number' ? attrs.size : 5,
      color: typeof attrs.color === 'string' ? attrs.color : '#888888',
      entityType: typeof attrs.entity_type === 'string' ? attrs.entity_type : 'request',
      entityId: typeof attrs.entity_id === 'string' ? attrs.entity_id : nodeId,
    });
  });
  return nodes;
}

// ---------------------------------------------------------------------------
// Helper: collect GraphEdgeData[] from a graphology instance
// ---------------------------------------------------------------------------

function collectEdgeData(graph: Graph): GraphEdgeData[] {
  const edges: GraphEdgeData[] = [];
  graph.forEachEdge((_edge, attrs, _source, _target, sAttrs, tAttrs) => {
    edges.push({
      sourceX: typeof sAttrs.x === 'number' ? sAttrs.x : 0,
      sourceY: typeof sAttrs.y === 'number' ? sAttrs.y : 0,
      sourceZ: typeof sAttrs.z === 'number' ? sAttrs.z : 0,
      targetX: typeof tAttrs.x === 'number' ? tAttrs.x : 0,
      targetY: typeof tAttrs.y === 'number' ? tAttrs.y : 0,
      targetZ: typeof tAttrs.z === 'number' ? tAttrs.z : 0,
      color: typeof attrs.color === 'string' ? attrs.color : '#555555',
      width: typeof attrs.width === 'number' ? attrs.width : 1,
    });
  });
  return edges;
}

// ---------------------------------------------------------------------------
// CameraController — must live inside <Canvas> to use R3F hooks
// ---------------------------------------------------------------------------

function CameraController() {
  const { camera } = useThree();
  const controlsRef = useRef<any>(null);

  const [flyTarget, setFlyTarget] = useState<THREE.Vector3 | null>(null);
  const flyProgress = useRef(0);

  const activeSearchIndex = useGraphStore((s) => s.activeSearchIndex);
  const searchResults = useGraphStore((s) => s.searchResults);
  const fitViewRequested = useGraphStore((s) => s.fitViewRequested);
  const clearFitView = useGraphStore((s) => s.clearFitView);

  // Trigger fly-to when active search result changes
  useEffect(() => {
    if (searchResults.length === 0) return;
    const result = searchResults[activeSearchIndex];
    if (!result) return;

    const graph = useGraphStore.getState().graph;
    if (!graph || !graph.hasNode(result.nodeId)) return;

    const attrs = graph.getNodeAttributes(result.nodeId);
    const x = typeof attrs.x === 'number' ? attrs.x : 0;
    const y = typeof attrs.y === 'number' ? attrs.y : 0;
    const z = typeof attrs.z === 'number' ? attrs.z : 0;

    setFlyTarget(new THREE.Vector3(x, y, z));
    flyProgress.current = 0;
  }, [activeSearchIndex, searchResults]);

  // Trigger fit-view reset when requested
  useEffect(() => {
    if (!fitViewRequested) return;
    setFlyTarget(new THREE.Vector3(0, 0, 0));
    flyProgress.current = 0;
    clearFitView();
  }, [fitViewRequested, clearFitView]);

  useFrame((_state, delta) => {
    if (!flyTarget || flyProgress.current >= 1) return;

    flyProgress.current = Math.min(1, flyProgress.current + delta * 3);
    const t = flyProgress.current;
    // Ease-out cubic
    const ease = 1 - Math.pow(1 - t, 3);

    const controls = controlsRef.current;
    if (controls?.target) {
      controls.target.lerp(flyTarget, ease);
      controls.update();
    }

    // Move camera closer — maintain direction, target distance of 80 units
    const currentOffset = camera.position
      .clone()
      .sub(controls?.target ?? new THREE.Vector3())
      .normalize()
      .multiplyScalar(80);
    const desiredPos = flyTarget.clone().add(currentOffset);
    camera.position.lerp(desiredPos, ease * 0.5);

    if (flyProgress.current >= 1) {
      setFlyTarget(null);
    }
  });

  return <OrbitControls ref={controlsRef} makeDefault enableDamping dampingFactor={0.1} />;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function GraphCanvas({
  projectId,
  refreshKey,
  onEditModel,
  onDeleteModel,
  onOpenRequest,
}: GraphCanvasProps) {
  const { setGraph, setComputing, setSelectedNode, selectedNode, setNodeIndexToId } =
    useGraphStore();

  const filters = useGraphStore((s) => s.filters);
  const setVisibleNodeIds = useGraphStore((s) => s.setVisibleNodeIds);
  const hoveredNodeId = useGraphStore((s) => s.hoveredNodeId);
  const setHoveredNodeId = useGraphStore((s) => s.setHoveredNodeId);
  const visibleNodeIds = useGraphStore((s) => s.visibleNodeIds);
  const pathNodeIds = useGraphStore((s) => s.pathNodeIds);
  const setCommunities = useGraphStore((s) => s.setCommunities);
  const bloomEnabled = useGraphStore((s) => s.bloomEnabled);

  const [nodeData, setNodeData] = useState<GraphNodeData[]>([]);
  const [edgeData, setEdgeData] = useState<GraphEdgeData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isComputing, setIsComputingLocal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs for layout lifecycle — kept outside React state to avoid stale closures
  const layoutRef = useRef<InstanceType<typeof FA2LayoutSupervisor> | null>(null);
  const rafRef = useRef<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const positionsSavedRef = useRef(false);

  // ---------------------------------------------------------------------------
  // Kill layout + rAF cleanup (reusable)
  // ---------------------------------------------------------------------------

  const killLayout = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (layoutRef.current !== null) {
      try {
        layoutRef.current.kill();
      } catch {
        // Supervisor may already be dead — ignore
      }
      layoutRef.current = null;
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Save positions to SQLite (best-effort)
  // ---------------------------------------------------------------------------

  const savePositions = useCallback((graph: Graph) => {
    if (positionsSavedRef.current) return;
    positionsSavedRef.current = true;

    const positions = extractPositionsForSave(graph);
    if (positions.length > 0) {
      invoke('save_graph_positions', { positions }).catch(() => {
        // Best-effort — don't fail the UI
      });
    }
  }, []);

  // ---------------------------------------------------------------------------
  // rAF loop: read FA2 positions from graphology and push to renderer state
  // ---------------------------------------------------------------------------

  const startRafLoop = useCallback(
    (graph: Graph) => {
      const tick = () => {
        setNodeData(collectNodeData(graph));
        setEdgeData(collectEdgeData(graph));
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    },
    [],
  );

  // ---------------------------------------------------------------------------
  // Stop FA2: kill supervisor, do one final read, save positions
  // ---------------------------------------------------------------------------

  const stopLayout = useCallback(
    (graph: Graph) => {
      killLayout();

      // Final position snapshot
      setNodeData(collectNodeData(graph));
      setEdgeData(collectEdgeData(graph));
      savePositions(graph);

      setIsComputingLocal(false);
      setComputing(false);
    },
    [killLayout, savePositions, setComputing],
  );

  // ---------------------------------------------------------------------------
  // Main data-load effect
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!projectId) return;

    // Reset everything
    killLayout();
    positionsSavedRef.current = false;
    graphRef.current = null;

    setIsLoading(true);
    setError(null);
    setSelectedNode(null);
    setNodeData([]);
    setEdgeData([]);
    setIsComputingLocal(false);
    setComputing(false);
    setGraph(null);

    let cancelled = false;

    invoke<RustProjectGraphData>('build_project_graph', { projectId })
      .then((data) => {
        if (cancelled) return;

        const graph = buildGraphologyInstance(data);
        assignZLayer(graph);
        graphRef.current = graph;

        // Build nodeIndexToId mapping (stable insertion order)
        const indexToId: string[] = [];
        graph.forEachNode((nodeId) => {
          indexToId.push(nodeId);
        });
        setNodeIndexToId(indexToId);
        setGraph(graph);

        const cached = hasCachedPositions(graph);

        if (cached) {
          // Positions are already stored — render immediately, no FA2 needed
          const communityInfo = assignCommunities(graph);
          setCommunities(communityInfo);
          assignDegreeCentrality(graph);
          setNodeData(collectNodeData(graph));
          setEdgeData(collectEdgeData(graph));
          setIsLoading(false);
          return;
        }

        // No cached positions — initialize random starting positions so FA2 can work
        graph.forEachNode((nodeId) => {
          graph.setNodeAttribute(nodeId, 'x', (Math.random() - 0.5) * 200);
          graph.setNodeAttribute(nodeId, 'y', (Math.random() - 0.5) * 200);
        });

        const communityInfo = assignCommunities(graph);
        setCommunities(communityInfo);
        assignDegreeCentrality(graph);

        // Start FA2 layout supervisor
        setIsComputingLocal(true);
        setComputing(true);

        const settings = inferSettings(graph);
        const supervisor = new FA2LayoutSupervisor(graph, { settings });
        layoutRef.current = supervisor;
        supervisor.start();

        // rAF loop reads updated positions from graphology into render state
        startRafLoop(graph);

        // Stop after timeout — FA2 has no convergence callback
        timeoutRef.current = setTimeout(() => {
          if (cancelled) return;
          stopLayout(graph);
        }, FA2_TIMEOUT_MS);

        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setIsLoading(false);
        setIsComputingLocal(false);
        setComputing(false);
      });

    return () => {
      cancelled = true;
      killLayout();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, refreshKey]);

  // ---------------------------------------------------------------------------
  // Cleanup on unmount
  // ---------------------------------------------------------------------------

  useEffect(() => {
    return () => {
      killLayout();
    };
  }, [killLayout]);

  // ---------------------------------------------------------------------------
  // Filter → visible set recomputation
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;

    const isDefault = filters.showCollections && filters.showRequests && filters.showModels
      && filters.methods.length === 0 && filters.edgeTypes.length === 0
      && filters.communityId === null;

    if (isDefault) {
      setVisibleNodeIds(null);
    } else {
      setVisibleNodeIds(computeVisibleSet(graph, filters));
    }
  }, [filters, setVisibleNodeIds]);

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMeta = e.metaKey || e.ctrlKey;
      const activeTag = document.activeElement?.tagName;

      // Cmd+F — focus search
      if (isMeta && e.key === 'f') {
        e.preventDefault();
        const input = document.querySelector<HTMLInputElement>('[data-graph-search] input');
        input?.focus();
        return;
      }

      // Escape — clear search or deselect
      if (e.key === 'Escape') {
        const { searchQuery, setSearchQuery, setSearchResults, clearPath } = useGraphStore.getState();
        if (searchQuery) {
          setSearchQuery('');
          setSearchResults([]);
        } else {
          setSelectedNode(null);
          clearPath();
        }
        return;
      }

      // Alt+Left — navigate back
      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        useGraphStore.getState().navigateBack();
        return;
      }

      // Alt+Right — navigate forward
      if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        useGraphStore.getState().navigateForward();
        return;
      }

      // 1/2/3 — toggle filters (only when not in an input)
      if (activeTag !== 'INPUT' && activeTag !== 'TEXTAREA') {
        const store = useGraphStore.getState();
        if (e.key === '1') store.updateFilter('showCollections', !store.filters.showCollections);
        if (e.key === '2') store.updateFilter('showRequests', !store.filters.showRequests);
        if (e.key === '3') store.updateFilter('showModels', !store.filters.showModels);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setSelectedNode]);

  // ---------------------------------------------------------------------------
  // Node interaction
  // ---------------------------------------------------------------------------

  const handleNodeClick = useCallback(
    (nodeId: string, event?: { shiftKey?: boolean }) => {
      const graph = graphRef.current;
      if (!graph || !graph.hasNode(nodeId)) return;

      const current = useGraphStore.getState().selectedNode;

      // Shift+click: find path between current and clicked node
      if (event?.shiftKey && current && current.nodeId !== nodeId) {
        const path = findShortestPath(graph, current.nodeId, nodeId);
        if (path) {
          useGraphStore.getState().setPathNodeIds(new Set(path));
        }
        return;
      }

      // Normal click: select node, clear path, push to history
      useGraphStore.getState().clearPath();
      const attrs = graph.getNodeAttributes(nodeId);
      const entityType = attrs.entity_type as 'collection' | 'request' | 'model';
      const entityId = attrs.entity_id as string;
      setSelectedNode({ nodeId, entityType, entityId });
      useGraphStore.getState().pushSelection(nodeId);
    },
    [],
  );

  const handleDeselect = useCallback(() => {
    setSelectedNode(null);
    useGraphStore.getState().clearPath();
  }, [setSelectedNode]);

  const handleNodeHover = useCallback((nodeId: string | null) => {
    setHoveredNodeId(nodeId);
  }, [setHoveredNodeId]);

  const handleClosePanel = useCallback(() => {
    setSelectedNode(null);
  }, [setSelectedNode]);

  // ---------------------------------------------------------------------------
  // Toolbar action handlers
  // ---------------------------------------------------------------------------

  const handleResetLayout = useCallback(() => {
    const graph = graphRef.current;
    if (!graph || !projectId) return;
    // Clear cached positions
    graph.forEachNode((node) => {
      graph.removeNodeAttribute(node, 'x');
      graph.removeNodeAttribute(node, 'y');
    });
    invoke('save_graph_positions', { positions: [] }).catch(() => {});
    // Force re-render by clearing data — the effect will re-trigger on refreshKey
    positionsSavedRef.current = false;
    setNodeData([]);
    setEdgeData([]);
  }, [projectId]);

  const handleFitView = useCallback(() => {
    useGraphStore.getState().requestFitView();
  }, []);

  // ---------------------------------------------------------------------------
  // Derive selected node info for MapDetailPanel
  // ---------------------------------------------------------------------------

  const selectedPanelInfo =
    selectedNode && graphRef.current && graphRef.current.hasNode(selectedNode.nodeId)
      ? {
          nodeId: selectedNode.nodeId,
          nodeType: selectedNode.entityType,
          nodeData: extractNodeData(graphRef.current, selectedNode.nodeId),
        }
      : null;

  // ---------------------------------------------------------------------------
  // Early-exit render states
  // ---------------------------------------------------------------------------

  if (!projectId) {
    return (
      <Flex justify="center" align="center" style={{ width: '100%', flex: 1, minHeight: 0 }}>
        <Empty description="No project selected." />
      </Flex>
    );
  }

  if (isLoading) {
    return (
      <Flex justify="center" align="center" style={{ width: '100%', flex: 1, minHeight: 0 }}>
        <Spin size="large" />
      </Flex>
    );
  }

  if (error && nodeData.length === 0) {
    return (
      <Flex
        justify="center"
        align="center"
        vertical
        gap={8}
        style={{ width: '100%', flex: 1, minHeight: 0 }}
      >
        <WarningOutlined style={{ color: '#ff4d4f', fontSize: 24 }} />
        <span style={{ color: '#ff4d4f', fontSize: 13 }}>
          Failed to load graph: {error}
        </span>
      </Flex>
    );
  }

  if (nodeData.length === 0) {
    return (
      <Flex justify="center" align="center" style={{ width: '100%', flex: 1, minHeight: 0 }}>
        <Empty description="No collections or models yet." />
      </Flex>
    );
  }

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        position: 'absolute',
        inset: 0,
        touchAction: 'none',
      }}
    >
      <GraphToolbar
        onResetLayout={handleResetLayout}
        onFitView={handleFitView}
      />

      <Canvas
        style={{ position: 'absolute', inset: 0 }}
        camera={{ position: [0, 0, 400], fov: 60, near: 1, far: 5000 }}
        gl={{ antialias: true }}
        onPointerMissed={handleDeselect}
      >
        {/* Lighting */}
        <ambientLight intensity={0.6} />
        <directionalLight position={[200, 200, 200]} intensity={0.8} />

        {/* Camera controls + fly-to animation */}
        <CameraController />

        {/* Graph geometry */}
        <GraphNodes
          nodes={nodeData}
          selectedNodeId={selectedNode?.nodeId ?? null}
          hoveredNodeId={hoveredNodeId}
          visibleNodeIds={visibleNodeIds}
          pathNodeIds={pathNodeIds}
          onNodeClick={handleNodeClick}
          onNodeHover={handleNodeHover}
          onPointerMissed={handleDeselect}
        />
        <GraphEdges edges={edgeData} />

        {bloomEnabled && (
          <EffectComposer>
            <Bloom
              luminanceThreshold={0.6}
              luminanceSmoothing={0.4}
              intensity={0.5}
              mipmapBlur
            />
          </EffectComposer>
        )}
      </Canvas>

      {/* Computing overlay */}
      {isComputing && (
        <div style={COMPUTING_OVERLAY_STYLE}>
          <LoadingOutlined style={{ color: '#fbbf24', fontSize: 14 }} />
          <span style={{ color: '#fbbf24', fontSize: 12, fontWeight: 500 }}>
            Computing layout...
          </span>
        </div>
      )}

      {/* Post-load error overlay (graph rendered but something went wrong) */}
      {error && nodeData.length > 0 && !isComputing && (
        <div style={ERROR_OVERLAY_STYLE}>
          <WarningOutlined style={{ color: '#ff4d4f', fontSize: 14 }} />
          <span style={{ color: '#ff4d4f', fontSize: 12, fontWeight: 500 }}>
            Layout error — {error}
          </span>
        </div>
      )}

      {/* Hover tooltip */}
      <GraphTooltip />

      {/* Node detail panel */}
      {selectedPanelInfo && (
        <MapDetailPanel
          nodeType={selectedPanelInfo.nodeType}
          nodeData={selectedPanelInfo.nodeData}
          nodeId={selectedPanelInfo.nodeId}
          onClose={handleClosePanel}
          onEditModel={onEditModel}
          onDeleteModel={onDeleteModel}
          onOpenRequest={onOpenRequest}
        />
      )}

      <MapLegend />
      <GraphMinimap />
    </div>
  );
}
