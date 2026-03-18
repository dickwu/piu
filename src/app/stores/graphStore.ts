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

interface GraphStore {
  // --- Phase 1 (existing) ---
  graph: Graph | null;
  setGraph: (graph: Graph | null) => void;

  isComputing: boolean;
  setComputing: (value: boolean) => void;

  selectedNode: SelectedNode | null;
  setSelectedNode: (node: SelectedNode | null) => void;

  nodeIndexToId: string[];
  setNodeIndexToId: (mapping: string[]) => void;

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

  // --- Phase 3: Visual settings ---
  bloomEnabled: boolean;
  setBloomEnabled: (enabled: boolean) => void;

  // --- Phase 3: Camera control ---
  fitViewRequested: boolean;
  requestFitView: () => void;
  clearFitView: () => void;
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

  nodeIndexToId: [],
  setNodeIndexToId: (mapping) => set({ nodeIndexToId: mapping }),

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

  // Phase 3: Visual settings
  bloomEnabled: false,
  setBloomEnabled: (enabled) => set({ bloomEnabled: enabled }),

  // Phase 3: Camera control
  fitViewRequested: false,
  requestFitView: () => set({ fitViewRequested: true }),
  clearFitView: () => set({ fitViewRequested: false }),
}));
