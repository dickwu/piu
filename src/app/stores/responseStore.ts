import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  HttpResponse,
  ExecutionPhase,
  ExecutionProgress,
} from '@/app/types';

interface ResponseStore {
  response: HttpResponse | null;
  loading: boolean;
  error: string | null;
  phase: ExecutionPhase | null;
  executionId: string | null;
  resolvedUrl: string | null;

  executeRequest: (requestId: string) => Promise<void>;
  clear: () => void;
  initListener: () => Promise<UnlistenFn>;
}

export const useResponseStore = create<ResponseStore>((set, get) => ({
  response: null,
  loading: false,
  error: null,
  phase: null,
  executionId: null,
  resolvedUrl: null,

  executeRequest: async (requestId: string) => {
    const executionId = crypto.randomUUID();
    set({
      loading: true,
      error: null,
      phase: 'resolving',
      executionId,
      response: null,
      resolvedUrl: null,
    });
    try {
      await invoke('execute_request_by_id', { requestId, executionId });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
        loading: false,
        phase: 'error',
      });
    }
  },

  clear: () =>
    set({
      response: null,
      error: null,
      phase: null,
      executionId: null,
      resolvedUrl: null,
    }),

  initListener: async () => {
    return await listen<ExecutionProgress>(
      'request-progress',
      (event) => {
        const { payload } = event;
        const state = get();
        if (payload.execution_id !== state.executionId) return;

        switch (payload.phase) {
          case 'resolving':
            set({ phase: 'resolving' });
            break;
          case 'connecting':
            set({ phase: 'connecting', resolvedUrl: payload.url ?? null });
            break;
          case 'sending':
            set({ phase: 'sending' });
            break;
          case 'complete':
            set({
              response: payload.response ?? null,
              loading: false,
              phase: 'complete',
            });
            break;
          case 'error':
            set({
              error: payload.error ?? 'Unknown error',
              loading: false,
              phase: 'error',
            });
            break;
        }
      },
    );
  },
}));
