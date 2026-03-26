'use client';

import { Button, Tag, Flex, Spin, Tabs } from 'antd';
import { PlayCircleOutlined } from '@ant-design/icons';
import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { ExecutionProgress, HttpResponse, RequestConfig, ApiRequest } from '@/app/types';
import { parseConfig } from '@/app/types';
import { ParamsEditor } from '../ParamsEditor';
import { HeadersEditor } from '../HeadersEditor';
import { BodyEditor } from '../BodyEditor';
import { AuthEditor } from '../AuthEditor';

interface Props {
  requestId: string | null;
  serverUrl: string;
  path: string;
  method: string;
}

const METHOD_COLORS: Record<string, string> = {
  GET: '#52c41a',
  POST: '#1677ff',
  PUT: '#fa8c16',
  DELETE: '#ff4d4f',
  PATCH: '#722ed1',
  HEAD: '#22d3ee',
  OPTIONS: '#a78bfa',
};

function statusColor(status: number): string {
  if (status < 300) return '#52c41a';
  if (status < 400) return '#fa8c16';
  return '#ff4d4f';
}

function statusBg(status: number): string {
  if (status < 300) return 'rgba(82, 196, 26, 0.1)';
  if (status < 400) return 'rgba(250, 140, 22, 0.1)';
  return 'rgba(255, 77, 79, 0.1)';
}

function formatBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

