'use client';

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useGraphStore } from '../../stores/graphStore';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HOVER_DELAY_MS = 200;
const TOOLTIP_OFFSET_X = 16;
const TOOLTIP_OFFSET_Y = 12;

const METHOD_COLORS: Record<string, string> = {
  GET: '#34d399',
  POST: '#fbbf24',
  PUT: '#60a5fa',
  DELETE: '#f87171',
  PATCH: '#c084fc',
};

const DEFAULT_METHOD_COLOR = '#94a3b8';

const ENTITY_TYPE_COLORS: Record<string, string> = {
  collection: '#818cf8',
  request: '#94a3b8',
  model: '#f472b6',
};

const EDGE_TYPE_LABELS: Record<string, string> = {
  'req-reqModel': 'req body',
  'req-resModel': 'res body',
  'model-inherits': 'inherits',
  'model-mixin': 'mixin',
  'model-fieldRef': 'field ref',
  'col-subcol': 'subcollection',
  'col-request': 'owns',
};

// ---------------------------------------------------------------------------
// Style helpers
// ---------------------------------------------------------------------------

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const tooltipStyle: CSSProperties = {
  position: 'fixed',
  zIndex: 9999,
  background: 'rgba(17, 19, 32, 0.88)',
  backdropFilter: 'blur(12px)',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  borderRadius: 8,
  padding: '10px 14px',
  minWidth: 180,
  maxWidth: 280,
  boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
  fontFamily: 'var(--font-ui)',
  pointerEvents: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

// ---------------------------------------------------------------------------
// Mouse position tracker (container-relative)
// ---------------------------------------------------------------------------

interface MousePos {
  clientX: number;
  clientY: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function GraphTooltip() {
  const hoveredNodeId = useGraphStore((s) => s.hoveredNodeId);
  const graph = useGraphStore((s) => s.graph);

  const [visible, setVisible] = useState(false);
  const [mousePos, setMousePos] = useState<MousePos>({ clientX: 0, clientY: 0 });

  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track mouse position globally so tooltip follows the pointer
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      setMousePos({ clientX: e.clientX, clientY: e.clientY });
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  // Show tooltip after delay; clear immediately on node-out
  useEffect(() => {
    if (showTimerRef.current !== null) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }

    if (hoveredNodeId === null) {
      setVisible(false);
      return;
    }

    showTimerRef.current = setTimeout(() => {
      setVisible(true);
    }, HOVER_DELAY_MS);

    return () => {
      if (showTimerRef.current !== null) {
        clearTimeout(showTimerRef.current);
        showTimerRef.current = null;
      }
    };
  }, [hoveredNodeId]);

  if (!visible || hoveredNodeId === null || !graph || !graph.hasNode(hoveredNodeId)) {
    return null;
  }

  const attrs = graph.getNodeAttributes(hoveredNodeId);
  const entityType = (attrs.entity_type as string) ?? 'request';
  const props = (attrs.properties ?? {}) as Record<string, unknown>;

  // Collect outgoing edges (max 3)
  const outEdges: Array<{ targetLabel: string; edgeType: string }> = [];
  graph.forEachOutEdge(hoveredNodeId, (_edgeId, edgeAttrs, _src, target) => {
    if (outEdges.length >= 3) return;
    const targetAttrs = graph.getNodeAttributes(target);
    outEdges.push({
      targetLabel: (targetAttrs.label as string) ?? target,
      edgeType: (edgeAttrs.edge_type as string) ?? '',
    });
  });

  // Clamp tooltip position to avoid going offscreen
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const tooltipW = 280;
  const tooltipH = 160; // rough estimate
  const rawLeft = mousePos.clientX + TOOLTIP_OFFSET_X;
  const rawTop = mousePos.clientY + TOOLTIP_OFFSET_Y;
  const left = Math.min(rawLeft, viewportW - tooltipW - 8);
  const top = Math.min(rawTop, viewportH - tooltipH - 8);

  const typeColor = ENTITY_TYPE_COLORS[entityType] ?? '#94a3b8';
  const typeBg = hexToRgba(typeColor, 0.15);

  return (
    <div
      style={{
        ...tooltipStyle,
        left,
        top,
      }}
    >
      {/* Entity type badge + name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {entityType === 'request' ? (
          <MethodBadge method={(props.method as string) ?? 'GET'} />
        ) : (
          <span
            style={{
              background: typeBg,
              color: typeColor,
              fontSize: 9,
              fontWeight: 700,
              padding: '2px 6px',
              borderRadius: 4,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              flexShrink: 0,
            }}
          >
            {entityType}
          </span>
        )}
        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: 'var(--text-primary)',
            wordBreak: 'break-word',
            lineHeight: 1.3,
          }}
        >
          {(props.name as string) ?? attrs.label ?? hoveredNodeId}
        </span>
      </div>

      {/* URL path (requests only) */}
      {entityType === 'request' && (props.url as string) && (
        <div
          style={{
            fontFamily: 'var(--font-code)',
            fontSize: 10,
            color: 'var(--text-secondary)',
            background: 'rgba(255, 255, 255, 0.04)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: 4,
            padding: '3px 7px',
            wordBreak: 'break-all',
          }}
        >
          {props.url as string}
        </div>
      )}

      {/* Field count (models only) */}
      {entityType === 'model' && typeof props.fieldCount === 'number' && (
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
          {props.fieldCount} {props.fieldCount === 1 ? 'field' : 'fields'}
        </div>
      )}

      {/* Request count (collections only) */}
      {entityType === 'collection' && typeof props.requestCount === 'number' && (
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
          {props.requestCount} {props.requestCount === 1 ? 'request' : 'requests'}
        </div>
      )}

      {/* Connected edges */}
      {outEdges.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 2 }}>
          <div
            style={{
              fontSize: 9,
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            Connected
          </div>
          {outEdges.map(({ targetLabel, edgeType }, i) => (
            <div
              key={i}
              style={{
                fontSize: 11,
                color: 'var(--text-secondary)',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <span style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}>→</span>
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flexShrink: 1,
                  minWidth: 0,
                }}
              >
                {targetLabel}
              </span>
              {edgeType && EDGE_TYPE_LABELS[edgeType] && (
                <span
                  style={{
                    fontSize: 9,
                    color: 'var(--text-tertiary)',
                    background: 'rgba(255,255,255,0.05)',
                    borderRadius: 3,
                    padding: '1px 4px',
                    flexShrink: 0,
                  }}
                >
                  {EDGE_TYPE_LABELS[edgeType]}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Method badge sub-component
// ---------------------------------------------------------------------------

function MethodBadge({ method }: { method: string }) {
  const normalizedMethod = method.toUpperCase();
  const color = METHOD_COLORS[normalizedMethod] ?? DEFAULT_METHOD_COLOR;
  const bg = hexToRgba(color, 0.15);

  return (
    <span
      style={{
        background: bg,
        color,
        fontSize: 9,
        fontWeight: 700,
        padding: '2px 6px',
        borderRadius: 4,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        flexShrink: 0,
      }}
    >
      {normalizedMethod}
    </span>
  );
}
