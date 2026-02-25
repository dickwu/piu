'use client';

import { Select, Button, Modal, Input, Space, Switch, Table } from 'antd';
import {
  PlusOutlined,
  SettingOutlined,
  HistoryOutlined,
} from '@ant-design/icons';
import { useState, useCallback, useEffect } from 'react';
import { useEnvironmentStore } from '../stores/environmentStore';
import { ChangelogModal } from './ChangelogModal';

export function EnvironmentBar() {
  const {
    environments,
    activeEnvironment,
    variables,
    setActiveEnvironment,
    createEnvironment,
    loadVariables,
    setVariables,
  } = useEnvironmentStore();

  const [showEnvModal, setShowEnvModal] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const [newEnvName, setNewEnvName] = useState('');
  const [editingVars, setEditingVars] = useState<
    { id: string; key: string; value: string; enabled: boolean }[]
  >([]);

  const handleCreateEnv = useCallback(async () => {
    if (!newEnvName.trim()) return;
    await createEnvironment(newEnvName.trim());
    setNewEnvName('');
  }, [newEnvName, createEnvironment]);

  const handleOpenVarEditor = useCallback(async () => {
    if (!activeEnvironment) return;
    await loadVariables(activeEnvironment.id);
    const vars = variables.get(activeEnvironment.id) ?? [];
    setEditingVars(
      vars.map((v) => ({
        id: v.id,
        key: v.key,
        value: v.value,
        enabled: v.enabled,
      })),
    );
    setShowEnvModal(true);
  }, [activeEnvironment, variables, loadVariables]);

  const handleSaveVars = useCallback(async () => {
    if (!activeEnvironment) return;
    await setVariables(activeEnvironment.id, editingVars);
    setShowEnvModal(false);
  }, [activeEnvironment, editingVars, setVariables]);

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
        className="flex items-center justify-between border-b px-4 py-2"
        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-secondary)' }}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Environment:
          </span>
          <Select
            size="small"
            style={{ width: 180 }}
            placeholder="No Environment"
            value={activeEnvironment?.id}
            onChange={(id) => setActiveEnvironment(id)}
            options={environments.map((env) => ({
              label: env.name,
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
            />
            <Button icon={<PlusOutlined />} onClick={handleCreateEnv} />
          </Space.Compact>
          {activeEnvironment && (
            <Button
              size="small"
              icon={<SettingOutlined />}
              onClick={handleOpenVarEditor}
            >
              Variables
            </Button>
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
        title={`Variables - ${activeEnvironment?.name ?? ''}`}
        open={showEnvModal}
        onOk={handleSaveVars}
        onCancel={() => setShowEnvModal(false)}
        width={700}
      >
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

      <ChangelogModal
        open={showChangelog}
        onClose={() => setShowChangelog(false)}
      />
    </>
  );
}
