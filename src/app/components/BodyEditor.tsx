'use client';

import { Segmented, Input, Select, Button, App, Flex } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import { useState } from 'react';
import type { RequestBody } from '../types';
import { useModelStore } from '../stores/modelStore';

const { TextArea } = Input;

interface BodyEditorProps {
  body: RequestBody;
  onChange: (body: RequestBody) => void;
  requestModelId?: string;
  onModelChange?: (modelId: string | undefined) => void;
}

export function BodyEditor({ body, onChange, requestModelId, onModelChange }: BodyEditorProps) {
  const { message } = App.useApp();
  const models = useModelStore((s) => s.models);
  const generateJson = useModelStore((s) => s.generateJson);
  const [generating, setGenerating] = useState(false);

  const modelOptions = models.map((m) => ({ label: m.name, value: m.id }));

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

  return (
    <div className="space-y-3 px-1 pb-2">
      <Flex align="center" gap={8}>
        <Select
          size="small"
          placeholder="Link to model..."
          allowClear
          value={requestModelId ?? undefined}
          options={modelOptions}
          onChange={(value) => onModelChange?.(value ?? undefined)}
          style={{ minWidth: 180 }}
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
      </Flex>
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
