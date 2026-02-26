'use client';

import { Modal, Input, Button, Space } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import { useState, useEffect, useCallback } from 'react';
import { useCollectionStore } from '../stores/collectionStore';
import { HeadersEditor } from './HeadersEditor';
import { parseSharedHeaders } from '../types';
import type { KeyValuePair } from '../types';

interface CollectionSettingsDrawerProps {
  collectionId: string | null;
  open: boolean;
  onClose: () => void;
}

export function CollectionSettingsDrawer({
  collectionId,
  open,
  onClose,
}: CollectionSettingsDrawerProps) {
  const collections = useCollectionStore((s) => s.collections);
  const updateCollection = useCollectionStore((s) => s.updateCollection);

  const collection = collections.find((c) => c.id === collectionId);

  const [pathPrefix, setPathPrefix] = useState('');
  const [description, setDescription] = useState('');
  const [headers, setHeaders] = useState<KeyValuePair[]>([]);

  useEffect(() => {
    if (collection && open) {
      setPathPrefix(collection.path_prefix ?? '');
      setDescription(collection.description ?? '');
      setHeaders(parseSharedHeaders(collection.shared_headers));
    }
  }, [collectionId, open]);

  const handleSave = useCallback(async () => {
    if (!collectionId) return;
    let normalizedPrefix = pathPrefix.trim();
    if (normalizedPrefix && !normalizedPrefix.startsWith('/')) {
      normalizedPrefix = '/' + normalizedPrefix;
    }
    normalizedPrefix = normalizedPrefix.replace(/\/+$/, '');
    await updateCollection(collectionId, {
      path_prefix: normalizedPrefix || null,
      description: description.trim() || null,
      shared_headers: JSON.stringify(headers),
    });
    onClose();
  }, [collectionId, pathPrefix, description, headers, updateCollection, onClose]);

  return (
    <Modal
      title={collection ? `${collection.name} — Settings` : 'Collection Settings'}
      open={open}
      onCancel={onClose}
      width={520}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" icon={<SaveOutlined />} onClick={handleSave}>
            Save
          </Button>
        </div>
      }
    >
      <Space orientation="vertical" size="large" style={{ width: '100%' }}>
        <div>
          <label
            className="mb-1 block text-xs font-semibold uppercase tracking-wider"
            style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-ui)' }}
          >
            Path Prefix
          </label>
          <Input
            className="input-mono"
            placeholder="/api/v1"
            value={pathPrefix}
            onChange={(e) => setPathPrefix(e.target.value)}
          />
          <div
            className="mt-1 text-xs"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Prepended to request URL paths when sending (e.g., /api/v1)
          </div>
        </div>

        <div>
          <label
            className="mb-1 block text-xs font-semibold uppercase tracking-wider"
            style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-ui)' }}
          >
            Description
          </label>
          <Input.TextArea
            placeholder="Describe this collection..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            autoSize={{ minRows: 2, maxRows: 6 }}
          />
        </div>

        <div>
          <label
            className="mb-1 block text-xs font-semibold uppercase tracking-wider"
            style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-ui)' }}
          >
            Shared Headers
          </label>
          <div
            className="mb-1 text-xs"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Applied to all requests in this collection. Request-level headers override these.
          </div>
          <HeadersEditor headers={headers} onChange={setHeaders} />
        </div>
      </Space>
    </Modal>
  );
}
