'use client';

import { Tooltip } from 'antd';
import { WarningOutlined } from '@ant-design/icons';
import type { ModelField } from '../types';

interface AnnotatedJsonViewerProps {
  json: string;
  fields: ModelField[];
}

function buildFieldMap(fields: ModelField[]): Map<string, ModelField> {
  return new Map(fields.map((f) => [f.name, f]));
}

function buildTooltipContent(field: ModelField): React.ReactNode {
  return (
    <div style={{ fontFamily: 'var(--font-code)', fontSize: 12 }}>
      <div>
        <span style={{ color: 'var(--text-tertiary)' }}>type: </span>
        <span style={{ color: '#60a5fa' }}>{field.field_type}</span>
        {field.required && (
          <span style={{ color: 'var(--error)', marginLeft: 6 }}>required</span>
        )}
      </div>
      {field.description && (
        <div style={{ color: 'var(--text-secondary)', marginTop: 2 }}>
          {field.description}
        </div>
      )}
      {field.example !== null && (
        <div style={{ marginTop: 2 }}>
          <span style={{ color: 'var(--text-tertiary)' }}>example: </span>
          <span style={{ color: '#34d399' }}>{field.example}</span>
        </div>
      )}
    </div>
  );
}

function annotateLine(line: string, fieldMap: Map<string, ModelField>): React.ReactNode {
  // Match a JSON key pattern: optional whitespace, then "fieldname":
  const keyMatch = line.match(/^(\s*)"([^"]+)"(\s*:.*)/);
  if (!keyMatch) return line;

  const [, indent, fieldName, rest] = keyMatch;
  const field = fieldMap.get(fieldName);

  if (!field) return line;

  return (
    <>
      {indent}&quot;
      <Tooltip title={buildTooltipContent(field)} placement="right">
        <span
          style={{
            borderBottom: '1px dotted var(--accent)',
            cursor: 'help',
            color: 'var(--accent)',
          }}
        >
          {fieldName}
        </span>
      </Tooltip>
      &quot;{rest}
    </>
  );
}

export function AnnotatedJsonViewer({ json, fields }: AnnotatedJsonViewerProps) {
  let formatted: string;
  let parseOk = true;

  try {
    formatted = JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    formatted = json;
    parseOk = false;
  }

  const fieldMap = buildFieldMap(fields);

  // Find missing required fields when JSON parsed successfully
  const missingRequired: string[] = [];
  if (parseOk && fields.length > 0) {
    try {
      const parsed = JSON.parse(json) as Record<string, unknown>;
      for (const field of fields) {
        if (field.required && !(field.name in parsed)) {
          missingRequired.push(field.name);
        }
      }
    } catch {
      // already handled above
    }
  }

  const lines = formatted.split('\n');

  return (
    <div>
      <pre
        className="code-block overflow-auto"
        style={{
          fontFamily: 'var(--font-code)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          maxHeight: 'calc(100vh - 400px)',
        }}
      >
        {lines.map((line, idx) => (
          <div key={idx}>{annotateLine(line, fieldMap)}</div>
        ))}
      </pre>
      {missingRequired.length > 0 && (
        <div
          style={{
            marginTop: 8,
            padding: '6px 10px',
            borderRadius: 6,
            backgroundColor: 'rgba(245, 158, 11, 0.12)',
            border: '1px solid rgba(245, 158, 11, 0.3)',
          }}
        >
          <span style={{ color: 'var(--warning)', fontSize: 12 }}>
            <WarningOutlined style={{ marginRight: 6 }} />
            Missing required field{missingRequired.length > 1 ? 's' : ''}:{' '}
            <span style={{ fontFamily: 'var(--font-code)' }}>
              {missingRequired.join(', ')}
            </span>
          </span>
        </div>
      )}
    </div>
  );
}
