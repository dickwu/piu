'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { DatabaseOutlined } from '@ant-design/icons';
import { NODE_DIAMETER } from '../../utils/apiModelMapLayout';
import type { ModelNodeData } from '../../utils/apiModelMapLayout';

type ModelNodeType = Node<ModelNodeData, 'model'>;

const BLUE = '#4a9eff';
const BG = 'rgba(74, 158, 255, 0.15)';
const BORDER_NORMAL = 'rgba(74, 158, 255, 0.5)';
const SHADOW_SELECTED = '0 0 12px rgba(74, 158, 255, 0.3)';

const handleStyle = { opacity: 0, width: 6, height: 6 } as const;

function ModelNode({ data, selected }: NodeProps<ModelNodeType>) {
  const { name, fieldCount } = data;

  return (
    <div
      style={{
        width: NODE_DIAMETER,
        height: NODE_DIAMETER,
        borderRadius: '50%',
        background: BG,
        border: `1.5px solid ${selected ? BLUE : BORDER_NORMAL}`,
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

      <DatabaseOutlined
        style={{
          color: BLUE,
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
        {fieldCount} fields
      </span>
    </div>
  );
}

export default memo(ModelNode);
