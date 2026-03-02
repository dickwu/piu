'use client';

import {
  Modal,
  Input,
  Select,
  Switch,
  Button,
  Flex,
  App,
} from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useModelStore } from '../stores/modelStore';
import { useProjectStore } from '../stores/projectStore';
import type { DataModel, ModelField, FieldType } from '../types';
import { parseModelFields, parseMixinModelIds } from '../types';
import { resolveModelFields, getParentChain, getChildModels } from '../utils/modelResolution';

interface ModelFieldEditorProps {
  open: boolean;
  model: DataModel | null;
  onClose: () => void;
}

const FIELD_TYPE_OPTIONS: { label: string; value: FieldType }[] = [
  { label: 'string', value: 'string' },
  { label: 'number', value: 'number' },
  { label: 'boolean', value: 'boolean' },
  { label: 'array', value: 'array' },
  { label: 'object', value: 'object' },
  { label: 'null', value: 'null' },
  { label: 'any', value: 'any' },
];

const labelStyle = {
  color: 'var(--text-tertiary)',
  fontFamily: 'var(--font-ui)',
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
  marginBottom: 4,
  display: 'block',
};

const fieldLabelStyle = {
  color: 'var(--text-tertiary)',
  fontFamily: 'var(--font-ui)',
  fontSize: 10,
  fontWeight: 600,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
};

function emptyField(): ModelField {
  return {
    name: '',
    field_type: 'string',
    description: '',
    required: false,
    example: null,
    ref_model_id: null,
  };
}

