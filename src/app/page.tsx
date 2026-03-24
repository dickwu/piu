'use client';

import { useEffect, useState } from 'react';
import { Segmented } from 'antd';
import { ProjectList } from './components/ProjectList';
import { Sidebar } from './components/Sidebar';
import { GraphCenterPanel } from './components/GraphCenterPanel';
import { RequestDetailModal } from './components/RequestDetailModal';
import { StatusBar } from './components/StatusBar';
import { useCollectionStore } from './stores/collectionStore';
import { useEnvironmentStore } from './stores/environmentStore';
import { useProjectStore } from './stores/projectStore';
import { useResponseStore } from './stores/responseStore';
import { useModelStore } from './stores/modelStore';
import { useRequestEditorStore } from './stores/requestStore';
import { ApiDocsPanel } from './components/api-docs/ApiDocsPanel';
import { ArrayPickerModal } from './components/ArrayPickerModal';
import { useSpecStore } from './stores/specStore';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { defaultRequestConfig, type DataChangedEvent } from '@/app/types';

export default function Home() {
  const loadCollections = useCollectionStore((s) => s.loadCollections);
  const loadEnvironments = useEnvironmentStore((s) => s.loadEnvironments);
  const loadActiveEnvironment = useEnvironmentStore((s) => s.loadActiveEnvironment);
  const { loadProjects, getActiveProject, activeProjectId } = useProjectStore();
  const initListener = useResponseStore((s) => s.initListener);
  const loadModels = useModelStore((s) => s.loadModels);
  const [viewMode, setViewMode] = useState<'graph' | 'docs'>('graph');
  const fetchSpec = useSpecStore((s) => s.fetchSpec);

  // Initialize Tauri event listener for request progress
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    initListener().then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [initListener]);

  // Listen for MCP data changes and refresh relevant stores
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    const pendingRefresh = new Set<string>();
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const reconcileActiveRequest = () => {
      const { activeRequestId } = useRequestEditorStore.getState();
      if (!activeRequestId) return;
      const allRequests = useCollectionStore.getState().requests;
      let found = false;
      for (const [, reqs] of allRequests) {
        if (reqs.some((r) => r.id === activeRequestId)) {
          found = true;
          break;
        }
      }
      if (!found) {
        useRequestEditorStore.getState().setActiveRequest(null, defaultRequestConfig());
      }
    };

    const reloadAllRequests = async (projectId: string | null) => {
      const { collections } = useCollectionStore.getState();
      const loads = collections.map((col) => useCollectionStore.getState().loadRequests(col.id));
      if (projectId) {
        loads.push(useCollectionStore.getState().loadRootRequests(projectId));
      }
      await Promise.all(loads);
    };

    let flushing = false;

    const flush = async () => {
      if (flushing) return;
      flushing = true;

      // Snapshot and clear pending set so events arriving mid-flush are not lost
      const snapshot = new Set(pendingRefresh);
      pendingRefresh.clear();

      try {
        if (snapshot.has('project')) {
          await useProjectStore.getState().loadProjects();
          const { projects, activeProjectId: aid } = useProjectStore.getState();
          if (aid && !projects.some((p) => p.id === aid)) {
            if (projects.length > 0) {
              await useProjectStore.getState().setActiveProject(projects[0].id);
            } else {
              useProjectStore.setState({ activeProjectId: null });
            }
            useRequestEditorStore.getState().setActiveRequest(null, defaultRequestConfig());
          }
        }

        // Recompute after potential project reconciliation
        const effectiveProjectId = useProjectStore.getState().activeProjectId;

        if (snapshot.has('collection')) {
          await useCollectionStore.getState().loadCollections(effectiveProjectId ?? undefined);
          if (effectiveProjectId) {
            await useCollectionStore.getState().loadRootRequests(effectiveProjectId);
          }
          await reloadAllRequests(effectiveProjectId);
          reconcileActiveRequest();
        }
        if (snapshot.has('request')) {
          await reloadAllRequests(effectiveProjectId);
          reconcileActiveRequest();
        }
        if (snapshot.has('environment')) {
          await useEnvironmentStore.getState().loadEnvironments(effectiveProjectId ?? undefined);
          if (effectiveProjectId) {
            await useEnvironmentStore.getState().loadActiveEnvironment(effectiveProjectId);
          }
        }
        if (snapshot.has('model')) {
          if (effectiveProjectId) {
            await useModelStore.getState().loadModels(effectiveProjectId);
          }
        }
        if (snapshot.has('spec')) {
          if (effectiveProjectId) {
            await useSpecStore.getState().fetchSpec(effectiveProjectId);
          }
        }
      } finally {
        flushing = false;
        // If new events arrived during flush, schedule another flush
        if (pendingRefresh.size > 0) {
          debounceTimer = setTimeout(flush, 100);
        }
      }
    };

    listen<DataChangedEvent>('data-changed', (event) => {
      const { entity_type, project_id } = event.payload;
      const currentProjectId = useProjectStore.getState().activeProjectId;

      // Skip events for other projects (except project-level changes)
      if (entity_type !== 'project' && project_id && project_id !== currentProjectId) {
        return;
      }

      pendingRefresh.add(entity_type);

      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      if (!flushing) {
        debounceTimer = setTimeout(flush, 100);
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
    };
  }, []);

  // Load projects on mount, then get the active project
  useEffect(() => {
    (async () => {
      await loadProjects();
      await getActiveProject();
    })();
  }, [loadProjects, getActiveProject]);

  // Reload collections and environments whenever active project changes
  useEffect(() => {
    if (activeProjectId === undefined) return;
    loadCollections(activeProjectId ?? undefined);
    loadEnvironments(activeProjectId ?? undefined);
    if (activeProjectId) {
      loadActiveEnvironment(activeProjectId);
      loadModels(activeProjectId);
      useSpecStore.getState().clearSpec();
      fetchSpec(activeProjectId);
    }
  }, [activeProjectId, loadCollections, loadEnvironments, loadActiveEnvironment, loadModels, fetchSpec]);

  return (
    <div className="app-shell animate-fade-in">
      {/* Three-panel layout with Apple-style spacing */}
      <div className="panel-layout">
        <aside className="panel-sidebar panel-sidebar-left">
          <ProjectList />
        </aside>

        <main className="panel-content">
          <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '4px 8px 0' }}>
            <Segmented
              value={viewMode}
              onChange={(v) => setViewMode(v as 'graph' | 'docs')}
              options={[
                { value: 'graph', label: 'Graph' },
                { value: 'docs', label: 'Docs' },
              ]}
              size="small"
            />
          </div>
          {viewMode === 'graph' ? <GraphCenterPanel /> : <ApiDocsPanel />}
        </main>

        <aside className="panel-sidebar panel-sidebar-right">
          <Sidebar />
        </aside>
      </div>

      <RequestDetailModal />
      <ArrayPickerModal />

      <footer className="app-footer">
        <StatusBar />
      </footer>
    </div>
  );
}
