'use client';

import { Input, Flex, Dropdown, Button, Switch } from 'antd';
import {
  FontSizeOutlined,
  NumberOutlined,
  CheckSquareOutlined,
  StopOutlined,
  AppstoreOutlined,
  OrderedListOutlined,
  PlusOutlined,
  DeleteOutlined,
  CaretRightOutlined,
  CaretDownOutlined,
} from '@ant-design/icons';
import { useCallback, useMemo, useState } from 'react';

// ── Types ──────────────────────────────────────────────

interface ResolvedField {
  name: string;
  field_type: string;
  required: boolean;
  description: string | null;
  example: string | null;
}

interface Props {
  fields: ResolvedField[];
  jsonContent: string;
  onChange: (json: string) => void;
}

type JsonType = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array';

// ── Constants ──────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  string: '#1677ff',
  integer: '#1677ff',
  number: '#52c41a',
  boolean: '#722ed1',
  null: '#8c8c8c',
  array: '#fa8c16',
  object: '#eb2f96',
};

const TYPE_MENU_ITEMS = [
  { key: 'object', icon: <AppstoreOutlined />, label: 'Object' },
  { key: 'array', icon: <OrderedListOutlined />, label: 'Array' },
  { type: 'divider' as const },
  { key: 'string', icon: <FontSizeOutlined />, label: 'String' },
  { key: 'number', icon: <NumberOutlined />, label: 'Number' },
  { key: 'boolean', icon: <CheckSquareOutlined />, label: 'Boolean' },
  { key: 'null', icon: <StopOutlined />, label: 'Null' },
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

function defaultForFieldType(ft: string): unknown {
  if (ft === 'integer' || ft === 'number') return 0;
  if (ft === 'boolean') return false;
  if (ft === 'array') return [];
  if (ft === 'object') return {};
  return '';
}

// ── TypeTag (clickable dropdown) ───────────────────────

function TypeTag({ type, onChange }: { type: JsonType; onChange: (t: JsonType) => void }) {
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
          lineHeight: '16px',
          padding: '0 5px',
          borderRadius: 3,
          background: `${color}20`,
          color,
          fontWeight: 600,
          userSelect: 'none',
        }}
      >
        {type}
      </span>
    </Dropdown>
  );
}

// ── ValueEditor (recursive) ───────────────────────────

