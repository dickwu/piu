'use client';

import { Input, Switch, Button } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import type { KeyValuePair } from '../types';

interface ParamsEditorProps {
  params: KeyValuePair[];
  onChange: (params: KeyValuePair[]) => void;
}

export function ParamsEditor({ params, onChange }: ParamsEditorProps) {
  const addParam = () => {
    onChange([...params, { key: '', value: '', enabled: true }]);
  };

  const updateParam = (
    index: number,
    field: keyof KeyValuePair,
    value: string | boolean,
  ) => {
    onChange(
      params.map((p, i) => (i === index ? { ...p, [field]: value } : p)),
    );
  };

  const removeParam = (index: number) => {
    onChange(params.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-1 pb-2">
      {params.map((param, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <Switch
            size="small"
            checked={param.enabled}
            onChange={(v) => updateParam(idx, 'enabled', v)}
          />
          <Input
            size="small"
            placeholder="Key"
            value={param.key}
            onChange={(e) => updateParam(idx, 'key', e.target.value)}
            style={{ flex: 1 }}
          />
          <Input
            size="small"
            placeholder="Value"
            value={param.value}
            onChange={(e) => updateParam(idx, 'value', e.target.value)}
            style={{ flex: 1 }}
          />
          <Button
            size="small"
            icon={<DeleteOutlined />}
            danger
            onClick={() => removeParam(idx)}
          />
        </div>
      ))}
      <Button
        size="small"
        type="dashed"
        icon={<PlusOutlined />}
        onClick={addParam}
        block
      >
        Add Parameter
      </Button>
    </div>
  );
}
