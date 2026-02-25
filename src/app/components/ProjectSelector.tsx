'use client';

import { Select, Button, Input, Space, Modal } from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ProjectOutlined,
} from '@ant-design/icons';
import { useState, useCallback } from 'react';
import { useProjectStore } from '../stores/projectStore';

export function ProjectSelector() {
  const {
    projects,
    activeProjectId,
    setActiveProject,
    createProject,
    updateProject,
    deleteProject,
  } = useProjectStore();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');

  const activeProject = projects.find((p) => p.id === activeProjectId);

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return;
    await createProject(newName.trim(), newDescription.trim() || undefined);
    setNewName('');
    setNewDescription('');
    setShowCreateModal(false);
  }, [newName, newDescription, createProject]);

  const handleEdit = useCallback(async () => {
    if (!activeProjectId || !editName.trim()) return;
    await updateProject(activeProjectId, {
      name: editName.trim(),
      description: editDescription.trim() || null,
    });
    setShowEditModal(false);
  }, [activeProjectId, editName, editDescription, updateProject]);

  const handleOpenEdit = useCallback(() => {
    if (!activeProject) return;
    setEditName(activeProject.name);
    setEditDescription(activeProject.description ?? '');
    setShowEditModal(true);
  }, [activeProject]);

  const handleDelete = useCallback(async () => {
    if (!activeProjectId) return;
    await deleteProject(activeProjectId);
  }, [activeProjectId, deleteProject]);

  return (
    <>
      <div
        className="flex items-center justify-between border-b px-4 py-1.5"
        style={{
          borderColor: 'var(--border)',
          background: 'linear-gradient(90deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%)',
        }}
      >
        <div className="flex items-center gap-2">
          <ProjectOutlined style={{ color: 'var(--accent)', fontSize: 14 }} />
          <Select
            size="small"
            style={{ width: 200 }}
            placeholder="Select Project"
            value={activeProjectId}
            onChange={(id) => setActiveProject(id)}
            options={projects.map((p) => ({
              label: p.name,
              value: p.id,
            }))}
          />
          <Button
            size="small"
            icon={<PlusOutlined />}
            onClick={() => setShowCreateModal(true)}
          />
          {activeProjectId && (
            <Space size={4}>
              <Button
                size="small"
                type="text"
                icon={<EditOutlined />}
                onClick={handleOpenEdit}
              />
              <Button
                size="small"
                type="text"
                danger
                icon={<DeleteOutlined />}
                onClick={handleDelete}
              />
            </Space>
          )}
        </div>
        {activeProject?.description && (
          <span
            className="truncate text-xs"
            style={{ color: 'var(--text-tertiary)', maxWidth: 300, fontFamily: 'var(--font-ui)' }}
            title={activeProject.description}
          >
            {activeProject.description}
          </span>
        )}
      </div>

      <Modal
        title="New Project"
        open={showCreateModal}
        onOk={handleCreate}
        onCancel={() => setShowCreateModal(false)}
        width={400}
      >
        <div className="flex flex-col gap-2">
          <Input
            placeholder="Project name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onPressEnter={handleCreate}
            autoFocus
          />
          <Input.TextArea
            placeholder="Description (optional)"
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            autoSize={{ minRows: 2, maxRows: 4 }}
          />
        </div>
      </Modal>

      <Modal
        title="Edit Project"
        open={showEditModal}
        onOk={handleEdit}
        onCancel={() => setShowEditModal(false)}
        width={400}
      >
        <div className="flex flex-col gap-2">
          <Input
            placeholder="Project name"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onPressEnter={handleEdit}
            autoFocus
          />
          <Input.TextArea
            placeholder="Description (optional)"
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
            autoSize={{ minRows: 2, maxRows: 4 }}
          />
        </div>
      </Modal>
    </>
  );
}
