'use client';

import { Modal, Button, Flex, Spin, Empty, App, Tag } from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  CloseOutlined,
  ApartmentOutlined,
} from '@ant-design/icons';
import { useState, useCallback, useEffect } from 'react';
import { useModelStore } from '../stores/modelStore';
import { useProjectStore } from '../stores/projectStore';
import type { DataModel } from '../types';
import { parseModelFields, parseMixinModelIds } from '../types';
import { ModelFieldEditor } from './ModelFieldEditor';
import { ModelMapView } from './ModelMapView';

interface ModelManagerProps {
  open: boolean;
  onClose: () => void;
}

export function ModelManager({ open, onClose }: ModelManagerProps) {
  const { message, modal } = App.useApp();
  const { models, loading, loadModels, deleteModel } = useModelStore();
  const activeProjectId = useProjectStore((s) => s.activeProjectId);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<DataModel | null>(null);
  const [selectedModel, setSelectedModel] = useState<DataModel | null>(null);

  // Load models whenever the modal opens or the active project changes
  useEffect(() => {
    if (open && activeProjectId) {
      loadModels(activeProjectId);
    }
  }, [open, activeProjectId, loadModels]);

  // Clear selection when models reload
  useEffect(() => {
    setSelectedModel(null);
  }, [activeProjectId]);

  const openCreate = useCallback(() => {
    setEditingModel(null);
    setEditorOpen(true);
  }, []);

  const openEdit = useCallback((model: DataModel) => {
    setEditingModel(model);
    setEditorOpen(true);
  }, []);

  const handleEditorClose = useCallback(() => {
    setEditorOpen(false);
    setEditingModel(null);
  }, []);

  const handleNodeClick = useCallback(
    (model: DataModel | null) => {
      setSelectedModel(model);
    },
    [],
  );

  const handleDelete = useCallback(
    (model: DataModel) => {
      if (!activeProjectId) return;

      modal.confirm({
        title: 'Delete Model',
        content: `Are you sure you want to delete "${model.name}"? This cannot be undone.`,
        okText: 'Delete',
        okButtonProps: { danger: true },
        onOk: async () => {
          try {
            await deleteModel(model.id, activeProjectId);
            message.success(`"${model.name}" deleted.`);
            setSelectedModel((prev) => (prev?.id === model.id ? null : prev));
          } catch (error) {
            message.error(
              error instanceof Error ? error.message : 'Failed to delete model.',
            );
          }
        },
      });
    },
    [activeProjectId, deleteModel, modal, message],
  );

  const bodyContent = !activeProjectId ? (
    <Flex justify="center" align="center" style={{ height: '100%' }}>
      <Empty description="No project selected. Select a project to view its data models." />
    </Flex>
  ) : loading ? (
    <Flex justify="center" align="center" style={{ height: '100%' }}>
      <Spin size="large" />
    </Flex>
  ) : models.length === 0 ? (
    <Flex justify="center" align="center" style={{ height: '100%' }}>
      <Empty description="No data models yet.">
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          Add Model
        </Button>
      </Empty>
    </Flex>
  ) : (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <ModelMapView
        models={models}
        onNodeClick={handleNodeClick}
        selectedModelId={selectedModel?.id ?? null}
      />

      {/* Detail panel — shown when a node is selected */}
      {selectedModel && (
        <DetailPanel
          model={selectedModel}
          models={models}
          onEdit={openEdit}
          onDelete={handleDelete}
          onClose={() => setSelectedModel(null)}
        />
      )}
    </div>
  );

  return (
    <>
      <Modal
        open={open}
        onCancel={onClose}
        title={
          <Flex align="center" gap={12}>
            <ApartmentOutlined />
            <span>Data Models Map</span>
            {models.length > 0 && (
              <span style={{ color: 'var(--text-tertiary)', fontWeight: 400, fontSize: 13 }}>
                ({models.length})
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

// ─── Detail Panel ─────────────────────────────────────────────────────────────

interface DetailPanelProps {
  model: DataModel;
  models: DataModel[];
  onEdit: (model: DataModel) => void;
  onDelete: (model: DataModel) => void;
  onClose: () => void;
}

function DetailPanel({ model, models, onEdit, onDelete, onClose }: DetailPanelProps) {
  const fields = parseModelFields(model.fields);
  const mixinIds = parseMixinModelIds(model.mixin_model_ids);
  const parentModel = models.find((m) => m.id === model.parent_model_id);
  const mixinModels = mixinIds.map((id) => models.find((m) => m.id === id)).filter(Boolean) as DataModel[];

  return (
    <div
      style={{
        position: 'absolute',
        right: 16,
        top: 16,
        width: 290,
        background: 'rgba(20, 22, 38, 0.96)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 10,
        padding: 16,
        zIndex: 10,
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        backdropFilter: 'blur(8px)',
        maxHeight: 'calc(100% - 32px)',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {/* Header */}
      <Flex justify="space-between" align="flex-start">
        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.4 }}>
          {model.name}
        </div>
        <Button
          type="text"
          size="small"
          icon={<CloseOutlined />}
          onClick={onClose}
          style={{ color: 'var(--text-tertiary)', flexShrink: 0, marginTop: -2 }}
        />
      </Flex>

      {/* Description */}
      {model.description && (
        <div style={{ color: 'var(--text-tertiary)', fontSize: 12, lineHeight: 1.5 }}>
          {model.description}
        </div>
      )}

      {/* Inheritance */}
      {parentModel && (
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-quaternary)', marginBottom: 4 }}>
            EXTENDS
          </div>
          <Tag color="blue" style={{ fontSize: 12 }}>
            {parentModel.name}
          </Tag>
        </div>
      )}

      {/* Mixins */}
      {mixinModels.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-quaternary)', marginBottom: 4 }}>
            MIXINS
          </div>
          <Flex gap={4} wrap>
            {mixinModels.map((m) => (
              <Tag key={m.id} color="purple" style={{ fontSize: 12 }}>
                {m.name}
              </Tag>
            ))}
          </Flex>
        </div>
      )}

      {/* Own fields */}
      {fields.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-quaternary)', marginBottom: 6 }}>
            FIELDS ({fields.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {fields.map((f) => (
              <div
                key={f.name}
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 6,
                  fontSize: 12,
                  lineHeight: 1.4,
                }}
              >
                <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                  {f.name}
                  {f.required && (
                    <span style={{ color: '#ff6b6b', marginLeft: 1 }}>*</span>
                  )}
                </span>
                <span style={{ color: 'var(--text-quaternary)', fontSize: 11 }}>{f.field_type}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <Flex gap={8}>
        <Button
          size="small"
          icon={<EditOutlined />}
          onClick={() => onEdit(model)}
          style={{ flex: 1 }}
        >
          Edit
        </Button>
        <Button
          size="small"
          danger
          icon={<DeleteOutlined />}
          onClick={() => onDelete(model)}
          style={{ flex: 1 }}
        >
          Delete
        </Button>
      </Flex>
    </div>
  );
}
