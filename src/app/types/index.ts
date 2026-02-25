// Types matching Rust structs

export interface Project {
  id: string;
  name: string;
  description: string | null;
  sort_order: number;
  version: number;
  created_at: number;
  updated_at: number;
}

export interface Collection {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
  path_prefix: string | null;
  description: string | null;
  shared_headers: string;
  project_id: string | null;
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
  description?: string;
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
  project_id: string | null;
  host: string | null;
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

// Execution progress via Tauri events
export type ExecutionPhase =
  | 'resolving'
  | 'connecting'
  | 'sending'
  | 'complete'
  | 'error';

export interface ExecutionProgress {
  phase: ExecutionPhase;
  execution_id: string;
  url?: string;
  response?: HttpResponse;
  error?: string;
}

// Update status for status bar
export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'up_to_date' }
  | { state: 'available'; version: string }
  | { state: 'downloading'; version: string; progress: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string };

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

export function parseSharedHeaders(json: string): KeyValuePair[] {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is KeyValuePair =>
        typeof item === 'object' &&
        item !== null &&
        typeof item.key === 'string' &&
        typeof item.value === 'string' &&
        typeof item.enabled === 'boolean',
    );
  } catch {
    return [];
  }
}
