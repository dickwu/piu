'use client';

import { Button, Input, Modal, Dropdown, message } from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  CheckCircleFilled,
  MoreOutlined,
  ProjectOutlined,
} from '@ant-design/icons';
import { useState, useCallback } from 'react';
import { useProjectStore } from '../stores/projectStore';
import { useEnvironmentStore } from '../stores/environmentStore';

export function ProjectList() {
  const {
    projects,
    activeProjectId,
    setActiveProject,
    createProject,
    updateProject,
    deleteProject,
  } = useProjectStore();

  const environments = useEnvironmentStore((s) => s.environments);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editProjectId, setEditProjectId] = useState<string | null>(null);

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return;
    try {
      await createProject(newName.trim(), newDescription.trim() || undefined);
      setNewName('');
      setNewDescription('');
      setShowCreateModal(false);
    } catch (error) {
      message.error('Failed to create project');
    }
  }, [newName, newDescription, createProject]);

  const handleEdit = useCallback(async () => {
    if (!editProjectId || !editName.trim()) return;
    try {
      await updateProject(editProjectId, {
        name: editName.trim(),
        description: editDescription.trim() || null,
      });
      setShowEditModal(false);
      setEditProjectId(null);
    } catch (error) {
      message.error('Failed to update project');
    }
  }, [editProjectId, editName, editDescription, updateProject]);

  const handleOpenEdit = useCallback(
    (projectId: string) => {
      const project = projects.find((p) => p.id === projectId);
      if (!project) return;
      setEditProjectId(projectId);
      setEditName(project.name);
      setEditDescription(project.description ?? '');
      setShowEditModal(true);
    },
    [projects],
  );

  const handleDelete = useCallback(
    (projectId: string) => {
      const project = projects.find((p) => p.id === projectId);
      Modal.confirm({
        title: 'Delete Project',
        content: `Are you sure you want to delete "${project?.name ?? 'this project'}"? This action cannot be undone.`,
        okText: 'Delete',
        okButtonProps: { danger: true },
        onOk: async () => {
          try {
            await deleteProject(projectId);
          } catch (error) {
            message.error('Failed to delete project');
          }
        },
      });
    },
    [projects, deleteProject],
  );

  return (
    <>
      <div className="flex flex-col">
        <div className="sidebar-section-header">
          <span
            className="text-xs font-bold uppercase tracking-wider"
            style={{ fontFamily: 'var(--font-ui)', color: 'var(--text-secondary)' }}
          >
            Projects
          </span>
          <Button
            size="small"
            icon={<PlusOutlined />}
            onClick={() => setShowCreateModal(true)}
          />
        </div>

        <div style={{ maxHeight: '40%', overflowY: 'auto' }}>
          {projects.length === 0 ? (
            <div
              className="p-4 text-center text-xs"
              style={{ color: 'var(--text-tertiary)' }}
            >
              No projects yet.
              <br />
              Click + to create one.
            </div>
          ) : (
            projects.map((project) => {
              const isActive = project.id === activeProjectId;
              return (
                <div
                  key={project.id}
                  className={`project-item${isActive ? ' project-item-active' : ''}`}
                  onClick={() => setActiveProject(project.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setActiveProject(project.id);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-current={isActive ? 'true' : undefined}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="flex items-center gap-1.5">
                      <ProjectOutlined
                        style={{
                          fontSize: 11,
                          color: isActive ? 'var(--accent)' : 'var(--text-tertiary)',
                        }}
                      />
                      <span
                        className="truncate"
                        style={{
                          fontFamily: 'var(--font-ui)',
                          fontSize: 12,
                          fontWeight: 600,
                          color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                        }}
                      >
                        {project.name}
                      </span>
                      {isActive && (
                        <CheckCircleFilled
                          style={{ fontSize: 10, color: 'var(--accent)', marginLeft: 'auto', flexShrink: 0 }}
                        />
                      )}
                    </div>
                    {project.description && (
                      <div
                        className="truncate"
                        style={{
                          fontSize: 10,
                          color: 'var(--text-tertiary)',
                          fontFamily: 'var(--font-ui)',
                          marginTop: 1,
                          paddingLeft: 17,
                        }}
                        title={project.description}
                      >
                        {project.description}
                      </div>
                    )}
                    {isActive && environments.length > 0 && (
                      <div style={{ paddingLeft: 17, marginTop: 2 }}>
                        <span className="env-count-badge">
                          {environments.length} env{environments.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                    )}
                  </div>

                  <Dropdown
                    trigger={['click']}
                    menu={{
                      items: [
                        {
                          key: 'edit',
                          icon: <EditOutlined />,
                          label: 'Edit',
                          onClick: (e) => {
                            e.domEvent.stopPropagation();
                            handleOpenEdit(project.id);
                          },
                        },
                        {
                          key: 'delete',
                          icon: <DeleteOutlined />,
                          label: 'Delete',
                          danger: true,
                          onClick: (e) => {
                            e.domEvent.stopPropagation();
                            handleDelete(project.id);
                          },
                        },
                      ],
                    }}
                  >
                    <Button
                      type="text"
                      size="small"
                      icon={<MoreOutlined />}
                      onClick={(e) => e.stopPropagation()}
                      style={{ flexShrink: 0, color: 'var(--text-tertiary)' }}
                    />
                  </Dropdown>
                </div>
              );
            })
          )}
        </div>
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
            maxLength={100}
            autoFocus
          />
          <Input.TextArea
            placeholder="Description (optional)"
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            autoSize={{ minRows: 2, maxRows: 4 }}
            maxLength={500}
          />
        </div>
      </Modal>

      <Modal
        title="Edit Project"
        open={showEditModal}
        onOk={handleEdit}
        onCancel={() => {
          setShowEditModal(false);
          setEditProjectId(null);
        }}
        width={400}
      >
        <div className="flex flex-col gap-2">
          <Input
            placeholder="Project name"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onPressEnter={handleEdit}
            maxLength={100}
            autoFocus
          />
          <Input.TextArea
            placeholder="Description (optional)"
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
            autoSize={{ minRows: 2, maxRows: 4 }}
            maxLength={500}
          />
        </div>
      </Modal>
    </>
  );
}
