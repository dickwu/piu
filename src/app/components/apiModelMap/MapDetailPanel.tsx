'use client';

import { Button, Flex, Tag } from 'antd';
import { CloseOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import type {
  CollectionNodeData,
  RequestNodeData,
  ModelNodeData,
} from '../../utils/apiModelMapLayout';

const METHOD_COLORS: Record<string, string> = {
  GET: '#34d399',
  POST: '#fbbf24',
  PUT: '#60a5fa',
  DELETE: '#f87171',
  PATCH: '#c084fc',
};

const DEFAULT_METHOD_COLOR = '#94a3b8';

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Extract the raw entity ID from a graph node ID.
 * e.g. "model:abc123" → "abc123", "col:xyz" → "xyz"
 */
function extractEntityId(nodeId: string): string {
  const colonIdx = nodeId.indexOf(':');
  return colonIdx === -1 ? nodeId : nodeId.slice(colonIdx + 1);
}

export interface MapDetailPanelProps {
  nodeType: 'collection' | 'request' | 'model';
  nodeData: CollectionNodeData | RequestNodeData | ModelNodeData;
  /** React Flow node ID (e.g. "model:abc123"). Required for model edit/delete. */
  nodeId?: string;
  onClose: () => void;
  onEditModel?: (modelId: string) => void;
  onDeleteModel?: (modelId: string) => void;
}

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  right: 16,
  top: 16,
  width: 290,
  background: 'rgba(20, 22, 38, 0.96)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 10,
  padding: 16,
  zIndex: 10,
  boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
  backdropFilter: 'blur(8px)',
  maxHeight: 'calc(100% - 32px)',
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  fontFamily: 'var(--font-ui)',
};

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--text-tertiary)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  marginBottom: 3,
};

const valueStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text-secondary)',
};

function CollectionDetail({ data }: { data: CollectionNodeData }) {
  return (
    <>
      <div>
        <div style={labelStyle}>Collection</div>
        <div
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: 'var(--text-primary)',
            wordBreak: 'break-word',
          }}
        >
          {data.name}
        </div>
      </div>

      {data.pathPrefix && (
        <div>
          <div style={labelStyle}>Path Prefix</div>
          <Tag
            style={{
              fontFamily: 'var(--font-code)',
              fontSize: 11,
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: 'var(--text-secondary)',
              borderRadius: 4,
            }}
          >
            {data.pathPrefix}
          </Tag>
        </div>
      )}

      <div>
        <div style={labelStyle}>Requests</div>
        <div style={valueStyle}>
          {data.requestCount} {data.requestCount === 1 ? 'request' : 'requests'}
        </div>
      </div>
    </>
  );
}

function RequestDetail({ data }: { data: RequestNodeData }) {
  const normalizedMethod = data.method.toUpperCase();
  const methodColor = METHOD_COLORS[normalizedMethod] ?? DEFAULT_METHOD_COLOR;
  const methodBg = hexToRgba(methodColor, 0.15);

  // description may be present as an optional extra field on the node data
  const description =
    typeof (data as Record<string, unknown>).description === 'string'
      ? (data as Record<string, unknown>).description as string
      : null;

  return (
    <>
      <div>
        <div style={labelStyle}>Request</div>
        <Flex align="center" gap={8} style={{ flexWrap: 'wrap' }}>
          <span
            style={{
              background: methodBg,
              color: methodColor,
              fontSize: 10,
              fontWeight: 700,
              fontFamily: 'var(--font-ui)',
              padding: '2px 7px',
              borderRadius: 4,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              flexShrink: 0,
            }}
          >
            {normalizedMethod}
          </span>
          <span
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: 'var(--text-primary)',
              wordBreak: 'break-word',
            }}
          >
            {data.name}
          </span>
        </Flex>
      </div>

      {data.url && (
        <div>
          <div style={labelStyle}>URL Path</div>
          <div
            style={{
              fontFamily: 'var(--font-code)',
              fontSize: 11,
              color: 'var(--text-secondary)',
              wordBreak: 'break-all',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 4,
              padding: '4px 8px',
            }}
          >
            {data.url}
          </div>
        </div>
      )}

      {description && (
        <div>
          <div style={labelStyle}>Description</div>
          <div
            style={{
              fontSize: 12,
              color: 'var(--text-secondary)',
              lineHeight: 1.5,
              wordBreak: 'break-word',
            }}
          >
            {description}
          </div>
        </div>
      )}
    </>
  );
}

