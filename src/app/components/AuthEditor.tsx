'use client';

import { Select, Input } from 'antd';
import type { AuthConfig } from '../types';

interface AuthEditorProps {
  auth: AuthConfig;
  onChange: (auth: AuthConfig) => void;
}

export function AuthEditor({ auth, onChange }: AuthEditorProps) {
  return (
    <div className="space-y-3 pb-2">
      <div className="flex items-center gap-2">
        <span className="w-20 text-sm" style={{ color: 'var(--text-secondary)' }}>
          Type:
        </span>
        <Select
          size="small"
          value={auth.type}
          onChange={(type) => onChange({ ...auth, type })}
          style={{ width: 200 }}
          options={[
            { label: 'No Auth', value: 'none' },
            { label: 'Bearer Token', value: 'bearer' },
            { label: 'Basic Auth', value: 'basic' },
            { label: 'API Key', value: 'api_key' },
          ]}
        />
      </div>

      {auth.type === 'bearer' && (
        <div className="flex items-center gap-2">
          <span className="w-20 text-sm" style={{ color: 'var(--text-secondary)' }}>
            Token:
          </span>
          <Input
            size="small"
            placeholder="Bearer token (supports {{variables}})"
            value={auth.token ?? ''}
            onChange={(e) => onChange({ ...auth, token: e.target.value })}
          />
        </div>
      )}

      {auth.type === 'basic' && (
        <>
          <div className="flex items-center gap-2">
            <span className="w-20 text-sm" style={{ color: 'var(--text-secondary)' }}>
              Username:
            </span>
            <Input
              size="small"
              placeholder="Username"
              value={auth.username ?? ''}
              onChange={(e) => onChange({ ...auth, username: e.target.value })}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-20 text-sm" style={{ color: 'var(--text-secondary)' }}>
              Password:
            </span>
            <Input.Password
              size="small"
              placeholder="Password"
              value={auth.password ?? ''}
              onChange={(e) => onChange({ ...auth, password: e.target.value })}
            />
          </div>
        </>
      )}

      {auth.type === 'api_key' && (
        <>
          <div className="flex items-center gap-2">
            <span className="w-20 text-sm" style={{ color: 'var(--text-secondary)' }}>
              Header:
            </span>
            <Input
              size="small"
              placeholder="Header name (e.g. X-API-Key)"
              value={auth.header_name ?? ''}
              onChange={(e) =>
                onChange({ ...auth, header_name: e.target.value })
              }
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-20 text-sm" style={{ color: 'var(--text-secondary)' }}>
              Value:
            </span>
            <Input
              size="small"
              placeholder="API key value"
              value={auth.header_value ?? ''}
              onChange={(e) =>
                onChange({ ...auth, header_value: e.target.value })
              }
            />
          </div>
        </>
      )}
    </div>
  );
}
