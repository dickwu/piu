import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { Collection, ApiRequest } from '@/app/types';

interface CollectionStore {
  collections: Collection[];
  requests: Map<string, ApiRequest[]>;
  selectedCollectionId: string | null;
  selectedRequestId: string | null;
  loading: boolean;
  settingsDrawerCollectionId: string | null;

  loadCollections: (projectId?: string) => Promise<void>;
  loadRequests: (collectionId: string) => Promise<void>;
  createCollection: (
    name: string,
    parentId?: string,
    projectId?: string,
  ) => Promise<Collection>;
  updateCollection: (
    id: string,
    updates: {
      name?: string;
      parent_id?: string | null;
      sort_order?: number;
      path_prefix?: string | null;
      description?: string | null;
      shared_headers?: string;
    },
  ) => Promise<Collection>;
  deleteCollection: (id: string) => Promise<void>;
  createRequest: (
    collectionId: string,
    name: string,
    config?: string,
  ) => Promise<ApiRequest>;
  updateRequest: (
    id: string,
    updates: {
      name?: string;
      config?: string;
      collection_id?: string;
      sort_order?: number;
    },
  ) => Promise<ApiRequest>;
  deleteRequest: (id: string) => Promise<void>;
  duplicateRequest: (id: string) => Promise<ApiRequest>;
  getCollectionForRequest: (requestId: string) => Collection | undefined;
  setSelectedCollection: (id: string | null) => void;
  setSelectedRequest: (id: string | null) => void;
  setSettingsDrawerCollectionId: (id: string | null) => void;
}

export const useCollectionStore = create<CollectionStore>((set, get) => ({
  collections: [],
  requests: new Map(),
  selectedCollectionId: null,
  selectedRequestId: null,
  loading: false,
  settingsDrawerCollectionId: null,

  loadCollections: async (projectId?: string) => {
    set({ loading: true });
    try {
      const collections = await invoke<Collection[]>('list_collections', {
        projectId: projectId ?? null,
      });
      set({ collections });
    } finally {
      set({ loading: false });
    }
  },

  loadRequests: async (collectionId: string) => {
    const requests = await invoke<ApiRequest[]>('list_requests', {
      collectionId,
    });
    set((state) => {
      const newRequests = new Map(state.requests);
      newRequests.set(collectionId, requests);
      return { requests: newRequests };
    });
  },

  createCollection: async (
    name: string,
    parentId?: string,
    projectId?: string,
  ) => {
    const collection = await invoke<Collection>('create_collection', {
      input: {
        name,
        parent_id: parentId ?? null,
        project_id: projectId ?? null,
      },
    });
    await get().loadCollections(projectId);
    return collection;
  },

  updateCollection: async (id, updates) => {
    const collection = await invoke<Collection>('update_collection', {
      input: { id, ...updates },
    });
    await get().loadCollections(collection.project_id ?? undefined);
    return collection;
  },

  deleteCollection: async (id: string) => {
    await invoke('delete_collection', { id });
    const { selectedCollectionId } = get();
    if (selectedCollectionId === id) {
      set({ selectedCollectionId: null, selectedRequestId: null });
    }
    // Reload will be triggered by the parent component with the current project
  },

  createRequest: async (collectionId, name, config) => {
    const request = await invoke<ApiRequest>('create_request', {
      input: { collection_id: collectionId, name, config: config ?? null },
    });
    await get().loadRequests(collectionId);
    return request;
  },

  updateRequest: async (id, updates) => {
    const request = await invoke<ApiRequest>('update_request', {
      input: { id, ...updates },
    });
    if (request.collection_id) {
      await get().loadRequests(request.collection_id);
    }
    return request;
  },

  deleteRequest: async (id: string) => {
    const { selectedRequestId, selectedCollectionId } = get();
    await invoke('delete_request', { id });
    if (selectedRequestId === id) {
      set({ selectedRequestId: null });
    }
    if (selectedCollectionId) {
      await get().loadRequests(selectedCollectionId);
    }
  },

  duplicateRequest: async (id: string) => {
    const request = await invoke<ApiRequest>('duplicate_request', { id });
    if (request.collection_id) {
      await get().loadRequests(request.collection_id);
    }
    return request;
  },

  getCollectionForRequest: (requestId: string) => {
    const { requests, collections } = get();
    for (const [collectionId, reqs] of requests.entries()) {
      if (reqs.some((r) => r.id === requestId)) {
        return collections.find((c) => c.id === collectionId);
      }
    }
    return undefined;
  },

  setSelectedCollection: (id) => set({ selectedCollectionId: id }),
  setSelectedRequest: (id) => set({ selectedRequestId: id }),
  setSettingsDrawerCollectionId: (id) => set({ settingsDrawerCollectionId: id }),
}));
