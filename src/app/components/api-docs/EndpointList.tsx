'use client';

import { Collapse, Tag, Input, Flex } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useState, useMemo } from 'react';
import {
  getOperations,
  filterOperations,
  groupOperationsByTag,
  type OperationEntry,
} from './openapi-utils';

const METHOD_COLORS: Record<string, string> = {
  GET: '#52c41a',
  POST: '#1677ff',
  PUT: '#fa8c16',
  DELETE: '#ff4d4f',
  PATCH: '#722ed1',
};

function methodColor(method: string): string {
  return METHOD_COLORS[method.toUpperCase()] ?? '#8c8c8c';
}

interface Props {
  spec: Record<string, unknown>;
  selectedPath: string | null;
  selectedMethod: string | null;
  onSelect: (path: string, method: string) => void;
}

interface EndpointRowProps {
  op: OperationEntry;
  isSelected: boolean;
  onSelect: (path: string, method: string) => void;
}

function EndpointRow({ op, isSelected, onSelect }: EndpointRowProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(op.path, op.method)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onSelect(op.path, op.method);
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 8px',
        borderRadius: 4,
        cursor: 'pointer',
        background: isSelected ? 'var(--ant-color-primary-bg)' : 'transparent',
        border: isSelected
          ? '1px solid var(--ant-color-primary-border)'
          : '1px solid transparent',
        marginBottom: 2,
      }}
    >
      <Tag
        style={{
          minWidth: 52,
          textAlign: 'center',
          color: '#fff',
          background: methodColor(op.method),
          border: 'none',
          fontWeight: 600,
          fontSize: 10,
          lineHeight: '18px',
          padding: '0 4px',
          marginInlineEnd: 0,
        }}
      >
        {op.method}
      </Tag>
      <span
        style={{
          fontSize: 12,
          fontFamily: 'monospace',
          color: isSelected
            ? 'var(--ant-color-primary)'
            : 'var(--ant-color-text)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
        }}
        title={op.path}
      >
        {op.path}
      </span>
    </div>
  );
}

export function EndpointList({ spec, selectedPath, selectedMethod, onSelect }: Props) {
  const [query, setQuery] = useState('');

  const allOperations = useMemo(() => getOperations(spec), [spec]);
  const filtered = useMemo(
    () => filterOperations(allOperations, query),
    [allOperations, query],
  );
  const grouped = useMemo(() => groupOperationsByTag(filtered), [filtered]);

  const collapseItems = useMemo(
    () =>
      Array.from(grouped.entries()).map(([tag, ops]) => ({
        key: tag,
        label: (
          <span style={{ fontWeight: 600, fontSize: 13 }}>
            {tag}
            <Tag
              style={{
                marginLeft: 8,
                fontSize: 10,
                lineHeight: '16px',
                padding: '0 5px',
                marginInlineEnd: 0,
              }}
            >
              {ops.length}
            </Tag>
          </span>
        ),
        children: (
          <Flex vertical gap={0} style={{ paddingInline: 4 }}>
            {ops.map((op) => (
              <EndpointRow
                key={`${op.method}-${op.path}`}
                op={op}
                isSelected={
                  selectedPath === op.path && selectedMethod === op.method
                }
                onSelect={onSelect}
              />
            ))}
          </Flex>
        ),
      })),
    [grouped, selectedPath, selectedMethod, onSelect],
  );

  const defaultActiveKeys = useMemo(
    () => Array.from(grouped.keys()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <Flex
      vertical
      style={{ height: '100%', overflow: 'hidden' }}
    >
      <div style={{ padding: '8px 12px', flexShrink: 0 }}>
        <Input
          prefix={<SearchOutlined style={{ color: 'var(--ant-color-text-tertiary)' }} />}
          placeholder="Search endpoints..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          allowClear
          size="small"
        />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 8px' }}>
        {collapseItems.length === 0 ? (
          <div
            style={{
              padding: 24,
              textAlign: 'center',
              color: 'var(--ant-color-text-tertiary)',
              fontSize: 13,
            }}
          >
            No endpoints found
          </div>
        ) : (
          <Collapse
            defaultActiveKey={defaultActiveKeys}
            ghost
            size="small"
            items={collapseItems}
          />
        )}
      </div>
    </Flex>
  );
}
