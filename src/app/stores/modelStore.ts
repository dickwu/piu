import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { DataModel } from '@/app/types';

interface ModelStore {
  models: DataModel[];
  loading: boolean;

  loadModels: (projectId: string) => Promise<void>;
  createModel: (
    projectId: string,
    name: string,
    description?: string,
    fields?: string,
    parentModelId?: string,
    mixinModelIds?: string,
  ) => Promise<DataModel>;
  updateModel: (
    id: string,
    updates: {
      name?: string;
      description?: string | null;
      fields?: string;
      sort_order?: number;
      parent_model_id?: string | null;
      mixin_model_ids?: string;
    },
  ) => Promise<DataModel>;
  deleteModel: (id: string, projectId: string) => Promise<void>;
  generateJson: (modelId: string) => Promise<string>;
}

export const useModelStore = create<ModelStore>((set, get) => ({
  models: [],
  loading: false,

  loadModels: async (projectId: string) => {
    set({ loading: true });
    try {
      const models = await invoke<DataModel[]>('list_models', {
        projectId,
      });
      set({ models });
    } finally {
      set({ loading: false });
    }
  },

  createModel: async (projectId, name, description, fields, parentModelId, mixinModelIds) => {
    const model = await invoke<DataModel>('create_model', {
      input: {
        project_id: projectId,
        name,
        description: description ?? null,
        fields: fields ?? null,
        parent_model_id: parentModelId ?? null,
        mixin_model_ids: mixinModelIds ?? null,
      },
    });
    await get().loadModels(projectId);
    return model;
  },

  updateModel: async (id, updates) => {
    const model = await invoke<DataModel>('update_model', {
      input: {
        id,
        name: updates.name ?? null,
        description:
          updates.description === undefined ? null : updates.description,
        fields: updates.fields ?? null,
        sort_order: updates.sort_order ?? null,
        parent_model_id:
          updates.parent_model_id === undefined ? null : updates.parent_model_id,
        mixin_model_ids: updates.mixin_model_ids ?? null,
      },
    });
    if (model.project_id) {
      await get().loadModels(model.project_id);
    }
    return model;
  },

  deleteModel: async (id: string, projectId: string) => {
    await invoke('delete_model', { id });
    await get().loadModels(projectId);
  },

  generateJson: async (modelId: string) => {
    return invoke<string>('generate_json_from_model', { modelId });
  },
}));
