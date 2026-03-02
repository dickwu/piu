'use client';

import { Modal, Tree, App } from 'antd';
import { FolderOutlined, HomeOutlined } from '@ant-design/icons';
import { useState, useMemo, useCallback } from 'react';
import { useCollectionStore } from '../stores/collectionStore';
import type { ApiRequest } from '../types';
import type { DataNode } from 'antd/es/tree';

interface MoveRequestModalProps {
  open: boolean;
  request: ApiRequest | null;
  onClose: () => void;
  onEmptyCollection?: (collectionId: string, collectionName: string) => void;
}

export function MoveRequestModal({
  open,
  request,
  onClose,
  onEmptyCollection,
}: MoveRequestModalProps) {
  const { message } = App.useApp();
  const { collections, loadRequests, updateRequest, countRequestsInCollection } =
    useCollectionStore();

  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
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

  const treeData = useMemo(() => {
    const isRootRequest = !request?.collection_id;
    const rootNode: DataNode = {
      key: '__root__',
      title: (
        <span
          style={{
            color: isRootRequest ? 'var(--text-tertiary)' : undefined,
            fontFamily: 'var(--font-ui)',
            fontSize: 13,
          }}
        >
          Project Root
          {isRootRequest && (
            <span style={{ marginLeft: 6, color: 'var(--text-tertiary)', fontSize: 10 }}>
              (current)
            </span>
          )}
        </span>
      ),
      icon: <HomeOutlined />,
      disabled: isRootRequest,
    };
    return [rootNode, ...buildTree(null)];
  }, [buildTree, request?.collection_id]);

  const handleSelect = useCallback((keys: React.Key[]) => {
    const key = keys[0];
    if (typeof key === 'string') {
      setSelectedTarget(key);
    } else {
      setSelectedTarget(null);
    }
  }, []);

  const handleMove = useCallback(async () => {
    if (!request || !selectedTarget) return;

    const sourceCollectionId = request.collection_id;
    const movingToRoot = selectedTarget === '__root__';

    setMoving(true);
    try {
      if (movingToRoot) {
        await updateRequest(request.id, { move_to_root: true });
      } else {
        await updateRequest(request.id, { collection_id: selectedTarget });
      }

      // Reload source collection
      if (sourceCollectionId) {
        await loadRequests(sourceCollectionId);
      }
      // Reload target collection
      if (!movingToRoot) {
        await loadRequests(selectedTarget);
      }

      const targetName = movingToRoot
        ? 'Project Root'
        : collections.find((c) => c.id === selectedTarget)?.name ?? selectedTarget;
      message.success(`Moved "${request.name}" to "${targetName}"`);
      setSelectedTarget(null);
      onClose();

      // Check if source collection is now empty
      if (sourceCollectionId && onEmptyCollection) {
        const count = await countRequestsInCollection(sourceCollectionId);
        if (count === 0) {
          const sourceCollection = collections.find((c) => c.id === sourceCollectionId);
          if (sourceCollection) {
            onEmptyCollection(sourceCollectionId, sourceCollection.name);
          }
        }
      }
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : 'Failed to move request. Please try again.',
      );
    } finally {
      setMoving(false);
    }
  }, [
    request,
    selectedTarget,
    updateRequest,
    loadRequests,
    countRequestsInCollection,
    collections,
    message,
    onClose,
    onEmptyCollection,
  ]);

  const handleCancel = useCallback(() => {
    setSelectedTarget(null);
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
        disabled: !selectedTarget,
        loading: moving,
      }}
      destroyOnHidden
    >
      <Tree
        treeData={treeData}
        showIcon
        blockNode
        selectable
        defaultExpandAll
        selectedKeys={selectedTarget ? [selectedTarget] : []}
        onSelect={handleSelect}
        style={{ marginTop: 8 }}
      />
    </Modal>
  );
}
