'use client';

import { Select } from 'antd';
import { useModelStore } from '../../stores/modelStore';

interface ModelSelectorProps {
  value?: string;
  onChange: (modelId: string | undefined) => void;
  placeholder?: string;
  size?: 'small' | 'middle' | 'large';
  style?: React.CSSProperties;
}

export function ModelSelector({
  value,
  onChange,
  placeholder = 'Link to model...',
  size = 'small',
  style,
}: ModelSelectorProps) {
  const models = useModelStore((s) => s.models);

  const modelOptions = models.map((m) => ({
    label: m.name,
    value: m.id,
  }));

  return (
    <Select
      size={size}
      placeholder={placeholder}
      allowClear
      value={value ?? undefined}
      options={modelOptions}
      onChange={(val) => onChange(val ?? undefined)}
      style={style ?? { minWidth: 180 }}
    />
  );
}
