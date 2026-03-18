'use client';

import { Button, Spin, Flex, App, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useState, useEffect, useCallback } from 'react';
import { useSpecStore } from '@/app/stores/specStore';
import { useProjectStore } from '@/app/stores/projectStore';
import { EndpointList } from './EndpointList';
import { EndpointDetail } from './EndpointDetail';

const { Text } = Typography;

export function ApiDocsPanel() {
  const { message } = App.useApp();
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const { spec, loading, error, fetchSpec, generateSpec, clearSpec } = useSpecStore();

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);

  useEffect(() => {
    if (activeProjectId) {
      fetchSpec(activeProjectId);
    } else {
      clearSpec();
    }
  }, [activeProjectId, fetchSpec, clearSpec]);

  const handleRegenerate = useCallback(async () => {
    if (!activeProjectId) return;
    try {
      await generateSpec(activeProjectId);
      message.success('API docs regenerated');
    } catch {
      message.error('Failed to regenerate API docs');
    }
  }, [activeProjectId, generateSpec, message]);

  const handleSelect = useCallback((path: string, method: string) => {
    setSelectedPath(path);
    setSelectedMethod(method);
  }, []);

  const serverUrl = (spec?.servers as { url: string }[] | undefined)?.[0]?.url ?? '';

  return (
    <Flex vertical style={{ height: '100%', overflow: 'hidden' }}>
      {/* Top bar */}
      <Flex
        align="center"
        justify="space-between"
        style={{
          padding: '8px 16px',
          borderBottom: '1px solid var(--ant-color-border)',
          flexShrink: 0,
        }}
      >
        <Text strong style={{ fontSize: 14 }}>
          API Docs
        </Text>
        <Button
          size="small"
          icon={<ReloadOutlined />}
          onClick={handleRegenerate}
          loading={loading}
          disabled={!activeProjectId}
        >
          Regenerate
        </Button>
      </Flex>

      {/* Body */}
      <Flex style={{ flex: 1, overflow: 'hidden' }}>
        {loading && (
          <Flex justify="center" align="center" style={{ flex: 1 }}>
            <Spin size="large" />
          </Flex>
        )}

        {!loading && error && (
          <Flex
            justify="center"
            align="center"
            vertical
            gap={8}
            style={{ flex: 1, padding: 24 }}
          >
            <Text type="danger" style={{ textAlign: 'center' }}>
              {error}
            </Text>
            <Button size="small" onClick={handleRegenerate} disabled={!activeProjectId}>
              Retry
            </Button>
          </Flex>
        )}

        {!loading && !error && !spec && (
          <Flex
            justify="center"
            align="center"
            vertical
            gap={8}
            style={{ flex: 1, padding: 24 }}
          >
            <Text
              style={{
                color: 'var(--ant-color-text-tertiary)',
                textAlign: 'center',
                fontSize: 14,
              }}
            >
              No API docs generated. Click Regenerate or run backend-sync.
            </Text>
            <Button
              type="primary"
              size="small"
              icon={<ReloadOutlined />}
              onClick={handleRegenerate}
              disabled={!activeProjectId}
            >
              Regenerate
            </Button>
          </Flex>
        )}

        {!loading && !error && spec && (
          <>
            {/* Sidebar */}
            <div
              style={{
                width: 280,
                flexShrink: 0,
                borderRight: '1px solid var(--ant-color-border)',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <EndpointList
                spec={spec}
                selectedPath={selectedPath}
                selectedMethod={selectedMethod}
                onSelect={handleSelect}
              />
            </div>

            {/* Detail pane */}
            <div style={{ flex: 1, overflow: 'hidden' }}>
              {selectedPath && selectedMethod ? (
                <EndpointDetail
                  spec={spec}
                  path={selectedPath}
                  method={selectedMethod}
                />
              ) : (
                <Flex
                  justify="center"
                  align="center"
                  style={{
                    height: '100%',
                    color: 'var(--ant-color-text-tertiary)',
                    fontSize: 14,
                  }}
                >
                  Select an endpoint to view details
                </Flex>
              )}
            </div>
          </>
        )}
      </Flex>

      {/* Server URL footer */}
      {spec && serverUrl && (
        <div
          style={{
            padding: '4px 16px',
            borderTop: '1px solid var(--ant-color-border)',
            fontSize: 11,
            color: 'var(--ant-color-text-tertiary)',
            flexShrink: 0,
            fontFamily: 'monospace',
          }}
        >
          Base URL: {serverUrl}
        </div>
      )}
    </Flex>
  );
}
