'use client';

import { App, Modal, InputNumber, Button } from 'antd';
import {
  CopyOutlined,
  PlayCircleOutlined,
  PoweroffOutlined,
  LinkOutlined,
  CloseCircleOutlined,
  CheckCircleOutlined,
  CloseOutlined,
  LoadingOutlined,
} from '@ant-design/icons';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';

interface McpStatus {
  running: boolean;
  port?: number;
  url?: string;
  has_api_key?: boolean;
}

interface CommandOutput {
  success: boolean;
  stdout: string;
  stderr: string;
  exit_code: number | null;
}

interface McpServerModalProps {
  open: boolean;
  onClose: () => void;
}

const DEFAULT_PORT = 3333;

const GREEN = '#10b981';
const GREEN_HOVER = '#0d9668';

const preStyle: React.CSSProperties = {
  background: '#0f0f18',
  border: '1px solid #1e1e28',
  borderRadius: 6,
  padding: '12px 36px 12px 12px',
  margin: 0,
  fontSize: 12,
  lineHeight: 1.6,
  fontFamily: 'var(--font-code)',
  color: '#e2e2e8',
  overflowX: 'auto',
};

const copyBtnStyle: React.CSSProperties = {
  position: 'absolute',
  top: 4,
  right: 4,
  color: '#8a8a9e',
};

const sectionLabel: React.CSSProperties = {
  fontWeight: 600,
  fontSize: 14,
  marginBottom: 8,
  color: '#e2e2e8',
};

function greenHover(e: React.MouseEvent<HTMLElement>) {
  e.currentTarget.style.background = GREEN_HOVER;
  e.currentTarget.style.borderColor = GREEN_HOVER;
}

function greenLeave(e: React.MouseEvent<HTMLElement>) {
  e.currentTarget.style.background = GREEN;
  e.currentTarget.style.borderColor = GREEN;
}

const greenBtnStyle: React.CSSProperties = {
  background: GREEN,
  borderColor: GREEN,
  color: '#fff',
};

