'use client';

import { useEffect, useRef, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Flex, Spin, Empty } from 'antd';
import { LoadingOutlined, WarningOutlined } from '@ant-design/icons';

import GraphToolbar from './GraphToolbar';
import GraphTooltip from './GraphTooltip';
import GraphClusterLabels from './GraphClusterLabels';
import { MapDetailPanel } from '../apiModelMap/MapDetailPanel';
import { MapLegend } from '../apiModelMap/MapLegend';
import { useGraphStore } from '../../stores/graphStore';
import { useSigmaGraph } from '../../hooks/useSigma';
import {
  type RustProjectGraphData,
  buildGraphologyInstance,
  extractNodeData,
} from '../../utils/graphDataTransform';
import {
  assignCommunities,
  assignDegreeCentrality,
  computeVisibleSet,
  findShortestPath,
} from '../../utils/graphAlgorithms';
import { computeClusters } from '../../utils/graphClustering';
import { getGraphTheme } from '../../utils/graphThemeConfig';
import { executeGraphQuery } from '../../utils/graphQueryEngine';

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
// Component
// ---------------------------------------------------------------------------

export default function GraphCanvas({
  projectId,
  refreshKey,
  onEditModel,
  onDeleteModel,
  onOpenRequest,
}: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // --- Store selectors ---
  const graph = useGraphStore((s) => s.graph);
  const isComputing = useGraphStore((s) => s.isComputing);
  const graphError = useGraphStore((s) => s.graphError);
  const selectedNode = useGraphStore((s) => s.selectedNode);
  const filters = useGraphStore((s) => s.filters);
  const graphTheme = useGraphStore((s) => s.graphTheme);

  // --- Store actions ---
  const setGraph = useGraphStore((s) => s.setGraph);
  const setComputing = useGraphStore((s) => s.setComputing);
  const setGraphError = useGraphStore((s) => s.setGraphError);
  const setSelectedNode = useGraphStore((s) => s.setSelectedNode);
  const setCommunities = useGraphStore((s) => s.setCommunities);
  const setClusters = useGraphStore((s) => s.setClusters);
  const setClusterMode = useGraphStore((s) => s.setClusterMode);
  const setVisibleNodeIds = useGraphStore((s) => s.setVisibleNodeIds);

  // --- Sigma hook ---
  const controls = useSigmaGraph(containerRef, projectId);

  // -------------------------------------------------------------------------
  // Data loading: invoke Rust, build graphology, assign communities/clusters
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!projectId) {
      setGraph(null);
      setGraphError(null);
      return;
    }

    let cancelled = false;

    setGraph(null);
    setGraphError(null);
    setSelectedNode(null);
    setComputing(true);

    invoke<RustProjectGraphData>('build_project_graph', { projectId })
      .then((data) => {
        if (cancelled) return;

        const g = buildGraphologyInstance(data);

        // Assign communities + centrality (mutates graph attributes)
        const communityInfo = assignCommunities(g);
        assignDegreeCentrality(g);

        // Compute clusters
        const clusterMap = computeClusters(g);

        // Commit to store — this triggers useSigmaGraph to create the Sigma instance
        setGraph(g);
        setCommunities(communityInfo);
        setClusters(clusterMap);

        if (clusterMap.size >= 2) {
          setClusterMode('overview');
        } else {
          setClusterMode('off');
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setGraphError(msg);
        setComputing(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, refreshKey]);

  // -------------------------------------------------------------------------
  // Filter -> visible set recomputation
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!graph) return;

    const isDefault =
      filters.showCollections &&
      filters.showRequests &&
      filters.showModels &&
      filters.methods.length === 0 &&
      filters.edgeTypes.length === 0 &&
      filters.communityId === null;

    if (isDefault) {
      setVisibleNodeIds(null);
    } else {
      setVisibleNodeIds(computeVisibleSet(graph, filters));
    }
  }, [graph, filters, setVisibleNodeIds]);

  // -------------------------------------------------------------------------
  // Keyboard shortcuts
  // -------------------------------------------------------------------------

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMeta = e.metaKey || e.ctrlKey;
      const activeTag = document.activeElement?.tagName;

      // Cmd+F -- focus search
      if (isMeta && e.key === 'f') {
        e.preventDefault();
        const input = document.querySelector<HTMLInputElement>(
          '[data-graph-search] input',
        );
        input?.focus();
        return;
      }

      // Escape -- exit cluster focus, clear search, or deselect
      if (e.key === 'Escape') {
        const store = useGraphStore.getState();
        if (store.clusterMode === 'focus') {
          store.setClusterMode('overview');
          store.setFocusedClusterId(null);
          return;
        }
        if (store.searchQuery) {
          store.setSearchQuery('');
          store.setSearchResults([]);
          store.clearPath();
          store.setHighlightedNodeIds(null);
        } else {
          setSelectedNode(null);
          store.clearPath();
          store.setHighlightedNodeIds(null);
          store.setBlastRadiusNodeIds(null);
        }
        return;
      }

      // Alt+Left -- navigate back
      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        useGraphStore.getState().navigateBack();
        return;
      }

      // Alt+Right -- navigate forward
      if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        useGraphStore.getState().navigateForward();
        return;
      }

      // 1/2/3 -- toggle filters, T -- theme toggle (not in inputs)
      if (activeTag !== 'INPUT' && activeTag !== 'TEXTAREA') {
        const store = useGraphStore.getState();
        if (e.key === '1') store.updateFilter('showCollections', !store.filters.showCollections);
        if (e.key === '2') store.updateFilter('showRequests', !store.filters.showRequests);
        if (e.key === '3') store.updateFilter('showModels', !store.filters.showModels);
        if (e.key === 't' || e.key === 'T') {
          store.toggleGraphTheme();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setSelectedNode]);

  // -------------------------------------------------------------------------
  // Search/query result routing handler (passed to toolbar)
  // -------------------------------------------------------------------------

  const handleSearchQueryResult = useCallback(
    (queryResult: ReturnType<typeof executeGraphQuery>) => {
      if (!queryResult) return;

      const store = useGraphStore.getState();
      const nodeIds = queryResult.highlightNodes;

      if (queryResult.type === 'path') {
        // Path results go into pathNodeIds with pulse animation
        store.setPathNodeIds(new Set(nodeIds));
        store.setHighlightedNodeIds(null);
        if (nodeIds.length > 0) {
          store.triggerNodeAnimation(nodeIds, 'pulse');
        }
      } else if (queryResult.type === 'cluster_toggle') {
        if (queryResult.action === 'on') {
          store.setClusterMode('overview');
        } else {
          store.setClusterMode('off');
        }
      } else if (queryResult.type === 'cluster_focus') {
        // Find matching cluster by name
        const clusters = store.clusters;
        for (const [clusterId, cluster] of clusters) {
          if (
            cluster.name.toLowerCase().includes((queryResult.name ?? '').toLowerCase()) ||
            clusterId.includes(queryResult.name ?? '')
          ) {
            store.setFocusedClusterId(clusterId);
            store.setClusterMode('focus');
            controls.focusCluster(clusterId);
            break;
          }
        }
      } else {
        // All other query types -> highlightedNodeIds with glow animation
        store.setHighlightedNodeIds(nodeIds.length > 0 ? new Set(nodeIds) : null);
        store.setPathNodeIds(new Set());
        if (nodeIds.length > 0) {
          store.triggerNodeAnimation(nodeIds, 'glow');
        }
      }
    },
    [controls],
  );

  // -------------------------------------------------------------------------
  // Close detail panel
  // -------------------------------------------------------------------------

  const handleClosePanel = useCallback(() => {
    setSelectedNode(null);
  }, [setSelectedNode]);

  // -------------------------------------------------------------------------
  // Derive selected node info for MapDetailPanel
  // -------------------------------------------------------------------------

  const selectedPanelInfo =
    selectedNode && graph && graph.hasNode(selectedNode.nodeId)
      ? {
          nodeId: selectedNode.nodeId,
          nodeType: selectedNode.entityType,
          nodeData: extractNodeData(graph, selectedNode.nodeId),
        }
      : null;

  // -------------------------------------------------------------------------
  // Theme config
  // -------------------------------------------------------------------------

  const theme = getGraphTheme(graphTheme);

  // -------------------------------------------------------------------------
  // Early-exit render states
  // -------------------------------------------------------------------------

  if (!projectId) {
    return (
      <Flex
        justify="center"
        align="center"
        style={{ width: '100%', flex: 1, minHeight: 0 }}
      >
        <Empty description="No project selected." />
      </Flex>
    );
  }

  if (!graph && !graphError && !isComputing) {
    return (
      <Flex
        justify="center"
        align="center"
        style={{ width: '100%', flex: 1, minHeight: 0 }}
      >
        <Spin size="large" />
      </Flex>
    );
  }

  if (graphError && !graph) {
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
          Failed to load graph: {graphError}
        </span>
      </Flex>
    );
  }

  if (graph && graph.order === 0) {
    return (
      <Flex
        justify="center"
        align="center"
        style={{ width: '100%', flex: 1, minHeight: 0 }}
      >
        <Empty description="No collections or models yet." />
      </Flex>
    );
  }

  // -------------------------------------------------------------------------
  // Main render
  // -------------------------------------------------------------------------

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
      {/* Sigma container */}
      <div
        ref={containerRef}
        style={{
          position: 'absolute',
          inset: 0,
          background: theme.background,
        }}
      >
        {/* Cluster labels overlay (positioned inside the Sigma container) */}
        <GraphClusterLabels sigmaRef={controls.sigmaRef} />
      </div>

      {/* Toolbar */}
      <GraphToolbar
        controls={controls}
        onQueryResult={handleSearchQueryResult}
      />

      {/* Computing overlay */}
      {isComputing && (
        <div style={COMPUTING_OVERLAY_STYLE}>
          <LoadingOutlined style={{ color: '#fbbf24', fontSize: 14 }} />
          <span style={{ color: '#fbbf24', fontSize: 12, fontWeight: 500 }}>
            Computing layout...
          </span>
        </div>
      )}

      {/* Error overlay (graph rendered but something went wrong) */}
      {graphError && graph && !isComputing && (
        <div style={ERROR_OVERLAY_STYLE}>
          <WarningOutlined style={{ color: '#ff4d4f', fontSize: 14 }} />
          <span style={{ color: '#ff4d4f', fontSize: 12, fontWeight: 500 }}>
            Layout error -- {graphError}
          </span>
        </div>
      )}

      {/* Hover tooltip */}
      <GraphTooltip sigmaRef={controls.sigmaRef} />

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
    </div>
  );
}
