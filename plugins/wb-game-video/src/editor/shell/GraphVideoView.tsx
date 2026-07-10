/**
 * GraphVideoView —— 「新引擎 › 视频」= 视频素材编辑器（UI/交互对齐旧 VideoCatalogTab）。
 *
 * 与旧视频 tab 一模一样的外壳（左栏视频库 + 中栏预览台 + 5 轨 MaterialTimeline + 右侧检视器），
 * 但**数据全程走 graph**：编辑的是 `selectedSceneId` 对应的演出节点（`node.id === scene.id`），
 * 读投影 + 写映射都在 `./video/graphMaterialOps` 上，写回 `graphScenarioStore.setGraph`。
 * 旧 VideoCatalogTab 仍被旧侧栏「视频」tab 使用、保持零 diff；这里是端口化的一份并存实现。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useGraphScenario, useGraphHistory, graphUndo, graphRedo, graphHistoryClear } from '../persist/graphScenarioStore'
import { getGameSlug } from '../persist/gameScope'
import { ZHANDOU_VIDEOS } from '../assets/catalog'
import { listVideoAssetInfos, resolveMediaSrc, type VideoAssetInfo } from './media'
import { MATERIAL_DND_MIME, MaterialTimeline } from '../video/MaterialTimeline'
import {
  type AudioItem,
  type MaterialItem,
  materialClass,
  materialLabel,
} from '../video/materialTimelineShared'
import { computeVideoContentRect, pointerToVideoNorm, type VideoContentRect } from '../video/videoContentRect'
import { registerFxKinds } from '../../runtime/registry/fx-kinds'
import { FILTER_OPTIONS, FX_OPTIONS, fxNeedsColor, resolveVideoFxRender } from '../../runtime/fx/video-fx'
import { resolveGraphTextCss } from '../text/text-css'
import { GraphTextStylePicker } from './GraphTextStylePicker'
import { injectStyleOnce } from '../../styles/injectStyle'
import { CATALOG_CSS } from './catalogCss'
import type { EntitySpec, GameGraph, GameNode, GraphTextStyle, TimelineElement } from '../../runtime/schema/graph-schema'
import type { QteCue } from '../../runtime/registry/core-kinds'
import {
  type MaterialTemplate,
  type PreviewOverlay,
  SUBTITLE_XY,
  addMaterialGraph,
  addOptionBranchGraph,
  addQteCueGraph,
  bindVideoGraph,
  choiceElement,
  collectMaterialsFromNode,
  confirmMaterialDelete,
  deleteMaterialGraph,
  findElement,
  findNode,
  listOptionBranches,
  parseDamageFromContent,
  patchMaterialGraph,
  patchOverlayGraph,
  patchOverlayPositionGraph,
  patchSelectedGraph,
  qteElement,
  qteElementOfCue,
  removeOptionBranchGraph,
  removeQteCueGraph,
  setNodePromptGraph,
  setOptionTargetGraph,
  settleDamage,
  settleElementFor,
  settleTargetKind,
  updateOptionLabelGraph,
  activePreviewOverlaysFromNode,
} from '../video/graphMaterialOps'

// 「重新生成 / 添加控件」分段控件 + 右列格子面板（与 gc-prompt 同槽切换）。
// 复用视频 tab 的 --gc-* token；不改 CatalogTabs 的全局 CSS，样式自持。
// 视频 tab 的基础栏目/预览台样式（gc-*）复用共享 CATALOG_CSS（原旧 forge/CatalogTabs 全局 CSS）。
// 注册滤镜/特效 kind（registry 全局单例 → 校验 + 运行时可见）；幂等。
registerFxKinds()

injectStyleOnce('graph-catalog', CATALOG_CSS)
injectStyleOnce(
  'graph-video-view',
  `
.gvv-toolseg { display: inline-flex; border: 1px solid var(--gc-accent-line); border-radius: 8px; overflow: hidden; }
.gvv-toolseg button { border: 0; background: var(--gc-accent-soft); color: var(--gc-muted); padding: 7px 14px; cursor: pointer; font-size: 12px; line-height: 1; }
.gvv-toolseg button + button { border-left: 1px solid var(--gc-accent-line); }
.gvv-toolseg button:hover { background: rgba(240,136,64,.24); color: var(--gc-text); }
.gvv-toolseg button.is-on { background: var(--gc-accent); color: #1a1206; font-weight: 700; }
.gvv-toolpanel { display: flex; flex-direction: column; gap: 8px; min-height: 0; overflow: auto; background: var(--gc-panel2); border: 1px solid var(--gc-line-soft); border-radius: 12px; padding: 12px; }
.gvv-toolpanel-head { color: var(--gc-faint); font-size: 11px; letter-spacing: 0.1em; }
.gvv-toolpanel .gc-lib-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.gvv-toolpanel .gc-lib-item { min-height: 84px; padding: 10px; }
.gvv-video-col { display: flex; flex-direction: column; gap: 8px; min-width: 0; min-height: 0; }
.gvv-controls { display: flex; align-items: center; gap: 10px; padding: 6px 10px; border-radius: 10px; background: var(--gc-panel2); border: 1px solid var(--gc-line-soft); flex: none; }
.gvv-controls button { flex: none; width: 32px; height: 28px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--gc-accent-line); background: var(--gc-accent-soft); color: var(--gc-text); border-radius: 7px; cursor: pointer; font-size: 13px; line-height: 1; }
.gvv-controls button:hover { background: rgba(240,136,64,.24); border-color: var(--gc-accent); }
.gvv-time { color: var(--gc-faint); font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.gvv-controls .gvv-mute { margin-left: auto; }
.gvv-head-actions { display: inline-flex; align-items: center; gap: 8px; }
.gvv-history { display: inline-flex; border: 1px solid var(--gc-line-soft); border-radius: 8px; overflow: hidden; }
.gvv-history button {
  border: 0; background: var(--gc-panel2); color: var(--gc-text);
  width: 32px; height: 30px; display: inline-flex; align-items: center; justify-content: center;
  font-size: 15px; line-height: 1; cursor: pointer;
}
.gvv-history button + button { border-left: 1px solid var(--gc-line-soft); }
.gvv-history button:hover:not(:disabled) { background: var(--gc-accent-soft); color: var(--gc-text); }
.gvv-history button:disabled { opacity: 0.36; cursor: default; }
.gvv-fx-layer { position: absolute; inset: 0; pointer-events: none; overflow: hidden; border-radius: inherit; }
.gvv-fx-layer > div { position: absolute; inset: 0; }
`,
)

interface VideoEntry {
  id: string
  label: string
  url: string
  group: string
  type?: string
  durMs?: number
}

function refForEntry(entry: VideoEntry): string {
  // demo 统一按 basename 引用；绑定即把节点 media.ref 设为该视频文件名。
  return entry.id
}

function fmtTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function GraphVideoView(): JSX.Element {
  const game = useMemo(() => getGameSlug() ?? 'game-nodia-fighting', [])
  const [assets, setAssets] = useState<VideoAssetInfo[]>([])
  const listBodyRef = useRef<HTMLDivElement | null>(null)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [selectedId, setSelectedId] = useState<string>('')
  const [contentRect, setContentRect] = useState<VideoContentRect | null>(null)
  // 右列那一格三态：库（添加控件）/ 提示词（重新生成）/ 检视器（素材属性）。
  // 选中控件→inspector；未选中→library；重新生成为另一个 tab。
  const [topPanel, setTopPanel] = useState<'library' | 'prompt' | 'inspector'>('library')
  const [selectedMaterialKey, setSelectedMaterialKey] = useState<string | null>(null)
  const [playheadMs, setPlayheadMs] = useState(0)
  const [isVideoPlaying, setIsVideoPlaying] = useState(false)
  const [isMuted, setIsMuted] = useState(true)
  const [videoDurationMs, setVideoDurationMs] = useState<number | null>(null)
  const [overlayDragId, setOverlayDragId] = useState<string | null>(null)
  // 时间轴模式：组件 / 音频（音频仅显示 + 拖动，不做实际音频编辑）。
  const [timelineMode, setTimelineMode] = useState<'material' | 'audio'>('material')
  // 音频条为本地展示态：换节点/换素材时按素材时长重建（不写回 graph）。
  const [audioItems, setAudioItems] = useState<AudioItem[]>([])

  // 撤销/重做历史深度（驱动按钮 disabled）。
  const canUndo = useGraphHistory((s) => s.pastStates.length > 0)
  const canRedo = useGraphHistory((s) => s.futureStates.length > 0)
  const loadEpoch = useGraphScenario((s) => s.loadEpoch)

  const graph = useGraphScenario((s) => s.graph)
  const setGraph = useGraphScenario((s) => s.setGraph)
  const entities = useGraphScenario((s) => s.meta.entities)
  // 选中节点来自 graph 共享 store（不再依赖旧 scenarioStore）；无选中则落到首个节点。
  const selectedNodeId = useGraphScenario((s) => s.selectedNodeId)
  const selectedSceneId = selectedNodeId ?? graph.nodes[0]?.id ?? ''

  const node = findNode(graph, selectedSceneId)

  useEffect(() => {
    let alive = true
    void listVideoAssetInfos(game).then((vs) => { if (alive) setAssets(vs) })
    return () => { alive = false }
  }, [game])

  const entries = useMemo<VideoEntry[]>(() => {
    const seen = new Set<string>()
    const clips: VideoEntry[] = []
    const narr: VideoEntry[] = []
    // 内置 bundle 视频（assets/zhandou/*.mp4）：按文件名列出，narr-* 归叙事、其余归战斗。
    for (const [id, url] of Object.entries(ZHANDOU_VIDEOS)) {
      seen.add(id)
      const isNarr = id.startsWith('narr-')
      ;(isNarr ? narr : clips).push({ id, label: id, url, group: isNarr ? '叙事' : '战斗' })
    }
    // 运行时 reel 库里的其余视频资产（与 bundle 去重）。
    for (const v of assets) {
      if (seen.has(v.id)) continue
      seen.add(v.id)
      narr.push({ id: v.id, label: v.id, url: resolveMediaSrc(v.id, game) ?? '', group: '叙事' })
    }
    return [...clips, ...narr]
  }, [assets, game])

  const boundRef = node?.data.media?.ref
  const boundBare = boundRef?.startsWith('m-') ? boundRef.slice(2) : boundRef
  const boundEntry = entries.find((e) => e.id === boundBare) ?? entries.find((e) => e.id === boundRef)
  const selectedEntry = entries.find((e) => e.id === selectedId)
  const previewEntry = selectedEntry ?? boundEntry
  const editingBoundClip = Boolean(boundEntry && previewEntry && boundEntry.id === previewEntry.id)
  const timelineEntry = editingBoundClip ? boundEntry : previewEntry
  const previewSrc = timelineEntry?.url || (timelineEntry ? resolveMediaSrc(timelineEntry.id, game) : undefined)
  const maxMs = Math.max(1000, videoDurationMs ?? timelineEntry?.durMs ?? node?.data.durationMs ?? 0)
  const hasEditableVideo = Boolean(node && editingBoundClip && timelineEntry)
  const isTimedQteNode = Boolean(qteElement(node))

  const materials = useMemo(() => collectMaterialsFromNode(node, maxMs), [node, maxMs])
  const previewOverlays = useMemo(
    () => (node && editingBoundClip ? activePreviewOverlaysFromNode(node, playheadMs, maxMs) : []),
    [node, editingBoundClip, playheadMs, maxMs],
  )
  // 滤镜/特效预览：按当前播放头解析出 filter / transform / 覆盖层，实时施加到预览视频。
  const videoFx = useMemo(
    () => (node && editingBoundClip ? resolveVideoFxRender(node, playheadMs, maxMs) : { overlays: [] }),
    [node, editingBoundClip, playheadMs, maxMs],
  )
  const selectedMaterial = materials.find((m) => m.key === selectedMaterialKey) ?? null

  // 换节点 → 左栏跟随该节点已绑定视频。
  useEffect(() => {
    if (!boundEntry) return
    setSelectedId(boundEntry.id)
    requestAnimationFrame(() => {
      listBodyRef.current?.querySelector(`[data-clip-id="${boundEntry.id}"]`)?.scrollIntoView({ block: 'nearest' })
    })
  }, [selectedSceneId, boundEntry?.id])

  useEffect(() => {
    setVideoDurationMs(null)
    setPlayheadMs(0)
    setContentRect(null)
  }, [timelineEntry?.id, selectedSceneId, editingBoundClip])

  // 换节点 → 清选中 + 右列回到「添加控件」默认视图 + 时间轴回「组件」模式。
  useEffect(() => { setSelectedMaterialKey(null); setTopPanel('library'); setTimelineMode('material') }, [selectedSceneId])

  // 载入新内容（boot / 切版本 / 重置）后清空撤销历史，避免撤销穿越到别的版本/空图。
  useEffect(() => { graphHistoryClear() }, [loadEpoch])

  // 音频条（仅显示）：编辑绑定 clip 时，用素材自带声道占满第 0 轨；否则清空。
  useEffect(() => {
    if (editingBoundClip && timelineEntry) {
      setAudioItems([{ key: 'clip-audio', label: `素材音轨 · ${timelineEntry.label}`, startMs: 0, endMs: maxMs, layer: 0, builtin: true }])
    } else {
      setAudioItems([])
    }
  }, [editingBoundClip, timelineEntry?.id, selectedSceneId, maxMs])

  // 键盘撤销/重做：Ctrl/⌘+Z 撤销，Ctrl/⌘+Shift+Z 或 Ctrl+Y 重做；在输入框内不拦截（留给原生文本撤销）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return
      const t = e.target as HTMLElement | null
      const tag = t?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || t?.isContentEditable) return
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) { e.preventDefault(); graphUndo() }
      else if ((key === 'z' && e.shiftKey) || key === 'y') { e.preventDefault(); graphRedo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const v = videoRef.current
    if (!v) { setContentRect(null); return }
    let frame = 0
    const update = (): void => {
      if (frame) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const rect = computeVideoContentRect(v)
        if (rect) setContentRect(rect)
      })
    }
    update()
    v.addEventListener('loadedmetadata', update)
    window.addEventListener('resize', update)
    const ro = new ResizeObserver(update)
    if (v.parentElement) ro.observe(v.parentElement)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      v.removeEventListener('loadedmetadata', update)
      window.removeEventListener('resize', update)
      ro.disconnect()
    }
  }, [timelineEntry?.id, editingBoundClip])

  // 播放期间 rAF 每帧推进播放头（平滑）。
  useEffect(() => {
    if (!isVideoPlaying) return
    let raf = 0
    const tick = (): void => {
      const el = videoRef.current
      if (el) setPlayheadMs(Math.max(0, Math.min(maxMs, Math.round((el.currentTime || 0) * 1000))))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [isVideoPlaying, maxMs])

  // ── graph 写入封装：始终以最新 graph re-find 节点 ──────────────────────────
  function editGraph(fn: (g: GameGraph, n: GameNode) => GameGraph): void {
    setGraph((g) => {
      const n = findNode(g, selectedSceneId)
      return n ? fn(g, n) : g
    })
  }

  function bindCurrent(): void {
    if (!node || !previewEntry) return
    editGraph((g, n) => bindVideoGraph(g, n, refForEntry(previewEntry), previewEntry.durMs ?? maxMs))
  }

  function setPrompt(next: string): void {
    editGraph((g, n) => setNodePromptGraph(g, n, next))
  }

  function patchMaterial(item: MaterialItem, patch: { startMs?: number; endMs?: number; layer?: number }): void {
    editGraph((g, n) => patchMaterialGraph(g, n, maxMs, item, patch))
  }

  // 音频条拖动（仅本地展示态；不写回 graph）。
  function patchAudio(item: AudioItem, patch: { startMs?: number; endMs?: number; layer?: number }): void {
    setAudioItems((list) =>
      list.map((a) =>
        a.key === item.key
          ? { ...a, startMs: patch.startMs ?? a.startMs, endMs: patch.endMs ?? a.endMs, layer: patch.layer ?? a.layer }
          : a,
      ),
    )
  }

  function deleteMaterial(item: MaterialItem): void {
    if (!node) return
    if (!confirmMaterialDelete(node, item)) return
    editGraph((g, n) => deleteMaterialGraph(g, n, item))
    if (selectedMaterialKey === item.key) {
      setSelectedMaterialKey(null)
      setTopPanel('library')
    }
  }

  function addMaterial(template: MaterialTemplate): void {
    if (!node) return
    const res = addMaterialGraph(graph, node, maxMs, template, entities, playheadMs)
    setGraph(res.graph)
    if (res.selectKey) setSelectedMaterialKey(res.selectKey)
    setTopPanel('inspector')
  }

  // 从素材库把控件卡片拖进时间轴 → 在落点时刻/轨新增。
  function addMaterialAt(template: string, atMs: number, layer: number): void {
    if (!node) return
    if (template !== 'subtitle' && template !== 'overlay' && template !== 'qte' && template !== 'option' && template !== 'filter' && template !== 'fx') return
    if (template === 'option' ? optionDisabled : !hasEditableVideo) return
    const res = addMaterialGraph(graph, node, maxMs, template, entities, playheadMs, { ms: atMs, layer })
    setGraph(res.graph)
    if (res.selectKey) setSelectedMaterialKey(res.selectKey)
    setTopPanel('inspector')
  }

  function addQteCue(afterCueId?: string): void {
    if (!node) return
    const res = addQteCueGraph(graph, node, maxMs, playheadMs, afterCueId)
    setGraph(res.graph)
    if (res.selectKey) setSelectedMaterialKey(res.selectKey)
  }

  function removeQteCue(cueId: string): void {
    if (!node) return
    const whole = (qteElementOfCue(node, cueId)?.params.cues as QteCue[] | undefined)?.length ?? 0
    if (whole <= 1) {
      const cueItem = materials.find((m) => m.kind === 'qte' && m.id === cueId)
      if (cueItem && !confirmMaterialDelete(node, cueItem)) return
      editGraph((g, n) => removeQteCueGraph(g, n, cueId))
      setSelectedMaterialKey(null)
      setTopPanel('library')
      return
    }
    editGraph((g, n) => removeQteCueGraph(g, n, cueId))
    if (selectedMaterialKey?.endsWith(`:${cueId}`)) {
      const rest = (qteElementOfCue(node, cueId)?.params.cues as QteCue[] | undefined)?.find((c) => c.id !== cueId)
      const el = qteElement(node)
      setSelectedMaterialKey(rest && el ? `qte:${el.id}:${rest.id}` : null)
    }
  }

  function patchSelected(patch: Record<string, unknown>): void {
    if (!node || !selectedMaterial) return
    if (selectedMaterial.kind === 'overlay') {
      editGraph((g, n) => patchOverlayGraph(g, n, selectedMaterial.id, patch, entities))
    } else {
      editGraph((g, n) => patchSelectedGraph(g, n, selectedMaterial, patch))
    }
  }

  // ── 预览叠层拖拽定位 ─────────────────────────────────────────────────────────
  function positionFromFrame(e: React.PointerEvent): { x: number; y: number } | null {
    const frame = frameRef.current
    if (!frame) return null
    return pointerToVideoNorm(e.clientX, e.clientY, frame, videoRef.current)
  }
  function moveOverlay(o: PreviewOverlay, x: number, y: number): void {
    editGraph((g, n) => patchOverlayPositionGraph(g, n, o.target, x, y))
  }
  function onOverlayPointerDown(e: React.PointerEvent<HTMLDivElement>, o: PreviewOverlay): void {
    e.preventDefault()
    e.stopPropagation()
    setSelectedMaterialKey(o.materialKey)
    setTopPanel('inspector')
    if (!o.movable) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setOverlayDragId(o.id)
    const pos = positionFromFrame(e)
    if (pos) moveOverlay(o, pos.x, pos.y)
  }
  function onOverlayPointerMove(e: React.PointerEvent<HTMLDivElement>, o: PreviewOverlay): void {
    if (overlayDragId !== o.id) return
    const pos = positionFromFrame(e)
    if (pos) moveOverlay(o, pos.x, pos.y)
  }
  function onOverlayPointerUp(): void {
    setOverlayDragId(null)
  }

  function seekTo(ms: number): void {
    const target = Math.max(0, Math.min(maxMs, Math.round(ms)))
    const v = videoRef.current
    if (v) { try { v.currentTime = target / 1000 } catch { /* metadata 未就绪 */ } }
    setPlayheadMs(target)
  }
  function pauseForScrub(): void {
    const v = videoRef.current
    if (v && !v.paused) { try { v.pause() } catch { /* ignore */ } }
  }
  function togglePlay(): void {
    const v = videoRef.current
    if (!v) return
    if (v.paused) void v.play().catch(() => { /* autoplay 限制 */ })
    else v.pause()
  }
  function toggleMute(): void {
    const v = videoRef.current
    if (!v) return
    v.muted = !v.muted
    setIsMuted(v.muted)
  }
  function handleSelectMaterial(key: string): void {
    setSelectedMaterialKey(key)
    setTopPanel('inspector')
  }

  const optionDisabled = !hasEditableVideo
    ? '当前节点未绑定视频素材'
    : isTimedQteNode
      ? 'QTE 节点请编辑「QTE 窗口」轨，不添加选项'
      : undefined
  const addDisabled = !hasEditableVideo ? '当前节点未绑定视频素材' : undefined

  const previewContentStyle: CSSProperties | undefined = contentRect
    ? { left: `${contentRect.left}px`, top: `${contentRect.top}px`, width: `${contentRect.width}px`, height: `${contentRect.height}px` }
    : undefined

  return (
    <div className="gc-tab gc-tab-video">
      <aside className="gc-list" aria-label="视频">
        <div className="gc-list-head">
          <span className="gc-list-ico" aria-hidden>🎥</span>
          <span className="gc-list-title">视频素材</span>
          <span className="gc-list-count">{entries.length}</span>
        </div>
        <div className="gc-list-body" ref={listBodyRef}>
          {entries.map((it) => (
            <button
              key={it.id}
              type="button"
              data-clip-id={it.id}
              className={`gc-row${it.id === selectedId ? ' is-on' : ''}`}
              onClick={() => setSelectedId(it.id)}
            >
              <span className="gc-row-mark" aria-hidden>{it.id === boundEntry?.id ? '✓' : ''}</span>
              <span className="gc-row-label">{it.group} · {it.label}</span>
            </button>
          ))}
        </div>
      </aside>
      <section className="gc-preview">
        {timelineEntry ? (
          <div className="gc-stage gc-stage-video">
            <div className="gc-video-head">
              <div>
                <div className="gc-video-title">{timelineEntry.label}</div>
                <div className="gc-video-sub">
                  {!node
                    ? '素材预览 · 未选中节点'
                    : editingBoundClip
                      ? `当前节点 · ${node.data.name}`
                      : boundEntry
                        ? `素材预览 · 当前节点绑定 ${boundEntry.label}`
                        : '素材预览 · 当前节点未绑定演出'}
                </div>
              </div>
              <div className="gvv-head-actions">
                <div className="gvv-history" role="group" aria-label="撤销 / 重做">
                  <button type="button" disabled={!canUndo} onClick={graphUndo} title="撤销 (Ctrl+Z)" aria-label="撤销">↶</button>
                  <button type="button" disabled={!canRedo} onClick={graphRedo} title="重做 (Ctrl+Shift+Z)" aria-label="重做">↷</button>
                </div>
                {editingBoundClip ? (
                  <div className="gvv-toolseg" role="group" aria-label="右栏内容切换">
                    <button
                      type="button"
                      className={topPanel === 'library' ? 'is-on' : ''}
                      aria-pressed={topPanel === 'library'}
                      onClick={() => setTopPanel('library')}
                    >
                      添加控件
                    </button>
                    <button
                      type="button"
                      className={topPanel === 'prompt' ? 'is-on' : ''}
                      aria-pressed={topPanel === 'prompt'}
                      onClick={() => setTopPanel('prompt')}
                    >
                      重新生成
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="gc-action"
                    onClick={() => { if (node && previewEntry) bindCurrent() }}
                  >
                    {node ? '绑定到当前节点' : '选择节点后绑定'}
                  </button>
                )}
              </div>
            </div>
            <div className="gc-video-top">
              <div className="gvv-video-col">
              <div ref={frameRef} className="gc-frame" data-type={timelineEntry.type ?? 'video'}>
                <span className="gc-badge">
                  {timelineEntry.label}
                  {timelineEntry.type ? <em>{timelineEntry.type}</em> : null}
                </span>
                <video
                  key={timelineEntry.id}
                  ref={videoRef}
                  className="gc-video"
                  src={previewSrc}
                  style={{ filter: videoFx.filter, transform: videoFx.transform }}
                  autoPlay
                  muted
                  playsInline
                  loop={timelineEntry.type === 'loop'}
                  onLoadedMetadata={(e) => {
                    const dur = e.currentTarget.duration
                    if (Number.isFinite(dur) && dur > 0) {
                      const ms = Math.round(dur * 1000)
                      setVideoDurationMs(ms)
                      if (node && editingBoundClip && node.data.durationMs !== ms) editGraph((g, n) => bindVideoGraph(g, n, n.data.media?.ref ?? '', ms))
                    }
                  }}
                  onPlay={() => setIsVideoPlaying(true)}
                  onPause={() => setIsVideoPlaying(false)}
                  onVolumeChange={(e) => setIsMuted(e.currentTarget.muted)}
                  onTimeUpdate={(e) => setPlayheadMs(Math.max(0, Math.min(maxMs, Math.round(e.currentTarget.currentTime * 1000))))}
                  onSeeked={(e) => setPlayheadMs(Math.max(0, Math.min(maxMs, Math.round(e.currentTarget.currentTime * 1000))))}
                  onEnded={() => { setIsVideoPlaying(false); setPlayheadMs(maxMs) }}
                />
                {videoFx.overlays.length > 0 ? (
                  <div className="gvv-fx-layer" aria-hidden>
                    {videoFx.overlays.map((o) => (
                      <div key={o.id} style={o.style as CSSProperties} />
                    ))}
                  </div>
                ) : null}
                <div className="gc-content-anchor" style={previewContentStyle}>
                  <div className="gc-preview-overlays">
                    {previewOverlays.map((o) => {
                      const selected = selectedMaterialKey === o.materialKey
                      return (
                        <div
                          key={o.id}
                          role="button"
                          tabIndex={0}
                          aria-label={`${materialLabel(o.kind)}：${o.label}${o.movable ? '，可拖动' : ''}`}
                          className={`gc-preview-overlay ${materialClass(o.kind)}${selected ? ' is-selected' : ''}${o.movable ? ' is-movable' : ''}`}
                          style={{ left: `${o.x * 100}%`, top: `${o.y * 100}%`, zIndex: 20 + o.layer }}
                          onPointerDown={(e) => onOverlayPointerDown(e, o)}
                          onPointerMove={(e) => onOverlayPointerMove(e, o)}
                          onPointerUp={onOverlayPointerUp}
                          onLostPointerCapture={onOverlayPointerUp}
                        >
                          {o.kind === 'qte' ? <span className="gc-preview-ring" /> : null}
                          <span
                            className="gc-preview-label"
                            style={(o.kind === 'subtitle' || o.kind === 'overlay') && o.style ? resolveGraphTextCss(o.style) : undefined}
                          >
                            {o.label}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
              <div className="gvv-controls">
                <button type="button" onClick={togglePlay} title={isVideoPlaying ? '暂停' : '播放'} aria-label={isVideoPlaying ? '暂停' : '播放'}>
                  {isVideoPlaying ? '⏸' : '▶'}
                </button>
                <span className="gvv-time">{fmtTime(playheadMs)} / {fmtTime(maxMs)}</span>
                <button type="button" className="gvv-mute" onClick={toggleMute} title={isMuted ? '取消静音' : '静音'} aria-label={isMuted ? '取消静音' : '静音'}>
                  {isMuted ? '🔇' : '🔊'}
                </button>
              </div>
              </div>
              {editingBoundClip && topPanel === 'inspector' && selectedMaterial ? (
                <div className="gvv-toolpanel">
                  <span className="gvv-toolpanel-head">素材属性</span>
                  <GraphMaterialInspector
                    node={node}
                    graph={graph}
                    item={selectedMaterial}
                    entities={entities}
                    onPatch={patchSelected}
                    onTiming={(item, start, end) => patchMaterial(item, { startMs: start, endMs: end })}
                    onAddQteCue={addQteCue}
                    onRemoveQteCue={removeQteCue}
                    onSelectQteCue={(cueId) => { const el = qteElement(node); if (el) setSelectedMaterialKey(`qte:${el.id}:${cueId}`) }}
                    onAddBranch={() => editGraph((g, n) => addOptionBranchGraph(g, n))}
                    onSetBranchLabel={(key, label) => editGraph((g, n) => updateOptionLabelGraph(g, n, key, label))}
                    onSetBranchTarget={(key, target) => editGraph((g, n) => setOptionTargetGraph(g, n, key, target))}
                    onRemoveBranch={(key) => editGraph((g, n) => removeOptionBranchGraph(g, n, key))}
                  />
                </div>
              ) : editingBoundClip && topPanel === 'library' ? (
                <div className="gvv-toolpanel">
                  <span className="gvv-toolpanel-head">添加控件</span>
                  <div className="gc-lib-grid">
                    <MaterialCard icon={ICON_SUBTITLE} title="字幕" template="subtitle" desc="底栏对白/旁白字幕，可拖动显示时段。" disabledReason={addDisabled} onClick={() => addMaterial('subtitle')} />
                    <MaterialCard icon={ICON_OVERLAY} title="飘字" template="overlay" desc="画面上的文字/数值飘字，可选到点结算扣血。" disabledReason={addDisabled} onClick={() => addMaterial('overlay')} />
                    <MaterialCard
                      icon={ICON_QTE}
                      title="QTE 按键点"
                      template="qte"
                      desc="限时按键点，写入当前节点 QTE 轨；同节点多个按键点自动归入这一段 QTE（一次结算）。"
                      disabledReason={addDisabled}
                      onClick={() => addMaterial('qte')}
                    />
                    <MaterialCard icon={ICON_OPTION} title="选项" template="option" desc="添加节点选项，可切换清单或画面热区。" disabledReason={optionDisabled} onClick={() => addMaterial('option')} />
                    <MaterialCard icon={ICON_FILTER} title="滤镜" template="filter" desc="一段时间内给画面调色（黑白/怀旧/暖冷调/鲜艳/梦幻）。" disabledReason={addDisabled} onClick={() => addMaterial('filter')} />
                    <MaterialCard icon={ICON_FX} title="特效" template="fx" desc="画面特效（闪白/染色/暗角/震屏/变焦冲击）。" disabledReason={addDisabled} onClick={() => addMaterial('fx')} />
                  </div>
                </div>
              ) : (
                <label className="gc-prompt">
                  <span>提示词</span>
                  <textarea
                    value={node?.data.media?.prompt ?? ''}
                    onChange={(e) => setPrompt(e.target.value)}
                    disabled={!node}
                    placeholder="写给视频生成模型的镜头、动作、氛围提示词"
                  />
                </label>
              )}
            </div>
            {editingBoundClip ? (
              <MaterialTimeline
                materials={materials}
                maxMs={maxMs}
                playheadMs={playheadMs}
                selectedMaterialKey={selectedMaterialKey}
                isTimedQteNode={isTimedQteNode}
                context="video"
                mode={timelineMode}
                onModeChange={setTimelineMode}
                audioItems={audioItems}
                onPatchAudio={patchAudio}
                onSeek={seekTo}
                onScrubStart={pauseForScrub}
                onSelectMaterial={handleSelectMaterial}
                onPatchMaterial={patchMaterial}
                onDeleteMaterial={deleteMaterial}
                onDropTemplate={addMaterialAt}
              />
            ) : (
              <div className="gc-readonly-note">这是素材预览。绑定到当前节点后可编辑时间轴控件。</div>
            )}
          </div>
        ) : (
          <EmptyPreview text="选择一个视频素材以预览" />
        )}
      </section>
    </div>
  )
}

// ── 检视器 ───────────────────────────────────────────────────────────────────
function GraphMaterialInspector({
  node,
  graph,
  item,
  entities,
  onPatch,
  onTiming,
  onAddQteCue,
  onRemoveQteCue,
  onSelectQteCue,
  onAddBranch,
  onSetBranchLabel,
  onSetBranchTarget,
  onRemoveBranch,
}: {
  node: GameNode | undefined
  graph: GameGraph
  item: MaterialItem | null
  entities: Record<string, EntitySpec> | undefined
  onPatch: (patch: Record<string, unknown>) => void
  onTiming: (item: MaterialItem, startMs: number, endMs: number) => void
  onAddQteCue: (afterCueId?: string) => void
  onRemoveQteCue: (cueId: string) => void
  onSelectQteCue: (cueId: string) => void
  onAddBranch: () => void
  onSetBranchLabel: (key: string, label: string) => void
  onSetBranchTarget: (key: string, target: string) => void
  onRemoveBranch: (key: string) => void
}): JSX.Element {
  if (!node || !item) {
    return <div className="gc-inspector-empty"><span>选择时间轴上的素材以编辑属性</span></div>
  }
  const el = item.kind === 'qte' ? qteElementOfCue(node, item.id) : findElement(node, item.id)
  const params = (el?.params ?? {}) as Record<string, unknown>
  const cue = item.kind === 'qte' ? (el?.params.cues as QteCue[] | undefined)?.find((c) => c.id === item.id) : undefined
  const settle = item.kind === 'overlay' ? settleElementFor(node, item.id) : undefined
  const cues = item.kind === 'qte' ? ((el?.params.cues as QteCue[] | undefined) ?? []) : []
  const branches = item.kind === 'option' ? listOptionBranches(graph, node) : []
  const nodeOptions = graph.nodes.filter((n) => n.id !== node.id)
  const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')

  return (
    <div className="gc-inspector-card">
      <div className="gc-inspector-title">{materialLabel(item.kind)}</div>
      <div className="gc-field-row">
        <label>
          <span>开始</span>
          <input type="number" value={item.startMs} onChange={(e) => onTiming(item, Number(e.target.value), item.endMs)} />
        </label>
        <label>
          <span>结束</span>
          <input type="number" value={item.endMs} onChange={(e) => onTiming(item, item.startMs, Number(e.target.value))} />
        </label>
      </div>

      {item.kind === 'subtitle' && el && (
        <>
          <label className="gc-field"><span>文本</span>
            <input value={str(params.text)} onChange={(e) => onPatch({ text: e.target.value })} />
          </label>
          <div className="gc-field"><span>样式预设</span>
            <GraphTextStylePicker group="subtitle" value={params.style as GraphTextStyle | undefined} onChange={(style) => onPatch({ style })} />
          </div>
          <label className="gc-tsp-check">
            <input type="checkbox" checked={params.speaker != null} onChange={(e) => onPatch(e.target.checked ? { speaker: '' } : { speaker: undefined })} />
            <span>显示说话人前缀</span>
          </label>
          {params.speaker != null && (
            <label className="gc-field"><span>说话人</span>
              <input value={str(params.speaker)} onChange={(e) => onPatch({ speaker: e.target.value })} />
            </label>
          )}
          <div className="gc-field-row">
            <label><span>X {num(params.x, SUBTITLE_XY.x).toFixed(2)}</span>
              <input type="range" min={0} max={1} step={0.01} value={num(params.x, SUBTITLE_XY.x)} onChange={(e) => onPatch({ x: Number(e.target.value) })} />
            </label>
            <label><span>Y {num(params.y, SUBTITLE_XY.y).toFixed(2)}</span>
              <input type="range" min={0} max={1} step={0.01} value={num(params.y, SUBTITLE_XY.y)} onChange={(e) => onPatch({ y: Number(e.target.value) })} />
            </label>
          </div>
          <button type="button" className="gc-tsp-toggle" onClick={() => onPatch({ x: undefined, y: undefined })}>归位到默认位置（底部居中）</button>
        </>
      )}

      {item.kind === 'overlay' && el && (
        <>
          <label className="gc-field"><span>内容</span>
            <input value={str(params.text)} placeholder="文字 / 数值" onChange={(e) => onPatch({ content: e.target.value })} />
          </label>
          <div className="gc-field"><span>样式预设</span>
            <GraphTextStylePicker group="overlay" value={params.style as GraphTextStyle | undefined} onChange={(style) => onPatch({ style })} />
          </div>
          <label className="gc-tsp-check">
            <input type="checkbox" checked={!!settle} onChange={(e) => onPatch({ settlementOn: e.target.checked })} />
            <span>启用结算（到点扣血）</span>
          </label>
          {settle && (
            <>
              <label className="gc-field"><span>结算目标</span>
                <select value={settleTargetKind(settle, entities)} onChange={(e) => onPatch({ effectTarget: e.target.value })}>
                  <option value="boss">Boss</option>
                  <option value="player">玩家</option>
                </select>
              </label>
              <div className="gc-readonly-note">
                {parseDamageFromContent(str(params.text)) > 0
                  ? `解析伤害：${parseDamageFromContent(str(params.text))}（取自内容）`
                  : `解析伤害：${settleDamage(settle)}（内容无数字时保留）`}
              </div>
            </>
          )}
          <div className="gc-field-row">
            <label><span>X%</span>
              <input type="number" value={Math.round(num(params.x, 0.5) * 100)} onChange={(e) => onPatch({ x: Number(e.target.value) / 100 })} />
            </label>
            <label><span>Y%</span>
              <input type="number" value={Math.round(num(params.y, 0.42) * 100)} onChange={(e) => onPatch({ y: Number(e.target.value) / 100 })} />
            </label>
          </div>
        </>
      )}

      {item.kind === 'qte' && cue && el && (
        <>
          <div className="gc-qte-cues-head">
            <span>按键点 · {cues.length}</span>
            <button type="button" className="gc-mini-action" onClick={() => onAddQteCue(cue.id)}>+ 添加按键点</button>
          </div>
          <div className="gc-qte-cue-list">
            {cues.map((c, i) => (
              <button
                key={c.id}
                type="button"
                className={`gc-qte-cue-chip${c.id === cue.id ? ' is-on' : ''}`}
                onClick={() => onSelectQteCue(c.id)}
                onDoubleClick={() => onRemoveQteCue(c.id)}
                title="双击删除该按键点"
              >
                {i + 1}. {c.triggerKey || c.label || c.shape}
              </button>
            ))}
          </div>
          <label className="gc-field"><span>标签</span>
            <input value={cue.label ?? ''} onChange={(e) => onPatch({ label: e.target.value || undefined })} />
          </label>
          <p className="gc-inspector-hint">出现=提示出现（左缘）· 命中=最佳判定时刻（计分锚点，菱形）· 消失=提示撤离（右缘）。三者也可在时间轴上直接拖。</p>
          <div className="gc-field-row">
            <label><span>出现 ms</span>
              <input type="number" min={0} step={100} value={cue.appearAt ?? 0}
                onChange={(e) => onPatch({ appearAt: Math.max(0, Number(e.target.value) || 0) })} />
            </label>
            <label><span>命中 ms</span>
              <input type="number" min={0} step={100} value={cue.targetAt ?? ''} placeholder="命中锚点"
                onChange={(e) => onPatch({ targetAt: e.target.value === '' ? undefined : Number(e.target.value) })} />
            </label>
            <label><span>消失 ms</span>
              <input type="number" min={0} step={100} value={cue.endAt ?? ''} placeholder="自动"
                onChange={(e) => onPatch({ endAt: e.target.value === '' ? undefined : Number(e.target.value) })} />
            </label>
          </div>
          <label className="gc-field"><span>触发键</span>
            <select value={cue.triggerKey ?? ''} onChange={(e) => onPatch({ triggerKey: e.target.value || undefined })}>
              <option value="">默认（空格 / Enter / 点击）</option>
              <option value="Space">Space</option>
              <option value="Enter">Enter</option>
              <option value="KeyA">A</option>
              <option value="KeyD">D</option>
              <option value="KeyW">W</option>
              <option value="KeyS">S</option>
              <option value="ArrowLeft">←</option>
              <option value="ArrowRight">→</option>
              <option value="ArrowUp">↑</option>
              <option value="ArrowDown">↓</option>
            </select>
          </label>
          <label className="gc-field"><span>形态</span>
            <select value={cue.shape ?? 'tap'} onChange={(e) => onPatch({ shape: e.target.value })}>
              <option value="tap">Tap</option>
              <option value="hold">Hold</option>
              <option value="sweep">Sweep</option>
            </select>
          </label>
          {cue.shape === 'hold' && (
            <label className="gc-field"><span>按住时长 ms</span>
              <input type="number" min={100} value={cue.durationMs ?? 500} onChange={(e) => onPatch({ durationMs: Math.max(100, Number(e.target.value) || 500) })} />
            </label>
          )}
          {cue.shape === 'sweep' && (
            <label className="gc-field"><span>滑动方向</span>
              <select value={cue.sweepDir ?? 'right'} onChange={(e) => onPatch({ sweepDir: e.target.value })}>
                <option value="left">左</option><option value="right">右</option><option value="up">上</option><option value="down">下</option>
              </select>
            </label>
          )}
          <button type="button" className="gc-mini-danger" onClick={() => onRemoveQteCue(cue.id)}>删除当前按键点</button>
        </>
      )}

      {item.kind === 'filter' && el && (
        <>
          <p className="gc-inspector-hint">在这段时间内给整帧画面调色，强度 0=原图、1=最强。效果在上方预览实时可见。</p>
          <label className="gc-field"><span>滤镜</span>
            <select value={str(params.filter) || 'warm'} onChange={(e) => onPatch({ filter: e.target.value })}>
              {FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label><span>强度 {num(params.intensity, 1).toFixed(2)}</span>
            <input type="range" min={0} max={1} step={0.05} value={num(params.intensity, 1)} onChange={(e) => onPatch({ intensity: Number(e.target.value) })} />
          </label>
        </>
      )}

      {item.kind === 'fx' && el && (
        <>
          <p className="gc-inspector-hint">画面特效叠加在视频上，强度 0~1。效果在上方预览实时可见。</p>
          <label className="gc-field"><span>特效</span>
            <select value={str(params.fx) || 'flash'} onChange={(e) => onPatch({ fx: e.target.value })}>
              {FX_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label><span>强度 {num(params.intensity, 1).toFixed(2)}</span>
            <input type="range" min={0} max={1} step={0.05} value={num(params.intensity, 1)} onChange={(e) => onPatch({ intensity: Number(e.target.value) })} />
          </label>
          {fxNeedsColor(str(params.fx) || 'flash') && (
            <label className="gc-field"><span>颜色</span>
              <input type="color" value={str(params.color) || '#ffffff'} onChange={(e) => onPatch({ color: e.target.value })} />
            </label>
          )}
        </>
      )}

      {item.kind === 'option' && el && (
        <>
          <label className="gc-field"><span>提示文案</span>
            <input value={str(params.prompt)} onChange={(e) => onPatch({ prompt: e.target.value || undefined })} />
          </label>
          <label className="gc-field"><span>呈现</span>
            <select value={str(params.presentation) || 'list'} onChange={(e) => onPatch({ presentation: e.target.value })}>
              <option value="list">清单</option>
              <option value="hotspot">画面热区</option>
            </select>
          </label>
          <label className="gc-field"><span>选完跳转</span>
            <select value={str(params.fireAt) || 'on_pick'} onChange={(e) => onPatch({ fireAt: e.target.value })}>
              <option value="on_pick">立即</option>
              <option value="video_end">等视频结束</option>
            </select>
          </label>
          <label className="gc-field"><span>倒计时 ms（0=不限时）</span>
            <input type="number" min={0} step={100} value={num(params.timeoutMs, 0) || ''} placeholder="不限时"
              onChange={(e) => onPatch({ timeoutMs: e.target.value === '' ? undefined : Number(e.target.value) })} />
          </label>
          <div className="gc-inspector-subhead">
            <span>选项分支</span>
            <span className="gc-inspector-subhint">{branches.length} 条 · 文案 / 目标（改这里会同步蓝图连接）</span>
          </div>
          {branches.map((b) => (
            <div key={b.key} className="gc-branch-row" style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
              <input style={{ flex: 1 }} value={b.label} onChange={(e) => onSetBranchLabel(b.key, e.target.value)} placeholder="选项文案" />
              <select value={b.targetId ?? ''} onChange={(e) => onSetBranchTarget(b.key, e.target.value)}>
                <option value="" disabled>跳转到…</option>
                {nodeOptions.map((n) => <option key={n.id} value={n.id}>{n.data.name || n.id}</option>)}
              </select>
              <button type="button" className="gc-mini-danger" onClick={() => onRemoveBranch(b.key)}>×</button>
            </div>
          ))}
          <button type="button" className="gc-add-branch-btn" onClick={onAddBranch}>＋ 添加选项</button>
        </>
      )}
    </div>
  )
}

const ICON_SUBTITLE = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="M6.5 11.5 h3 M11.5 11.5 h6 M6.5 14.5 h6.5 M15 14.5 h2.5" />
  </svg>
)

const ICON_OVERLAY = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 3.6 13.7 9 19.1 10.7 13.7 12.4 12 17.8 10.3 12.4 4.9 10.7 10.3 9 Z" />
    <circle cx="18.7" cy="5.3" r="1.05" />
    <circle cx="5.4" cy="17" r="1.05" />
  </svg>
)

const ICON_QTE = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="7.4" />
    <circle cx="12" cy="12" r="3" />
    <path d="M12 1.8 v2.6 M12 19.6 v2.6 M1.8 12 h2.6 M19.6 12 h2.6" />
  </svg>
)

const ICON_OPTION = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="5.2" cy="12" r="2.2" />
    <circle cx="18.6" cy="5.6" r="2.2" />
    <circle cx="18.6" cy="18.4" r="2.2" />
    <path d="M7.3 11 C 11.2 9.4, 13.2 7.4, 16.5 6.2" />
    <path d="M7.3 13 C 11.2 14.6, 13.2 16.6, 16.5 17.8" />
  </svg>
)

const ICON_FILTER = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="9" cy="9" r="5" />
    <circle cx="15" cy="15" r="5" />
  </svg>
)

