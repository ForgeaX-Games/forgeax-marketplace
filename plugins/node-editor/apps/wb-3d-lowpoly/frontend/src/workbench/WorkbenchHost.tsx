import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Editor, usePipelineStore, useProjectStore } from '@forgeax/node-runtime-react/editor'
import { HttpApiClient } from '../api/HttpApiClient.js'
import { geometryValueFormatter } from './geometryValueFormatter.js'
import { paneUrl } from './paneUrls.js'
import './WorkbenchHost.css'

const geometryPortTypes = [
  { type: 'geometry', desc: '几何', descEn: 'Geometry', color: '#f87171', compatibleWith: ['string'] },
]
const geometryValueFormatters = [geometryValueFormatter]

// Domain port types (geometry) are passed to <Editor> explicitly via the
// `domainPortTypes` prop below — no module-global registration side effect.

// The kernel editor's gear button is hidden (showSettingsButton={false}); its
// controls — language, open/save, the URDF embed toggle, status, history, data
// types — are re-surfaced in the LEFT pane (<EditorControlsPanel>). The URDF
// embed STATE still lives here because it drives the embedded iframe; the left
// pane flips it by writing LS_URDF, which we mirror via a `storage` listener
// (same-origin sibling iframe → cross-document).
const LS_URDF = 'wb3d:urdfInline'
// Must match the center <Editor editorSyncKey> ↔ left <EditorControlsPanel syncKey>.
const EDITOR_SYNC_KEY = 'wb-3d-lowpoly-editor'

function readBool(key: string, fallback: boolean): boolean {
  if (typeof localStorage === 'undefined') return fallback
  const raw = localStorage.getItem(key)
  return raw === null ? fallback : raw === 'true'
}

// Workbench host: the kernel Editor sits at the bottom; an embedded URDF 3D
// viewer iframe (a `?pane=urdf` surface of this same app) sits on top, separated
// by a draggable row splitter. The host forwards the kernel editor's node
// selection to the viewer over the `workbench:editor-selection` postMessage
// channel. Mirrors the scene generator's WorkbenchHost (renderer pane).
export function WorkbenchHost(): JSX.Element {
  const client = useMemo(() => new HttpApiClient({ baseUrl: '', pipelineId: 'main' }), [])

  const [urdfInline, setUrdfInline] = useState(() => readBool(LS_URDF, true))
  const [workbenchHeight, setWorkbenchHeight] = useState<number | null>(null)
  const [isResizing, setIsResizing] = useState(false)
  const [urdfReloadKey, setUrdfReloadKey] = useState(0)
  const [isEditorFullscreen, setIsEditorFullscreen] = useState(false)

  const rootRef = useRef<HTMLDivElement>(null)
  const urdfIframeRef = useRef<HTMLIFrameElement>(null)
  // Project switching / create / delete now lives in the left pane's
  // <ProjectPanel>; the center pane only observes the active project id so it
  // can reload the embedded URDF viewer when the project changes (via the
  // kernel's project:activated cross-client sync, wired in <Editor>).
  const activeProjectId = useProjectStore((s) => s.activeProjectId)

  // Mirror URDF embed flips made in the left pane (which writes LS_URDF).
  // `storage` fires only in OTHER same-origin documents, so this is exactly the
  // left-pane → center-pane channel for the relocated window toggle.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === LS_URDF) setUrdfInline(readBool(LS_URDF, true))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // Forward the kernel editor's node selection to the URDF pane. The kernel
  // selection lives in the host's in-process pipeline store (no backend/WS
  // round-trip), so we read it here and push it down the
  // `workbench:editor-selection` postMessage channel. View-only — never mutates
  // the graph. `selectionRef` lets the iframe `onLoad` re-seed selection after
  // the viewer (re)mounts.
  const selectionRef = useRef<string[]>([])
  const postSelectionToUrdf = useCallback((ids: string[]) => {
    urdfIframeRef.current?.contentWindow?.postMessage(
      { type: 'workbench:editor-selection', selectedNodeIds: ids },
      '*',
    )
  }, [])
  useEffect(() => {
    const sync = (ids: string[]) => {
      selectionRef.current = ids
      postSelectionToUrdf(ids)
    }
    sync(usePipelineStore.getState().selectedNodeIds)
    return usePipelineStore.subscribe((state, prev) => {
      if (state.selectedNodeIds !== prev.selectedNodeIds) sync(state.selectedNodeIds)
    })
  }, [postSelectionToUrdf])

  useEffect(() => {
    void useProjectStore.getState().fetchProjects()
  }, [])

  const prevProjectRef = useRef<string | null>(null)
  useEffect(() => {
    if (activeProjectId === null) return
    if (prevProjectRef.current === null) {
      prevProjectRef.current = activeProjectId
      return
    }
    if (prevProjectRef.current === activeProjectId) return
    prevProjectRef.current = activeProjectId
    setUrdfReloadKey((k) => k + 1)
    urdfIframeRef.current?.contentWindow?.postMessage(
      { type: 'workbench:project-changed', projectId: activeProjectId },
      '*',
    )
  }, [activeProjectId])

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

  const rootStyle: CSSProperties = {
    ...(workbenchHeight !== null ? { '--workbench-height': `${workbenchHeight}px` } : {}),
  } as CSSProperties

  return (
    <div
      ref={rootRef}
      className={[
        'wb3d-workbench',
        urdfInline ? 'wb3d-workbench--embedded' : '',
        isResizing ? 'wb3d-workbench--resizing' : '',
        isEditorFullscreen ? 'wb3d-workbench--focus-editor' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={rootStyle}
    >
      {urdfInline && (
        <section className="wb3d-workbench__pane" aria-label="URDF Viewer">
          <iframe
            key={`urdf-${urdfReloadKey}`}
            ref={urdfIframeRef}
            src={paneUrl('urdf')}
            title="urdf"
            className="wb3d-workbench__iframe"
            allow="clipboard-write"
            onLoad={() => postSelectionToUrdf(selectionRef.current)}
          />
        </section>
      )}

      {urdfInline && (
        <div
          className="wb3d-workbench__resize"
          onMouseDown={beginRowResize}
          aria-label="Resize URDF viewer and editor"
        />
      )}

      <div className="wb3d-workbench__editor">
        <Editor
          apiClient={client}
          title="3D Lowpoly Generator"
          showRunControl={false}
          showSettingsButton={false}
          editorSyncKey={EDITOR_SYNC_KEY}
          domainNodeTypes={{}}
          domainPortTypes={geometryPortTypes}
          domainValueFormatters={geometryValueFormatters}
          isFullscreen={isEditorFullscreen}
          onToggleFullscreen={() => setIsEditorFullscreen((v) => !v)}
        />
      </div>
    </div>
  )
}
