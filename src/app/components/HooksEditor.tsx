'use client';

import {
  App,
  Button,
  Table,
  Switch,
  Modal,
  Form,
  Select,
  Input,
  InputNumber,
  Radio,
  Tag,
  Flex,
  Spin,
  Empty,
} from 'antd';
import { PlusOutlined, DeleteOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useHookStore } from '../stores/hookStore';
import { useCollectionStore } from '../stores/collectionStore';
import { useEnvironmentStore } from '../stores/environmentStore';
import { parseConfig } from '../types';
import type { EnvHook, EnvHookTarget, ApiRequest, EnvVariable } from '../types';

interface HooksEditorProps {
  environmentId: string;
}

const TTL_UNITS = [
  { label: 'ms', value: 1 },
  { label: 's', value: 1000 },
  { label: 'm', value: 60_000 },
  { label: 'h', value: 3_600_000 },
];

function formatLastRun(ts: number | null): string {
  if (!ts) return 'Never';
  const d = new Date(ts * 1000);
  const now = Date.now();
  const diffMs = now - d.getTime();
  if (diffMs < 60_000) return 'Just now';
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  return d.toLocaleDateString();
}

function formatTtl(expiresIn: number | null): string {
  if (!expiresIn) return '\u221E';
  if (expiresIn < 1000) return `${expiresIn}ms`;
  if (expiresIn < 60_000) return `${expiresIn / 1000}s`;
  if (expiresIn < 3_600_000) return `${expiresIn / 60_000}m`;
  return `${expiresIn / 3_600_000}h`;
}

function buildRequestOptions(
  collections: { id: string; name: string }[],
  requestsMap: Map<string, ApiRequest[]>,
): { label: string; value: string }[] {
  const options: { label: string; value: string }[] = [];

  for (const [collectionId, requests] of requestsMap.entries()) {
    const collectionName =
      collectionId === '__root__'
        ? '(root)'
        : collections.find((c) => c.id === collectionId)?.name ?? collectionId;

    for (const req of requests) {
      const config = parseConfig(req.config);
      options.push({
        label: `${config.method} ${req.name} (${collectionName})`,
        value: req.id,
      });
    }
  }

  return options;
}

function findRequestName(
  requestId: string,
  requestsMap: Map<string, ApiRequest[]>,
): string {
  for (const [, requests] of requestsMap.entries()) {
    const found = requests.find((r) => r.id === requestId);
    if (found) {
      const config = parseConfig(found.config);
      return `${config.method} ${found.name}`;
    }
  }
  return requestId.slice(0, 8);
}

