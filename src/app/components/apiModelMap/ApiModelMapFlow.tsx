'use client';

import { useCallback, useState } from 'react';
import dynamic from 'next/dynamic';
import { Modal, Button, Flex, App } from 'antd';
import { ApartmentOutlined, PlusOutlined } from '@ant-design/icons';

import { useProjectStore } from '../../stores/projectStore';
import { useModelStore } from '../../stores/modelStore';
import { ModelFieldEditor } from '../ModelFieldEditor';
import type { DataModel } from '../../types';

// ---------------------------------------------------------------------------
// Dynamic import — Three.js / WebGL require browser only, no SSR
// ---------------------------------------------------------------------------

const ForceGraph3DCanvas = dynamic(() => import('./ForceGraph3DCanvas'), {
  ssr: false,
});

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
  const deleteModel = useModelStore((s) => s.deleteModel);

  // refreshKey is incremented after model create/edit/delete to trigger
  // ForceGraph3DCanvas to rebuild the graph from the Rust backend.
  const [refreshKey, setRefreshKey] = useState(0);

  // ModelFieldEditor sub-modal state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<DataModel | null>(null);

  // Model editor callbacks
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
    // Rebuild graph after model create/edit
    setRefreshKey((k) => k + 1);
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
            // Rebuild graph after model delete
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
      <Modal
        open={open}
        onCancel={onClose}
        title={
          <Flex align="center" gap={12}>
            <ApartmentOutlined />
            <span>API &amp; Model Map (3D)</span>
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
        <ForceGraph3DCanvas
          projectId={activeProjectId}
          refreshKey={refreshKey}
          onEditModel={openEdit}
          onDeleteModel={handleDeleteModel}
        />
      </Modal>

      <ModelFieldEditor
        open={editorOpen}
        model={editingModel}
        onClose={handleEditorClose}
      />
    </>
  );
}
