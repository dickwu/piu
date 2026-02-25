// Types matching Rust structs

export interface Collection {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
  version: number;
  created_at: number;
  updated_at: number;
}

export interface ApiRequest {
  id: string;
  collection_id: string;
  name: string;
  sort_order: number;
  config: string; // JSON string
  version: number;
  created_at: number;
  updated_at: number;
}

export interface RequestConfig {
  method: string;
  url: string;
  headers: KeyValuePair[];
  params: KeyValuePair[];
  body: RequestBody;
  auth: AuthConfig;
}

export interface KeyValuePair {
  key: string;
  value: string;
  enabled: boolean;
}

export interface RequestBody {
  type: 'json' | 'text';
  content: string;
}

export interface AuthConfig {
  type: 'none' | 'bearer' | 'basic' | 'api_key';
  token?: string;
  username?: string;
  password?: string;
  header_name?: string;
  header_value?: string;
}

export interface Environment {
  id: string;
  name: string;
  is_active: boolean;
  sort_order: number;
  version: number;
  created_at: number;
  updated_at: number;
}

export interface EnvVariable {
  id: string;
  environment_id: string;
  key: string;
  value: string;
  enabled: boolean;
  created_at: number;
  updated_at: number;
}

export interface HttpResponse {
  status: number;
  status_text: string;
  headers: Record<string, string>;
  body: string;
  size: number;
  timing: {
    total_ms: number;
  };
}

export interface ChangelogEntry {
  id: number;
  entity_type: string;
  entity_id: string;
  entity_name: string;
  version: number;
  summary: string;
  diff: string | null;
  created_at: number;
}

export function defaultRequestConfig(): RequestConfig {
  return {
    method: 'GET',
    url: '',
    headers: [],
    params: [],
    body: { type: 'json', content: '' },
    auth: { type: 'none' },
  };
}

export function parseConfig(configStr: string): RequestConfig {
  try {
    return JSON.parse(configStr) as RequestConfig;
  } catch {
    return defaultRequestConfig();
  }
}
