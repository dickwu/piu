import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { SyncServerStatus, SyncResult } from '@/app/types';

interface SyncStore {
  serverStatus: SyncServerStatus;
  connecting: boolean;
  lastResult: SyncResult | null;

  refreshServerStatus: () => Promise<void>;
  startServer: (port: number, joinKey: string, projectId: string) => Promise<void>;
  stopServer: () => Promise<void>;
  connect: (
    host: string,
    port: number,
    joinKey: string,
    projectId: string,
  ) => Promise<SyncResult>;
}

export const useSyncStore = create<SyncStore>((set) => ({
  serverStatus: { running: false },
  connecting: false,
  lastResult: null,

  refreshServerStatus: async () => {
    try {
      const status = await invoke<SyncServerStatus>('get_sync_server_status');
      set({ serverStatus: status });
    } catch {
      set({ serverStatus: { running: false } });
    }
  },

  startServer: async (port: number, joinKey: string, projectId: string) => {
    await invoke<string>('start_sync_server', { port, joinKey, projectId });
    const status = await invoke<SyncServerStatus>('get_sync_server_status');
    set({ serverStatus: status });
  },

  stopServer: async () => {
    await invoke('stop_sync_server');
    set({ serverStatus: { running: false } });
  },

  connect: async (
    host: string,
    port: number,
    joinKey: string,
    projectId: string,
  ) => {
    set({ connecting: true });
    try {
      const result = await invoke<SyncResult>('sync_connect', {
        input: { host, port, joinKey, projectId },
      });
      set({ lastResult: result, connecting: false });
      return result;
    } catch (error) {
      set({ connecting: false });
      throw error;
    }
  },
}));
