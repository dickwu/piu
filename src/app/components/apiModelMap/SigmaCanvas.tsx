'use client';

import { useEffect, useMemo, useCallback, useState } from 'react';
import { SigmaContainer, useLoadGraph, useRegisterEvents, useCamera, useSigma } from '@react-sigma/core';
import '@react-sigma/core/lib/style.css';
import { EdgeCurvedArrowProgram, indexParallelEdgesIndex } from '@sigma/edge-curve';
import MultiDirectedGraph from 'graphology';
import type { Settings } from 'sigma/settings';
import { Button } from 'antd';
import {
  LoadingOutlined,
  WarningOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  ExpandOutlined,
} from '@ant-design/icons';

import {
  buildGraphologyData,
  type SigmaNodeAttributes,
  type SigmaEdgeAttributes,
  type CollectionNodeData,
  type RequestNodeData,
  type ModelNodeData,
  type NodeCategory,
} from '../../utils/apiModelMapGraph';
import { ApiNodeProgram } from './nodePrograms';
import { useSigmaLayout } from './useSigmaLayout';
import { MapDetailPanel } from './MapDetailPanel';
import { MapLegend } from './MapLegend';
import type { Collection, DataModel, ApiRequest } from '../../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SelectedNodeType = 'collection' | 'request' | 'model';

