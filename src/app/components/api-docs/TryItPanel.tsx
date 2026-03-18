'use client';

import { Button, Tag, Flex, Spin } from 'antd';
import { PlayCircleOutlined } from '@ant-design/icons';
import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { ExecutionProgress, HttpResponse } from '@/app/types';

interface Props {
  requestId: string | null;
  serverUrl: string;
  path: string;
}

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

export function TryItPanel({ requestId, serverUrl, path }: Props) {
  const [executing, setExecuting] = useState(false);
  const [response, setResponse] = useState<HttpResponse | null>(null);
  const [execError, setExecError] = useState<string | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  useEffect(() => {
    return () => {
      unlistenRef.current?.();
    };
  }, []);

  const handleExecute = useCallback(async () => {
    if (!requestId) return;

    unlistenRef.current?.();
    setExecuting(true);
    setResponse(null);
    setExecError(null);

    const executionId = crypto.randomUUID();

    try {
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

      await invoke('execute_request_by_id', {
        request_id: requestId,
        execution_id: executionId,
      });
    } catch (err) {
      setExecError(err instanceof Error ? err.message : String(err));
      setExecuting(false);
    }
  }, [requestId]);

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

  return (
    <div>
      <Flex align="center" gap={8} style={{ marginBottom: 12 }}>
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
        >
          Execute
        </Button>
      </Flex>

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

      {response && !executing && (
        <div
          style={{
            borderRadius: 6,
            border: '1px solid var(--ant-color-border)',
            overflow: 'hidden',
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
