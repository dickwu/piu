import { createNodeBorderProgram } from '@sigma/node-border';
import type { NodeLabelDrawingFunction, NodeHoverDrawingFunction } from 'sigma/rendering';
import type { Settings } from 'sigma/settings';
import type { NodeDisplayData, PartialButFor } from 'sigma/types';
import type { SigmaNodeAttributes, SigmaEdgeAttributes } from '../../utils/apiModelMapGraph';

// ---------------------------------------------------------------------------
// Shorthand for the data type Sigma passes to label/hover functions
// ---------------------------------------------------------------------------

type LabelData = PartialButFor<NodeDisplayData, 'x' | 'y' | 'size' | 'label' | 'color'>;

// ---------------------------------------------------------------------------
// Color constants
// ---------------------------------------------------------------------------

const CATEGORY_MARKERS: Record<string, string> = {
  collection: 'C',
  request: '',    // uses method text (GET, POST, etc.) instead
  model: 'M',
};

const LABEL_COLOR = 'rgba(255, 255, 255, 0.9)';
const SUBTITLE_COLOR = 'rgba(255, 255, 255, 0.5)';
const HOVER_GLOW_COLOR = 'rgba(255, 255, 255, 0.15)';

// ---------------------------------------------------------------------------
// Text truncation helper
// ---------------------------------------------------------------------------

function truncateText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  // Binary search for the longest prefix that fits with ellipsis
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid) + '...').width <= maxWidth) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo === 0 ? '...' : text.slice(0, lo) + '...';
}

// ---------------------------------------------------------------------------
// Custom drawLabel — renders icon + name + subtitle inside/near the circle
// ---------------------------------------------------------------------------

export const drawApiNodeLabel: NodeLabelDrawingFunction<
  SigmaNodeAttributes,
  SigmaEdgeAttributes
> = (
  context: CanvasRenderingContext2D,
  data: LabelData,
  settings: Settings<SigmaNodeAttributes, SigmaEdgeAttributes>,
) => {
  const { x, y, size, label } = data;
  const nodeCategory = data.nodeCategory as string | undefined;
  const subtitle = data.subtitle as string | undefined;
  const methodColor = data.methodColor as string | undefined;
  const borderColor = data.borderColor as string | undefined;

  if (!label) return;

  const fontSize = settings.labelSize;
  const maxTextWidth = size * 1.6;

  // Icon or method badge above the label
  if (nodeCategory === 'request' && subtitle) {
    // Method badge (GET, POST, etc.)
    const badgeFontSize = Math.max(8, fontSize * 0.85);
    context.font = `bold ${badgeFontSize}px ${settings.labelFont}`;
    context.fillStyle = methodColor ?? borderColor ?? LABEL_COLOR;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(subtitle, x, y - fontSize * 0.5);

    // Name below
    context.font = `${fontSize}px ${settings.labelFont}`;
    context.fillStyle = LABEL_COLOR;
    const truncated = truncateText(context, label, maxTextWidth);
    context.fillText(truncated, x, y + fontSize * 0.55);
  } else if (nodeCategory === 'collection' || nodeCategory === 'model') {
    // Marker letter (C or M)
    const marker = CATEGORY_MARKERS[nodeCategory] ?? '';
    if (marker) {
      const markerFontSize = Math.max(10, fontSize * 1.1);
      context.font = `bold ${markerFontSize}px ${settings.labelFont}`;
      context.fillStyle = borderColor ?? LABEL_COLOR;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(marker, x, y - fontSize * 0.9);
    }

    // Name
    context.font = `${fontSize}px ${settings.labelFont}`;
    context.fillStyle = LABEL_COLOR;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const truncated = truncateText(context, label, maxTextWidth);
    context.fillText(truncated, x, y + (marker ? fontSize * 0.15 : 0));

    // Subtitle
    if (subtitle) {
      const subFontSize = Math.max(7, fontSize * 0.75);
      context.font = `${subFontSize}px ${settings.labelFont}`;
      context.fillStyle = SUBTITLE_COLOR;
      context.fillText(subtitle, x, y + fontSize * 1.0);
    }
  } else {
    // Fallback: simple centered label
    context.font = `${fontSize}px ${settings.labelFont}`;
    context.fillStyle = LABEL_COLOR;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(label, x, y);
  }
};

// ---------------------------------------------------------------------------
// Custom drawHover — glow ring + full (untruncated) label
// ---------------------------------------------------------------------------

export const drawApiNodeHover: NodeHoverDrawingFunction<
  SigmaNodeAttributes,
  SigmaEdgeAttributes
> = (
  context: CanvasRenderingContext2D,
  data: LabelData,
  settings: Settings<SigmaNodeAttributes, SigmaEdgeAttributes>,
) => {
  const { x, y, size, label } = data;
  const borderColor = data.borderColor as string | undefined;

  // Draw glow ring
  context.beginPath();
  context.arc(x, y, size + 4, 0, Math.PI * 2);
  context.closePath();
  context.fillStyle = HOVER_GLOW_COLOR;
  context.fill();

  // Outer accent ring
  context.beginPath();
  context.arc(x, y, size + 2, 0, Math.PI * 2);
  context.closePath();
  context.strokeStyle = borderColor ?? 'rgba(255,255,255,0.3)';
  context.lineWidth = 1.5;
  context.stroke();

  // Re-draw the label (full, no truncation)
  // Override size to allow wider text in hover state
  const hoverData: LabelData = { ...data, size: size * 1.5 };
  drawApiNodeLabel(context, hoverData, settings);

  // Full label below the circle (tooltip style)
  if (label) {
    const tooltipY = y + size + 14;
    const fontSize = settings.labelSize;
    context.font = `bold ${fontSize}px ${settings.labelFont}`;
    context.fillStyle = LABEL_COLOR;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(label, x, tooltipY);
  }
};

// ---------------------------------------------------------------------------
// Node program — circle with colored border
// ---------------------------------------------------------------------------

export const ApiNodeProgram = createNodeBorderProgram<
  SigmaNodeAttributes,
  SigmaEdgeAttributes
>({
  borders: [
    {
      size: { attribute: 'borderSize', defaultValue: 0.15, mode: 'relative' },
      color: { attribute: 'borderColor', defaultValue: '#666' },
    },
    {
      size: { fill: true },
      color: { attribute: 'color', defaultValue: 'rgba(30, 30, 42, 0.9)' },
    },
  ],
  drawLabel: drawApiNodeLabel,
  drawHover: drawApiNodeHover,
});
