import type { ModelField } from '../types';

export type FieldDiffStatus = 'added' | 'removed' | 'modified' | 'unchanged';

export interface FieldDiffEntry {
  fieldName: string;
  status: FieldDiffStatus;
  left: ModelField | null;
  right: ModelField | null;
  changes: string[]; // human-readable change descriptions
}

/**
 * Compare two field arrays and return a diff.
 * "left" is the base (e.g., parent/old version), "right" is the target (e.g., child/new version).
 */
export function diffModelFields(
  left: ModelField[],
  right: ModelField[],
): FieldDiffEntry[] {
  const entries: FieldDiffEntry[] = [];
  const leftMap = new Map(left.map(f => [f.name, f]));
  const rightMap = new Map(right.map(f => [f.name, f]));
  const allNames = new Set([...leftMap.keys(), ...rightMap.keys()]);

  for (const name of allNames) {
    const l = leftMap.get(name) ?? null;
    const r = rightMap.get(name) ?? null;

    if (!l && r) {
      entries.push({ fieldName: name, status: 'added', left: null, right: r, changes: ['Field added'] });
    } else if (l && !r) {
      entries.push({ fieldName: name, status: 'removed', left: l, right: null, changes: ['Field removed'] });
    } else if (l && r) {
      const changes: string[] = [];
      if (l.field_type !== r.field_type) changes.push(`Type: ${l.field_type} → ${r.field_type}`);
      if (l.required !== r.required) changes.push(`Required: ${l.required} → ${r.required}`);
      if (l.description !== r.description) changes.push('Description changed');
      if (l.example !== r.example) changes.push('Example changed');
      if (l.ref_model_id !== r.ref_model_id) changes.push('Reference model changed');

      entries.push({
        fieldName: name,
        status: changes.length > 0 ? 'modified' : 'unchanged',
        left: l,
        right: r,
        changes,
      });
    }
  }

  return entries;
}
