'use client';

import { useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import type { DataModel } from '../types';
import { parseModelFields } from '../types';
import {
  computeModelGraph,
  NODE_W,
  NODE_H,
  type GraphEdge,
} from '../utils/modelGraphLayout';

// ─── Color constants ───────────────────────────────────────────────────────────
const C_NODE_BG = 0x1c1f2e;
const C_BORDER_DEFAULT = 0x2d3148;
const C_BORDER_HOVER = 0x6ab0ff;
const C_BORDER_SELECTED = 0x4a9eff;
const C_TEXT = '#e8e8f0';
const C_SUBTEXT = '#8888a8';
const C_EDGE_INHERITS = 0x4a9eff;
const C_EDGE_MIXIN = 0x9b59b6;
const C_EDGE_FIELDREF = 0x2ecc71;
const C_BG_SCENE = 0x111320;

// Multiplier for canvas texture resolution (crisp on HiDPI)
const TEX_SCALE = 2;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createNodeTexture(model: DataModel): THREE.CanvasTexture {
  const w = NODE_W * TEX_SCALE;
  const h = NODE_H * TEX_SCALE;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  const radius = 6 * TEX_SCALE;

  // Background fill
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.lineTo(w - radius, 0);
  ctx.quadraticCurveTo(w, 0, w, radius);
  ctx.lineTo(w, h - radius);
  ctx.quadraticCurveTo(w, h, w - radius, h);
  ctx.lineTo(radius, h);
  ctx.quadraticCurveTo(0, h, 0, h - radius);
  ctx.lineTo(0, radius);
  ctx.quadraticCurveTo(0, 0, radius, 0);
  ctx.closePath();
  ctx.fillStyle = `#${C_NODE_BG.toString(16).padStart(6, '0')}`;
  ctx.fill();

  const maxTextW = (NODE_W - 20) * TEX_SCALE;

  // Model name
  ctx.fillStyle = C_TEXT;
  ctx.font = `bold ${12 * TEX_SCALE}px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  let name = model.name;
  while (ctx.measureText(name).width > maxTextW && name.length > 3) {
    name = name.slice(0, -1);
  }
  if (name !== model.name) name = name + '…';

  ctx.fillText(name, w / 2, h / 2 - 2 * TEX_SCALE);

  // Field count sub-label
  const fieldCount = parseModelFields(model.fields).length;
  ctx.fillStyle = C_SUBTEXT;
  ctx.font = `${9 * TEX_SCALE}px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(
    `${fieldCount} field${fieldCount === 1 ? '' : 's'}`,
    w / 2,
    h / 2 + 12 * TEX_SCALE,
  );

  return new THREE.CanvasTexture(canvas);
}

function createNodeBorderGeometry(): THREE.BufferGeometry {
  const hw = NODE_W / 2;
  const hh = NODE_H / 2;
  const positions = new Float32Array([
    -hw, -hh, 0.02,
    hw, -hh, 0.02,
    hw, hh, 0.02,
    -hw, hh, 0.02,
    -hw, -hh, 0.02,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geo;
}

function edgeColor(type: GraphEdge['type']): number {
  if (type === 'inherits') return C_EDGE_INHERITS;
  if (type === 'mixin') return C_EDGE_MIXIN;
  return C_EDGE_FIELDREF;
}

function buildEdgeGeometry(
  fx: number,
  fy: number,
  tx: number,
  ty: number,
): THREE.BufferGeometry {
  const positions = new Float32Array([fx, fy, -0.01, tx, ty, -0.01]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geo;
}

function buildArrow(
  fx: number,
  fy: number,
  tx: number,
  ty: number,
  color: number,
): THREE.Mesh {
  const dx = tx - fx;
  const dy = ty - fy;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;

  // Place arrow tip at the edge of the target node
  const tipX = tx - ux * (NODE_H / 2 + 2);
  const tipY = ty - uy * (NODE_H / 2 + 2);

  const arrowLen = 10;
  const arrowHalf = 5;

  const positions = new Float32Array([
    tipX,
    tipY,
    0.02,
    tipX - ux * arrowLen + px * arrowHalf,
    tipY - uy * arrowLen + py * arrowHalf,
    0.02,
    tipX - ux * arrowLen - px * arrowHalf,
    tipY - uy * arrowLen - py * arrowHalf,
    0.02,
  ]);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex([0, 1, 2]);
  return new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }),
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

interface ModelMapViewProps {
  models: DataModel[];
  onNodeClick: (model: DataModel | null) => void;
  selectedModelId: string | null;
}

interface NodeObjects {
  modelId: string;
  mesh: THREE.Mesh;
  border: THREE.Line;
}

export function ModelMapView({ models, onNodeClick, selectedModelId }: ModelMapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Track mutable state without causing re-renders
  const stateRef = useRef<{
    renderer: THREE.WebGLRenderer | null;
    scene: THREE.Scene | null;
    camera: THREE.OrthographicCamera | null;
    nodeObjects: NodeObjects[];
    hoveredId: string | null;
    selectedId: string | null;
    isPanning: boolean;
    panStart: { x: number; y: number };
    clickOrigin: { x: number; y: number };
    rafId: number;
    onNodeClick: (model: DataModel | null) => void;
    models: DataModel[];
    disposed: boolean;
  }>({
    renderer: null,
    scene: null,
    camera: null,
    nodeObjects: [],
    hoveredId: null,
    selectedId: selectedModelId,
    isPanning: false,
    panStart: { x: 0, y: 0 },
    clickOrigin: { x: 0, y: 0 },
    rafId: 0,
    onNodeClick,
    models,
    disposed: false,
  });

  // Keep callback ref up-to-date
  stateRef.current.onNodeClick = onNodeClick;
  stateRef.current.models = models;

  // Update border colors when hover/selection changes
  const updateBorderColors = useCallback(() => {
    const s = stateRef.current;
    for (const obj of s.nodeObjects) {
      const mat = obj.border.material as THREE.LineBasicMaterial;
      if (obj.modelId === s.selectedId) {
        mat.color.setHex(C_BORDER_SELECTED);
      } else if (obj.modelId === s.hoveredId) {
        mat.color.setHex(C_BORDER_HOVER);
      } else {
        mat.color.setHex(C_BORDER_DEFAULT);
      }
      mat.needsUpdate = true;
    }
  }, []);

  // Main Three.js setup effect — runs when models list changes
  useEffect(() => {
    if (!containerRef.current || !canvasRef.current) return;
    // Capture as non-nullable aliases; TypeScript narrows don't flow into function declarations
    const container = containerRef.current as HTMLDivElement;
    const canvas = canvasRef.current as HTMLCanvasElement;

    const s = stateRef.current;
    s.disposed = false;

    const w = container.clientWidth;
    const h = container.clientHeight;

    // ── Renderer ─────────────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
    });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(w, h);
    renderer.setClearColor(C_BG_SCENE, 1);
    s.renderer = renderer;

    // ── Scene & Camera ────────────────────────────────────────────────────────
    const scene = new THREE.Scene();
    s.scene = scene;

    const camera = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, -100, 100);
    camera.position.z = 1;
    camera.zoom = 0.85;
    camera.updateProjectionMatrix();
    s.camera = camera;

    // ── Build graph ───────────────────────────────────────────────────────────
    const graph = computeModelGraph(models);
    const posMap = new Map(graph.nodes.map((n) => [n.model.id, { x: n.x, y: n.y }]));

    // Draw edges first (behind nodes)
    for (const edge of graph.edges) {
      const from = posMap.get(edge.fromId);
      const to = posMap.get(edge.toId);
      if (!from || !to) continue;

      const color = edgeColor(edge.type);

      if (edge.type === 'mixin') {
        const geo = buildEdgeGeometry(from.x, from.y, to.x, to.y);
        const mat = new THREE.LineDashedMaterial({ color, dashSize: 6, gapSize: 4, linewidth: 1 });
        const line = new THREE.Line(geo, mat);
        line.computeLineDistances();
        scene.add(line);
      } else {
        const geo = buildEdgeGeometry(from.x, from.y, to.x, to.y);
        const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color }));
        scene.add(line);
      }

      // Arrow tip for inherits edges
      if (edge.type === 'inherits') {
        const arrow = buildArrow(from.x, from.y, to.x, to.y, color);
        scene.add(arrow);
      }
    }

    // Draw nodes
    const nodeObjects: NodeObjects[] = [];
    for (const graphNode of graph.nodes) {
      const { model, x, y } = graphNode;

      // Background plane with texture
      const texture = createNodeTexture(model);
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(NODE_W, NODE_H),
        new THREE.MeshBasicMaterial({ map: texture, transparent: false }),
      );
      mesh.position.set(x, y, 0);
      mesh.userData = { modelId: model.id };
      scene.add(mesh);

      // Border line
      const borderGeo = createNodeBorderGeometry();
      const border = new THREE.Line(
        borderGeo,
        new THREE.LineBasicMaterial({ color: C_BORDER_DEFAULT }),
      );
      border.position.set(x, y, 0.01);
      scene.add(border);

      nodeObjects.push({ modelId: model.id, mesh, border });
    }

    s.nodeObjects = nodeObjects;
    updateBorderColors();

    // ── Animation loop ────────────────────────────────────────────────────────
    function render() {
      if (s.disposed) return;
      s.rafId = requestAnimationFrame(render);
      renderer.render(scene, camera);
    }
    render();

    // ── Resize observer ───────────────────────────────────────────────────────
    const ro = new ResizeObserver(() => {
      if (s.disposed) return;
      const nw = container.clientWidth;
      const nh = container.clientHeight;
      renderer.setSize(nw, nh);
      camera.left = -nw / 2;
      camera.right = nw / 2;
      camera.top = nh / 2;
      camera.bottom = -nh / 2;
      camera.updateProjectionMatrix();
    });
    ro.observe(container);

    // ── Mouse interaction ─────────────────────────────────────────────────────
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    function toNDC(e: MouseEvent) {
      const rect = canvas.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    }

    function getHitNode(e: MouseEvent): string | null {
      toNDC(e);
      raycaster.setFromCamera(mouse, camera);
      const meshes = s.nodeObjects.map((o) => o.mesh);
      const hits = raycaster.intersectObjects(meshes);
      return hits.length > 0 ? (hits[0].object.userData.modelId as string) : null;
    }

    function onMouseMove(e: MouseEvent) {
      if (s.isPanning) {
        const dx = e.clientX - s.panStart.x;
        const dy = e.clientY - s.panStart.y;
        s.panStart = { x: e.clientX, y: e.clientY };
        if (s.camera) {
          s.camera.position.x -= dx / (s.camera.zoom);
          s.camera.position.y += dy / (s.camera.zoom);
        }
        return;
      }

      const hitId = getHitNode(e);
      if (hitId !== s.hoveredId) {
        s.hoveredId = hitId;
        canvas.style.cursor = hitId ? 'pointer' : 'default';
        updateBorderColors();
      }
    }

    function onMouseDown(e: MouseEvent) {
      if (e.button !== 0) return;
      s.isPanning = true;
      s.panStart = { x: e.clientX, y: e.clientY };
      s.clickOrigin = { x: e.clientX, y: e.clientY }; // preserved for click-vs-drag detection
      canvas.style.cursor = 'grabbing';
    }

    function onMouseUp(e: MouseEvent) {
      if (!s.isPanning) return;
      // Compare against clickOrigin, not panStart (panStart mutates during drag)
      const dx = Math.abs(e.clientX - s.clickOrigin.x);
      const dy = Math.abs(e.clientY - s.clickOrigin.y);
      s.isPanning = false;
      canvas.style.cursor = s.hoveredId ? 'pointer' : 'default';

      // Treat as click if mouse barely moved
      if (dx < 4 && dy < 4) {
        const hitId = getHitNode(e);
        if (hitId) {
          s.selectedId = hitId;
          updateBorderColors();
          const model = s.models.find((m) => m.id === hitId);
          if (model) s.onNodeClick(model);
        } else {
          s.selectedId = null;
          updateBorderColors();
          s.onNodeClick(null);
        }
      }
    }

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      if (!s.camera) return;
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      s.camera.zoom = Math.max(0.2, Math.min(4, s.camera.zoom * factor));
      s.camera.updateProjectionMatrix();
    }

    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    // ── Cleanup ───────────────────────────────────────────────────────────────
    return () => {
      s.disposed = true;
      cancelAnimationFrame(s.rafId);
      ro.disconnect();
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('wheel', onWheel);

      // Dispose Three.js resources (including textures to prevent GPU memory leaks)
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m) => {
              if ((m as THREE.MeshBasicMaterial).map) {
                (m as THREE.MeshBasicMaterial).map!.dispose();
              }
              m.dispose();
            });
          } else {
            const mat = obj.material as THREE.MeshBasicMaterial;
            if (mat.map) mat.map.dispose();
            mat.dispose();
          }
        } else if (obj instanceof THREE.Line) {
          obj.geometry.dispose();
          (obj.material as THREE.Material).dispose();
        }
      });
      renderer.dispose();
      s.renderer = null;
      s.scene = null;
      s.camera = null;
      s.nodeObjects = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models]);

  // Sync selectedModelId prop → internal state
  useEffect(() => {
    stateRef.current.selectedId = selectedModelId;
    updateBorderColors();
  }, [selectedModelId, updateBorderColors]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />

      {/* Legend */}
      <div
        style={{
          position: 'absolute',
          bottom: 12,
          left: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          padding: '8px 12px',
          background: 'rgba(17, 19, 32, 0.85)',
          borderRadius: 6,
          border: '1px solid rgba(255,255,255,0.08)',
          backdropFilter: 'blur(4px)',
          pointerEvents: 'none',
        }}
      >
        <LegendRow color="#4a9eff" dash={false} text="inherits" />
        <LegendRow color="#9b59b6" dash text="mixin" />
        <LegendRow color="#2ecc71" dash={false} text="field ref" thin />
      </div>

      {/* Interaction hint */}
      <div
        style={{
          position: 'absolute',
          bottom: 12,
          right: 12,
          color: 'rgba(255,255,255,0.3)',
          fontSize: 11,
          fontFamily: 'var(--font-ui)',
          pointerEvents: 'none',
        }}
      >
        scroll to zoom · drag to pan · click node to inspect
      </div>
    </div>
  );
}

function LegendRow({
  color,
  dash,
  text,
  thin,
}: {
  color: string;
  dash: boolean;
  text: string;
  thin?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div
        style={{
          width: 24,
          height: 0,
          borderTop: `${thin ? 1 : 2}px ${dash ? 'dashed' : 'solid'} ${color}`,
        }}
      />
      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', fontFamily: 'var(--font-ui)' }}>
        {text}
      </span>
    </div>
  );
}