interface SelectedNodeInfo {
  nodeId: string;
  nodeType: SelectedNodeType;
  nodeData: CollectionNodeData | RequestNodeData | ModelNodeData;
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

const ZOOM_CONTROLS_STYLE: React.CSSProperties = {
  position: 'absolute',
  top: 12,
  right: 12,
  zIndex: 10,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

// ---------------------------------------------------------------------------
// Sigma settings
// ---------------------------------------------------------------------------

const SIGMA_SETTINGS: Partial<Settings<SigmaNodeAttributes, SigmaEdgeAttributes>> = {
  allowInvalidContainer: true,
  renderLabels: true,
  renderEdgeLabels: true,
  labelSize: 11,
  labelFont: 'Inter, system-ui, sans-serif',
  labelColor: { color: 'rgba(255, 255, 255, 0.9)' },
  edgeLabelSize: 9,
  edgeLabelFont: 'Inter, system-ui, sans-serif',
  edgeLabelColor: { color: 'rgba(255, 255, 255, 0.45)' },
  defaultNodeColor: 'rgba(30, 30, 42, 0.9)',
  defaultEdgeColor: '#555',
  defaultEdgeType: 'curvedArrow',
  enableEdgeEvents: false,
  minCameraRatio: 0.1,
  maxCameraRatio: 3,
  labelDensity: 1,
  labelRenderedSizeThreshold: 4,
  stagePadding: 40,
  nodeProgramClasses: {
    border: ApiNodeProgram,
  },
  edgeProgramClasses: {
    curvedArrow: EdgeCurvedArrowProgram,
  },
};

// ---------------------------------------------------------------------------
// GraphLoader — child of SigmaContainer
// ---------------------------------------------------------------------------

interface GraphLoaderProps {
  graph: MultiDirectedGraph<SigmaNodeAttributes, SigmaEdgeAttributes>;
  projectId: string | null;
  onNodeClick: (info: SelectedNodeInfo) => void;
  onStageClick: () => void;
  onComputingChange: (isComputing: boolean) => void;
  onErrorChange: (error: string | null) => void;
}

function GraphLoader({
  graph,
  projectId,
  onNodeClick,
  onStageClick,
  onComputingChange,
  onErrorChange,
}: GraphLoaderProps) {
  const sigma = useSigma<SigmaNodeAttributes, SigmaEdgeAttributes>();
  const loadGraph = useLoadGraph<SigmaNodeAttributes, SigmaEdgeAttributes>();
  const registerEvents = useRegisterEvents<SigmaNodeAttributes, SigmaEdgeAttributes>();

  // Load graph into Sigma, then compute parallel edge curvatures on Sigma's
  // internal graph instance (not the source graph) so attributes are present.
  useEffect(() => {
    loadGraph(graph);
    indexParallelEdgesIndex(sigma.getGraph());
  }, [graph, loadGraph, sigma]);

  // Layout hook — invokes Rust + applies positions to graphology.
  // Note: graph.setNodeAttribute() mutations are intentional — Sigma's
  // renderer watches the graphology instance via events for auto-rerender.
  const { isComputing, error } = useSigmaLayout(graph, projectId);

  useEffect(() => {
    onComputingChange(isComputing);
  }, [isComputing, onComputingChange]);

  useEffect(() => {
    onErrorChange(error);
  }, [error, onErrorChange]);

  // Read node attributes from Sigma's internal graph to avoid stale closure
  useEffect(() => {
    registerEvents({
      clickNode: ({ node }) => {
        const sigmaGraph = sigma.getGraph();
        if (!sigmaGraph.hasNode(node)) return;
        const attrs = sigmaGraph.getNodeAttributes(node) as SigmaNodeAttributes;
        const nodeTypeMap: Record<NodeCategory, SelectedNodeType> = {
          collection: 'collection',
          request: 'request',
          model: 'model',
        };
        onNodeClick({
          nodeId: node,
          nodeType: nodeTypeMap[attrs.nodeCategory],
          nodeData: attrs.nodeData,
        });
      },
      clickStage: () => {
        onStageClick();
      },
    });
  }, [registerEvents, sigma, onNodeClick, onStageClick]);

  return null;
}

// ---------------------------------------------------------------------------
// Zoom controls
// ---------------------------------------------------------------------------

function ZoomControls() {
  const { zoomIn, zoomOut, reset } = useCamera();

  return (
    <div style={ZOOM_CONTROLS_STYLE}>
      <Button
        size="small"
        icon={<ZoomInOutlined />}
        onClick={() => zoomIn({ duration: 200 })}
        style={{ background: 'rgba(10,10,15,0.8)', border: '1px solid var(--border)' }}
      />
      <Button
        size="small"
        icon={<ZoomOutOutlined />}
        onClick={() => zoomOut({ duration: 200 })}
        style={{ background: 'rgba(10,10,15,0.8)', border: '1px solid var(--border)' }}
      />
      <Button
        size="small"
        icon={<ExpandOutlined />}
        onClick={() => reset({ duration: 300 })}
        style={{ background: 'rgba(10,10,15,0.8)', border: '1px solid var(--border)' }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exported canvas component (dynamically imported by ApiModelMapFlow)
// ---------------------------------------------------------------------------

export interface SigmaCanvasProps {
  collections: Collection[];
  requestsByCollection: Map<string, ApiRequest[]>;
  rootRequests: ApiRequest[];
  models: DataModel[];
  projectId: string | null;
  onEditModel: (modelId: string) => void;
  onDeleteModel: (modelId: string) => void;
}

export default function SigmaCanvas({
  collections,
  requestsByCollection,
  rootRequests,
  models,
  projectId,
  onEditModel,
  onDeleteModel,
}: SigmaCanvasProps) {
  const [selectedNode, setSelectedNode] = useState<SelectedNodeInfo | null>(null);
  const [isComputing, setIsComputing] = useState(false);
  const [layoutError, setLayoutError] = useState<string | null>(null);

  const graph = useMemo(
    () => buildGraphologyData(collections, requestsByCollection, rootRequests, models),
    [collections, requestsByCollection, rootRequests, models],
  );

  // Clear selection when data changes (any node/edge source)
  useEffect(() => {
    setSelectedNode(null);
  }, [collections, requestsByCollection, models, rootRequests]);

  const handleNodeClick = useCallback((info: SelectedNodeInfo) => {
    setSelectedNode(info);
  }, []);

  const handleStageClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  const handleClosePanel = useCallback(() => {
    setSelectedNode(null);
  }, []);

  const handleComputingChange = useCallback((computing: boolean) => {
    setIsComputing(computing);
  }, []);

  const handleErrorChange = useCallback((error: string | null) => {
    setLayoutError(error);
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <SigmaContainer
        graph={MultiDirectedGraph}
        settings={SIGMA_SETTINGS}
        style={{
          width: '100%',
          height: '100%',
          background: 'var(--bg-primary, #0a0a0f)',
        }}
      >
        <GraphLoader
          graph={graph}
          projectId={projectId}
          onNodeClick={handleNodeClick}
          onStageClick={handleStageClick}
          onComputingChange={handleComputingChange}
          onErrorChange={handleErrorChange}
        />
        <ZoomControls />
      </SigmaContainer>

      {isComputing && (
        <div style={COMPUTING_OVERLAY_STYLE}>
          <LoadingOutlined style={{ color: '#fbbf24', fontSize: 14 }} />
          <span style={{ color: '#fbbf24', fontSize: 12, fontWeight: 500 }}>
            Computing layout...
          </span>
        </div>
      )}

      {layoutError && !isComputing && (
        <div style={ERROR_OVERLAY_STYLE}>
          <WarningOutlined style={{ color: '#ff4d4f', fontSize: 14 }} />
          <span style={{ color: '#ff4d4f', fontSize: 12, fontWeight: 500 }}>
            Layout failed — {layoutError}
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
        />
      )}

      <MapLegend />
    </div>
  );
}
