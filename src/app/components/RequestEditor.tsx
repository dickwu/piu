'use client';

import { Select, Input, Button, Tabs, Space } from 'antd';
import { SendOutlined, SaveOutlined } from '@ant-design/icons';
import { useCallback } from 'react';
import { useRequestEditorStore } from '../stores/requestStore';
import { useCollectionStore } from '../stores/collectionStore';
import { useResponseStore } from '../stores/responseStore';
import { useEnvironmentStore } from '../stores/environmentStore';
import { HeadersEditor } from './HeadersEditor';
import { ParamsEditor } from './ParamsEditor';
import { BodyEditor } from './BodyEditor';
import { AuthEditor } from './AuthEditor';
import type { RequestConfig } from '../types';
import { parseSharedHeaders } from '../types';

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

const METHOD_COLORS: Record<string, string> = {
  GET: '#22c55e',
  POST: '#f59e0b',
  PUT: '#3b82f6',
  DELETE: '#ef4444',
  PATCH: '#a855f7',
  HEAD: '#06b6d4',
  OPTIONS: '#8b5cf6',
};

export function RequestEditor() {
  const { activeRequestId, config, activeTab, isDirty, updateConfig, setActiveTab } =
    useRequestEditorStore();
  const updateRequest = useCollectionStore((s) => s.updateRequest);
  const { executeRequest, loading } = useResponseStore();
  const getResolvedVariables = useEnvironmentStore(
    (s) => s.getResolvedVariables,
  );
  const resetDirty = useRequestEditorStore((s) => s.resetDirty);
  const getCollectionForRequest = useCollectionStore(
    (s) => s.getCollectionForRequest,
  );

  const handleSave = useCallback(async () => {
    if (!activeRequestId) return;
    await updateRequest(activeRequestId, {
      config: JSON.stringify(config),
    });
    resetDirty();
  }, [activeRequestId, config, updateRequest, resetDirty]);

  const handleSend = useCallback(async () => {
    // Save first if dirty
    if (isDirty && activeRequestId) {
      await handleSave();
    }

    // Build effective config with collection path prefix and shared headers
    const effectiveConfig = { ...config, headers: [...config.headers] };

    if (activeRequestId) {
      const collection = getCollectionForRequest(activeRequestId);

      // Prepend path prefix to URL path
      if (collection?.path_prefix && effectiveConfig.url) {
        const prefix = collection.path_prefix.replace(/\/+$/, '');
        const url = effectiveConfig.url;
        const protocolMatch = url.match(/^(https?:\/\/[^/?#]*)(.*)/);
        if (protocolMatch) {
          const [, origin, rest] = protocolMatch;
          const pathAndRest = rest || '/';
          if (!pathAndRest.startsWith(prefix + '/') && pathAndRest !== prefix) {
            effectiveConfig.url = origin + prefix + pathAndRest;
          }
        } else {
          const normalizedUrl = url.startsWith('/') ? url : '/' + url;
          if (!normalizedUrl.startsWith(prefix + '/') && normalizedUrl !== prefix) {
            effectiveConfig.url = prefix + normalizedUrl;
          }
        }
      }

      // Merge shared headers (collection headers, then request headers override)
      if (collection?.shared_headers) {
        const sharedHeaders = parseSharedHeaders(collection.shared_headers);
        const requestHeaderKeys = new Set(
          effectiveConfig.headers
            .filter((h) => h.enabled && h.key)
            .map((h) => h.key.toLowerCase()),
        );
        const extraHeaders = sharedHeaders.filter(
          (h) => h.enabled && h.key && !requestHeaderKeys.has(h.key.toLowerCase()),
        );
        effectiveConfig.headers = [...extraHeaders, ...effectiveConfig.headers];
      }
    }

    const envVars = getResolvedVariables();
    await executeRequest(JSON.stringify(effectiveConfig), envVars);
  }, [config, isDirty, activeRequestId, handleSave, getResolvedVariables, executeRequest, getCollectionForRequest]);

  if (!activeRequestId) {
    return (
      <div
        className="flex flex-1 items-center justify-center"
        style={{ color: 'var(--text-secondary)' }}
      >
        Select a request from the sidebar or create a new one
      </div>
    );
  }

  return (
    <div
      className="flex flex-col border-b"
      style={{ borderColor: 'var(--border)', minHeight: '50%' }}
    >
      {/* URL Bar */}
      <div className="flex items-center gap-2 border-b p-3" style={{ borderColor: 'var(--border)' }}>
        <Select
          value={config.method}
          onChange={(method) => updateConfig({ method })}
          style={{ width: 110 }}
          options={HTTP_METHODS.map((m) => ({
            label: <span style={{ color: METHOD_COLORS[m], fontWeight: 700 }}>{m}</span>,
            value: m,
          }))}
        />
        <Input
          placeholder="Enter URL or paste cURL"
          value={config.url}
          onChange={(e) => updateConfig({ url: e.target.value })}
          onPressEnter={handleSend}
          style={{ flex: 1 }}
        />
        <Space.Compact>
          {isDirty && (
            <Button icon={<SaveOutlined />} onClick={handleSave}>
              Save
            </Button>
          )}
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={handleSend}
            loading={loading}
          >
            Send
          </Button>
        </Space.Compact>
      </div>

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
