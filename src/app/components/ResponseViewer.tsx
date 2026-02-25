'use client';

import { Tabs, Tag, Empty, Spin } from 'antd';
import { useResponseStore } from '../stores/responseStore';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusColor(status: number): string {
  if (status < 300) return '#22c55e';
  if (status < 400) return '#f59e0b';
  return '#ef4444';
}

function formatBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

export function ResponseViewer() {
  const { response, loading, error } = useResponseStore();

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spin tip="Sending request..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 flex-col p-4">
        <Tag color="error">Error</Tag>
        <pre
          className="mt-2 overflow-auto rounded p-3 text-sm"
          style={{
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            color: '#ef4444',
            fontFamily: 'monospace',
          }}
        >
          {error}
        </pre>
      </div>
    );
  }

  if (!response) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Empty
          description="Send a request to see the response"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Status bar */}
      <div
        className="flex items-center gap-3 border-t px-4 py-2"
        style={{ borderColor: 'var(--border)' }}
      >
        <Tag color={statusColor(response.status)}>
          {response.status} {response.status_text}
        </Tag>
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          {response.timing.total_ms}ms
        </span>
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          {formatSize(response.size)}
        </span>
      </div>

      {/* Response tabs */}
      <Tabs
        size="small"
        style={{ padding: '0 12px', flex: 1, overflow: 'hidden' }}
        items={[
          {
            key: 'body',
            label: 'Body',
            children: (
              <pre
                className="overflow-auto rounded p-3"
                style={{
                  backgroundColor: 'rgba(0,0,0,0.2)',
                  fontFamily: 'monospace',
                  fontSize: 13,
                  maxHeight: 'calc(100vh - 400px)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {formatBody(response.body)}
              </pre>
            ),
          },
          {
            key: 'headers',
            label: `Headers (${Object.keys(response.headers).length})`,
            children: (
              <div
                className="overflow-auto rounded p-3"
                style={{
                  backgroundColor: 'rgba(0,0,0,0.2)',
                  maxHeight: 'calc(100vh - 400px)',
                }}
              >
                {Object.entries(response.headers).map(([key, value]) => (
                  <div key={key} className="flex gap-2 py-0.5 text-sm">
                    <span style={{ color: '#6366f1', fontWeight: 600 }}>
                      {key}:
                    </span>
                    <span style={{ fontFamily: 'monospace' }}>{value}</span>
                  </div>
                ))}
              </div>
            ),
          },
          {
            key: 'timing',
            label: 'Timing',
            children: (
              <div className="p-3">
                <div className="flex items-center gap-3">
                  <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    Total:
                  </span>
                  <span className="text-lg font-bold" style={{ color: '#22c55e' }}>
                    {response.timing.total_ms}ms
                  </span>
                </div>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
