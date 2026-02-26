'use client';

import { Modal, Button, Space } from 'antd';
import { WarningOutlined, GlobalOutlined, SettingOutlined } from '@ant-design/icons';
import { useProjectStore } from '../stores/projectStore';
import { useCollectionStore } from '../stores/collectionStore';

interface ConfigValidationModalProps {
  open: boolean;
  onClose: () => void;
  missingHost: boolean;
  activeRequestId: string | null;
}

export function ConfigValidationModal({
  open,
  onClose,
  missingHost,
  activeRequestId,
}: ConfigValidationModalProps) {
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const setSettingsProjectId = useProjectStore((s) => s.setSettingsProjectId);
  const getCollectionForRequest = useCollectionStore((s) => s.getCollectionForRequest);
  const setSettingsDrawerCollectionId = useCollectionStore(
    (s) => s.setSettingsDrawerCollectionId,
  );

  const handleOpenEnvironmentSettings = () => {
    if (activeProjectId) {
      setSettingsProjectId(activeProjectId);
    }
    onClose();
  };

  const collection = activeRequestId
    ? getCollectionForRequest(activeRequestId)
    : undefined;

  const handleOpenCollectionSettings = () => {
    if (collection) {
      setSettingsDrawerCollectionId(collection.id);
    }
    onClose();
  };

  return (
    <Modal
      title={
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <WarningOutlined style={{ color: 'var(--warning)' }} />
          Configuration Required
        </span>
      }
      open={open}
      onCancel={onClose}
      footer={null}
      width={460}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '8px 0' }}>
        <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: 13 }}>
          Cannot send request — the full URL cannot be resolved without an environment host.
        </p>

        {missingHost && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
              backgroundColor: 'var(--bg-tertiary)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border)',
            }}
          >
            <Space>
              <GlobalOutlined style={{ color: 'var(--warning)' }} />
              <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                No environment host configured
              </span>
            </Space>
            <Button
              size="small"
              type="primary"
              icon={<SettingOutlined />}
              onClick={handleOpenEnvironmentSettings}
            >
              Configure Environment
            </Button>
          </div>
        )}

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            backgroundColor: 'var(--bg-tertiary)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border)',
          }}
        >
          <Space>
            <SettingOutlined style={{ color: 'var(--text-tertiary)' }} />
            <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>
              Collection settings
            </span>
          </Space>
          <Button
            size="small"
            icon={<SettingOutlined />}
            onClick={handleOpenCollectionSettings}
            disabled={!collection}
          >
            Collection Settings
          </Button>
        </div>

        <p
          style={{
            color: 'var(--text-tertiary)',
            margin: 0,
            fontSize: 11,
            fontFamily: 'var(--font-code)',
            padding: '8px 12px',
            backgroundColor: 'var(--bg-tertiary)',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          full URL = environment host + collection prefix + request path
        </p>
      </div>
    </Modal>
  );
}
