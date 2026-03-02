import type { DataModel, ResolvedModelField, FieldOrigin } from '../types';
import { parseModelFields, parseMixinModelIds } from '../types';

const MAX_DEPTH = 10;

/**
 * Resolve all fields for a model including inherited (parent chain) and mixed-in fields.
 * Strict linearization: base chain (root→parent, oldest first) → mixins (declared order) → self.
 * Later entries override earlier by field name.
 *
 * This is an OPTIMISTIC PREVIEW — the Rust resolver is authoritative for execution-time operations.
 */
export function resolveModelFields(
  modelId: string,
  allModels: DataModel[],
): ResolvedModelField[] {
  const modelMap = new Map(allModels.map((m) => [m.id, m]));
  const model = modelMap.get(modelId);
  if (!model) return [];

  // Build the resolution order: parent chain (oldest first) → mixins → self
  const parentChain = getParentChain(modelId, allModels);
  // parentChain is [immediate_parent, grandparent, ..., root] — reverse for oldest first
  const ancestors = [...parentChain].reverse();

  const fieldMap = new Map<string, ResolvedModelField>();

  // 1. Add ancestor fields (oldest first, so newer ancestors override older)
  for (const ancestor of ancestors) {
    addFieldsFromModel(ancestor, 'parent', fieldMap);
  }

  // 2. Add mixin fields (in declared order)
  const mixinIds = parseMixinModelIds(model.mixin_model_ids);
  for (const mixinId of mixinIds) {
    const mixin = modelMap.get(mixinId);
    if (mixin) {
      addFieldsFromModel(mixin, 'mixin', fieldMap);
    }
  }

  // 3. Add own fields (highest priority)
  addFieldsFromModel(model, 'own', fieldMap);

  return Array.from(fieldMap.values());
}

function addFieldsFromModel(
  model: DataModel,
  origin: FieldOrigin,
  fieldMap: Map<string, ResolvedModelField>,
): void {
  const fields = parseModelFields(model.fields);
  for (const field of fields) {
    const existing = fieldMap.get(field.name);
    if (existing) {
      fieldMap.set(field.name, { ...existing, overridden: true });
    }
    fieldMap.set(field.name, {
      ...field,
      origin,
      origin_model_id: model.id,
      origin_model_name: model.name,
      overridden: false,
    });
  }
}

/**
 * Get parent chain for a model (immediate parent first, root last).
 * Returns empty array if no parent or cycle detected.
 */
export function getParentChain(
  modelId: string,
  allModels: DataModel[],
): DataModel[] {
  const modelMap = new Map(allModels.map((m) => [m.id, m]));
  const chain: DataModel[] = [];
  const visited = new Set<string>();
  visited.add(modelId);

  let currentId = modelMap.get(modelId)?.parent_model_id;
  let depth = 0;

  while (currentId && depth < MAX_DEPTH) {
    if (visited.has(currentId)) break; // cycle detected
    visited.add(currentId);
    const parent = modelMap.get(currentId);
    if (!parent) break;
    chain.push(parent);
    currentId = parent.parent_model_id;
    depth++;
  }

  return chain;
}

/**
 * Get direct children of a model (models whose parent_model_id is modelId).
 */
export function getChildModels(
  modelId: string,
  allModels: DataModel[],
): DataModel[] {
  return allModels.filter((m) => m.parent_model_id === modelId);
}
