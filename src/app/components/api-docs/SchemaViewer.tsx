'use client';

import { Tag, Flex } from 'antd';
import { CaretRightOutlined, CaretDownOutlined } from '@ant-design/icons';
import { useState, useMemo } from 'react';
import { getSchemaByRef, type SchemaObject } from './openapi-utils';

interface Props {
  schema: SchemaObject;
  spec: Record<string, unknown>;
  name?: string;
  depth?: number;
}

function resolveSchema(
  schema: SchemaObject,
  spec: Record<string, unknown>,
): SchemaObject {
  if (schema.$ref) {
    return getSchemaByRef(spec, schema.$ref) ?? schema;
  }
  if (schema.allOf && schema.allOf.length > 0) {
    return schema.allOf.reduce<SchemaObject>(
      (merged, part) => {
        const resolved = resolveSchema(part, spec);
        return {
          ...merged,
          ...resolved,
          properties: { ...(merged.properties ?? {}), ...(resolved.properties ?? {}) },
          required: [
            ...(merged.required ?? []),
            ...(resolved.required ?? []),
          ],
        };
      },
      {},
    );
  }
  return schema;
}

function typeLabel(schema: SchemaObject): string {
  if (schema.type === 'array' && schema.items) {
    const itemType = schema.items.type ?? schema.items.$ref?.split('/').pop() ?? 'object';
    return `${itemType}[]`;
  }
  return schema.type ?? schema.$ref?.split('/').pop() ?? 'object';
}

function typeColor(schema: SchemaObject): string {
  const t = schema.type ?? '';
  if (t === 'string') return '#52c41a';
  if (t === 'number' || t === 'integer') return '#1677ff';
  if (t === 'boolean') return '#fa8c16';
  if (t === 'array') return '#722ed1';
  if (t === 'object') return '#8c8c8c';
  return '#8c8c8c';
}

interface PropertyRowProps {
  name: string;
  schema: SchemaObject;
  spec: Record<string, unknown>;
  isRequired: boolean;
  depth: number;
}

function PropertyRow({ name, schema, spec, isRequired, depth }: PropertyRowProps) {
  const resolved = useMemo(() => resolveSchema(schema, spec), [schema, spec]);
  const hasChildren =
    resolved.type === 'object' && resolved.properties && Object.keys(resolved.properties).length > 0;
  const [expanded, setExpanded] = useState(depth < 1);

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 6,
          padding: '4px 0',
          paddingLeft: depth * 16,
          borderBottom: '1px solid var(--ant-color-border)',
        }}
      >
        {hasChildren ? (
          <span
            role="button"
            tabIndex={0}
            onClick={() => setExpanded((v) => !v)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') setExpanded((v) => !v);
            }}
            style={{ cursor: 'pointer', color: 'var(--ant-color-text-tertiary)', paddingTop: 2 }}
          >
            {expanded ? (
              <CaretDownOutlined style={{ fontSize: 10 }} />
            ) : (
              <CaretRightOutlined style={{ fontSize: 10 }} />
            )}
          </span>
        ) : (
          <span style={{ width: 10, display: 'inline-block' }} />
        )}

        <Flex align="center" gap={6} wrap="wrap" style={{ flex: 1, minWidth: 0 }}>
          <span
            style={{
              fontFamily: 'monospace',
              fontSize: 12,
              color: 'var(--ant-color-text)',
              fontWeight: 500,
            }}
          >
            {name}
          </span>
          {isRequired && (
            <span style={{ color: '#ff4d4f', fontSize: 11 }}>*</span>
          )}
          <Tag
            style={{
              fontSize: 10,
              lineHeight: '16px',
              padding: '0 5px',
              marginInlineEnd: 0,
              color: '#fff',
              background: typeColor(resolved),
              border: 'none',
            }}
          >
            {typeLabel(resolved)}
          </Tag>
          {resolved.description && (
            <span style={{ fontSize: 11, color: 'var(--ant-color-text-tertiary)', flex: 1 }}>
              {resolved.description}
            </span>
          )}
          {resolved.example !== undefined && (
            <span
              style={{
                fontSize: 10,
                fontFamily: 'monospace',
                color: 'var(--ant-color-text-secondary)',
                background: 'var(--ant-color-fill-quaternary)',
                borderRadius: 3,
                padding: '0 4px',
              }}
            >
              ex: {JSON.stringify(resolved.example)}
            </span>
          )}
        </Flex>
      </div>

      {hasChildren && expanded && resolved.properties &&
        Object.entries(resolved.properties).map(([childName, childSchema]) => (
          <PropertyRow
            key={childName}
            name={childName}
            schema={childSchema}
            spec={spec}
            isRequired={(resolved.required ?? []).includes(childName)}
            depth={depth + 1}
          />
        ))
      }
    </>
  );
}

export function SchemaViewer({ schema, spec, name, depth = 0 }: Props) {
  const resolved = useMemo(() => resolveSchema(schema, spec), [schema, spec]);
  const properties = resolved.properties ?? {};
  const required = resolved.required ?? [];

  if (Object.keys(properties).length === 0) {
    return (
      <div style={{ fontSize: 12, color: 'var(--ant-color-text-tertiary)', padding: '8px 0' }}>
        {name ? `${name}: ` : ''}{typeLabel(resolved)}
        {resolved.description ? ` — ${resolved.description}` : ''}
      </div>
    );
  }

  return (
    <div style={{ fontSize: 12 }}>
      {name && (
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--ant-color-text-secondary)',
            marginBottom: 4,
          }}
        >
          {name}
        </div>
      )}
      {Object.entries(properties).map(([propName, propSchema]) => (
        <PropertyRow
          key={propName}
          name={propName}
          schema={propSchema}
          spec={spec}
          isRequired={required.includes(propName)}
          depth={depth}
        />
      ))}
    </div>
  );
}
