'use client';

import { useEffect, useRef, memo } from 'react';
import { useGraphStore } from '../../stores/graphStore';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MINIMAP_W = 160;
const MINIMAP_H = 120;
const PADDING = 8;      // inset padding so dots aren't flush with the edge
const DOT_RADIUS = 2;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface BoundingBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function computeBoundingBox(positions: Array<{ x: number; y: number }>): BoundingBox | null {
  if (positions.length === 0) return null;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const { x, y } of positions) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  // Guard against degenerate single-node case
  if (minX === maxX) { minX -= 1; maxX += 1; }
  if (minY === maxY) { minY -= 1; maxY += 1; }

  return { minX, maxX, minY, maxY };
}

function toMinimapCoord(
  value: number,
  min: number,
  max: number,
  canvasDim: number,
): number {
  const range = max - min;
  return PADDING + ((value - min) / range) * (canvasDim - PADDING * 2);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function GraphMinimapInner() {
  const graph = useGraphStore((s) => s.graph);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear to transparent each frame
    ctx.clearRect(0, 0, MINIMAP_W, MINIMAP_H);

    if (!graph || graph.order === 0) return;

    // Collect positions
    const positions: Array<{ x: number; y: number; color: string }> = [];
    graph.forEachNode((_id, attrs) => {
      const x = typeof attrs.x === 'number' ? attrs.x : 0;
      const y = typeof attrs.y === 'number' ? attrs.y : 0;
      const color = typeof attrs.color === 'string' ? attrs.color : '#888888';
      positions.push({ x, y, color });
    });

    const bb = computeBoundingBox(positions);
    if (!bb) return;

    // Draw each node as a small filled dot
    for (const { x, y, color } of positions) {
      const px = toMinimapCoord(x, bb.minX, bb.maxX, MINIMAP_W);
      // Invert Y so "up" in graph space is "up" on the minimap
      const py = MINIMAP_H - toMinimapCoord(y, bb.minY, bb.maxY, MINIMAP_H);

      ctx.beginPath();
      ctx.arc(px, py, DOT_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.85;
      ctx.fill();
    }

    ctx.globalAlpha = 1;
  }, [graph]);

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 12,
        right: 12,
        width: MINIMAP_W,
        height: MINIMAP_H,
        background: 'rgba(17, 19, 32, 0.8)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 6,
        backdropFilter: 'blur(8px)',
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
    >
      <canvas
        ref={canvasRef}
        width={MINIMAP_W}
        height={MINIMAP_H}
        style={{ display: 'block' }}
      />
    </div>
  );
}

export const GraphMinimap = memo(GraphMinimapInner);
