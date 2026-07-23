/**
 * NodePreviewStage —— 蓝图节点配置面板左侧的「演出预览台」（编辑 + 预览二合一）。
 *
 * 复用视频 tab（GraphVideoView）预览台的全部底层件，数据全程走 graph，不引入任何
 * schema/协议新字段：
 *   - 视频舞台：`gc-frame` / `computeVideoContentRect` 锚定 object-fit:contain 实际画面；
 *   - 皮肤层：`previewSkinChildrenInWindow` + `renderOverlayChildPreview` + PreviewClock
 *     （暂停冻结 CSS 动画）；滤镜/特效走 `resolveVideoFxForNode` 旁路；
 *   - 叠层手柄：`activePreviewOverlaysFromNode`，可拖即写回 `patchOverlayPositionGraph`（x/y）；
 *   - 时间轴：`MaterialTimeline` 全交互（拖动/改边/换轨/删除/落点新增），写回
 *     `patchMaterialGraph` / `deleteMaterialGraph` / `addMaterialGraph`；
 *   - 「添加控件」条：六个默认样式槽（DEFAULT_STYLE_SLOTS），点击落在播放头、可拖入时间轴落点。
 *
 * 与视频 tab 的两点刻意差异：
 *   1. 切换视频/挂载/组件参数的联动**不在这里写**——右侧 NodeInspector 表单走既有
 *      `patchData → onChange → store` 数据流，本组件只是多一个订阅者，天然实时；
 *   2. 不自动回写 `durationMs`（视频 tab 会在 metadata 就绪后 bindVideoGraph 回写真实长度）——
 *      蓝图面板只是「看」节点，不因为点击选中就脏草稿；`durationMs` 截断只影响本地播放头与
 *      时间轴上限（对齐 `videoDurationCapReached` 契约：>0 且 ≤ 视频长度才生效）。
 */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Entity, GameNode, GameScenario } from '../../runtime/schema/graph-schema'
import type { SkinCtx } from '../../runtime/component-host/rendererRegistry'
import { initState } from '../../runtime/engine/engine-init'
import { bootEditorSkins } from '../init'
import { injectStyleOnce } from '../../styles/injectStyle'
import { createCoreSkinRegistry } from '../../runtime/component-host/components'
import { resolveVideoFxForNode } from '../../runtime/fx/video-fx'
import { CATALOG_CSS } from './catalogCss'
import { renderOverlayChildPreview } from './overlayChildPreview'
import { PreviewClockProvider, previewClockLayerClassName } from './previewClock'
import { resolveMediaSrc, videoDurationCapReached } from './media'
import { resolveGraphTextCss } from '../text/text-css'
import { MATERIAL_DND_MIME, MaterialTimeline } from '../video/MaterialTimeline'
import { materialClass, materialLabel, type MaterialItem } from '../video/materialTimelineShared'
import { pointerToVideoNorm } from '../video/videoContentRect'
import { useVideoContentRect } from '../video/useVideoContentRect'
import { DEFAULT_STYLE_SLOTS, type DefaultStyleSlot } from './defaultStyleSlots'
import {
  activePreviewOverlaysFromNode,
  addMaterialGraph,
  collectMaterialsFromNode,
  confirmMaterialDelete,
  deleteMaterialGraph,
  patchMaterialGraph,
  patchOverlayPositionGraph,
  previewSkinChildrenInWindow,
  qteElement,
  type MaterialTemplate,
  type PreviewOverlay,
} from '../video/graphMaterialOps'

/**
 * `--gc-*` 变量在 CATALOG_CSS 里挂 `.gc-tab` 作用域（GraphVideoView 外壳）；
 * 蓝图面板没有 gc-tab 祖先，这里自持一份同值变量，保证 gc-frame/gc-preview-* 类渲染一致。
 */
