'use client';

import { Button, Input, Tree, Dropdown, Modal } from 'antd';
import {
  PlusOutlined,
  FolderOutlined,
  ApiOutlined,
  DeleteOutlined,
  CopyOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { useState, useCallback, useMemo, useEffect } from 'react';
import { useCollectionStore } from '../stores/collectionStore';
import { useRequestEditorStore } from '../stores/requestStore';
import { useProjectStore } from '../stores/projectStore';
import type { ApiRequest } from '../types';
import { parseConfig } from '../types';
import type { DataNode } from 'antd/es/tree';
import { CollectionSettingsDrawer } from './CollectionSettingsDrawer';

const METHOD_COLORS: Record<string, string> = {
  GET: '#34d399',
  POST: '#fbbf24',
  PUT: '#60a5fa',
  DELETE: '#f87171',
  PATCH: '#c084fc',
  HEAD: '#22d3ee',
  OPTIONS: '#a78bfa',
};

export function Sidebar() {
  const {
    collections,
    requests,
    selectedCollectionId,
    selectedRequestId,
    settingsDrawerCollectionId,
    loadRequests,
    createCollection,
    deleteCollection,
    createRequest,
    deleteRequest,
    duplicateRequest,
    setSelectedCollection,
    setSelectedRequest,
    setSettingsDrawerCollectionId,
  } = useCollectionStore();

  const { setActiveRequest } = useRequestEditorStore();
  const activeProjectId = useProjectStore((s) => s.activeProjectId);

  const [newName, setNewName] = useState('');
  const [createType, setCreateType] = useState<'collection' | 'request'>(
    'collection',
  );
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Load requests for all collections
  useEffect(() => {
    for (const col of collections) {
      loadRequests(col.id);
    }
  }, [collections, loadRequests]);

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return;
    if (createType === 'collection') {
      await createCollection(newName.trim(), undefined, activeProjectId ?? undefined);
    } else if (selectedCollectionId) {
      await createRequest(selectedCollectionId, newName.trim());
    }
    setNewName('');
    setShowCreateModal(false);
  }, [
    newName,
    createType,
    selectedCollectionId,
    createCollection,
    createRequest,
    activeProjectId,
  ]);

  const handleSelectRequest = useCallback(
    (request: ApiRequest) => {
      setSelectedRequest(request.id);
      setSelectedCollection(request.collection_id);
      const config = parseConfig(request.config);
      setActiveRequest(request.id, config);
    },
    [setSelectedRequest, setSelectedCollection, setActiveRequest],
  );

  // Build tree data from collections and requests
  const treeData = useMemo(() => {
    const buildTree = (parentId: string | null): DataNode[] => {
      const childCollections = collections.filter(
        (c) => c.parent_id === parentId,
      );

      return childCollections.map((col) => {
        const colRequests = requests.get(col.id) ?? [];
        const childNodes = buildTree(col.id);

        const requestNodes: DataNode[] = colRequests.map((req) => {
          const config = parseConfig(req.config);
          const method = config.method || 'GET';
          return {
            key: `req-${req.id}`,
            title: (
              <Dropdown
                trigger={['contextMenu']}
                menu={{
                  items: [
                    {
                      key: 'duplicate',
                      icon: <CopyOutlined />,
                      label: 'Duplicate',
                      onClick: () => duplicateRequest(req.id),
                    },
                    {
                      key: 'delete',
                      icon: <DeleteOutlined />,
                      label: 'Delete',
                      danger: true,
                      onClick: () => deleteRequest(req.id),
                    },
                  ],
                }}
              >
                <span
                  className="flex items-center gap-1.5"
                  onClick={() => handleSelectRequest(req)}
                >
                  <span
                    className={`method-pill method-pill-${method.toLowerCase()}`}
                    style={{ fontSize: 9, minWidth: 36 }}
                  >
                    {method}
                  </span>
                  <span
                    className="truncate text-xs"
                    style={{ fontFamily: 'var(--font-ui)' }}
                  >
                    {req.name}
                  </span>
                  <span
                    className="ml-auto"
                    style={{
                      color: 'var(--text-tertiary)',
                      fontFamily: 'var(--font-code)',
                      fontSize: 9,
                    }}
                  >
                    v{req.version}
                  </span>
                </span>
              </Dropdown>
            ),
            icon: <ApiOutlined style={{ color: METHOD_COLORS[method] }} />,
            isLeaf: true,
          };
        });

        return {
          key: `col-${col.id}`,
          title: (
            <Dropdown
              trigger={['contextMenu']}
              menu={{
                items: [
                  {
                    key: 'add-request',
                    icon: <PlusOutlined />,
                    label: 'New Request',
                    onClick: () => {
                      setSelectedCollection(col.id);
                      setCreateType('request');
                      setShowCreateModal(true);
                    },
                  },
                  {
                    key: 'add-sub',
                    icon: <FolderOutlined />,
                    label: 'New Sub-collection',
                    onClick: () => {
                      setSelectedCollection(col.id);
                      setCreateType('collection');
                      setShowCreateModal(true);
                    },
                  },
                  {
                    key: 'settings',
                    icon: <SettingOutlined />,
                    label: 'Settings',
                    onClick: () => setSettingsDrawerCollectionId(col.id),
                  },
                  { type: 'divider' },
                  {
                    key: 'delete',
                    icon: <DeleteOutlined />,
                    label: 'Delete',
                    danger: true,
                    onClick: () => deleteCollection(col.id),
                  },
                ],
              }}
            >
              <span className="flex items-center gap-1.5">
                <span
                  className="truncate text-xs font-semibold"
                  style={{ fontFamily: 'var(--font-ui)' }}
                >
                  {col.name}
                </span>
                {col.path_prefix && (
                  <span
                    className="truncate"
                    style={{
                      color: 'var(--text-tertiary)',
                      fontSize: 9,
                      maxWidth: 80,
                      fontFamily: 'var(--font-code)',
                    }}
                    title={col.path_prefix}
                  >
                    {col.path_prefix}
                  </span>
                )}
                <span
                  className="ml-auto"
                  style={{
                    color: 'var(--text-tertiary)',
                    fontFamily: 'var(--font-code)',
                    fontSize: 9,
                  }}
                >
                  v{col.version}
                </span>
              </span>
            </Dropdown>
          ),
          icon: <FolderOutlined />,
          children: [...childNodes, ...requestNodes],
        };
      });
    };

    return buildTree(null);
  }, [
    collections,
    requests,
    handleSelectRequest,
    duplicateRequest,
    deleteRequest,
    deleteCollection,
    setSelectedCollection,
  ]);

  return (
    <>
      <div className="flex h-full flex-col">
        <div className="sidebar-header flex items-center justify-between p-3">
          <span
            className="text-xs font-bold uppercase tracking-wider"
            style={{ fontFamily: 'var(--font-ui)', color: 'var(--text-secondary)' }}
          >
            Collections
          </span>
          <Button
            size="small"
            icon={<PlusOutlined />}
            onClick={() => {
              setCreateType('collection');
              setShowCreateModal(true);
            }}
          />
        </div>

        <div className="flex-1 overflow-auto p-2">
          {treeData.length === 0 ? (
            <div
              className="p-4 text-center text-sm"
              style={{ color: 'var(--text-tertiary)' }}
            >
              No collections yet.
              <br />
              Click + to create one.
            </div>
          ) : (
            <Tree
              treeData={treeData}
              showIcon
              defaultExpandAll
              blockNode
              selectedKeys={
                selectedRequestId ? [`req-${selectedRequestId}`] : []
              }
            />
          )}
        </div>

        {selectedCollectionId && (
          <div className="border-t p-2" style={{ borderColor: 'var(--border)' }}>
            <Button
              size="small"
              type="dashed"
              block
              icon={<PlusOutlined />}
              onClick={() => {
                setCreateType('request');
                setShowCreateModal(true);
              }}
            >
              New Request
            </Button>
          </div>
        )}
      </div>

      <Modal
        title={
          createType === 'collection' ? 'New Collection' : 'New Request'
        }
        open={showCreateModal}
        onOk={handleCreate}
        onCancel={() => setShowCreateModal(false)}
        width={400}
      >
        <Input
          placeholder={
            createType === 'collection' ? 'Collection name' : 'Request name'
          }
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onPressEnter={handleCreate}
          autoFocus
        />
      </Modal>

      <CollectionSettingsDrawer
        collectionId={settingsDrawerCollectionId}
        open={settingsDrawerCollectionId !== null}
        onClose={() => setSettingsDrawerCollectionId(null)}
      />
    </>
  );
}
