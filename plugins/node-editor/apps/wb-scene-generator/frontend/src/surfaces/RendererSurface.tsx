import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { HttpApiClient } from '../api/HttpApiClient.js'
import { RenderCanvas, type PaintTargetRequest } from '../renderer/host/RenderCanvas.js'
import { useRenderStore } from '../renderer/store.js'
import {
  useBakedLayer, useBakedLayerKeys, useVoxelLayer, useVoxelLayerKeys, useGridLayerKeys,
} from '../renderer/framework/useLayer.js'
import { useNodePreviews, projectLiveOutputs } from '../renderer/bridge/useNodePreviews.js'
import { useAliasMetas } from '../renderer/bridge/useAliasMetas.js'
import { useScreenshotCapture } from '../renderer/bridge/useScreenshotCapture.js'
import { useRendererCommands } from '../renderer/bridge/useRendererCommands.js'
import { useBakedLayers, refreshBakedLayers } from '../renderer/bridge/useBakedLayers.js'
import { bakedApi } from '../renderer/bridge/bakedApi.js'
import { sceneExportApi, type SceneExportCookResult } from '../renderer/bridge/sceneExportApi.js'
import { defaultPaintTargetName } from '../renderer/framework/paintTarget.js'
import { buildPathTree, pathParent, type PathTreeNode } from '../renderer/framework/pathTree.js'
import type { PluginHandle } from '../renderer/framework/plugin.js'
import type { ViewMode, DrawMode } from '../renderer/types.js'
import { useWorkbenchChild } from '../workbench/useWorkbenchChild.js'
import { writeSelectedLayers } from './library/selectedLayerBus.js'
import { bakedLayerToSnapshot, outputLayerToSnapshot } from './library/layerSnapshots.js'
import { reconcilePanelSelection } from './library/selectionReconcile.js'
import {
  writeEditMode,
  writePreviewEditContext,
  readShowGrid,
  subscribeShowGrid,
  readBrushMode,
  subscribeBrushMode,
  readEditTool,
  subscribeEditTool,
  readEditZ,
  subscribeEditZ,
} from './library/editToolbarBus.js'
import { libraryApi } from './library/libraryApi.js'
import {
  Box, Camera, ChevronDown, ChevronRight, Eye, EyeOff, Home, Layers, Maximize2, Minimize2, Pencil, Plus, Trash,
} from './icons.js'
import './RendererSurface.css'

const VIEW_MODES: ViewMode[] = ['top', 'topBillboard', 'iso', 'free3d']
const DRAW_MODES: DrawMode[] = ['wire', 'color', 'asset']
const VIEW_LABELS: Record<ViewMode, string> = {
  top: 'Top',
  topBillboard: 'Billboard',
  iso: 'Iso',
  free3d: 'Free 3D',
}
const DRAW_LABELS: Record<DrawMode, string> = {
  wire: 'Wire',
  color: 'Color',
  asset: 'Asset',
}

type SceneExportState =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'success'; result: SceneExportCookResult }
  | { status: 'error'; message: string }

// Screenshot result presented in a popover for manual copy. The sandboxed studio
// iframe blocks both the image-blob clipboard write AND the `<a download>` click,
// so we surface the rendered frame as a copyable PNG data URL (base64) plus an
// inline thumbnail the user can right-click → Copy/Save (a browser-native action
// the permissions policy can't gate) — same fallback the FRAME PNG export uses.
type ScreenshotState =
  | { status: 'idle' }
  | { status: 'success'; dataUrl: string; width: number; height: number }
  | { status: 'error'; message: string }

// Golden-angle hue spread per layer value — identical to the legacy
// LayersSidePanel swatch coloring, so layers keep stable, distinct colors.
const HUE_GOLDEN_ANGLE = 137.508
function valueHue(value: number): number {
  return (value * HUE_GOLDEN_ANGLE) % 360
}

