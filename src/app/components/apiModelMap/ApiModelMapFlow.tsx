'use client';

import '@xyflow/react/dist/style.css';

import { useEffect, useRef, useMemo, useCallback, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useEdgesState,
  type Node,
  type Edge,
  type NodeTypes,
  type EdgeTypes,
  type NodeMouseHandler,
} from '@xyflow/react';
import { Modal, Button, Flex, Spin, Empty, App } from 'antd';
import { ApartmentOutlined, PlusOutlined } from '@ant-design/icons';

import { useProjectStore } from '../../stores/projectStore';
import { useCollectionStore, ROOT_REQUESTS_KEY } from '../../stores/collectionStore';
import { useModelStore } from '../../stores/modelStore';
import { buildApiModelMap } from '../../utils/apiModelMapLayout';
import type {
  CollectionNodeData,
  RequestNodeData,
  ModelNodeData,
} from '../../utils/apiModelMapLayout';

import CollectionNode from './CollectionNode';
import RequestNode from './RequestNode';
import ModelNode from './ModelNode';
import LabeledEdge from './LabeledEdge';
import { useForceLayout } from './useForceLayout';
import { MapDetailPanel } from './MapDetailPanel';
import { MapLegend } from './MapLegend';
import { ModelFieldEditor } from '../ModelFieldEditor';
import type { Collection, DataModel, ApiRequest } from '../../types';

// ---------------------------------------------------------------------------
// Node types — defined outside component to prevent re-registration on render
// ---------------------------------------------------------------------------

const NODE_TYPES: NodeTypes = {
  collectionNode: CollectionNode,
  requestNode: RequestNode,
  modelNode: ModelNode,
};

