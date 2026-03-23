import { create } from 'zustand';
import Graph from 'graphology';
import {
  type FilterState,
  type SearchResult,
  type CommunityInfo,
  DEFAULT_FILTERS,
} from '../utils/graphAlgorithms';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SelectedNode {
  nodeId: string;
  entityType: 'collection' | 'request' | 'model';
  entityId: string;
}

// TEMPORARY — will be replaced by import from '../utils/graphClustering' in Task 3
export interface ClusterInfo {
  id: string;
  name: string;
  color: string;
  nodeIds: Set<string>;
  centroid: { x: number; y: number };
}

// --- Animation types (ported from GitNexus) ---
export type AnimationType = 'pulse' | 'ripple' | 'glow';

export interface NodeAnimation {
  type: AnimationType;
  startTime: number;
  duration: number;
}

interface GraphStore {
  // --- Phase 1 (existing) ---
  graph: Graph | null;
  setGraph: (graph: Graph | null) => void;

  isComputing: boolean;
  setComputing: (value: boolean) => void;

  selectedNode: SelectedNode | null;
  setSelectedNode: (node: SelectedNode | null) => void;

  // --- Phase 2: Filters ---
  filters: FilterState;
  setFilters: (filters: FilterState) => void;
  updateFilter: <K extends keyof FilterState>(key: K, value: FilterState[K]) => void;
  resetFilters: () => void;

  // --- Phase 2: Search ---
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  searchResults: SearchResult[];
  setSearchResults: (results: SearchResult[]) => void;
  activeSearchIndex: number;
  setActiveSearchIndex: (index: number) => void;

  // --- Phase 2: Hover ---
  hoveredNodeId: string | null;
  setHoveredNodeId: (nodeId: string | null) => void;

  // --- Phase 2: Selection history (transport) ---
  selectionHistory: string[];
  selectionHistoryIndex: number;
  pushSelection: (nodeId: string) => void;
  navigateBack: () => void;
  navigateForward: () => void;

  // --- Phase 2: Path highlight ---
  pathNodeIds: Set<string>;
  setPathNodeIds: (ids: Set<string>) => void;
  clearPath: () => void;

  // --- Phase 2: Visible set ---
  visibleNodeIds: Set<string> | null; // null = show all
  setVisibleNodeIds: (ids: Set<string> | null) => void;

  // --- Phase 2: Communities ---
  communities: CommunityInfo[];
  setCommunities: (communities: CommunityInfo[]) => void;

  // --- Phase 4: Cluster fusion ---
  clusterMode: 'overview' | 'focus' | 'off';
  setClusterMode: (mode: 'overview' | 'focus' | 'off') => void;

  clusters: Map<string, ClusterInfo>;
  setClusters: (clusters: Map<string, ClusterInfo>) => void;

  focusedClusterId: string | null;
  setFocusedClusterId: (id: string | null) => void;

  // --- Phase 5: Theme ---
  graphTheme: 'dark' | 'light';
  toggleGraphTheme: () => void;

  // --- Phase 6: Animation + Highlight (GitNexus-style) ---
  animatedNodes: Map<string, NodeAnimation>;
  triggerNodeAnimation: (nodeIds: string[], type: AnimationType) => void;
  clearAnimations: () => void;

  highlightedNodeIds: Set<string> | null;
  setHighlightedNodeIds: (ids: Set<string> | null) => void;

  blastRadiusNodeIds: Set<string> | null;
  setBlastRadiusNodeIds: (ids: Set<string> | null) => void;

  // --- Sigma state ---
  graphError: string | null;
  setGraphError: (error: string | null) => void;

