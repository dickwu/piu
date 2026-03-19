'use client';

import { useEffect, useRef, memo } from 'react';
import { useGraphStore } from '../../stores/graphStore';
import type { ClusterInfo } from '../../stores/graphStore';

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
// Cluster circle helpers
// ---------------------------------------------------------------------------

/**
 * Parse a CSS hex or rgb(a) color string and return it with the given alpha
 * as an rgba() string suitable for Canvas2D.
 */
function colorWithAlpha(color: string, alpha: number): string {
  // Handle hex colors (#rrggbb or #rgb)
  const hexMatch = color.match(/^#([0-9a-fA-F]{3,8})$/);
  if (hexMatch) {
    const hex = hexMatch[1];
    let r: number;
    let g: number;
    let b: number;
    if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
    } else {
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
    }
    return `rgba(${r},${g},${b},${alpha})`;
  }
  // Fallback: wrap in rgba via globalAlpha (caller will set globalAlpha instead)
  return color;
}

/**
 * Draw translucent bounding circles for each cluster on the minimap.
 */
function drawClusterCircles(
  ctx: CanvasRenderingContext2D,
  clusters: Map<string, ClusterInfo>,
  graph: import('graphology').default,
  bb: BoundingBox,
  focusedClusterId: string | null,
  isFocusMode: boolean,
): void {
  ctx.save();

  clusters.forEach((cluster) => {
    const isFocused = cluster.id === focusedClusterId;

    // In focus mode, dim all circles except the focused one
    const fillAlpha = isFocusMode && !isFocused ? 0.04 : 0.15;
    const strokeAlpha = isFocusMode && !isFocused ? 0.12 : 0.40;

    // Centroid in minimap coords
    const cx = toMinimapCoord(cluster.centroid.x, bb.minX, bb.maxX, MINIMAP_W);
    const cy = MINIMAP_H - toMinimapCoord(cluster.centroid.y, bb.minY, bb.maxY, MINIMAP_H);

    // Compute radius as max distance from centroid to any member node (in minimap coords)
    let maxDistSq = 0;
    for (const nodeId of cluster.nodeIds) {
      if (!graph.hasNode(nodeId)) continue;
      const attrs = graph.getNodeAttributes(nodeId);
      const nx = typeof attrs.x === 'number' ? attrs.x : 0;
      const ny = typeof attrs.y === 'number' ? attrs.y : 0;
      const px = toMinimapCoord(nx, bb.minX, bb.maxX, MINIMAP_W);
      const py = MINIMAP_H - toMinimapCoord(ny, bb.minY, bb.maxY, MINIMAP_H);
      const dx = px - cx;
      const dy = py - cy;
      const distSq = dx * dx + dy * dy;
      if (distSq > maxDistSq) maxDistSq = distSq;
    }

    // Minimum radius so single-node clusters are still visible
    const radius = Math.max(Math.sqrt(maxDistSq) + DOT_RADIUS, DOT_RADIUS * 3);

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = colorWithAlpha(cluster.color, fillAlpha);
    ctx.fill();
    ctx.strokeStyle = colorWithAlpha(cluster.color, strokeAlpha);
    ctx.lineWidth = 1;
    ctx.stroke();
  });

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function GraphMinimapInner() {
  const graph = useGraphStore((s) => s.graph);
  const clusterMode = useGraphStore((s) => s.clusterMode);
  const clusters = useGraphStore((s) => s.clusters);
  const focusedClusterId = useGraphStore((s) => s.focusedClusterId);
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

    // Draw cluster bounding circles underneath node dots (when clustering is active)
    if (clusterMode !== 'off' && clusters.size > 0) {
      drawClusterCircles(
        ctx,
        clusters,
        graph,
        bb,
        focusedClusterId,
        clusterMode === 'focus',
      );
    }

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
  }, [graph, clusterMode, clusters, focusedClusterId]);

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
