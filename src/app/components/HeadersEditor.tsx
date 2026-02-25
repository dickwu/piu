'use client';

import { Input, Switch, Button } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import type { KeyValuePair } from '../types';

interface HeadersEditorProps {
  headers: KeyValuePair[];
  onChange: (headers: KeyValuePair[]) => void;
}

export function HeadersEditor({ headers, onChange }: HeadersEditorProps) {
  const addHeader = () => {
    onChange([...headers, { key: '', value: '', enabled: true }]);
  };

  const updateHeader = (
    index: number,
    field: keyof KeyValuePair,
    value: string | boolean,
  ) => {
    onChange(
      headers.map((h, i) => (i === index ? { ...h, [field]: value } : h)),
    );
  };

  const removeHeader = (index: number) => {
    onChange(headers.filter((_, i) => i !== index));
  };

  return (
    <div className="pb-2">
      {headers.map((header, idx) => (
        <div key={idx} className="kv-row flex items-center gap-2">
          <Switch
            size="small"
            checked={header.enabled}
            onChange={(v) => updateHeader(idx, 'enabled', v)}
          />
          <Input
            size="small"
            className="input-mono"
            placeholder="Header name"
            value={header.key}
            onChange={(e) => updateHeader(idx, 'key', e.target.value)}
            style={{ flex: 1 }}
          />
          <Input
            size="small"
            className="input-mono"
            placeholder="Header value"
            value={header.value}
            onChange={(e) => updateHeader(idx, 'value', e.target.value)}
            style={{ flex: 1 }}
          />
          <Button
            size="small"
            icon={<DeleteOutlined />}
            danger
            onClick={() => removeHeader(idx)}
          />
        </div>
      ))}
      <Button
        size="small"
        type="dashed"
        icon={<PlusOutlined />}
        onClick={addHeader}
        block
      >
        Add Header
      </Button>
    </div>
  );
}
