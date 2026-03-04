'use client';

import { useEffect, useRef, useMemo, useCallback, useState } from 'react';
import dynamic from 'next/dynamic';
import { Modal, Button, Flex, Spin, Empty, App } from 'antd';
import { ApartmentOutlined, PlusOutlined } from '@ant-design/icons';

import { useProjectStore } from '../../stores/projectStore';
import { useCollectionStore, ROOT_REQUESTS_KEY } from '../../stores/collectionStore';
import { useModelStore } from '../../stores/modelStore';
import { ModelFieldEditor } from '../ModelFieldEditor';
import type { DataModel, ApiRequest } from '../../types';

// ---------------------------------------------------------------------------
// Dynamic import — Sigma.js requires WebGL (browser only, no SSR)
// ---------------------------------------------------------------------------

const SigmaCanvas = dynamic(() => import('./SigmaCanvas'), { ssr: false });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ApiModelMapModalProps {
  open: boolean;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Main exported modal component
// ---------------------------------------------------------------------------

export function ApiModelMapModal({ open, onClose }: ApiModelMapModalProps) {
  const { message, modal } = App.useApp();

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

  // Data loading effect
  useEffect(() => {
    if (!open || !activeProjectId) return;

    let cancelled = false;
    const loadId = ++loadIdCounter.current;

    async function load() {
      setDataLoading(true);
      try {
        await loadCollections(activeProjectId!);
        if (cancelled || loadIdCounter.current !== loadId) return;

        // Read latest collections and filter by active project to guard
        // against a TOCTOU race if activeProjectId changed during await.
        const currentCollections = useCollectionStore.getState().collections
          .filter((c) => c.project_id === activeProjectId);

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

  // Derived data
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

  // Model editor callbacks
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

  // Render body
  const isLoading = dataLoading || modelsLoading;
  const hasData = collections.length > 0 || models.length > 0 || rootRequests.length > 0;

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
    <SigmaCanvas
      collections={collections}
      requestsByCollection={requestsByCollection}
      rootRequests={rootRequests}
      models={models}
      projectId={activeProjectId}
      onEditModel={openEdit}
      onDeleteModel={handleDeleteModel}
    />
  );

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
