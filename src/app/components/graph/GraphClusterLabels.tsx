'use client';

import { useEffect, useState, type RefObject } from 'react';
import type Sigma from 'sigma';
import { useGraphStore } from '../../stores/graphStore';
import { getGraphTheme } from '../../utils/graphThemeConfig';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GraphClusterLabelsProps {
  sigmaRef: RefObject<Sigma | null>;
}

interface LabelPosition {
  clusterId: string;
  name: string;
  color: string;
  nodeCount: number;
  screenX: number;
  screenY: number;
  visible: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function GraphClusterLabels({ sigmaRef }: GraphClusterLabelsProps) {
  const clusterMode = useGraphStore((s) => s.clusterMode);
  const clusters = useGraphStore((s) => s.clusters);
  const graphTheme = useGraphStore((s) => s.graphTheme);

  const [labels, setLabels] = useState<LabelPosition[]>([]);

  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma || clusterMode !== 'overview') {
      setLabels([]);
      return;
    }

    const updatePositions = () => {
      const s = sigmaRef.current;
      if (!s) return;

      const { width, height } = s.getDimensions();
      const currentClusters = useGraphStore.getState().clusters;
      const nextLabels: LabelPosition[] = [];

      for (const [clusterId, cluster] of currentClusters) {
        if (cluster.nodeIds.size < 2) continue;

        const viewportPos = s.graphToViewport({
          x: cluster.centroid.x,
          y: cluster.centroid.y,
        });

        const isVisible =
          viewportPos.x >= -50 &&
          viewportPos.x <= width + 50 &&
          viewportPos.y >= -30 &&
          viewportPos.y <= height + 30;

        nextLabels.push({
          clusterId,
          name: cluster.name,
          color: cluster.color,
          nodeCount: cluster.nodeIds.size,
          screenX: viewportPos.x,
          screenY: viewportPos.y,
          visible: isVisible,
        });
      }

      setLabels(nextLabels);
    };

    // Initial position computation
    updatePositions();

    // Re-compute on every Sigma render (camera movement, zoom, etc.)
    sigma.on('afterRender', updatePositions);

    return () => {
      const s = sigmaRef.current;
      if (s) {
        try {
          s.off('afterRender', updatePositions);
        } catch {
          // sigma may already be killed
        }
      }
    };
  }, [sigmaRef, clusterMode, clusters]);

  if (clusterMode !== 'overview' || labels.length === 0) {
    return null;
  }

  const theme = getGraphTheme(graphTheme);

  return (
    <>
      {labels.map((label) => {
        if (!label.visible) return null;

        return (
          <div
            key={label.clusterId}
            style={{
              position: 'absolute',
              left: label.screenX,
              top: label.screenY,
              transform: 'translate(-50%, -50%)',
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
              zIndex: 5,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
              opacity: theme.clusterLabelOpacity,
            }}
          >
            <span
              style={{
                color: label.color,
                fontSize: 12,
                fontWeight: 600,
                textShadow: theme.labelShadow,
                lineHeight: 1.2,
              }}
            >
              {label.name}
            </span>
            <span
              style={{
                color: label.color,
                fontSize: 9,
                fontWeight: 400,
                opacity: 0.6,
                textShadow: theme.labelShadow,
              }}
            >
              {label.nodeCount} nodes
            </span>
          </div>
        );
      })}
    </>
  );
}