function ModelDetail({
  data,
  modelId,
  onEdit,
  onDelete,
}: {
  data: ModelNodeData;
  modelId: string | null;
  onEdit?: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
  // description may be present as an optional extra field on the node data
  const description =
    typeof (data as Record<string, unknown>).description === 'string'
      ? (data as Record<string, unknown>).description as string
      : null;

  const handleDelete = () => {
    if (!modelId || !onDelete) return;
    onDelete(modelId);
  };

  return (
    <>
      <div>
        <div style={labelStyle}>Model</div>
        <div
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: 'var(--text-primary)',
            wordBreak: 'break-word',
          }}
        >
          {data.name}
        </div>
      </div>

      {description && (
        <div>
          <div style={labelStyle}>Description</div>
          <div
            style={{
              fontSize: 12,
              color: 'var(--text-secondary)',
              lineHeight: 1.5,
              wordBreak: 'break-word',
            }}
          >
            {description}
          </div>
        </div>
      )}

      <div>
        <div style={labelStyle}>Fields ({data.fieldCount})</div>
        {data.fieldPreview.length > 0 ? (
          <Flex
            vertical
            style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: 6,
              overflow: 'hidden',
            }}
          >
            {data.fieldPreview.map((field, idx) => (
              <Flex
                key={field.name}
                justify="space-between"
                align="baseline"
                style={{
                  padding: '5px 10px',
                  borderTop: idx === 0 ? 'none' : '1px solid rgba(255,255,255,0.05)',
                  gap: 8,
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-code)',
                    fontSize: 11,
                    color: field.required ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontWeight: field.required ? 600 : 400,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    flexShrink: 1,
                    minWidth: 0,
                  }}
                  title={field.name}
                >
                  {field.required ? `${field.name}*` : field.name}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--font-code)',
                    fontSize: 10,
                    color: 'var(--text-tertiary)',
                    flexShrink: 0,
                  }}
                >
                  {field.type}
                </span>
              </Flex>
            ))}
          </Flex>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
            No fields defined
          </div>
        )}
      </div>

      {(onEdit || onDelete) && modelId && (
        <Flex gap={8}>
          {onEdit && (
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => onEdit(modelId)}
              style={{ flex: 1 }}
            >
              Edit
            </Button>
          )}
          {onDelete && (
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={handleDelete}
              style={{ flex: 1 }}
            >
              Delete
            </Button>
          )}
        </Flex>
      )}
    </>
  );
}

export function MapDetailPanel({
  nodeType,
  nodeData,
  nodeId,
  onClose,
  onEditModel,
  onDeleteModel,
}: MapDetailPanelProps) {
  const modelId = nodeId ? extractEntityId(nodeId) : null;

  return (
    <div style={panelStyle}>
      {/* Close button */}
      <Button
        type="text"
        size="small"
        icon={<CloseOutlined />}
        onClick={onClose}
        style={{
          position: 'absolute',
          top: 10,
          right: 10,
          color: 'var(--text-tertiary)',
          width: 24,
          height: 24,
          minWidth: 24,
          padding: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      />

      {nodeType === 'collection' && (
        <CollectionDetail data={nodeData as CollectionNodeData} />
      )}

      {nodeType === 'request' && (
        <RequestDetail data={nodeData as RequestNodeData} />
      )}

      {nodeType === 'model' && (
        <ModelDetail
          data={nodeData as ModelNodeData}
          modelId={modelId}
          onEdit={onEditModel}
          onDelete={onDeleteModel}
        />
      )}
    </div>
  );
}
