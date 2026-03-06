'use client';

import { useEffect, useRef, useMemo, useCallback, useState } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import SpriteText from 'three-spritetext';
import * as THREE from 'three';
import { invoke } from '@tauri-apps/api/core';
import { Flex, Spin, Empty } from 'antd';
import { LoadingOutlined, WarningOutlined } from '@ant-design/icons';

import {
  type RustProjectGraphData,
  type ForceGraphNode,
  type ForceGraphLink,
  transformNodes,
  transformEdgesToLinks,
  hasCachedPositions,
  extractNodeData,
} from '../../utils/graphDataTransform';
import { useLayoutComputeStore } from '../../stores/layoutComputeStore';
import { MapDetailPanel } from './MapDetailPanel';
import { MapLegend } from './MapLegend';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SelectedNodeType = 'collection' | 'request' | 'model';

interface SelectedNodeInfo {
  nodeId: string;
  nodeType: SelectedNodeType;
  nodeData: ReturnType<typeof extractNodeData>;
}

// ---------------------------------------------------------------------------
// Overlay styles
// ---------------------------------------------------------------------------

const OVERLAY_BASE: React.CSSProperties = {
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

const COMPUTING_OVERLAY_STYLE: React.CSSProperties = {
  ...OVERLAY_BASE,
  background: 'rgba(10, 10, 15, 0.85)',
  border: '1px solid var(--border)',
};

const ERROR_OVERLAY_STYLE: React.CSSProperties = {
  ...OVERLAY_BASE,
  background: 'rgba(30, 10, 10, 0.85)',
  border: '1px solid rgba(255, 77, 79, 0.4)',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ForceGraph3DCanvasProps {
  projectId: string | null;
  refreshKey: number;
  onEditModel: (modelId: string) => void;
  onDeleteModel: (modelId: string) => void;
  onOpenRequest?: (requestId: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ForceGraph3DCanvas({
  projectId,
  refreshKey,
  onEditModel,
  onDeleteModel,
  onOpenRequest,
}: ForceGraph3DCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const positionsSavedRef = useRef(false);

  const [nodes, setNodes] = useState<ForceGraphNode[]>([]);
  const [links, setLinks] = useState<ForceGraphLink[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isComputing, setIsComputing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasCached, setHasCached] = useState(false);
  const [selectedNode, setSelectedNode] = useState<SelectedNodeInfo | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  // Track container dimensions
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setDimensions({ width: Math.floor(width), height: Math.floor(height) });
        }
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Load graph data from Rust backend
  useEffect(() => {
    if (!projectId) return;

    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setSelectedNode(null);
    positionsSavedRef.current = false;
    useLayoutComputeStore.getState().setComputing(true);
    setIsComputing(true);

    invoke<RustProjectGraphData>('build_project_graph', {
      projectId,
    })
      .then((data) => {
        if (cancelled) return;

        const cached = hasCachedPositions(data.nodes);
        setHasCached(cached);
        setNodes(transformNodes(data.nodes));
        setLinks(transformEdgesToLinks(data.edges));

        if (cached) {
          // Positions already cached — no physics needed
          setIsComputing(false);
          useLayoutComputeStore.getState().setComputing(false);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setIsComputing(false);
        useLayoutComputeStore.getState().setComputing(false);
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, refreshKey]);

  // Graph data for ForceGraph3D
  const graphData = useMemo(() => ({ nodes, links }), [nodes, links]);

  // Engine stop handler — save positions
  const handleEngineStop = useCallback(() => {
    if (positionsSavedRef.current || nodes.length === 0) return;
    positionsSavedRef.current = true;

    setIsComputing(false);
    useLayoutComputeStore.getState().setComputing(false);

    // Collect runtime positions and save to backend
    const positions = nodes
      .filter((n) => typeof n.x === 'number' && typeof n.y === 'number' && typeof n.z === 'number')
      .map((n) => ({
        id: n.id,
        fx: n.x ?? 0,
        fy: n.y ?? 0,
        fz: n.z ?? 0,
      }));

    if (positions.length > 0) {
      invoke('save_graph_positions', { positions }).catch(() => {
        // Best-effort — don't fail the UI
      });
    }
  }, [nodes]);

  // Node click handler
  const handleNodeClick = useCallback((node: ForceGraphNode) => {
    setSelectedNode({
      nodeId: node.id,
      nodeType: node.entity_type,
      nodeData: extractNodeData(node),
    });
  }, []);

  // Background click handler
  const handleBackgroundClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  // Close detail panel
  const handleClosePanel = useCallback(() => {
    setSelectedNode(null);
  }, []);

  // Custom node rendering — sprite text labels
  const nodeThreeObject = useCallback((node: ForceGraphNode) => {
    const group = new THREE.Group();

    // Type marker (letter or HTTP method) above the sphere
    const markerText =
      node.entity_type === 'collection'
        ? 'C'
        : node.entity_type === 'model'
          ? 'M'
          : ((node.properties.method as string) ?? 'GET').toUpperCase();

    const marker = new SpriteText(markerText);
    marker.color = node.color;
    marker.textHeight = 3;
    marker.fontWeight = 'bold';
    marker.position.set(0, node.size + 2, 0);

    // Name label below the sphere
    const label = new SpriteText(
      node.label.length > 20 ? `${node.label.slice(0, 18)}…` : node.label,
    );
    label.color = 'rgba(255, 255, 255, 0.85)';
    label.textHeight = 2;
    label.position.set(0, -(node.size + 2), 0);

    group.add(marker);
    group.add(label);
    return group;
  }, []);

  // Node color accessor
  const nodeColor = useCallback((node: ForceGraphNode) => node.color, []);

  // Node size accessor
  const nodeVal = useCallback((node: ForceGraphNode) => node.size, []);

  // Link color accessor
  const linkColor = useCallback((link: ForceGraphLink) => link.color, []);

  // Link width accessor
  const linkWidth = useCallback((link: ForceGraphLink) => link.width, []);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (!projectId) {
    return (
      <Flex justify="center" align="center" style={{ width: '100%', height: '100%' }}>
        <Empty description="No project selected." />
      </Flex>
    );
  }

  if (isLoading) {
    return (
      <Flex justify="center" align="center" style={{ width: '100%', height: '100%' }}>
        <Spin size="large" />
      </Flex>
    );
  }

  if (error && nodes.length === 0) {
    return (
      <Flex
        justify="center"
        align="center"
        vertical
        gap={8}
        style={{ width: '100%', height: '100%' }}
      >
        <WarningOutlined style={{ color: '#ff4d4f', fontSize: 24 }} />
        <span style={{ color: '#ff4d4f', fontSize: 13 }}>
          Failed to load graph: {error}
        </span>
      </Flex>
    );
  }

  if (nodes.length === 0) {
    return (
      <Flex justify="center" align="center" style={{ width: '100%', height: '100%' }}>
        <Empty description="No collections or models yet." />
      </Flex>
    );
  }

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <ForceGraph3D
        graphData={graphData}
        width={dimensions.width}
        height={dimensions.height}
        backgroundColor="rgba(10, 10, 15, 1)"
        nodeId="id"
        nodeVal={nodeVal}
        nodeColor={nodeColor}
        nodeLabel=""
        nodeThreeObjectExtend={true}
        nodeThreeObject={nodeThreeObject}
        linkSource="source"
        linkTarget="target"
        linkColor={linkColor}
        linkWidth={linkWidth}
        linkDirectionalArrowLength={3.5}
        linkDirectionalArrowRelPos={1}
        linkCurvature={0.15}
        linkOpacity={0.6}
        warmupTicks={hasCached ? 0 : 50}
        cooldownTicks={hasCached ? 0 : 300}
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.4}
        onEngineStop={handleEngineStop}
        onNodeClick={handleNodeClick}
        onBackgroundClick={handleBackgroundClick}
        showNavInfo={false}
      />

      {isComputing && (
        <div style={COMPUTING_OVERLAY_STYLE}>
          <LoadingOutlined style={{ color: '#fbbf24', fontSize: 14 }} />
          <span style={{ color: '#fbbf24', fontSize: 12, fontWeight: 500 }}>
            Computing 3D layout...
          </span>
        </div>
      )}

      {error && !isComputing && (
        <div style={ERROR_OVERLAY_STYLE}>
          <WarningOutlined style={{ color: '#ff4d4f', fontSize: 14 }} />
          <span style={{ color: '#ff4d4f', fontSize: 12, fontWeight: 500 }}>
            Layout error — {error}
          </span>
        </div>
      )}

      {selectedNode && (
        <MapDetailPanel
          nodeType={selectedNode.nodeType}
          nodeData={selectedNode.nodeData}
          nodeId={selectedNode.nodeId}
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
