'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { RequestNodeData } from '../../utils/apiModelMapLayout';

type RequestNodeType = Node<RequestNodeData, 'request'>;

const METHOD_COLORS: Record<string, string> = {
  GET: '#34d399',
  POST: '#fbbf24',
  PUT: '#60a5fa',
  DELETE: '#f87171',
  PATCH: '#c084fc',
};

const DEFAULT_METHOD_COLOR = '#94a3b8';

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function RequestNode({ data, selected }: NodeProps<RequestNodeType>) {
  const { name, method, url } = data;

  const normalizedMethod = method.toUpperCase();
  const methodColor = METHOD_COLORS[normalizedMethod] ?? DEFAULT_METHOD_COLOR;
  const methodBg = hexToRgba(methodColor, 0.15);

  return (
    <div
      style={{
        width: 200,
        background: 'var(--bg-surface)',
        border: `1px solid ${selected ? '#4a9eff' : 'var(--border)'}`,
        borderRadius: 6,
        overflow: 'hidden',
        fontFamily: 'var(--font-ui)',
        boxShadow: selected ? '0 0 0 2px rgba(74,158,255,0.2)' : 'none',
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
      }}
    >
      <Handle type="target" position={Position.Top} />

      <div style={{ padding: '7px 9px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {/* Method badge + name row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              background: methodBg,
              color: methodColor,
              fontSize: 9,
              fontWeight: 700,
              fontFamily: 'var(--font-ui)',
              padding: '1px 5px',
              borderRadius: 3,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              flexShrink: 0,
            }}
          >
            {normalizedMethod}
          </span>
          <span
            style={{
              color: 'var(--text-primary)',
              fontSize: 11,
              fontFamily: 'var(--font-ui)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
            }}
            title={name}
          >
            {name}
          </span>
        </div>

        {/* URL path */}
        {url && (
          <span
            style={{
              color: 'var(--text-tertiary)',
              fontSize: 9,
              fontFamily: 'var(--font-code)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              display: 'block',
            }}
            title={url}
          >
            {url}
          </span>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} />
      <Handle type="source" position={Position.Right} id="right-source" />
    </div>
  );
}

export default memo(RequestNode);
