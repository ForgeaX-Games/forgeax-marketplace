import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Editor, useProjectStore, usePipelineStore, stripTooLargeSummaries } from '@forgeax/node-runtime-react/editor'
import { HttpApiClient } from '../api/HttpApiClient.js'
import { scenePanelTypes } from '../panels/scenePanels.js'
import { paneUrl } from './paneUrls.js'
import { isWorkbenchMessage, type WorkbenchFocus } from './protocol.js'
import { sceneValueFormatter } from './sceneValueFormatter.js'
import { scenePortTypes } from './scenePortTypes.js'
import { syncTrace, syncTraceHintOnce, summarizeNodeOutputs } from '../debug/syncTrace.js'
import { LoadingStatusPanel, type LoadingStep } from './LoadingStatusPanel.js'
import './WorkbenchHost.css'

const sceneValueFormatters = [sceneValueFormatter]

// Domain port types (scene, point2d) come from the shared scenePortTypes module
// and are passed to <Editor> explicitly via the `domainPortTypes` prop below —
// no module-global registration side effect.

// The kernel editor's gear button is hidden (showSettingsButton={false}); its
// controls — history, data types, help — are re-surfaced in the LEFT pane
// (<SceneGeneratorControlsPanel>).
// embed-toggle STATE still lives here because it drives the embedded iframes;
// the left pane flips it by writing these localStorage keys, and we mirror those
// writes via a `storage` listener (same-origin sibling iframe → cross-document).
const LS_RENDERER = 'wb-scene-generator.rendererInline'
const LS_ASSETSTORE = 'wb-scene-generator.assetStoreInline'
const LS_EDITOR = 'wb-scene-generator.editorInline'
// Must match the center <Editor editorSyncKey> ↔ left <SceneGeneratorControlsPanel syncKey>.
const EDITOR_SYNC_KEY = 'wb-scene-generator-editor'

// AssetStore pane's initial width on (re)load. Independent of any other pane;
// dragging the column splitter overrides it at runtime (not persisted).
const ASSETSTORE_WIDTH_DEFAULT = 290

function readBool(key: string, fallback: boolean): boolean {
  if (typeof localStorage === 'undefined') return fallback
  const raw = localStorage.getItem(key)
  return raw === null ? fallback : raw === 'true'
}

// Project-switch progress panel step labels for the host-side (editor) phases
// — the renderer-iframe's own phases (previews/baked/aliases) arrive
// pre-labeled over `workbench:loading-status` (see loadingSignals.ts).
function switchPhaseLabel(phase: string | null): string {
  switch (phase) {
    case 'persisting':
      return '保存当前项目'
    case 'viewing':
      return '切换项目视图'
    case 'hydrating':
      return '载入节点图'
    default:
      return '切换项目'
  }
}

// Turns a raw boolean signal into 'active' while true, 'done' for a brief
// linger window after it flips false (so a fast phase still visibly appears
// as a completed checklist row instead of vanishing instantly), then 'idle'
// (excluded from the panel) once the linger elapses.
function useLingeringStep(active: boolean, lingerMs = 1100): 'idle' | 'active' | 'done' {
  const [state, setState] = useState<'idle' | 'active' | 'done'>(active ? 'active' : 'idle')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (active) {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      setState('active')
    } else {
      setState((prev) => (prev === 'active' ? 'done' : prev))
      timerRef.current = setTimeout(() => setState('idle'), lingerMs)
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [active, lingerMs])
  return state
}

type RendererLoadingTask = { id: string; label: string; active: boolean; done?: number; total?: number }

