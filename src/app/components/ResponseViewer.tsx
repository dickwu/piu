'use client';

import { Tabs, Spin, Flex, App } from 'antd';
import { CheckCircleOutlined, WarningOutlined } from '@ant-design/icons';
import { useMemo } from 'react';
import { useResponseStore } from '../stores/responseStore';
import { useModelStore } from '../stores/modelStore';
import { useRequestEditorStore } from '../stores/requestStore';
import { AnnotatedJsonViewer } from './AnnotatedJsonViewer';
import { ModelSelector } from './shared/ModelSelector';
import { resolveModelFields } from '../utils/modelResolution';
import { validateJsonAgainstModel } from '../utils/modelValidation';
import type { ValidationIssue } from '../utils/modelValidation';

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
  const models = useModelStore((s) => s.models);
  const config = useRequestEditorStore((s) => s.config);
  const updateConfig = useRequestEditorStore((s) => s.updateConfig);
  const { message } = App.useApp();

  const responseModelId = config.responseModelId;

  const resolvedFields = useMemo(
    () => (responseModelId ? resolveModelFields(responseModelId, models) : []),
    [responseModelId, models],
  );

  const validationIssues = useMemo<ValidationIssue[]>(() => {
    if (!responseModelId || !resolvedFields.length || !response) return [];
    return validateJsonAgainstModel(response.body, resolvedFields, { direction: 'response' });
  }, [responseModelId, resolvedFields, response]);

  const handleModelChange = (value: string | undefined) => {
    updateConfig({ responseModelId: value ?? undefined });
    if (value) {
      message.info('Model linked for validation');
    }
  };

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
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 'var(--radius-lg)',
            background: 'var(--bg-tertiary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: 0.5,
          }}
        >
          <span style={{ fontSize: 20 }}>&#8617;</span>
        </div>
        <span style={{ fontSize: 13, fontFamily: 'var(--font-ui)', color: 'var(--text-tertiary)' }}>
          Send a request to see the response
        </span>
      </div>
    );
  }

  const bodyContent = responseModelId && resolvedFields.length > 0 ? (
    <div>
      <AnnotatedJsonViewer json={response.body} fields={resolvedFields} />
    </div>
  ) : (
    <pre
      className="code-block overflow-auto"
      style={{ maxHeight: 'calc(100vh - 400px)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
    >
      {formatBody(response.body)}
    </pre>
  );

  const errorCount = validationIssues.filter((i) => i.severity === 'error').length;
  const warningCount = validationIssues.filter((i) => i.severity === 'warning').length;

  return (
    <div className="animate-fade-in flex flex-1 flex-col overflow-hidden">
      {/* Status bar */}
      <div
        className="glass-header flex items-center gap-3 px-4 py-2"
        style={{ position: 'relative' }}
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
              <div>
                <Flex align="center" gap={8} style={{ marginBottom: 8 }}>
                  <ModelSelector
                    value={responseModelId}
                    onChange={(val) => handleModelChange(val)}
                    placeholder="Validate against model..."
                    style={{ minWidth: 200 }}
                  />
                  {responseModelId && resolvedFields.length === 0 && (
                    <span style={{ fontSize: 12, color: 'var(--warning)' }}>
                      <WarningOutlined style={{ marginRight: 4 }} />
                      Unknown model
                    </span>
                  )}
                  {responseModelId && resolvedFields.length > 0 && validationIssues.length === 0 && (
                    <span style={{ fontSize: 12, color: 'var(--success)' }}>
                      <CheckCircleOutlined style={{ marginRight: 4 }} />
                      All fields valid
                    </span>
                  )}
                  {responseModelId && validationIssues.length > 0 && (
                    <span style={{ fontSize: 12, color: 'var(--error)' }}>
                      {errorCount} error{errorCount !== 1 ? 's' : ''}
                      {warningCount > 0 && `, ${warningCount} warning${warningCount !== 1 ? 's' : ''}`}
                    </span>
                  )}
                </Flex>
                {responseModelId && validationIssues.length > 0 && (
                  <div
                    style={{
                      marginBottom: 8,
                      padding: '6px 10px',
                      borderRadius: 6,
                      backgroundColor: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.25)',
                    }}
                  >
                    {validationIssues.map((issue, idx) => (
                      <div
                        key={idx}
                        style={{
                          fontSize: 12,
                          color: issue.severity === 'error' ? 'var(--error)' : 'var(--warning)',
                          fontFamily: 'var(--font-code)',
                        }}
                      >
                        <span style={{ fontWeight: 600 }}>{issue.field}</span>
                        {': '}
                        {issue.issue}
                      </div>
                    ))}
                  </div>
                )}
                {bodyContent}
              </div>
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
