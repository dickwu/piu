'use client';

import { useCallback } from 'react';
import { Modal, App } from 'antd';
import { useRequestEditorStore } from '../stores/requestStore';
import { RequestEditor } from './RequestEditor';
import { ResponseViewer } from './ResponseViewer';

export function RequestDetailModal() {
  const requestModalOpen = useRequestEditorStore((s) => s.requestModalOpen);
  const closeRequestModal = useRequestEditorStore((s) => s.closeRequestModal);
  const isDirty = useRequestEditorStore((s) => s.isDirty);
  const { modal: antModal } = App.useApp();

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
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ minHeight: 280, maxHeight: '50%', overflow: 'auto', borderBottom: '1px solid var(--border)' }}>
          <RequestEditor />
        </div>
        <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
          <ResponseViewer />
        </div>
      </div>
    </Modal>
  );
}
