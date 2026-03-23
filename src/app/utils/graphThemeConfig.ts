// src/app/utils/graphThemeConfig.ts

export interface GraphThemeConfig {
  background: string;
  nodeColor: string;
  edgeColor: string;
  edgeOpacity: number;
  labelColor: string;
  labelShadow: string;
  clusterLabelOpacity: number;
  clusterPalette: string[];
}

const DARK_CLUSTER_PALETTE: string[] = [
  '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
  '#14b8a6', '#e11d48', '#a78bfa', '#34d399', '#60a5fa',
  '#fb7185', '#fbbf24', '#4ade80', '#38bdf8', '#c084fc',
  '#fb923c', '#a3e635', '#22d3ee', '#f472b6',
];

const LIGHT_CLUSTER_PALETTE: string[] = [
  '#fbbf24', '#34d399', '#93c5fd', '#fca5a5', '#c4b5fd',
  '#f9a8d4', '#67e8f9', '#bef264', '#fdba74', '#a5b4fc',
  '#5eead4', '#fb7185', '#ddd6fe', '#6ee7b7', '#bfdbfe',
  '#fda4af', '#fde68a', '#86efac', '#7dd3fc', '#e9d5ff',
  '#fed7aa', '#d9f99d', '#a5f3fc', '#f9a8d4',
];

export const DARK_THEME: GraphThemeConfig = {
  background: '#111320',
  nodeColor: '#a78bfa',
  edgeColor: 'rgba(255,255,255,0.08)',
  edgeOpacity: 0.08,
  labelColor: 'rgba(255,255,255,0.85)',
  labelShadow: '0 1px 4px rgba(0,0,0,0.8)',
  clusterLabelOpacity: 0.8,
  clusterPalette: DARK_CLUSTER_PALETTE,
};

export const LIGHT_THEME: GraphThemeConfig = {
  background: '#f3f4f6',
  nodeColor: '#8b5cf6',
  edgeColor: 'rgba(0,0,0,0.06)',
  edgeOpacity: 0.06,
  labelColor: '#374151',
  labelShadow: '0 1px 2px rgba(0,0,0,0.1)',
  clusterLabelOpacity: 0.8,
  clusterPalette: LIGHT_CLUSTER_PALETTE,
};

export function getGraphTheme(mode: 'dark' | 'light'): GraphThemeConfig {
  return mode === 'dark' ? DARK_THEME : LIGHT_THEME;
}
