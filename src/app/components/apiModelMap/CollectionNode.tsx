'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { FolderOutlined } from '@ant-design/icons';
import { NODE_DIAMETER } from '../../utils/apiModelMapLayout';
import type { CollectionNodeData } from '../../utils/apiModelMapLayout';

type CollectionNodeType = Node<CollectionNodeData, 'collection'>;

const AMBER = '#fbbf24';
const BG = 'rgba(251, 191, 36, 0.15)';
const BORDER_NORMAL = 'rgba(251, 191, 36, 0.5)';
const SHADOW_SELECTED = '0 0 12px rgba(251, 191, 36, 0.3)';

const handleStyle = { opacity: 0, width: 6, height: 6 } as const;

function CollectionNode({ data, selected }: NodeProps<CollectionNodeType>) {
  const { name, requestCount } = data;

  return (
    <div
      style={{
        width: NODE_DIAMETER,
        height: NODE_DIAMETER,
        borderRadius: '50%',
        background: BG,
        border: `1.5px solid ${selected ? AMBER : BORDER_NORMAL}`,
        boxShadow: selected ? SHADOW_SELECTED : 'none',
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

      <FolderOutlined
        style={{
          color: AMBER,
          fontSize: 13,
          marginBottom: 3,
        }}
      />
      <span
        style={{
          color: 'var(--text-primary)',
          fontSize: 10,
          fontWeight: 700,
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
      <span
        style={{
          color: 'var(--text-tertiary)',
          fontSize: 8,
          marginTop: 1,
          lineHeight: 1.2,
        }}
      >
        {requestCount} req
      </span>
    </div>
  );
}

export default memo(CollectionNode);
