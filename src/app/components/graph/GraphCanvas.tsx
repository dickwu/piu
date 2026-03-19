'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import type { CSSProperties } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, OrthographicCamera, Html } from '@react-three/drei';
import * as THREE from 'three';
import { invoke } from '@tauri-apps/api/core';
import { Flex, Spin, Empty } from 'antd';
import { LoadingOutlined, WarningOutlined } from '@ant-design/icons';
import Graph from 'graphology';
import FA2LayoutSupervisor from 'graphology-layout-forceatlas2/worker';
import { inferSettings } from 'graphology-layout-forceatlas2';
import noverlap from 'graphology-layout-noverlap';

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
  extractPositionsForSave,
  extractNodeData,
} from '../../utils/graphDataTransform';
import {
  assignCommunities,
  assignDegreeCentrality,
  computeVisibleSet,
  findShortestPath,
} from '../../utils/graphAlgorithms';
import { computeClusters, findClusterForNode, spreadClusters } from '../../utils/graphClustering';
import { GraphClusterMetaballs } from './GraphClusterMetaballs';
import { GraphStubEdges } from './GraphStubEdges';
import { getGraphTheme } from '../../utils/graphThemeConfig';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FA2_TIMEOUT_MS = 15_000;
const FA2_SCALING_MULTIPLIER = 3;
const FA2_GRAVITY_MULTIPLIER = 0.5;
const NOVERLAP_MAX_ITERATIONS = 200;
const NOVERLAP_MARGIN = 6;

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
      z: 0,
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
// SceneBackground — must live inside <Canvas> to use R3F hooks
// ---------------------------------------------------------------------------

