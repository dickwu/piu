'use client';

import { Modal, List, Tag, Empty } from 'antd';
import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { ChangelogEntry } from '../types';

interface ChangelogModalProps {
  open: boolean;
  onClose: () => void;
}

const TYPE_COLORS: Record<string, string> = {
  project: '#f97316',
  collection: '#60a5fa',
  request: '#34d399',
  environment: '#c084fc',
};

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

export function ChangelogModal({ open, onClose }: ChangelogModalProps) {
  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const loadChangelog = useCallback(async () => {
    setLoading(true);
    try {
      const result = await invoke<ChangelogEntry[]>('get_changelog', {
        input: { limit: 100, offset: 0 },
      });
      setEntries(result);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      loadChangelog();
    }
  }, [open, loadChangelog]);

  return (
    <Modal
      title="Changelog"
      open={open}
      onCancel={onClose}
      footer={null}
      width={700}
    >
      {entries.length === 0 ? (
        <Empty description="No changes recorded yet" />
      ) : (
        <List
          className="animate-fade-in"
          loading={loading}
          dataSource={entries}
          renderItem={(entry) => (
            <List.Item>
              <List.Item.Meta
                title={
                  <div className="flex items-center gap-2">
                    <Tag color={TYPE_COLORS[entry.entity_type] ?? 'default'}>
                      {entry.entity_type}
                    </Tag>
                    <span>{entry.entity_name}</span>
                    <Tag>v{entry.version}</Tag>
                  </div>
                }
                description={
                  <div>
                    <div>{entry.summary}</div>
                    <div
                      className="text-xs"
                      style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-code)' }}
                    >
                      {formatDate(entry.created_at)}
                    </div>
                  </div>
                }
              />
            </List.Item>
          )}
          style={{ maxHeight: 500, overflow: 'auto' }}
        />
      )}
    </Modal>
  );
}
