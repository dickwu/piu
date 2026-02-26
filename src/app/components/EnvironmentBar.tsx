'use client';

import { Select, Button, Modal, Input, Space, Switch, Table, message } from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  SettingOutlined,
  HistoryOutlined,
} from '@ant-design/icons';
import { useState, useCallback, useEffect } from 'react';
import { useEnvironmentStore } from '../stores/environmentStore';
import { useProjectStore } from '../stores/projectStore';
import { ChangelogModal } from './ChangelogModal';

export function EnvironmentBar() {
  const {
    environments,
    activeEnvironment,
    variables,
    envSettingsOpen,
    setEnvSettingsOpen,
    setActiveEnvironment,
    createEnvironment,
    updateEnvironment,
    loadVariables,
    setVariables,
  } = useEnvironmentStore();

  const hasEnvironmentName = useEnvironmentStore((s) => s.hasEnvironmentName);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const [showChangelog, setShowChangelog] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [editEnvName, setEditEnvName] = useState('');
  const [newEnvName, setNewEnvName] = useState('');
  const [editingHost, setEditingHost] = useState('');
  const [editingVars, setEditingVars] = useState<
    { id: string; key: string; value: string; enabled: boolean }[]
  >([]);

  const createEnvError =
    newEnvName.trim() && hasEnvironmentName(newEnvName)
      ? 'Environment name already exists'
      : '';

  const renameEnvError =
    editEnvName.trim() && hasEnvironmentName(editEnvName, activeEnvironment?.id)
      ? 'Environment name already exists'
      : '';

  const handleCreateEnv = useCallback(async () => {
    if (!newEnvName.trim() || hasEnvironmentName(newEnvName)) return;
    try {
      await createEnvironment(
        newEnvName.trim(),
        activeProjectId ?? undefined,
      );
      setNewEnvName('');
    } catch (error) {
      message.error('Failed to create environment');
    }
  }, [newEnvName, createEnvironment, activeProjectId, hasEnvironmentName]);

  const handleOpenRename = useCallback(() => {
    if (!activeEnvironment) return;
    setEditEnvName(activeEnvironment.name);
    setShowRenameModal(true);
  }, [activeEnvironment]);

  const handleRename = useCallback(async () => {
    if (!activeEnvironment || !editEnvName.trim()) return;
    if (hasEnvironmentName(editEnvName, activeEnvironment.id)) return;
    try {
      await updateEnvironment(activeEnvironment.id, { name: editEnvName.trim() });
      setShowRenameModal(false);
    } catch (error) {
      message.error('Failed to rename environment');
    }
  }, [activeEnvironment, editEnvName, hasEnvironmentName, updateEnvironment]);

  const handleOpenVarEditor = useCallback(async () => {
    if (!activeEnvironment) return;
    try {
      await loadVariables(activeEnvironment.id);
      const freshVars =
        useEnvironmentStore.getState().variables.get(activeEnvironment.id) ?? [];
      setEditingVars(
        freshVars.map((v) => ({
          id: v.id,
          key: v.key,
          value: v.value,
          enabled: v.enabled,
        })),
      );
      setEditingHost(activeEnvironment.host ?? '');
      setEnvSettingsOpen(true);
    } catch (error) {
      message.error('Failed to load environment variables');
    }
  }, [activeEnvironment, loadVariables, setEnvSettingsOpen]);

  const handleSaveVars = useCallback(async () => {
    if (!activeEnvironment) return;
    try {
      const currentHost = activeEnvironment.host ?? '';
      if (editingHost !== currentHost) {
        await updateEnvironment(activeEnvironment.id, {
          host: editingHost.trim() || null,
        });
      }
      await setVariables(activeEnvironment.id, editingVars);
      setEnvSettingsOpen(false);
    } catch (error) {
      message.error('Failed to save environment variables');
    }
  }, [activeEnvironment, editingHost, editingVars, setVariables, updateEnvironment, setEnvSettingsOpen]);

  const addVariable = useCallback(() => {
    setEditingVars((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        key: '',
        value: '',
        enabled: true,
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

  // Reload variables when active environment changes
  useEffect(() => {
    if (activeEnvironment) {
      loadVariables(activeEnvironment.id);
    }
  }, [activeEnvironment, loadVariables]);

  return (
    <>
      <div
        className="flex items-center justify-between border-b px-4 py-1.5"
        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-secondary)' }}
      >
        <div className="flex items-center gap-2">
          <span
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-ui)' }}
          >
            Env
          </span>
          <Select
            size="small"
            style={{ width: 180 }}
            placeholder="No Environment"
            value={activeEnvironment?.id}
            onChange={(id) => {
              if (activeProjectId) {
                setActiveEnvironment(id, activeProjectId);
              }
            }}
            options={environments.map((env) => ({
              label: (
                <span>
                  {env.name}
                  {env.host && (
                    <span style={{ color: 'var(--text-tertiary)', fontSize: 10, marginLeft: 4, fontFamily: 'var(--font-code)' }}>
                      {env.host}
                    </span>
                  )}
                </span>
              ),
              value: env.id,
            }))}
            allowClear
          />
          <Space.Compact size="small">
            <Input
              placeholder="New environment"
              value={newEnvName}
              onChange={(e) => setNewEnvName(e.target.value)}
              onPressEnter={handleCreateEnv}
              style={{ width: 140 }}
              status={createEnvError ? 'error' : undefined}
              maxLength={100}
            />
            <Button icon={<PlusOutlined />} onClick={handleCreateEnv} disabled={!!createEnvError} />
          </Space.Compact>
          {createEnvError && (
            <span style={{ color: 'var(--error)', fontSize: 11, fontFamily: 'var(--font-ui)' }}>
              {createEnvError}
            </span>
          )}
          {activeEnvironment && (
            <Space size={4}>
              <Button
                size="small"
                type="text"
                icon={<EditOutlined />}
                onClick={handleOpenRename}
              />
              <Button
                size="small"
                icon={<SettingOutlined />}
                onClick={handleOpenVarEditor}
              >
                Variables
              </Button>
            </Space>
          )}
        </div>
        <Button
          size="small"
          icon={<HistoryOutlined />}
          onClick={() => setShowChangelog(true)}
        >
          Changelog
        </Button>
      </div>

      <Modal
        title={`Environment - ${activeEnvironment?.name ?? ''}`}
        open={envSettingsOpen}
        onOk={handleSaveVars}
        onCancel={() => setEnvSettingsOpen(false)}
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

      <Modal
        title="Rename Environment"
        open={showRenameModal}
        onOk={handleRename}
        onCancel={() => setShowRenameModal(false)}
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
            <span style={{ color: 'var(--error)', fontSize: 11, fontFamily: 'var(--font-ui)' }}>
              {renameEnvError}
            </span>
          )}
        </div>
      </Modal>

      <ChangelogModal
        open={showChangelog}
        onClose={() => setShowChangelog(false)}
      />
    </>
  );
}