function SceneBackground({ color }: { color: string }) {
  const { scene } = useThree();
  useEffect(() => {
    scene.background = new THREE.Color(color);
  }, [scene, color]);
  return null;
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

  // Phase 4: cluster focus / overview transitions
  const clusterMode = useGraphStore((s) => s.clusterMode);
  const focusedClusterId = useGraphStore((s) => s.focusedClusterId);
  const clusters = useGraphStore((s) => s.clusters);

  const [focusTransition, setFocusTransition] = useState<{
    targetPos: THREE.Vector3;
    targetZoom: number;
  } | null>(null);
  const focusProgress = useRef(0);

  // Enable camera layer 1 so Html labels and metaballs render correctly
  useEffect(() => {
    camera.layers.enable(1);
  }, [camera]);

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

    setFlyTarget(new THREE.Vector3(x, y, 10)); // z=10 in 2D mode
    flyProgress.current = 0;
  }, [activeSearchIndex, searchResults]);

  // Trigger fit-view reset when requested
  useEffect(() => {
    if (!fitViewRequested) return;
    setFlyTarget(new THREE.Vector3(0, 0, 10));
    flyProgress.current = 0;
    clearFitView();
  }, [fitViewRequested, clearFitView]);

  // Trigger focus transition when entering focus mode
  useEffect(() => {
    if (clusterMode === 'focus' && focusedClusterId) {
      const cluster = clusters.get(focusedClusterId);
      if (!cluster) return;

      const orthoCamera = camera as THREE.OrthographicCamera;

      // Save pre-focus state so we can restore it when going back to overview
      useGraphStore.getState().setPreFocusState(
        orthoCamera.zoom,
        { x: camera.position.x, y: camera.position.y },
      );

      // Compute bounding box of cluster nodes
      const storeGraph = useGraphStore.getState().graph;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      if (storeGraph) {
        for (const nid of cluster.nodeIds) {
          if (!storeGraph.hasNode(nid)) continue;
          const a = storeGraph.getNodeAttributes(nid);
          const nx = typeof a.x === 'number' ? a.x : 0;
          const ny = typeof a.y === 'number' ? a.y : 0;
          if (nx < minX) minX = nx;
          if (nx > maxX) maxX = nx;
          if (ny < minY) minY = ny;
          if (ny > maxY) maxY = ny;
        }
      }

      const clusterW = Math.max(maxX - minX, 50);
      const clusterH = Math.max(maxY - minY, 50);
      const viewW = (orthoCamera.right - orthoCamera.left) / orthoCamera.zoom;
      const viewH = (orthoCamera.top - orthoCamera.bottom) / orthoCamera.zoom;
      const targetZoom = Math.min(viewW / clusterW, viewH / clusterH) * 0.8 * orthoCamera.zoom;

      setFocusTransition({
        targetPos: new THREE.Vector3(cluster.centroid.x, cluster.centroid.y, 10),
        targetZoom,
      });
      focusProgress.current = 0;
    }
  }, [clusterMode, focusedClusterId, clusters, camera]);

  // Restore camera when returning to overview mode
  useEffect(() => {
    if (clusterMode === 'overview') {
      const { preFocusZoom, preFocusPosition } = useGraphStore.getState();
      setFocusTransition({
        targetPos: new THREE.Vector3(preFocusPosition.x, preFocusPosition.y, 10),
        targetZoom: preFocusZoom,
      });
      focusProgress.current = 0;
    }
  }, [clusterMode]);

  useFrame((_state, delta) => {
    // Focus transition takes priority over search fly-to
    if (focusTransition && focusProgress.current < 1) {
      focusProgress.current = Math.min(1, focusProgress.current + delta * 2.5);
      const ease = 1 - Math.pow(1 - focusProgress.current, 3);

      camera.position.lerp(focusTransition.targetPos, ease);
      const orthoCamera = camera as THREE.OrthographicCamera;
      orthoCamera.zoom = THREE.MathUtils.lerp(
        orthoCamera.zoom,
        focusTransition.targetZoom,
        ease,
      );
      orthoCamera.updateProjectionMatrix();

      const controls = controlsRef.current;
      if (controls?.target) {
        const target2d = new THREE.Vector3(
          focusTransition.targetPos.x,
          focusTransition.targetPos.y,
          0,
        );
        controls.target.lerp(target2d, ease);
        controls.update();
      }

      if (focusProgress.current >= 1) {
        setFocusTransition(null);
      }
      return; // skip fly-to while focus transition is active
    }

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

    camera.position.lerp(
      new THREE.Vector3(flyTarget.x, flyTarget.y, 10),
      ease * 0.5
    );

    if (flyProgress.current >= 1) {
      setFlyTarget(null);
    }
  });

  return <OrbitControls ref={controlsRef} makeDefault enableRotate={false} enableDamping dampingFactor={0.1} />;
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
  const clusterMode = useGraphStore((s) => s.clusterMode);
  const clusters = useGraphStore((s) => s.clusters);
  const focusedClusterId = useGraphStore((s) => s.focusedClusterId);
  const focusOverrideNodeIds = useGraphStore((s) => s.focusOverrideNodeIds);
  const graphTheme = useGraphStore((s) => s.graphTheme);

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
  const lastModeChange = useRef(0);

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

      // Post-layout overlap removal
      noverlap.assign(graph, {
        maxIterations: NOVERLAP_MAX_ITERATIONS,
        settings: {
          margin: NOVERLAP_MARGIN,
          ratio: 1.0,
          speed: 3,
          gridSize: 20,
        },
      });

      // Compute clusters after layout + noverlap settle
      let clusterMap = computeClusters(graph);

      // Push overlapping clusters apart and get updated centroids
      if (clusterMap.size >= 2) {
        clusterMap = spreadClusters(graph, clusterMap);
      }

      useGraphStore.getState().setClusters(clusterMap);
      const now = Date.now();
      if (now - lastModeChange.current >= 100) {
        lastModeChange.current = now;
        if (clusterMap.size >= 2) {
          useGraphStore.getState().setClusterMode('overview');
        } else {
          useGraphStore.getState().setClusterMode('off');
        }
      }

      // Final position snapshot — AFTER all position-modifying passes
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

          // Compute clusters for cached path
          const clusterMap = computeClusters(graph);
          useGraphStore.getState().setClusters(clusterMap);
          const nowCached = Date.now();
          if (nowCached - lastModeChange.current >= 100) {
            lastModeChange.current = nowCached;
            if (clusterMap.size >= 2) {
              useGraphStore.getState().setClusterMode('overview');
            } else {
              useGraphStore.getState().setClusterMode('off');
            }
          }

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

        const inferred = inferSettings(graph);
        const settings = {
          ...inferred,
          scalingRatio: (inferred.scalingRatio ?? 1) * FA2_SCALING_MULTIPLIER,
          gravity: (inferred.gravity ?? 1) * FA2_GRAVITY_MULTIPLIER,
          strongGravityMode: false,
        };
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

      // Escape — exit cluster focus mode first, then clear search or deselect
      if (e.key === 'Escape') {
        const { clusterMode } = useGraphStore.getState();
        if (clusterMode === 'focus') {
          useGraphStore.getState().setClusterMode('overview');
          useGraphStore.getState().setFocusedClusterId(null);
          useGraphStore.getState().setFocusOverrideNodeIds(null);
          return;
        }
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
        if (e.key === 't' || e.key === 'T') {
          useGraphStore.getState().toggleGraphTheme();
        }
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

      const { clusterMode: currentClusterMode, clusters: currentClusters } = useGraphStore.getState();

      // Overview mode: clicking a node focuses the entire cluster
      if (currentClusterMode === 'overview' && !event?.shiftKey) {
        const clusterId = findClusterForNode(nodeId, currentClusters);
        if (clusterId) {
          const cluster = currentClusters.get(clusterId);
          if (cluster) {
            useGraphStore.getState().setFocusedClusterId(clusterId);
            useGraphStore.getState().setFocusOverrideNodeIds(cluster.nodeIds);
            useGraphStore.getState().setClusterMode('focus');
          }
        }
        return;
      }

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
    const { clusterMode } = useGraphStore.getState();
    if (clusterMode === 'focus') {
      useGraphStore.getState().setClusterMode('overview');
      useGraphStore.getState().setFocusedClusterId(null);
      useGraphStore.getState().setFocusOverrideNodeIds(null);
      return;
    }
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

  // Focus override overrides the filter-computed visible set
  const effectiveVisibleIds = focusOverrideNodeIds ?? visibleNodeIds;

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
        gl={{ antialias: true }}
        onPointerMissed={handleDeselect}
      >
        <SceneBackground color={getGraphTheme(graphTheme).background} />
        <OrthographicCamera makeDefault zoom={1.5} near={-100} far={100} position={[0, 0, 10]} />

        {/* Camera controls + fly-to animation */}
        <CameraController />

        {/* Graph geometry */}
        <GraphNodes
          nodes={nodeData}
          selectedNodeId={selectedNode?.nodeId ?? null}
          hoveredNodeId={hoveredNodeId}
          visibleNodeIds={effectiveVisibleIds}
          pathNodeIds={pathNodeIds}
          clusterMode={clusterMode}
          onNodeClick={handleNodeClick}
          onNodeHover={handleNodeHover}
          onPointerMissed={handleDeselect}
          graphTheme={graphTheme}
        />
        <GraphEdges edges={edgeData} hidden={clusterMode === 'overview'} graphTheme={graphTheme} />

        {/* Metaball cluster blobs */}
        <GraphClusterMetaballs
          nodes={nodeData}
          clusters={clusters}
          enabled={clusterMode !== 'off'}
          focusedClusterId={focusedClusterId}
          graphTheme={graphTheme}
        />

        {/* Stub edges pointing toward external clusters in focus mode */}
        {clusterMode === 'focus' && (
          <GraphStubEdges
            focusedClusterId={focusedClusterId}
            clusters={clusters}
            graph={graphRef.current}
          />
        )}

        {/* Cluster name labels in overview mode — anchored to largest node */}
        {clusterMode === 'overview' && (() => {
          const themeConfig = getGraphTheme(graphTheme);
          const clusterEntries = [...clusters.entries()];
          return clusterEntries.map(([, cluster], idx) => {
            if (cluster.nodeIds.size < 2) return null;

            // Find the largest node in this cluster to anchor the label
            let anchorX = cluster.centroid.x;
            let anchorY = cluster.centroid.y;
            let maxSize = -1;
            for (const nd of nodeData) {
              if (cluster.nodeIds.has(nd.id) && nd.size > maxSize) {
                maxSize = nd.size;
                anchorX = nd.x;
                anchorY = nd.y;
              }
            }

            return (
              <Html
                key={cluster.id}
                position={[anchorX, anchorY, 0.5]}
                center
                style={{
                  color: themeConfig.clusterPalette[idx % themeConfig.clusterPalette.length],
                  fontSize: 12,
                  fontWeight: 600,
                  textShadow: themeConfig.labelShadow,
                  pointerEvents: 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                {cluster.name}
              </Html>
            );
          });
        })()}

        {bloomEnabled && getGraphTheme(graphTheme).bloomAvailable && (
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
