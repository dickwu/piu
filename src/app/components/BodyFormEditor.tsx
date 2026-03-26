'use client';

import { Input, Switch, Button, Dropdown } from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  CaretRightOutlined,
  CaretDownOutlined,
  FontSizeOutlined,
  NumberOutlined,
  CheckSquareOutlined,
  StopOutlined,
  AppstoreOutlined,
  OrderedListOutlined,
} from '@ant-design/icons';
import { useCallback, useMemo, useState } from 'react';
import type { ResolvedModelField } from '../types';

// ── Types ──────────────────────────────────────────────

type JsonType = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array';

interface FieldRow {
  key: string;
  value: unknown;
  type: JsonType;
  enabled: boolean;
  fromModel: boolean;
  required: boolean;
  placeholder?: string;
}

interface Props {
  fields: ResolvedModelField[];
  jsonContent: string;
  onChange: (json: string) => void;
}

const MAX_DEPTH = 4;

// ── Constants ──────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  string: '#1677ff',
  number: '#52c41a',
  boolean: '#722ed1',
  null: '#8c8c8c',
  object: '#eb2f96',
  array: '#fa8c16',
};

const TYPE_MENU_ITEMS = [
  { key: 'string', icon: <FontSizeOutlined />, label: 'String' },
  { key: 'number', icon: <NumberOutlined />, label: 'Number' },
  { key: 'boolean', icon: <CheckSquareOutlined />, label: 'Boolean' },
  { key: 'null', icon: <StopOutlined />, label: 'Null' },
  { type: 'divider' as const },
  { key: 'object', icon: <AppstoreOutlined />, label: 'Object' },
  { key: 'array', icon: <OrderedListOutlined />, label: 'Array' },
];

// ── Helpers ────────────────────────────────────────────

function parseJsonSafe(content: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(content);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function detectType(value: unknown): JsonType {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  return 'string';
}

function defaultForType(t: JsonType): unknown {
  switch (t) {
    case 'string': return '';
    case 'number': return 0;
    case 'boolean': return false;
    case 'null': return null;
    case 'object': return {};
    case 'array': return [];
  }
}

function fieldTypeToJsonType(ft: string): JsonType {
  if (ft === 'integer') return 'number';
  if (ft === 'any') return 'string';
  return ft as JsonType;
}

// ── TypeBadge ──────────────────────────────────────────

function TypeBadge({
  type,
  onChange,
}: {
  type: JsonType;
  onChange: (t: JsonType) => void;
}) {
  const color = TYPE_COLORS[type] ?? '#8c8c8c';
  return (
    <Dropdown
      trigger={['click']}
      menu={{
        items: TYPE_MENU_ITEMS.map((item) => {
          if (item.type === 'divider') return item;
          return { ...item, onClick: () => onChange(item.key as JsonType) };
        }),
        selectedKeys: [type],
      }}
    >
      <span
        style={{
          cursor: 'pointer',
          fontSize: 10,
          lineHeight: '18px',
          padding: '0 6px',
          borderRadius: 3,
          background: `${color}20`,
          color,
          fontWeight: 600,
          userSelect: 'none',
          whiteSpace: 'nowrap',
        }}
      >
        {type}
      </span>
    </Dropdown>
  );
}

// ── ValueEditor (recursive) ────────────────────────────

function ValueEditor({
  value,
  type,
  placeholder,
  onChange,
  onTypeChange,
  depth,
}: {
  value: unknown;
  type: JsonType;
  placeholder?: string;
  onChange: (v: unknown) => void;
  onTypeChange: (t: JsonType) => void;
  depth: number;
}) {
  if (type === 'string') {
    return (
      <Input
        size="small"
        className="input-mono"
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? 'value'}
        style={{ flex: 1 }}
      />
    );
  }

  if (type === 'number') {
    return (
      <Input
        size="small"
        className="input-mono"
        value={value === null || value === undefined ? '' : String(value)}
        onChange={(e) => {
          const n = parseFloat(e.target.value);
          onChange(isNaN(n) ? 0 : n);
        }}
        placeholder={placeholder ?? '0'}
        style={{ flex: 1 }}
      />
    );
  }

  if (type === 'boolean') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
        <Switch size="small" checked={!!value} onChange={(checked) => onChange(checked)} />
        <span
          style={{
            fontSize: 12,
            fontFamily: 'var(--font-code)',
            color: 'var(--ant-color-text-secondary)',
          }}
        >
          {value ? 'true' : 'false'}
        </span>
      </div>
    );
  }

  if (type === 'null') {
    return (
      <span
        style={{
          flex: 1,
          fontSize: 12,
          fontFamily: 'var(--font-code)',
          color: 'var(--ant-color-text-quaternary)',
          padding: '0 7px',
        }}
      >
        null
      </span>
    );
  }

  // Object — recursive rows
  if (type === 'object') {
    return (
      <ObjectEditor
        value={(typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}) as Record<string, unknown>}
        onChange={onChange}
        onTypeChange={onTypeChange}
        depth={depth}
      />
    );
  }

  // Array — recursive rows
  if (type === 'array') {
    return (
      <ArrayEditor
        value={Array.isArray(value) ? value : []}
        onChange={onChange}
        onTypeChange={onTypeChange}
        depth={depth}
      />
    );
  }

  return null;
}

