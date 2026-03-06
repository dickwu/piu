'use client';

import { App, Modal, InputNumber, Input, Button, Select, Tabs } from 'antd';
import {
  CopyOutlined,
  PoweroffOutlined,
  SyncOutlined,
  CloseCircleOutlined,
  CheckCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useState, useEffect, useCallback } from 'react';
import { useSyncStore } from '../stores/syncStore';
import { useProjectStore } from '../stores/projectStore';
import { useCollectionStore } from '../stores/collectionStore';
import { useEnvironmentStore } from '../stores/environmentStore';
import type { SyncResult } from '../types';

interface SyncServerModalProps {
  open: boolean;
  onClose: () => void;
}

const DEFAULT_PORT = 4444;
const BLUE = '#3b82f6';
const BLUE_HOVER = '#2563eb';
const GREEN = '#10b981';

function generateJoinKey(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => chars.charAt(byte % chars.length)).join('');
}

function blueHover(e: React.MouseEvent<HTMLElement>) {
  e.currentTarget.style.background = BLUE_HOVER;
  e.currentTarget.style.borderColor = BLUE_HOVER;
}

function blueLeave(e: React.MouseEvent<HTMLElement>) {
  e.currentTarget.style.background = BLUE;
  e.currentTarget.style.borderColor = BLUE;
}

const blueBtnStyle: React.CSSProperties = {
  background: BLUE,
  borderColor: BLUE,
  color: '#fff',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  color: '#8b8b99',
  marginBottom: 6,
};

function HostPanel() {
  const { message } = App.useApp();
  const { serverStatus, startServer, stopServer, refreshServerStatus } = useSyncStore();
  const { projects, activeProjectId } = useProjectStore();

  const [port, setPort] = useState(DEFAULT_PORT);
  const [joinKey, setJoinKey] = useState(() => generateJoinKey());
  const [projectId, setProjectId] = useState<string | undefined>(activeProjectId ?? undefined);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (serverStatus.running && serverStatus.port) {
      setPort(serverStatus.port);
    }
    if (serverStatus.running && serverStatus.join_key) {
      setJoinKey(serverStatus.join_key);
    }
    if (serverStatus.running && serverStatus.project_id) {
      setProjectId(serverStatus.project_id);
    }
  }, [serverStatus]);

  const handleStart = useCallback(async () => {
    if (!projectId) {
      message.warning('Select a project to sync');
      return;
    }
    setLoading(true);
    try {
      await startServer(port, joinKey, projectId);
      message.success('Sync server started');
    } catch (error) {
      message.error(`${error}`);
    } finally {
      setLoading(false);
    }
  }, [port, joinKey, projectId, startServer, message]);

  const handleStop = useCallback(async () => {
    setLoading(true);
    try {
      await stopServer();
      message.success('Sync server stopped');
    } catch (error) {
      message.error(`${error}`);
    } finally {
      setLoading(false);
      await refreshServerStatus();
    }
  }, [stopServer, refreshServerStatus, message]);

  const copyText = useCallback(
    async (text: string, label: string) => {
      await navigator.clipboard.writeText(text);
      message.success(`${label} copied`);
    },
    [message],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Status pill */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          borderRadius: 6,
          border: '1px solid #1e1e28',
          background: '#16161f',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: serverStatus.running ? BLUE : '#8a8a9e',
              display: 'inline-block',
            }}
          />
          <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e2e8' }}>
            Status: {serverStatus.running ? 'Hosting' : 'Stopped'}
          </span>
        </span>
        <CloseCircleOutlined
          style={{
            color: '#8a8a9e',
            cursor: serverStatus.running ? 'pointer' : 'default',
            opacity: serverStatus.running ? 1 : 0.4,
            fontSize: 14,
          }}
          onClick={serverStatus.running ? handleStop : undefined}
        />
      </div>

      {/* Config fields — only when stopped */}
      {!serverStatus.running && (
        <>
          <div>
            <label style={labelStyle}>Port</label>
            <InputNumber
              value={port}
              onChange={(v) => v && setPort(v)}
              min={1024}
              max={65535}
              style={{ width: '100%' }}
            />
          </div>

          <div>
            <label style={labelStyle}>Join Key</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <Input.Password
                value={joinKey}
                onChange={(e) => setJoinKey(e.target.value)}
                style={{ flex: 1 }}
              />
              <Button
                icon={<ReloadOutlined />}
                onClick={() => setJoinKey(generateJoinKey())}
                title="Generate new key"
              />
            </div>
          </div>

          <div>
            <label style={labelStyle}>Project</label>
            <Select
              value={projectId}
              onChange={setProjectId}
              placeholder="Select project"
              style={{ width: '100%' }}
              options={projects.map((p) => ({ label: p.name, value: p.id }))}
            />
          </div>
        </>
      )}

      {/* Start / Stop */}
      <Button
        type="primary"
        block
        size="large"
        icon={<PoweroffOutlined />}
        onClick={serverStatus.running ? handleStop : handleStart}
        loading={loading}
        danger={serverStatus.running}
        style={serverStatus.running ? undefined : blueBtnStyle}
        onMouseEnter={serverStatus.running ? undefined : blueHover}
        onMouseLeave={serverStatus.running ? undefined : blueLeave}
      >
        {serverStatus.running ? 'Stop Sync Server' : 'Start Sync Server'}
      </Button>

      {/* Share details card — when running */}
      {serverStatus.running && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: 6,
            border: '1px solid #1e1e28',
            background: '#0f0f18',
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e2e8', marginBottom: 12 }}>
            Share these with the other Piu
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#8b8b99' }}>Port</span>
              <span style={{ color: '#e2e2e8', fontFamily: 'var(--font-code)' }}>{port}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#8b8b99' }}>Join Key</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ color: '#e2e2e8', fontFamily: 'var(--font-code)' }}>{joinKey}</span>
                <CopyOutlined
                  style={{ color: '#8a8a9e', cursor: 'pointer', fontSize: 11 }}
                  onClick={() => copyText(joinKey, 'Join key')}
                />
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#8b8b99' }}>Your IP</span>
              <span style={{ color: '#8b8b99', fontFamily: 'var(--font-code)', fontSize: 11 }}>
                (check your network settings)
              </span>
            </div>
          </div>
        </div>
      )}

      {serverStatus.running && (
        <div
          style={{
            padding: '8px 12px',
            borderRadius: 6,
            border: '1px solid #3b82f620',
            background: '#3b82f610',
            fontSize: 11,
            color: '#8b8b99',
            lineHeight: 1.5,
          }}
        >
          Listening on all interfaces (0.0.0.0:{port}). Other Piu instances on your LAN can connect using your machine&apos;s IP address.
        </div>
      )}
    </div>
  );
}