const ICON_FX = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 2.5 14 8.4 20 10 14.6 12.3 12 18 9.4 12.3 4 10 10 8.4 Z" />
    <path d="M18.5 3 v3 M20 4.5 h-3 M5 16 v2.6 M6.3 17.3 H3.7" />
  </svg>
)

function MaterialCard({
  icon,
  title,
  desc,
  template,
  disabledReason,
  onClick,
}: {
  icon: JSX.Element
  title: string
  desc: string
  template: MaterialTemplate
  disabledReason?: string
  onClick: () => void
}): JSX.Element {
  const enabled = !disabledReason
  return (
    <button
      type="button"
      className={`gc-lib-item${disabledReason ? ' is-disabled' : ''}`}
      disabled={!enabled}
      title={disabledReason ?? `${desc}（点击添加，或按住拖入时间轴落点）`}
      draggable={enabled}
      onClick={enabled ? onClick : undefined}
      onDragStart={
        enabled
          ? (e) => {
              e.dataTransfer.setData(MATERIAL_DND_MIME, template)
              e.dataTransfer.effectAllowed = 'copy'
            }
          : undefined
      }
    >
      <span className="gc-lib-ico">{icon}</span>
      <strong>{title}</strong>
    </button>
  )
}

function EmptyPreview({ text }: { text: string }): JSX.Element {
  return (
    <div className="gc-stage gc-empty-preview">
      <div className="gc-empty-note">{text}</div>
    </div>
  )
}
