'use client';

import { Modal, Timeline, Tag, Empty, Spin, Flex } from 'antd';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { ChangelogEntry } from '../types';

interface ProjectHistoryModalProps {
  open: boolean;
  onClose: () => void;
}

const TYPE_COLORS: Record<string, string> = {
  project: '#f97316',
  collection: '#60a5fa',
  request: '#34d399',
  environment: '#c084fc',
};

const ACTION_ICONS: Record<string, string> = {
  Created: '＋',
  Updated: '↻',
  Deleted: '✕',
};

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function formatFullDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function getActionVerb(summary: string): string {
  const first = summary.split(' ')[0] ?? '';
  return first.charAt(0).toUpperCase() + first.slice(1);
}

export function ProjectHistoryModal({ open, onClose }: ProjectHistoryModalProps) {
  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const loadHistory = useCallback(async () => {
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
      loadHistory();
    }
  }, [open, loadHistory]);

  const timelineItems = useMemo(
    () =>
      entries.map((entry, index) => {
        const actionVerb = getActionVerb(entry.summary);
        const actionIcon = ACTION_ICONS[actionVerb] ?? '•';
        const typeColor = TYPE_COLORS[entry.entity_type] ?? 'gray';

        return {
          key: entry.id,
          color: typeColor,
          content: (
            <div
              style={{
                animation: `fadeIn var(--transition-slow) ease both`,
                animationDelay: `${Math.min(index * 30, 300)}ms`,
                padding: '4px 10px 10px',
                marginBottom: 2,
                borderRadius: 'var(--radius-md)',
                transition: 'background var(--transition-fast)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-hover)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <Flex align="center" gap={6} wrap>
                <Tag
                  color={typeColor}
                  style={{
                    fontFamily: 'var(--font-code)',
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: '0.03em',
                    textTransform: 'uppercase',
                    lineHeight: '18px',
                    padding: '0 6px',
                    borderRadius: 'var(--radius-pill)',
                    margin: 0,
                  }}
                >
                  {entry.entity_type}
                </Tag>
                <span
                  style={{
                    fontWeight: 600,
                    fontSize: 13,
                    color: 'var(--text-primary)',
                  }}
                >
                  {entry.entity_name}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--font-code)',
                    fontSize: 10,
                    color: 'var(--text-tertiary)',
                    background: 'var(--bg-tertiary)',
                    padding: '1px 6px',
                    borderRadius: 'var(--radius-pill)',
                    letterSpacing: '-0.02em',
                  }}
                >
                  v{entry.version}
                </span>
              </Flex>
              <Flex
                align="center"
                gap={5}
                style={{
                  marginTop: 4,
                  fontSize: 12,
                  color: 'var(--text-secondary)',
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-code)',
                    fontSize: 11,
                    opacity: 0.6,
                  }}
                >
                  {actionIcon}
                </span>
                <span>{entry.summary}</span>
                <span
                  style={{
                    marginLeft: 'auto',
                    color: 'var(--text-tertiary)',
                    fontFamily: 'var(--font-code)',
                    fontSize: 10,
                    letterSpacing: '-0.02em',
                    whiteSpace: 'nowrap',
                  }}
                  title={formatFullDate(entry.created_at)}
                >
                  {formatRelativeTime(entry.created_at)}
                </span>
              </Flex>
            </div>
          ),
        };
      }),
    [entries],
  );

  return (
    <Modal
      title={
        <Flex align="center" gap={8}>
          <span>Project History</span>
          {!loading && entries.length > 0 && (
            <span
              style={{
                fontFamily: 'var(--font-code)',
                fontSize: 11,
                color: 'var(--text-tertiary)',
                fontWeight: 400,
                background: 'var(--bg-tertiary)',
                padding: '2px 8px',
                borderRadius: 'var(--radius-pill)',
              }}
            >
              {entries.length}
            </span>
          )}
        </Flex>
      }
      open={open}
      onCancel={onClose}
      footer={null}
      width={640}
      destroyOnHidden
    >
      {loading ? (
        <Flex justify="center" style={{ padding: 48 }}>
          <Spin />
        </Flex>
      ) : entries.length === 0 ? (
        <Empty
          description="No changes recorded yet"
          style={{ padding: '32px 0' }}
        />
      ) : (
        <div
          style={{
            maxHeight: 520,
            overflow: 'auto',
            paddingTop: 16,
            paddingRight: 8,
          }}
        >
          <Timeline items={timelineItems} />
        </div>
      )}
    </Modal>
  );
}
