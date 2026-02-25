import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { Environment, EnvVariable } from '@/app/types';

interface EnvironmentStore {
  environments: Environment[];
  activeEnvironment: Environment | null;
  variables: Map<string, EnvVariable[]>;
  loading: boolean;

  loadEnvironments: () => Promise<void>;
  loadActiveEnvironment: () => Promise<void>;
  loadVariables: (environmentId: string) => Promise<void>;
  createEnvironment: (name: string) => Promise<Environment>;
  updateEnvironment: (id: string, name: string) => Promise<Environment>;
  deleteEnvironment: (id: string) => Promise<void>;
  setActiveEnvironment: (id: string) => Promise<void>;
  setVariables: (
    environmentId: string,
    variables: { id: string; key: string; value: string; enabled: boolean }[],
  ) => Promise<void>;
  getResolvedVariables: () => Record<string, string>;
}

export const useEnvironmentStore = create<EnvironmentStore>((set, get) => ({
  environments: [],
  activeEnvironment: null,
  variables: new Map(),
  loading: false,

  loadEnvironments: async () => {
    const environments = await invoke<Environment[]>('list_environments');
    set({ environments });
  },

  loadActiveEnvironment: async () => {
    const env = await invoke<Environment | null>('get_active_environment');
    set({ activeEnvironment: env });
    if (env) {
      await get().loadVariables(env.id);
    }
  },

  loadVariables: async (environmentId: string) => {
    const vars = await invoke<EnvVariable[]>('list_env_variables', {
      environmentId,
    });
    set((state) => {
      const newVars = new Map(state.variables);
      newVars.set(environmentId, vars);
      return { variables: newVars };
    });
  },

  createEnvironment: async (name: string) => {
    const env = await invoke<Environment>('create_environment', {
      input: { name },
    });
    await get().loadEnvironments();
    return env;
  },

  updateEnvironment: async (id: string, name: string) => {
    const env = await invoke<Environment>('update_environment', {
      input: { id, name },
    });
    await get().loadEnvironments();
    return env;
  },

  deleteEnvironment: async (id: string) => {
    await invoke('delete_environment', { id });
    const { activeEnvironment } = get();
    if (activeEnvironment?.id === id) {
      set({ activeEnvironment: null });
    }
    await get().loadEnvironments();
  },

  setActiveEnvironment: async (id: string) => {
    await invoke('set_active_environment', { id });
    await get().loadActiveEnvironment();
  },

  setVariables: async (environmentId, variables) => {
    await invoke('set_env_variables', {
      input: { environment_id: environmentId, variables },
    });
    await get().loadVariables(environmentId);
  },

  getResolvedVariables: () => {
    const { activeEnvironment, variables } = get();
    if (!activeEnvironment) return {};

    const envVars = variables.get(activeEnvironment.id) ?? [];
    const resolved: Record<string, string> = {};
    for (const v of envVars) {
      if (v.enabled) {
        resolved[v.key] = v.value;
      }
    }
    return resolved;
  },
}));
