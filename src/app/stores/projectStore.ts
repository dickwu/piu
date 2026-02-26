import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { Project } from '@/app/types';

interface ProjectStore {
  projects: Project[];
  activeProjectId: string | null;
  loading: boolean;
  settingsProjectId: string | null;

  setSettingsProjectId: (id: string | null) => void;
  loadProjects: () => Promise<void>;
  getActiveProject: () => Promise<void>;
  setActiveProject: (id: string) => Promise<void>;
  createProject: (
    name: string,
    description?: string,
  ) => Promise<Project>;
  updateProject: (
    id: string,
    updates: {
      name?: string;
      description?: string | null;
      sort_order?: number;
    },
  ) => Promise<Project>;
  deleteProject: (id: string) => Promise<void>;
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  activeProjectId: null,
  loading: false,
  settingsProjectId: null,

  setSettingsProjectId: (id) => set({ settingsProjectId: id }),

  loadProjects: async () => {
    set({ loading: true });
    try {
      const projects = await invoke<Project[]>('list_projects');
      set({ projects });
    } finally {
      set({ loading: false });
    }
  },

  getActiveProject: async () => {
    const id = await invoke<string | null>('get_active_project');
    set({ activeProjectId: id });
  },

  setActiveProject: async (id: string) => {
    await invoke('set_active_project', { id });
    set({ activeProjectId: id });
  },

  createProject: async (name, description) => {
    const project = await invoke<Project>('create_project', {
      input: { name, description: description ?? null },
    });
    await get().loadProjects();
    // Auto-select new project if it's the first one
    if (!get().activeProjectId) {
      await get().setActiveProject(project.id);
    }
    return project;
  },

  updateProject: async (id, updates) => {
    const project = await invoke<Project>('update_project', {
      input: { id, ...updates },
    });
    await get().loadProjects();
    return project;
  },

  deleteProject: async (id: string) => {
    await invoke('delete_project', { id });
    const { activeProjectId, projects } = get();
    if (activeProjectId === id) {
      // Switch to another project if available
      const remaining = projects.filter((p) => p.id !== id);
      if (remaining.length > 0) {
        await get().setActiveProject(remaining[0].id);
      } else {
        set({ activeProjectId: null });
      }
    }
    await get().loadProjects();
  },
}));
