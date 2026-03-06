'use client';

import { useCallback, useState } from 'react';
import dynamic from 'next/dynamic';
import { Button, Tooltip, App } from 'antd';
import { PlusOutlined } from '@ant-design/icons';

import { useProjectStore } from '../stores/projectStore';
import { useModelStore } from '../stores/modelStore';
import { useCollectionStore } from '../stores/collectionStore';
import { useRequestEditorStore } from '../stores/requestStore';
import { ModelFieldEditor } from './ModelFieldEditor';
import type { DataModel } from '../types';
import { parseConfig } from '../types';

const ForceGraph3DCanvas = dynamic(() => import('./apiModelMap/ForceGraph3DCanvas'), {
  ssr: false,
});

export function GraphCenterPanel() {
  const { message, modal } = App.useApp();

  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const deleteModel = useModelStore((s) => s.deleteModel);

  const [refreshKey, setRefreshKey] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<DataModel | null>(null);

  const openCreate = useCallback(() => {
    setEditingModel(null);
    setEditorOpen(true);
  }, []);

  const openEdit = useCallback((modelId: string) => {
    const target =
      useModelStore.getState().models.find((m) => m.id === modelId) ?? null;
    setEditingModel(target);
    setEditorOpen(true);
  }, []);

  const handleEditorClose = useCallback(() => {
    setEditorOpen(false);
    setEditingModel(null);
    setRefreshKey((k) => k + 1);
  }, []);

  const handleOpenRequest = useCallback((requestId: string) => {
    const allRequests = useCollectionStore.getState().requests;
    for (const [, reqs] of allRequests) {
      const found = reqs.find((r) => r.id === requestId);
      if (found) {
        const config = parseConfig(found.config);
        const { setActiveRequest, openRequestModal } = useRequestEditorStore.getState();
        setActiveRequest(found.id, config);
        openRequestModal();
        useCollectionStore.getState().setSelectedRequest(found.id);
        if (found.collection_id) {
          useCollectionStore.getState().setSelectedCollection(found.collection_id);
        }
        return;
      }
    }
  }, []);

  const handleDeleteModel = useCallback(
    (modelId: string) => {
      if (!activeProjectId) return;
      const target = useModelStore
        .getState()
        .models.find((m) => m.id === modelId);
      if (!target) return;

      modal.confirm({
        title: `Delete "${target.name}"?`,
        content:
          'This will permanently delete the model and cannot be undone.',
        okText: 'Delete',
        okButtonProps: { danger: true },
        onOk: async () => {
          try {
            await deleteModel(modelId, activeProjectId);
            message.success(`"${target.name}" deleted.`);
            setRefreshKey((k) => k + 1);
          } catch (err) {
            message.error(
              err instanceof Error
                ? err.message
                : 'Failed to delete model.',
            );
          }
        },
      });
    },
    [activeProjectId, deleteModel, modal, message],
  );

  return (
    <>
      <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
        <ForceGraph3DCanvas
          projectId={activeProjectId}
          refreshKey={refreshKey}
          onEditModel={openEdit}
          onDeleteModel={handleDeleteModel}
          onOpenRequest={handleOpenRequest}
        />

        <Tooltip title="Add Model" placement="left">
          <Button
            type="primary"
            shape="circle"
            icon={<PlusOutlined />}
            disabled={!activeProjectId}
            onClick={openCreate}
            style={{
              position: 'absolute',
              top: 16,
              right: 16,
              zIndex: 10,
              boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            }}
          />
        </Tooltip>
      </div>

      <ModelFieldEditor
        open={editorOpen}
        model={editingModel}
        onClose={handleEditorClose}
      />
    </>
  );
}
