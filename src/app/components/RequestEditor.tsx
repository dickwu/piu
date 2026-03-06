'use client';

import { Select, Input, Button, Tabs, Space, App } from 'antd';
import { SendOutlined, SaveOutlined, ApiOutlined } from '@ant-design/icons';
import { useCallback, useState, useMemo } from 'react';
import { useRequestEditorStore } from '../stores/requestStore';
import { useCollectionStore } from '../stores/collectionStore';
import { useResponseStore } from '../stores/responseStore';
import { useEnvironmentStore } from '../stores/environmentStore';
import { useModelStore } from '../stores/modelStore';
import { parseQueryParamsFromUrl } from '../types';
import { HeadersEditor } from './HeadersEditor';
import { ParamsEditor } from './ParamsEditor';
import { BodyEditor } from './BodyEditor';
import { AuthEditor } from './AuthEditor';
import { ConfigValidationModal } from './ConfigValidationModal';

function extractPathFromUrl(input: string): string {
  const trimmed = input.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      return parsed.pathname + parsed.search + parsed.hash;
    } catch {
      return trimmed;
    }
  }
  return input;
}

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

const METHOD_COLORS: Record<string, string> = {
  GET: '#34d399',
  POST: '#fbbf24',
  PUT: '#60a5fa',
  DELETE: '#f87171',
  PATCH: '#c084fc',
  HEAD: '#22d3ee',
  OPTIONS: '#a78bfa',
};

export function RequestEditor() {
  const { message } = App.useApp();
  const { activeRequestId, config, activeTab, isDirty, updateConfig, setActiveTab } =
    useRequestEditorStore();
  const updateRequest = useCollectionStore((s) => s.updateRequest);
  const collections = useCollectionStore((s) => s.collections);
  const requests = useCollectionStore((s) => s.requests);
  const { executeRequest, loading } = useResponseStore();
  const resetDirty = useRequestEditorStore((s) => s.resetDirty);
  const activeEnvironment = useEnvironmentStore((s) => s.activeEnvironment);
  const [showConfigModal, setShowConfigModal] = useState(false);

  const collection = useMemo(() => {
    if (!activeRequestId) return undefined;
    for (const [collectionId, reqs] of requests.entries()) {
      if (reqs.some((r) => r.id === activeRequestId)) {
        return collections.find((c) => c.id === collectionId);
      }
    }
    return undefined;
  }, [activeRequestId, collections, requests]);

  const hostPart = activeEnvironment?.host?.replace(/\/+$/, '') ?? '';
  const prefixPart = collection?.path_prefix?.replace(/\/+$/, '') ?? '';
  const basePart = hostPart + prefixPart;

  const handleSave = useCallback(async () => {
    if (!activeRequestId) return;
    await updateRequest(activeRequestId, {
      config: JSON.stringify(config),
    });
    resetDirty();
  }, [activeRequestId, config, updateRequest, resetDirty]);

  const handleSend = useCallback(async () => {
    if (!activeRequestId) return;

    // Validate: environment host must be set for the Rust backend to build a full URL
    const env = useEnvironmentStore.getState().activeEnvironment;
    const hostConfigured = env?.host && env.host.trim().length > 0;

    if (!hostConfigured) {
      setShowConfigModal(true);
      return;
    }

    // Soft model validation for request body
    if (config.requestModelId && config.body.type === 'json' && config.body.content.trim()) {
      const { resolveModelFields } = await import('../utils/modelResolution');
      const { validateJsonAgainstModel } = await import('../utils/modelValidation');
      const allModels = useModelStore.getState().models;
      const resolved = resolveModelFields(config.requestModelId, allModels);
      const issues = validateJsonAgainstModel(config.body.content, resolved, { direction: 'request' });
      const errors = issues.filter(i => i.severity === 'error');
      if (errors.length > 0) {
        message.warning(`Request body has ${errors.length} validation issue(s)`);
      }
    }

    // Save first if dirty
    if (isDirty) {
      await handleSave();
    }

    // Rust handles everything: collection context, environment, variable interpolation
    await executeRequest(activeRequestId);
  }, [activeRequestId, config, isDirty, handleSave, executeRequest, message]);

  if (!activeRequestId) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-3"
        style={{ color: 'var(--text-tertiary)' }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 'var(--radius-lg)',
            background: 'var(--bg-tertiary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: 0.6,
          }}
        >
          <ApiOutlined style={{ fontSize: 22, color: 'var(--text-tertiary)' }} />
        </div>
        <span style={{ fontSize: 14, fontFamily: 'var(--font-ui)', fontWeight: 600, color: 'var(--text-secondary)' }}>
          Select a request from the sidebar
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
          or create a new one to get started
        </span>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col"
      style={{ borderColor: 'var(--border)' }}
    >
      {/* URL Bar */}
      <div
        className="glass-header flex items-center gap-3 p-3"
        style={{ position: 'relative' }}
      >
        <Select
          value={config.method}
          onChange={(method) => updateConfig({ method })}
          style={{ width: 110 }}
          options={HTTP_METHODS.map((m) => ({
            label: (
              <span
                style={{
                  color: METHOD_COLORS[m],
                  fontFamily: 'var(--font-code)',
                  fontWeight: 700,
                  fontSize: 12,
                }}
              >
                {m}
              </span>
            ),
            value: m,
          }))}
        />
        <Space.Compact style={{ flex: 1 }}>
          <Button
            style={{
              fontFamily: 'var(--font-code)',
              fontSize: 12,
              color: basePart ? 'var(--text-tertiary)' : 'var(--warning)',
              maxWidth: 300,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              cursor: 'default',
              pointerEvents: 'none',
            }}
            title={basePart || 'No host configured - set an environment host'}
          >
            {basePart || '(no host)'}
          </Button>
          <Input
            className="input-mono"
            placeholder="/users/123"
            value={config.url}
            onChange={(e) => {
              const extracted = extractPathFromUrl(e.target.value);
              const { path, params: newParams } = parseQueryParamsFromUrl(extracted);
              if (newParams.length > 0) {
                updateConfig({ url: path, params: [...config.params, ...newParams] });
              } else {
                updateConfig({ url: extracted });
              }
            }}
            onPressEnter={handleSend}
          />
        </Space.Compact>
        <Space.Compact>
          {isDirty && (
            <Button icon={<SaveOutlined />} onClick={handleSave}>
              Save
            </Button>
          )}
          <Button
            type="primary"
            className="btn-glow"
            icon={<SendOutlined />}
            onClick={handleSend}
            loading={loading}
            style={{ fontWeight: 600 }}
          >
            Send
          </Button>
        </Space.Compact>
      </div>

      <ConfigValidationModal
        open={showConfigModal}
        onClose={() => setShowConfigModal(false)}
        missingHost={!hostPart}
        activeRequestId={activeRequestId}
      />

      {/* Config Tabs */}
      <Tabs
        activeKey={activeTab}
        onChange={(key) =>
          setActiveTab(key as 'params' | 'headers' | 'body' | 'auth' | 'info')
        }
        size="small"
        style={{ padding: '0 12px' }}
        items={[
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
            key: 'auth',
            label: 'Auth',
            children: (
              <AuthEditor
                auth={config.auth}
                onChange={(auth) => updateConfig({ auth })}
              />
            ),
          },
          {
            key: 'info',
            label: 'Info',
            children: (
              <div className="pb-2">
                <Input.TextArea
                  placeholder="Add notes or description for this request..."
                  value={config.description ?? ''}
                  onChange={(e) => updateConfig({ description: e.target.value || undefined })}
                  autoSize={{ minRows: 3, maxRows: 10 }}
                />
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
