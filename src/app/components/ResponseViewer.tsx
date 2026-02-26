'use client';

import { Tabs, Empty, Spin } from 'antd';
import { useResponseStore } from '../stores/responseStore';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusColor(status: number): string {
  if (status < 300) return 'var(--success)';
  if (status < 400) return 'var(--warning)';
  return 'var(--error)';
}

function statusBg(status: number): string {
  if (status < 300) return 'rgba(16, 185, 129, 0.15)';
  if (status < 400) return 'rgba(245, 158, 11, 0.15)';
  return 'rgba(239, 68, 68, 0.15)';
}

function formatBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

function phaseLabel(phase: string | null, resolvedUrl: string | null): string {
  switch (phase) {
    case 'resolving':
      return 'Resolving request...';
    case 'connecting':
      return resolvedUrl ? `Connecting to ${resolvedUrl}...` : 'Connecting...';
    case 'sending':
      return 'Sending request...';
    default:
      return 'Sending request...';
  }
}

export function ResponseViewer() {
  const { response, loading, error, phase, resolvedUrl } = useResponseStore();

  if (loading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <Spin />
        <span
          className="animate-pulse-accent text-xs"
          style={{ fontFamily: 'var(--font-code)' }}
        >
          {phaseLabel(phase, resolvedUrl)}
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 flex-col p-4">
        <span
          className="status-pill"
          style={{ backgroundColor: 'rgba(239, 68, 68, 0.15)', color: 'var(--error)', width: 'fit-content' }}
        >
          Error
        </span>
        <pre
          className="code-block mt-2 overflow-auto text-sm"
          style={{ color: 'var(--error)' }}
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
    <div className="animate-fade-in flex flex-1 flex-col overflow-hidden">
      {/* Status bar */}
      <div
        className="flex items-center gap-3 border-t px-4 py-2"
        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-secondary)' }}
      >
        <span
          className="status-pill"
          style={{
            backgroundColor: statusBg(response.status),
            color: statusColor(response.status),
          }}
        >
          {response.status} {response.status_text}
        </span>
        <span className="text-xs" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-code)' }}>
          {response.timing.total_ms}ms
        </span>
        <span className="text-xs" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-code)' }}>
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
                className="code-block overflow-auto"
                style={{
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
                className="select-text overflow-auto rounded p-3"
                style={{
                  backgroundColor: 'var(--bg-tertiary)',
                  maxHeight: 'calc(100vh - 400px)',
                }}
              >
                {Object.entries(response.headers).map(([key, value], idx) => (
                  <div
                    key={key}
                    className="flex gap-2 text-sm"
                    style={{
                      backgroundColor: idx % 2 === 1 ? 'var(--bg-surface)' : 'transparent',
                      padding: '4px 8px',
                      borderRadius: 4,
                    }}
                  >
                    <span style={{ color: 'var(--accent)', fontWeight: 600, fontFamily: 'var(--font-code)' }}>
                      {key}:
                    </span>
                    <span style={{ fontFamily: 'var(--font-code)', color: 'var(--text-primary)' }}>{value}</span>
                  </div>
                ))}
              </div>
            ),
          },
          {
            key: 'timing',
            label: 'Timing',
            children: (
              <div className="select-text p-3">
                <div className="flex items-center gap-3">
                  <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    Total:
                  </span>
                  <span className="text-lg font-bold" style={{ color: 'var(--success)', fontFamily: 'var(--font-code)' }}>
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
