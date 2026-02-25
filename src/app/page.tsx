'use client';

import { useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { RequestEditor } from './components/RequestEditor';
import { ResponseViewer } from './components/ResponseViewer';
import { EnvironmentBar } from './components/EnvironmentBar';
import { useCollectionStore } from './stores/collectionStore';
import { useEnvironmentStore } from './stores/environmentStore';

export default function Home() {
  const loadCollections = useCollectionStore((s) => s.loadCollections);
  const loadEnvironments = useEnvironmentStore((s) => s.loadEnvironments);
  const loadActiveEnvironment = useEnvironmentStore(
    (s) => s.loadActiveEnvironment,
  );

  useEffect(() => {
    loadCollections();
    loadEnvironments();
    loadActiveEnvironment();
  }, [loadCollections, loadEnvironments, loadActiveEnvironment]);

  return (
    <div className="flex h-screen flex-col">
      <EnvironmentBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <RequestEditor />
          <ResponseViewer />
        </div>
      </div>
    </div>
  );
}
