'use client';

import { memo } from 'react';
import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';

function LabeledEdgeInner({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  style,
  markerEnd,
}: EdgeProps) {
  // Check for self-loop (source and target are at the same position)
  const isSelfLoop =
    Math.abs(sourceX - targetX) < 1 && Math.abs(sourceY - targetY) < 1;

  if (isSelfLoop) {
    // Render a circular self-loop path
    const loopRadius = 30;
    const path = `M ${sourceX} ${sourceY - 5}
      C ${sourceX + loopRadius * 2} ${sourceY - loopRadius * 2},
        ${sourceX + loopRadius * 2} ${sourceY + loopRadius * 2},
        ${sourceX} ${sourceY + 5}`;

    return (
      <>
        <path
          id={id}
          d={path}
          fill="none"
          style={style}
          markerEnd={markerEnd as string}
        />
        {label && (
          <foreignObject
            x={sourceX + loopRadius * 1.5 - 30}
            y={sourceY - 8}
            width={60}
            height={16}
            requiredExtensions="http://www.w3.org/1999/xhtml"
          >
            <div style={{
              fontSize: 8,
              color: (style as Record<string, unknown>)?.stroke as string ?? '#888',
              textAlign: 'center',
              background: 'rgba(17, 19, 32, 0.9)',
              borderRadius: 3,
              padding: '1px 3px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              lineHeight: '14px',
            }}>
              {label}
            </div>
          </foreignObject>
        )}
      </>
    );
  }

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} markerEnd={markerEnd} />
      {label && (
        <foreignObject
          x={labelX - 35}
          y={labelY - 9}
          width={70}
          height={18}
          requiredExtensions="http://www.w3.org/1999/xhtml"
        >
          <div style={{
            fontSize: 8,
            color: (style as Record<string, unknown>)?.stroke as string ?? '#888',
            textAlign: 'center',
            background: 'rgba(17, 19, 32, 0.9)',
            borderRadius: 3,
            padding: '1px 4px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            lineHeight: '14px',
            pointerEvents: 'none',
          }}>
            {label}
          </div>
        </foreignObject>
      )}
    </>
  );
}

const LabeledEdge = memo(LabeledEdgeInner);
export default LabeledEdge;