// Legacy-style workbench host: the faithful kernel Editor sits at the bottom; an
// embedded row of Renderer / AssetStore iframes sits on top, each a `?pane=`
// surface of this same app. Mirrors the legacy editor App.tsx layout/focus model
// minus the Viewer (which moves to the 3d-lowpoly plugin).
export function WorkbenchHost(): JSX.Element {
  const client = useMemo(() => new HttpApiClient({ baseUrl: '', pipelineId: 'main' }), [])

  const [rendererInline, setRendererInline] = useState(() => readBool(LS_RENDERER, true))
  const [assetStoreInline, setAssetStoreInline] = useState(() => readBool(LS_ASSETSTORE, true))
  const [editorInline, setEditorInline] = useState(() => readBool(LS_EDITOR, true))
  const [focus, setFocus] = useState<WorkbenchFocus>(null)
  const [workbenchHeight, setWorkbenchHeight] = useState<number | null>(null)
  // AssetStore initial width. Not bound to any other pane at runtime.
  const [assetStoreWidth, setAssetStoreWidth] = useState<number | null>(ASSETSTORE_WIDTH_DEFAULT)
  const [isResizing, setIsResizing] = useState(false)

  // Multi-project management (kernel-backed). Project switching / create / delete
  // lives in the left pane's <ProjectPanel>; the center pane only observes the
  // active project id so it can signal the renderer when the project changes (via
  // the kernel's project:activated cross-client sync, wired in <Editor>).
  const viewingProjectId = useProjectStore((s) => s.viewingProjectId)
  const isSwitchingProject = useProjectStore((s) => s.isSwitching)
  const switchPhase = useProjectStore((s) => s.switchPhase)
  const outputsRefreshBusy = usePipelineStore((s) => s.outputsRefreshBusy)
  const pipelineStatus = usePipelineStore((s) => s.pipelineStatus)
  // Bump to force the preview iframe to clear + reload on a project switch.
  const [rendererReloadKey, setRendererReloadKey] = useState(0)
  // Project-switch loading-progress panel: host-observed phases (below) plus
  // whatever the renderer iframe reports over `workbench:loading-status`.
  const [rendererBooting, setRendererBooting] = useState(false)
  const [rendererTasks, setRendererTasks] = useState<RendererLoadingTask[]>([])

  const rootRef = useRef<HTMLDivElement>(null)
  const rendererIframeRef = useRef<HTMLIFrameElement>(null)
  const assetStoreIframeRef = useRef<HTMLIFrameElement>(null)

  const hasEmbedded = rendererInline || assetStoreInline
  // The editor (Scene Generator) is now toggleable too. The "split" 3-row layout
  // (panes / resize / editor) only applies when BOTH the panes row and the editor
  // are visible; otherwise whichever single section is on fills the grid. When all
  // three are off we render an empty-state placeholder so the pane isn't blank.
  const showSplit = hasEmbedded && editorInline
  const showEmpty = !hasEmbedded && !editorInline

  // Mirror embed-toggle flips made in the left pane (which writes these keys).
  // `storage` fires only in OTHER same-origin documents, so this is exactly the
  // left-pane → center-pane channel for the relocated window toggles.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === LS_RENDERER) setRendererInline(readBool(LS_RENDERER, true))
      else if (e.key === LS_ASSETSTORE) setAssetStoreInline(readBool(LS_ASSETSTORE, true))
      else if (e.key === LS_EDITOR) setEditorInline(readBool(LS_EDITOR, true))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const isEditorFullscreen = focus === 'editor'
  const toggleEditorFullscreen = useCallback(() => {
    setFocus((f) => (f === 'editor' ? null : 'editor'))
  }, [])

  // Parent half of the `workbench:*` protocol: children request/query focus; we
  // reply / broadcast focus-changed back.
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (!isWorkbenchMessage(event.data)) return
      const data = event.data
      if (data.type === 'workbench:request-focus') {
        setFocus((f) => (f === data.target ? null : data.target))
      } else if (data.type === 'workbench:query-focus') {
        ;(event.source as Window | null)?.postMessage(
          { type: 'workbench:focus-changed', focus },
          '*',
        )
      } else if (data.type === 'workbench:loading-status') {
        setRendererTasks(data.tasks)
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [focus])

  // Broadcast focus changes so child buttons reflect fullscreen state.
  useEffect(() => {
    const msg = { type: 'workbench:focus-changed', focus }
    rendererIframeRef.current?.contentWindow?.postMessage(msg, '*')
    assetStoreIframeRef.current?.contentWindow?.postMessage(msg, '*')
  }, [focus])

  // Forward the kernel editor's node selection to the renderer pane so it can
  // apply the legacy editor-selection highlight. The kernel selection lives in
  // the host's in-process pipeline store (no backend/WS round-trip), so we read
  // it here and push it down the `workbench:editor-selection` postMessage
  // channel. View-only — never mutates the graph. `selectionRef` lets the
  // iframe `onLoad` re-seed selection after the renderer (re)mounts.
  const selectionRef = useRef<string[]>([])
  const postSelectionToRenderer = useCallback((ids: string[]) => {
    rendererIframeRef.current?.contentWindow?.postMessage(
      { type: 'workbench:editor-selection', selectedNodeIds: ids },
      '*',
    )
  }, [])
  useEffect(() => {
    const sync = (ids: string[]) => {
      selectionRef.current = ids
      postSelectionToRenderer(ids)
    }
    sync(usePipelineStore.getState().selectedNodeIds)
    return usePipelineStore.subscribe((state, prev) => {
      if (state.selectedNodeIds !== prev.selectedNodeIds) sync(state.selectedNodeIds)
    })
  }, [postSelectionToRenderer])

  // Forward the kernel editor's per-node preview toggle (`previewEnabled`) to the
  // renderer pane. The toggle lives client-side in the host's pipeline store and
  // is NOT persisted to the backend, so without this bridge the renderer (which
  // reads `previewEnabled` from `listNodes`) would never drop/restore the
  // toggled node's layers. Replaces the legacy `preview:change` WS event.
  // View-only — never mutates the graph.
  const previewDisabledRef = useRef<string[]>([])
  const postPreviewToRenderer = useCallback((ids: string[]) => {
    rendererIframeRef.current?.contentWindow?.postMessage(
      { type: 'workbench:preview-change', previewDisabledNodeIds: ids },
      '*',
    )
  }, [])
  useEffect(() => {
    const disabledIds = (state: ReturnType<typeof usePipelineStore.getState>): string[] =>
      (state.currentPipeline?.nodes ?? []).filter((n) => n.previewEnabled === false).map((n) => n.id)
    const sync = (ids: string[]) => {
      previewDisabledRef.current = ids
      postPreviewToRenderer(ids)
    }
    sync(disabledIds(usePipelineStore.getState()))
    return usePipelineStore.subscribe((state, prev) => {
      if (state.currentPipeline === prev.currentPipeline) return
      const next = disabledIds(state)
      const cur = previewDisabledRef.current
      // Only post when the disabled SET actually changed (graph edits churn
      // currentPipeline identity on unrelated changes).
      if (next.length === cur.length && next.every((v, i) => v === cur[i])) return
      sync(next)
    })
  }, [postPreviewToRenderer])

  // Push live node output VALUES straight to the renderer the instant the editor
  // applies an execute response (incrementalExecute → setNodeOutput), bypassing
  // the renderer's WS `exec:completed` → `getNodeOutput` re-pull. The editor
  // already holds the freshly computed grid in memory during a slider drag; this
  // forwards just the nodes whose per-node output object reference changed (a
  // setNodeOutput only mints a new ref when a value genuinely changed), so the
  // preview repaints in the same frame instead of waiting ~200ms for the WS+GET
  // detour. The trailing exec:completed / graph:applied still own GC + the
  // durable post-drag refresh, so this is a pure latency shortcut, not a new SSOT.
  const postPreviewDataToRenderer = useCallback((outputs: Record<string, Record<string, unknown>>) => {
    const stripped: Record<string, Record<string, unknown>> = {}
    for (const [nodeId, bag] of Object.entries(outputs)) {
      const clean = stripTooLargeSummaries(bag)
      if (Object.keys(clean).length > 0) stripped[nodeId] = clean
    }
    if (Object.keys(stripped).length === 0) return
    syncTrace('preview:postMessage', { nodes: summarizeNodeOutputs(stripped) })
    rendererIframeRef.current?.contentWindow?.postMessage(
      { type: 'workbench:preview-data', outputs: stripped },
      '*',
    )
  }, [])
  useEffect(() => {
    let prevOutputs = usePipelineStore.getState().nodeOutputs
    return usePipelineStore.subscribe((state) => {
      const next = state.nodeOutputs
      if (next === prevOutputs) return
      // Forward only the nodes whose per-node bag reference changed (new value).
      const changed: Record<string, Record<string, unknown>> = {}
      for (const nodeId of Object.keys(next)) {
        if (next[nodeId] !== prevOutputs[nodeId]) changed[nodeId] = next[nodeId]
      }
      prevOutputs = next
      postPreviewDataToRenderer(changed)
    })
  }, [postPreviewDataToRenderer])

  // Bootstrap the project list + viewing project on mount. switchProject sets
  // the HttpApiClient viewingProjectId and loads the graph via the view cascade.
  useEffect(() => {
    syncTraceHintOnce()
    void useProjectStore.getState().bootstrap()
  }, [])

  // Notify the preview iframe when the viewing project changes so it can
  // SOFT-reset (clear its store + re-run its data hooks for the new project)
  // via `workbench:project-changed` — see `RendererSurface`'s handler, which
  // calls `useRenderStore.getState().reset()`. This used to also force a hard
  // iframe remount (`key` bump) on every switch, destroying the whole document
  // (3 WebSockets + op-catalog/node-meta caches) just to clear a few React/
  // zustand fields that `reset()` already covers faithfully (same fields a
  // remount would implicitly zero via a fresh module load) — removed, since
  // the perceived "stuck/blank" project-switch delay was largely this teardown
  // + reconnect, not actual data work. `rendererReloadKey` is left wired (iframe
  // `key` below) as a manual escape hatch — nothing currently bumps it
  // automatically.
  const prevProjectRef = useRef<string | null>(null)
  useEffect(() => {
    if (viewingProjectId === null) return
    const prev = prevProjectRef.current
    if (prev === viewingProjectId) return
    prevProjectRef.current = viewingProjectId
    rendererIframeRef.current?.contentWindow?.postMessage(
      { type: 'workbench:project-changed', projectId: viewingProjectId },
      '*',
    )
  }, [viewingProjectId])

  // Project-switch loading-progress panel: merge the host-observed phases
  // (editor-side persist/view/hydrate + output fan-out) with whatever the
  // renderer iframe reports (previews/baked/aliases + its own boot window).
  // Each `useLingeringStep` keeps a fast/instant phase visible as a briefly
  // "done" checklist row instead of vanishing the moment it completes.
  const switchState = useLingeringStep(isSwitchingProject)
  const outputsState = useLingeringStep(outputsRefreshBusy)
  const bootState = useLingeringStep(rendererBooting)
  // Covers `autoExecuteOnOpen()` (cold-cache auto-run after a project switch,
  // see projectStore.ts's refreshOutputsAfterProjectSwitch) as well as manual
  // Run/"clear cache + re-run" — this can legitimately be the longest step
  // (actual node computation, not a fetch), so it needs its own visible row
  // rather than silently running after the "拉取节点输出" step already reads "done".
  const executingState = useLingeringStep(pipelineStatus === 'running')
  const loadingSteps = useMemo<LoadingStep[]>(() => {
    const steps: LoadingStep[] = []
    if (switchState !== 'idle') {
      steps.push({ id: 'switch', label: switchPhaseLabel(switchPhase), state: switchState })
    }
    if (bootState !== 'idle') {
      steps.push({ id: 'boot', label: '重新加载渲染器', state: bootState })
    }
    if (outputsState !== 'idle') {
      steps.push({ id: 'outputs', label: '拉取节点输出（编辑器）', state: outputsState })
    }
    if (executingState !== 'idle') {
      steps.push({ id: 'execute', label: '执行节点计算（编辑器）', state: executingState })
    }
    const rendererOrder = ['previews', 'baked', 'aliases']
    for (const id of rendererOrder) {
      const task = rendererTasks.find((t) => t.id === id)
      if (!task) continue
      steps.push({
        id: task.id,
        label: task.label,
        state: task.active ? 'active' : 'done',
        detail: task.total ? `${task.done ?? task.total}/${task.total}` : undefined,
      })
    }
    return steps
  }, [switchState, switchPhase, bootState, outputsState, executingState, rendererTasks])

  const beginRowResize = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    const rect = rootRef.current?.getBoundingClientRect()
    if (!rect) return
    setIsResizing(true)
    const onMove = (m: MouseEvent) => {
      const max = Math.max(180, rect.height - 180 - 4)
      setWorkbenchHeight(Math.max(180, Math.min(max, m.clientY - rect.top)))
    }
    const onUp = () => {
      setIsResizing(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  const beginColumnResize = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    const rect = e.currentTarget.parentElement?.getBoundingClientRect()
    if (!rect) return
    setIsResizing(true)
    const onMove = (m: MouseEvent) => {
      const max = Math.max(180, rect.width - 240 - 4)
      setAssetStoreWidth(Math.max(180, Math.min(max, m.clientX - rect.left)))
    }
    const onUp = () => {
      setIsResizing(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  // Pane column template: assetstore fixed-ish, renderer fills remainder; either
  // alone fills the row. A 4px splitter sits between the two when both are open.
  const gridTemplateColumns = useMemo(() => {
    const cols: string[] = []
    if (assetStoreInline) {
      cols.push(rendererInline ? `var(--assetstore-width, ${ASSETSTORE_WIDTH_DEFAULT}px)` : 'minmax(180px, 1fr)')
    }
    if (rendererInline) cols.push('minmax(240px, 1fr)')
    return cols.join(' 4px ')
  }, [assetStoreInline, rendererInline])

  const rootStyle: CSSProperties = {
    ...(workbenchHeight !== null ? { '--workbench-height': `${workbenchHeight}px` } : {}),
    ...(assetStoreWidth !== null ? { '--assetstore-width': `${assetStoreWidth}px` } : {}),
  } as CSSProperties

  const panes: Array<'assetstore' | 'renderer'> = [
    ...(assetStoreInline ? ['assetstore' as const] : []),
    ...(rendererInline ? ['renderer' as const] : []),
  ]

  return (
    <div
      ref={rootRef}
      className={[
        'scene-workbench',
        showSplit ? 'scene-workbench--embedded' : '',
        isResizing ? 'scene-workbench--resizing' : '',
        focus ? `scene-workbench--focus-${focus}` : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={rootStyle}
    >
      {hasEmbedded && (
        <div className="scene-workbench__panes" style={{ gridTemplateColumns }}>
          {panes.map((pane, idx) => {
            const isLast = idx === panes.length - 1
            return (
              <Fragment key={pane}>
                {pane === 'assetstore' && (
                  <section className="scene-pane scene-pane--assetstore" aria-label="AssetStore">
                    <iframe
                      ref={assetStoreIframeRef}
                      src={paneUrl('assetstore')}
                      title="AssetStore"
                      className="scene-pane__iframe"
                    />
                  </section>
                )}
                {pane === 'renderer' && (
                  <section className="scene-pane scene-pane--renderer" aria-label="Renderer">
                    <iframe
                      key={`renderer-${rendererReloadKey}`}
                      ref={rendererIframeRef}
                      src={paneUrl('renderer')}
                      title="Renderer"
                      className="scene-pane__iframe"
                      allow="clipboard-write"
                      onLoad={() => {
                        postSelectionToRenderer(selectionRef.current)
                        postPreviewToRenderer(previewDisabledRef.current)
                        setRendererBooting(false)
                      }}
                    />
                    <LoadingStatusPanel steps={loadingSteps} />
                  </section>
                )}
                {!isLast && (
                  <div
                    className="scene-pane__resize scene-pane__resize--col"
                    onMouseDown={beginColumnResize}
                    aria-label={`Resize ${pane} panel`}
                  />
                )}
              </Fragment>
            )
          })}
        </div>
      )}

      {showSplit && (
        <div
          className="scene-pane__resize scene-pane__resize--row"
          onMouseDown={beginRowResize}
          aria-label="Resize workbench and editor"
        />
      )}

      {editorInline && (
        <div className="scene-workbench__editor">
          <Editor
            apiClient={client}
            title="Scene Generator"
            showRunControl={false}
            showSettingsButton={false}
            editorSyncKey={EDITOR_SYNC_KEY}
            domainNodeTypes={scenePanelTypes}
            domainPortTypes={scenePortTypes}
            domainValueFormatters={sceneValueFormatters}
            isFullscreen={isEditorFullscreen}
            onToggleFullscreen={toggleEditorFullscreen}
          />
        </div>
      )}

      {showEmpty && (
        <div className="scene-workbench__empty" role="status">
          <div className="scene-workbench__empty-inner">
            <h2>All panels are hidden</h2>
            <p>Use the AssetStore, Preview, and Scene Gen buttons in the left navigation to bring a panel back.</p>
          </div>
        </div>
      )}
    </div>
  )
}