const EDGE_TYPES: EdgeTypes = {
  labeledEdge: LabeledEdge,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ApiModelMapModalProps {
  open: boolean;
  onClose: () => void;
}

type SelectedNodeType = 'collection' | 'request' | 'model';

interface SelectedNodeInfo {
  nodeId: string;
  nodeType: SelectedNodeType;
  nodeData: CollectionNodeData | RequestNodeData | ModelNodeData;
}

// ---------------------------------------------------------------------------
// Inner canvas — wrapped in ReactFlowProvider by the modal
// ---------------------------------------------------------------------------

interface ApiModelMapFlowInnerProps {
  collections: Collection[];
  requestsByCollection: Map<string, ApiRequest[]>;
  rootRequests: ApiRequest[];
  models: DataModel[];
  onEditModel: (modelId: string) => void;
  onDeleteModel: (modelId: string) => void;
}

function ApiModelMapFlowInner({
  collections,
  requestsByCollection,
  rootRequests,
  models,
  onEditModel,
  onDeleteModel,
}: ApiModelMapFlowInnerProps) {
  const [selectedNode, setSelectedNode] = useState<SelectedNodeInfo | null>(null);

  // Compute layout whenever source data changes (pure, no side effects)
  const layout = useMemo(
    () => buildApiModelMap(collections, requestsByCollection, rootRequests, models),
    [collections, requestsByCollection, rootRequests, models],
  );

  // Force-directed simulation manages node positions
  const { nodes, onNodesChange } = useForceLayout(layout.nodes, layout.edges);

  // Edges are static — synced from layout
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(layout.edges);

  useEffect(() => {
    setEdges(layout.edges);
  }, [layout, setEdges]);

  // Clear selection when data reloads (e.g. after delete)
  useEffect(() => {
    setSelectedNode(null);
  }, [models]);

  const handleNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    const rawType = node.type ?? '';
    let nodeType: SelectedNodeType | null = null;

    if (rawType === 'collectionNode') nodeType = 'collection';
    else if (rawType === 'requestNode') nodeType = 'request';
    else if (rawType === 'modelNode') nodeType = 'model';

    if (!nodeType) return;

    setSelectedNode({
      nodeId: node.id,
      nodeType,
      nodeData: node.data as CollectionNodeData | RequestNodeData | ModelNodeData,
    });
  }, []);

  const handlePaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  const handleClosePanel = useCallback(() => {
    setSelectedNode(null);
  }, []);

  // MiniMap node colors matching circular node themes
  const miniMapNodeColor = useCallback((n: { type?: string }) => {
    if (n.type === 'collectionNode') return '#fbbf24'; // amber
    if (n.type === 'requestNode') return '#34d399';    // green
    if (n.type === 'modelNode') return '#4a9eff';      // blue
    return '#1e1e2a';
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.1}
        maxZoom={3}
        defaultEdgeOptions={{ type: 'labeledEdge' }}
        style={{ background: 'var(--bg-primary)' }}
      >
        <Background color="rgba(255,255,255,0.03)" gap={20} size={1} />
        <Controls position="top-right" />
        <MiniMap
          position="bottom-right"
          nodeColor={miniMapNodeColor}
          maskColor="rgba(10,10,15,0.75)"
          style={{
            border: '1px solid var(--border)',
            borderRadius: 6,
          }}
        />
      </ReactFlow>

      {/* Detail panel — absolute overlay on node selection */}
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

      {/* Legend — bottom-left absolute overlay */}
      <MapLegend />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main exported modal component
// ---------------------------------------------------------------------------

export function ApiModelMapModal({ open, onClose }: ApiModelMapModalProps) {
  const { message, modal } = App.useApp();

  // Narrow selectors — avoid subscribing to the entire store object
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const collections = useCollectionStore((s) => s.collections);
  const requestsMap = useCollectionStore((s) => s.requests);
  const loadCollections = useCollectionStore((s) => s.loadCollections);
  const loadRequests = useCollectionStore((s) => s.loadRequests);
  const loadRootRequests = useCollectionStore((s) => s.loadRootRequests);
  const models = useModelStore((s) => s.models);
  const modelsLoading = useModelStore((s) => s.loading);
  const loadModels = useModelStore((s) => s.loadModels);
  const deleteModel = useModelStore((s) => s.deleteModel);

  const [dataLoading, setDataLoading] = useState(false);

  // ModelFieldEditor sub-modal state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<DataModel | null>(null);

  // runId guard — stale load protection
  const loadIdCounter = useRef(0);

  // ---------------------------------------------------------------------------
  // Data loading effect — fires when modal opens or active project changes
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!open || !activeProjectId) return;

    let cancelled = false;
    const loadId = ++loadIdCounter.current;

    async function load() {
      setDataLoading(true);
      try {
        // Step 1: load collections (populates store)
        await loadCollections(activeProjectId!);

        if (cancelled || loadIdCounter.current !== loadId) return;

        // Step 2: read collections from store state after load
        const currentCollections = useCollectionStore.getState().collections;

        // Step 3: fan-out — load requests for every collection + root requests
        await Promise.all([
          ...currentCollections.map((c) => loadRequests(c.id)),
          loadRootRequests(activeProjectId!),
          loadModels(activeProjectId!),
        ]);

        if (cancelled || loadIdCounter.current !== loadId) return;
      } catch (err) {
        if (cancelled || loadIdCounter.current !== loadId) return;
        message.error(
          err instanceof Error ? err.message : 'Failed to load map data.',
        );
      } finally {
        if (!cancelled && loadIdCounter.current === loadId) {
          setDataLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [open, activeProjectId, loadCollections, loadRequests, loadRootRequests, loadModels, message]);

  // ---------------------------------------------------------------------------
  // Derived data — build request maps for the canvas
  // ---------------------------------------------------------------------------

  const requestsByCollection = useMemo<Map<string, ApiRequest[]>>(() => {
    const result = new Map<string, ApiRequest[]>();
    for (const [key, reqs] of requestsMap.entries()) {
      if (key !== ROOT_REQUESTS_KEY) {
        result.set(key, reqs);
      }
    }
    return result;
  }, [requestsMap]);

  const rootRequests = useMemo<ApiRequest[]>(
    () => requestsMap.get(ROOT_REQUESTS_KEY) ?? [],
    [requestsMap],
  );

  // ---------------------------------------------------------------------------
  // Model editor callbacks
  // ---------------------------------------------------------------------------

  const openCreate = useCallback(() => {
    setEditingModel(null);
    setEditorOpen(true);
  }, []);

  const openEdit = useCallback((modelId: string) => {
    const target = useModelStore.getState().models.find((m) => m.id === modelId) ?? null;
    setEditingModel(target);
    setEditorOpen(true);
  }, []);

  const handleEditorClose = useCallback(() => {
    setEditorOpen(false);
    setEditingModel(null);
  }, []);

  const handleDeleteModel = useCallback(
    (modelId: string) => {
      if (!activeProjectId) return;
      const target = useModelStore.getState().models.find((m) => m.id === modelId);
      if (!target) return;

      modal.confirm({
        title: `Delete "${target.name}"?`,
        content: 'This will permanently delete the model and cannot be undone.',
        okText: 'Delete',
        okButtonProps: { danger: true },
        onOk: async () => {
          try {
            await deleteModel(modelId, activeProjectId);
            message.success(`"${target.name}" deleted.`);
          } catch (err) {
            message.error(
              err instanceof Error ? err.message : 'Failed to delete model.',
            );
          }
        },
      });
    },
    [activeProjectId, deleteModel, modal, message],
  );

  // ---------------------------------------------------------------------------
  // Render body
  // ---------------------------------------------------------------------------

  const isLoading = dataLoading || modelsLoading;
  const hasData =
    collections.length > 0 || models.length > 0;

  const bodyContent = !activeProjectId ? (
    <Flex justify="center" align="center" style={{ height: '100%' }}>
      <Empty description="No project selected. Select a project to view its API & Model Map." />
    </Flex>
  ) : isLoading ? (
    <Flex justify="center" align="center" style={{ height: '100%' }}>
      <Spin size="large" />
    </Flex>
  ) : !hasData ? (
    <Flex justify="center" align="center" style={{ height: '100%' }}>
      <Empty description="No collections or models yet.">
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          Add Model
        </Button>
      </Empty>
    </Flex>
  ) : (
    <ReactFlowProvider>
      <ApiModelMapFlowInner
        collections={collections}
        requestsByCollection={requestsByCollection}
        rootRequests={rootRequests}
        models={models}
        onEditModel={openEdit}
        onDeleteModel={handleDeleteModel}
      />
    </ReactFlowProvider>
  );

  // ---------------------------------------------------------------------------
  // Modal
  // ---------------------------------------------------------------------------

  return (
    <>
      <Modal
        open={open}
        onCancel={onClose}
        title={
          <Flex align="center" gap={12}>
            <ApartmentOutlined />
            <span>API &amp; Model Map</span>
            {(collections.length > 0 || models.length > 0) && (
              <span
                style={{
                  color: 'var(--text-tertiary)',
                  fontWeight: 400,
                  fontSize: 13,
                }}
              >
                ({collections.length} collection{collections.length !== 1 ? 's' : ''},{' '}
                {models.length} model{models.length !== 1 ? 's' : ''})
              </span>
            )}
            <Button
              type="primary"
              size="small"
              icon={<PlusOutlined />}
              onClick={openCreate}
              disabled={!activeProjectId}
            >
              Add Model
            </Button>
          </Flex>
        }
        footer={null}
        destroyOnHidden
        width="100vw"
        style={{ top: 0, padding: 0, maxWidth: '100vw' }}
        styles={{
          header: {
            padding: '10px 16px',
            borderBottom: '1px solid var(--border)',
          },
          body: {
            height: 'calc(100vh - 55px)',
            padding: 0,
            overflow: 'hidden',
          },
        }}
      >
        {bodyContent}
      </Modal>

      <ModelFieldEditor
        open={editorOpen}
        model={editingModel}
        onClose={handleEditorClose}
      />
    </>
  );
}
