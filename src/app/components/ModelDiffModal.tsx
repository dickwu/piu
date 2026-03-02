'use client';

import { Modal, Select, Flex, Tag, Empty, Spin } from 'antd';
import { useState, useEffect, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useModelStore } from '../stores/modelStore';
import { parseModelFields } from '../types';
import type { ModelField, ChangelogEntry } from '../types';
import { resolveModelFields } from '../utils/modelResolution';
import { diffModelFields } from '../utils/modelDiff';
import type { FieldDiffEntry, FieldDiffStatus } from '../utils/modelDiff';

// Props use discriminated union
type DiffMode =
  | { type: 'parent_child'; childModelId: string }
  | { type: 'version_history'; modelId: string };

interface ModelDiffModalProps {
  open: boolean;
  onClose: () => void;
  mode: DiffMode;
}

const STATUS_COLORS: Record<FieldDiffStatus, { bg: string; text: string }> = {
  added: { bg: 'rgba(16, 185, 129, 0.15)', text: 'var(--success)' },
  removed: { bg: 'rgba(239, 68, 68, 0.15)', text: 'var(--error)' },
  modified: { bg: 'rgba(245, 158, 11, 0.15)', text: 'var(--warning)' },
  unchanged: { bg: 'transparent', text: 'var(--text-tertiary)' },
};

