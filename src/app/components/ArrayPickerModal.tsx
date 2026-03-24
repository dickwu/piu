'use client';

import { App, Modal, Button, Flex, Tag } from 'antd';
import { CheckOutlined, ClockCircleOutlined } from '@ant-design/icons';
import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { HookArrayPickEvent } from '../types';

const AUTO_CANCEL_SECONDS = 60;

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return 'null';
  if (typeof val === 'object') {
    try {
      return JSON.stringify(val, null, 2);
    } catch {
      return String(val);
    }
  }
  return String(val);
}

function extractField(item: unknown, fieldPath: string): unknown {
  if (item === null || item === undefined) return item;
  const parts = fieldPath.split('.');
  let current: unknown = item;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function ArrayPickerModal() {
  const { message } = App.useApp();

  const [event, setEvent] = useState<HookArrayPickEvent | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [countdown, setCountdown] = useState(AUTO_CANCEL_SECONDS);
  const [submitting, setSubmitting] = useState(false);

  const unlistenRef = useRef<UnlistenFn | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const setup = async () => {
      const unlisten = await listen<HookArrayPickEvent>('hook-array-pick', (e) => {
        setEvent(e.payload);
        setSelectedIndex(null);
        setCountdown(AUTO_CANCEL_SECONDS);
      });
      unlistenRef.current = unlisten;
    };
    setup();

    return () => {
      unlistenRef.current?.();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!event) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          handleCancel();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event]);

  const handleCancel = useCallback(async () => {
    if (!event) return;
    try {
      await invoke('cancel_hook_pick', { pickId: event.pick_id });
    } catch {
      // silently ignore if already cancelled
    }
    setEvent(null);
    setSelectedIndex(null);
  }, [event]);

  const handleSelect = useCallback(async () => {
    if (!event || selectedIndex === null) return;
    setSubmitting(true);
    try {
      await invoke('resolve_hook_pick', {
        input: { pick_id: event.pick_id, selected_index: selectedIndex },
      });
      setEvent(null);
      setSelectedIndex(null);
    } catch (err) {
      message.error(`Failed to select value: ${err}`);
    } finally {
      setSubmitting(false);
    }
  }, [event, selectedIndex, message]);

  if (!event) return null;

  return (
    <Modal
      title="Select Value"
      open={event !== null}
      onCancel={handleCancel}
      destroyOnHidden
      width={560}
      footer={
        <Flex justify="space-between" align="center">
          <Flex align="center" gap={6} style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>
            <ClockCircleOutlined />
            <span>Auto-cancel in {countdown}s</span>
          </Flex>
          <Flex gap={8}>
            <Button onClick={handleCancel}>Cancel</Button>
            <Button
              type="primary"
              disabled={selectedIndex === null}
              loading={submitting}
              onClick={handleSelect}
            >
              Use Selected
            </Button>
          </Flex>
        </Flex>
      }
    >
      <div style={{ marginBottom: 12 }}>
        <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>
          Field: <code style={{ fontFamily: 'var(--font-code)' }}>{event.field_path}</code>
          {' \u2014 '}
          {event.items.length} item{event.items.length !== 1 ? 's' : ''}
        </span>
      </div>

      <Flex
        vertical
        gap={8}
        style={{ maxHeight: 400, overflow: 'auto', paddingRight: 4 }}
      >
        {event.items.map((item, idx) => {
          const isSelected = selectedIndex === idx;
          const extractedValue = extractField(item, event.field_path);

          return (
            <div
              key={idx}
              onClick={() => setSelectedIndex(idx)}
              style={{
                padding: '10px 12px',
                borderRadius: 6,
                border: isSelected
                  ? '1.5px solid var(--primary)'
                  : '1px solid var(--border)',
                background: isSelected
                  ? 'rgba(22, 119, 255, 0.06)'
                  : 'var(--bg-container)',
                cursor: 'pointer',
                transition: 'border-color 0.15s, background 0.15s',
                position: 'relative',
              }}
            >
              {isSelected && (
                <CheckOutlined
                  style={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    color: 'var(--primary)',
                    fontSize: 14,
                  }}
                />
              )}

              <Flex vertical gap={4}>
                <Flex align="center" gap={6}>
                  <Tag
                    color="blue"
                    style={{
                      fontSize: 10,
                      lineHeight: '16px',
                      padding: '0 4px',
                      margin: 0,
                    }}
                  >
                    #{idx}
                  </Tag>
                  {extractedValue !== undefined && (
                    <span
                      style={{
                        fontFamily: 'var(--font-code)',
                        fontSize: 12,
                        fontWeight: 600,
                        color: isSelected ? 'var(--primary)' : 'var(--text)',
                      }}
                    >
                      {formatValue(extractedValue)}
                    </span>
                  )}
                </Flex>

                <pre
                  style={{
                    fontFamily: 'var(--font-code)',
                    fontSize: 10,
                    color: 'var(--text-tertiary)',
                    margin: 0,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    maxHeight: 100,
                    overflow: 'auto',
                  }}
                >
                  {formatValue(item)}
                </pre>
              </Flex>
            </div>
          );
        })}
      </Flex>
    </Modal>
  );
}
