import type { ModelField } from '../types';

export interface ValidationIssue {
  field: string;
  issue: string;
  severity: 'error' | 'warning';
}

interface ValidateOptions {
  direction?: 'request' | 'response';
}

const TEMPLATE_VAR_REGEX = /\{\{[^}]+\}\}/;

/**
 * Validate a JSON string against model fields.
 * When direction is 'request', template variables ({{var}}) are tolerated.
 */
export function validateJsonAgainstModel(
  jsonBody: string,
  fields: ModelField[],
  options?: ValidateOptions,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const isRequest = options?.direction === 'request';
  let parsed: Record<string, unknown>;

  try {
    parsed = JSON.parse(jsonBody) as Record<string, unknown>;
  } catch {
    return [{ field: '(root)', issue: 'Body is not valid JSON', severity: 'error' }];
  }

  for (const field of fields) {
    const value = parsed[field.name];

    if (field.required && !(field.name in parsed)) {
      issues.push({ field: field.name, issue: 'Missing required field', severity: 'error' });
      continue;
    }

    if (value === undefined) continue;

    // In request mode, skip validation for template variables
    if (isRequest && typeof value === 'string' && TEMPLATE_VAR_REGEX.test(value)) {
      continue;
    }

    if (value === null) {
      const expectedType = field.field_type;
      if (expectedType === 'null' || expectedType === 'any') continue;
      issues.push({
        field: field.name,
        issue: `Expected ${expectedType}, got null`,
        severity: 'warning',
      });
      continue;
    }

    const actualType = Array.isArray(value) ? 'array' : typeof value;
    const expectedType = field.field_type;

    if (
      expectedType !== 'any' &&
      expectedType !== 'null' &&
      actualType !== expectedType
    ) {
      issues.push({
        field: field.name,
        issue: `Expected ${expectedType}, got ${actualType}`,
        severity: 'error',
      });
    }
  }

  // Warn about extra fields not in the model
  const modelFieldNames = new Set(fields.map((f) => f.name));
  for (const key of Object.keys(parsed)) {
    if (!modelFieldNames.has(key)) {
      issues.push({
        field: key,
        issue: 'Field not defined in model',
        severity: 'warning',
      });
    }
  }

  return issues;
}
