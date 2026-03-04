'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { ModelNodeData } from '../../utils/apiModelMapLayout';

type ModelNodeType = Node<ModelNodeData, 'model'>;

const MAX_VISIBLE_FIELDS = 5;

function ModelNode({ data, selected }: NodeProps<ModelNodeType>) {
  const { name, fieldCount, fieldPreview } = data;

  const visibleFields = fieldPreview.slice(0, MAX_VISIBLE_FIELDS);
  const overflowCount = fieldCount - visibleFields.length;

  return (
    <div
      style={{
        minWidth: 180,
        background: 'var(--bg-elevated)',
        border: `1px solid ${selected ? '#4a9eff' : 'rgba(74,158,255,0.25)'}`,
        borderRadius: 8,
        overflow: 'hidden',
        fontFamily: 'var(--font-ui)',
        boxShadow: selected ? '0 0 0 2px rgba(74,158,255,0.2)' : 'none',
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
      }}
    >
      <Handle type="target" position={Position.Top} />
      <Handle type="target" position={Position.Left} id="left-target" />

      {/* Header */}
      <div
        style={{
          background: 'rgba(74,158,255,0.08)',
          borderBottom: '1px solid rgba(74,158,255,0.15)',
          padding: '7px 10px',
        }}
      >
        <div
          style={{
            color: 'var(--text-primary)',
            fontSize: 12,
            fontWeight: 700,
            fontFamily: 'var(--font-ui)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={name}
        >
          {name}
        </div>
        <div
          style={{
            color: 'var(--text-tertiary)',
            fontSize: 10,
            marginTop: 2,
          }}
        >
          {fieldCount} {fieldCount === 1 ? 'field' : 'fields'}
        </div>
      </div>

      {/* Field preview */}
      {visibleFields.length > 0 && (
        <div style={{ padding: '6px 0' }}>
          {visibleFields.map((field) => (
            <div
              key={field.name}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                padding: '2px 10px',
                gap: 8,
              }}
            >
              <span
                style={{
                  color: field.required ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontSize: 10,
                  fontFamily: 'var(--font-code)',
                  fontWeight: field.required ? 700 : 400,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flexShrink: 1,
                  minWidth: 0,
                }}
                title={field.name}
              >
                {field.required ? `${field.name}*` : field.name}
              </span>
              <span
                style={{
                  color: 'var(--text-tertiary)',
                  fontSize: 9,
                  fontFamily: 'var(--font-code)',
                  flexShrink: 0,
                }}
              >
                {field.type}
              </span>
            </div>
          ))}

          {overflowCount > 0 && (
            <div
              style={{
                padding: '3px 10px 1px',
                color: 'var(--text-tertiary)',
                fontSize: 9,
                fontFamily: 'var(--font-ui)',
                fontStyle: 'italic',
              }}
            >
              +{overflowCount} more
            </div>
          )}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export default memo(ModelNode);
