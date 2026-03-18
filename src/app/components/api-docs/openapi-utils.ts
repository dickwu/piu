export interface OperationEntry {
  method: string;
  path: string;
  operationId: string;
  summary: string;
  description: string;
  tags: string[];
  requestId: string | null;
}

export interface ParameterEntry {
  name: string;
  in: 'path' | 'query' | 'header';
  required: boolean;
  type: string;
}

export interface SchemaObject {
  type?: string;
  properties?: Record<string, SchemaObject>;
  required?: string[];
  description?: string;
  example?: unknown;
  $ref?: string;
  allOf?: SchemaObject[];
  items?: SchemaObject;
}

type OpenApiSpec = Record<string, unknown>;

export function getOperations(spec: OpenApiSpec): OperationEntry[] {
  const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>> | undefined;
  if (!paths) return [];

  const operations: OperationEntry[] = [];
  const methods = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'];

  for (const [path, pathItem] of Object.entries(paths)) {
    for (const method of methods) {
      const op = pathItem[method];
      if (!op) continue;
      operations.push({
        method: method.toUpperCase(),
        path,
        operationId: (op.operationId as string) ?? '',
        summary: (op.summary as string) ?? '',
        description: (op.description as string) ?? '',
        tags: (op.tags as string[]) ?? [],
        requestId: (op['x-piu-request-id'] as string) ?? null,
      });
    }
  }

  return operations;
}

export function getSchemaByRef(
  spec: OpenApiSpec,
  refPath: string,
): SchemaObject | null {
  const parts = refPath.replace('#/', '').split('/');
  let current: unknown = spec;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return null;
    }
  }
  return current as SchemaObject;
}

export function getParameters(
  operation: Record<string, unknown>,
): ParameterEntry[] {
  const params = operation.parameters as Array<Record<string, unknown>> | undefined;
  if (!params) return [];
  return params.map((p) => ({
    name: (p.name as string) ?? '',
    in: (p.in as 'path' | 'query' | 'header') ?? 'query',
    required: (p.required as boolean) ?? false,
    type: ((p.schema as Record<string, unknown>)?.type as string) ?? 'string',
  }));
}

export function getRequestBody(
  operation: Record<string, unknown>,
  spec: OpenApiSpec,
): SchemaObject | null {
  const body = operation.requestBody as Record<string, unknown> | undefined;
  if (!body) return null;
  const content = body.content as Record<string, Record<string, unknown>> | undefined;
  if (!content) return null;
  const jsonContent = content['application/json'];
  if (!jsonContent) return null;
  const schema = jsonContent.schema as SchemaObject | undefined;
  if (!schema) return null;
  if (schema.$ref) {
    return getSchemaByRef(spec, schema.$ref);
  }
  return schema;
}

export function getResponseBody(
  operation: Record<string, unknown>,
  spec: OpenApiSpec,
): SchemaObject | null {
  const responses = operation.responses as Record<string, Record<string, unknown>> | undefined;
  if (!responses) return null;
  const ok = responses['200'];
  if (!ok) return null;
  const content = ok.content as Record<string, Record<string, unknown>> | undefined;
  if (!content) return null;
  const jsonContent = content['application/json'];
  if (!jsonContent) return null;
  const schema = jsonContent.schema as SchemaObject | undefined;
  if (!schema) return null;
  if (schema.$ref) {
    return getSchemaByRef(spec, schema.$ref);
  }
  return schema;
}

export function filterOperations(
  operations: OperationEntry[],
  query: string,
): OperationEntry[] {
  if (!query.trim()) return operations;
  const lower = query.toLowerCase();
  return operations.filter(
    (op) =>
      op.path.toLowerCase().includes(lower) ||
      op.method.toLowerCase().includes(lower) ||
      op.summary.toLowerCase().includes(lower) ||
      op.tags.some((t) => t.toLowerCase().includes(lower)),
  );
}

export function groupOperationsByTag(
  operations: OperationEntry[],
): Map<string, OperationEntry[]> {
  const groups = new Map<string, OperationEntry[]>();
  for (const op of operations) {
    const tag = op.tags[0] ?? 'Ungrouped';
    const existing = groups.get(tag) ?? [];
    groups.set(tag, [...existing, op]);
  }
  return groups;
}
