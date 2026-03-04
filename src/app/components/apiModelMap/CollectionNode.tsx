'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { FolderOutlined } from '@ant-design/icons';
import type { CollectionNodeData } from '../../utils/apiModelMapLayout';

type CollectionNodeType = Node<CollectionNodeData, 'collection'>;

function CollectionNode({ data, selected }: NodeProps<CollectionNodeType>) {
  const { name, pathPrefix, requestCount } = data;

  return (
    <div
      style={{
        width: 180,
        background: 'var(--bg-elevated)',
        border: `1px solid ${selected ? '#4a9eff' : 'var(--border-hover)'}`,
        borderRadius: 8,
        overflow: 'hidden',
        fontFamily: 'var(--font-ui)',
        boxShadow: selected ? '0 0 0 2px rgba(74,158,255,0.2)' : 'none',
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
      }}
    >
      <Handle type="target" position={Position.Top} />

      {/* Header */}
      <div
        style={{
          padding: '8px 10px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          borderBottom: '1px solid var(--border)',
        }}
      >
        <FolderOutlined
          style={{
            color: '#fbbf24',
            fontSize: 13,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            color: 'var(--text-primary)',
            fontSize: 12,
            fontWeight: 600,
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

      {/* Path prefix */}
      {pathPrefix && (
        <div
          style={{
            padding: '5px 10px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <span
            style={{
              color: 'var(--text-secondary)',
              fontSize: 10,
              fontFamily: 'var(--font-code)',
              display: 'block',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={pathPrefix}
          >
            {pathPrefix}
          </span>
        </div>
      )}

      {/* Request count */}
      <div
        style={{
          padding: '5px 10px',
        }}
      >
        <span
          style={{
            color: 'var(--text-tertiary)',
            fontSize: 10,
          }}
        >
          {requestCount} {requestCount === 1 ? 'request' : 'requests'}
        </span>
      </div>

      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export default memo(CollectionNode);