  visibleEdgeTypes: Set<string>;
  setVisibleEdgeTypes: (types: Set<string>) => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useGraphStore = create<GraphStore>((set, get) => ({
  // Phase 1
  graph: null,
  setGraph: (graph) => set({ graph }),

  isComputing: false,
  setComputing: (value) => set({ isComputing: value }),

  selectedNode: null,
  setSelectedNode: (node) => set({ selectedNode: node }),

  // Phase 2: Filters
  filters: { ...DEFAULT_FILTERS },
  setFilters: (filters) => set({ filters }),
  updateFilter: (key, value) =>
    set((state) => ({ filters: { ...state.filters, [key]: value } })),
  resetFilters: () => set({ filters: { ...DEFAULT_FILTERS } }),

  // Phase 2: Search
  searchQuery: '',
  setSearchQuery: (query) => set({ searchQuery: query }),
  searchResults: [],
  setSearchResults: (results) => set({ searchResults: results }),
  activeSearchIndex: 0,
  setActiveSearchIndex: (index) => set({ activeSearchIndex: index }),

  // Phase 2: Hover
  hoveredNodeId: null,
  setHoveredNodeId: (nodeId) => set({ hoveredNodeId: nodeId }),

  // Phase 2: Selection history
  selectionHistory: [],
  selectionHistoryIndex: -1,
  pushSelection: (nodeId) => {
    const { selectionHistory, selectionHistoryIndex } = get();
    // Truncate forward history if we navigated back
    const truncated = selectionHistory.slice(0, selectionHistoryIndex + 1);
    set({
      selectionHistory: [...truncated, nodeId],
      selectionHistoryIndex: truncated.length,
    });
  },
  navigateBack: () => {
    const { selectionHistoryIndex } = get();
    if (selectionHistoryIndex > 0) {
      set({ selectionHistoryIndex: selectionHistoryIndex - 1 });
    }
  },
  navigateForward: () => {
    const { selectionHistory, selectionHistoryIndex } = get();
    if (selectionHistoryIndex < selectionHistory.length - 1) {
      set({ selectionHistoryIndex: selectionHistoryIndex + 1 });
    }
  },

  // Phase 2: Path highlight
  pathNodeIds: new Set(),
  setPathNodeIds: (ids) => set({ pathNodeIds: ids }),
  clearPath: () => set({ pathNodeIds: new Set() }),

  // Phase 2: Visible set
  visibleNodeIds: null,
  setVisibleNodeIds: (ids) => set({ visibleNodeIds: ids }),

  // Phase 2: Communities
  communities: [],
  setCommunities: (communities) => set({ communities }),

  // Phase 4: Cluster fusion
  clusterMode: 'off',
  setClusterMode: (mode) => set({ clusterMode: mode }),

  clusters: new Map(),
  setClusters: (clusters) => set({ clusters }),

  focusedClusterId: null,
  setFocusedClusterId: (id) => set({ focusedClusterId: id }),

  // Phase 5: Theme
  graphTheme: 'dark',
  toggleGraphTheme: () =>
    set((state) => ({ graphTheme: state.graphTheme === 'dark' ? 'light' : 'dark' })),

  // Phase 6: Animation + Highlight
  animatedNodes: new Map(),
  triggerNodeAnimation: (nodeIds, type) => {
    const now = Date.now();
    const duration = type === 'pulse' ? 2000 : type === 'ripple' ? 3000 : 4000;
    set((state) => {
      const next = new Map(state.animatedNodes);
      for (const id of nodeIds) {
        next.set(id, { type, startTime: now, duration });
      }
      return { animatedNodes: next };
    });
    setTimeout(() => {
      set((state) => {
        const next = new Map(state.animatedNodes);
        for (const id of nodeIds) next.delete(id);
        return { animatedNodes: next };
      });
    }, duration + 100);
  },
  clearAnimations: () => set({ animatedNodes: new Map() }),

  highlightedNodeIds: null,
  setHighlightedNodeIds: (ids) => set({ highlightedNodeIds: ids }),

  blastRadiusNodeIds: null,
  setBlastRadiusNodeIds: (ids) => set({ blastRadiusNodeIds: ids }),

  // Sigma state
  graphError: null,
  setGraphError: (error) => set({ graphError: error }),

  visibleEdgeTypes: new Set(['col-subcol', 'col-request', 'req-reqModel', 'req-resModel', 'model-inherits', 'model-mixin', 'model-fieldRef']),
  setVisibleEdgeTypes: (types) => set({ visibleEdgeTypes: types }),
}));
