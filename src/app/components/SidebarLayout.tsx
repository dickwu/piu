'use client';

import { ProjectList } from './ProjectList';
import { Sidebar } from './Sidebar';

export function SidebarLayout() {
  return (
    <div className="flex h-full flex-col">
      <ProjectList />
      <div style={{ borderBottom: '1px solid var(--border)', flexShrink: 0 }} />
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <Sidebar />
      </div>
    </div>
  );
}
