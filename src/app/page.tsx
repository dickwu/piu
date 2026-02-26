'use client';

import { useEffect } from 'react';
import { Layout } from 'antd';
import { ProjectList } from './components/ProjectList';
import { Sidebar } from './components/Sidebar';
import { RequestEditor } from './components/RequestEditor';
import { ResponseViewer } from './components/ResponseViewer';
import { StatusBar } from './components/StatusBar';
import { useCollectionStore } from './stores/collectionStore';
import { useEnvironmentStore } from './stores/environmentStore';
import { useProjectStore } from './stores/projectStore';
import { useResponseStore } from './stores/responseStore';
import type { UnlistenFn } from '@tauri-apps/api/event';

const { Sider, Content, Footer } = Layout;

export default function Home() {
  const loadCollections = useCollectionStore((s) => s.loadCollections);
  const loadEnvironments = useEnvironmentStore((s) => s.loadEnvironments);
  const loadActiveEnvironment = useEnvironmentStore((s) => s.loadActiveEnvironment);
  const { loadProjects, getActiveProject, activeProjectId } = useProjectStore();
  const initListener = useResponseStore((s) => s.initListener);

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
    }
  }, [activeProjectId, loadCollections, loadEnvironments, loadActiveEnvironment]);

  return (
    <Layout className="animate-fade-in" style={{ height: '100vh' }}>
      <Layout hasSider>
        <Sider width={220} style={{ overflow: 'hidden' }}>
          <ProjectList />
        </Sider>
        <Content style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <RequestEditor />
          <ResponseViewer />
        </Content>
        <Sider width={256} style={{ overflow: 'hidden' }}>
          <Sidebar />
        </Sider>
      </Layout>
      <Footer>
        <StatusBar />
      </Footer>
    </Layout>
  );
}
