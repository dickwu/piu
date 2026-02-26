'use client';

import { Modal, Input, Button, App } from 'antd';
import { useState, useEffect, useCallback } from 'react';
import { HeadersEditor } from './HeadersEditor';
import type { KeyValuePair } from '../types';

interface CollectionFormData {
  name: string;
  pathPrefix: string | null;
  description: string | null;
  sharedHeaders: string;
}

interface CollectionFormModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  initialName?: string;
  initialPathPrefix?: string;
  initialDescription?: string;
  initialSharedHeaders?: KeyValuePair[];
  onClose: () => void;
  onSave: (data: CollectionFormData) => Promise<void>;
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

export function CollectionFormModal({
  open,
  mode,
  initialName = '',
  initialPathPrefix = '',
  initialDescription = '',
  initialSharedHeaders,
  onClose,
  onSave,
}: CollectionFormModalProps) {
  const { message } = App.useApp();
  const [name, setName] = useState('');
  const [pathPrefix, setPathPrefix] = useState('');
  const [description, setDescription] = useState('');
  const [headers, setHeaders] = useState<KeyValuePair[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(initialName);
      setPathPrefix(initialPathPrefix);
      setDescription(initialDescription);
      setHeaders(initialSharedHeaders ?? []);
      setSaving(false);
    }
  }, [open, initialName, initialPathPrefix, initialDescription, initialSharedHeaders]);

  const isValid = name.trim() !== '';

  const handleSave = useCallback(async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      let normalizedPrefix = pathPrefix.trim();
      if (normalizedPrefix && !normalizedPrefix.startsWith('/')) {
        normalizedPrefix = '/' + normalizedPrefix;
      }
      normalizedPrefix = normalizedPrefix.replace(/\/+$/, '');
      await onSave({
        name: name.trim(),
        pathPrefix: normalizedPrefix || null,
        description: description.trim() || null,
        sharedHeaders: JSON.stringify(headers),
      });
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : 'Failed to save collection',
      );
    } finally {
      setSaving(false);
    }
  }, [name, pathPrefix, description, headers, onSave, message]);

  return (
    <Modal
      title={mode === 'create' ? 'New Collection' : 'Edit Collection'}
      open={open}
      onCancel={onClose}
      width={520}
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
            placeholder="My Collection"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onPressEnter={isValid ? handleSave : undefined}
            maxLength={200}
            autoFocus={mode === 'create'}
          />
        </div>

        <div>
          <label style={labelStyle}>Path Prefix</label>
          <Input
            className="input-mono"
            placeholder="/api/v1"
            value={pathPrefix}
            onChange={(e) => setPathPrefix(e.target.value)}
            onPressEnter={isValid ? handleSave : undefined}
          />
          <div className="mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Prepended to request URL paths when sending (e.g., /api/v1)
          </div>
        </div>

        <div>
          <label style={labelStyle}>Description</label>
          <Input.TextArea
            placeholder="Describe this collection..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            autoSize={{ minRows: 2, maxRows: 6 }}
          />
        </div>

        <div>
          <label style={labelStyle}>Shared Headers</label>
          <div className="mb-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Applied to all requests in this collection. Request-level headers override these.
          </div>
          <HeadersEditor headers={headers} onChange={setHeaders} />
        </div>
      </div>
    </Modal>
  );
}
