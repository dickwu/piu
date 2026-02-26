'use client';

import { Modal, Input, Button } from 'antd';
import { useState, useEffect, useCallback } from 'react';

interface EnvironmentFormModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  initialName?: string;
  initialHost?: string;
  hasName: (name: string, excludeId?: string) => boolean;
  excludeId?: string;
  onClose: () => void;
  onSave: (name: string, host: string) => Promise<void>;
}

export function EnvironmentFormModal({
  open,
  mode,
  initialName = '',
  initialHost = '',
  hasName,
  excludeId,
  onClose,
  onSave,
}: EnvironmentFormModalProps) {
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(initialName);
      setHost(initialHost);
      setSaving(false);
    }
  }, [open, initialName, initialHost]);

  const nameError = name.trim() && hasName(name, excludeId) ? 'Name already exists' : '';
  const isValid = name.trim() !== '' && host.trim() !== '' && !nameError;

  const handleSave = useCallback(async () => {
    if (!isValid) return;
    setSaving(true);
    try {
      await onSave(name.trim(), host.trim());
    } finally {
      setSaving(false);
    }
  }, [isValid, name, host, onSave]);

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

  return (
    <Modal
      title={mode === 'create' ? 'New Environment' : 'Edit Environment'}
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
            placeholder="Production"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onPressEnter={isValid ? handleSave : undefined}
            status={nameError ? 'error' : undefined}
            maxLength={100}
            autoFocus={mode === 'create'}
          />
          {nameError && (
            <span style={{ color: 'var(--error)', fontSize: 11, marginTop: 4, display: 'block' }}>
              {nameError}
            </span>
          )}
        </div>

        <div>
          <label style={labelStyle}>Host (required)</label>
          <Input
            className="input-mono"
            placeholder="https://api.example.com"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            onPressEnter={isValid ? handleSave : undefined}
            status={!host.trim() && host !== '' ? 'error' : undefined}
            autoFocus={mode === 'edit'}
          />
          {!host.trim() && host !== '' && (
            <span style={{ color: 'var(--error)', fontSize: 11, marginTop: 4, display: 'block' }}>
              Host is required
            </span>
          )}
        </div>
      </div>
    </Modal>
  );
}
