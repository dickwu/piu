import { create } from 'zustand';
import Graph from 'graphology';

interface SelectedNode {
  nodeId: string;
  entityType: 'collection' | 'request' | 'model';
  entityId: string;
}

interface GraphStore {
  graph: Graph | null;
  setGraph: (graph: Graph | null) => void;

  isComputing: boolean;
  setComputing: (value: boolean) => void;

  selectedNode: SelectedNode | null;
  setSelectedNode: (node: SelectedNode | null) => void;

  nodeIndexToId: string[];
  setNodeIndexToId: (mapping: string[]) => void;
}

export const useGraphStore = create<GraphStore>((set) => ({
  graph: null,
  setGraph: (graph) => set({ graph }),

  isComputing: false,
  setComputing: (value) => set({ isComputing: value }),

  selectedNode: null,
  setSelectedNode: (node) => set({ selectedNode: node }),

  nodeIndexToId: [],
  setNodeIndexToId: (mapping) => set({ nodeIndexToId: mapping }),
}));
