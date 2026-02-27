'use client';

import { useEffect } from 'react';
import { ProjectList } from './components/ProjectList';
import { Sidebar } from './components/Sidebar';
import { RequestEditor } from './components/RequestEditor';
import { ResponseViewer } from './components/ResponseViewer';
import { StatusBar } from './components/StatusBar';
import { useCollectionStore } from './stores/collectionStore';
import { useEnvironmentStore } from './stores/environmentStore';
import { useProjectStore } from './stores/projectStore';
import { useResponseStore } from './stores/responseStore';
import { useModelStore } from './stores/modelStore';
import type { UnlistenFn } from '@tauri-apps/api/event';

export default function Home() {
  const loadCollections = useCollectionStore((s) => s.loadCollections);
  const loadEnvironments = useEnvironmentStore((s) => s.loadEnvironments);
  const loadActiveEnvironment = useEnvironmentStore((s) => s.loadActiveEnvironment);
  const { loadProjects, getActiveProject, activeProjectId } = useProjectStore();
  const initListener = useResponseStore((s) => s.initListener);
  const loadModels = useModelStore((s) => s.loadModels);

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
    }
  }, [activeProjectId, loadCollections, loadEnvironments, loadActiveEnvironment, loadModels]);

  return (
    <div className="app-shell animate-fade-in">
      {/* Three-panel layout with Apple-style spacing */}
      <div className="panel-layout">
        <aside className="panel-sidebar panel-sidebar-left">
          <ProjectList />
        </aside>

        <main className="panel-content">
          <RequestEditor />
          <ResponseViewer />
        </main>

        <aside className="panel-sidebar panel-sidebar-right">
          <Sidebar />
        </aside>
      </div>

      <footer className="app-footer">
        <StatusBar />
      </footer>
    </div>
  );
}