// ── ObjectEditor ───────────────────────────────────────

function ObjectEditor({
  value,
  onChange,
  onTypeChange,
  depth,
}: {
  value: Record<string, unknown>;
  onChange: (v: unknown) => void;
  onTypeChange: (t: JsonType) => void;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const keys = Object.keys(value);

  // Depth limit fallback
  if (depth >= MAX_DEPTH) {
    return (
      <Input.TextArea
        size="small"
        className="input-mono"
        value={JSON.stringify(value, null, 2)}
        onChange={(e) => {
          try { onChange(JSON.parse(e.target.value)); } catch { /* ignore invalid JSON while typing */ }
        }}
        autoSize={{ minRows: 2, maxRows: 6 }}
        style={{ flex: 1, fontSize: 12 }}
      />
    );
  }

  return (
    <div style={{ flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <TypeBadge type="object" onChange={onTypeChange} />
        <span
          onClick={() => setExpanded(!expanded)}
          style={{
            cursor: 'pointer',
            fontSize: 11,
            color: 'var(--ant-color-text-tertiary)',
            userSelect: 'none',
          }}
        >
          {expanded ? <CaretDownOutlined /> : <CaretRightOutlined />}
          {' '}{keys.length} key{keys.length !== 1 ? 's' : ''}
        </span>
        <Button
          type="text"
          size="small"
          icon={<PlusOutlined />}
          onClick={() => {
            const newKey = `key${keys.length}`;
            onChange({ ...value, [newKey]: '' });
            setExpanded(true);
          }}
          style={{ height: 20, width: 20, minWidth: 20, fontSize: 10 }}
        />
      </div>
      {expanded && keys.length > 0 && (
        <div
          style={{
            marginTop: 4,
            marginLeft: 6,
            paddingLeft: 10,
            borderLeft: `2px solid ${TYPE_COLORS.object}40`,
          }}
        >
          {keys.map((k) => {
            const childType = detectType(value[k]);
            const isComplex = childType === 'object' || childType === 'array';
            return (
              <div key={k} className="kv-row" style={{ display: 'flex', alignItems: isComplex ? 'flex-start' : 'center', gap: 8, padding: '3px 0' }}>
                <Input
                  size="small"
                  className="input-mono"
                  value={k}
                  onChange={(e) => {
                    const newKey = e.target.value;
                    if (newKey === k) return;
                    const entries = Object.entries(value).map(([ek, ev]) =>
                      ek === k ? [newKey, ev] : [ek, ev],
                    );
                    onChange(Object.fromEntries(entries));
                  }}
                  style={{ width: 100, fontWeight: 600 }}
                />
                {!isComplex && <TypeBadge type={childType} onChange={(t) => onChange({ ...value, [k]: defaultForType(t) })} />}
                <ValueEditor
                  value={value[k]}
                  type={childType}
                  onChange={(v) => onChange({ ...value, [k]: v })}
                  onTypeChange={(t) => onChange({ ...value, [k]: defaultForType(t) })}
                  depth={depth + 1}
                />
                <Button
                  size="small"
                  icon={<DeleteOutlined />}
                  danger
                  type="text"
                  onClick={() => {
                    const { [k]: _, ...rest } = value;
                    onChange(rest);
                  }}
                  style={{ height: 24, width: 24, minWidth: 24 }}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── ArrayEditor ────────────────────────────────────────

function ArrayEditor({
  value,
  onChange,
  onTypeChange,
  depth,
}: {
  value: unknown[];
  onChange: (v: unknown) => void;
  onTypeChange: (t: JsonType) => void;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(depth < 2);

  // Depth limit fallback
  if (depth >= MAX_DEPTH) {
    return (
      <Input.TextArea
        size="small"
        className="input-mono"
        value={JSON.stringify(value, null, 2)}
        onChange={(e) => {
          try { onChange(JSON.parse(e.target.value)); } catch { /* ignore invalid JSON while typing */ }
        }}
        autoSize={{ minRows: 2, maxRows: 6 }}
        style={{ flex: 1, fontSize: 12 }}
      />
    );
  }

  return (
    <div style={{ flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <TypeBadge type="array" onChange={onTypeChange} />
        <span
          onClick={() => setExpanded(!expanded)}
          style={{
            cursor: 'pointer',
            fontSize: 11,
            color: 'var(--ant-color-text-tertiary)',
            userSelect: 'none',
          }}
        >
          {expanded ? <CaretDownOutlined /> : <CaretRightOutlined />}
          {' '}{value.length} item{value.length !== 1 ? 's' : ''}
        </span>
        <Button
          type="text"
          size="small"
          icon={<PlusOutlined />}
          onClick={() => {
            onChange([...value, '']);
            setExpanded(true);
          }}
          style={{ height: 20, width: 20, minWidth: 20, fontSize: 10 }}
        />
      </div>
      {expanded && value.length > 0 && (
        <div
          style={{
            marginTop: 4,
            marginLeft: 6,
            paddingLeft: 10,
            borderLeft: `2px solid ${TYPE_COLORS.array}40`,
          }}
        >
          {value.map((item, idx) => {
            const childType = detectType(item);
            const isComplex = childType === 'object' || childType === 'array';
            return (
              <div key={idx} className="kv-row" style={{ display: 'flex', alignItems: isComplex ? 'flex-start' : 'center', gap: 8, padding: '3px 0' }}>
                <span
                  style={{
                    fontSize: 11,
                    fontFamily: 'var(--font-code)',
                    color: 'var(--ant-color-text-quaternary)',
                    width: 28,
                    textAlign: 'right',
                    flexShrink: 0,
                  }}
                >
                  [{idx}]
                </span>
                {!isComplex && <TypeBadge type={childType} onChange={(t) => {
                  const updated = [...value];
                  updated[idx] = defaultForType(t);
                  onChange(updated);
                }} />}
                <ValueEditor
                  value={item}
                  type={childType}
                  onChange={(v) => {
                    const updated = [...value];
                    updated[idx] = v;
                    onChange(updated);
                  }}
                  onTypeChange={(t) => {
                    const updated = [...value];
                    updated[idx] = defaultForType(t);
                    onChange(updated);
                  }}
                  depth={depth + 1}
                />
                <Button
                  size="small"
                  icon={<DeleteOutlined />}
                  danger
                  type="text"
                  onClick={() => onChange(value.filter((_, i) => i !== idx))}
                  style={{ height: 24, width: 24, minWidth: 24 }}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────

export function BodyFormEditor({ fields, jsonContent, onChange }: Props) {
  const parsed = useMemo(() => parseJsonSafe(jsonContent), [jsonContent]);

  // Build rows: model fields first, then custom keys from JSON not in model
  const rows: FieldRow[] = useMemo(() => {
    const modelFieldNames = new Set(fields.map((f) => f.name));
    const modelRows: FieldRow[] = fields.map((f) => {
      const hasValue = f.name in parsed;
      const value = hasValue ? parsed[f.name] : defaultForType(fieldTypeToJsonType(f.field_type));
      return {
        key: f.name,
        value,
        type: hasValue ? detectType(parsed[f.name]) : fieldTypeToJsonType(f.field_type),
        enabled: true,
        fromModel: true,
        required: f.required,
        placeholder: f.example ?? undefined,
      };
    });

    const customRows: FieldRow[] = Object.entries(parsed)
      .filter(([k]) => !modelFieldNames.has(k))
      .map(([k, v]) => ({
        key: k,
        value: v,
        type: detectType(v),
        enabled: true,
        fromModel: false,
        required: false,
      }));

    return [...modelRows, ...customRows];
  }, [fields, parsed]);

  const emitChange = useCallback(
    (updatedRows: FieldRow[]) => {
      const obj: Record<string, unknown> = {};
      for (const row of updatedRows) {
        if (row.enabled && row.key) {
          obj[row.key] = row.value;
        }
      }
      onChange(JSON.stringify(obj, null, 2));
    },
    [onChange],
  );

  const updateRow = useCallback(
    (index: number, patch: Partial<FieldRow>) => {
      const updated = rows.map((r, i) => (i === index ? { ...r, ...patch } : r));
      emitChange(updated);
    },
    [rows, emitChange],
  );

  const removeRow = useCallback(
    (index: number) => {
      emitChange(rows.filter((_, i) => i !== index));
    },
    [rows, emitChange],
  );

  const addRow = useCallback(() => {
    const newRow: FieldRow = {
      key: '',
      value: '',
      type: 'string',
      enabled: true,
      fromModel: false,
      required: false,
    };
    emitChange([...rows, newRow]);
  }, [rows, emitChange]);

  return (
    <div className="pb-2">
      {rows.map((row, idx) => {
        const isComplex = row.type === 'object' || row.type === 'array';
        return (
          <div
            key={`${row.key}-${idx}`}
            className="kv-row"
            style={{
              display: 'flex',
              alignItems: isComplex ? 'flex-start' : 'center',
              gap: 8,
            }}
          >
            <Switch
              size="small"
              checked={row.enabled}
              onChange={(checked) => updateRow(idx, { enabled: checked })}
            />
            {row.fromModel ? (
              <span
                style={{
                  width: 110,
                  flexShrink: 0,
                  fontFamily: 'var(--font-code)',
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--ant-color-text)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  paddingTop: isComplex ? 2 : 0,
                }}
                title={row.key}
              >
                {row.key}
              </span>
            ) : (
              <Input
                size="small"
                className="input-mono"
                placeholder="key"
                value={row.key}
                onChange={(e) => updateRow(idx, { key: e.target.value })}
                style={{ width: 110, flexShrink: 0, fontWeight: 600 }}
              />
            )}
            {!isComplex && (
              <TypeBadge
                type={row.type}
                onChange={(t) => updateRow(idx, { type: t, value: defaultForType(t) })}
              />
            )}
            <ValueEditor
              value={row.value}
              type={row.type}
              placeholder={row.placeholder}
              onChange={(v) => updateRow(idx, { value: v })}
              onTypeChange={(t) => updateRow(idx, { type: t, value: defaultForType(t) })}
              depth={0}
            />
            {row.fromModel && (
              <span
                style={{
                  fontSize: 10,
                  color: row.required ? '#ff4d4f' : 'var(--ant-color-text-quaternary)',
                  fontWeight: row.required ? 600 : 400,
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                {row.required ? 'req' : 'opt'}
              </span>
            )}
            <Button
              size="small"
              icon={<DeleteOutlined />}
              danger
              type="text"
              onClick={() => removeRow(idx)}
              style={{ height: 24, width: 24, minWidth: 24, flexShrink: 0 }}
            />
          </div>
        );
      })}
      <Button
        size="small"
        type="dashed"
        icon={<PlusOutlined />}
        onClick={addRow}
        block
      >
        Add Field
      </Button>
    </div>
  );
}
