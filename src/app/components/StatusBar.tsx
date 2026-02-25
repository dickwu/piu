'use client';

import { useEffect, useRef, useCallback } from 'react';
import { Button, Progress } from 'antd';
import {
  CheckCircleOutlined,
  LoadingOutlined,
  DownloadOutlined,
  ReloadOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useUpdateStore } from '../stores/updateStore';

const UPDATE_CHECK_DELAY_MS = 3000;

export function StatusBar() {
  const { status, currentVersion, setCurrentVersion, checkForUpdate, downloadAndInstall } =
    useUpdateStore();
  const checkedRef = useRef(false);

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
    <div
      className="flex items-center justify-end border-t px-4"
      style={{
        borderColor: 'var(--border)',
        backgroundColor: 'var(--bg-secondary)',
        height: 26,
        fontSize: 10,
        color: 'var(--text-tertiary)',
        fontFamily: 'var(--font-code)',
      }}
    >
      <div className="flex items-center gap-3">
        {currentVersion && (
          <span style={{ color: 'var(--text-tertiary)', letterSpacing: '0.02em' }}>
            v{currentVersion}
          </span>
        )}
        {renderStatus()}
      </div>
    </div>
  );
}
