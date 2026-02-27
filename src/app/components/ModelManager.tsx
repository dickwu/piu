'use client';

import { Drawer, Button, Flex, Badge, Spin, Empty, App } from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  DatabaseOutlined,
} from '@ant-design/icons';
import { useState, useCallback, useEffect } from 'react';
import { useModelStore } from '../stores/modelStore';
import { useProjectStore } from '../stores/projectStore';
import type { DataModel } from '../types';
import { parseModelFields } from '../types';
import { ModelFieldEditor } from './ModelFieldEditor';

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

  // Load models whenever the drawer opens or the active project changes
  useEffect(() => {
    if (open && activeProjectId) {
      loadModels(activeProjectId);
    }
  }, [open, activeProjectId, loadModels]);

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

  return (
    <>
      <Drawer
        title="Data Models"
        open={open}
        onClose={onClose}
        destroyOnHidden
        size={520}
        extra={
          <Button
            type="primary"
            size="small"
            icon={<PlusOutlined />}
            onClick={openCreate}
            disabled={!activeProjectId}
          >
            Add Model
          </Button>
        }
      >
        {!activeProjectId ? (
          <Empty
            description="No project selected. Select a project to manage its data models."
            style={{ marginTop: 48 }}
          />
        ) : loading ? (
          <Flex justify="center" style={{ padding: 48 }}>
            <Spin />
          </Flex>
        ) : models.length === 0 ? (
          <Empty
            description="No data models yet."
            style={{ marginTop: 48 }}
          >
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              Add Model
            </Button>
          </Empty>
        ) : (
          <Flex vertical gap={0}>
            {models.map((model) => {
              const fieldCount = parseModelFields(model.fields).length;

              return (
                <div
                  key={model.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 0',
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  {/* Icon */}
                  <DatabaseOutlined
                    style={{
                      color: 'var(--text-tertiary)',
                      fontSize: 16,
                      flexShrink: 0,
                    }}
                  />

                  {/* Name + meta */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                      }}
                    >
                      <span
                        style={{
                          fontFamily: 'var(--font-ui)',
                          fontSize: 13,
                          fontWeight: 600,
                          color: 'var(--text-primary)',
                        }}
                      >
                        {model.name}
                      </span>
                      <Badge
                        count={fieldCount}
                        showZero
                        color="var(--text-tertiary)"
                        title={`${fieldCount} field${fieldCount === 1 ? '' : 's'}`}
                        style={{ fontSize: 10 }}
                      />
                    </div>

                    {model.description && (
                      <div
                        style={{
                          color: 'var(--text-tertiary)',
                          fontFamily: 'var(--font-ui)',
                          fontSize: 12,
                          marginTop: 2,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          maxWidth: '100%',
                        }}
                        title={model.description}
                      >
                        {model.description}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    <Button
                      type="text"
                      size="small"
                      icon={<EditOutlined />}
                      onClick={() => openEdit(model)}
                      style={{ color: 'var(--text-secondary)' }}
                    />
                    <Button
                      type="text"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => handleDelete(model)}
                    />
                  </div>
                </div>
              );
            })}
          </Flex>
        )}
      </Drawer>

      <ModelFieldEditor
        open={editorOpen}
        model={editingModel}
        onClose={handleEditorClose}
      />
    </>
  );
}
