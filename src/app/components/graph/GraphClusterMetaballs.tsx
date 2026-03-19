'use client';

import { useRef, useMemo, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { ClusterInfo } from '../../utils/graphClustering';
import type { GraphNodeData } from './GraphNodes';
import { getGraphTheme } from '../../utils/graphThemeConfig';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_NODES = 512;
const MAX_CLUSTERS = 24;

// ---------------------------------------------------------------------------
// Module-level scratch objects — allocated once to avoid per-frame GC
// ---------------------------------------------------------------------------

const _mvp = new THREE.Matrix4();
const _vec4 = new THREE.Vector4();

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

const vertexShader = /* glsl */`#version 300 es
in vec3 position;
in vec2 uv;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const fragmentShader = /* glsl */`#version 300 es
precision highp float;

uniform vec2 u_nodePositions[${MAX_NODES}];
uniform float u_nodeCluster[${MAX_NODES}];
uniform vec3 u_clusterColors[${MAX_CLUSTERS}];
uniform int u_nodeCount;
uniform float u_blobRadius;
uniform float u_threshold;
uniform vec2 u_pixelSize;
uniform float u_fillAlpha;
uniform float u_strokeAlpha;
uniform float u_strokeWidth;

in vec2 vUv;
out vec4 fragColor;

float fieldForCluster(vec2 ndc, int targetCluster) {
  float blobR2 = u_blobRadius * u_blobRadius;
  float field = 0.0;
  for (int i = 0; i < u_nodeCount; i++) {
    int ci = int(u_nodeCluster[i]);
    if (ci != targetCluster) continue;
    vec2 diff = ndc - u_nodePositions[i];
    float distSq = dot(diff, diff);
    field += blobR2 / max(distSq, 0.0001);
  }
  return field;
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;

  float clusterField[${MAX_CLUSTERS}];
  for (int c = 0; c < ${MAX_CLUSTERS}; c++) {
    clusterField[c] = 0.0;
  }

  float blobR2 = u_blobRadius * u_blobRadius;
  for (int i = 0; i < u_nodeCount; i++) {
    int ci = int(u_nodeCluster[i]);
    if (ci < 0 || ci >= ${MAX_CLUSTERS}) continue;
    vec2 diff = ndc - u_nodePositions[i];
    float distSq = dot(diff, diff);
    clusterField[ci] += blobR2 / max(distSq, 0.0001);
  }

  int dominantCluster = -1;
  float dominantField = u_threshold;
  for (int c = 0; c < ${MAX_CLUSTERS}; c++) {
    if (clusterField[c] > dominantField) {
      dominantField = clusterField[c];
      dominantCluster = c;
    }
  }

  if (dominantCluster < 0) {
    discard;
  }

  float fieldL = fieldForCluster(ndc + vec2(-u_pixelSize.x, 0.0), dominantCluster);
  float fieldR = fieldForCluster(ndc + vec2( u_pixelSize.x, 0.0), dominantCluster);
  float fieldT = fieldForCluster(ndc + vec2(0.0,  u_pixelSize.y), dominantCluster);
  float fieldB = fieldForCluster(ndc + vec2(0.0, -u_pixelSize.y), dominantCluster);

  float gradient = length(vec2(fieldR - fieldL, fieldT - fieldB));

  float strokeMask = smoothstep(0.0, u_strokeWidth, gradient)
                   * smoothstep(u_threshold * 0.5, u_threshold, dominantField);

  vec3 color = u_clusterColors[dominantCluster];
  float alpha = mix(u_fillAlpha, u_strokeAlpha, strokeMask);

  fragColor = vec4(color, alpha);
}
`;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface GraphClusterMetaballsProps {
  nodes: GraphNodeData[];
  clusters: Map<string, ClusterInfo>;
  enabled: boolean;
  focusedClusterId: string | null;
  graphTheme: 'dark' | 'light';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GraphClusterMetaballs({
  nodes,
  clusters,
  enabled,
  focusedClusterId,
  graphTheme,
}: GraphClusterMetaballsProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const { camera, gl } = useThree();

  const nodeCountExceedsLimit = nodes.length > 500;

  // Build uniforms once — values are mutated in useFrame (Float32Arrays are typed buffers)
  const uniforms = useMemo(() => {
    const nodePositions = new Float32Array(MAX_NODES * 2).fill(99999.0);
    const nodeCluster = new Float32Array(MAX_NODES).fill(-1);
    const clusterColors = new Float32Array(MAX_CLUSTERS * 3).fill(0);

    return {
      u_nodePositions: { value: nodePositions },
      u_nodeCluster: { value: nodeCluster },
      u_clusterColors: { value: clusterColors },
      u_nodeCount: { value: 0 },
      u_blobRadius: { value: 0.08 },
      u_threshold: { value: 1.0 },
      u_pixelSize: { value: new THREE.Vector2(1.0 / 1920, 1.0 / 1080) },
      u_fillAlpha: { value: 0.12 },
      u_strokeAlpha: { value: 0.50 },
      u_strokeWidth: { value: 2.0 },
    };
  }, []);

  // Build a stable cluster-index lookup from cluster id -> sequential int index
  // Rebuild whenever clusters map identity changes
  const clusterIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    let idx = 0;
    for (const id of clusters.keys()) {
      map.set(id, idx++);
    }
    return map;
  }, [clusters]);

  // Upload cluster colors whenever clusters change, using theme palette
  useEffect(() => {
    const buf = uniforms.u_clusterColors.value as Float32Array;
    buf.fill(0);
    const config = getGraphTheme(graphTheme);
    for (const [id] of clusters.entries()) {
      const clusterIdx = clusterIndexMap.get(id);
      if (clusterIdx === undefined || clusterIdx >= MAX_CLUSTERS) continue;
      const paletteColor = config.clusterPalette[clusterIdx % config.clusterPalette.length];
      const c = new THREE.Color(paletteColor);
      buf[clusterIdx * 3] = c.r;
      buf[clusterIdx * 3 + 1] = c.g;
      buf[clusterIdx * 3 + 2] = c.b;
    }
  }, [clusters, clusterIndexMap, uniforms, graphTheme]);

  // Sync theme-driven alpha and stroke uniforms
  useEffect(() => {
    const config = getGraphTheme(graphTheme);
    uniforms.u_fillAlpha.value = config.blobFillAlpha;
    uniforms.u_strokeAlpha.value = config.blobStrokeAlpha;
    uniforms.u_strokeWidth.value = config.blobStrokeWidth;
  }, [graphTheme, uniforms]);

  // Keep pixel size uniform in sync with canvas dimensions
  useEffect(() => {
    const canvas = gl.domElement;
    const updatePixelSize = () => {
      const w = canvas.width || 1920;
      const h = canvas.height || 1080;
      (uniforms.u_pixelSize.value as THREE.Vector2).set(1.0 / w, 1.0 / h);
    };
    updatePixelSize();
    const observer = new ResizeObserver(updatePixelSize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [gl, uniforms]);

  // Warn if the device's fragment uniform limit may be too low for MAX_NODES
  useEffect(() => {
    const ctx = gl.getContext() as WebGL2RenderingContext;
    if (ctx) {
      const maxFragUniforms = ctx.getParameter(ctx.MAX_FRAGMENT_UNIFORM_VECTORS);
      if (maxFragUniforms < 256) {
        console.warn(
          `[GraphClusterMetaballs] Fragment uniform limit (${maxFragUniforms}) may be too low for MAX_NODES=${MAX_NODES}. Consider reducing MAX_NODES.`,
        );
      }
    }
  }, [gl]);

  // Assign to layer 1 to exclude from bloom layer 0
  useEffect(() => {
    if (meshRef.current) {
      meshRef.current.layers.set(1);
    }
  }, []);

  // Per-frame: project node world positions to NDC and upload uniforms
  useFrame(() => {
    if (!enabled || clusters.size === 0 || !meshRef.current) return;

    _mvp.copy(camera.projectionMatrix).multiply(camera.matrixWorldInverse);

    const positionBuf = uniforms.u_nodePositions.value as Float32Array;
    const clusterBuf = uniforms.u_nodeCluster.value as Float32Array;

    // Reset buffers
    positionBuf.fill(99999.0);
    clusterBuf.fill(-1);

    let count = 0;

    for (let i = 0; i < nodes.length && count < MAX_NODES; i++) {
      const node = nodes[i];

      // In focus mode, skip nodes not in the focused cluster
      if (focusedClusterId !== null) {
        const focusedInfo = clusters.get(focusedClusterId);
        if (!focusedInfo || !focusedInfo.nodeIds.has(node.id)) continue;
      }

      // Find which cluster this node belongs to
      let nodeClusterIdx = -1;
      for (const [id, info] of clusters.entries()) {
        if (info.nodeIds.has(node.id)) {
          nodeClusterIdx = clusterIndexMap.get(id) ?? -1;
          break;
        }
      }
      if (nodeClusterIdx < 0) continue;

      // Project world position (x, y, 0) -> NDC
      _vec4.set(node.x, node.y, 0, 1);
      _vec4.applyMatrix4(_mvp);
      const ndcX = _vec4.x / _vec4.w;
      const ndcY = _vec4.y / _vec4.w;

      positionBuf[count * 2] = ndcX;
      positionBuf[count * 2 + 1] = ndcY;
      clusterBuf[count] = nodeClusterIdx;
      count++;
    }

    uniforms.u_nodeCount.value = count;
  });

  const geometry = useMemo(() => {
    // Fullscreen quad in clip space: corners at ±1
    const geo = new THREE.PlaneGeometry(2, 2);
    return geo;
  }, []);

  const material = useMemo(
    () =>
      new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader,
        fragmentShader,
        uniforms,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.NormalBlending,
      }),
    [uniforms],
  );

  // Dispose on unmount
  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  if (!enabled || clusters.size === 0 || nodeCountExceedsLimit) return null;

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={material}
      position={[0, 0, -1]}
      raycast={() => null}
    />
  );
}