function ConnectPanel() {
  const { message } = App.useApp();
  const { connecting, lastResult, connect } = useSyncStore();
  const { projects, activeProjectId, loadProjects } = useProjectStore();
  const { loadCollections } = useCollectionStore();
  const { loadEnvironments } = useEnvironmentStore();

  const [host, setHost] = useState('');
  const [port, setPort] = useState(DEFAULT_PORT);
  const [joinKey, setJoinKey] = useState('');
  const [projectId, setProjectId] = useState<string | undefined>(activeProjectId ?? undefined);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(lastResult);

  const handleSync = useCallback(async () => {
    if (!host.trim()) {
      message.warning('Enter the host IP address');
      return;
    }
    if (!joinKey.trim()) {
      message.warning('Enter the join key');
      return;
    }
    if (!projectId) {
      message.warning('Select a local project to sync');
      return;
    }
    try {
      const result = await connect(host.trim(), port, joinKey, projectId);
      setSyncResult(result);
      message.success('Sync completed');
      // Reload stores to reflect synced data
      await loadProjects();
      if (projectId) {
        await loadCollections(projectId);
        await loadEnvironments(projectId);
      }
    } catch (error) {
      message.error(`${error}`);
    }
  }, [host, port, joinKey, projectId, connect, message, loadProjects, loadCollections, loadEnvironments]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <label style={labelStyle}>Host IP</label>
        <Input
          value={host}
          onChange={(e) => setHost(e.target.value)}
          placeholder="192.168.1.x"
          style={{ fontFamily: 'var(--font-code)' }}
        />
      </div>

      <div>
        <label style={labelStyle}>Port</label>
        <InputNumber
          value={port}
          onChange={(v) => v && setPort(v)}
          min={1024}
          max={65535}
          style={{ width: '100%' }}
        />
      </div>

      <div>
        <label style={labelStyle}>Join Key</label>
        <Input.Password
          value={joinKey}
          onChange={(e) => setJoinKey(e.target.value)}
          placeholder="Paste the join key from host"
        />
      </div>

      <div>
        <label style={labelStyle}>Local Project</label>
        <Select
          value={projectId}
          onChange={setProjectId}
          placeholder="Select project to sync into"
          style={{ width: '100%' }}
          options={projects.map((p) => ({ label: p.name, value: p.id }))}
        />
      </div>

      <Button
        type="primary"
        block
        size="large"
        icon={<SyncOutlined spin={connecting} />}
        onClick={handleSync}
        loading={connecting}
        style={blueBtnStyle}
        onMouseEnter={blueHover}
        onMouseLeave={blueLeave}
      >
        {connecting ? 'Syncing...' : 'Sync Now'}
      </Button>

      {/* Result display */}
      {syncResult && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: 6,
            border: `1px solid ${syncResult.errors.length > 0 ? '#ef444433' : '#10b98133'}`,
            background: syncResult.errors.length > 0 ? '#ef444410' : '#10b98110',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginBottom: 8,
              fontSize: 13,
              fontWeight: 600,
              color: syncResult.errors.length > 0 ? '#ef4444' : GREEN,
            }}
          >
            <CheckCircleOutlined />
            Sync Complete
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#8b8b99' }}>Pulled (new)</span>
              <span style={{ color: '#e2e2e8' }}>{syncResult.pulled_created}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#8b8b99' }}>Pulled (updated)</span>
              <span style={{ color: '#e2e2e8' }}>{syncResult.pulled_updated}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#8b8b99' }}>Pushed</span>
              <span style={{ color: '#e2e2e8' }}>{syncResult.pushed}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#8b8b99' }}>Deleted</span>
              <span style={{ color: '#e2e2e8' }}>{syncResult.deleted}</span>
            </div>
            {syncResult.errors.length > 0 && (
              <div style={{ marginTop: 4, color: '#ef4444', fontSize: 11, lineHeight: 1.4 }}>
                {syncResult.errors.map((err, i) => (
                  <div key={i}>{err}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function SyncServerModal({ open, onClose }: SyncServerModalProps) {
  const { refreshServerStatus } = useSyncStore();

  useEffect(() => {
    if (open) {
      refreshServerStatus();
    }
  }, [open, refreshServerStatus]);

  return (
    <Modal
      title="Project Sync"
      open={open}
      onCancel={onClose}
      footer={null}
      width={480}
      destroyOnHidden
    >
      <div style={{ paddingTop: 8 }}>
        <Tabs
          items={[
            { key: 'host', label: 'Host', children: <HostPanel /> },
            { key: 'connect', label: 'Connect', children: <ConnectPanel /> },
          ]}
        />
      </div>
    </Modal>
  );
}
