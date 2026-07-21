// 💡 3D Viewer 面板：标题栏 + 三维视口 + 右侧关节面板。三管线共用同一视口
//    （静态 SceneSpec / URDF 关节 / 角色骨骼蒙皮），由 viewerStore.mode 区分。
//    组合 useViewer3DScene + viewerStore，把 store 中的源 / 渲染开关注入 THREE 场景。
//    画布在挂载时即呈现带网格 / 坐标系的空场景（useThreeScene 内置）。
//    legacy viewer App.tsx 的 WS 直连 + 跨端口 postMessage 已剥离；模型来源由 live sync
//    在后续任务里通过 HttpApiClient 注入（client prop 现在仅占位）。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ApiClient } from '@forgeax/node-runtime-react'
import { HttpApiClient } from '../api/HttpApiClient.js'
import { ViewerErrorBoundary } from './viewer3d/components/ErrorBoundary'
import Titlebar from './viewer3d/components/Titlebar'
import ViewerCanvas from './viewer3d/components/ViewerCanvas'
import SidePanel from './viewer3d/components/SidePanel'
import { useViewerStore } from './viewer3d/store/viewerStore'
import { useViewer3DLiveSync } from './viewer3d/useViewer3DLiveSync'
import { exportAnimatedGlbBlob, exportStaticGlbBlob, exportSkinnedGlbBlob, exportCharacterGlbBlob } from './viewer3d/three/export-glb'
import { captureFrameToBlob } from './viewer3d/three/capture-frame'
import { applyLinkHighlight } from './viewer3d/three/selection-highlight'
import { cloneObject3DForExport, disposeObject3D } from './viewer3d/three/three-dispose'
import { useViewer3DScene } from './viewer3d/three/useViewer3DScene'
import { useScreenshotCapture } from './viewer3d/useScreenshotCapture'
import { useGlbExport } from './viewer3d/useGlbExport'
import './viewer3d/theme.css'
import './viewer3d/Viewer3DSurface.css'

const EDITOR_SELECTION_MESSAGE = 'workbench:editor-selection'
const PROJECT_CHANGED_MESSAGE = 'workbench:project-changed'

type ExportFormat = 'obj' | 'glb' | 'glb-static' | 'glb-skinned' | 'glb-character' | 'urdf'

export interface Viewer3DSurfaceProps {
  /** Live-sync transport. Wired in a later task; unused for now. */
  client?: ApiClient
}

function sanitizeBaseName(input: string | undefined, fallback: string): string {
  const cleaned = (input ?? '').replace(/\.[a-z0-9]+$/i, '').replace(/[^a-zA-Z0-9._-]+/g, '_')
  return cleaned.replace(/^_+|_+$/g, '') || fallback
}

function saveBlobFallback(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

async function saveGeneratedBlob(
  filename: string,
  description: string,
  mimeType: string,
  extension: string,
  createBlob: () => Promise<Blob> | Blob,
): Promise<void> {
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description, accept: { [mimeType]: [`.${extension}`] } }],
      })
      const blob = await createBlob()
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return
    } catch (err) {
      const domErr = err as { name?: string; message?: string }
      if (domErr.name === 'AbortError') throw err
      console.warn('[viewer/export] showSaveFilePicker unavailable, falling back to download', err)
    }
  }
  const blob = await createBlob()
  saveBlobFallback(blob, filename)
}

