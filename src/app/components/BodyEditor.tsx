'use client';

import { Segmented, Input, Button, App, Flex, Dropdown } from 'antd';
import { ThunderboltOutlined, UnorderedListOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { useState, useMemo, useRef } from 'react';
import type { RequestBody } from '../types';
import { useModelStore } from '../stores/modelStore';
import { ModelSelector } from './shared/ModelSelector';
import { resolveModelFields } from '../utils/modelResolution';
import { validateJsonAgainstModel } from '../utils/modelValidation';

const { TextArea } = Input;

interface BodyEditorProps {
  body: RequestBody;
  onChange: (body: RequestBody) => void;
  requestModelId?: string;
  onModelChange?: (modelId: string | undefined) => void;
}

function getDefaultValue(fieldType: string, example: string | null): string {
  if (example) {
    if (fieldType === 'string') return `"${example}"`;
    return example;
  }
  switch (fieldType) {
    case 'string': return '""';
    case 'number': return '0';
    case 'boolean': return 'false';
    case 'array': return '[]';
    case 'object': return '{}';
    default: return 'null';
  }
}

export function BodyEditor({ body, onChange, requestModelId, onModelChange }: BodyEditorProps) {
  const { message } = App.useApp();
  const models = useModelStore((s) => s.models);
  const generateJson = useModelStore((s) => s.generateJson);
  const [generating, setGenerating] = useState(false);
  const textAreaRef = useRef<any>(null);

  const resolvedFields = useMemo(() => {
    if (!requestModelId) return [];
    return resolveModelFields(requestModelId, models);
  }, [requestModelId, models]);

  const validationIssues = useMemo(() => {
    if (!requestModelId || body.type !== 'json' || !body.content.trim()) return [];
    return validateJsonAgainstModel(body.content, resolvedFields, { direction: 'request' });
  }, [requestModelId, body.content, body.type, resolvedFields]);

  const handleGenerate = async () => {
    if (!requestModelId) return;
    setGenerating(true);
    try {
      const result = await generateJson(requestModelId);
      onChange({ ...body, type: 'json', content: result });
      message.success('JSON generated from model');
    } catch (err) {
      message.error(`Failed to generate JSON: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setGenerating(false);
    }
  };

  const handleInsertField = (field: { name: string; field_type: string; example: string | null }) => {
    const defaultValue = getDefaultValue(field.field_type, field.example);
    const insertion = `"${field.name}": ${defaultValue}`;

    const textarea = textAreaRef.current?.resizableTextArea?.textArea;
    if (textarea) {
      const start = textarea.selectionStart;
      const before = body.content.slice(0, start);
      const after = body.content.slice(start);
      onChange({ ...body, content: before + insertion + after });
    } else {
      // Fallback: append
      const content = body.content.trimEnd();
      const separator = content.endsWith('{') || !content ? '' : ',\n  ';
      onChange({ ...body, content: content + separator + insertion });
    }
  };

  const errorCount = validationIssues.filter((i) => i.severity === 'error').length;
  const warningCount = validationIssues.filter((i) => i.severity === 'warning').length;

  return (
    <div className="space-y-3 px-1 pb-2">
      <Flex align="center" gap={8}>
        <ModelSelector
          value={requestModelId}
          onChange={(val) => onModelChange?.(val)}
          placeholder="Link to model..."
        />
        {requestModelId && models.some((m) => m.id === requestModelId) && (
          <Button
            size="small"
            icon={<ThunderboltOutlined />}
            onClick={handleGenerate}
            loading={generating}
          >
            Generate
          </Button>
        )}
        {requestModelId && resolvedFields.length > 0 && (
          <Dropdown
            trigger={['click']}
            menu={{
              items: resolvedFields.map((f) => ({
                key: f.name,
                label: (
                  <div>
                    <span style={{ fontWeight: 600 }}>{f.name}</span>
                    <span style={{ color: 'var(--text-tertiary)', marginLeft: 8, fontSize: 12 }}>
                      {f.field_type}
                    </span>
                    {f.origin !== 'own' && (
                      <span style={{ color: 'var(--text-quaternary)', marginLeft: 6, fontSize: 10 }}>
                        ({f.origin}: {f.origin_model_name})
                      </span>
                    )}
                  </div>
                ),
                onClick: () => handleInsertField(f),
              })),
            }}
          >
            <Button size="small" icon={<UnorderedListOutlined />}>Fields</Button>
          </Dropdown>
        )}
        {requestModelId && resolvedFields.length > 0 && body.content.trim() && (
          <>
            {validationIssues.length === 0 ? (
              <span style={{ fontSize: 12, color: 'var(--success)' }}>
                <CheckCircleOutlined style={{ marginRight: 4 }} />
                Valid
              </span>
            ) : (
              <span style={{ fontSize: 12, color: 'var(--error)' }}>
                {errorCount} error(s)
                {warningCount > 0 && `, ${warningCount} warning(s)`}
              </span>
            )}
          </>
        )}
      </Flex>
      {validationIssues.length > 0 && (
        <div style={{
          padding: '6px 10px',
          borderRadius: 6,
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.25)',
        }}>
          {validationIssues.map((issue, idx) => (
            <div key={idx} style={{ fontSize: 12, color: issue.severity === 'error' ? 'var(--error)' : 'var(--warning)', fontFamily: 'var(--font-code)' }}>
              <span style={{ fontWeight: 600 }}>{issue.field}</span>: {issue.issue}
            </div>
          ))}
        </div>
      )}
      <Segmented
        size="small"
        value={body.type}
        onChange={(type) => onChange({ ...body, type: type as 'json' | 'text' })}
        options={[
          { label: 'JSON', value: 'json' },
          { label: 'Text', value: 'text' },
        ]}
      />
      <TextArea
        ref={textAreaRef}
        value={body.content}
        onChange={(e) => onChange({ ...body, content: e.target.value })}
        placeholder={
          body.type === 'json'
            ? '{\n  "key": "value"\n}'
            : 'Enter raw text body...'
        }
        autoSize={{ minRows: 6, maxRows: 16 }}
        className="input-depth"
        style={{
          fontFamily: 'var(--font-code)',
          fontSize: 13,
          lineHeight: 1.6,
          letterSpacing: '-0.01em',
        }}
      />
    </div>
  );
}
