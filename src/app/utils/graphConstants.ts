// src/app/utils/graphConstants.ts
// Consolidated visual constants for graph rendering (GitNexus pattern)

// --- Animation Config ---
export const ANIMATION_CONFIG = {
  pulse:  { color: '#06b6d4', duration: 2000, baseScale: 1.5, oscillation: 0.8 },
  ripple: { color: '#ef4444', duration: 3000, baseScale: 1.3, oscillation: 1.2 },
  glow:   { color: '#a855f7', duration: 4000, baseScale: 1.4, oscillation: 0.6 },
} as const

export type AnimationTypeName = keyof typeof ANIMATION_CONFIG

// --- Node Size Multipliers (reducer) ---
export const NODE_SIZE = {
  selected: 1.8,
  selectedNeighbor: 1.3,
  pathHighlight: 1.6,
  blastRadius: 1.8,
  blastHighlight: 1.4,
  highlight: 1.6,
  overviewScale: 0.8,
  dimmed: {
    blastRadius: 0.4,
    highlight: 0.5,
    selection: 0.6,
  },
} as const

// --- Dim Amounts (0 = fully dimmed to background, 1 = full color) ---
export const DIM_AMOUNT = {
  blastRadius: 0.15,
  highlight: 0.20,
  selection: 0.25,
} as const

// --- Edge Width Multipliers (reducer) ---
export const EDGE_WIDTH = {
  pathHighlight: 3,
  highlightBoth: 3,
  highlightOne: 1,
  highlightNeither: 0.2,
  selectionConnected: 4,
  selectionDisconnected: 0.3,
} as const

// --- Path Highlight ---
export const PATH_HIGHLIGHT_COLOR = '#f59e0b'

// --- Sigma Camera ---
export const CAMERA = {
  minRatio: 0.002,
  maxRatio: 50,
  zoomDuration: 200,
  focusDuration: 400,
  resetDuration: 300,
  focusRatio: 0.15,
} as const

// --- Edge Curve ---
export const EDGE_CURVATURE = 0.15

// --- ForceAtlas2 ---
export const FA2_TIMEOUT_MS = 15_000
export const FA2_SCALING_MULTIPLIER = 3
export const FA2_GRAVITY_MULTIPLIER = 0.5
export const NOVERLAP_MAX_ITERATIONS = 200
export const NOVERLAP_MARGIN = 14
