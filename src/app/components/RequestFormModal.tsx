'use client';

import { Modal, Input, Button, Select, App } from 'antd';
import { useState, useEffect, useCallback } from 'react';

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

const METHOD_COLORS: Record<string, string> = {
  GET: '#34d399',
  POST: '#fbbf24',
  PUT: '#60a5fa',
  DELETE: '#f87171',
  PATCH: '#c084fc',
  HEAD: '#22d3ee',
  OPTIONS: '#a78bfa',
};

interface RequestFormData {
  name: string;
  method: string;
  url: string;
}

interface RequestFormModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  initialName?: string;
  initialMethod?: string;
  initialUrl?: string;
  onClose: () => void;
  onSave: (data: RequestFormData) => Promise<void>;
}

const labelStyle = {
  color: 'var(--text-tertiary)',
  fontFamily: 'var(--font-ui)',
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
  marginBottom: 4,
  display: 'block',
};

export function RequestFormModal({
  open,
  mode,
  initialName = '',
  initialMethod = 'GET',
  initialUrl = '',
  onClose,
  onSave,
}: RequestFormModalProps) {
  const { message } = App.useApp();
  const [name, setName] = useState('');
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(initialName);
      setMethod(initialMethod);
      setUrl(initialUrl);
      setSaving(false);
    }
  }, [open, initialName, initialMethod, initialUrl]);

  const isValid = name.trim() !== '';

  const handleSave = useCallback(async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        method,
        url: url.trim(),
      });
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : 'Failed to save request',
      );
    } finally {
      setSaving(false);
    }
  }, [name, method, url, onSave, message]);

  return (
    <Modal
      title={mode === 'create' ? 'New Request' : 'Edit Request'}
      open={open}
      onCancel={onClose}
      width={420}
      destroyOnHidden
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            type="primary"
            onClick={handleSave}
            disabled={!isValid}
            loading={saving}
          >
            {mode === 'create' ? 'Create' : 'Save'}
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '8px 0' }}>
        <div>
          <label style={labelStyle}>Name</label>
          <Input
            placeholder="Get Users"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onPressEnter={isValid ? handleSave : undefined}
            maxLength={200}
            autoFocus={mode === 'create'}
          />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ width: 120, flexShrink: 0 }}>
            <label style={labelStyle}>Method</label>
            <Select
              value={method}
              onChange={setMethod}
              style={{ width: '100%' }}
              options={HTTP_METHODS.map((m) => ({
                label: (
                  <span style={{ color: METHOD_COLORS[m], fontWeight: 600, fontFamily: 'var(--font-code)' }}>
                    {m}
                  </span>
                ),
                value: m,
              }))}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>URL Path</label>
            <Input
              className="input-mono"
              placeholder="/users"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onPressEnter={isValid ? handleSave : undefined}
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}
