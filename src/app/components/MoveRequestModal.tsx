'use client';

import { Modal, Tree, App } from 'antd';
import { FolderOutlined } from '@ant-design/icons';
import { useState, useMemo, useCallback } from 'react';
import { useCollectionStore } from '../stores/collectionStore';
import type { ApiRequest } from '../types';
import type { DataNode } from 'antd/es/tree';

interface MoveRequestModalProps {
  open: boolean;
  request: ApiRequest | null;
  onClose: () => void;
}

export function MoveRequestModal({ open, request, onClose }: MoveRequestModalProps) {
  const { message } = App.useApp();
  const { collections, loadRequests, updateRequest } = useCollectionStore();

  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);

  const buildTree = useCallback(
    (parentId: string | null): DataNode[] => {
      const childCollections = collections.filter((c) => c.parent_id === parentId);

      return childCollections.map((col) => {
        const isCurrentCollection = request?.collection_id === col.id;
        const children = buildTree(col.id);

        return {
          key: col.id,
          title: (
            <span
              style={{
                color: isCurrentCollection ? 'var(--text-tertiary)' : undefined,
                fontFamily: 'var(--font-ui)',
                fontSize: 13,
              }}
            >
              {col.name}
              {col.path_prefix && (
                <span
                  style={{
                    marginLeft: 6,
                    color: 'var(--text-tertiary)',
                    fontSize: 10,
                    fontFamily: 'var(--font-code)',
                  }}
                >
                  {col.path_prefix}
                </span>
              )}
              {isCurrentCollection && (
                <span
                  style={{
                    marginLeft: 6,
                    color: 'var(--text-tertiary)',
                    fontSize: 10,
                  }}
                >
                  (current)
                </span>
              )}
            </span>
          ),
          icon: <FolderOutlined />,
          disabled: isCurrentCollection,
          children: children.length > 0 ? children : undefined,
        };
      });
    },
    [collections, request?.collection_id],
  );

  const treeData = useMemo(() => buildTree(null), [buildTree]);

  const handleSelect = useCallback(
    (keys: React.Key[]) => {
      const key = keys[0];
      if (typeof key === 'string') {
        setSelectedCollectionId(key);
      } else {
        setSelectedCollectionId(null);
      }
    },
    [],
  );

  const handleMove = useCallback(async () => {
    if (!request || !selectedCollectionId) return;

    const sourceCollectionId = request.collection_id;

    setMoving(true);
    try {
      await updateRequest(request.id, { collection_id: selectedCollectionId });
      await Promise.all([
        loadRequests(sourceCollectionId),
        loadRequests(selectedCollectionId),
      ]);
      const targetCollection = collections.find((c) => c.id === selectedCollectionId);
      message.success(`Moved "${request.name}" to "${targetCollection?.name ?? selectedCollectionId}"`);
      setSelectedCollectionId(null);
      onClose();
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : 'Failed to move request. Please try again.',
      );
    } finally {
      setMoving(false);
    }
  }, [request, selectedCollectionId, updateRequest, loadRequests, collections, message, onClose]);

  const handleCancel = useCallback(() => {
    setSelectedCollectionId(null);
    onClose();
  }, [onClose]);

  return (
    <Modal
      title={request ? `Move "${request.name}" to...` : 'Move Request'}
      open={open}
      onCancel={handleCancel}
      onOk={handleMove}
      okText="Move"
      okButtonProps={{
        disabled: !selectedCollectionId,
        loading: moving,
      }}
      destroyOnHidden
    >
      {treeData.length === 0 ? (
        <div
          style={{
            padding: '24px 0',
            textAlign: 'center',
            color: 'var(--text-tertiary)',
            fontSize: 13,
          }}
        >
          No collections available.
        </div>
      ) : (
        <Tree
          treeData={treeData}
          showIcon
          blockNode
          selectable
          defaultExpandAll
          selectedKeys={selectedCollectionId ? [selectedCollectionId] : []}
          onSelect={handleSelect}
          style={{ marginTop: 8 }}
        />
      )}
    </Modal>
  );
}
