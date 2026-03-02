import { create } from 'zustand';
import type { UpdateStatus } from '@/app/types';

interface UpdateStore {
  status: UpdateStatus;
  currentVersion: string;

  setCurrentVersion: (version: string) => void;
  checkForUpdate: () => Promise<void>;
  downloadAndInstall: () => Promise<void>;
}

// Hold the update object between check and download
let pendingUpdate: Awaited<
  ReturnType<typeof import('@tauri-apps/plugin-updater').check>
> = null;

export const useUpdateStore = create<UpdateStore>((set, get) => ({
  status: { state: 'idle' },
  currentVersion: '',

  setCurrentVersion: (version: string) => set({ currentVersion: version }),

  checkForUpdate: async () => {
    set({ status: { state: 'checking' } });
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      if (!update) {
        set({ status: { state: 'up_to_date' } });
        return;
      }
      pendingUpdate = update;
      set({ status: { state: 'available', version: update.version } });
    } catch (error) {
      const msg = error instanceof Error ? error.message : `${error}`;
      set({ status: { state: 'error', message: msg } });
    }
  },

  downloadAndInstall: async () => {
    if (!pendingUpdate) return;
    const update = pendingUpdate;
    const version = update.version;

    set({ status: { state: 'downloading', version, progress: 0 } });

    try {
      let contentLength = 0;
      let downloaded = 0;

      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            contentLength = event.data.contentLength ?? 0;
            break;
          case 'Progress':
            downloaded += event.data.chunkLength;
            if (contentLength > 0) {
              const progress = Math.round((downloaded / contentLength) * 100);
              set({ status: { state: 'downloading', version, progress } });
            }
            break;
          case 'Finished':
            break;
        }
      });

      pendingUpdate = null;
      set({ status: { state: 'ready', version } });
    } catch {
      set({
        status: { state: 'error', message: 'Failed to download update' },
      });
    }
  },
}));
