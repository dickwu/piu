'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { Button, Progress, Select } from 'antd';
import {
  CheckCircleOutlined,
  LoadingOutlined,
  DownloadOutlined,
  ReloadOutlined,
  WarningOutlined,
  SettingOutlined,
  ApiOutlined,
} from '@ant-design/icons';
import { invoke } from '@tauri-apps/api/core';
import { useUpdateStore } from '../stores/updateStore';
import { useEnvironmentStore } from '../stores/environmentStore';
import { useProjectStore } from '../stores/projectStore';
import { ProjectSettingsModal } from './ProjectSettingsModal';
import { McpServerModal } from './McpServerModal';

const UPDATE_CHECK_DELAY_MS = 3000;

export function StatusBar() {
  const { status, currentVersion, setCurrentVersion, checkForUpdate, downloadAndInstall } =
    useUpdateStore();
  const checkedRef = useRef(false);

  const {
    environments,
    activeEnvironment,
    setActiveEnvironment,
    loadVariables,
  } = useEnvironmentStore();

  const { activeProjectId, setSettingsProjectId, settingsProjectId } = useProjectStore();

  const [showSettings, setShowSettings] = useState(false);
  const [showMcp, setShowMcp] = useState(false);
  const [mcpRunning, setMcpRunning] = useState(false);

  const refreshMcpStatus = useCallback(async () => {
    try {
      const s = await invoke<{ running: boolean }>('get_mcp_server_status');
      setMcpRunning(s.running);
    } catch {
      setMcpRunning(false);
    }
  }, []);

  useEffect(() => {
    refreshMcpStatus();
  }, [refreshMcpStatus]);

  useEffect(() => {
    if (activeEnvironment) {
      loadVariables(activeEnvironment.id);
    }
  }, [activeEnvironment, loadVariables]);

  // Load current version on mount
  useEffect(() => {
    (async () => {
      try {
        const { getVersion } = await import('@tauri-apps/api/app');
        const version = await getVersion();
        setCurrentVersion(version);
      } catch {
        // Ignore in dev mode
      }
    })();
  }, [setCurrentVersion]);

  // Auto-check for updates after delay
  useEffect(() => {
    if (checkedRef.current) return;
    checkedRef.current = true;
    const timer = setTimeout(checkForUpdate, UPDATE_CHECK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [checkForUpdate]);

  const handleRestart = useCallback(async () => {
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  }, []);

  const handleOpenSettings = useCallback(() => {
    if (activeProjectId) {
      setSettingsProjectId(activeProjectId);
      setShowSettings(true);
    }
  }, [activeProjectId, setSettingsProjectId]);

  const handleCloseSettings = useCallback(() => {
    setShowSettings(false);
    setSettingsProjectId(null);
  }, [setSettingsProjectId]);

  const renderStatus = () => {
    switch (status.state) {
      case 'idle':
      case 'up_to_date':
        return (
          <span className="flex items-center gap-1">
            <CheckCircleOutlined style={{ color: 'var(--success)', fontSize: 11 }} />
            <span>Up to date</span>
          </span>
        );
      case 'checking':
        return (
          <span className="flex items-center gap-1">
            <LoadingOutlined style={{ fontSize: 11 }} />
            <span>Checking...</span>
          </span>
        );
      case 'available':
        return (
          <Button
            type="link"
            size="small"
            icon={<DownloadOutlined />}
            onClick={downloadAndInstall}
            style={{ padding: 0, height: 'auto', fontSize: 11, color: 'var(--accent)' }}
          >
            v{status.version} available
          </Button>
        );
      case 'downloading':
        return (
          <span className="flex items-center gap-2" style={{ minWidth: 140 }}>
            <span>Updating...</span>
            <Progress
              percent={status.progress}
              size="small"
              showInfo={false}
              style={{ width: 80, margin: 0 }}
            />
          </span>
        );
      case 'ready':
        return (
          <Button
            type="link"
            size="small"
            icon={<ReloadOutlined />}
            onClick={handleRestart}
            style={{ padding: 0, height: 'auto', fontSize: 11, color: 'var(--success)' }}
          >
            Restart to apply v{status.version}
          </Button>
        );
      case 'error':
        return (
          <Button
            type="link"
            size="small"
            icon={<WarningOutlined />}
            onClick={checkForUpdate}
            style={{ padding: 0, height: 'auto', fontSize: 11, color: 'var(--warning)' }}
          >
            Retry update
          </Button>
        );
    }
  };

  return (
    <>
      <div
        className="flex items-center justify-between border-t px-4"
        style={{
          borderColor: 'var(--border)',
          backgroundColor: 'var(--bg-secondary)',
          height: 26,
          fontSize: 10,
          color: 'var(--text-tertiary)',
          fontFamily: 'var(--font-code)',
          paddingLeft: 20,
          paddingRight: 20,
        }}
      >
        {/* Left: env switch + settings */}
        <div className="flex items-center gap-2">
          <Select
            size="small"
            style={{ width: 160, fontSize: 10 }}
            placeholder="No Environment"
            value={activeEnvironment?.id}
            onChange={(id) => {
              if (activeProjectId) {
                setActiveEnvironment(id, activeProjectId);
              }
            }}
            options={environments.map((env) => ({
              label: (
                <span style={{ fontSize: 11 }}>
                  {env.name}
                  {env.host && (
                    <span
                      style={{
                        color: 'var(--text-tertiary)',
                        fontSize: 9,
                        marginLeft: 4,
                        fontFamily: 'var(--font-code)',
                      }}
                    >
                      {env.host}
                    </span>
                  )}
                </span>
              ),
              value: env.id,
            }))}
            popupMatchSelectWidth={220}
          />
          <Button
            type="text"
            size="small"
            icon={<SettingOutlined style={{ fontSize: 11 }} />}
            onClick={handleOpenSettings}
            disabled={!activeProjectId}
            style={{
              padding: 0,
              width: 20,
              height: 20,
              minWidth: 20,
              color: 'var(--text-tertiary)',
            }}
            title="Project Settings"
          />
          <Button
            type="text"
            size="small"
            icon={<ApiOutlined style={{ fontSize: 11, color: mcpRunning ? '#10b981' : undefined }} />}
            onClick={() => setShowMcp(true)}
            style={{
              padding: '0 6px',
              height: 20,
              minWidth: 80,
              color: 'var(--text-tertiary)',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
            title="MCP Server"
          >
            <span>MCP</span>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: mcpRunning ? '#10b981' : '#7a7a8e',
                display: 'inline-block',
                flexShrink: 0,
              }}
            />
          </Button>
        </div>

        {/* Right: version + update status */}
        <div className="flex items-center gap-3">
          {currentVersion && (
            <span style={{ color: 'var(--text-tertiary)', letterSpacing: '0.02em' }}>
              v{currentVersion}
            </span>
          )}
          {renderStatus()}
        </div>
      </div>

      <ProjectSettingsModal
        projectId={settingsProjectId}
        open={showSettings}
        onClose={handleCloseSettings}
      />

      <McpServerModal open={showMcp} onClose={() => { setShowMcp(false); refreshMcpStatus(); }} />
    </>
  );
}
