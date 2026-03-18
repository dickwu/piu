'use client';

import { useCallback, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { Input, Flex } from 'antd';
import type { InputRef } from 'antd';
import {
  LeftOutlined,
  RightOutlined,
  HomeOutlined,
  ReloadOutlined,
  SearchOutlined,
  CloseOutlined,
} from '@ant-design/icons';

import { useGraphStore } from '../../stores/graphStore';
import { searchNodes } from '../../utils/graphAlgorithms';
import type { SearchResult } from '../../utils/graphAlgorithms';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const METHOD_COLORS: Record<string, string> = {
  GET: '#34d399',
  POST: '#60a5fa',
  PUT: '#fbbf24',
  PATCH: '#a78bfa',
  DELETE: '#f87171',
  HEAD: '#94a3b8',
  OPTIONS: '#94a3b8',
};

const ENTITY_COLORS: Record<string, string> = {
  collection: '#fbbf24',
  request: '#34d399',
  model: '#4a9eff',
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const TOOLBAR_REST: CSSProperties = {
  position: 'absolute',
  top: 12,
  left: 12,
  right: 12,
  zIndex: 20,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 10px',
  borderRadius: 10,
  backdropFilter: 'blur(12px)',
  background: 'rgba(17, 19, 32, 0.6)',
  border: '1px solid rgba(255,255,255,0.08)',
  opacity: 0.6,
  transition: 'opacity 0.18s ease, background 0.18s ease',
  pointerEvents: 'auto',
};

const TOOLBAR_HOVER: CSSProperties = {
  ...TOOLBAR_REST,
  opacity: 1,
  background: 'rgba(17, 19, 32, 0.88)',
};

const DIVIDER: CSSProperties = {
  width: 1,
  height: 20,
  background: 'rgba(255,255,255,0.12)',
  flexShrink: 0,
};

const FILTER_DOT: CSSProperties = {
  display: 'inline-block',
  width: 7,
  height: 7,
  borderRadius: '50%',
  marginRight: 4,
  flexShrink: 0,
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ResultDot({ entityType, method }: { entityType: string; method?: string }) {
  let color: string = ENTITY_COLORS.request;
  if (entityType === 'collection') color = ENTITY_COLORS.collection;
  else if (entityType === 'model') color = ENTITY_COLORS.model;
  else if (method) color = METHOD_COLORS[method.toUpperCase()] ?? ENTITY_COLORS.request;

  return <span style={{ ...FILTER_DOT, background: color }} />;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface GraphToolbarProps {
  onResetLayout: () => void;
  onFitView: () => void;
  onFlyToNode?: (nodeId: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function GraphToolbar({ onResetLayout, onFitView, onFlyToNode }: GraphToolbarProps) {
  const graph = useGraphStore((s) => s.graph);
  const searchQuery = useGraphStore((s) => s.searchQuery);
  const searchResults = useGraphStore((s) => s.searchResults);
  const activeSearchIndex = useGraphStore((s) => s.activeSearchIndex);
  const filters = useGraphStore((s) => s.filters);
  const selectionHistory = useGraphStore((s) => s.selectionHistory);
  const selectionHistoryIndex = useGraphStore((s) => s.selectionHistoryIndex);

  const setSearchQuery = useGraphStore((s) => s.setSearchQuery);
  const setSearchResults = useGraphStore((s) => s.setSearchResults);
  const setActiveSearchIndex = useGraphStore((s) => s.setActiveSearchIndex);
  const updateFilter = useGraphStore((s) => s.updateFilter);
  const resetFilters = useGraphStore((s) => s.resetFilters);
  const navigateBack = useGraphStore((s) => s.navigateBack);
  const navigateForward = useGraphStore((s) => s.navigateForward);

  const [hovered, setHovered] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const inputRef = useRef<InputRef>(null);

  // -------------------------------------------------------------------------
  // Search handlers
  // -------------------------------------------------------------------------

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchQuery(value);
      if (!graph || !value.trim()) {
        setSearchResults([]);
        setActiveSearchIndex(0);
        setDropdownOpen(false);
        return;
      }
      const results = searchNodes(graph, value);
      setSearchResults(results);
      setActiveSearchIndex(0);
      setDropdownOpen(results.length > 0);
    },
    [graph, setSearchQuery, setSearchResults, setActiveSearchIndex],
  );

  const flyToResult = useCallback(
    (result: SearchResult) => {
      onFlyToNode?.(result.nodeId);
    },
    [onFlyToNode],
  );

  const cycleNext = useCallback(() => {
    if (searchResults.length === 0) return;
    const nextIndex = (activeSearchIndex + 1) % searchResults.length;
    setActiveSearchIndex(nextIndex);
    flyToResult(searchResults[nextIndex]);
  }, [searchResults, activeSearchIndex, setActiveSearchIndex, flyToResult]);

  const cyclePrev = useCallback(() => {
    if (searchResults.length === 0) return;
    const prevIndex = (activeSearchIndex - 1 + searchResults.length) % searchResults.length;
    setActiveSearchIndex(prevIndex);
    flyToResult(searchResults[prevIndex]);
  }, [searchResults, activeSearchIndex, setActiveSearchIndex, flyToResult]);

  const clearSearch = useCallback(() => {
    setSearchQuery('');
    setSearchResults([]);
    setActiveSearchIndex(0);
    setDropdownOpen(false);
  }, [setSearchQuery, setSearchResults, setActiveSearchIndex]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          cyclePrev();
        } else {
          cycleNext();
        }
      } else if (e.key === 'Escape') {
        clearSearch();
        inputRef.current?.blur();
      }
    },
    [cycleNext, cyclePrev, clearSearch],
  );

  const handleResultClick = useCallback(
    (result: SearchResult, index: number) => {
      setActiveSearchIndex(index);
      flyToResult(result);
      setDropdownOpen(false);
    },
    [setActiveSearchIndex, flyToResult],
  );

  // -------------------------------------------------------------------------
  // Derived state
  // -------------------------------------------------------------------------

  const canBack = selectionHistoryIndex > 0;
  const canForward = selectionHistoryIndex < selectionHistory.length - 1;
  const matchLabel =
    searchResults.length > 0
      ? `${activeSearchIndex + 1} of ${searchResults.length}`
      : null;

  // -------------------------------------------------------------------------
  // Shared button style
  // -------------------------------------------------------------------------

  const iconBtnStyle: CSSProperties = {
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.1)',
    color: 'rgba(255,255,255,0.75)',
    borderRadius: 6,
    height: 28,
    minWidth: 28,
    padding: '0 6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    cursor: 'pointer',
    flexShrink: 0,
  };

  const filterBtnStyle = (active: boolean, color: string): CSSProperties => ({
    ...iconBtnStyle,
    color: active ? color : 'rgba(255,255,255,0.3)',
    borderColor: active ? `${color}55` : 'rgba(255,255,255,0.08)',
    textDecoration: active ? 'none' : 'line-through',
    fontWeight: 600,
    fontSize: 11,
    letterSpacing: '0.02em',
  });

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div
      style={hovered ? TOOLBAR_HOVER : TOOLBAR_REST}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Search section */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Input
            ref={inputRef}
            data-graph-search
            size="small"
            prefix={<SearchOutlined style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12 }} />}
            suffix={
              searchQuery ? (
                <CloseOutlined
                  style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, cursor: 'pointer' }}
                  onClick={clearSearch}
                />
              ) : null
            }
            placeholder="Search collections, requests, models..."
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => searchResults.length > 0 && setDropdownOpen(true)}
            onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
            style={{
              width: 260,
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 6,
              color: '#e2e8f0',
              fontSize: 12,
              height: 28,
            }}
            variant="borderless"
          />
          {matchLabel && (
            <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, whiteSpace: 'nowrap', flexShrink: 0 }}>
              {matchLabel}
            </span>
          )}
        </div>

        {/* Search dropdown */}
        {dropdownOpen && searchResults.length > 0 && (
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 6px)',
              left: 0,
              right: 0,
              background: 'rgba(17, 19, 32, 0.96)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 8,
              backdropFilter: 'blur(12px)',
              maxHeight: 240,
              overflowY: 'auto',
              zIndex: 30,
            }}
          >
            {searchResults.slice(0, 20).map((result, i) => (
              <div
                key={result.nodeId}
                onMouseDown={() => handleResultClick(result, i)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 10px',
                  cursor: 'pointer',
                  background: i === activeSearchIndex ? 'rgba(255,255,255,0.08)' : 'transparent',
                  borderRadius: i === 0 ? '8px 8px 0 0' : i === searchResults.length - 1 ? '0 0 8px 8px' : 0,
                  fontSize: 12,
                  color: '#e2e8f0',
                  transition: 'background 0.1s',
                }}
              >
                <ResultDot entityType={result.entityType} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {result.label}
                </span>
                <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, flexShrink: 0, textTransform: 'uppercase' }}>
                  {result.entityType.slice(0, 1)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={DIVIDER} />

      {/* Transport controls */}
      <Flex align="center" gap={4} style={{ flexShrink: 0 }}>
        <button
          style={{ ...iconBtnStyle, opacity: canBack ? 1 : 0.35, cursor: canBack ? 'pointer' : 'not-allowed' }}
          onClick={canBack ? navigateBack : undefined}
          title="Navigate back"
        >
          <LeftOutlined style={{ fontSize: 11 }} />
        </button>

        <button
          style={iconBtnStyle}
          onClick={onFitView}
          title="Fit view"
        >
          <HomeOutlined style={{ fontSize: 11 }} />
        </button>

        <button
          style={{ ...iconBtnStyle, opacity: canForward ? 1 : 0.35, cursor: canForward ? 'pointer' : 'not-allowed' }}
          onClick={canForward ? navigateForward : undefined}
          title="Navigate forward"
        >
          <RightOutlined style={{ fontSize: 11 }} />
        </button>

        <button
          style={iconBtnStyle}
          onClick={onResetLayout}
          title="Reset layout"
        >
          <ReloadOutlined style={{ fontSize: 11 }} />
        </button>
      </Flex>

      <div style={DIVIDER} />

      {/* Filter toggles */}
      <Flex align="center" gap={4} style={{ flexShrink: 0 }}>
        <button
          style={filterBtnStyle(filters.showCollections, ENTITY_COLORS.collection)}
          onClick={() => updateFilter('showCollections', !filters.showCollections)}
          title={filters.showCollections ? 'Hide collections' : 'Show collections'}
        >
          <span style={{ ...FILTER_DOT, background: ENTITY_COLORS.collection, opacity: filters.showCollections ? 1 : 0.3 }} />
          C
        </button>

        <button
          style={filterBtnStyle(filters.showRequests, ENTITY_COLORS.request)}
          onClick={() => updateFilter('showRequests', !filters.showRequests)}
          title={filters.showRequests ? 'Hide requests' : 'Show requests'}
        >
          <span style={{ ...FILTER_DOT, background: ENTITY_COLORS.request, opacity: filters.showRequests ? 1 : 0.3 }} />
          R
        </button>

        <button
          style={filterBtnStyle(filters.showModels, ENTITY_COLORS.model)}
          onClick={() => updateFilter('showModels', !filters.showModels)}
          title={filters.showModels ? 'Hide models' : 'Show models'}
        >
          <span style={{ ...FILTER_DOT, background: ENTITY_COLORS.model, opacity: filters.showModels ? 1 : 0.3 }} />
          M
        </button>

        {(!filters.showCollections || !filters.showRequests || !filters.showModels) && (
          <button
            style={{ ...iconBtnStyle, color: 'rgba(255,255,255,0.5)', fontSize: 10 }}
            onClick={resetFilters}
            title="Reset all filters"
          >
            All
          </button>
        )}
      </Flex>
    </div>
  );
}
