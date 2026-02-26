'use client';

import {
  App,
  Modal,
  Input,
  Button,
  Space,
  Switch,
  Table,
  Collapse,
} from 'antd';
import {
  SaveOutlined,
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { useState, useEffect, useCallback } from 'react';
import { useProjectStore } from '../stores/projectStore';
import { useEnvironmentStore } from '../stores/environmentStore';

interface ProjectSettingsModalProps {
  projectId: string | null;
  open: boolean;
  onClose: () => void;
}

export function ProjectSettingsModal({
  projectId,
  open,
  onClose,
}: ProjectSettingsModalProps) {
  const { message, modal } = App.useApp();
  const projects = useProjectStore((s) => s.projects);
  const updateProject = useProjectStore((s) => s.updateProject);
  const {
    environments,
    variables,
    loadVariables,
    createEnvironment,
    updateEnvironment,
    deleteEnvironment,
    setVariables,
    hasEnvironmentName,
    loadEnvironments,
  } = useEnvironmentStore();

  const project = projects.find((p) => p.id === projectId);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [newEnvName, setNewEnvName] = useState('');
  const [editEnvId, setEditEnvId] = useState<string | null>(null);
  const [editEnvName, setEditEnvName] = useState('');
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [varEditorEnvId, setVarEditorEnvId] = useState<string | null>(null);
  const [editingHost, setEditingHost] = useState('');
  const [editingVars, setEditingVars] = useState<
    { id: string; key: string; value: string; enabled: boolean }[]
  >([]);

  const createEnvError =
    newEnvName.trim() && hasEnvironmentName(newEnvName)
      ? 'Name already exists'
      : '';

  const renameEnvError =
    editEnvName.trim() && hasEnvironmentName(editEnvName, editEnvId ?? undefined)
      ? 'Name already exists'
      : '';

  useEffect(() => {
    if (project && open) {
      setName(project.name);
      setDescription(project.description ?? '');
      setNewEnvName('');
      setVarEditorEnvId(null);
    }
  }, [project, open]);

  // Load variables for all environments when modal opens
  useEffect(() => {
    if (open && environments.length > 0) {
      for (const env of environments) {
        loadVariables(env.id);
      }
    }
  }, [open, environments, loadVariables]);

  const handleSaveProject = useCallback(async () => {
    if (!projectId || !name.trim()) return;
    try {
      await updateProject(projectId, {
        name: name.trim(),
        description: description.trim() || null,
      });
      message.success('Project saved');
      onClose();
    } catch (error) {
      message.error('Failed to save project');
    }
  }, [projectId, name, description, updateProject, onClose, message]);

  const handleCreateEnv = useCallback(async () => {
    if (!newEnvName.trim() || hasEnvironmentName(newEnvName)) return;
    try {
      await createEnvironment(newEnvName.trim(), projectId ?? undefined);
      setNewEnvName('');
    } catch (error) {
      message.error('Failed to create environment');
    }
  }, [newEnvName, projectId, createEnvironment, hasEnvironmentName, message]);

  const handleOpenRename = useCallback((envId: string, envName: string) => {
    setEditEnvId(envId);
    setEditEnvName(envName);
    setShowRenameModal(true);
  }, []);

  const handleRename = useCallback(async () => {
    if (!editEnvId || !editEnvName.trim()) return;
    if (hasEnvironmentName(editEnvName, editEnvId)) return;
    try {
      await updateEnvironment(editEnvId, { name: editEnvName.trim() });
      setShowRenameModal(false);
      setEditEnvId(null);
    } catch (error) {
      message.error('Failed to rename environment');
    }
  }, [editEnvId, editEnvName, hasEnvironmentName, updateEnvironment, message]);

  const handleDeleteEnv = useCallback(
    (envId: string, envName: string) => {
      modal.confirm({
        title: 'Delete Environment',
        content: `Delete "${envName}"? This cannot be undone.`,
        okText: 'Delete',
        okButtonProps: { danger: true },
        onOk: async () => {
          try {
            await deleteEnvironment(envId);
            await loadEnvironments(projectId ?? undefined);
            if (varEditorEnvId === envId) {
              setVarEditorEnvId(null);
            }
          } catch (error) {
            message.error('Failed to delete environment');
          }
        },
      });
    },
    [deleteEnvironment, loadEnvironments, projectId, varEditorEnvId, message, modal],
  );

  const handleOpenVarEditor = useCallback(
    async (envId: string) => {
      try {
        await loadVariables(envId);
        const freshVars =
          useEnvironmentStore.getState().variables.get(envId) ?? [];
        setEditingVars(
          freshVars.map((v) => ({
            id: v.id,
            key: v.key,
            value: v.value,
            enabled: v.enabled,
          })),
        );
        const env = environments.find((e) => e.id === envId);
        setEditingHost(env?.host ?? '');
        setVarEditorEnvId(envId);
      } catch (error) {
        message.error('Failed to load variables');
      }
    },
    [loadVariables, environments, message],
  );

  const handleSaveVars = useCallback(async () => {
    if (!varEditorEnvId) return;
    try {
      const env = environments.find((e) => e.id === varEditorEnvId);
      const currentHost = env?.host ?? '';
      if (editingHost !== currentHost) {
        await updateEnvironment(varEditorEnvId, {
          host: editingHost.trim() || null,
        });
      }
      await setVariables(varEditorEnvId, editingVars);
      setVarEditorEnvId(null);
      message.success('Variables saved');
    } catch (error) {
      message.error('Failed to save variables');
    }
  }, [varEditorEnvId, editingHost, editingVars, environments, updateEnvironment, setVariables, message]);

  const addVariable = useCallback(() => {
    setEditingVars((prev) => [
      ...prev,
      { id: crypto.randomUUID(), key: '', value: '', enabled: true },
    ]);
  }, []);

  const updateVariable = useCallback(
    (index: number, field: string, value: string | boolean) => {
      setEditingVars((prev) =>
        prev.map((v, i) => (i === index ? { ...v, [field]: value } : v)),
      );
    },
    [],
  );

  const removeVariable = useCallback((index: number) => {
    setEditingVars((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const varEditorEnv = environments.find((e) => e.id === varEditorEnvId);

  return (
    <>
      <Modal
        title={
          <span className="flex items-center gap-2">
            <SettingOutlined />
            {project ? `${project.name} — Settings` : 'Project Settings'}
          </span>
        }
        open={open}
        onCancel={onClose}
        width={560}
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button type="primary" icon={<SaveOutlined />} onClick={handleSaveProject}>
              Save
            </Button>
          </div>
        }
      >
        <Space orientation="vertical" size="large" style={{ width: '100%' }}>
          {/* General */}
          <div>
            <label
              className="mb-1 block text-xs font-semibold uppercase tracking-wider"
              style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-ui)' }}
            >
              Project Name
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
            />
          </div>

          <div>
            <label
              className="mb-1 block text-xs font-semibold uppercase tracking-wider"
              style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-ui)' }}
            >
              Description
            </label>
            <Input.TextArea
              placeholder="Describe this project..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              autoSize={{ minRows: 2, maxRows: 4 }}
              maxLength={500}
            />
          </div>

          {/* Environments */}
          <div>
            <label
              className="mb-2 block text-xs font-semibold uppercase tracking-wider"
              style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-ui)' }}
            >
              Environments
            </label>

            <Space.Compact size="small" style={{ width: '100%', marginBottom: 12 }}>
              <Input
                placeholder="New environment name"
                value={newEnvName}
                onChange={(e) => setNewEnvName(e.target.value)}
                onPressEnter={handleCreateEnv}
                status={createEnvError ? 'error' : undefined}
                maxLength={100}
              />
              <Button
                icon={<PlusOutlined />}
                onClick={handleCreateEnv}
                disabled={!!createEnvError || !newEnvName.trim()}
              />
            </Space.Compact>
            {createEnvError && (
              <div style={{ color: 'var(--error)', fontSize: 11, marginBottom: 8 }}>
                {createEnvError}
              </div>
            )}

            {environments.length === 0 ? (
              <div
                className="py-4 text-center text-xs"
                style={{ color: 'var(--text-tertiary)' }}
              >
                No environments yet.
              </div>
            ) : (
              <Collapse
                size="small"
                accordion
                items={environments.map((env) => ({
                  key: env.id,
                  label: (
                    <span className="flex items-center gap-2">
                      <span style={{ fontFamily: 'var(--font-ui)', fontWeight: 600, fontSize: 12 }}>
                        {env.name}
                      </span>
                      {env.host && (
                        <span
                          style={{
                            color: 'var(--text-tertiary)',
                            fontSize: 10,
                            fontFamily: 'var(--font-code)',
                          }}
                        >
                          {env.host}
                        </span>
                      )}
                    </span>
                  ),
                  extra: (
                    <Space size={4} onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="small"
                        type="text"
                        icon={<EditOutlined />}
                        onClick={() => handleOpenRename(env.id, env.name)}
                        title="Rename"
                      />
                      <Button
                        size="small"
                        type="text"
                        icon={<SettingOutlined />}
                        onClick={() => handleOpenVarEditor(env.id)}
                        title="Variables"
                      />
                      <Button
                        size="small"
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => handleDeleteEnv(env.id, env.name)}
                        title="Delete"
                      />
                    </Space>
                  ),
                  children: (
                    <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                      <div>Host: {env.host || '(not set)'}</div>
                      <div>
                        Variables: {(variables.get(env.id) ?? []).length} defined
                      </div>
                      <Button
                        size="small"
                        type="link"
                        onClick={() => handleOpenVarEditor(env.id)}
                        style={{ padding: 0, marginTop: 4 }}
                      >
                        Edit host & variables
                      </Button>
                    </div>
                  ),
                }))}
              />
            )}
          </div>
        </Space>
      </Modal>

      {/* Variable Editor Modal */}
      <Modal
        title={`${varEditorEnv?.name ?? 'Environment'} — Variables`}
        open={varEditorEnvId !== null}
        onOk={handleSaveVars}
        onCancel={() => setVarEditorEnvId(null)}
        width={700}
      >
        <div className="mb-3">
          <label
            className="mb-1 block text-xs font-semibold uppercase tracking-wider"
            style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-ui)' }}
          >
            Host (base URL)
          </label>
          <Input
            size="small"
            className="input-mono"
            placeholder="https://api.example.com"
            value={editingHost}
            onChange={(e) => setEditingHost(e.target.value)}
          />
        </div>
        <Table
          dataSource={editingVars}
          rowKey="id"
          pagination={false}
          size="small"
          columns={[
            {
              title: 'Enabled',
              dataIndex: 'enabled',
              width: 70,
              render: (val: boolean, _: unknown, idx: number) => (
                <Switch
                  size="small"
                  checked={val}
                  onChange={(v) => updateVariable(idx, 'enabled', v)}
                />
              ),
            },
            {
              title: 'Key',
              dataIndex: 'key',
              render: (val: string, _: unknown, idx: number) => (
                <Input
                  size="small"
                  value={val}
                  onChange={(e) => updateVariable(idx, 'key', e.target.value)}
                  placeholder="Variable name"
                />
              ),
            },
            {
              title: 'Value',
              dataIndex: 'value',
              render: (val: string, _: unknown, idx: number) => (
                <Input
                  size="small"
                  value={val}
                  onChange={(e) => updateVariable(idx, 'value', e.target.value)}
                  placeholder="Variable value"
                />
              ),
            },
            {
              title: '',
              width: 60,
              render: (_: unknown, __: unknown, idx: number) => (
                <Button
                  size="small"
                  danger
                  onClick={() => removeVariable(idx)}
                >
                  Del
                </Button>
              ),
            },
          ]}
        />
        <Button
          size="small"
          type="dashed"
          onClick={addVariable}
          style={{ marginTop: 8 }}
          block
        >
          Add Variable
        </Button>
      </Modal>

      {/* Rename Modal */}
      <Modal
        title="Rename Environment"
        open={showRenameModal}
        onOk={handleRename}
        onCancel={() => {
          setShowRenameModal(false);
          setEditEnvId(null);
        }}
        okButtonProps={{ disabled: !editEnvName.trim() || !!renameEnvError }}
        width={360}
      >
        <div className="flex flex-col gap-1">
          <Input
            placeholder="Environment name"
            value={editEnvName}
            onChange={(e) => setEditEnvName(e.target.value)}
            onPressEnter={handleRename}
            status={renameEnvError ? 'error' : undefined}
            maxLength={100}
            autoFocus
          />
          {renameEnvError && (
            <span style={{ color: 'var(--error)', fontSize: 11 }}>
              {renameEnvError}
            </span>
          )}
        </div>
      </Modal>
    </>
  );
}