export function HooksEditor({ environmentId }: HooksEditorProps) {
  const { message, modal } = App.useApp();
  const { hooks, loading, loadHooks, createHook, updateHook, deleteHook, loadHookTargets } =
    useHookStore();

  const collections = useCollectionStore((s) => s.collections);
  const requestsMap = useCollectionStore((s) => s.requests);
  const variables = useEnvironmentStore((s) => s.variables);

  const envVariables: EnvVariable[] = useMemo(
    () => variables.get(environmentId) ?? [],
    [variables, environmentId],
  );

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [hookTargets, setHookTargets] = useState<Map<string, string[]>>(new Map());
  const [form] = Form.useForm();
  const [ttlUnit, setTtlUnit] = useState(1000);

  useEffect(() => {
    loadHooks(environmentId);
  }, [environmentId, loadHooks]);

  useEffect(() => {
    const loadTargets = async () => {
      const entries: [string, string[]][] = [];
      for (const hook of hooks) {
        try {
          const targets: EnvHookTarget[] = await loadHookTargets(hook.id);
          entries.push([hook.id, targets.map((t) => t.variable_id)]);
        } catch {
          entries.push([hook.id, []]);
        }
      }
      setHookTargets(new Map(entries));
    };
    if (hooks.length > 0) {
      loadTargets();
    } else {
      setHookTargets(new Map());
    }
  }, [hooks, loadHookTargets]);

  const requestOptions = useMemo(
    () => buildRequestOptions(collections, requestsMap),
    [collections, requestsMap],
  );

  const variableOptions = useMemo(
    () =>
      envVariables.map((v) => ({
        label: v.key || '(unnamed)',
        value: v.id,
      })),
    [envVariables],
  );

  const handleToggleEnabled = useCallback(
    async (hook: EnvHook, enabled: boolean) => {
      try {
        await updateHook({ id: hook.id, enabled });
      } catch {
        message.error('Failed to update hook');
      }
    },
    [updateHook, message],
  );

  const handleDelete = useCallback(
    (hookId: string) => {
      modal.confirm({
        title: 'Delete Hook',
        content: 'Delete this hook? This cannot be undone.',
        okText: 'Delete',
        okButtonProps: { danger: true },
        onOk: async () => {
          try {
            await deleteHook(hookId);
          } catch {
            message.error('Failed to delete hook');
          }
        },
      });
    },
    [deleteHook, message, modal],
  );

  const handleAddHook = useCallback(async () => {
    try {
      const values = await form.validateFields();
      const ttlMs = values.ttl_value ? values.ttl_value * ttlUnit : null;

      await createHook({
        environment_id: environmentId,
        source_request_id: values.source_request_id,
        response_location: values.response_location,
        selector: values.selector,
        target_variable_ids: values.target_variable_ids ?? [],
        value_template: values.value_template || '{{value}}',
        expires_in: ttlMs,
        array_strategy: values.array_strategy ?? 'first',
      });

      form.resetFields();
      setAddModalOpen(false);
      message.success('Hook created');
    } catch {
      // form validation failed, errors shown inline
    }
  }, [form, ttlUnit, environmentId, createHook, message]);

  const handleCloseAddModal = useCallback(() => {
    form.resetFields();
    setAddModalOpen(false);
  }, [form]);

  const columns = [
    {
      title: '',
      dataIndex: 'enabled',
      width: 50,
      render: (val: boolean, record: EnvHook) => (
        <Switch
          size="small"
          checked={val}
          onChange={(v) => handleToggleEnabled(record, v)}
        />
      ),
    },
    {
      title: 'Source Request',
      dataIndex: 'source_request_id',
      ellipsis: true,
      render: (val: string) => (
        <span style={{ fontFamily: 'var(--font-code)', fontSize: 11 }}>
          {findRequestName(val, requestsMap)}
        </span>
      ),
    },
    {
      title: 'Extract',
      dataIndex: 'selector',
      ellipsis: true,
      render: (val: string, record: EnvHook) => (
        <Flex align="center" gap={4}>
          <Tag
            color={record.response_location === 'body' ? 'blue' : 'purple'}
            style={{ fontSize: 9, margin: 0, lineHeight: '14px', padding: '0 3px' }}
          >
            {record.response_location}
          </Tag>
          <code style={{ fontFamily: 'var(--font-code)', fontSize: 10 }}>{val}</code>
        </Flex>
      ),
    },
    {
      title: 'Template',
      dataIndex: 'value_template',
      width: 100,
      ellipsis: true,
      render: (val: string) => (
        <code style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: 'var(--text-tertiary)' }}>
          {val}
        </code>
      ),
    },
    {
      title: 'TTL',
      dataIndex: 'expires_in',
      width: 60,
      render: (val: number | null) => (
        <span style={{ fontSize: 11 }}>{formatTtl(val)}</span>
      ),
    },
    {
      title: 'Array',
      dataIndex: 'array_strategy',
      width: 60,
      render: (val: string) => (
        <Tag style={{ fontSize: 9, margin: 0, lineHeight: '14px', padding: '0 3px' }}>
          {val}
        </Tag>
      ),
    },
    {
      title: 'Last Run',
      dataIndex: 'last_executed_at',
      width: 80,
      render: (val: number | null) => (
        <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
          {formatLastRun(val)}
        </span>
      ),
    },
    {
      title: '',
      width: 40,
      render: (_: unknown, record: EnvHook) => (
        <Button
          size="small"
          type="text"
          danger
          icon={<DeleteOutlined />}
          onClick={() => handleDelete(record.id)}
        />
      ),
    },
  ];

  if (loading) {
    return (
      <Flex justify="center" style={{ padding: 40 }}>
        <Spin />
      </Flex>
    );
  }

  return (
    <>
      {hooks.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>
              No hooks configured. Hooks auto-extract values from API responses
              into environment variables.
            </span>
          }
        >
          <Button
            type="dashed"
            icon={<PlusOutlined />}
            onClick={() => setAddModalOpen(true)}
          >
            Add Hook
          </Button>
        </Empty>
      ) : (
        <>
          <Table
            dataSource={hooks}
            columns={columns}
            rowKey="id"
            pagination={false}
            size="small"
            style={{ marginBottom: 8 }}
          />
          <Button
            size="small"
            type="dashed"
            icon={<PlusOutlined />}
            onClick={() => setAddModalOpen(true)}
            block
          >
            Add Hook
          </Button>
        </>
      )}

      <Modal
        title={
          <Flex align="center" gap={8}>
            <ThunderboltOutlined />
            <span>Add Hook</span>
          </Flex>
        }
        open={addModalOpen}
        onOk={handleAddHook}
        onCancel={handleCloseAddModal}
        destroyOnHidden
        width={480}
        okText="Create"
      >
        <Form form={form} layout="vertical" size="small" style={{ marginTop: 12 }}>
          <Form.Item
            name="source_request_id"
            label="Source Request"
            rules={[{ required: true, message: 'Select a request' }]}
          >
            <Select
              showSearch
              placeholder="Select request to extract from"
              options={requestOptions}
              optionFilterProp="label"
            />
          </Form.Item>

          <Form.Item
            name="response_location"
            label="Response Location"
            initialValue="body"
            rules={[{ required: true }]}
          >
            <Radio.Group
              options={[
                { label: 'Body', value: 'body' },
                { label: 'Header', value: 'header' },
              ]}
              optionType="button"
              buttonStyle="solid"
            />
          </Form.Item>

          <Form.Item
            name="selector"
            label="Selector"
            rules={[{ required: true, message: 'Enter a JSONPath or header name' }]}
            extra="JSONPath for body (e.g. $.data.token), or header name"
          >
            <Input
              placeholder="$.data.access_token"
              style={{ fontFamily: 'var(--font-code)' }}
            />
          </Form.Item>

          <Form.Item
            name="target_variable_ids"
            label="Target Variables"
          >
            <Select
              mode="multiple"
              placeholder="Select variables to update"
              options={variableOptions}
              optionFilterProp="label"
            />
          </Form.Item>

          <Form.Item
            name="value_template"
            label="Value Template"
            initialValue="{{value}}"
            extra="Use {{value}} for the extracted value"
          >
            <Input
              placeholder="{{value}}"
              style={{ fontFamily: 'var(--font-code)' }}
            />
          </Form.Item>

          <Flex gap={8}>
            <Form.Item
              name="ttl_value"
              label="TTL"
              style={{ flex: 1 }}
            >
              <InputNumber
                placeholder="(forever)"
                min={0}
                style={{ width: '100%' }}
              />
            </Form.Item>
            <Form.Item label="Unit" style={{ width: 80 }}>
              <Select
                value={ttlUnit}
                onChange={setTtlUnit}
                options={TTL_UNITS}
              />
            </Form.Item>
          </Flex>

          <Form.Item
            name="array_strategy"
            label="Array Strategy"
            initialValue="first"
          >
            <Radio.Group
              options={[
                { label: 'Pick', value: 'pick' },
                { label: 'First', value: 'first' },
                { label: 'Last', value: 'last' },
              ]}
              optionType="button"
              buttonStyle="solid"
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