const NPS_CSS = `
.nps-root {
  --gc-bg: var(--work, #0e0c09);
  --gc-panel: var(--panel, #1b1713);
  --gc-panel2: var(--panel2, #252019);
  --gc-panel3: var(--panel3, #2f2923);
  --gc-line: var(--line, #403830);
  --gc-line-soft: var(--line-soft, #2e2924);
  --gc-text: var(--txt, #f6f1e9);
  --gc-muted: var(--muted, #b8aea0);
  --gc-faint: var(--faint, #8c8377);
  --gc-accent: var(--accent, #f08840);
  --gc-accent-soft: var(--accent-soft, rgba(240,136,64,.16));
  --gc-accent-line: var(--accent-line, rgba(240,136,64,.42));
  display: flex; flex-direction: column; gap: 8px;
  padding: 10px; min-height: 0; overflow-y: auto; flex: 1;
}
.nps-frame { flex: none; }
.nps-frame .gc-badge { top: 8px; left: 8px; padding: 3px 9px; font-size: 11px; border-radius: 7px; }
.nps-stage-empty {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 4px;
  color: rgba(246,241,233,.45); font-size: 11px; pointer-events: none; padding: 0 16px; text-align: center;
}
.nps-controls {
  display: flex; align-items: center; gap: 10px; padding: 5px 10px; border-radius: 9px;
  background: var(--gc-panel2); border: 1px solid var(--gc-line-soft); flex: none;
}
.nps-controls button {
  flex: none; width: 30px; height: 26px; display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid var(--gc-accent-line); background: var(--gc-accent-soft); color: var(--gc-text);
  border-radius: 7px; cursor: pointer; font-size: 12px; line-height: 1;
}
.nps-controls button:hover { background: rgba(240,136,64,.24); border-color: var(--gc-accent); }
.nps-time { color: var(--gc-faint); font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.nps-controls .nps-mute { margin-left: auto; }
.nps-fx-layer { position: absolute; inset: 0; pointer-events: none; overflow: hidden; border-radius: inherit; }
.nps-fx-layer > div { position: absolute; inset: 0; }
.nps-addbar { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; flex: none; }
.nps-addbar-label { font-size: 10px; letter-spacing: .08em; color: var(--gc-faint); margin-right: 2px; }
.nps-addbar button {
  display: inline-flex; align-items: center; gap: 4px;
  border: 1px solid var(--gc-line-soft); background: var(--gc-panel2); color: var(--gc-text);
  border-radius: 7px; padding: 3px 8px; font-size: 11px; cursor: pointer;
}
.nps-addbar button svg { width: 13px; height: 13px; }
.nps-addbar button:hover:not(:disabled) { border-color: var(--gc-accent); background: var(--gc-accent-soft); }
.nps-addbar button:disabled { opacity: .38; cursor: default; }
.nps-root .mtl-root { flex: none; }
`

function fmtTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function NodePreviewStage({
  scenario,
  node,
  game,
  entities,
  onEditScenario,
}: {
  /** 读投影场景：canvasGraph（主图或下钻包图）+ ui.overlays + entities/variables。 */
  scenario: GameScenario
  /** 当前选中节点（canvasGraph 内；随编辑实时换引用）。 */
  node: GameNode
  game: string
  /** 「添加控件」给新组件填初始绑定用（同视频 tab addMaterialGraph 的 entities 入参）。 */
  entities?: Record<string, Entity>
  /** 写回通道：主图走 setScenario，子蓝图下钻由上层分流到包图（见 GraphStudio）。 */
  onEditScenario: (fn: (s: GameScenario, n: GameNode) => GameScenario) => void
}): JSX.Element {
  bootEditorSkins()
  injectStyleOnce('graph-catalog', CATALOG_CSS)
  injectStyleOnce('node-preview-stage', NPS_CSS)

  const frameRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [playheadMs, setPlayheadMs] = useState(0)
  const [isVideoPlaying, setIsVideoPlaying] = useState(false)
  const [isMuted, setIsMuted] = useState(true)
  const [videoDurationMs, setVideoDurationMs] = useState<number | null>(null)
  // 拖拽 id 用 ref 不用 state：pointerdown 后同帧的 pointermove 不能等 React 重渲染，否则首段位移被丢。
  const overlayDragIdRef = useRef<string | null>(null)
  const [selectedMaterialKey, setSelectedMaterialKey] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)

  const mediaRef = node.data.media?.ref ?? ''
  const playMode = node.data.mediaPlayMode ?? 'once'
  const previewSrc = resolveMediaSrc(mediaRef || undefined, game)
  const { contentRect, recomputeRect } = useVideoContentRect(videoRef, [mediaRef, node.id])

  // 播放时长上限（cap）：对齐 videoDurationCapReached 契约——>0 且 ≤ 视频本身长度才生效。
  const capMs = (() => {
    const cap = node.data.durationMs
    if (!cap || cap <= 0) return undefined
    if (videoDurationMs != null && cap > videoDurationMs) return undefined
    return cap
  })()
  const maxMs = Math.max(1000, capMs ?? videoDurationMs ?? 0)

  const overlays = scenario.ui?.overlays
  const materials = useMemo(() => collectMaterialsFromNode(scenario, node, maxMs), [scenario, node, maxMs])
  const isTimedQteNode = Boolean(qteElement(scenario, node))
  const previewSkinChildren = useMemo(
    () => previewSkinChildrenInWindow(scenario, node, playheadMs, maxMs),
    [scenario, node, playheadMs, maxMs],
  )
  const previewOverlays = useMemo(
    () => activePreviewOverlaysFromNode(scenario, node, playheadMs, maxMs),
    [scenario, node, playheadMs, maxMs],
  )
  const videoFx = useMemo(
    () => resolveVideoFxForNode(node, overlays, playheadMs, maxMs),
    [node, overlays, playheadMs, maxMs],
  )
  // 与视频 tab / 界面 tab 同源：完整皮肤表，不依赖 default 单例是否被 HMR 冲掉。
  const previewSkinReg = useMemo(() => createCoreSkinRegistry(), [])
  const previewSkinCtx = useMemo((): SkinCtx => {
    const st = initState(scenario)
    const toHudEnt = (attrs: Record<string, number>, attrMeta?: Record<string, { max?: number }>) => {
      const attrMax: Record<string, number> = {}
      for (const [k, v] of Object.entries(attrs)) attrMax[k] = attrMeta?.[k]?.max ?? v
      return { hp: attrs.hp ?? 0, maxHp: attrMeta?.hp?.max ?? attrs.hp ?? 0, attrs: { ...attrs }, attrMax }
    }
    const hudEntities: SkinCtx['hud']['entities'] = Object.fromEntries(
      Object.entries(st.entities).map(([id, e]) => [id, toHudEnt(e.attrs, e.attrMeta)]),
    )
    // 与目录预览一致：缺实体时给常见战斗 id 兜底，避免血条 bind 后渲成 null。
    if (!hudEntities['ent-player']) hudEntities['ent-player'] = toHudEnt({ hp: 72 }, { hp: { max: 100 } })
    if (!hudEntities['ent-boss']) hudEntities['ent-boss'] = toHudEnt({ hp: 58 }, { hp: { max: 100 } })
    return {
      hud: { entities: hudEntities, vars: { qi: 3, ...st.vars }, score: st.score, flags: st.flags },
      // 编辑器预览：用初始态做门控求值（无 visited）
      condition: { state: st, visited: new Set<string>() },
    }
  }, [scenario])
  const skinnedPreviewIds = useMemo(() => new Set(previewSkinChildren.map((c) => c.id)), [previewSkinChildren])
  const previewClockValue = useMemo(() => ({ playing: isVideoPlaying, playheadMs }), [isVideoPlaying, playheadMs])

  // 换节点/换视频：清播放态与选中（视频因 key 变化 remount 自动重播）。
  useEffect(() => {
    setPlayheadMs(0)
    setVideoDurationMs(null)
    setLoadError(false)
    setSelectedMaterialKey(null)
    overlayDragIdRef.current = null
  }, [node.id, mediaRef])

  // 播放期间 rAF 每帧推进播放头（平滑）；到 cap 提前收演出（once 语义，loop 不截断）。
  useEffect(() => {
    if (!isVideoPlaying) return
    let raf = 0
    const tick = (): void => {
      const el = videoRef.current
      if (el) {
        const nowMs = Math.round((el.currentTime || 0) * 1000)
        if (playMode !== 'loop' && videoDurationCapReached(nowMs, node.data.durationMs, el.duration)) {
          try { el.pause() } catch { /* ignore */ }
          setIsVideoPlaying(false)
          setPlayheadMs(capMs ?? maxMs)
          return
        }
        setPlayheadMs(Math.max(0, Math.min(maxMs, nowMs)))
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [isVideoPlaying, maxMs, capMs, playMode, node.data.durationMs])

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
    if (v.paused) {
      // 已播到末尾再点播放 = 从头重播。
      if (playheadMs >= maxMs - 40) seekTo(0)
      void v.play().catch(() => { /* autoplay 限制 */ })
    } else {
      v.pause()
    }
  }
  function toggleMute(): void {
    const v = videoRef.current
    if (!v) return
    v.muted = !v.muted
    setIsMuted(v.muted)
  }

  // ── 写回（全部走 graphMaterialOps 既有映射，无新协议字段） ─────────────────
  function patchMaterial(item: MaterialItem, patch: { startMs?: number; endMs?: number; zIndex?: number; markerMs?: number }): void {
    onEditScenario((s, n) => patchMaterialGraph(s, n, maxMs, item, patch))
  }
  function deleteMaterial(item: MaterialItem): void {
    if (!confirmMaterialDelete(scenario, node, item)) return
    onEditScenario((s, n) => deleteMaterialGraph(s, n, item))
    if (selectedMaterialKey === item.key) setSelectedMaterialKey(null)
  }
  function addMaterial(template: MaterialTemplate): void {
    const res = addMaterialGraph(scenario, node, maxMs, template, entities, playheadMs)
    onEditScenario(() => res.scenario)
    if (res.selectKey) setSelectedMaterialKey(res.selectKey)
  }
  function addMaterialAt(template: string, atMs: number, zIndex: number): void {
    const res = addMaterialGraph(scenario, node, maxMs, template, entities, playheadMs, { ms: atMs, zIndex })
    onEditScenario(() => res.scenario)
    if (res.selectKey) setSelectedMaterialKey(res.selectKey)
  }

  // ── 预览叠层拖拽定位（写回 inputs.x/y 或 cue.x/y） ─────────────────────────
  function positionFromFrame(e: React.PointerEvent): { x: number; y: number } | null {
    const frame = frameRef.current
    if (!frame) return null
    return pointerToVideoNorm(e.clientX, e.clientY, frame, videoRef.current)
  }
  function moveOverlay(o: PreviewOverlay, x: number, y: number): void {
    onEditScenario((s, n) => patchOverlayPositionGraph(s, n, o.target, x, y))
  }
  function onOverlayPointerDown(e: React.PointerEvent<HTMLDivElement>, o: PreviewOverlay): void {
    e.preventDefault()
    e.stopPropagation()
    setSelectedMaterialKey(o.materialKey)
    if (!o.movable) return
    e.currentTarget.setPointerCapture(e.pointerId)
    overlayDragIdRef.current = o.id
    const pos = positionFromFrame(e)
    if (pos) moveOverlay(o, pos.x, pos.y)
  }
  function onOverlayPointerMove(e: React.PointerEvent<HTMLDivElement>, o: PreviewOverlay): void {
    if (overlayDragIdRef.current !== o.id) return
    const pos = positionFromFrame(e)
    if (pos) moveOverlay(o, pos.x, pos.y)
  }
  function onOverlayPointerUp(): void {
    overlayDragIdRef.current = null
  }

  // 「添加控件」六槽禁用判断（对齐视频 tab：未绑视频全禁；QTE 节点禁选项）。
  const hasBoundVideo = Boolean(mediaRef && previewSrc)
  const addDisabled = !hasBoundVideo ? '当前节点未绑定视频素材' : undefined
  const slotDisabledReason: Record<DefaultStyleSlot['id'], string | undefined> = {
    subtitle: addDisabled,
    overlay: addDisabled,
    qte: addDisabled,
    option: addDisabled ?? (isTimedQteNode ? 'QTE 节点请编辑「QTE 窗口」轨，不添加选项' : undefined),
    filter: addDisabled,
    fx: addDisabled,
  }

  const previewContentStyle: CSSProperties | undefined = contentRect
    ? { left: `${contentRect.left}px`, top: `${contentRect.top}px`, width: `${contentRect.width}px`, height: `${contentRect.height}px` }
    : undefined

  return (
    <div className="nps-root">
      <div ref={frameRef} className="gc-frame nps-frame" data-type="video">
        <span className="gc-badge">
          {mediaRef || '未绑定视频'}
          {playMode === 'loop' ? <em>循环</em> : null}
        </span>
        {previewSrc && !loadError ? (
          <video
            key={`${node.id}:${mediaRef}`}
            ref={videoRef}
            className="gc-video"
            src={previewSrc}
            style={{ filter: videoFx.filter, transform: videoFx.transform }}
            autoPlay
            muted
            playsInline
            loop={playMode === 'loop'}
            onLoadedMetadata={(e) => {
              const dur = e.currentTarget.duration
              if (Number.isFinite(dur) && dur > 0) setVideoDurationMs(Math.round(dur * 1000))
              recomputeRect()
            }}
            onPlay={() => setIsVideoPlaying(true)}
            onPause={() => setIsVideoPlaying(false)}
            onVolumeChange={(e) => setIsMuted(e.currentTarget.muted)}
            onSeeked={(e) => setPlayheadMs(Math.max(0, Math.min(maxMs, Math.round(e.currentTarget.currentTime * 1000))))}
            onEnded={() => { setIsVideoPlaying(false); setPlayheadMs(maxMs) }}
            onError={() => { setLoadError(true); setIsVideoPlaying(false) }}
          />
        ) : (
          <div className="nps-stage-empty">
            <span>{loadError ? '视频素材未就绪（生成中 / 加载失败）' : '未绑定演出视频'}</span>
            <span style={{ opacity: 0.7 }}>覆盖物仍可预览排布；绑定视频后实时联动画面的内容与时长</span>
          </div>
        )}
        {videoFx.overlays.length > 0 ? (
          <div className="nps-fx-layer" aria-hidden>
            {videoFx.overlays.map((o) => (
              <div key={o.id} style={o.style as CSSProperties} />
            ))}
          </div>
        ) : null}
        <div className="gc-content-anchor" style={previewContentStyle}>
          <div className="gc-preview-overlays">
            {previewSkinChildren.length > 0 ? (
              <PreviewClockProvider value={previewClockValue}>
                <div className={`gc-preview-skin-layer ${previewClockLayerClassName(isVideoPlaying)}`} aria-hidden>
                  {previewSkinChildren.map((child) => (
                    // 尺寸/位置盒子已在 renderOverlayChildPreview 内部按 childWrapStyle 换算好，不再套 inset:0。
                    <Fragment key={child.id}>
                      {renderOverlayChildPreview(child, previewSkinReg, previewSkinCtx, playheadMs)}
                    </Fragment>
                  ))}
                </div>
              </PreviewClockProvider>
            ) : null}
            {previewOverlays.map((o) => {
              const selected = selectedMaterialKey === o.materialKey
              const elId = o.target.kind === 'element'
                ? o.target.elementId
                : o.target.kind === 'qteCue'
                  ? o.target.elementId
                  : ''
              const skinned = !!elId && skinnedPreviewIds.has(elId)
              return (
                <div
                  key={o.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`${materialLabel(o.kind)}：${o.label}${o.movable ? '，可拖动' : ''}`}
                  className={`gc-preview-overlay ${materialClass(o.kind)}${selected ? ' is-selected' : ''}${o.movable ? ' is-movable' : ''}${skinned ? ' is-skinned' : ''}`}
                  style={{ left: `${o.x * 100}%`, top: `${o.y * 100}%`, zIndex: skinned ? 30 : 20 + o.zIndex }}
                  onPointerDown={(e) => onOverlayPointerDown(e, o)}
                  onPointerMove={(e) => onOverlayPointerMove(e, o)}
                  onPointerUp={onOverlayPointerUp}
                  onLostPointerCapture={onOverlayPointerUp}
                >
                  {o.kind === 'qte' || (skinned && o.movable) ? <span className="gc-preview-ring" /> : null}
                  <span
                    className="gc-preview-label"
                    style={(o.kind === 'subtitle' || o.kind === 'overlay') && o.style ? resolveGraphTextCss(o.style) : undefined}
                  >
                    {o.label}
                  </span>
                  {o.detail ? <span className="gc-preview-detail">{o.detail}</span> : null}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="nps-controls">
        <button type="button" onClick={togglePlay} title={isVideoPlaying ? '暂停' : '播放'} aria-label={isVideoPlaying ? '暂停' : '播放'}>
          {isVideoPlaying ? '⏸' : '▶'}
        </button>
        <span className="nps-time">{fmtTime(playheadMs)} / {fmtTime(maxMs)}</span>
        <button type="button" className="nps-mute" onClick={toggleMute} title={isMuted ? '取消静音' : '静音'} aria-label={isMuted ? '取消静音' : '静音'}>
          {isMuted ? '🔇' : '🔊'}
        </button>
      </div>

      <div className="nps-addbar">
        <span className="nps-addbar-label">添加控件</span>
        {DEFAULT_STYLE_SLOTS.map((slot) => {
          const reason = slotDisabledReason[slot.id]
          return (
            <button
              key={slot.id}
              type="button"
              disabled={Boolean(reason)}
              title={reason ?? `${slot.desc}（点击加到播放头，或按住拖入时间轴落点）`}
              draggable={!reason}
              onClick={reason ? undefined : () => addMaterial(slot.id)}
              onDragStart={reason ? undefined : (e) => {
                e.dataTransfer.setData(MATERIAL_DND_MIME, slot.id)
                e.dataTransfer.effectAllowed = 'copy'
              }}
            >
              {slot.icon}
              {slot.title}
            </button>
          )
        })}
      </div>

      <MaterialTimeline
        materials={materials}
        maxMs={maxMs}
        playheadMs={playheadMs}
        selectedMaterialKey={selectedMaterialKey}
        isTimedQteNode={isTimedQteNode}
        context="video"
        editable
        emptyHint="该节点暂无时间轴控件——用上方「添加控件」加入字幕 / QTE / 选项等"
        onSeek={seekTo}
        onScrubStart={pauseForScrub}
        onSelectMaterial={setSelectedMaterialKey}
        onPatchMaterial={patchMaterial}
        onDeleteMaterial={deleteMaterial}
        onDropTemplate={addMaterialAt}
      />
    </div>
  )
}
