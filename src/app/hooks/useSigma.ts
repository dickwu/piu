// src/app/hooks/useSigma.ts
// Core rendering hook: owns Sigma lifecycle, layout, reducers, camera, events.

import { useEffect, useRef, useCallback, type RefObject } from 'react'
import Sigma from 'sigma'
import { NodeCircleProgram } from 'sigma/rendering'
import EdgeCurveProgram from '@sigma/edge-curve'
import FA2LayoutSupervisor from 'graphology-layout-forceatlas2/worker'
import { inferSettings } from 'graphology-layout-forceatlas2'
import noverlap from 'graphology-layout-noverlap'
import type Graph from 'graphology'
import type { Attributes } from 'graphology-types'
import type { NodeDisplayData, EdgeDisplayData } from 'sigma/types'
import { invoke } from '@tauri-apps/api/core'

import { useGraphStore, type NodeAnimation } from '../stores/graphStore'
import {
  ANIMATION_CONFIG,
  NODE_SIZE,
  DIM_AMOUNT,
  EDGE_WIDTH,
  PATH_HIGHLIGHT_COLOR,
  CAMERA,
  FA2_TIMEOUT_MS,
  FA2_SCALING_MULTIPLIER,
  FA2_GRAVITY_MULTIPLIER,
  NOVERLAP_MAX_ITERATIONS,
  NOVERLAP_MARGIN,
} from '../utils/graphConstants'
import { dimColor, brightenColor } from '../utils/graphColorUtils'
import { getGraphTheme } from '../utils/graphThemeConfig'
import {
  seedRandomPositions,
  hasCachedPositions,
  extractPositionsForSave,
} from '../utils/graphDataTransform'
import { spreadClusters } from '../utils/graphClustering'

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export interface SigmaControls {
  zoomIn: () => void
  zoomOut: () => void
  resetView: () => void
  focusNode: (nodeId: string) => void
  focusCluster: (clusterId: string) => void
  restartLayout: () => void
  sigmaRef: RefObject<Sigma | null>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getNeighborSet(graph: Graph, nodeId: string): Set<string> {
  const neighbors = new Set<string>()
  try {
    graph.forEachNeighbor(nodeId, (neighbor) => {
      neighbors.add(neighbor)
    })
  } catch {
    // node may not exist
  }
  return neighbors
}

function computeAnimationScale(anim: NodeAnimation): number {
  const config = ANIMATION_CONFIG[anim.type]
  const elapsed = Date.now() - anim.startTime
  const progress = Math.min(elapsed / config.duration, 1)
  const sine = Math.sin(progress * Math.PI * 2 * config.oscillation)
  return config.baseScale + sine * 0.3 * (1 - progress)
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSigmaGraph(
  containerRef: RefObject<HTMLDivElement | null>,
  projectId: string | null,
): SigmaControls {
  const sigmaRef = useRef<Sigma | null>(null)
  const fa2Ref = useRef<FA2LayoutSupervisor | null>(null)
  const fa2TimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const animFrameRef = useRef<number | null>(null)

  // -------------------------------------------------------------------------
  // Store selectors — subscribe to individual fields to avoid excess re-renders
  // -------------------------------------------------------------------------
  const graph = useGraphStore((s) => s.graph)
  const selectedNode = useGraphStore((s) => s.selectedNode)
  const hoveredNodeId = useGraphStore((s) => s.hoveredNodeId)
  const filters = useGraphStore((s) => s.filters)
  const visibleNodeIds = useGraphStore((s) => s.visibleNodeIds)
  const visibleEdgeTypes = useGraphStore((s) => s.visibleEdgeTypes)
  const pathNodeIds = useGraphStore((s) => s.pathNodeIds)
  const highlightedNodeIds = useGraphStore((s) => s.highlightedNodeIds)
  const blastRadiusNodeIds = useGraphStore((s) => s.blastRadiusNodeIds)
  const animatedNodes = useGraphStore((s) => s.animatedNodes)
  const clusterMode = useGraphStore((s) => s.clusterMode)
  const clusters = useGraphStore((s) => s.clusters)
  const focusedClusterId = useGraphStore((s) => s.focusedClusterId)
  const graphTheme = useGraphStore((s) => s.graphTheme)
  const communities = useGraphStore((s) => s.communities)

  // Store actions (stable references from Zustand)
  const setSelectedNode = useGraphStore((s) => s.setSelectedNode)
  const setHoveredNodeId = useGraphStore((s) => s.setHoveredNodeId)
  const pushSelection = useGraphStore((s) => s.pushSelection)
  const setGraphError = useGraphStore((s) => s.setGraphError)
  const setComputing = useGraphStore((s) => s.setComputing)
  const setClusters = useGraphStore((s) => s.setClusters)

  // -------------------------------------------------------------------------
  // Refs that hold latest values (for use inside callbacks without re-renders)
  // -------------------------------------------------------------------------
  const stateRef = useRef({
    graph,
    selectedNode,
    hoveredNodeId,
    filters,
    visibleNodeIds,
    visibleEdgeTypes,
    pathNodeIds,
    highlightedNodeIds,
    blastRadiusNodeIds,
    animatedNodes,
    clusterMode,
    clusters,
    focusedClusterId,
    graphTheme,
    communities,
  })

  // Keep stateRef in sync
  useEffect(() => {
    stateRef.current = {
      graph,
      selectedNode,
      hoveredNodeId,
      filters,
      visibleNodeIds,
      visibleEdgeTypes,
      pathNodeIds,
      highlightedNodeIds,
      blastRadiusNodeIds,
      animatedNodes,
      clusterMode,
      clusters,
      focusedClusterId,
      graphTheme,
      communities,
    }
  })

  // -------------------------------------------------------------------------
  // Node reducer
  // -------------------------------------------------------------------------
  const nodeReducer = useCallback(
    (node: string, data: Attributes): Partial<NodeDisplayData> => {
      const s = stateRef.current
      const theme = getGraphTheme(s.graphTheme)
      const baseColor = (data.color as string) ?? theme.nodeColor
      const baseSize = (data.size as number) ?? 3
      const label = (data.label as string) ?? null
      const entityType = data.entity_type as string | undefined

      // 1. Hidden — entity type filters + visibleNodeIds
      if (entityType === 'collection' && !s.filters.showCollections) {
        return { ...data, label, color: baseColor, size: baseSize, hidden: true }
      }
      if (entityType === 'request' && !s.filters.showRequests) {
        return { ...data, label, color: baseColor, size: baseSize, hidden: true }
      }
      if (entityType === 'model' && !s.filters.showModels) {
        return { ...data, label, color: baseColor, size: baseSize, hidden: true }
      }
      if (s.visibleNodeIds !== null && !s.visibleNodeIds.has(node)) {
        return { ...data, label, color: baseColor, size: baseSize, hidden: true }
      }

      // 2. Animation — sine oscillation on size, override color
      const anim = s.animatedNodes.get(node)
      if (anim) {
        const scale = computeAnimationScale(anim)
        const animColor = ANIMATION_CONFIG[anim.type].color
        return { ...data, label, color: animColor, size: baseSize * scale, hidden: false }
      }

      // 3. Cluster focus — show only focused cluster members
      if (s.clusterMode === 'focus' && s.focusedClusterId) {
        const cluster = s.clusters.get(s.focusedClusterId)
        if (cluster && !cluster.nodeIds.has(node)) {
          return { ...data, label, color: baseColor, size: baseSize, hidden: true }
        }
      }

      // 4. Path highlight
      if (s.pathNodeIds.size > 0) {
        if (s.pathNodeIds.has(node)) {
          return {
            ...data,
            label,
            color: PATH_HIGHLIGHT_COLOR,
            size: baseSize * NODE_SIZE.pathHighlight,
            hidden: false,
          }
        }
        return {
          ...data,
          label,
          color: dimColor(baseColor, DIM_AMOUNT.selection, s.graphTheme),
          size: baseSize * NODE_SIZE.dimmed.selection,
          hidden: false,
        }
      }

      // 5. Blast radius
      if (s.blastRadiusNodeIds) {
        if (s.blastRadiusNodeIds.has(node)) {
          return {
            ...data,
            label,
            color: '#ef4444',
            size: baseSize * NODE_SIZE.blastRadius,
            hidden: false,
          }
        }
        if (s.highlightedNodeIds && s.highlightedNodeIds.has(node)) {
          return {
            ...data,
            label,
            color: '#06b6d4',
            size: baseSize * NODE_SIZE.blastHighlight,
            hidden: false,
          }
        }
        return {
          ...data,
          label,
          color: dimColor(baseColor, DIM_AMOUNT.blastRadius, s.graphTheme),
          size: baseSize * NODE_SIZE.dimmed.blastRadius,
          hidden: false,
        }
      }

      // 6. Highlight (no blast)
      if (s.highlightedNodeIds) {
        if (s.highlightedNodeIds.has(node)) {
          return {
            ...data,
            label,
            color: '#06b6d4',
            size: baseSize * NODE_SIZE.highlight,
            hidden: false,
          }
        }
        return {
          ...data,
          label,
          color: dimColor(baseColor, DIM_AMOUNT.highlight, s.graphTheme),
          size: baseSize * NODE_SIZE.dimmed.highlight,
          hidden: false,
        }
      }

      // 7. Selection
      if (s.selectedNode) {
        const selId = s.selectedNode.nodeId
        if (node === selId) {
          return {
            ...data,
            label,
            color: baseColor,
            size: baseSize * NODE_SIZE.selected,
            hidden: false,
            highlighted: true,
          }
        }
        const g = s.graph
        if (g) {
          const neighbors = getNeighborSet(g, selId)
          if (neighbors.has(node)) {
            return {
              ...data,
              label,
              color: baseColor,
              size: baseSize * NODE_SIZE.selectedNeighbor,
              hidden: false,
            }
          }
        }
        return {
          ...data,
          label,
          color: dimColor(baseColor, DIM_AMOUNT.selection, s.graphTheme),
          size: baseSize * NODE_SIZE.dimmed.selection,
          hidden: false,
        }
      }

      // 8. Overview — override color to community color
      if (s.clusterMode === 'overview') {
        const communityColor = (data.community_color as string) ?? baseColor
        return {
          ...data,
          label,
          color: communityColor,
          size: baseSize * NODE_SIZE.overviewScale,
          hidden: false,
        }
      }

      // 9. Default
      return { ...data, label, color: baseColor, size: baseSize, hidden: false }
    },
    [], // all state is read from stateRef
  )

  // -------------------------------------------------------------------------
  // Edge reducer
  // -------------------------------------------------------------------------
  const edgeReducer = useCallback(
    (edge: string, data: Attributes): Partial<EdgeDisplayData> => {
      const s = stateRef.current
      const g = s.graph
      if (!g) return { ...data, hidden: true }

      const baseColor = (data.color as string) ?? '#555'
      const baseWidth = (data.width as number) ?? 1
      const edgeType = data.edge_type as string | undefined

      let source: string
      let target: string
      try {
        source = g.source(edge)
        target = g.target(edge)
      } catch {
        return { ...data, hidden: true }
      }

      // 1. Type filter
      if (edgeType && !s.visibleEdgeTypes.has(edgeType)) {
        return { ...data, hidden: true }
      }

      // 2. Cluster focus — hide cross-cluster edges
      if (s.clusterMode === 'focus' && s.focusedClusterId) {
        const cluster = s.clusters.get(s.focusedClusterId)
        if (cluster && (!cluster.nodeIds.has(source) || !cluster.nodeIds.has(target))) {
          return { ...data, hidden: true }
        }
      }

      // 3. Path highlight — edges between consecutive path nodes
      if (s.pathNodeIds.size > 0) {
        if (s.pathNodeIds.has(source) && s.pathNodeIds.has(target)) {
          return {
            ...data,
            color: PATH_HIGHLIGHT_COLOR,
            size: baseWidth * EDGE_WIDTH.pathHighlight,
            hidden: false,
          }
        }
        return {
          ...data,
          color: dimColor(baseColor, EDGE_WIDTH.highlightNeither, s.graphTheme),
          size: baseWidth * EDGE_WIDTH.highlightNeither,
          hidden: false,
        }
      }

      // 4. Highlight / blast radius
      if (s.highlightedNodeIds || s.blastRadiusNodeIds) {
        const combined = new Set<string>()
        if (s.highlightedNodeIds) {
          for (const id of s.highlightedNodeIds) combined.add(id)
        }
        if (s.blastRadiusNodeIds) {
          for (const id of s.blastRadiusNodeIds) combined.add(id)
        }

        const srcIn = combined.has(source)
        const tgtIn = combined.has(target)

        if (srcIn && tgtIn) {
          return {
            ...data,
            color: brightenColor(baseColor, 1.5),
            size: baseWidth * EDGE_WIDTH.highlightBoth,
            hidden: false,
          }
        }
        if (srcIn || tgtIn) {
          return {
            ...data,
            color: dimColor('#06b6d4', 0.5, s.graphTheme),
            size: baseWidth * EDGE_WIDTH.highlightOne,
            hidden: false,
          }
        }
        return {
          ...data,
          color: dimColor(baseColor, EDGE_WIDTH.highlightNeither, s.graphTheme),
          size: baseWidth * EDGE_WIDTH.highlightNeither,
          hidden: false,
        }
      }

      // 5. Selection
      if (s.selectedNode) {
        const selId = s.selectedNode.nodeId
        if (source === selId || target === selId) {
          return {
            ...data,
            color: brightenColor(baseColor, 1.5),
            size: baseWidth * EDGE_WIDTH.selectionConnected,
            hidden: false,
          }
        }
        return {
          ...data,
          color: dimColor(baseColor, EDGE_WIDTH.selectionDisconnected, s.graphTheme),
          size: baseWidth * EDGE_WIDTH.selectionDisconnected,
          hidden: false,
        }
      }

      // Default
      return { ...data, color: baseColor, size: baseWidth, hidden: false }
    },
    [],
  )

  // -------------------------------------------------------------------------
  // Animation loop — runs while animatedNodes is non-empty
  // -------------------------------------------------------------------------
  useEffect(() => {
    const sigma = sigmaRef.current
    if (!sigma) return

    if (animatedNodes.size === 0) {
      // Stop loop
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current)
        animFrameRef.current = null
      }
      return
    }

    // Start loop if not already running
    if (animFrameRef.current !== null) return

    const tick = () => {
      const s = sigmaRef.current
      if (s) {
        s.refresh()
      }
      const current = useGraphStore.getState().animatedNodes
      if (current.size > 0) {
        animFrameRef.current = requestAnimationFrame(tick)
      } else {
        animFrameRef.current = null
      }
    }
    animFrameRef.current = requestAnimationFrame(tick)

    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current)
        animFrameRef.current = null
      }
    }
  }, [animatedNodes])

  // -------------------------------------------------------------------------
  // Sigma init + destroy
  // -------------------------------------------------------------------------
  useEffect(() => {
    const container = containerRef.current
    if (!container || !graph) return

    // Tear down previous instance
    if (fa2Ref.current) {
      try { fa2Ref.current.kill() } catch { /* already killed */ }
      fa2Ref.current = null
    }
    if (fa2TimerRef.current) {
      clearTimeout(fa2TimerRef.current)
      fa2TimerRef.current = null
    }
    if (sigmaRef.current) {
      try { sigmaRef.current.kill() } catch { /* already killed */ }
      sigmaRef.current = null
    }

    // Seed random positions if no cached ones
    if (!hasCachedPositions(graph)) {
      seedRandomPositions(graph)
    }

    // Create Sigma instance
    const theme = getGraphTheme(graphTheme)
    let sigma: Sigma
    try {
      sigma = new Sigma(graph, container, {
        defaultNodeType: 'circle',
        defaultEdgeType: 'curve',
        nodeProgramClasses: {
          circle: NodeCircleProgram,
        },
        edgeProgramClasses: {
          curve: EdgeCurveProgram,
        },
        nodeReducer,
        edgeReducer,
        renderLabels: true,
        labelColor: { color: theme.labelColor },
        labelSize: 12,
        labelFont: 'Inter, system-ui, sans-serif',
        defaultNodeColor: theme.nodeColor,
        defaultEdgeColor: theme.edgeColor,
        minCameraRatio: CAMERA.minRatio,
        maxCameraRatio: CAMERA.maxRatio,
        zIndex: true,
        allowInvalidContainer: true,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to initialize graph renderer'
      setGraphError(message)
      return
    }

    sigmaRef.current = sigma

    // --- Events ---
    sigma.on('clickNode', ({ node }) => {
      const g = useGraphStore.getState().graph
      if (!g) return
      try {
        const attrs = g.getNodeAttributes(node)
        setSelectedNode({
          nodeId: node,
          entityType: (attrs.entity_type as 'collection' | 'request' | 'model') ?? 'request',
          entityId: (attrs.entity_id as string) ?? node,
        })
        pushSelection(node)
      } catch {
        // node not found
      }
    })

    sigma.on('clickStage', () => {
      setSelectedNode(null)
    })

    sigma.on('enterNode', ({ node }) => {
      setHoveredNodeId(node)
    })

    sigma.on('leaveNode', () => {
      setHoveredNodeId(null)
    })

    // --- ForceAtlas2 Layout ---
    setComputing(true)

    const fa2Settings = inferSettings(graph)
    const supervisor = new FA2LayoutSupervisor(graph, {
      settings: {
        ...fa2Settings,
        scalingRatio: (fa2Settings.scalingRatio ?? 1) * FA2_SCALING_MULTIPLIER,
        gravity: (fa2Settings.gravity ?? 1) * FA2_GRAVITY_MULTIPLIER,
      },
    })

    fa2Ref.current = supervisor
    supervisor.start()

    // Stop FA2 after timeout, run post-layout steps
    fa2TimerRef.current = setTimeout(() => {
      try {
        supervisor.stop()
      } catch {
        // supervisor may already be killed
      }

      // Run noverlap to remove node overlap
      try {
        noverlap.assign(graph, {
          maxIterations: NOVERLAP_MAX_ITERATIONS,
          settings: { margin: NOVERLAP_MARGIN },
        })
      } catch {
        // non-critical
      }

      // Spread clusters AFTER layout
      const currentClusters = useGraphStore.getState().clusters
      if (currentClusters.size > 0) {
        const updated = spreadClusters(graph, currentClusters)
        setClusters(updated)
      }

      // Save positions to SQLite
      if (projectId) {
        const positions = extractPositionsForSave(graph)
        invoke('save_graph_positions', { positions }).catch(() => {
          // Position save is non-critical
        })
      }

      setComputing(false)
      sigma.refresh()
    }, FA2_TIMEOUT_MS)

    // --- Cleanup ---
    return () => {
      // Kill FA2 first to stop writes to graph
      if (fa2TimerRef.current) {
        clearTimeout(fa2TimerRef.current)
        fa2TimerRef.current = null
      }
      if (fa2Ref.current) {
        try { fa2Ref.current.kill() } catch { /* already killed */ }
        fa2Ref.current = null
      }

      // Cancel animation frame
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current)
        animFrameRef.current = null
      }

      // Kill Sigma
      if (sigmaRef.current) {
        try { sigmaRef.current.kill() } catch { /* already killed */ }
        sigmaRef.current = null
      }
    }
  }, [graph, containerRef, graphTheme, nodeReducer, edgeReducer, projectId, setGraphError, setComputing, setSelectedNode, pushSelection, setHoveredNodeId, setClusters])

  // -------------------------------------------------------------------------
  // Refresh Sigma when visual state changes (triggers reducers)
  // -------------------------------------------------------------------------
  useEffect(() => {
    const sigma = sigmaRef.current
    if (sigma) {
      sigma.refresh()
    }
  }, [
    selectedNode,
    hoveredNodeId,
    filters,
    visibleNodeIds,
    visibleEdgeTypes,
    pathNodeIds,
    highlightedNodeIds,
    blastRadiusNodeIds,
    clusterMode,
    clusters,
    focusedClusterId,
    communities,
  ])

  // -------------------------------------------------------------------------
  // Update Sigma settings when theme changes
  // -------------------------------------------------------------------------
  useEffect(() => {
    const sigma = sigmaRef.current
    if (!sigma) return

    const theme = getGraphTheme(graphTheme)
    sigma.setSetting('labelColor', { color: theme.labelColor })
    sigma.setSetting('defaultNodeColor', theme.nodeColor)
    sigma.setSetting('defaultEdgeColor', theme.edgeColor)
  }, [graphTheme])

  // -------------------------------------------------------------------------
  // Camera controls
  // -------------------------------------------------------------------------
  const zoomIn = useCallback(() => {
    const sigma = sigmaRef.current
    if (!sigma) return
    const camera = sigma.getCamera()
    camera.animatedZoom({ duration: CAMERA.zoomDuration })
  }, [])

  const zoomOut = useCallback(() => {
    const sigma = sigmaRef.current
    if (!sigma) return
    const camera = sigma.getCamera()
    camera.animatedUnzoom({ duration: CAMERA.zoomDuration })
  }, [])

  const resetView = useCallback(() => {
    const sigma = sigmaRef.current
    if (!sigma) return
    const camera = sigma.getCamera()
    camera.animatedReset({ duration: CAMERA.resetDuration })
  }, [])

  const focusNode = useCallback((nodeId: string) => {
    const sigma = sigmaRef.current
    const g = useGraphStore.getState().graph
    if (!sigma || !g) return

    try {
      const attrs = g.getNodeAttributes(nodeId)
      const x = attrs.x as number | undefined
      const y = attrs.y as number | undefined
      if (x === undefined || y === undefined) return

      const camera = sigma.getCamera()
      camera.animate(
        { x, y, ratio: CAMERA.focusRatio },
        { duration: CAMERA.focusDuration },
      )
    } catch {
      // node not found
    }
  }, [])

  const focusCluster = useCallback((clusterId: string) => {
    const sigma = sigmaRef.current
    const g = useGraphStore.getState().graph
    const cls = useGraphStore.getState().clusters
    if (!sigma || !g) return

    const cluster = cls.get(clusterId)
    if (!cluster) return

    const camera = sigma.getCamera()
    camera.animate(
      { x: cluster.centroid.x, y: cluster.centroid.y, ratio: CAMERA.focusRatio * 2 },
      { duration: CAMERA.focusDuration },
    )
  }, [])

  const restartLayout = useCallback(() => {
    const sigma = sigmaRef.current
    const g = useGraphStore.getState().graph
    if (!sigma || !g) return

    // Kill existing supervisor
    if (fa2Ref.current) {
      try { fa2Ref.current.kill() } catch { /* already killed */ }
      fa2Ref.current = null
    }
    if (fa2TimerRef.current) {
      clearTimeout(fa2TimerRef.current)
      fa2TimerRef.current = null
    }

    setComputing(true)

    const fa2Settings = inferSettings(g)
    const supervisor = new FA2LayoutSupervisor(g, {
      settings: {
        ...fa2Settings,
        scalingRatio: (fa2Settings.scalingRatio ?? 1) * FA2_SCALING_MULTIPLIER,
        gravity: (fa2Settings.gravity ?? 1) * FA2_GRAVITY_MULTIPLIER,
      },
    })

    fa2Ref.current = supervisor
    supervisor.start()

    fa2TimerRef.current = setTimeout(() => {
      try {
        supervisor.stop()
      } catch {
        // supervisor may already be killed
      }

      try {
        noverlap.assign(g, {
          maxIterations: NOVERLAP_MAX_ITERATIONS,
          settings: { margin: NOVERLAP_MARGIN },
        })
      } catch {
        // non-critical
      }

      const currentClusters = useGraphStore.getState().clusters
      if (currentClusters.size > 0) {
        const updated = spreadClusters(g, currentClusters)
        setClusters(updated)
      }

      if (projectId) {
        const positions = extractPositionsForSave(g)
        invoke('save_graph_positions', { positions }).catch(() => {
          // non-critical
        })
      }

      setComputing(false)
      sigma.refresh()
    }, FA2_TIMEOUT_MS)
  }, [projectId, setComputing, setClusters])

  // -------------------------------------------------------------------------
  // Return controls
  // -------------------------------------------------------------------------
  return {
    zoomIn,
    zoomOut,
    resetView,
    focusNode,
    focusCluster,
    restartLayout,
    sigmaRef,
  }
}
