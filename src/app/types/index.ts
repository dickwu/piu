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
  requestModelId?: string;
  responseModelId?: string;
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

// Data model types

export type FieldType = 'string' | 'number' | 'boolean' | 'array' | 'object' | 'null' | 'any';

export interface ModelField {
  name: string;
  field_type: FieldType;
  description: string;
  required: boolean;
  example: string | null;
  ref_model_id: string | null;
}

export interface DataModel {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  fields: string; // JSON array of ModelField
  parent_model_id: string | null;
  mixin_model_ids: string; // JSON array of model IDs
  sort_order: number;
  version: number;
  created_at: number;
  updated_at: number;
}

export type FieldOrigin = 'own' | 'parent' | 'mixin';

export interface ResolvedModelField extends ModelField {
  origin: FieldOrigin;
  origin_model_id: string;
  origin_model_name: string;
  overridden: boolean;
}

export function parseModelFields(fieldsJson: string): ModelField[] {
  try {
    const parsed = JSON.parse(fieldsJson);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is ModelField =>
        typeof item === 'object' &&
        item !== null &&
        typeof item.name === 'string' &&
        typeof item.field_type === 'string',
    );
  } catch {
    return [];
  }
}

export function parseMixinModelIds(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
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

export function parseQueryParamsFromUrl(url: string): {
  path: string;
  params: KeyValuePair[];
} {
  const qIndex = url.indexOf('?');
  if (qIndex === -1) return { path: url, params: [] };

  const path = url.slice(0, qIndex);
  const queryString = url.slice(qIndex + 1);
  const params = queryString
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const eqIndex = pair.indexOf('=');
      if (eqIndex === -1) return { key: decodeURIComponent(pair), value: '', enabled: true };
      return {
        key: decodeURIComponent(pair.slice(0, eqIndex)),
        value: decodeURIComponent(pair.slice(eqIndex + 1)),
        enabled: true,
      };
    });

  return { path, params };
}

// Sync types

export interface SyncServerStatus {
  running: boolean;
  port?: number;
  join_key?: string;
  project_id?: string;
}

export interface SyncResult {
  pulled_created: number;
  pulled_updated: number;
  pushed: number;
  deleted: number;
  errors: string[];
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
