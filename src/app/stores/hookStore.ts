import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { EnvHook, EnvHookTarget } from '@/app/types';

interface HookState {
  hooks: EnvHook[];
  loading: boolean;
  loadHooks: (environmentId: string) => Promise<void>;
  createHook: (input: {
    environment_id: string;
    source_request_id: string;
    response_location: string;
    selector: string;
    target_variable_ids: string[];
    value_template?: string;
    expires_in?: number | null;
    array_strategy?: string;
  }) => Promise<EnvHook>;
  updateHook: (input: {
    id: string;
    source_request_id?: string;
    response_location?: string;
    selector?: string;
    value_template?: string;
    expires_in?: number | null;
    array_strategy?: string;
    enabled?: boolean;
    target_variable_ids?: string[];
  }) => Promise<EnvHook>;
  deleteHook: (id: string) => Promise<void>;
  loadHookTargets: (hookId: string) => Promise<EnvHookTarget[]>;
}

export const useHookStore = create<HookState>((set) => ({
  hooks: [],
  loading: false,

  loadHooks: async (environmentId) => {
    set({ loading: true });
    try {
      const hooks = await invoke<EnvHook[]>('list_env_hooks', {
        environmentId,
      });
      set({ hooks, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  createHook: async (input) => {
    const hook = await invoke<EnvHook>('create_env_hook', { input });
    set((state) => ({ hooks: [hook, ...state.hooks] }));
    return hook;
  },

  updateHook: async (input) => {
    const hook = await invoke<EnvHook>('update_env_hook', { input });
    set((state) => ({
      hooks: state.hooks.map((h) => (h.id === hook.id ? hook : h)),
    }));
    return hook;
  },

  deleteHook: async (id) => {
    await invoke('delete_env_hook', { id });
    set((state) => ({ hooks: state.hooks.filter((h) => h.id !== id) }));
  },

  loadHookTargets: async (hookId) => {
    return invoke<EnvHookTarget[]>('list_env_hook_targets', { hookId });
  },
}));
