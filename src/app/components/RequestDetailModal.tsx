'use client';

import { useCallback, useState } from 'react';
import { Modal, App, Tabs } from 'antd';
import { useRequestEditorStore } from '../stores/requestStore';
import { useSpecStore } from '../stores/specStore';
import { RequestEditor } from './RequestEditor';
import { ResponseViewer } from './ResponseViewer';
import { EndpointDetail } from './api-docs/EndpointDetail';

export function RequestDetailModal() {
  const [activeTab, setActiveTab] = useState('edit');
  const requestModalOpen = useRequestEditorStore((s) => s.requestModalOpen);
  const closeRequestModal = useRequestEditorStore((s) => s.closeRequestModal);
  const isDirty = useRequestEditorStore((s) => s.isDirty);
  const { modal: antModal } = App.useApp();
  const spec = useSpecStore((s) => s.spec);

  const handleCancel = useCallback(() => {
    if (isDirty) {
      antModal.confirm({
        title: 'Unsaved changes',
        content: 'You have unsaved changes. Discard them?',
        okText: 'Discard',
        okButtonProps: { danger: true },
        onOk: closeRequestModal,
      });
    } else {
      closeRequestModal();
    }
  }, [isDirty, closeRequestModal, antModal]);

  return (
    <Modal
      open={requestModalOpen}
      onCancel={handleCancel}
      footer={null}
      destroyOnHidden
      width="90vw"
      style={{ maxWidth: 1200, top: 40 }}
      styles={{
        body: {
          height: 'calc(80vh - 55px)',
          padding: 0,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        size="small"
        style={{ height: '100%' }}
        items={[
          {
            key: 'edit',
            label: 'Edit',
            children: (
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                <div style={{ minHeight: 280, maxHeight: '50%', overflow: 'auto', borderBottom: '1px solid var(--border)' }}>
                  <RequestEditor />
                </div>
                <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
                  <ResponseViewer />
                </div>
              </div>
            ),
          },
          {
            key: 'docs',
            label: 'Docs',
            children: spec ? (
              <div style={{ height: '100%', overflow: 'auto' }}>
                <EndpointDetail spec={spec} path="" method="" />
              </div>
            ) : (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--ant-color-text-tertiary)' }}>
                Generate API docs to see this endpoint&apos;s documentation.
              </div>
            ),
          },
        ]}
      />
    </Modal>
  );
}