function ValueEditor({
  value,
  fieldType,
  placeholder,
  onChange,
  depth,
}: {
  value: unknown;
  fieldType: JsonType;
  placeholder?: string;
  onChange: (v: unknown) => void;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(depth < 2);

  const handleTypeChange = useCallback(
    (newType: JsonType) => {
      onChange(defaultForType(newType));
    },
    [onChange],
  );

  const currentType = detectType(value);

  // Primitive editors
  if (currentType === 'string' || (currentType === 'null' && fieldType === 'string')) {
    return (
      <Flex align="center" gap={4} style={{ flex: 1 }}>
        <TypeTag type="string" onChange={handleTypeChange} />
        <Input
          size="small"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? 'Enter string...'}
          style={{ fontFamily: 'var(--font-code)', fontSize: 12, flex: 1 }}
        />
      </Flex>
    );
  }

  if (currentType === 'number') {
    return (
      <Flex align="center" gap={4} style={{ flex: 1 }}>
        <TypeTag type="number" onChange={handleTypeChange} />
        <Input
          size="small"
          value={String(value ?? '')}
          onChange={(e) => {
            const n = parseFloat(e.target.value);
            onChange(isNaN(n) ? 0 : n);
          }}
          placeholder="0"
          style={{ fontFamily: 'var(--font-code)', fontSize: 12, flex: 1 }}
        />
      </Flex>
    );
  }

  if (currentType === 'boolean') {
    return (
      <Flex align="center" gap={4} style={{ flex: 1 }}>
        <TypeTag type="boolean" onChange={handleTypeChange} />
        <Switch
          size="small"
          checked={!!value}
          onChange={(checked) => onChange(checked)}
        />
        <span style={{ fontSize: 11, fontFamily: 'var(--font-code)', color: 'var(--ant-color-text-secondary)' }}>
          {value ? 'true' : 'false'}
        </span>
      </Flex>
    );
  }

  if (currentType === 'null') {
    return (
      <Flex align="center" gap={4} style={{ flex: 1 }}>
        <TypeTag type="null" onChange={handleTypeChange} />
        <span style={{ fontSize: 11, fontFamily: 'var(--font-code)', color: 'var(--ant-color-text-quaternary)' }}>
          null
        </span>
      </Flex>
    );
  }

  // Object editor (recursive)
  if (currentType === 'object') {
    const obj = (value ?? {}) as Record<string, unknown>;
    const keys = Object.keys(obj);
    return (
      <div style={{ flex: 1 }}>
        <Flex align="center" gap={4}>
          <TypeTag type="object" onChange={handleTypeChange} />
          <span
            onClick={() => setExpanded(!expanded)}
            style={{ cursor: 'pointer', fontSize: 11, color: 'var(--ant-color-text-tertiary)', userSelect: 'none' }}
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
              onChange({ ...obj, [newKey]: '' });
              setExpanded(true);
            }}
            style={{ fontSize: 10, height: 20, width: 20, minWidth: 20 }}
          />
        </Flex>
        {expanded && (
          <div style={{ paddingLeft: 12, borderLeft: `2px solid ${TYPE_COLORS.object}30`, marginTop: 4, marginLeft: 4 }}>
            {keys.map((key) => (
              <Flex key={key} align="flex-start" gap={4} style={{ marginBottom: 4 }}>
                <Input
                  size="small"
                  value={key}
                  onChange={(e) => {
                    const newKey = e.target.value;
                    if (newKey === key) return;
                    const entries = Object.entries(obj).map(([k, v]) =>
                      k === key ? [newKey, v] : [k, v],
                    );
                    onChange(Object.fromEntries(entries));
                  }}
                  style={{ width: 100, fontFamily: 'var(--font-code)', fontSize: 11, fontWeight: 600 }}
                />
                <div style={{ flex: 1 }}>
                  <ValueEditor
                    value={obj[key]}
                    fieldType={detectType(obj[key])}
                    onChange={(v) => onChange({ ...obj, [key]: v })}
                    depth={depth + 1}
                  />
                </div>
                <Button
                  type="text"
                  size="small"
                  icon={<DeleteOutlined />}
                  danger
                  onClick={() => {
                    const { [key]: _, ...rest } = obj;
                    onChange(rest);
                  }}
                  style={{ height: 24, width: 24, minWidth: 24 }}
                />
              </Flex>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Array editor (recursive)
  if (currentType === 'array') {
    const arr = (Array.isArray(value) ? value : []) as unknown[];
    return (
      <div style={{ flex: 1 }}>
        <Flex align="center" gap={4}>
          <TypeTag type="array" onChange={handleTypeChange} />
          <span
            onClick={() => setExpanded(!expanded)}
            style={{ cursor: 'pointer', fontSize: 11, color: 'var(--ant-color-text-tertiary)', userSelect: 'none' }}
          >
            {expanded ? <CaretDownOutlined /> : <CaretRightOutlined />}
            {' '}{arr.length} item{arr.length !== 1 ? 's' : ''}
          </span>
          <Button
            type="text"
            size="small"
            icon={<PlusOutlined />}
            onClick={() => {
              onChange([...arr, '']);
              setExpanded(true);
            }}
            style={{ fontSize: 10, height: 20, width: 20, minWidth: 20 }}
          />
        </Flex>
        {expanded && (
          <div style={{ paddingLeft: 12, borderLeft: `2px solid ${TYPE_COLORS.array}30`, marginTop: 4, marginLeft: 4 }}>
            {arr.map((item, idx) => (
              <Flex key={idx} align="flex-start" gap={4} style={{ marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: 'var(--ant-color-text-quaternary)', fontFamily: 'var(--font-code)', width: 20, textAlign: 'right', paddingTop: 4 }}>
                  [{idx}]
                </span>
                <div style={{ flex: 1 }}>
                  <ValueEditor
                    value={item}
                    fieldType={detectType(item)}
                    onChange={(v) => {
                      const updated = [...arr];
                      updated[idx] = v;
                      onChange(updated);
                    }}
                    depth={depth + 1}
                  />
                </div>
                <Button
                  type="text"
                  size="small"
                  icon={<DeleteOutlined />}
                  danger
                  onClick={() => onChange(arr.filter((_, i) => i !== idx))}
                  style={{ height: 24, width: 24, minWidth: 24 }}
                />
              </Flex>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Fallback
  return (
    <Flex align="center" gap={4} style={{ flex: 1 }}>
      <TypeTag type={currentType} onChange={handleTypeChange} />
      <Input
        size="small"
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        style={{ fontFamily: 'var(--font-code)', fontSize: 12, flex: 1 }}
      />
    </Flex>
  );
}

// ── Main component ────────────────────────────────────

export function BodyFieldsEditor({ fields, jsonContent, onChange }: Props) {
  const parsed = useMemo(() => parseJsonSafe(jsonContent), [jsonContent]);

  const handleFieldChange = useCallback(
    (fieldName: string, value: unknown) => {
      const current = parseJsonSafe(jsonContent);
      const updated = { ...current, [fieldName]: value };
      onChange(JSON.stringify(updated, null, 2));
    },
    [jsonContent, onChange],
  );

  if (fields.length === 0) return null;

  return (
    <div style={{ fontSize: 12 }}>
      {/* Header */}
      <Flex
        style={{
          padding: '6px 8px',
          borderBottom: '1px solid var(--ant-color-border)',
          color: 'var(--ant-color-text-tertiary)',
          fontWeight: 600,
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        <div style={{ width: 120 }}>Name</div>
        <div style={{ flex: 1 }}>Value</div>
        <div style={{ width: 60, textAlign: 'right' }}>Required</div>
      </Flex>

      {/* Rows */}
      {fields.map((field) => {
        const currentValue = parsed[field.name];
        const hasValue = field.name in parsed;
        const effectiveValue = hasValue ? currentValue : defaultForFieldType(field.field_type);

        return (
          <div
            key={field.name}
            style={{ borderBottom: '1px solid var(--ant-color-border-secondary)' }}
          >
            <Flex
              align="flex-start"
              style={{ padding: '5px 8px' }}
            >
              <div
                style={{
                  width: 120,
                  fontFamily: 'var(--font-code)',
                  fontWeight: 500,
                  color: 'var(--ant-color-text)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  paddingTop: 3,
                }}
                title={field.description ?? field.name}
              >
                {field.name}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <ValueEditor
                  value={effectiveValue}
                  fieldType={detectType(effectiveValue) as JsonType}
                  placeholder={field.example ?? undefined}
                  onChange={(v) => handleFieldChange(field.name, v)}
                  depth={0}
                />
              </div>
              <div style={{ width: 60, textAlign: 'right', paddingTop: 3 }}>
                {field.required ? (
                  <span style={{ fontSize: 10, color: '#ff4d4f', fontWeight: 600 }}>required</span>
                ) : (
                  <span style={{ fontSize: 10, color: 'var(--ant-color-text-quaternary)' }}>optional</span>
                )}
              </div>
            </Flex>
          </div>
        );
      })}
    </div>
  );
}
