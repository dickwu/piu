'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { App, Button, Progress, Select } from 'antd';
import {
  CheckCircleOutlined,
  LoadingOutlined,
  DownloadOutlined,
  ReloadOutlined,
  WarningOutlined,
  SettingOutlined,
  ApiOutlined,
  SyncOutlined,
  ApartmentOutlined,
} from '@ant-design/icons';
import { invoke } from '@tauri-apps/api/core';
import { useUpdateStore } from '../stores/updateStore';
import { useEnvironmentStore } from '../stores/environmentStore';
import { useProjectStore } from '../stores/projectStore';
import { useGraphStore } from '../stores/graphStore';
import { ProjectSettingsModal } from './ProjectSettingsModal';
import { McpServerModal } from './McpServerModal';
import { SyncServerModal } from './SyncServerModal';

const UPDATE_CHECK_DELAY_MS = 3000;

export function StatusBar() {
  const { message } = App.useApp();
  const { status, currentVersion, setCurrentVersion, checkForUpdate, downloadAndInstall } =
    useUpdateStore();
  const checkedRef = useRef(false);
  const prevStatusRef = useRef(status.state);

  const {
    environments,
    activeEnvironment,
    setActiveEnvironment,
    loadVariables,
  } = useEnvironmentStore();

  const { activeProjectId, setSettingsProjectId, settingsProjectId } = useProjectStore();

  const layoutComputing = useGraphStore((s) => s.isComputing);

  const [showSettings, setShowSettings] = useState(false);
  const [showMcp, setShowMcp] = useState(false);
  const [showSync, setShowSync] = useState(false);
  const [mcpRunning, setMcpRunning] = useState(false);
  const [syncRunning, setSyncRunning] = useState(false);

  const refreshMcpStatus = useCallback(async () => {
    try {
      const s = await invoke<{ running: boolean }>('get_mcp_server_status');
      setMcpRunning(s.running);
    } catch {
      setMcpRunning(false);
    }
  }, []);

  const refreshSyncStatus = useCallback(async () => {
    try {
      const s = await invoke<{ running: boolean }>('get_sync_server_status');
      setSyncRunning(s.running);
    } catch {
      setSyncRunning(false);
    }
  }, []);

  useEffect(() => {
    refreshMcpStatus();
    refreshSyncStatus();
  }, [refreshMcpStatus, refreshSyncStatus]);

  useEffect(() => {
    if (activeEnvironment) {
      loadVariables(activeEnvironment.id);
    }
  }, [activeEnvironment, loadVariables]);

  // Show message when manual update check completes
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status.state;

    if (prev === 'checking' && status.state === 'up_to_date') {
      message.success(`v${currentVersion} is the latest version`);
    } else if (prev === 'checking' && status.state === 'error') {
      message.error('Failed to check for updates');
    }
  }, [status.state, currentVersion, message]);

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
    const linkStyle = {
      padding: 0,
      height: 'auto',
      fontSize: 11,
      lineHeight: '24px',
    };

    switch (status.state) {
      case 'idle':
        return (
          <Button
            type="link"
            size="small"
            icon={<ReloadOutlined />}
            onClick={checkForUpdate}
            style={{ ...linkStyle, color: 'var(--text-tertiary)' }}
          >
            Check for updates
          </Button>
        );
      case 'up_to_date':
        return (
          <Button
            type="link"
            size="small"
            icon={<CheckCircleOutlined style={{ color: 'var(--success)' }} />}
            onClick={checkForUpdate}
            style={{ ...linkStyle, color: 'var(--text-tertiary)' }}
            title="Click to check again"
          >
            Up to date
          </Button>
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
            style={{ ...linkStyle, color: 'var(--accent)' }}
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
            style={{ ...linkStyle, color: 'var(--success)' }}
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
            style={{ ...linkStyle, color: 'var(--warning)' }}
          >
            Retry update
          </Button>
        );
    }
  };

  return (
    <>
      <div
        className="glass-footer flex items-center justify-between px-4"
        style={{
          height: 30,
          fontSize: 11,
          color: 'var(--text-tertiary)',
          fontFamily: 'var(--font-code)',
          paddingLeft: 20,
          paddingRight: 20,
        }}
      >
        {/* Left: env switch + settings */}
        <div className="flex items-center gap-3">
          <Select
            size="small"
            style={{ width: 160, fontSize: 11 }}
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
                        fontSize: 10,
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
            icon={<SettingOutlined style={{ fontSize: 12 }} />}
            onClick={handleOpenSettings}
            disabled={!activeProjectId}
            style={{
              padding: 0,
              width: 24,
              height: 24,
              minWidth: 24,
              color: 'var(--text-tertiary)',
            }}
            title="Project Settings"
          />
          <Button
            type="text"
            size="small"
            icon={<ApiOutlined style={{ fontSize: 12, color: mcpRunning ? '#10b981' : undefined }} />}
            onClick={() => setShowMcp(true)}
            style={{
              padding: '0 6px',
              height: 24,
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
                background: mcpRunning ? '#10b981' : '#8a8a9e',
                display: 'inline-block',
                flexShrink: 0,
              }}
            />
          </Button>
          <Button
            type="text"
            size="small"
            icon={<SyncOutlined style={{ fontSize: 12, color: syncRunning ? '#3b82f6' : undefined }} />}
            onClick={() => setShowSync(true)}
            style={{
              padding: '0 6px',
              height: 24,
              minWidth: 80,
              color: 'var(--text-tertiary)',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
            title="Project Sync"
          >
            <span>Sync</span>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: syncRunning ? '#3b82f6' : '#8a8a9e',
                display: 'inline-block',
                flexShrink: 0,
              }}
            />
          </Button>
          {layoutComputing && (
            <span
              className="flex items-center gap-1"
              style={{ color: '#fbbf24', fontSize: 11 }}
              title="Computing graph layout..."
            >
              <ApartmentOutlined style={{ fontSize: 12 }} />
              <span>Layout</span>
              <LoadingOutlined style={{ fontSize: 10 }} />
            </span>
          )}
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

      <SyncServerModal open={showSync} onClose={() => { setShowSync(false); refreshSyncStatus(); }} />
    </>
  );
}
