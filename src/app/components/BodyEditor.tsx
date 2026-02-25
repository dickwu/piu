'use client';

import { Segmented, Input } from 'antd';
import type { RequestBody } from '../types';

const { TextArea } = Input;

interface BodyEditorProps {
  body: RequestBody;
  onChange: (body: RequestBody) => void;
}

export function BodyEditor({ body, onChange }: BodyEditorProps) {
  return (
    <div className="space-y-2 pb-2">
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
        style={{
          fontFamily: 'monospace',
          fontSize: 13,
        }}
      />
    </div>
  );
}
