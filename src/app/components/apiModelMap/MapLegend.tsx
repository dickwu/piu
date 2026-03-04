'use client';

import { memo } from 'react';

interface EdgeLegendRow {
  color: string;
  dashed: boolean;
  thin: boolean;
  label: string;
}

const EDGE_ROWS: EdgeLegendRow[] = [
  { color: '#8b8b99', dashed: false, thin: false, label: 'collection nesting' },
  { color: '#7a7a8e', dashed: true,  thin: false, label: 'contains request' },
  { color: '#fbbf24', dashed: false, thin: false, label: 'request body model' },
  { color: '#34d399', dashed: false, thin: false, label: 'response model' },
  { color: '#4a9eff', dashed: false, thin: false, label: 'inherits' },
  { color: '#9b59b6', dashed: true,  thin: false, label: 'mixin' },
  { color: '#2ecc71', dashed: false, thin: true,  label: 'field ref' },
];

function MapLegendInner() {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 12,
        left: 12,
        background: 'rgba(17, 19, 32, 0.85)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 6,
        padding: '8px 12px',
        backdropFilter: 'blur(4px)',
        pointerEvents: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
      }}
    >
      {EDGE_ROWS.map((row) => (
        <div
          key={row.label}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          {/* Line swatch */}
          <div style={{ width: 24, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            <div
              style={{
                width: '100%',
                borderTopStyle: row.dashed ? 'dashed' : 'solid',
                borderTopWidth: row.thin ? 1 : 2,
                borderTopColor: row.color,
              }}
            />
          </div>

          {/* Label */}
          <span
            style={{
              fontSize: 11,
              color: 'rgba(255,255,255,0.5)',
              fontFamily: 'var(--font-ui)',
              whiteSpace: 'nowrap',
            }}
          >
            {row.label}
          </span>
        </div>
      ))}
    </div>
  );
}

export const MapLegend = memo(MapLegendInner);
