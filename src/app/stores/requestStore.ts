import { create } from 'zustand';
import type { RequestConfig } from '@/app/types';
import { defaultRequestConfig } from '@/app/types';

interface RequestEditorStore {
  activeRequestId: string | null;
  config: RequestConfig;
  activeTab: 'params' | 'headers' | 'body' | 'auth' | 'info';
  isDirty: boolean;
  requestModalOpen: boolean;

  setActiveRequest: (id: string | null, config: RequestConfig) => void;
  updateConfig: (updates: Partial<RequestConfig>) => void;
  setActiveTab: (tab: 'params' | 'headers' | 'body' | 'auth' | 'info') => void;
  resetDirty: () => void;
  openRequestModal: () => void;
  closeRequestModal: () => void;
}

export const useRequestEditorStore = create<RequestEditorStore>((set) => ({
  activeRequestId: null,
  config: defaultRequestConfig(),
  activeTab: 'params',
  isDirty: false,
  requestModalOpen: false,

  setActiveRequest: (id, config) =>
    set({
      activeRequestId: id,
      config,
      isDirty: false,
    }),

  updateConfig: (updates) =>
    set((state) => ({
      config: { ...state.config, ...updates },
      isDirty: true,
    })),

  setActiveTab: (tab) => set({ activeTab: tab }),
  resetDirty: () => set({ isDirty: false }),
  openRequestModal: () => set({ requestModalOpen: true }),
  closeRequestModal: () => set({ requestModalOpen: false }),
}));