export function Viewer3DSurface(props: Viewer3DSurfaceProps = {}): JSX.Element {
  // Live-sync transport: use the host-supplied client, else build a default one
  // (e.g. when `?pane=viewer3d` is opened standalone). Same-origin `/api` + `/ws`.
  const fallbackClient = useMemo(() => new HttpApiClient({ baseUrl: '', pipelineId: 'main' }), [])
  const client = props.client ?? fallbackClient

  // Resolve which project this viewer mirrors. The backend API is project-scoped
  // (/api/v1/projects/:id/...), so the client needs a `viewingProjectId` before
  // any listNodes/getNodeOutput call — otherwise every pull throws "no viewing
  // project", useViewer3DLiveSync swallows it, and the viewport stays permanently
  // blank. Bootstrap from the backend workspace on mount, then follow the host's
  // `workbench:project-changed` notifications. `activeProjectId` re-runs the
  // live-sync effect once the project is known / changes.
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    const bindProject = (id: string | null | undefined): void => {
      if (cancelled || !id) return
      // syncViewingProjectId is concrete on HttpApiClient (not on the ApiClient
      // interface); a host-supplied transport may omit it — bind best-effort.
      ;(client as { syncViewingProjectId?: (id: string) => void }).syncViewingProjectId?.(id)
      setActiveProjectId(id)
    }
    void client
      .getWorkspace?.()
      .then((ws) => bindProject(ws?.viewingProjectId ?? (ws as { activeProjectId?: string | null })?.activeProjectId))
      .catch(() => { /* workspace fetch failed — a project-changed message can still bind us */ })
    const onMessage = (event: MessageEvent): void => {
      const data = event.data as { type?: unknown; projectId?: unknown } | null
      if (!data || typeof data !== 'object' || data.type !== PROJECT_CHANGED_MESSAGE) return
      if (typeof data.projectId === 'string') bindProject(data.projectId)
    }
    window.addEventListener('message', onMessage)
    return () => {
      cancelled = true
      window.removeEventListener('message', onMessage)
    }
  }, [client])

  useViewer3DLiveSync(client, activeProjectId)

  // Dispose the client we own (the fallback) on unmount so its WebSocket +
  // reconnect timer are released. A host-supplied client is owned by the host,
  // so we never dispose `props.client`.
  useEffect(() => () => { fallbackClient.dispose() }, [fallbackClient])

  const source = useViewerStore((s) => s.source)
  const mode = useViewerStore((s) => s.mode)
  const sceneSpec = useViewerStore((s) => s.sceneSpec)
  const rigSpec = useViewerStore((s) => s.rigSpec)
  const sourceLabel = useViewerStore((s) => s.sourceLabel)
  const baseUrl = useViewerStore((s) => s.baseUrl)
  const assetRevisionKey = useViewerStore((s) => s.assetRevisionKey)
  const render = useViewerStore((s) => s.render)
  const sectionHeight = useViewerStore((s) => s.sectionHeight)
  const authoredAnimation = useViewerStore((s) => s.authoredAnimation)
  const setErrorMessage = useViewerStore((s) => s.setErrorMessage)
  const errorMessage = useViewerStore((s) => s.errorMessage)

  const containerRef = useRef<HTMLDivElement>(null)

  const {
    spec, error, jointValues, previewJointValues,
    setJointValue, resetAllJoints, resetCamera, getExportObject, getCharacterExport, getFrameCanvas, renderFrame,
    captureContactSheet,
    invalidate, stats, loading,
  } = useViewer3DScene(containerRef, {
    source,
    baseUrl,
    assetRevisionKey,
    showGrid: render.showGrid,
    showAxis: render.showAxis,
    showCollisions: render.showCollisions,
    autoAnimate: render.autoAnimate,
    doubleSided: render.doubleSided,
    sectionView: render.sectionView,
    sectionHeight,
  })

  // This `?pane=viewer3d` document holds the live viewer, so it answers the
  // backend's headless `screenshot:request` broadcasts: render a fresh frame
  // and POST the canvas PNG to /api/v1/agent/screenshot/store.
  useScreenshotCapture({ renderFrame, getFrameCanvas, captureContactSheet })
  // Agent-facing twin of the titlebar GLB export: answers `glb:request` by
  // baking the current scene to .glb via the same exportAnimatedGlbBlob path.
  useGlbExport({ getExportObject, getSpec: () => spec, getCharacterExport })

  // ── Best-effort editor-selection → URDF link highlight ───────────────────
  // The workbench host forwards the kernel editor's selection over the
  // `workbench:editor-selection` postMessage channel. We only ever READ the
  // selection and tint matching link meshes — never mutate the graph. Any
  // mapping miss is a clean no-op (see selection-highlight.ts).
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; selectedNodeIds?: unknown } | null
      if (!data || typeof data !== 'object' || data.type !== EDITOR_SELECTION_MESSAGE) return
      const ids = Array.isArray(data.selectedNodeIds)
        ? data.selectedNodeIds.filter((id): id is string => typeof id === 'string')
        : []
      setSelectedNodeIds(ids)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // Resolve selected nodeIds → candidate URDF link names, then apply the
  // highlight. A `g_part` node's `id` param becomes a `<link name>`; an orphan
  // shape becomes `<id>_link`. We try both. Depends on `spec` so a freshly
  // loaded model re-applies the current selection to its new meshes.
  // Monotonic generation guard: each effect run claims the next number, and the
  // async resolution only applies if it is still the latest. This prevents a
  // slow node-fetch from an earlier selection (or earlier `spec`) clobbering the
  // highlight of a newer one when several runs overlap.
  const highlightGenRef = useRef(0)
  useEffect(() => {
    const gen = ++highlightGenRef.current
    const root = getExportObject()
    if (selectedNodeIds.length === 0) {
      applyLinkHighlight(root, new Set())
      invalidate()
      return
    }
    void (async () => {
      const names = new Set<string>()
      await Promise.all(
        selectedNodeIds.map(async (id) => {
          try {
            const node = await client.getNode(id)
            const idParam = node?.params?.id
            if (typeof idParam === 'string' && idParam.trim()) {
              const trimmed = idParam.trim()
              names.add(trimmed)
              names.add(`${trimmed}_link`)
            }
          } catch {
            /* node fetch failed — skip this id, highlight stays best-effort */
          }
        }),
      )
      if (highlightGenRef.current !== gen) return
      applyLinkHighlight(getExportObject(), names)
      invalidate()
    })()
  }, [selectedNodeIds, client, spec, getExportObject, invalidate])

  // Reusable capture seam: grab the live renderer canvas and turn the current
  // frame into a PNG Blob. Plan 4's headless `screenshot:request` loop reuses
  // this exact primitive (canvas via `getFrameCanvas`, encode via toBlob).
  const captureFrame = useCallback(
    (): Promise<Blob | null> => captureFrameToBlob(getFrameCanvas()),
    [getFrameCanvas],
  )

  const handleScreenshot = useCallback(async () => {
    try {
      const blob = await captureFrame()
      if (!blob) return
      const baseName = sanitizeBaseName(spec?.name, 'urdf-model')
      saveBlobFallback(blob, `${baseName}-${Date.now()}.png`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMessage(`Screenshot failed: ${msg}`)
    }
  }, [captureFrame, spec, setErrorMessage])

  const handleExport = useCallback(async (format: ExportFormat) => {
    try {
      const baseName = sanitizeBaseName(spec?.name ?? sourceLabel, 'model')
      if (format === 'urdf') {
        if (!source.trim()) throw new Error('No URDF source loaded')
        await saveGeneratedBlob(
          `${baseName}.urdf`,
          'URDF file',
          'application/xml',
          'urdf',
          () => new Blob([source], { type: 'application/xml;charset=utf-8' }),
        )
        return
      }

      const root = getExportObject()
      if (!root) throw new Error('No 3D object is ready to export')
      root.updateMatrixWorld(true)

      if (format === 'glb-character') {
        // 角色骨骼蒙皮：直接导出活跃 SkinnedMesh + Skeleton 容器 + 骨骼动画 clip。
        const character = getCharacterExport()
        if (!character) throw new Error('No character rig is ready to export (load a skinned rig first)')
        await saveGeneratedBlob(
          `${baseName}-character.glb`,
          'Binary glTF (character)',
          'model/gltf-binary',
          'glb',
          () => exportCharacterGlbBlob(character.root, character.clips),
        )
        return
      }

      if (format === 'glb-skinned') {
        // 骨骼蒙皮导出只读活跃场景（自己 clone 独立几何体），不需要像 obj/glb/glb-static
        // 那样先克隆一份可 dispose 的 exportRoot——见 export-glb.ts 的 exportSkinnedGlbBlob。
        if (!spec) throw new Error('No URDF spec available for GLB export')
        await saveGeneratedBlob(
          `${baseName}-skinned.glb`,
          'Binary glTF (skinned)',
          'model/gltf-binary',
          'glb',
          () => exportSkinnedGlbBlob(root, spec, authoredAnimation),
        )
        return
      }

      const exportRoot = cloneObject3DForExport(root)
      try {
        if (format === 'obj') {
          await saveGeneratedBlob(
            `${baseName}.obj`,
            'Wavefront OBJ',
            'text/plain',
            'obj',
            async () => {
              const { OBJExporter } = await import('three/addons/exporters/OBJExporter.js')
              const text = new OBJExporter().parse(exportRoot)
              return new Blob([text], { type: 'text/plain;charset=utf-8' })
            },
          )
          return
        }

        // 静态版只导出几何 + 材质（不需要 spec）；动画版烘关节预览轨迹（需要 spec）。
        // 文件名带 `-static` 后缀避免覆盖动画版。静态管线（无 URDF spec）下"glb"退化为
        // 几何导出——纯静态物体没有关节可烘。
        const animated = format === 'glb' && !!spec
        await saveGeneratedBlob(
          `${baseName}${animated ? '' : '-static'}.glb`,
          animated ? 'Binary glTF (animated)' : 'Binary glTF (static)',
          'model/gltf-binary',
          'glb',
          () => (animated ? exportAnimatedGlbBlob(exportRoot, spec!, authoredAnimation) : exportStaticGlbBlob(exportRoot)),
        )
      } finally {
        // 导出克隆是 root.clone(true) 的临时副本（geometry/material 在 GLB/OBJ
        // 导出路径中可能被独立分配），用完即释放，避免每次导出泄漏一棵子树。
        disposeObject3D(exportRoot)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('aborted') || msg.includes('AbortError')) return
      setErrorMessage(`Export failed: ${msg}`)
    }
  }, [getExportObject, getCharacterExport, setErrorMessage, source, spec, authoredAnimation, sourceLabel])

  return (
    <ViewerErrorBoundary>
      <div className="viewer-app">
        <Titlebar
          onResetView={resetCamera}
          onExport={handleExport}
          onScreenshot={handleScreenshot}
          canExportUrdf={source.trim().length > 0}
          canExportScene={!!spec || !!sceneSpec}
          canExportSkinned={!!spec}
          canExportCharacter={mode === 'character'}
        />
        <div className="viewer-main">
          <div className="viewer-canvas-area">
            <ViewerCanvas
              ref={containerRef}
              error={error}
              loading={loading}
              hasModel={!!spec || !!sceneSpec || !!rigSpec}
            />
            {errorMessage && (
              <div className="viewer-error-toast" role="alert">
                <span>{errorMessage}</span>
                <button
                  type="button"
                  className="viewer-error-toast-dismiss"
                  aria-label="Dismiss"
                  onClick={() => setErrorMessage(null)}
                >
                  ×
                </button>
              </div>
            )}
          </div>
          <SidePanel
            spec={spec}
            jointValues={jointValues}
            previewJointValues={previewJointValues}
            setJointValue={setJointValue}
            resetAllJoints={resetAllJoints}
            stats={stats}
          />
        </div>
      </div>
    </ViewerErrorBoundary>
  )
}

export default Viewer3DSurface