// Faithful renderer pane. Toolbar order mirrors the legacy Preview chrome:
//   Preview title · view-mode dropdown · Wire/Color/Asset segment · status pill
//   … (spacer) … screenshot · layers-panel toggle · reset-view · fullscreen.
// Zoom is handled by canvas wheel-zoom (centered on cursor); the old gear
// dropdown that wrapped zoom + reset was removed in favor of a direct button.
// The Layers side panel lists ONLY scene_output voxel layers (matching legacy
// LayersSidePanel); grid previews still render live on the canvas but are NOT
// listed here. Scene layers flow in from completed executions via WS.
export function RendererSurface({ client }: { client: HttpApiClient }): JSX.Element {
  useNodePreviews(client)
  useAliasMetas()
  useRendererCommands()
  useBakedLayers()
  const pluginRef = useRef<PluginHandle | null>(null)
  useScreenshotCapture(pluginRef)
  // Drain in-flight paint persists before a structural baked mutation (see
  // structuralBakedRefresh). Published by RenderCanvas via paintPersistsRef.
  const paintPersistsRef = useRef<(() => Promise<void>) | null>(null)

  const { viewMode, drawMode, setViewMode, setDrawMode, resetViewport2d } = useRenderStore()
  const setSelectedEditorNodeIds = useRenderStore((s) => s.setSelectedEditorNodeIds)
  // Voxel (scene_output) layers — the read-only "Output" section of the panel.
  const layerKeys = useVoxelLayerKeys()
  const layers = useRenderStore((s) => s.layers)
  const aliasMetas = useRenderStore((s) => s.aliasMetas)
  const layerTree = useMemo(() => buildPathTree(layerKeys, (key) => layers[key]), [layerKeys, layers])
  // Baked (graph-independent, editable) layers — the "Editable" section.
  const bakedKeys = useBakedLayerKeys()
  const bakedLayersMap = useRenderStore((s) => s.bakedLayers)
  const bakedTree = useMemo(() => buildPathTree(bakedKeys, (key) => bakedLayersMap[key]), [bakedKeys, bakedLayersMap])
  const editMode = useRenderStore((s) => s.editMode)
  const setEditMode = useRenderStore((s) => s.setEditMode)
  const setShowGrid = useRenderStore((s) => s.setShowGrid)
  const setBrushMode = useRenderStore((s) => s.setBrushMode)
  const setEditTool = useRenderStore((s) => s.setEditTool)
  const setEditZ = useRenderStore((s) => s.setEditZ)
  const activeBakedLayerKey = useRenderStore((s) => s.activeBakedLayerKey)
  const setActiveBakedLayer = useRenderStore((s) => s.setActiveBakedLayer)
  // Multi-selection of baked layers for batch ops (delete / drag). The store's
  // `activeBakedLayerKey` is the primary (= paint target), kept = last-clicked.
  const [selectedBakedKeys, setSelectedBakedKeys] = useState<ReadonlySet<string>>(() => new Set())
  const bakedAnchorRef = useRef<string | null>(null)
  const dragKeysRef = useRef<string[]>([])
  const [dropHover, setDropHover] = useState<{ key: string; zone: 'before' | 'after' | 'inside' } | null>(null)
  const [renamingBakedKey, setRenamingBakedKey] = useState<string | null>(null)
  // Edit mode only makes sense in billboard + asset (single-plane z=0 painting).
  const editAvailable = viewMode === 'topBillboard' && drawMode === 'asset'
  // Grid previews still render on the canvas; counted only for the canvas/global
  // empty-state + status (legacy counts both buckets), never listed in the panel.
  const gridKeys = useGridLayerKeys()
  const totalLayers = layerKeys.length + gridKeys.length
  const { isFocused, requestFocus, reportStatus } = useWorkbenchChild('renderer')

  // Pure VIEW state (no graph/runtime mutation) — kept local to the renderer.
  const [showViewMenu, setShowViewMenu] = useState(false)
  const [layersPanelOpen, setLayersPanelOpen] = useState(true)
  const [editablePanelHeight, setEditablePanelHeight] = useState(180)
  const [sceneExport, setSceneExport] = useState<SceneExportState>({ status: 'idle' })
  const [screenshot, setScreenshot] = useState<ScreenshotState>({ status: 'idle' })
  // Selected Layers-panel row lives in the store so the AI/Agent `select-layer`
  // control command (useRendererCommands) drives the same highlight a user click
  // does. Toggle off on re-click of the already-selected row.
  const selectedKey = useRenderStore((s) => s.selectedLayerKey)
  const setSelectedLayer = useRenderStore((s) => s.setSelectedLayer)
  // Multi-selection of OUTPUT layers (for batch "Bake selected"). ctrl/⌘ toggles,
  // shift selects a range from the anchor, plain click selects just one. The
  // store's single `selectedLayerKey` still drives the left-pane detail + the
  // AI select-layer command — kept in sync with the last-clicked row.
  const [selectedOutputKeys, setSelectedOutputKeys] = useState<ReadonlySet<string>>(() => new Set())
  const selectAnchorRef = useRef<string | null>(null)
  // The last selectedLayerKey the PANEL itself wrote (via a row click). Used to
  // distinguish panel-originated store writes from EXTERNAL ones (SELECT-mode
  // scene clicks, AI select-layer). Only external changes reconcile the local
  // selection sets below — panel writes already set the sets, and reconciling
  // them would clobber legitimate multi-selection.
  const panelSelectionEchoRef = useRef<string | null>(null)
  // DFS leaf order of the output tree — the index space shift-range select uses.
  const orderedOutputKeys = useMemo(() => flattenLayerKeys(layerTree), [layerTree])
  const onSelectLayer = (key: string, e?: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => {
    const range = !!e?.shiftKey && selectAnchorRef.current !== null
    const additive = !!(e?.ctrlKey || e?.metaKey)
    setSelectedOutputKeys((prev) => {
      if (range) {
        const a = orderedOutputKeys.indexOf(selectAnchorRef.current!)
        const b = orderedOutputKeys.indexOf(key)
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a]
          return new Set(orderedOutputKeys.slice(lo, hi + 1))
        }
        return new Set([key])
      }
      if (additive) {
        const next = new Set(prev)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      }
      return new Set([key])
    })
    if (!range) selectAnchorRef.current = key
    panelSelectionEchoRef.current = key
    setSelectedLayer(key)
  }
  // Collapsed sink/path container rows (collapsible tree). Keyed by pathKey;
  // default expanded.
  const [collapsedOutput, setCollapsedOutput] = useState<ReadonlySet<string>>(() => new Set())
  const [collapsedBaked, setCollapsedBaked] = useState<ReadonlySet<string>>(() => new Set())
  const toggleCollapsedOutput = (pathKey: string) =>
    setCollapsedOutput((prev) => {
      const next = new Set(prev)
      if (next.has(pathKey)) next.delete(pathKey)
      else next.add(pathKey)
      return next
    })
  const toggleCollapsedBaked = (pathKey: string) =>
    setCollapsedBaked((prev) => {
      const next = new Set(prev)
      if (next.has(pathKey)) next.delete(pathKey)
      else next.add(pathKey)
      return next
    })

  const revealBakedLayerForRename = useCallback((path: string) => {
    const key = `baked:${path}`
    setLayersPanelOpen(true)
    setActiveBakedLayer(key)
    setSelectedBakedKeys(new Set([key]))
    bakedAnchorRef.current = key
    setCollapsedBaked((prev) => {
      const next = new Set(prev)
      let changed = false
      for (const ancestor of ancestorPathKeys(path)) {
        if (next.delete(ancestor)) changed = true
      }
      return changed ? next : prev
    })
    setRenamingBakedKey(key)
  }, [setActiveBakedLayer])

  const [pendingPaintTarget, setPendingPaintTarget] = useState<(PaintTargetRequest & { resolve: (key: string | null) => void }) | null>(null)
  const [paintTargetName, setPaintTargetName] = useState('')

  const requestPaintTarget = useCallback((request: PaintTargetRequest): Promise<string | null> => {
    return new Promise((resolve) => {
      setPendingPaintTarget((prev) => {
        prev?.resolve(null)
        return { ...request, resolve }
      })
      setPaintTargetName(defaultPaintTargetName(request.asset.name))
    })
  }, [])

  const handleBakedEditCommitted = useCallback(async () => {
    await refreshBakedLayers()
  }, [])

  useEffect(() => {
    reportStatus({ layers: totalLayers, viewMode })
  }, [totalLayers, viewMode, reportStatus])

  // Publish edit mode to the left pane so its (collapsed) edit toolbar expands
  // only while editing. We own the Pencil toggle, so this is the source of truth.
  useEffect(() => {
    writeEditMode(editMode)
  }, [editMode])

  useEffect(() => {
    writePreviewEditContext({ editMode, viewMode, drawMode, editAvailable })
  }, [editMode, viewMode, drawMode, editAvailable])

  // The grid toggle lives in the left pane's edit toolbar; mirror its published
  // state into the render store (initial read + live subscription) so compose
  // draws the grid. Cross-iframe, so this is the only path it arrives by.
  useEffect(() => {
    setShowGrid(readShowGrid())
    return subscribeShowGrid(setShowGrid)
  }, [setShowGrid])

  // Brush mode (Free/Box) also lives in the left pane's edit toolbar; mirror it
  // into the render store so the canvas interaction switches accordingly.
  useEffect(() => {
    setBrushMode(readBrushMode())
    return subscribeBrushMode(setBrushMode)
  }, [setBrushMode])

  // Edit tool (Paint/Eraser/Eyedropper) is orthogonal to Free/Box brush shape.
  useEffect(() => {
    setEditTool(readEditTool())
    return subscribeEditTool(setEditTool)
  }, [setEditTool])

  // Z layer lives in the left pane's edit toolbar; mirror it into the render
  // store so the active plugin can map mouse position to a voxel.
  useEffect(() => {
    setEditZ(readEditZ())
    return subscribeEditZ(setEditZ)
  }, [setEditZ])

  const beginLayerSectionResize = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    const startY = e.clientY
    const startHeight = editablePanelHeight
    const panel = e.currentTarget.parentElement
    const panelHeight = panel?.getBoundingClientRect().height ?? 0
    const onMove = (mv: MouseEvent): void => {
      const max = Math.max(90, panelHeight - 120)
      setEditablePanelHeight(Math.max(70, Math.min(max, startHeight + mv.clientY - startY)))
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [editablePanelHeight])

  // Editor-selection bridge: the workbench host forwards the kernel editor's
  // current node selection over `workbench:editor-selection`. We mirror it into
  // the render store so the canvas + Layers panel highlight the selected node's
  // layers/previews (view-only; no graph mutation). Replaces the legacy
  // `editor:selection` WS event, which this backend doesn't emit.
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; selectedNodeIds?: unknown; previewDisabledNodeIds?: unknown; outputs?: unknown } | null
      if (!data || typeof data.type !== 'string') return
      if (data.type === 'workbench:editor-selection') {
        setSelectedEditorNodeIds(Array.isArray(data.selectedNodeIds) ? (data.selectedNodeIds as string[]) : [])
      } else if (data.type === 'workbench:preview-change') {
        // Build the override map from the editor's preview-off set: every listed
        // node is forced preview-off; absent nodes fall back to the backend.
        const ids = Array.isArray(data.previewDisabledNodeIds) ? (data.previewDisabledNodeIds as string[]) : []
        const overrides: Record<string, boolean> = {}
        for (const id of ids) overrides[id] = false
        useRenderStore.getState().setPreviewOverrides(overrides)
      } else if (data.type === 'workbench:preview-data') {
        // Live direct-push from the editor: freshly executed outputs, painted into
        // the render store with zero network. This is the slider-drag fast path —
        // it bypasses the WS exec:completed → getNodeOutput re-pull so the preview
        // repaints in the same frame the execute response landed. The trailing WS
        // refresh still owns GC + the durable post-drag settle.
        if (data.outputs && typeof data.outputs === 'object') {
          projectLiveOutputs(data.outputs as Record<string, Record<string, unknown>>)
        }
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [setSelectedEditorNodeIds])

  const resetView = () => {
    pluginRef.current?.resetView?.()
    resetViewport2d()
  }

  const exportSceneZip = async () => {
    setSceneExport({ status: 'pending' })
    try {
      const result = await sceneExportApi.cook()
      setSceneExport({ status: 'success', result })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setSceneExport({ status: 'error', message })
    }
  }
  const dismissSceneExport = () => setSceneExport({ status: 'idle' })
  const selectExportUrl = (e: React.FocusEvent<HTMLInputElement> | React.MouseEvent<HTMLInputElement>) => {
    e.currentTarget.select()
  }

  // ── Baked layer ops (graph-independent service; never touches the node graph) ──
  //
  // STRUCTURAL mutations (add / sub / move / remove / bake / rename) change the
  // tree shape & sibling order, which only the backend authoritatively re-derives.
  // After such a mutation the frontend MUST pull the new structure back in.
  //
  // But the default refreshBakedLayers() defers while ANY local paint edit is
  // still dirty/persisting (paint-protection, so a refresh can't clobber an
  // in-flight stroke). A paint immediately preceding the structural op (e.g.
  // place object → auto-create sub-layer) leaves that dirty flag set, so the
  // structural refresh would be silently DEFERRED and the new layer / new order
  // would only show up after a manual reload — the reported "must refresh" /
  // "reorder didn't take" bugs.
  //
  // Fix: drain the in-flight paint persists FIRST (flush + await → dirty clears),
  // THEN force the refresh in. Structural ops thus never collide with paint
  // protection, and there's no second source of truth: the backend stays
  // authoritative and the panel reflects it synchronously.
  const structuralBakedRefresh = useCallback(async () => {
    await paintPersistsRef.current?.()
    await refreshBakedLayers({ deferIfLocalPending: false })
  }, [])
  const addBakedLayer = async () => {
    try {
      const path = await bakedApi.addLayer('Layer')
      await structuralBakedRefresh()
      revealBakedLayerForRename(path)
    } catch (e) { console.warn('[baked] add layer failed', e) }
  }
  const addBakedSubLayer = async (nodePath: string) => {
    try {
      const path = await bakedApi.addSubLayer(nodePath, 'Sub')
      await structuralBakedRefresh()
      revealBakedLayerForRename(path)
    } catch (e) { console.warn('[baked] action failed', e) }
  }
  const cancelPaintTarget = () => {
    pendingPaintTarget?.resolve(null)
    setPendingPaintTarget(null)
  }
  const confirmPaintTarget = async () => {
    if (!pendingPaintTarget) return
    try {
      const path = await bakedApi.addSubLayer(pendingPaintTarget.activeLayer.nodePath, paintTargetName.trim() || defaultPaintTargetName(pendingPaintTarget.asset.name))
      const key = `baked:${path}`
      await structuralBakedRefresh()
      setActiveBakedLayer(key)
      setSelectedBakedKeys(new Set([key]))
      pendingPaintTarget.resolve(key)
      setPendingPaintTarget(null)
    } catch (e) {
      console.warn('[baked] create paint target failed', e)
    }
  }
  const removeBakedLayer = async (nodePath: string) => {
    try {
      await bakedApi.remove(nodePath)
      if (activeBakedLayerKey === `baked:${nodePath}`) setActiveBakedLayer(null)
      await structuralBakedRefresh()
    } catch (e) { console.warn('[baked] action failed', e) }
  }
  // Snapshot the SELECTED transient output layers into new editable baked layers.
  // Sent in DFS order with their nodePath so the backend preserves the layers'
  // parent/child hierarchy + order (e.g. /House before /House/Roof).
  const bakeSelectedLayers = async () => {
    const all = useRenderStore.getState().layers
    const payload = orderedOutputKeys
      .filter((k) => selectedOutputKeys.has(k))
      .map((k) => all[k])
      .filter((l): l is NonNullable<typeof l> => !!l)
      .map((l) => ({
        nodePath: l.nodePath,
        nodeName: l.nodeName,
        cells: l.cells.map((c) => ({ x: c.x, y: c.y, z: c.z })),
        assetName: l.assetName,
        assetType: l.assetType,
        schema: l.schema,
      }))
    if (payload.length === 0) return
    try {
      await bakedApi.bake(payload)
      await structuralBakedRefresh()
      setSelectedOutputKeys(new Set())
    } catch (e) { console.warn('[baked] action failed', e) }
  }

  // Select a baked layer: plain = single, ⌘/ctrl = toggle, shift = range. The
  // last-clicked becomes the paint target (activeBakedLayerKey).
  const onSelectBaked = (key: string, e?: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => {
    const range = !!e?.shiftKey && bakedAnchorRef.current !== null
    const additive = !!(e?.ctrlKey || e?.metaKey)
    setSelectedBakedKeys((prev) => {
      if (range) {
        const a = bakedKeys.indexOf(bakedAnchorRef.current!)
        const b = bakedKeys.indexOf(key)
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a]
          return new Set(bakedKeys.slice(lo, hi + 1))
        }
        return new Set([key])
      }
      if (additive) {
        const next = new Set(prev)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      }
      return new Set([key])
    })
    if (!range) bakedAnchorRef.current = key
    setActiveBakedLayer(key)
    // Mirror the last-clicked baked row into the store's single selection so the
    // panel and SELECT-mode share one source of truth (bidirectional). Output
    // rows already do this via onSelectLayer; baked rows must too, otherwise a
    // baked panel-selection can't be overridden by a scene SELECT click.
    panelSelectionEchoRef.current = key
    setSelectedLayer(key)
  }

  const deleteSelectedBaked = async () => {
    const paths = [...selectedBakedKeys].map((k) => k.replace(/^baked:/, ''))
    if (paths.length === 0) return
    try {
      // Delete deepest-first so removing a parent doesn't invalidate a child path.
      for (const p of paths.sort((a, b) => b.length - a.length)) await bakedApi.remove(p)
      setSelectedBakedKeys(new Set())
      if (activeBakedLayerKey && paths.includes(activeBakedLayerKey.replace(/^baked:/, ''))) setActiveBakedLayer(null)
      await structuralBakedRefresh()
    } catch (e) { console.warn('[baked] action failed', e) }
  }

  // Drag-and-drop reorder/reparent. Dropping on a row's top/bottom edge reorders
  // (before/after that sibling); dropping on its middle reparents (becomes child).
  const onBakedDragStart = (key: string) => {
    dragKeysRef.current = selectedBakedKeys.has(key) && selectedBakedKeys.size > 1
      ? bakedKeys.filter((k) => selectedBakedKeys.has(k))
      : [key]
  }
  const onBakedDragOver = (key: string, zone: 'before' | 'after' | 'inside') => {
    setDropHover((prev) => (prev && prev.key === key && prev.zone === zone ? prev : { key, zone }))
  }
  const onBakedDrop = async (targetKey: string, zone: 'before' | 'after' | 'inside') => {
    setDropHover(null)
    const dragged = dragKeysRef.current
    dragKeysRef.current = []
    const target = bakedLayersMap[targetKey]
    if (!target || dragged.length === 0) return
    const pathOf = (k: string) => k.replace(/^baked:/, '')
    const targetPath = target.nodePath
    let destParent: string
    let beforeName: string | undefined
    if (zone === 'inside') {
      destParent = targetPath
      beforeName = undefined
    } else {
      destParent = pathParent(targetPath)
      const baseName = targetPath.split('/').filter(Boolean).pop()!
      if (zone === 'before') {
        beforeName = baseName
      } else {
        // after target → before the next sibling in the same parent (else append).
        const siblings = bakedKeys.map((k) => bakedLayersMap[k]).filter((l) => l && pathParent(l.nodePath) === destParent)
        const idx = siblings.findIndex((l) => l!.nodePath === targetPath)
        beforeName = idx >= 0 && idx + 1 < siblings.length ? siblings[idx + 1]!.nodePath.split('/').filter(Boolean).pop() : undefined
      }
    }
    try {
      for (const k of dragged) {
        if (k === targetKey) continue
        await bakedApi.move(pathOf(k), destParent, beforeName)
      }
      await structuralBakedRefresh()
    } catch (e) { console.warn('[baked] action failed', e) }
  }

  const renameBakedLayer = async (nodePath: string, name: string): Promise<void> => {
    try {
      const path = await bakedApi.rename(nodePath, name)
      const key = `baked:${path}`
      await structuralBakedRefresh()
      setActiveBakedLayer(key)
      setSelectedBakedKeys(new Set([key]))
      bakedAnchorRef.current = key
      setRenamingBakedKey(null)
    } catch (e) {
      console.warn('[baked] rename failed', e)
    }
  }

  // Store → panel reconcile: when `selectedLayerKey` changes from OUTSIDE the
  // panel (SELECT-mode scene click, AI select-layer command), collapse the local
  // selection sets to that single key so the panel row highlight follows and the
  // bus publish (below) reflects it — overriding any prior panel selection. This
  // is the other half of the bidirectional contract.
  //
  // Guards against loops/clobbering:
  // - Skips when the change was panel-originated (panelSelectionEchoRef matches),
  //   so multi-selection (Bake selected / batch baked ops) is preserved.
  // - Set updates early-return the SAME reference when already correct, so React
  //   bails and no extra render/publish fires (idempotent).
  useEffect(() => {
    if (panelSelectionEchoRef.current === selectedKey) return
    panelSelectionEchoRef.current = selectedKey
    if (selectedKey === null) {
      setSelectedOutputKeys((prev) => (prev.size === 0 ? prev : new Set()))
      setSelectedBakedKeys((prev) => (prev.size === 0 ? prev : new Set()))
      return
    }
    const { outputKey, bakedKey } = reconcilePanelSelection(selectedKey, { baked: bakedLayersMap, output: layers })
    if (bakedKey) {
      setSelectedBakedKeys((prev) => (prev.size === 1 && prev.has(bakedKey) ? prev : new Set([bakedKey])))
      setSelectedOutputKeys((prev) => (prev.size === 0 ? prev : new Set()))
      bakedAnchorRef.current = bakedKey
    } else if (outputKey) {
      setSelectedOutputKeys((prev) => (prev.size === 1 && prev.has(outputKey) ? prev : new Set([outputKey])))
      setSelectedBakedKeys((prev) => (prev.size === 0 ? prev : new Set()))
      selectAnchorRef.current = outputKey
    }
    // If the key matches neither bucket yet (layers still loading), leave the
    // sets alone; the publish effect's selectedKey fallback still emits it.
  }, [selectedKey, bakedLayersMap, layers])

  // Publish all selected baked + output layers to the left-pane inspector bus.
  useEffect(() => {
    const snapshots = []
    for (const key of selectedBakedKeys) {
      const l = bakedLayersMap[key]
      if (l) snapshots.push(bakedLayerToSnapshot(l, aliasMetas))
    }
    for (const key of selectedOutputKeys) {
      const l = layers[key]
      if (l) snapshots.push(outputLayerToSnapshot(l, aliasMetas))
    }
    if (snapshots.length === 0 && activeBakedLayerKey) {
      const l = bakedLayersMap[activeBakedLayerKey]
      if (l) snapshots.push(bakedLayerToSnapshot(l, aliasMetas))
    }
    if (snapshots.length === 0 && selectedKey) {
      const l = layers[selectedKey]
      if (l) snapshots.push(outputLayerToSnapshot(l, aliasMetas))
      // SELECT tool can resolve to a baked layer that isn't in selectedBakedKeys
      // (it writes the store's selectedLayerKey directly); publish it too so the
      // left-pane inspector reflects the picked baked layer with no panel edits.
      else {
        const bl = bakedLayersMap[selectedKey]
        if (bl) snapshots.push(bakedLayerToSnapshot(bl, aliasMetas))
      }
    }
    writeSelectedLayers(snapshots.length > 0 ? {
      layers: snapshots,
      editContext: { editMode, viewMode, drawMode, editAvailable },
    } : null)
  }, [
    selectedBakedKeys,
    selectedOutputKeys,
    activeBakedLayerKey,
    selectedKey,
    bakedLayersMap,
    layers,
    aliasMetas,
    editMode,
    viewMode,
    drawMode,
    editAvailable,
  ])

  const captureScreenshot = () => {
    const handle = pluginRef.current
    // Reuse the existing low-level render API (the plugin's §7.3 screenshot
    // protocol): force one synchronous compose, then read the live frame canvas.
    // This is the SAME render path the headless `useScreenshotCapture` WS loop
    // uses — we do not re-implement rendering.
    handle?.renderFrame?.()
    const canvas = handle?.getFrameCanvas?.()
    if (!canvas) {
      setScreenshot({ status: 'error', message: 'No rendered frame to capture yet — switch to a populated view and try again.' })
      return
    }
    try {
      // Present the frame as a copyable PNG data URL. The studio embeds this
      // plugin in a sandboxed cross-origin iframe whose permissions policy
      // blocks BOTH the image-blob clipboard write and the `<a download>` click
      // (the previous implementation), so neither surfaces anything usable.
      // A base64 data URL is plain text the user can select + copy, and renders
      // as a right-click-able thumbnail — no clipboard / download dependency.
      const dataUrl = canvas.toDataURL('image/png')
      setScreenshot({ status: 'success', dataUrl, width: canvas.width, height: canvas.height })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setScreenshot({ status: 'error', message })
    }
  }
  const dismissScreenshot = () => setScreenshot({ status: 'idle' })
  const selectAllText = (e: React.FocusEvent<HTMLTextAreaElement> | React.MouseEvent<HTMLTextAreaElement>) => {
    e.currentTarget.select()
  }

  return (
    <div className="renderer-surface">
      <div className="renderer-toolbar">
        <span className="renderer-toolbar__title">Preview</span>
        <div className="renderer-mode-container">
          <button
            type="button"
            className={`renderer-mode-trigger${showViewMenu ? ' is-open' : ''}`}
            onClick={() => setShowViewMenu((v) => !v)}
            aria-haspopup="listbox"
            aria-expanded={showViewMenu}
          >
            <span className="renderer-mode-trigger__label">{VIEW_LABELS[viewMode]}</span>
            <ChevronDown size={14} className="renderer-mode-trigger__chevron" />
          </button>
          {showViewMenu && (
            <div className="renderer-mode-dropdown" role="listbox">
              <div className="renderer-mode-header">View</div>
              {VIEW_MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="option"
                  aria-selected={viewMode === m}
                  className={`renderer-mode-item${viewMode === m ? ' is-active' : ''}`}
                  onClick={() => {
                    setViewMode(m)
                    setShowViewMenu(false)
                  }}
                >
                  {VIEW_LABELS[m]}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="renderer-draw-segment" role="tablist" aria-label="Draw mode">
          {DRAW_MODES.map((d) => (
            <button
              key={d}
              type="button"
              role="tab"
              className={`renderer-draw-item${drawMode === d ? ' is-active' : ''}`}
              aria-selected={drawMode === d}
              onClick={() => setDrawMode(d)}
            >
              {DRAW_LABELS[d]}
            </button>
          ))}
        </div>
        <span className="renderer-status-pill" title="Renderer ready">
          Ready
        </span>
        <div className="renderer-export-container">
          <button
            type="button"
            className="renderer-export-btn"
            aria-label="Export scene.zip"
            title="Cook current baked scene and export scene.zip"
            disabled={sceneExport.status === 'pending'}
            onClick={() => void exportSceneZip()}
          >
            {sceneExport.status === 'pending' ? 'Exporting...' : 'Export scene.zip'}
          </button>
          {sceneExport.status === 'success' && (
            <div className="renderer-export-popover" role="status" aria-live="polite">
              <button
                type="button"
                className="renderer-export-popover__close"
                aria-label="Close scene export result"
                onClick={dismissSceneExport}
              >
                X
              </button>
              <div className="renderer-export-popover__title">Scene export ready</div>
              <label className="renderer-export-popover__field">
                <span>Select and copy this full URL to download scene.zip:</span>
                <input
                  aria-label="Scene zip download URL"
                  readOnly
                  value={sceneExport.result.downloadUrl}
                  onFocus={selectExportUrl}
                  onClick={selectExportUrl}
                />
              </label>
            </div>
          )}
          {sceneExport.status === 'error' && (
            <div
              className="renderer-export-popover renderer-export-popover--error"
              role="status"
              aria-live="polite"
            >
              <button
                type="button"
                className="renderer-export-popover__close"
                aria-label="Close scene export result"
                onClick={dismissSceneExport}
              >
                X
              </button>
              <div className="renderer-export-popover__title">Export failed</div>
              <div className="renderer-export-popover__message" title={sceneExport.message}>
                {sceneExport.message}
              </div>
            </div>
          )}
        </div>
        <div className="renderer-toolbar__spacer" />
        <button
          type="button"
          className={`renderer-icon-btn${editMode && editAvailable ? ' is-active' : ''}`}
          title={editAvailable ? (editMode ? 'Exit edit mode' : 'Edit mode — paint tiles into a baked layer') : 'Edit mode requires Billboard view + Asset draw mode'}
          aria-pressed={editMode && editAvailable}
          disabled={!editAvailable}
          onClick={() => setEditMode(!editMode)}
        >
          <Pencil size={18} />
        </button>
        <div className="renderer-shot-container">
          <button
            type="button"
            className="renderer-icon-btn"
            title="Save screenshot"
            onClick={captureScreenshot}
          >
            <Camera size={18} />
          </button>
          {screenshot.status === 'success' && (
            <div className="renderer-export-popover renderer-shot-popover" role="status" aria-live="polite">
              <button
                type="button"
                className="renderer-export-popover__close"
                aria-label="Close screenshot result"
                onClick={dismissScreenshot}
              >
                X
              </button>
              <div className="renderer-export-popover__title">Screenshot ready</div>
              <img
                className="renderer-shot-popover__preview"
                src={screenshot.dataUrl}
                alt={`Preview screenshot ${screenshot.width}×${screenshot.height}`}
              />
              <label className="renderer-export-popover__field">
                <span>Select and copy this PNG data URL (or right-click the image → Copy/Save):</span>
                <textarea
                  className="renderer-shot-popover__data"
                  aria-label="Screenshot PNG data URL"
                  readOnly
                  rows={3}
                  value={screenshot.dataUrl}
                  onFocus={selectAllText}
                  onClick={selectAllText}
                />
              </label>
            </div>
          )}
          {screenshot.status === 'error' && (
            <div
              className="renderer-export-popover renderer-export-popover--error renderer-shot-popover"
              role="status"
              aria-live="polite"
            >
              <button
                type="button"
                className="renderer-export-popover__close"
                aria-label="Close screenshot result"
                onClick={dismissScreenshot}
              >
                X
              </button>
              <div className="renderer-export-popover__title">Screenshot failed</div>
              <div className="renderer-export-popover__message" title={screenshot.message}>
                {screenshot.message}
              </div>
            </div>
          )}
        </div>
        <button
          type="button"
          className={`renderer-icon-btn${layersPanelOpen ? ' is-active' : ''}`}
          title={layersPanelOpen ? 'Hide scene layers panel' : 'Show scene layers panel'}
          aria-pressed={layersPanelOpen}
          onClick={() => setLayersPanelOpen((v) => !v)}
        >
          <Layers size={18} />
        </button>
        <button
          type="button"
          className="renderer-icon-btn"
          title="Reset view"
          onClick={resetView}
        >
          <Home size={18} />
        </button>
        <button
          type="button"
          className={`renderer-icon-btn${isFocused ? ' is-active' : ''}`}
          title={isFocused ? 'Exit fullscreen' : 'Fullscreen'}
          onClick={requestFocus}
        >
          {isFocused ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
        </button>
      </div>

      <div className="renderer-body">
        <div className="renderer-canvas-wrap">
          <RenderCanvas
            handleRef={pluginRef}
            onPaintTargetMismatch={requestPaintTarget}
            onBakedEditCommitted={handleBakedEditCommitted}
            paintPersistsRef={paintPersistsRef}
          />
        </div>
        {layersPanelOpen && (
          <aside className="renderer-layers" aria-label="Scene layers">
            {/* Editable (baked) layers — hand-edited, persisted outside the graph. */}
            <div className="renderer-layers__section renderer-layers__section--editable" style={{ flexBasis: editablePanelHeight }}>
              <div className="renderer-layers__section-head">
                <span>Editable</span>
                <span className="renderer-layers__head-actions">
                  {selectedBakedKeys.size > 0 && (
                    <button type="button" className="renderer-layers__add" title="Delete the selected editable layers" onClick={deleteSelectedBaked}>
                      Delete ({selectedBakedKeys.size})
                    </button>
                  )}
                  <button type="button" className="renderer-layers__add" title="Add editable layer" onClick={addBakedLayer}>
                    <Plus size={12} /> Layer
                  </button>
                </span>
              </div>
              {bakedKeys.length === 0 ? (
                <div className="renderer-layers__hint">No editable layers. Add one, or Bake an output layer below.</div>
              ) : (
                <ul
                  className="renderer-layers__list"
                  role="listbox"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => { dragKeysRef.current = []; setDropHover(null) }}
                >
                  {bakedTree.map((node) => (
                    <BakedLayerTreeRows
                      key={node.pathKey}
                      node={node}
                      depth={0}
                      selectedKeys={selectedBakedKeys}
                      activeKey={activeBakedLayerKey}
                      dropHover={dropHover}
                      collapsed={collapsedBaked}
                      onToggleCollapsed={toggleCollapsedBaked}
                      onSelect={onSelectBaked}
                      onAddSub={addBakedSubLayer}
                      onRemove={removeBakedLayer}
                      renamingKey={renamingBakedKey}
                      onStartRename={setRenamingBakedKey}
                      onCancelRename={() => setRenamingBakedKey(null)}
                      onRename={renameBakedLayer}
                      onDragStartKey={onBakedDragStart}
                      onDragOverKey={onBakedDragOver}
                      onDropKey={onBakedDrop}
                    />
                  ))}
                </ul>
              )}
            </div>

            <div
              className="renderer-layers__splitter"
              role="separator"
              aria-label="Resize editable and output layers"
              aria-orientation="horizontal"
              onMouseDown={beginLayerSectionResize}
            />

            {/* Output layers — transient scene_output projection (read-only).
                Select (click / ⌘/ctrl-click / shift-range) then Bake selected. */}
            <div className="renderer-layers__section renderer-layers__section--output">
              <div className="renderer-layers__section-head">
                <span>Output</span>
                <button
                  type="button"
                  className="renderer-layers__add"
                  title="Bake the selected output layers into editable copies"
                  disabled={selectedOutputKeys.size === 0}
                  onClick={bakeSelectedLayers}
                >
                  Bake selected{selectedOutputKeys.size > 0 ? ` (${selectedOutputKeys.size})` : ''}
                </button>
              </div>
              {layerKeys.length === 0 ? (
                <div className="renderer-layers__empty">
                  <Box size={20} />
                  <span>No scene output layers</span>
                  <small>Connect a Scene Output battery to see its layers here.</small>
                </div>
              ) : (
                <ul className="renderer-layers__list" role="listbox">
                  {layerTree.map((node) => (
                    <LayerTreeRows
                      key={node.pathKey}
                      node={node}
                      depth={0}
                      selectedKeys={selectedOutputKeys}
                      onSelectLayer={onSelectLayer}
                      collapsed={collapsedOutput}
                      onToggleCollapsed={toggleCollapsedOutput}
                    />
                  ))}
                </ul>
              )}
            </div>
          </aside>
        )}
      </div>
      {pendingPaintTarget && (
        <div className="renderer-modal-backdrop" role="presentation">
          <div className="renderer-modal" role="dialog" aria-modal="true" aria-label="Create layer for asset">
            <div className="renderer-modal__title">Create a layer for this asset?</div>
            <p className="renderer-modal__copy">
              Current layer <strong>{pendingPaintTarget.activeLayer.nodeName}</strong> is bound to{' '}
              <strong>{pendingPaintTarget.activeLayer.assetName || 'no asset'}</strong>. You are painting{' '}
              <strong>{pendingPaintTarget.asset.name}</strong>, so this stroke needs a new editable child layer.
            </p>
            {pendingPaintTarget.asset.alias && (
              <div className="renderer-modal__asset">
                <img src={libraryApi.serveUrl(pendingPaintTarget.asset.alias)} alt={pendingPaintTarget.asset.alias} />
                <span>{pendingPaintTarget.asset.alias}</span>
              </div>
            )}
            <label className="renderer-modal__field">
              New layer name
              <input
                value={paintTargetName}
                onChange={(e) => setPaintTargetName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') cancelPaintTarget()
                  if (e.key === 'Enter') void confirmPaintTarget()
                }}
                autoFocus
              />
            </label>
            <div className="renderer-modal__actions">
              <button type="button" className="renderer-modal__btn" onClick={cancelPaintTarget}>Cancel</button>
              <button type="button" className="renderer-modal__btn renderer-modal__btn--primary" onClick={() => void confirmPaintTarget()}>
                Create and paint
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Collect the layerKeys of every leaf in DFS order — the index space the panel's
// shift-range multi-select operates over.
function flattenLayerKeys(nodes: PathTreeNode[]): string[] {
  const out: string[] = []
  const walk = (n: PathTreeNode) => {
    if (n.layerKey) out.push(n.layerKey)
    n.children.forEach(walk)
  }
  nodes.forEach(walk)
  return out
}

function ancestorPathKeys(path: string): string[] {
  const segs = path.split('/').filter(Boolean)
  const out: string[] = []
  for (let i = 1; i < segs.length; i++) out.push(`/${segs.slice(0, i).join('/')}`)
  return out
}

function LayerTreeRows({
  node,
  depth,
  selectedKeys,
  onSelectLayer,
  collapsed,
  onToggleCollapsed,
}: {
  node: PathTreeNode
  depth: number
  selectedKeys: ReadonlySet<string>
  onSelectLayer: (key: string, e?: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => void
  collapsed: ReadonlySet<string>
  onToggleCollapsed: (pathKey: string) => void
}): JSX.Element {
  const isCollapsed = collapsed.has(node.pathKey)
  const hasChildren = node.children.length > 0
  return (
    <>
      {node.layerKey ? (
        <LayerRow
          layerKey={node.layerKey}
          depth={depth}
          selected={selectedKeys.has(node.layerKey)}
          hasChildren={hasChildren}
          collapsed={isCollapsed}
          onToggleCollapsed={() => onToggleCollapsed(node.pathKey)}
          onSelect={(e) => onSelectLayer(node.layerKey!, e)}
        />
      ) : (
        // Collapsible sink/path container row: chevron toggles its subtree.
        <li
          className={`renderer-layer-row renderer-layer-row--container${depth > 0 ? ' renderer-layer-row--child' : ''}`}
          style={{ paddingLeft: 8 + depth * 13 }}
          role="presentation"
        >
          <button
            type="button"
            className="renderer-layer-caret"
            title={isCollapsed ? 'Expand' : 'Collapse'}
            aria-expanded={!isCollapsed}
            onClick={() => onToggleCollapsed(node.pathKey)}
          >
            {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          </button>
          <span className="renderer-layer-color renderer-layer-color--container" aria-hidden />
          <span className="renderer-layer-name" title={node.pathKey}>{node.segment}</span>
        </li>
      )}
      {hasChildren &&
        !isCollapsed &&
        node.children.map((child) => (
          <LayerTreeRows
            key={child.pathKey}
            node={child}
            depth={depth + 1}
            selectedKeys={selectedKeys}
            onSelectLayer={onSelectLayer}
            collapsed={collapsed}
            onToggleCollapsed={onToggleCollapsed}
          />
        ))}
    </>
  )
}

function LayerRow({
  layerKey,
  depth,
  selected,
  hasChildren,
  collapsed,
  onToggleCollapsed,
  onSelect,
}: {
  layerKey: string
  depth: number
  selected: boolean
  hasChildren: boolean
  collapsed: boolean
  onToggleCollapsed: () => void
  onSelect: (e: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => void
}): JSX.Element | null {
  const layer = useVoxelLayer(layerKey)
  const setLayerVisible = useRenderStore((s) => s.setLayerVisible)
  const toggleSubLayerVisible = useRenderStore((s) => s.toggleSubLayerVisible)
  const selectedEditorNodeIds = useRenderStore((s) => s.selectedEditorNodeIds)
  // Multi-value layers (G2) expand to one sub-layer row per voxel token.
  const [subOpen, setSubOpen] = useState(true)
  if (!layer) return null
  // Legacy LayersSidePanel labels rows by the scene node/path name; the
  // asset_name is surfaced separately (badge), not as the row label.
  const label = layer.nodeName || layer.assetName || `#${layer.value}`
  // Green editor-selection highlight when this layer's node is selected in the
  // editor — mirrors the legacy PathTreeRow `is-editor-selected` treatment.
  const editorSelected = selectedEditorNodeIds.includes(layer.nodeId)
  const subTokens = layer.subTokens
  const isMulti = !!subTokens && subTokens.length > 1
  return (
    <>
      <li
        className={`renderer-layer-row${depth > 0 ? ' renderer-layer-row--child' : ''}${layer.visible ? '' : ' is-hidden'}${selected ? ' is-selected' : ''}${editorSelected ? ' is-editor-selected' : ''}`}
        style={{ paddingLeft: 8 + depth * 13 }}
        role="option"
        aria-selected={selected}
        onClick={onSelect}
      >
        {hasChildren ? (
          <button
            type="button"
            className="renderer-layer-caret"
            title={collapsed ? 'Expand' : 'Collapse'}
            aria-expanded={!collapsed}
            onClick={(e) => {
              e.stopPropagation()
              onToggleCollapsed()
            }}
          >
            {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          </button>
        ) : isMulti ? (
          <button
            type="button"
            className="renderer-layer-caret"
            title={subOpen ? 'Collapse sub-layers' : 'Expand sub-layers'}
            aria-expanded={subOpen}
            onClick={(e) => {
              e.stopPropagation()
              setSubOpen((v) => !v)
            }}
          >
            {subOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span className="renderer-layer-caret renderer-layer-caret--spacer" aria-hidden />
        )}
        <span className="renderer-layer-color" style={{ backgroundColor: `hsl(${valueHue(layer.value)}, 65%, 55%)` }} aria-hidden />
        <span className="renderer-layer-name" title={layer.nodePath || label}>
          {label}
        </span>
        <span className="renderer-layer-count">{layer.cells.length}</span>
        <button
          type="button"
          className="renderer-layer-eye"
          title={layer.visible ? 'Hide layer' : 'Show layer'}
          aria-pressed={layer.visible}
          onClick={(e) => {
            e.stopPropagation()
            setLayerVisible(layerKey, !layer.visible)
          }}
        >
          {layer.visible ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>
      </li>
      {isMulti &&
        subOpen &&
        subTokens!.map((token, i) => {
          const subVisible = layer.subVisible?.[token] !== false
          const count = layer.cellsByToken?.[token]?.length ?? 0
          return (
            <li
              key={token || `#${i}`}
              className={`renderer-layer-row renderer-layer-row--child renderer-layer-row--sub${subVisible ? '' : ' is-hidden'}`}
              style={{ paddingLeft: 8 + (depth + 1) * 13 }}
              role="presentation"
            >
              <span className="renderer-layer-caret renderer-layer-caret--spacer" aria-hidden />
              <span
                className="renderer-layer-color renderer-layer-color--sub"
                style={{ backgroundColor: `hsl(${valueHue(i + 1)}, 60%, 58%)` }}
                aria-hidden
              />
              <span className="renderer-layer-name" title={token}>
                {token || '(untokened)'}
              </span>
              <span className="renderer-layer-count">{count}</span>
              <button
                type="button"
                className="renderer-layer-eye"
                title={subVisible ? 'Hide sub-layer' : 'Show sub-layer'}
                aria-pressed={subVisible}
                onClick={(e) => {
                  e.stopPropagation()
                  toggleSubLayerVisible(layerKey, token)
                }}
              >
                {subVisible ? <Eye size={12} /> : <EyeOff size={12} />}
              </button>
            </li>
          )
        })}
    </>
  )
}

// One editable (baked) layer row. Selecting it makes it the paint target
// (`activeBakedLayerKey`); painting in the canvas flows into this layer. Indents
// by scene-path depth so sub-layers nest visually.
function BakedLayerTreeRows({
  node,
  depth,
  selectedKeys,
  activeKey,
  dropHover,
  collapsed,
  onToggleCollapsed,
  onSelect,
  onAddSub,
  onRemove,
  renamingKey,
  onStartRename,
  onCancelRename,
  onRename,
  onDragStartKey,
  onDragOverKey,
  onDropKey,
}: {
  node: PathTreeNode
  depth: number
  selectedKeys: ReadonlySet<string>
  activeKey: string | null
  dropHover: { key: string; zone: 'before' | 'after' | 'inside' } | null
  collapsed: ReadonlySet<string>
  onToggleCollapsed: (pathKey: string) => void
  onSelect: (key: string, e?: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => void
  onAddSub: (nodePath: string) => void
  onRemove: (nodePath: string) => void
  renamingKey: string | null
  onStartRename: (key: string) => void
  onCancelRename: () => void
  onRename: (nodePath: string, name: string) => Promise<void>
  onDragStartKey: (key: string) => void
  onDragOverKey: (key: string, zone: 'before' | 'after' | 'inside') => void
  onDropKey: (key: string, zone: 'before' | 'after' | 'inside') => void
}): JSX.Element {
  const isCollapsed = collapsed.has(node.pathKey)
  const hasChildren = node.children.length > 0
  return (
    <>
      {node.layerKey ? (
        <BakedLayerRow
          layerKey={node.layerKey}
          depth={depth}
          selected={selectedKeys.has(node.layerKey)}
          active={activeKey === node.layerKey}
          dropZone={dropHover && dropHover.key === node.layerKey ? dropHover.zone : null}
          hasChildren={hasChildren}
          collapsed={isCollapsed}
          onToggleCollapsed={() => onToggleCollapsed(node.pathKey)}
          onSelect={onSelect}
          onAddSub={onAddSub}
          onRemove={onRemove}
          isRenaming={renamingKey === node.layerKey}
          onStartRename={() => onStartRename(node.layerKey!)}
          onCancelRename={onCancelRename}
          onRename={onRename}
          onDragStartKey={onDragStartKey}
          onDragOverKey={onDragOverKey}
          onDropKey={onDropKey}
        />
      ) : (
        <li
          className={`renderer-layer-row renderer-layer-row--container${depth > 0 ? ' renderer-layer-row--child' : ''}`}
          style={{ paddingLeft: 8 + depth * 13 }}
          role="presentation"
        >
          <button
            type="button"
            className="renderer-layer-caret"
            title={isCollapsed ? 'Expand' : 'Collapse'}
            aria-expanded={!isCollapsed}
            onClick={() => onToggleCollapsed(node.pathKey)}
          >
            {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          </button>
          <span className="renderer-layer-color renderer-layer-color--container" aria-hidden />
          <span className="renderer-layer-name" title={node.pathKey}>{node.segment}</span>
        </li>
      )}
      {hasChildren &&
        !isCollapsed &&
        node.children.map((child) => (
          <BakedLayerTreeRows
            key={child.pathKey}
            node={child}
            depth={depth + 1}
            selectedKeys={selectedKeys}
            activeKey={activeKey}
            dropHover={dropHover}
            collapsed={collapsed}
            onToggleCollapsed={onToggleCollapsed}
            onSelect={onSelect}
            onAddSub={onAddSub}
            onRemove={onRemove}
            renamingKey={renamingKey}
            onStartRename={onStartRename}
            onCancelRename={onCancelRename}
            onRename={onRename}
            onDragStartKey={onDragStartKey}
            onDragOverKey={onDragOverKey}
            onDropKey={onDropKey}
          />
        ))}
    </>
  )
}

function BakedLayerRow({
  layerKey,
  depth,
  selected,
  active,
  dropZone,
  hasChildren,
  collapsed,
  onToggleCollapsed,
  onSelect,
  onAddSub,
  onRemove,
  isRenaming,
  onStartRename,
  onCancelRename,
  onRename,
  onDragStartKey,
  onDragOverKey,
  onDropKey,
}: {
  layerKey: string
  depth: number
  selected: boolean
  active: boolean
  dropZone: 'before' | 'after' | 'inside' | null
  hasChildren: boolean
  collapsed: boolean
  onToggleCollapsed: () => void
  onSelect: (key: string, e?: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => void
  onAddSub: (nodePath: string) => void
  onRemove: (nodePath: string) => void
  isRenaming: boolean
  onStartRename: () => void
  onCancelRename: () => void
  onRename: (nodePath: string, name: string) => Promise<void>
  onDragStartKey: (key: string) => void
  onDragOverKey: (key: string, zone: 'before' | 'after' | 'inside') => void
  onDropKey: (key: string, zone: 'before' | 'after' | 'inside') => void
}): JSX.Element | null {
  const layer = useBakedLayer(layerKey)
  const setBakedLayerVisible = useRenderStore((s) => s.setBakedLayerVisible)
  const rowRef = useRef<HTMLLIElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [draftName, setDraftName] = useState('')
  const label = layer ? (layer.nodeName || layer.assetName || layer.nodePath) : ''
  useEffect(() => {
    if (!isRenaming) {
      setDraftName(label)
      return
    }
    setDraftName(label)
    window.requestAnimationFrame(() => {
      rowRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [isRenaming, label])
  if (!layer) return null
  const commitRename = async (): Promise<void> => {
    const next = draftName.trim()
    if (!next || next === label) {
      setDraftName(label)
      onCancelRename()
      return
    }
    await onRename(layer.nodePath, next)
  }
  // Cursor position within the row → drop intent (top 30% before, bottom 30%
  // after, middle reparents as a child).
  const zoneFromEvent = (e: React.DragEvent): 'before' | 'after' | 'inside' => {
    const r = e.currentTarget.getBoundingClientRect()
    const rel = (e.clientY - r.top) / Math.max(1, r.height)
    return rel < 0.3 ? 'before' : rel > 0.7 ? 'after' : 'inside'
  }
  return (
    <li
      ref={rowRef}
      className={`renderer-layer-row renderer-layer-row--baked${depth > 0 ? ' renderer-layer-row--child' : ''}${layer.visible ? '' : ' is-hidden'}${active ? ' is-active' : ''}${selected ? ' is-selected' : ''}${dropZone ? ` drop-${dropZone}` : ''}`}
      style={{ paddingLeft: 8 + depth * 13 }}
      role="option"
      aria-selected={selected}
      title={layer.assetName ? `${layer.nodePath} · ${layer.assetName}` : layer.nodePath}
      draggable={!isRenaming}
      onDragStart={() => onDragStartKey(layerKey)}
      onDragOver={(e) => { e.preventDefault(); onDragOverKey(layerKey, zoneFromEvent(e)) }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onDropKey(layerKey, zoneFromEvent(e)) }}
      onClick={(e) => onSelect(layerKey, e)}
    >
      {hasChildren ? (
        <button
          type="button"
          className="renderer-layer-caret"
          title={collapsed ? 'Expand' : 'Collapse'}
          aria-expanded={!collapsed}
          onClick={(e) => { e.stopPropagation(); onToggleCollapsed() }}
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        </button>
      ) : (
        <span className="renderer-layer-caret renderer-layer-caret--spacer" aria-hidden />
      )}
      <span className="renderer-layer-color" style={{ backgroundColor: `hsl(${valueHue(layer.value)}, 65%, 55%)` }} aria-hidden />
      {isRenaming ? (
        <input
          ref={inputRef}
          className="renderer-layer-name-input"
          aria-label="Rename editable layer"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onBlur={() => { void commitRename() }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              setDraftName(label)
              onCancelRename()
            } else if (e.key === 'Enter') {
              e.stopPropagation()
              e.currentTarget.blur()
            }
          }}
        />
      ) : (
        <span className="renderer-layer-name" onDoubleClick={(e) => { e.stopPropagation(); onStartRename() }}>{label}</span>
      )}
      <span className="renderer-layer-count">{layer.cells.length}</span>
      <button
        type="button"
        className="renderer-layer-eye"
        title="Add sub-layer"
        onClick={(e) => { e.stopPropagation(); onAddSub(layer.nodePath) }}
      >
        <Plus size={12} />
      </button>
      <button
        type="button"
        className="renderer-layer-eye"
        title="Delete layer"
        onClick={(e) => { e.stopPropagation(); onRemove(layer.nodePath) }}
      >
        <Trash size={12} />
      </button>
      <button
        type="button"
        className="renderer-layer-eye"
        title={layer.visible ? 'Hide layer' : 'Show layer'}
        aria-pressed={layer.visible}
        onClick={(e) => { e.stopPropagation(); setBakedLayerVisible(layerKey, !layer.visible) }}
      >
        {layer.visible ? <Eye size={12} /> : <EyeOff size={12} />}
      </button>
    </li>
  )
}