export function TryItPanel({ requestId, serverUrl, path, method }: Props) {
  const [executing, setExecuting] = useState(false);
  const [response, setResponse] = useState<HttpResponse | null>(null);
  const [execError, setExecError] = useState<string | null>(null);
  const [config, setConfig] = useState<RequestConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('body');
  const unlistenRef = useRef<UnlistenFn | null>(null);

  useEffect(() => {
    if (!requestId) {
      setConfig(null);
      return;
    }

    setConfigLoading(true);
    invoke<ApiRequest | null>('get_request', { id: requestId })
      .then((req) => {
        setConfig(req ? parseConfig(req.config) : null);
      })
      .catch(() => {
        setConfig(null);
      })
      .finally(() => {
        setConfigLoading(false);
      });
  }, [requestId]);

  useEffect(() => {
    return () => {
      unlistenRef.current?.();
    };
  }, []);

  // Auto-switch to body tab for POST/PUT/PATCH when a model is linked
  useEffect(() => {
    if (!config?.requestModelId) return;
    const m = method.toUpperCase();
    if (m === 'POST' || m === 'PUT' || m === 'PATCH') {
      setActiveTab('body');
    }
  }, [config?.requestModelId, method]);

  const updateConfig = useCallback((partial: Partial<RequestConfig>) => {
    setConfig((prev) => (prev ? { ...prev, ...partial } : prev));
  }, []);

  const handleExecute = useCallback(async () => {
    if (!requestId || !config) return;

    unlistenRef.current?.();
    setExecuting(true);
    setResponse(null);
    setExecError(null);

    const executionId = crypto.randomUUID();

    try {
      // Save edited config before executing
      await invoke('update_request', {
        input: { id: requestId, config: JSON.stringify(config) },
      });

      const unlisten = await listen<ExecutionProgress>(
        'request-progress',
        (event) => {
          const progress = event.payload;
          if (progress.execution_id !== executionId) return;

          if (progress.phase === 'complete' && progress.response) {
            setResponse(progress.response);
            setExecuting(false);
            unlisten();
          } else if (progress.phase === 'error') {
            setExecError(progress.error ?? 'Unknown error');
            setExecuting(false);
            unlisten();
          }
        },
      );
      unlistenRef.current = unlisten;

      await invoke('execute_request_by_id', { requestId, executionId });
    } catch (err) {
      setExecError(err instanceof Error ? err.message : String(err));
      setExecuting(false);
    }
  }, [requestId, config]);

  if (!requestId) {
    return (
      <div
        style={{
          padding: '12px 16px',
          borderRadius: 6,
          background: 'var(--ant-color-fill-quaternary)',
          color: 'var(--ant-color-text-tertiary)',
          fontSize: 13,
        }}
      >
        No linked request — cannot execute.
      </div>
    );
  }

  if (configLoading) {
    return (
      <Flex justify="center" style={{ padding: 20 }}>
        <Spin size="small" />
      </Flex>
    );
  }

  return (
    <div>
      {/* URL + Execute */}
      <Flex align="center" gap={8} style={{ marginBottom: 8 }}>
        <Tag
          style={{
            color: '#fff',
            background: METHOD_COLORS[method.toUpperCase()] ?? '#8c8c8c',
            border: 'none',
            fontWeight: 700,
            fontSize: 11,
            padding: '1px 6px',
            marginInlineEnd: 0,
          }}
        >
          {method.toUpperCase()}
        </Tag>
        <div
          style={{
            flex: 1,
            fontFamily: 'monospace',
            fontSize: 12,
            color: 'var(--ant-color-text-secondary)',
            background: 'var(--ant-color-fill-quaternary)',
            borderRadius: 4,
            padding: '4px 8px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={`${serverUrl}${path}`}
        >
          {serverUrl}{path}
        </div>
        <Button
          type="primary"
          icon={<PlayCircleOutlined />}
          onClick={handleExecute}
          loading={executing}
          size="small"
          disabled={!config}
        >
          Execute
        </Button>
      </Flex>

      {/* Editor Tabs */}
      {config && (
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          size="small"
          items={[
            {
              key: 'body',
              label: 'Body',
              children: (
                <BodyEditor
                  body={config.body}
                  onChange={(body) => updateConfig({ body })}
                  requestModelId={config.requestModelId}
                  onModelChange={(modelId) => updateConfig({ requestModelId: modelId })}
                />
              ),
            },
            {
              key: 'params',
              label: `Params${config.params.filter((p) => p.enabled).length ? ` (${config.params.filter((p) => p.enabled).length})` : ''}`,
              children: (
                <ParamsEditor
                  params={config.params}
                  onChange={(params) => updateConfig({ params })}
                />
              ),
            },
            {
              key: 'headers',
              label: `Headers${config.headers.filter((h) => h.enabled).length ? ` (${config.headers.filter((h) => h.enabled).length})` : ''}`,
              children: (
                <HeadersEditor
                  headers={config.headers}
                  onChange={(headers) => updateConfig({ headers })}
                />
              ),
            },
            {
              key: 'auth',
              label: 'Auth',
              children: (
                <AuthEditor
                  auth={config.auth}
                  onChange={(auth) => updateConfig({ auth })}
                />
              ),
            },
          ]}
        />
      )}

      {/* Executing spinner */}
      {executing && (
        <Flex
          justify="center"
          align="center"
          gap={8}
          style={{ padding: 16, color: 'var(--ant-color-text-secondary)' }}
        >
          <Spin size="small" />
          <span style={{ fontSize: 13 }}>Executing...</span>
        </Flex>
      )}

      {/* Error */}
      {execError && !executing && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 6,
            background: 'rgba(255, 77, 79, 0.08)',
            border: '1px solid rgba(255, 77, 79, 0.3)',
            color: '#ff4d4f',
            fontSize: 13,
          }}
        >
          {execError}
        </div>
      )}

      {/* Response */}
      {response && !executing && (
        <div
          style={{
            borderRadius: 6,
            border: '1px solid var(--ant-color-border)',
            overflow: 'hidden',
            marginTop: 8,
          }}
        >
          <Flex
            align="center"
            gap={10}
            style={{
              padding: '8px 12px',
              background: statusBg(response.status),
              borderBottom: '1px solid var(--ant-color-border)',
            }}
          >
            <Tag
              style={{
                color: '#fff',
                background: statusColor(response.status),
                border: 'none',
                fontWeight: 700,
                marginInlineEnd: 0,
              }}
            >
              {response.status}
            </Tag>
            <span style={{ fontSize: 12, color: 'var(--ant-color-text-secondary)' }}>
              {response.status_text}
            </span>
            <span
              style={{
                marginLeft: 'auto',
                fontSize: 12,
                color: 'var(--ant-color-text-tertiary)',
              }}
            >
              {response.timing.total_ms}ms
            </span>
          </Flex>
          <pre
            style={{
              margin: 0,
              padding: '12px 14px',
              fontSize: 12,
              fontFamily: 'monospace',
              overflowX: 'auto',
              maxHeight: 320,
              overflowY: 'auto',
              color: 'var(--ant-color-text)',
              background: 'var(--ant-color-bg-container)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {formatBody(response.body)}
          </pre>
        </div>
      )}
    </div>
  );
}
