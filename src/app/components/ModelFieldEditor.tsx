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
import { useState, useEffect, useCallback } from 'react';
import { useModelStore } from '../stores/modelStore';
import { useProjectStore } from '../stores/projectStore';
import type { DataModel, ModelField, FieldType } from '../types';
import { parseModelFields } from '../types';

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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      if (model) {
        setName(model.name);
        setDescription(model.description ?? '');
        setFields(parseModelFields(model.fields));
      } else {
        setName('');
        setDescription('');
        setFields([]);
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
        });
        message.success('Model updated.');
      } else {
        await createModel(
          activeProjectId,
          name.trim(),
          description.trim() || undefined,
          fieldsJson,
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