export function ModelDiffModal({ open, onClose, mode }: ModelDiffModalProps) {
  const models = useModelStore((s) => s.models);

  // For version history mode
  const [changelogs, setChangelogs] = useState<ChangelogEntry[]>([]);
  const [loadingChangelogs, setLoadingChangelogs] = useState(false);
  const [selectedVersionA, setSelectedVersionA] = useState<number | null>(null);
  const [selectedVersionB, setSelectedVersionB] = useState<number | null>(null);
  const [hideUnchanged, setHideUnchanged] = useState(false);

  // Load changelogs for version_history mode
  useEffect(() => {
    if (!open) return;
    if (mode.type !== 'version_history') return;

    setLoadingChangelogs(true);
    invoke<ChangelogEntry[]>('get_changelog', {
      input: { entity_type: 'model', entity_id: mode.modelId, limit: 50, offset: 0 },
    })
      .then((entries) => {
        // Filter entries that have field diffs
        const withDiffs = entries.filter(e => e.diff !== null);
        setChangelogs(withDiffs);
        // Auto-select latest two
        if (withDiffs.length >= 2) {
          setSelectedVersionA(withDiffs[1].version);
          setSelectedVersionB(withDiffs[0].version);
        }
      })
      .finally(() => setLoadingChangelogs(false));
  }, [open, mode]);

  // Compute diff entries
  const diffEntries = useMemo<FieldDiffEntry[]>(() => {
    if (mode.type === 'parent_child') {
      const model = models.find(m => m.id === mode.childModelId);
      if (!model) return [];

      // Left = resolved inherited fields (parent + mixin, excluding own)
      const resolved = resolveModelFields(mode.childModelId, models);
      const inherited = resolved.filter(f => f.origin !== 'own');
      const own = parseModelFields(model.fields);

      // Convert resolved to ModelField for diff
      const inheritedFields: ModelField[] = inherited.map(f => ({
        name: f.name,
        field_type: f.field_type,
        description: f.description,
        required: f.required,
        example: f.example,
        ref_model_id: f.ref_model_id,
      }));

      return diffModelFields(inheritedFields, own);
    }

    if (mode.type === 'version_history') {
      if (selectedVersionA === null || selectedVersionB === null) return [];

      const entryA = changelogs.find(c => c.version === selectedVersionA);
      const entryB = changelogs.find(c => c.version === selectedVersionB);

      if (!entryA?.diff || !entryB?.diff) return [];

      try {
        const diffA = JSON.parse(entryA.diff);
        const diffB = JSON.parse(entryB.diff);

        // Extract fields from the diff JSON (old/new pattern)
        const fieldsA: ModelField[] = diffA.fields?.new
          ? (typeof diffA.fields.new === 'string' ? JSON.parse(diffA.fields.new) : diffA.fields.new)
          : [];
        const fieldsB: ModelField[] = diffB.fields?.new
          ? (typeof diffB.fields.new === 'string' ? JSON.parse(diffB.fields.new) : diffB.fields.new)
          : [];

        return diffModelFields(
          Array.isArray(fieldsA) ? fieldsA : [],
          Array.isArray(fieldsB) ? fieldsB : [],
        );
      } catch {
        return [];
      }
    }

    return [];
  }, [mode, models, changelogs, selectedVersionA, selectedVersionB]);

  const visibleEntries = hideUnchanged
    ? diffEntries.filter(e => e.status !== 'unchanged')
    : diffEntries;

  const stats = useMemo(() => ({
    added: diffEntries.filter(e => e.status === 'added').length,
    removed: diffEntries.filter(e => e.status === 'removed').length,
    modified: diffEntries.filter(e => e.status === 'modified').length,
    unchanged: diffEntries.filter(e => e.status === 'unchanged').length,
  }), [diffEntries]);

  const title = mode.type === 'parent_child'
    ? 'Field Diff: Inherited vs Own'
    : 'Version History Diff';

  return (
    <Modal
      title={title}
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
      width={700}
    >
      {/* Stats bar */}
      <Flex gap={8} style={{ marginBottom: 12 }}>
        {stats.added > 0 && <Tag color="green">{stats.added} added</Tag>}
        {stats.removed > 0 && <Tag color="red">{stats.removed} removed</Tag>}
        {stats.modified > 0 && <Tag color="orange">{stats.modified} modified</Tag>}
        <Tag>{stats.unchanged} unchanged</Tag>
        <label style={{ fontSize: 12, color: 'var(--text-tertiary)', marginLeft: 'auto', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={hideUnchanged}
            onChange={(e) => setHideUnchanged(e.target.checked)}
            style={{ marginRight: 4 }}
          />
          Hide unchanged
        </label>
      </Flex>

      {/* Version selectors for history mode */}
      {mode.type === 'version_history' && (
        loadingChangelogs ? (
          <Flex justify="center" style={{ padding: 20 }}><Spin /></Flex>
        ) : changelogs.length < 2 ? (
          <Empty description="Not enough version history for comparison" />
        ) : (
          <Flex gap={8} style={{ marginBottom: 12 }}>
            <Select
              size="small"
              placeholder="Version A (older)"
              value={selectedVersionA}
              onChange={setSelectedVersionA}
              options={changelogs.map(c => ({
                label: `v${c.version} — ${c.summary}`,
                value: c.version,
              }))}
              style={{ flex: 1 }}
            />
            <span style={{ color: 'var(--text-tertiary)', lineHeight: '24px' }}>→</span>
            <Select
              size="small"
              placeholder="Version B (newer)"
              value={selectedVersionB}
              onChange={setSelectedVersionB}
              options={changelogs.map(c => ({
                label: `v${c.version} — ${c.summary}`,
                value: c.version,
              }))}
              style={{ flex: 1 }}
            />
          </Flex>
        )
      )}

      {/* Diff table */}
      {visibleEntries.length === 0 ? (
        <Empty description="No differences found" />
      ) : (
        <div style={{ maxHeight: 400, overflow: 'auto' }}>
          {/* Header row */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr auto',
            gap: 4,
            padding: '6px 8px',
            fontWeight: 600,
            fontSize: 11,
            color: 'var(--text-tertiary)',
            borderBottom: '1px solid var(--border)',
          }}>
            <span>Field</span>
            <span>Left (base)</span>
            <span>Right (target)</span>
            <span>Status</span>
          </div>

          {visibleEntries.map((entry) => (
            <div
              key={entry.fieldName}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr auto',
                gap: 4,
                padding: '6px 8px',
                borderBottom: '1px solid var(--border-subtle)',
                backgroundColor: STATUS_COLORS[entry.status].bg,
              }}
            >
              <span style={{ fontWeight: 600, fontSize: 13 }}>{entry.fieldName}</span>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'var(--font-code)' }}>
                {entry.left ? `${entry.left.field_type}${entry.left.required ? '*' : ''}` : '—'}
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'var(--font-code)' }}>
                {entry.right ? `${entry.right.field_type}${entry.right.required ? '*' : ''}` : '—'}
              </span>
              <Tag
                color={
                  entry.status === 'added' ? 'green' :
                  entry.status === 'removed' ? 'red' :
                  entry.status === 'modified' ? 'orange' :
                  'default'
                }
                style={{ margin: 0 }}
              >
                {entry.status}
              </Tag>
              {entry.changes.length > 0 && (
                <div style={{ gridColumn: '1 / -1', fontSize: 11, color: STATUS_COLORS[entry.status].text, paddingTop: 2 }}>
                  {entry.changes.join('; ')}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
