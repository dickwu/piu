import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { OpenApiSpecResult } from '@/app/types';

interface SpecStore {
  spec: Record<string, unknown> | null;
  loading: boolean;
  error: string | null;
  generatedAt: string | null;

  fetchSpec: (projectId: string) => Promise<void>;
  generateSpec: (projectId: string) => Promise<void>;
  clearSpec: () => void;
}

export const useSpecStore = create<SpecStore>((set) => ({
  spec: null,
  loading: false,
  error: null,
  generatedAt: null,

  fetchSpec: async (projectId: string) => {
    set({ loading: true, error: null });
    try {
      const specJson = await invoke<string | null>('get_openapi_spec', { projectId });
      if (specJson) {
        const parsed = JSON.parse(specJson) as Record<string, unknown>;
        set({ spec: parsed, loading: false });
      } else {
        set({ spec: null, loading: false });
      }
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
        loading: false,
      });
    }
  },

  generateSpec: async (projectId: string) => {
    set({ loading: true, error: null });
    try {
      const result = await invoke<OpenApiSpecResult>('generate_openapi_spec', { projectId });
      const parsed = JSON.parse(result.spec_json) as Record<string, unknown>;
      set({
        spec: parsed,
        generatedAt: result.generated_at,
        loading: false,
      });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
        loading: false,
      });
    }
  },

  clearSpec: () => set({ spec: null, generatedAt: null, error: null }),
}));