export function ModelFieldEditor({ open, model, onClose }: ModelFieldEditorProps) {
  const { message } = App.useApp();
  const { models, createModel, updateModel } = useModelStore();
  const activeProjectId = useProjectStore((s) => s.activeProjectId);

  const isEditMode = model !== null;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [fields, setFields] = useState<ModelField[]>([]);
  const [parentModelId, setParentModelId] = useState<string | null>(null);
  const [mixinModelIds, setMixinModelIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      if (model) {
        setName(model.name);
        setDescription(model.description ?? '');
        setFields(parseModelFields(model.fields));
        setParentModelId(model.parent_model_id ?? null);
        setMixinModelIds(parseMixinModelIds(model.mixin_model_ids));
      } else {
        setName('');
        setDescription('');
        setFields([]);
        setParentModelId(null);
        setMixinModelIds([]);
      }
      setSaving(false);
    }
  }, [open, model]);

  const handleAddField = useCallback(() => {
    setFields((prev) => [...prev, emptyField()]);
  }, []);

  const handleDeleteField = useCallback((index: number) => {
    setFields((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleFieldChange = useCallback(
    (index: number, patch: Partial<ModelField>) => {
      setFields((prev) =>
        prev.map((field, i) =>
          i === index ? { ...field, ...patch } : field,
        ),
      );
    },
    [],
  );

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      message.warning('Model name is required.');
      return;
    }
    if (!activeProjectId) {
      message.error('No active project selected.');
      return;
    }

    setSaving(true);
    try {
      const fieldsJson = JSON.stringify(fields);

      if (isEditMode && model) {
        await updateModel(model.id, {
          name: name.trim(),
          description: description.trim() || null,
          fields: fieldsJson,
          parent_model_id: parentModelId,
          mixin_model_ids: JSON.stringify(mixinModelIds),
        });
        message.success('Model updated.');
      } else {
        await createModel(
          activeProjectId,
          name.trim(),
          description.trim() || undefined,
          fieldsJson,
          parentModelId ?? undefined,
          JSON.stringify(mixinModelIds),
        );
        message.success('Model created.');
      }

      onClose();
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : 'Failed to save model.',
      );
    } finally {
      setSaving(false);
    }
  }, [
    name,
    description,
    fields,
    parentModelId,
    mixinModelIds,
    activeProjectId,
    isEditMode,
    model,
    createModel,
    updateModel,
    message,
    onClose,
  ]);

  const handleCancel = useCallback(() => {
    onClose();
  }, [onClose]);

  const refModelOptions = models
    .filter((m) => !isEditMode || m.id !== model?.id)
    .map((m) => ({ label: m.name, value: m.id }));

  const eligibleParentOptions = useMemo(() => {
    if (!model) {
      return models.map((m) => ({ label: m.name, value: m.id }));
    }
    const descendants = new Set<string>();
    const collectDescendants = (id: string) => {
      getChildModels(id, models).forEach((c) => {
        if (!descendants.has(c.id)) {
          descendants.add(c.id);
          collectDescendants(c.id);
        }
      });
    };
    collectDescendants(model.id);
    return models
      .filter((m) => m.id !== model.id && !descendants.has(m.id))
      .map((m) => ({ label: m.name, value: m.id }));
  }, [model, models]);

  const eligibleMixinOptions = useMemo(() => {
    const parentChainIds = new Set(
      model ? getParentChain(model.id, models).map((m) => m.id) : [],
    );
    return models
      .filter((m) => m.id !== model?.id && !parentChainIds.has(m.id))
      .map((m) => ({ label: m.name, value: m.id }));
  }, [model, models]);

  const resolvedInheritedFields = useMemo(() => {
    if (!model) return [];
    const tempModels = models.map((m) =>
      m.id === model.id
        ? { ...m, parent_model_id: parentModelId, mixin_model_ids: JSON.stringify(mixinModelIds) }
        : m,
    );
    return resolveModelFields(model.id, tempModels).filter((f) => f.origin !== 'own');
  }, [model, models, parentModelId, mixinModelIds]);

  const isValid = name.trim() !== '';

  return (
    <Modal
      title={isEditMode ? 'Edit Model' : 'New Model'}
      open={open}
      onCancel={handleCancel}
      destroyOnHidden
      width={700}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button onClick={handleCancel}>Cancel</Button>
          <Button
            type="primary"
            onClick={handleSave}
            disabled={!isValid}
            loading={saving}
          >
            {isEditMode ? 'Save' : 'Create'}
          </Button>
        </div>
      }
    >
      <Flex vertical gap={16} style={{ padding: '8px 0' }}>
        {/* Name */}
        <div>
          <label style={labelStyle}>Name</label>
          <Input
            placeholder="UserProfile"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus={!isEditMode}
            maxLength={200}
          />
        </div>

        {/* Description */}
        <div>
          <label style={labelStyle}>Description</label>
          <Input.TextArea
            placeholder="Describe this model..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            autoSize={{ minRows: 2, maxRows: 4 }}
          />
        </div>

        {/* Parent Model */}
        <div>
          <div style={labelStyle}>Parent Model</div>
          <Select
            size="small"
            placeholder="None (no inheritance)"
            allowClear
            value={parentModelId ?? undefined}
            onChange={(val) => setParentModelId(val ?? null)}
            options={eligibleParentOptions}
            style={{ width: '100%' }}
          />
        </div>

        {/* Mixin Models */}
        <div>
          <div style={labelStyle}>Mixin Models</div>
          <Select
            mode="multiple"
            size="small"
            placeholder="None"
            value={mixinModelIds}
            onChange={(vals) => setMixinModelIds(vals)}
            options={eligibleMixinOptions}
            style={{ width: '100%' }}
          />
        </div>

        {/* Inherited Fields Preview */}
        {resolvedInheritedFields.length > 0 && (
          <div
            style={{
              marginTop: 8,
              padding: '8px 10px',
              borderRadius: 6,
              backgroundColor: 'var(--bg-tertiary)',
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: 'var(--text-tertiary)',
                marginBottom: 4,
              }}
            >
              Inherited Fields ({resolvedInheritedFields.length})
            </div>
            {resolvedInheritedFields.map((f) => (
              <div
                key={`${f.origin_model_id}-${f.name}`}
                style={{ fontSize: 12, padding: '2px 0' }}
              >
                <span style={{ fontWeight: 600 }}>{f.name}</span>
                <span style={{ color: 'var(--text-tertiary)', marginLeft: 6 }}>
                  {f.field_type}
                </span>
                <span
                  style={{
                    color: 'var(--text-quaternary)',
                    marginLeft: 6,
                    fontSize: 10,
                  }}
                >
                  from {f.origin_model_name}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Fields section */}
        <div>
          <label style={labelStyle}>
            Fields ({fields.length})
          </label>

          {fields.length > 0 && (
            <div
              style={{
                borderRadius: 6,
                border: '1px solid var(--border)',
                overflow: 'hidden',
                marginBottom: 8,
              }}
            >
              {/* Column headers */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 110px 1fr 56px 1fr 130px 32px',
                  gap: 6,
                  padding: '6px 8px',
                  background: 'var(--bg-secondary)',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                {['Name', 'Type', 'Description', 'Req', 'Example', 'Ref Model', ''].map(
                  (col) => (
                    <span key={col} style={fieldLabelStyle}>
                      {col}
                    </span>
                  ),
                )}
              </div>

              {/* Field rows */}
              {fields.map((field, index) => {
                const canRef =
                  field.field_type === 'object' ||
                  field.field_type === 'array';

                return (
                  <div
                    key={index}
                    style={{
                      display: 'grid',
                      gridTemplateColumns:
                        '1fr 110px 1fr 56px 1fr 130px 32px',
                      gap: 6,
                      padding: '6px 8px',
                      alignItems: 'center',
                      borderBottom:
                        index < fields.length - 1
                          ? '1px solid var(--border)'
                          : 'none',
                    }}
                  >
                    {/* Name */}
                    <Input
                      size="small"
                      placeholder="fieldName"
                      value={field.name}
                      onChange={(e) =>
                        handleFieldChange(index, { name: e.target.value })
                      }
                    />

                    {/* Type */}
                    <Select
                      size="small"
                      value={field.field_type}
                      onChange={(val) => {
                        const patch: Partial<ModelField> = { field_type: val };
                        if (val !== 'object' && val !== 'array') {
                          patch.ref_model_id = null;
                        }
                        handleFieldChange(index, patch);
                      }}
                      options={FIELD_TYPE_OPTIONS}
                      style={{ width: '100%' }}
                    />

                    {/* Description */}
                    <Input
                      size="small"
                      placeholder="Description"
                      value={field.description}
                      onChange={(e) =>
                        handleFieldChange(index, {
                          description: e.target.value,
                        })
                      }
                    />

                    {/* Required */}
                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                      <Switch
                        size="small"
                        checked={field.required}
                        onChange={(checked) =>
                          handleFieldChange(index, { required: checked })
                        }
                      />
                    </div>

                    {/* Example */}
                    <Input
                      size="small"
                      placeholder="e.g. John"
                      value={field.example ?? ''}
                      onChange={(e) =>
                        handleFieldChange(index, {
                          example: e.target.value || null,
                        })
                      }
                    />

                    {/* Ref Model */}
                    <Select
                      size="small"
                      allowClear
                      disabled={!canRef}
                      placeholder="Ref model"
                      value={field.ref_model_id ?? undefined}
                      onChange={(val) =>
                        handleFieldChange(index, {
                          ref_model_id: val ?? null,
                        })
                      }
                      options={refModelOptions}
                      style={{ width: '100%' }}
                    />

                    {/* Delete */}
                    <Button
                      type="text"
                      danger
                      size="small"
                      icon={<DeleteOutlined />}
                      onClick={() => handleDeleteField(index)}
                      style={{ padding: 0, width: 28, height: 28 }}
                    />
                  </div>
                );
              })}
            </div>
          )}

          <Button
            type="dashed"
            size="small"
            icon={<PlusOutlined />}
            onClick={handleAddField}
            block
          >
            Add Field
          </Button>
        </div>
      </Flex>
    </Modal>
  );
}
