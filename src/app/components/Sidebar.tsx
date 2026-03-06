'use client';

import { Button, Tree, Dropdown, Tooltip, App } from 'antd';
import {
  PlusOutlined,
  FolderOutlined,
  ApiOutlined,
  DeleteOutlined,
  CopyOutlined,
  EditOutlined,
  SettingOutlined,
  HistoryOutlined,
  SwapOutlined,
  HomeOutlined,
} from '@ant-design/icons';
import { useState, useCallback, useMemo, useEffect } from 'react';
import { useCollectionStore, ROOT_REQUESTS_KEY } from '../stores/collectionStore';
import { useRequestEditorStore } from '../stores/requestStore';
import { useProjectStore } from '../stores/projectStore';
import type { ApiRequest } from '../types';
import { parseConfig, parseSharedHeaders, defaultRequestConfig, parseQueryParamsFromUrl } from '../types';
import type { DataNode } from 'antd/es/tree';
import { CollectionFormModal } from './CollectionFormModal';
import { RequestFormModal } from './RequestFormModal';
import { ProjectHistoryModal } from './CollectionHistoryModal';
import { MoveRequestModal } from './MoveRequestModal';

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
  const { modal } = App.useApp();

  const {
    collections,
    requests,
    selectedCollectionId,
    selectedRequestId,
    settingsDrawerCollectionId,
    loadCollections,
    loadRequests,
    loadRootRequests,
    countRequestsInCollection,
    createCollection,
    updateCollection,
    deleteCollection,
    createRequest,
    updateRequest,
    deleteRequest,
    duplicateRequest,
    setSelectedCollection,
    setSelectedRequest,
    setSettingsDrawerCollectionId,
  } = useCollectionStore();

  const { activeRequestId, setActiveRequest } = useRequestEditorStore();
  const activeProjectId = useProjectStore((s) => s.activeProjectId);

  // Collection form modal state
  const [collFormOpen, setCollFormOpen] = useState(false);
  const [collFormMode, setCollFormMode] = useState<'create' | 'edit'>('create');
  const [collFormCollectionId, setCollFormCollectionId] = useState<string | null>(null);
  const [collFormParentId, setCollFormParentId] = useState<string | null>(null);

  // Request form modal state
  const [reqFormOpen, setReqFormOpen] = useState(false);
  const [reqFormMode, setReqFormMode] = useState<'create' | 'edit'>('create');
  const [reqFormRequestId, setReqFormRequestId] = useState<string | null>(null);
  const [reqFormCollectionId, setReqFormCollectionId] = useState<string | null>(null);

  // Project history modal state
  const [historyOpen, setHistoryOpen] = useState(false);

  // Move request modal state
  const [moveModalOpen, setMoveModalOpen] = useState(false);
  const [moveRequest, setMoveRequest] = useState<ApiRequest | null>(null);

  // Load requests for all collections
  useEffect(() => {
    for (const col of collections) {
      loadRequests(col.id);
    }
  }, [collections, loadRequests]);

  // Load root requests when active project changes
  useEffect(() => {
    if (activeProjectId) {
      loadRootRequests(activeProjectId);
    }
  }, [activeProjectId, loadRootRequests]);

  // Sync external store trigger (from ConfigValidationModal) with local modal state
  useEffect(() => {
    if (settingsDrawerCollectionId) {
      setCollFormMode('edit');
      setCollFormCollectionId(settingsDrawerCollectionId);
      setCollFormParentId(null);
      setCollFormOpen(true);
      setSettingsDrawerCollectionId(null);
    }
  }, [settingsDrawerCollectionId, setSettingsDrawerCollectionId]);

  // --- Collection form helpers ---

  const openCollectionCreate = useCallback((parentId: string | null) => {
    setCollFormMode('create');
    setCollFormCollectionId(null);
    setCollFormParentId(parentId);
    setCollFormOpen(true);
  }, []);

  const openCollectionEdit = useCallback((collectionId: string) => {
    setCollFormMode('edit');
    setCollFormCollectionId(collectionId);
    setCollFormParentId(null);
    setCollFormOpen(true);
  }, []);

  const handleCloseHistory = useCallback(() => {
    setHistoryOpen(false);
  }, []);

  const handleCloseCollForm = useCallback(() => {
    setCollFormOpen(false);
    setCollFormCollectionId(null);
    setCollFormParentId(null);
  }, []);

  const handleSaveCollForm = useCallback(
    async (data: {
      name: string;
      pathPrefix: string | null;
      description: string | null;
      sharedHeaders: string;
    }) => {
      if (collFormMode === 'create') {
        const col = await createCollection(
          data.name,
          collFormParentId ?? undefined,
          activeProjectId ?? undefined,
        );
        await updateCollection(col.id, {
          path_prefix: data.pathPrefix,
          description: data.description,
          shared_headers: data.sharedHeaders,
        });
      } else if (collFormCollectionId) {
        await updateCollection(collFormCollectionId, {
          name: data.name,
          path_prefix: data.pathPrefix,
          description: data.description,
          shared_headers: data.sharedHeaders,
        });
      }
      handleCloseCollForm();
    },
    [
      collFormMode,
      collFormCollectionId,
      collFormParentId,
      activeProjectId,
      createCollection,
      updateCollection,
      handleCloseCollForm,
    ],
  );

  // --- Request form helpers ---

  const openRequestCreate = useCallback((collectionId: string) => {
    setSelectedCollection(collectionId);
    setReqFormMode('create');
    setReqFormRequestId(null);
    setReqFormCollectionId(collectionId);
    setReqFormOpen(true);
  }, [setSelectedCollection]);

  const openRequestEdit = useCallback((req: ApiRequest) => {
    setReqFormMode('edit');
    setReqFormRequestId(req.id);
    setReqFormCollectionId(req.collection_id);
    setReqFormOpen(true);
  }, []);

  const handleCloseReqForm = useCallback(() => {
    setReqFormOpen(false);
    setReqFormRequestId(null);
    setReqFormCollectionId(null);
  }, []);

  // --- Move request helpers ---

  const openMoveModal = useCallback((req: ApiRequest) => {
    setMoveRequest(req);
    setMoveModalOpen(true);
  }, []);

  const handleCloseMoveModal = useCallback(() => {
    setMoveModalOpen(false);
    setMoveRequest(null);
  }, []);

  const handleEmptyCollection = useCallback(
    (collectionId: string, collectionName: string) => {
      // Only prompt for leaf collections (no child collections)
      const hasChildren = collections.some((c) => c.parent_id === collectionId);
      if (hasChildren) return;

      modal.confirm({
        title: 'Delete empty collection?',
        content: `"${collectionName}" has no more requests. Would you like to delete it?`,
        okText: 'Delete',
        okButtonProps: { danger: true },
        cancelText: 'Keep',
        onOk: async () => {
          await deleteCollection(collectionId);
          if (activeProjectId) {
            await loadCollections(activeProjectId);
          }
        },
      });
    },
    [collections, modal, deleteCollection, activeProjectId, loadCollections],
  );

  const findRequestById = useCallback(
    (requestId: string): ApiRequest | undefined => {
      for (const reqs of requests.values()) {
        const found = reqs.find((r) => r.id === requestId);
        if (found) return found;
      }
      return undefined;
    },
    [requests],
  );

  const handleSaveReqForm = useCallback(
    async (data: { name: string; method: string; url: string }) => {
      const { path: cleanUrl, params: parsedParams } = parseQueryParamsFromUrl(data.url);

      if (reqFormMode === 'create') {
        const config = {
          ...defaultRequestConfig(),
          method: data.method,
          url: cleanUrl,
          params: parsedParams,
        };
        const req = await createRequest(
          reqFormCollectionId,
          data.name,
          JSON.stringify(config),
          activeProjectId ?? undefined,
        );
        setSelectedRequest(req.id);
        if (req.collection_id) {
          setSelectedCollection(req.collection_id);
        }
        setActiveRequest(req.id, parseConfig(req.config));
      } else if (reqFormMode === 'edit' && reqFormRequestId) {
        const existing = findRequestById(reqFormRequestId);
        if (existing) {
          const existingConfig = parseConfig(existing.config);
          const updatedConfig = {
            ...existingConfig,
            method: data.method,
            url: cleanUrl,
            params: [...existingConfig.params, ...parsedParams],
          };
          await updateRequest(reqFormRequestId, {
            name: data.name,
            config: JSON.stringify(updatedConfig),
          });
          // Sync RequestEditor if this is the active request
          if (reqFormRequestId === activeRequestId) {
            setActiveRequest(reqFormRequestId, updatedConfig);
          }
        }
      }
      handleCloseReqForm();
    },
    [
      reqFormMode,
      reqFormRequestId,
      reqFormCollectionId,
      activeProjectId,
      activeRequestId,
      createRequest,
      updateRequest,
      findRequestById,
      setSelectedRequest,
      setSelectedCollection,
      setActiveRequest,
      handleCloseReqForm,
    ],
  );

  const openRequestModal = useRequestEditorStore((s) => s.openRequestModal);

  const handleSelectRequest = useCallback(
    (request: ApiRequest) => {
      setSelectedRequest(request.id);
      if (request.collection_id) {
        setSelectedCollection(request.collection_id);
      }
      const config = parseConfig(request.config);
      setActiveRequest(request.id, config);
      openRequestModal();
    },
    [setSelectedRequest, setSelectedCollection, setActiveRequest, openRequestModal],
  );

  // --- Computed values for modal initial props ---

  const collFormCollection = collFormCollectionId
    ? collections.find((c) => c.id === collFormCollectionId)
    : undefined;

  const collFormSharedHeaders = useMemo(
    () =>
      collFormCollection
        ? parseSharedHeaders(collFormCollection.shared_headers)
        : undefined,
    [collFormCollection?.shared_headers],
  );

  const reqFormRequest = reqFormRequestId
    ? findRequestById(reqFormRequestId)
    : undefined;
  const reqFormConfig = reqFormRequest
    ? parseConfig(reqFormRequest.config)
    : undefined;

  // Build a request node (shared between root requests and collection requests)
  const buildRequestNode = useCallback(
    (req: ApiRequest): DataNode => {
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
                  key: 'edit',
                  icon: <EditOutlined />,
                  label: 'Edit',
                  onClick: () => openRequestEdit(req),
                },
                {
                  key: 'duplicate',
                  icon: <CopyOutlined />,
                  label: 'Duplicate',
                  onClick: () => duplicateRequest(req.id),
                },
                {
                  key: 'move',
                  icon: <SwapOutlined />,
                  label: 'Move to...',
                  onClick: () => openMoveModal(req),
                },
                { type: 'divider' },
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
                style={{ fontSize: 10, minWidth: 36 }}
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
                  fontSize: 10,
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
    },
    [openRequestEdit, duplicateRequest, openMoveModal, deleteRequest, handleSelectRequest],
  );

  // Build tree data from collections and requests
  const treeData = useMemo(() => {
    const rootRequests = requests.get(ROOT_REQUESTS_KEY) ?? [];

    const rootRequestNodes: DataNode[] = rootRequests.map((req) => buildRequestNode(req));

    const buildCollectionTree = (parentId: string | null): DataNode[] => {
      const childCollections = collections.filter(
        (c) => c.parent_id === parentId,
      );

      return childCollections.map((col) => {
        const colRequests = requests.get(col.id) ?? [];
        const childNodes = buildCollectionTree(col.id);

        const requestNodes: DataNode[] = colRequests.map((req) => buildRequestNode(req));

        return {
          key: `col-${col.id}`,
          title: (
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
                      fontSize: 10,
                      maxWidth: 80,
                      fontFamily: 'var(--font-code)',
                    }}
                    title={col.path_prefix}
                  >
                    {col.path_prefix}
                  </span>
                )}
                <div
                  className="collection-item-actions ml-auto flex items-center gap-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Tooltip title="New Request" placement="top" mouseEnterDelay={0.5}>
                    <Button
                      size="small"
                      type="text"
                      icon={<PlusOutlined style={{ fontSize: 10 }} />}
                      style={{ width: 22, height: 22, minWidth: 22, padding: 0 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        openRequestCreate(col.id);
                      }}
                    />
                  </Tooltip>
                  <Tooltip title="New Sub-collection" placement="top" mouseEnterDelay={0.5}>
                    <Button
                      size="small"
                      type="text"
                      icon={<FolderOutlined style={{ fontSize: 10 }} />}
                      style={{ width: 22, height: 22, minWidth: 22, padding: 0 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        openCollectionCreate(col.id);
                      }}
                    />
                  </Tooltip>
                  <Tooltip title="Settings" placement="top" mouseEnterDelay={0.5}>
                    <Button
                      size="small"
                      type="text"
                      icon={<SettingOutlined style={{ fontSize: 10 }} />}
                      style={{ width: 22, height: 22, minWidth: 22, padding: 0 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        openCollectionEdit(col.id);
                      }}
                    />
                  </Tooltip>
                  <Tooltip title="Delete" placement="top" mouseEnterDelay={0.5}>
                    <Button
                      size="small"
                      type="text"
                      danger
                      icon={<DeleteOutlined style={{ fontSize: 10 }} />}
                      style={{ width: 22, height: 22, minWidth: 22, padding: 0 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteCollection(col.id);
                      }}
                    />
                  </Tooltip>
                </div>
                {!col.path_prefix && (
                  <span
                    className="collection-item-version ml-auto"
                    style={{
                      color: 'var(--text-tertiary)',
                      fontFamily: 'var(--font-code)',
                      fontSize: 10,
                    }}
                  >
                    v{col.version}
                  </span>
                )}
              </span>
          ),
          icon: <FolderOutlined />,
          children: [...childNodes, ...requestNodes],
        };
      });
    };

    return [...rootRequestNodes, ...buildCollectionTree(null)];
  }, [
    collections,
    requests,
    buildRequestNode,
    openRequestCreate,
    openCollectionCreate,
    openCollectionEdit,
    deleteCollection,
  ]);

  return (
    <>
      <div className="flex h-full flex-col">
        {/* Liquid Glass header — floats above scrolling collection tree */}
        <div className="glass-header flex items-center justify-between p-3">
          <span
            className="text-xs font-bold uppercase tracking-wider"
            style={{ fontFamily: 'var(--font-ui)', color: 'var(--text-secondary)' }}
          >
            Collections
          </span>
          <div className="flex items-center gap-1">
            <Tooltip title="History" placement="top" mouseEnterDelay={0.5}>
              <Button
                size="small"
                type="text"
                icon={<HistoryOutlined />}
                onClick={() => setHistoryOpen(true)}
              />
            </Tooltip>
            <Button
              size="small"
              icon={<PlusOutlined />}
              onClick={() => openCollectionCreate(null)}
            />
          </div>
        </div>

        {/* Glass scroll area with edge fade effects */}
        <div
          className="glass-scroll-area glass-tree flex-1 p-2"
          onContextMenu={(e) => e.preventDefault()}
        >
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

        {/* Liquid Glass footer — action bar (always visible when project is active) */}
        <div className="glass-footer p-2">
          <Button
            size="small"
            type="dashed"
            block
            icon={<PlusOutlined />}
            onClick={() => {
              if (selectedCollectionId) {
                openRequestCreate(selectedCollectionId);
              } else if (activeProjectId) {
                // Create root request
                setReqFormMode('create');
                setReqFormRequestId(null);
                setReqFormCollectionId(null);
                setReqFormOpen(true);
              }
            }}
          >
            New Request
          </Button>
        </div>
      </div>

      <CollectionFormModal
        open={collFormOpen}
        mode={collFormMode}
        initialName={collFormCollection?.name}
        initialPathPrefix={collFormCollection?.path_prefix ?? ''}
        initialDescription={collFormCollection?.description ?? ''}
        initialSharedHeaders={collFormSharedHeaders}
        onClose={handleCloseCollForm}
        onSave={handleSaveCollForm}
      />

      <RequestFormModal
        open={reqFormOpen}
        mode={reqFormMode}
        initialName={reqFormRequest?.name}
        initialMethod={reqFormConfig?.method}
        initialUrl={reqFormConfig?.url}
        onClose={handleCloseReqForm}
        onSave={handleSaveReqForm}
      />

      <ProjectHistoryModal
        open={historyOpen}
        onClose={handleCloseHistory}
      />

      <MoveRequestModal
        open={moveModalOpen}
        request={moveRequest}
        onClose={handleCloseMoveModal}
        onEmptyCollection={handleEmptyCollection}
      />

    </>
  );
}
