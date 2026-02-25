import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { HttpResponse } from '@/app/types';

interface ResponseStore {
  response: HttpResponse | null;
  loading: boolean;
  error: string | null;

  executeRequest: (
    config: string,
    envVariables?: Record<string, string>,
  ) => Promise<void>;
  clear: () => void;
}

export const useResponseStore = create<ResponseStore>((set) => ({
  response: null,
  loading: false,
  error: null,

  executeRequest: async (config, envVariables) => {
    set({ loading: true, error: null });
    try {
      const response = await invoke<HttpResponse>('execute_request', {
        input: {
          config,
          env_variables: envVariables ?? null,
        },
      });
      set({ response, loading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
        loading: false,
      });
    }
  },

  clear: () => set({ response: null, error: null }),
}));