export function McpServerModal({ open, onClose }: McpServerModalProps) {
  const { message } = App.useApp();

  const [status, setStatus] = useState<McpStatus>({ running: false });
  const [port, setPort] = useState(DEFAULT_PORT);
  const [loading, setLoading] = useState(false);
  const [claudeRunning, setClaudeRunning] = useState(false);
  const [claudeResult, setClaudeResult] = useState<
    { type: 'success'; text: string } | { type: 'error'; text: string } | null
  >(null);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await invoke<McpStatus>('get_mcp_server_status');
      setStatus(s);
      if (s.running && s.port) {
        setPort(s.port);
      }
    } catch {
      setStatus({ running: false });
    }
  }, []);

  useEffect(() => {
    if (open) {
      refreshStatus();
      setClaudeResult(null);
    }
  }, [open, refreshStatus]);

  const serverUrl = status.running && status.url
    ? status.url
    : `http://localhost:${port}/mcp`;

  const cursorConfig = useMemo(
    () =>
      JSON.stringify(
        { mcpServers: { piu: { url: serverUrl } } },
        null,
        4,
      ),
    [serverUrl],
  );

  const claudeCommand = useMemo(
    () => `claude mcp add --transport http piu ${serverUrl}`,
    [serverUrl],
  );

  const handleStart = useCallback(async () => {
    setLoading(true);
    try {
      await invoke<string>('start_mcp_server', { port, apiKey: null });
      await refreshStatus();
      message.success('MCP server started');
    } catch (error) {
      message.error(`${error}`);
    } finally {
      setLoading(false);
    }
  }, [port, refreshStatus, message]);

  const handleStop = useCallback(async () => {
    setLoading(true);
    try {
      await invoke('stop_mcp_server');
      setStatus({ running: false });
      message.success('MCP server stopped');
    } catch (error) {
      message.error(`${error}`);
    } finally {
      setLoading(false);
    }
  }, [message]);

  const copyText = useCallback(
    async (text: string, label: string) => {
      await navigator.clipboard.writeText(text);
      message.success(`${label} copied`);
    },
    [message],
  );

  const handleCursorInstall = useCallback(async () => {
    try {
      const config = btoa(JSON.stringify({ url: serverUrl }));
      const installUrl = `https://cursor.com/en/install-mcp?name=piu&config=${encodeURIComponent(config)}`;
      await openUrl(installUrl);
    } catch (error) {
      message.error(`Failed to open Cursor: ${error}`);
    }
  }, [serverUrl, message]);

  const handleRunClaude = useCallback(async () => {
    setClaudeRunning(true);
    setClaudeResult(null);
    try {
      const output = await invoke<CommandOutput>('run_claude_mcp_install', {
        url: serverUrl,
      });
      if (output.success) {
        const text = (output.stdout || 'Piu MCP server added to Claude Code').trim();
        setClaudeResult({ type: 'success', text });
      } else {
        const text = (output.stderr || output.stdout || `Exit code ${output.exit_code}`).trim();
        setClaudeResult({ type: 'error', text });
      }
    } catch (error) {
      setClaudeResult({ type: 'error', text: `${error}` });
    } finally {
      setClaudeRunning(false);
    }
  }, [serverUrl]);

  return (
    <Modal
      title="MCP Server Management"
      open={open}
      onCancel={onClose}
      footer={null}
      width={480}
      destroyOnHidden
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 8 }}>
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
                background: status.running ? GREEN : '#8a8a9e',
                display: 'inline-block',
              }}
            />
            <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e2e8' }}>
              Status: {status.running ? 'Running' : 'Stopped'}
            </span>
          </span>
          <CloseCircleOutlined
            style={{
              color: '#8a8a9e',
              cursor: status.running ? 'pointer' : 'default',
              opacity: status.running ? 1 : 0.4,
              fontSize: 14,
            }}
            onClick={status.running ? handleStop : undefined}
          />
        </div>

        {/* Server Port */}
        {!status.running && (
          <div>
            <label style={{ display: 'block', fontSize: 12, color: '#8b8b99', marginBottom: 6 }}>
              Server Port
            </label>
            <InputNumber
              value={port}
              onChange={(v) => v && setPort(v)}
              min={1024}
              max={65535}
              style={{ width: '100%' }}
            />
          </div>
        )}

        {/* Start / Stop */}
        <Button
          type="primary"
          block
          size="large"
          icon={<PoweroffOutlined />}
          onClick={status.running ? handleStop : handleStart}
          loading={loading}
          danger={status.running}
          style={status.running ? undefined : greenBtnStyle}
          onMouseEnter={status.running ? undefined : greenHover}
          onMouseLeave={status.running ? undefined : greenLeave}
        >
          {status.running ? 'Stop MCP Server' : 'Start MCP Server'}
        </Button>

        {/* Cursor */}
        <div>
          <div style={sectionLabel}>Cursor</div>
          <div style={{ position: 'relative' }}>
            <pre style={{ ...preStyle, whiteSpace: 'pre' }}>{cursorConfig}</pre>
            <Button
              type="text"
              size="small"
              icon={<CopyOutlined />}
              onClick={() => copyText(cursorConfig, 'Config')}
              style={copyBtnStyle}
            />
          </div>
          <Button
            block
            icon={<LinkOutlined />}
            onClick={handleCursorInstall}
            style={{ marginTop: 8, ...greenBtnStyle }}
            onMouseEnter={greenHover}
            onMouseLeave={greenLeave}
          >
            Quick Install in Cursor
          </Button>
        </div>

        {/* Claude Code */}
        <div>
          <div style={sectionLabel}>Claude Code</div>
          <div style={{ position: 'relative' }}>
            <pre style={{ ...preStyle, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {claudeCommand}
            </pre>
            <Button
              type="text"
              size="small"
              icon={<CopyOutlined />}
              onClick={() => copyText(claudeCommand, 'Command')}
              style={copyBtnStyle}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <Button
              icon={claudeRunning ? <LoadingOutlined /> : <PlayCircleOutlined />}
              onClick={handleRunClaude}
              loading={false}
              disabled={claudeRunning}
              style={{ flex: 1, ...greenBtnStyle }}
              onMouseEnter={claudeRunning ? undefined : greenHover}
              onMouseLeave={claudeRunning ? undefined : greenLeave}
            >
              {claudeRunning ? 'Running...' : 'Run for Claude'}
            </Button>
            <Button
              icon={<CopyOutlined />}
              onClick={() => copyText(claudeCommand, 'Command')}
            >
              Copy
            </Button>
          </div>

          {/* Command output */}
          {claudeResult && (
            <div
              style={{
                marginTop: 8,
                padding: '8px 12px',
                borderRadius: 6,
                border: `1px solid ${claudeResult.type === 'success' ? '#10b98133' : '#ef444433'}`,
                background: claudeResult.type === 'success' ? '#10b98110' : '#ef444410',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, flex: 1, minWidth: 0 }}>
                  {claudeResult.type === 'success' ? (
                    <CheckCircleOutlined style={{ color: GREEN, marginTop: 2, flexShrink: 0 }} />
                  ) : (
                    <CloseCircleOutlined style={{ color: '#ef4444', marginTop: 2, flexShrink: 0 }} />
                  )}
                  <pre
                    style={{
                      margin: 0,
                      fontSize: 11,
                      lineHeight: 1.5,
                      fontFamily: 'var(--font-code)',
                      color: claudeResult.type === 'success' ? GREEN : '#ef4444',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    {claudeResult.text}
                  </pre>
                </div>
                <CloseOutlined
                  style={{
                    color: '#8a8a9e',
                    cursor: 'pointer',
                    fontSize: 10,
                    marginTop: 2,
                    flexShrink: 0,
                  }}
                  onClick={() => setClaudeResult(null)}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
