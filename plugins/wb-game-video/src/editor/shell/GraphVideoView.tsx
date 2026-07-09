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
import { useGraphScenario } from '../persist/graphScenarioStore'
import { getGameSlug } from '../persist/gameScope'
import { ZHANDOU_VIDEOS } from '../assets/catalog'
import { listVideoAssetInfos, resolveMediaSrc, type VideoAssetInfo } from './media'
import { MaterialTimeline } from '../video/MaterialTimeline'
import {
  type MaterialItem,
  materialClass,
  materialLabel,
} from '../video/materialTimelineShared'
import { computeVideoContentRect, pointerToVideoNorm, type VideoContentRect } from '../video/videoContentRect'
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

  // 换节点 → 清选中 + 右列回到「添加控件」默认视图。
  useEffect(() => { setSelectedMaterialKey(null); setTopPanel('library') }, [selectedSceneId])

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
                    <MaterialCard title="字幕" desc="底栏对白/旁白字幕，可拖动显示时段。" disabledReason={addDisabled} onClick={() => addMaterial('subtitle')} />
                    <MaterialCard title="飘字" desc="画面上的文字/数值飘字，可选到点结算扣血。" disabledReason={addDisabled} onClick={() => addMaterial('overlay')} />
                    <MaterialCard
                      title="QTE 按键点"
                      desc="限时按键点，写入当前节点 QTE 轨；同节点多个按键点自动归入这一段 QTE（一次结算）。"
                      disabledReason={addDisabled}
                      onClick={() => addMaterial('qte')}
                    />
                    <MaterialCard title="选项" desc="添加节点选项，可切换清单或画面热区。" disabledReason={optionDisabled} onClick={() => addMaterial('option')} />
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
                onSeek={seekTo}
                onScrubStart={pauseForScrub}
                onSelectMaterial={handleSelectMaterial}
                onPatchMaterial={patchMaterial}
                onDeleteMaterial={deleteMaterial}
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

function MaterialCard({ title, desc, disabledReason, onClick }: { title: string; desc: string; disabledReason?: string; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      className={`gc-lib-item${disabledReason ? ' is-disabled' : ''}`}
      disabled={!!disabledReason}
      title={disabledReason}
      onClick={disabledReason ? undefined : onClick}
    >
      <strong>{title}</strong>
      <span>{disabledReason ?? desc}</span>
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
