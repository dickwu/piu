'use client';

import {
  App,
  Modal,
  Input,
  InputNumber,
  Button,
  Space,
  Switch,
  Table,
  Select,
  Tag,
  Tabs,
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
import type { Environment } from '../types';
import { TARGET_LOCATIONS } from '../types';
import { EnvironmentFormModal } from './EnvironmentFormModal';
import { MatchPathsInput } from './MatchPathsInput';
import { HooksEditor } from './HooksEditor';

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
  const [varEditorEnvId, setVarEditorEnvId] = useState<string | null>(null);
  const [editingHost, setEditingHost] = useState('');
  const [editingVars, setEditingVars] = useState<
    { id: string; key: string; value: string; enabled: boolean; match_paths: string; target_location: string; expires_at: number | null; priority: number }[]
  >([]);

  const [envFormOpen, setEnvFormOpen] = useState(false);
  const [envFormMode, setEnvFormMode] = useState<'create' | 'edit'>('create');
  const [envFormEnv, setEnvFormEnv] = useState<Environment | null>(null);

  useEffect(() => {
    if (project && open) {
      setName(project.name);
      setDescription(project.description ?? '');
      setVarEditorEnvId(null);
    }
  }, [project, open]);

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

  const handleOpenCreateEnv = useCallback(() => {
    setEnvFormMode('create');
    setEnvFormEnv(null);
    setEnvFormOpen(true);
  }, []);

  const handleOpenEditEnv = useCallback((env: Environment) => {
    setEnvFormMode('edit');
    setEnvFormEnv(env);
    setEnvFormOpen(true);
  }, []);

  const handleCloseEnvForm = useCallback(() => {
    setEnvFormOpen(false);
    setEnvFormEnv(null);
  }, []);

  const handleSaveEnvForm = useCallback(
    async (envName: string, host: string) => {
      try {
        if (envFormMode === 'create') {
          await createEnvironment(envName, projectId ?? undefined, host);
        } else if (envFormEnv) {
          await updateEnvironment(envFormEnv.id, { name: envName, host: host || null });
        }
        handleCloseEnvForm();
      } catch (error) {
        message.error(envFormMode === 'create' ? 'Failed to create environment' : 'Failed to update environment');
        throw error;
      }
    },
    [envFormMode, envFormEnv, projectId, createEnvironment, updateEnvironment, handleCloseEnvForm, message],
  );

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
            match_paths: v.match_paths ?? '["*"]',
            target_location: v.target_location ?? 'header',
            expires_at: v.expires_at,
            priority: v.priority ?? 0,
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
      {
        id: crypto.randomUUID(),
        key: '',
        value: '',
        enabled: true,
        match_paths: '["*"]',
        target_location: 'header',
        expires_at: null,
        priority: 0,
      },
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
            <div className="mb-2 flex items-center justify-between">
              <label
                className="block text-xs font-semibold uppercase tracking-wider"
                style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-ui)' }}
              >
                Environments
              </label>
              <Button
                size="small"
                icon={<PlusOutlined />}
                onClick={handleOpenCreateEnv}
              >
                Add
              </Button>
            </div>

            {environments.length === 0 ? (
              <div
                className="py-4 text-center text-xs"
                style={{ color: 'var(--text-tertiary)' }}
              >
                No environments yet.
              </div>
            ) : (
              <Table
                dataSource={environments}
                rowKey="id"
                pagination={false}
                size="small"
                columns={[
                  {
                    title: 'Name',
                    dataIndex: 'name',
                    render: (envName: string) => (
                      <span style={{ fontFamily: 'var(--font-ui)', fontWeight: 600, fontSize: 12 }}>
                        {envName}
                      </span>
                    ),
                  },
                  {
                    title: 'Host',
                    dataIndex: 'host',
                    render: (host: string | null) => (
                      <span
                        style={{
                          color: host ? 'var(--text-primary)' : 'var(--text-tertiary)',
                          fontSize: 11,
                          fontFamily: 'var(--font-code)',
                        }}
                      >
                        {host || '(not set)'}
                      </span>
                    ),
                  },
                  {
                    title: '',
                    width: 120,
                    render: (_: unknown, env: Environment) => (
                      <Space size={4}>
                        <Button
                          size="small"
                          type="text"
                          icon={<EditOutlined />}
                          onClick={() => handleOpenEditEnv(env)}
                          title="Edit"
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
                  },
                ]}
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
        width={960}
        destroyOnHidden
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
        <Tabs
          items={[
            {
              key: 'variables',
              label: 'Variables',
              children: (
                <>
                  <Table
                    dataSource={editingVars}
                    rowKey="id"
                    pagination={false}
                    size="small"
                    scroll={{ x: 860 }}
                    columns={[
                      {
                        title: 'On',
                        dataIndex: 'enabled',
                        width: 50,
                        render: (val: boolean, _: unknown, idx: number) => (
                          <Switch
                            size="small"
                            checked={val}
                            onChange={(v) => updateVariable(idx, 'enabled', v)}
                          />
                        ),
                      },
                      {
                        title: 'Match Paths',
                        dataIndex: 'match_paths',
                        width: 180,
                        render: (val: string, _: unknown, idx: number) => (
                          <MatchPathsInput
                            value={val}
                            onChange={(v) => updateVariable(idx, 'match_paths', v)}
                          />
                        ),
                      },
                      {
                        title: 'Target',
                        dataIndex: 'target_location',
                        width: 130,
                        render: (val: string, _: unknown, idx: number) => (
                          <Select
                            size="small"
                            value={val}
                            onChange={(v) => updateVariable(idx, 'target_location', v)}
                            options={TARGET_LOCATIONS}
                            style={{ width: '100%' }}
                            popupMatchSelectWidth={false}
                          />
                        ),
                      },
                      {
                        title: 'Key',
                        dataIndex: 'key',
                        width: 140,
                        render: (val: string, _: unknown, idx: number) => (
                          <Input
                            size="small"
                            value={val}
                            onChange={(e) => updateVariable(idx, 'key', e.target.value)}
                            placeholder="Field name"
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
                            placeholder="Value"
                          />
                        ),
                      },
                      {
                        title: 'Pri',
                        dataIndex: 'priority',
                        width: 60,
                        render: (val: number, _: unknown, idx: number) => (
                          <InputNumber
                            size="small"
                            value={val}
                            onChange={(v) => updateVariable(idx, 'priority', String(v ?? 0))}
                            style={{ width: '100%' }}
                          />
                        ),
                      },
                      {
                        title: '',
                        width: 50,
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
                </>
              ),
            },
            {
              key: 'hooks',
              label: 'Hooks',
              children: varEditorEnvId ? (
                <HooksEditor environmentId={varEditorEnvId} />
              ) : null,
            },
          ]}
        />
      </Modal>

      <EnvironmentFormModal
        open={envFormOpen}
        mode={envFormMode}
        initialName={envFormEnv?.name}
        initialHost={envFormEnv?.host ?? ''}
        hasName={hasEnvironmentName}
        excludeId={envFormEnv?.id}
        onClose={handleCloseEnvForm}
        onSave={handleSaveEnvForm}
      />
    </>
  );
}
