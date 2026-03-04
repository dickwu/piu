'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { NODE_DIAMETER } from '../../utils/apiModelMapLayout';
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

const handleStyle = { opacity: 0, width: 6, height: 6 } as const;

function RequestNode({ data, selected }: NodeProps<RequestNodeType>) {
  const { name, method } = data;

  const normalizedMethod = method.toUpperCase();
  const methodColor = METHOD_COLORS[normalizedMethod] ?? DEFAULT_METHOD_COLOR;

  return (
    <div
      style={{
        width: NODE_DIAMETER,
        height: NODE_DIAMETER,
        borderRadius: '50%',
        background: hexToRgba(methodColor, 0.15),
        border: `1.5px solid ${selected ? methodColor : hexToRgba(methodColor, 0.5)}`,
        boxShadow: selected ? `0 0 12px ${methodColor}4d` : 'none',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--font-ui)',
        cursor: 'grab',
        transition: 'border-color 150ms ease, box-shadow 150ms ease',
        overflow: 'hidden',
      }}
    >
      <Handle type="target" position={Position.Top} style={handleStyle} />
      <Handle type="source" position={Position.Bottom} style={handleStyle} />
      <Handle type="target" position={Position.Left} id="left-target" style={handleStyle} />
      <Handle type="source" position={Position.Right} id="right-source" style={handleStyle} />

      <span
        style={{
          color: methodColor,
          fontSize: 8,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          marginBottom: 2,
          lineHeight: 1.2,
        }}
      >
        {normalizedMethod}
      </span>
      <span
        style={{
          color: 'var(--text-primary)',
          fontSize: 9,
          maxWidth: NODE_DIAMETER - 12,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          textAlign: 'center',
          lineHeight: 1.2,
        }}
        title={name}
      >
        {name}
      </span>
    </div>
  );
}

export default memo(RequestNode);
