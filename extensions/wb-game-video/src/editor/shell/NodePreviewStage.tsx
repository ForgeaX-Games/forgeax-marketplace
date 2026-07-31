/**
 * NodePreviewStage —— 蓝图节点配置面板左侧的「演出预览台」（编辑 + 预览二合一）。
 *
 * 复用视频 tab（GraphVideoView）预览台的全部底层件，数据全程走 graph，不引入任何
 * schema/协议新字段：
 *   - 视频舞台：`gc-frame` / `computeVideoContentRect` 锚定 object-fit:contain 实际画面；
 *   - 皮肤层：`previewSkinChildrenInWindow` + `renderOverlayChildPreview` + PreviewClock
 *     （暂停冻结 CSS 动画）；滤镜/特效走 `resolveVideoFxForNode` 旁路；
 *   - 叠层操作框：节点视频画布只允许移动整份 overlay，写回挂载 `layout.left/top`；
 *   - 时间轴：`MaterialTimeline` 全交互，但**投影到挂载级**（`collectMountItemsFromNode`：
 *     一份挂载 = 一条），拖动整体平移挂载内子件、删除移除整份挂载，写回
 *     `patchMaterialGraph`（mount 分支 → shiftMountWindowGraph）/`deleteMaterialGraph`；
 *   - 「添加控件」条 = **覆盖物挂载入口**：前 5 个未挂载的预设覆盖物点击直接挂载，
 *     第 6 个「更多」展开完整列表（等价 NodeInspector 的「＋挂载」）。
 *
 * 选中联动：点预览叠层 / 时间轴挂载条 → 上抛 `onFocusMount(mountId)`，右侧 NodeInspector
 * 据此只聚焦展开该覆盖物的配置卡片（其余折叠）。
 *
 * 与视频 tab 的刻意差异：切视频/挂载/组件参数的联动**不在这里写**——右侧表单走既有
 * `patchData → onChange → store` 数据流，本组件只多一个订阅者，天然实时；也不自动回写
 * `durationMs`（只影响本地播放头与时间轴上限，对齐 `videoDurationCapReached` 契约）。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { GameNode, GameScenario, Layout } from '../../runtime/schema/graph-schema'
import type { SkinCtx } from '../../runtime/component-host/rendererRegistry'
import { bootEditorSkins } from '../init'
import { injectStyleOnce } from '../../styles/injectStyle'
import { createCoreSkinRegistry } from '../../runtime/component-host/components'
import { resolveVideoFxForNode } from '../../runtime/fx/video-fx'
import { CATALOG_CSS } from './catalogCss'
import { renderOverlayChildPreview } from './overlayChildPreview'
import { advancePreviewMediaClock, PreviewClockProvider, previewClockLayerClassName, type PreviewMediaClock } from './previewClock'
import { projectNodePreviewState } from './nodePreviewState'
import { resolveMediaSrc } from './media'
import { videoDurationCapReached } from '../../runtime/play/videoTiming'
import { resolveMountLayoutForChildren } from '../../runtime/schema/layout'
import { MATERIAL_DND_MIME, MaterialTimeline } from '../video/MaterialTimeline'
import { type MaterialItem, type TimelineConditionMarker, type TimelinePointMarker } from '../video/materialTimelineShared'
import { useVideoContentRect } from '../../runtime/play/useVideoContentRect'
import { PRESET_SCHEME_BY_ID, overlayDisplayLabel } from './schemeOverlays'
import { listSchemeAndBaseOverlayIds } from '../demo/builtin-schemes'
import { isSettlementReaction, overlayMountId, type NodeAction, type OverlayInstanceChild } from '../../runtime/schema/node-config-schema'
import { expandNodeChildren, resolveMountChildren } from '../../runtime/schema/expand-overlay'
import { setSettlementReactionMs, setRoutingSettlementMs } from '../../graph/edit/graph-edit'
import { elementStartMs } from '../../graph/canvas/timeline-geometry'
import { overlayFitTargets } from './overlay-fit-targets'
import {
  OverlayCanvasInteraction,
  type CanvasBox,
  type CanvasInteractionItem,
} from './OverlayCanvasInteraction'
import {
  collectMountItemsFromNode,
  deleteMaterialGraph,
  mountOverlayGraph,
  patchMaterialGraph,
  patchOverlayMountLayoutGraph,
  previewSkinChildrenInWindow,
  shiftMountWindowGraph,
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
.nps-addbar { position: relative; display: flex; align-items: center; gap: 5px; flex-wrap: wrap; flex: none; }
.nps-addbar-label { font-size: 10px; letter-spacing: .08em; color: var(--gc-faint); margin-right: 2px; }
.nps-addbar button {
  display: inline-flex; align-items: center; gap: 4px;
  border: 1px solid var(--gc-line-soft); background: var(--gc-panel2); color: var(--gc-text);
  border-radius: 7px; padding: 3px 8px; font-size: 11px; cursor: pointer;
}
.nps-addbar button:hover:not(:disabled) { border-color: var(--gc-accent); background: var(--gc-accent-soft); }
.nps-addbar button:disabled { opacity: .38; cursor: default; }
.nps-addbar .nps-add-chip::before { content: "＋"; opacity: .7; }
.nps-addbar-empty { font-size: 10px; color: var(--gc-faint); opacity: .8; }
.nps-more-pop {
  position: absolute; top: calc(100% + 4px); right: 0; z-index: 40;
  min-width: 200px; max-width: 280px; max-height: 260px; overflow-y: auto;
  background: var(--gc-panel); border: 1px solid var(--gc-line); border-radius: 9px;
  box-shadow: 0 8px 24px rgba(0,0,0,.45); padding: 5px; display: flex; flex-direction: column; gap: 2px;
}
.nps-more-pop button { justify-content: flex-start; width: 100%; border-color: transparent; background: transparent; }
.nps-more-pop button:hover { background: var(--gc-accent-soft); border-color: var(--gc-accent-line); }
.nps-more-empty { font-size: 11px; color: var(--gc-faint); padding: 6px 8px; }
.nps-root .mtl-root { flex: none; }
`

const DEFAULT_MOUNT_W = 0.25
const DEFAULT_MOUNT_H = 0.15

function isFullStageMountLayout(layout: Layout | undefined): boolean {
  return (
    layout?.width === 1
    && layout.height === 1
    && layout.right == null
    && layout.bottom == null
    && layout.translateX == null
    && layout.translateY == null
  )
}

function fmtTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function effectsBrief(actions: NodeAction[]): string {
  const effects = actions.flatMap((action) => (action.kind === 'effect' ? action.effects : []))
  const spawns = actions.filter((action) => action.kind === 'spawn').length
  const parts = effects.slice(0, 2).map((effect) => {
    if (effect.kind === 'attr') return `${effect.entityId}.${effect.attr} ${effect.op} ${String(effect.value)}`
    if (effect.kind === 'var') return `${effect.varId} ${effect.op} ${String(effect.value)}`
    if (effect.kind === 'flag') return `${effect.varId} = ${effect.value}`
    return `${effect.itemId} ${effect.op === 'give' ? '+' : '-'}${effect.count}`
  })
  if (effects.length > 2) parts.push(`等 ${effects.length} 项`)
  if (spawns > 0) parts.push(`刷出 ${spawns} 个瞬态组件`)
  if (actions.some((action) => action.kind === 'advance')) parts.push('沿边推进')
  return parts.length ? parts.join(' · ') : '未配置动作'
}

function matchesReactionTarget(of: string, child: OverlayInstanceChild): boolean {
  const source = child.source
  return of === source.childId
    || of === child.id
    || of === `${source.mountId}/${source.childId}`
    || of === `${source.overlayId}/${source.childId}`
}

export function NodePreviewStage({
  scenario,
  node,
  game,
  focusedMountId,
  focusedLifecycleIndex,
  onEditScenario,
  onFocusMount,
  onFocusLifecycle,
}: {
  /** 读投影场景：canvasGraph（主图或下钻包图）+ ui.overlays + entities/variables。 */
  scenario: GameScenario
  /** 当前选中节点（canvasGraph 内；随编辑实时换引用）。 */
  node: GameNode
  game: string
  /** 右侧表单当前聚焦的挂载 id（预览据此高亮对应叠层/时间轴条）。 */
  focusedMountId?: string | null
  /** 右侧表单当前聚焦的结算（生命周期子集序号）；时间轴据此高亮对应菱形。 */
  focusedLifecycleIndex?: number | null
  /** 写回通道：主图走 setScenario，子蓝图下钻由上层分流到包图（见 GraphStudio）。 */
  onEditScenario: (fn: (s: GameScenario, n: GameNode) => GameScenario) => void
  /** 选中某挂载覆盖物时上抛（右侧表单据此聚焦该卡片；传 null = 清空聚焦）。 */
  onFocusMount?: (mountId: string | null) => void
  /** 点中某结算菱形时上抛，让右侧对应配置块高亮。 */
  onFocusLifecycle?: (lifecycleIndex: number | null) => void
}): JSX.Element {
  bootEditorSkins()
  injectStyleOnce('graph-catalog', CATALOG_CSS)
  injectStyleOnce('node-preview-stage', NPS_CSS)

  const contentAnchorRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const mediaClockRef = useRef<PreviewMediaClock | null>(null)
  const [playheadMs, setPlayheadMs] = useState(0)
  const [isVideoPlaying, setIsVideoPlaying] = useState(false)
  const [isMuted, setIsMuted] = useState(true)
  const [videoDurationMs, setVideoDurationMs] = useState<number | null>(null)
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const mountPreviewRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const [mountContentBoxes, setMountContentBoxes] = useState<Record<string, { left: number; top: number; width: number; height: number }>>({})
  const mountBoxSigRef = useRef('')

  const mediaRef = node.data.media?.ref ?? ''
  const playMode = node.data.mediaPlayMode ?? 'once'
  const previewSrc = resolveMediaSrc(mediaRef || undefined, game)
  const { contentRect, recomputeRect } = useVideoContentRect(videoRef, [mediaRef, node.id])

  // 当前聚焦挂载（受控于右侧表单 / 本组件选中）。
  const selectedMountId = focusedMountId ?? null
  function focusMount(id: string | null): void {
    onFocusMount?.(id)
  }

  // 播放时长上限（cap）：对齐 videoDurationCapReached 契约——>0 且 ≤ 视频本身长度才生效。
  const capMs = (() => {
    const cap = node.data.durationMs
    if (!cap || cap <= 0) return undefined
    if (videoDurationMs != null && cap > videoDurationMs) return undefined
    return cap
  })()
  const maxMs = Math.max(1000, capMs ?? videoDurationMs ?? 0)

  const overlays = scenario.ui?.overlays
  // 时间轴投影到挂载级：一份挂载 = 一条（跨度 = 挂载内全部子件的 [min,max]）。
  const materials = useMemo(() => collectMountItemsFromNode(scenario, node, maxMs), [scenario, node, maxMs])
  const previewSkinChildren = useMemo(
    () => previewSkinChildrenInWindow(scenario, node, playheadMs, maxMs),
    [scenario, node, playheadMs, maxMs],
  )
  const previewMountGroups = useMemo(() => {
    const mountsById = new Map(
      (node.data.overlayNodes ?? []).map((mount) => [overlayMountId(mount), mount] as const),
    )
    const groups = new Map<string, {
      mount: NonNullable<GameNode['data']['overlayNodes']>[number]
      children: typeof previewSkinChildren
    }>()
    for (const child of previewSkinChildren) {
      const mountId = child.source.mountId
      const mount = mountsById.get(mountId)
      if (!mount) continue
      const group = groups.get(mountId)
      if (group) group.children.push(child)
      else groups.set(mountId, { mount, children: [child] })
    }
    return [...groups.entries()].map(([mountId, value]) => ({
      mountId,
      ...value,
      layout: resolveMountLayoutForChildren(
        value.mount.layout,
        resolveMountChildren(overlays, value.mount).map((child) => child.layout),
      ) ?? {},
    }))
  }, [overlays, previewSkinChildren, node])
  const videoFx = useMemo(
    () => resolveVideoFxForNode(node, overlays, playheadMs, maxMs),
    [node, overlays, playheadMs, maxMs],
  )
  // 与视频 tab / 界面 tab 同源：完整皮肤表，不依赖 default 单例是否被 HMR 冲掉。
  const previewSkinReg = useMemo(() => createCoreSkinRegistry(), [])
  const previewSkinCtx = useMemo((): SkinCtx => {
    const st = projectNodePreviewState(scenario, node, playheadMs, maxMs)
    const toHudEnt = (
      attrs: Record<string, number>,
      attrMeta?: Record<string, { max?: number; initial?: number }>,
      name?: string,
    ) => {
      const attrMax: Record<string, number> = {}
      const initialAttrs: Record<string, number> = {}
      for (const [k, v] of Object.entries(attrs)) {
        attrMax[k] = attrMeta?.[k]?.max ?? v
        initialAttrs[k] = attrMeta?.[k]?.initial ?? attrMeta?.[k]?.max ?? v
      }
      return {
        name,
        hp: attrs.hp ?? 0,
        maxHp: attrMeta?.hp?.max ?? attrs.hp ?? 0,
        attrs: { ...attrs },
        attrMax,
        initialAttrs,
      }
    }
    const hudEntities: SkinCtx['hud']['entities'] = Object.fromEntries(
      Object.entries(st.entities).map(([id, e]) => [
        id,
        toHudEnt(e.attrs, e.attrMeta, scenario.entities?.[id]?.name?.trim() || id),
      ]),
    )
    // 与目录预览一致：缺实体时给常见战斗 id 兜底，避免血条 bind 后渲成 null。
    if (!hudEntities['ent-player']) hudEntities['ent-player'] = toHudEnt({ hp: 72 }, { hp: { max: 100 } }, 'ent-player')
    if (!hudEntities['ent-boss']) hudEntities['ent-boss'] = toHudEnt({ hp: 58 }, { hp: { max: 100 } }, 'ent-boss')
    return {
      hud: { entities: hudEntities, vars: { qi: 3, ...st.vars }, score: st.score, flags: st.flags },
      // 编辑器预览：用初始态做门控求值（无 visited）
      condition: { state: st, visited: new Set<string>() },
    }
  }, [scenario, node, playheadMs, maxMs])
  const previewClockValue = useMemo(() => ({ playing: isVideoPlaying, playheadMs }), [isVideoPlaying, playheadMs])

  // 「添加控件」= 覆盖物挂载入口：候选与界面 tab 同一份（自定义覆盖物 + 基础覆盖物，打平；
  // 见 builtin-schemes），已挂载的排除，前 5 直接列出，其余进「更多」。
  const mountedOverlayIds = useMemo(
    () => new Set((node.data.overlayNodes ?? []).map((m) => m.overlay)),
    [node.data.overlayNodes],
  )
  const mountCandidateIds = useMemo(
    () => listSchemeAndBaseOverlayIds(overlays).filter((id) => !mountedOverlayIds.has(id)),
    [overlays, mountedOverlayIds],
  )
  const primaryCandidateIds = mountCandidateIds.slice(0, 5)
  const moreCandidateIds = mountCandidateIds.slice(5)

  useEffect(() => {
    setSelectedOverlayId(selectedMountId)
  }, [selectedMountId])

  // 换节点/换视频：清播放态与选中（视频因 key 变化 remount 自动重播）。
  useEffect(() => {
    mediaClockRef.current = null
    setPlayheadMs(0)
    setVideoDurationMs(null)
    setLoadError(false)
    setMoreOpen(false)
    setSelectedOverlayId(focusedMountId ?? null)
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
        const nextClock = advancePreviewMediaClock(mediaClockRef.current, nowMs, maxMs, playMode === 'loop')
        mediaClockRef.current = nextClock
        setPlayheadMs(nextClock.playheadMs)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [isVideoPlaying, maxMs, capMs, playMode, node.data.durationMs])

  function seekTo(ms: number): void {
    const target = Math.max(0, Math.min(maxMs, Math.round(ms)))
    mediaClockRef.current = { mediaMs: target, playheadMs: target }
    const v = videoRef.current
    if (v) { try { v.currentTime = target / 1000 } catch { /* metadata 未就绪 */ } }
    setPlayheadMs(target)
  }
  function pauseForScrub(): void {
    const v = videoRef.current
    if (v && !v.paused) { try { v.pause() } catch { /* ignore */ } }
    setIsVideoPlaying(false)
  }
  function togglePlay(): void {
    const v = videoRef.current
    if (!v) return
    if (v.paused) {
      // 已播到末尾再点播放 = 从头重播。
      if (playMode !== 'loop' && playheadMs >= maxMs - 40) seekTo(0)
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
  /** 时间轴挂载条整体平移（patchMaterialGraph 的 mount 分支）。 */
  function patchMaterial(item: MaterialItem, patch: { startMs?: number; endMs?: number; zIndex?: number; markerMs?: number }): void {
    onEditScenario((s, n) => patchMaterialGraph(s, n, maxMs, item, patch))
  }
  /** 时间轴删除挂载条 = 移除整份挂载；挂载上有「添加」进来的子件时二次确认（连带删除）。 */
  function deleteMaterial(item: MaterialItem): void {
    const mount = (node.data.overlayNodes ?? []).find((m) => overlayMountId(m) === item.id)
    const addedCount = mount?.added?.length ?? 0
    if (addedCount > 0 && typeof window !== 'undefined' && typeof window.confirm === 'function') {
      if (!window.confirm(`将同时删除 ${addedCount} 个添加到此覆盖物的组件，是否确认移除挂载「${item.label}」？`)) return
    }
    onEditScenario((s, n) => deleteMaterialGraph(s, n, item))
    if (selectedMountId === item.id) focusMount(null)
  }

  const settlementTimeline = useMemo((): {
    pointMarkers: TimelinePointMarker[]
    conditionMarkers: TimelineConditionMarker[]
  } => {
    const pointMarkers: TimelinePointMarker[] = []
    const conditionMarkers: TimelineConditionMarker[] = []
    const settlement = node.data.routingSettlement
    if (settlement?.type === 'at') {
      pointMarkers.push({ id: 'settlement', ms: settlement.ms, kind: 'settlement', label: '结算时刻 · 延迟事件边在此刻提交并离开节点' })
    }
    const children = expandNodeChildren(scenario, node)
    ;(node.data.reactions ?? []).filter(isSettlementReaction).forEach((reaction, settlementIndex) => {
      const id = `life:${settlementIndex}`
      const actionLabel = effectsBrief(reaction.do)
      if (reaction.when.type === 'at' || reaction.when.type === 'enter') {
        pointMarkers.push({
          id,
          ms: reaction.when.type === 'at' ? reaction.when.ms : 0,
          kind: 'lifecycle',
          label: `结算 · ${actionLabel}`,
        })
        return
      }
      if (reaction.when.type === 'watch') {
        const direction = reaction.when.on === 'inc' ? '增加' : reaction.when.on === 'dec' ? '减少' : '变化'
        conditionMarkers.push({ id, label: `${reaction.when.of || '未选数值'} ${direction} → ${actionLabel}` })
        return
      }
      if (reaction.when.type === 'shown' || reaction.when.type === 'hidden') {
        const when = reaction.when
        const child = children.find((candidate) => matchesReactionTarget(when.of, candidate))
        const ms = when.type === 'shown'
          ? (child ? elementStartMs(child) : null)
          : child?.window?.endMs ?? null
        const phase = when.type === 'shown' ? '出现' : '消失'
        const label = `${when.of || '未选界面'} ${phase} → ${actionLabel}`
        if (ms != null) {
          pointMarkers.push({ id, ms, kind: 'derived', draggable: false, label })
        } else {
          conditionMarkers.push({ id, label })
        }
      }
    })
    return { pointMarkers, conditionMarkers }
  }, [node, overlays, scenario])
  const { pointMarkers, conditionMarkers } = settlementTimeline

  const lifecycleIndexOf = (id: string): number | null => {
    if (!id.startsWith('life:')) return null
    const index = Number(id.slice('life:'.length))
    return Number.isInteger(index) ? index : null
  }

  const movePointMarker = (id: string, ms: number): void => {
    if (id === 'settlement') {
      onEditScenario((scenarioToEdit, nodeToEdit) => ({
        ...scenarioToEdit,
        graph: setRoutingSettlementMs(scenarioToEdit.graph, nodeToEdit.id, ms),
      }))
      return
    }
    const lifecycleIndex = lifecycleIndexOf(id)
    if (lifecycleIndex == null) return
    onEditScenario((scenarioToEdit, nodeToEdit) => ({
      ...scenarioToEdit,
      graph: setSettlementReactionMs(scenarioToEdit.graph, nodeToEdit.id, lifecycleIndex, ms),
    }))
  }
  /** 「添加控件」点击 / 拖入：挂载一张覆盖物（可带落点 ms → 整体平移到该时刻）。 */
  function mountOverlay(overlayId: string, atMs?: number): void {
    onEditScenario((s, n) => {
      const s1 = mountOverlayGraph(s, n, overlayId, PRESET_SCHEME_BY_ID[overlayId])
      if (atMs == null) return s1
      const n1 = s1.graph.nodes.find((x) => x.id === n.id) ?? n
      return shiftMountWindowGraph(s1, n1, maxMs, overlayId, { startMs: atMs })
    })
    focusMount(overlayId)
    setMoreOpen(false)
  }

  // ── 预览叠层画布（共享 OverlayCanvasInteraction）──────────────────────────
  function patchMountPosition(mountId: string, position: { x: number; y: number }): void {
    onEditScenario((s, n) => patchOverlayMountLayoutGraph(s, n, mountId, {
      left: position.x,
      top: position.y,
      right: undefined,
      bottom: undefined,
    }))
  }
  function reorderMount(mountId: string, direction: 'front' | 'back'): void {
    const zValues = previewMountGroups.map(({ mount }) =>
      typeof mount.layout?.zIndex === 'number' ? mount.layout.zIndex : 0)
    const zIndex = direction === 'front'
      ? Math.max(0, ...zValues) + 1
      : Math.min(0, ...zValues) - 1
    onEditScenario((s, n) => patchOverlayMountLayoutGraph(s, n, mountId, { zIndex }))
  }

  useLayoutEffect(() => {
    const stage = contentAnchorRef.current
    if (!stage) return
    const stageRect = stage.getBoundingClientRect()
    if (!stageRect.width || !stageRect.height) return
    const next: Record<string, { left: number; top: number; width: number; height: number }> = {}
    for (const { mountId } of previewMountGroups) {
      const wrap = mountPreviewRefs.current[mountId]
      if (!wrap) continue
      let left = Infinity
      let top = Infinity
      let right = -Infinity
      let bottom = -Infinity
      for (const element of overlayFitTargets(wrap)) {
        const rect = element.getBoundingClientRect()
        if (!rect.width || !rect.height) continue
        left = Math.min(left, rect.left)
        top = Math.min(top, rect.top)
        right = Math.max(right, rect.right)
        bottom = Math.max(bottom, rect.bottom)
      }
      if (!(right > left && bottom > top)) {
        const fallback = wrap.getBoundingClientRect()
        left = fallback.left
        top = fallback.top
        right = fallback.right
        bottom = fallback.bottom
      }
      next[mountId] = {
        left: (left - stageRect.left) / stageRect.width,
        top: (top - stageRect.top) / stageRect.height,
        width: (right - left) / stageRect.width,
        height: (bottom - top) / stageRect.height,
      }
    }
    const sig = Object.entries(next)
      .map(([id, box]) => `${id}:${box.left.toFixed(3)},${box.top.toFixed(3)},${box.width.toFixed(3)},${box.height.toFixed(3)}`)
      .join('|')
    if (sig !== mountBoxSigRef.current) {
      mountBoxSigRef.current = sig
      setMountContentBoxes(next)
    }
  }, [previewMountGroups, playheadMs, contentRect])

  const interactionItems = useMemo<CanvasInteractionItem[]>(() =>
    previewMountGroups.map(({ mountId, mount, children, layout }) => {
      const content = mountContentBoxes[mountId]
      const explicitBox: CanvasBox | null =
        !isFullStageMountLayout(layout)
        && typeof layout?.left === 'number'
        && typeof layout.top === 'number'
        && typeof layout.width === 'number'
        && typeof layout.height === 'number'
        && layout.translateX == null
        && layout.translateY == null
          ? {
              left: layout.left,
              top: layout.top,
              width: layout.width,
              height: layout.height,
            }
          : null
      const box: CanvasBox = explicitBox ?? {
        left: content?.left ?? 0,
        top: content?.top ?? 0,
        width: content?.width ?? DEFAULT_MOUNT_W,
        height: content?.height ?? DEFAULT_MOUNT_H,
      }
      return {
        id: mountId,
        label: overlays?.[mount.overlay]?.title?.trim() || mountId,
        position: {
          x: typeof layout?.left === 'number' ? layout.left : 0,
          y: typeof layout?.top === 'number' ? layout.top : 0,
        },
        frame: { kind: 'box', ...box },
        zIndex: typeof mount.layout?.zIndex === 'number'
          ? mount.layout.zIndex
          : Math.max(0, ...children.map((child) => typeof child.layout?.zIndex === 'number' ? child.layout.zIndex : 0)),
        movable: true,
        resizable: false,
      }
    }), [mountContentBoxes, overlays, previewMountGroups])

  const previewContentStyle: CSSProperties | undefined = contentRect
    ? { left: `${contentRect.left}px`, top: `${contentRect.top}px`, width: `${contentRect.width}px`, height: `${contentRect.height}px` }
    : undefined

  return (
    <div className="nps-root">
      <div className="gc-frame nps-frame" data-type="video">
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
            onSeeked={(e) => {
              // 自定义时间轴 seekTo 已同步重置语义时钟；播放中的原生 loop seek 不得让结算倒带。
              if (!e.currentTarget.paused) return
              const target = Math.max(0, Math.min(maxMs, Math.round(e.currentTarget.currentTime * 1000)))
              mediaClockRef.current = { mediaMs: target, playheadMs: target }
              setPlayheadMs(target)
            }}
            onEnded={() => {
              mediaClockRef.current = { mediaMs: maxMs, playheadMs: maxMs }
              setIsVideoPlaying(false)
              setPlayheadMs(maxMs)
            }}
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
        <div ref={contentAnchorRef} className="gc-content-anchor" style={previewContentStyle}>
          <div className="gc-preview-overlays" data-node-preview-overlay-scale="none">
            {previewSkinChildren.length > 0 ? (
              <PreviewClockProvider value={previewClockValue}>
                <div className={`gc-preview-skin-layer ${previewClockLayerClassName(isVideoPlaying)}`} aria-hidden>
                  {previewMountGroups.map(({ mountId, children, layout }) => (
                    <div
                      key={mountId}
                      ref={(element) => { mountPreviewRefs.current[mountId] = element }}
                      data-preview-mount-id={mountId}
                      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
                    >
                      {children.map((child) => (
                        <span key={child.id} style={{ display: 'contents' }}>
                          {renderOverlayChildPreview(child, previewSkinReg, previewSkinCtx, playheadMs, layout, isVideoPlaying)}
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              </PreviewClockProvider>
            ) : null}
            <OverlayCanvasInteraction
              stageRef={contentAnchorRef}
              items={interactionItems}
              selectedId={selectedOverlayId}
              frameVisibility="active"
              ariaLabel="节点视频覆盖物画布"
              onSelect={(id) => {
                setSelectedOverlayId(id)
                focusMount(id)
              }}
              onMove={(id, position) => {
                pauseForScrub()
                patchMountPosition(id, position)
              }}
              onInteractionChange={(active) => {
                if (active) pauseForScrub()
              }}
              onReorder={(id, direction) => {
                pauseForScrub()
                reorderMount(id, direction)
              }}
            />
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

      {/* 「添加控件」= 覆盖物挂载入口：前 5 个未挂载覆盖物点击直接挂载，「更多」展开完整列表。 先暂时隐藏 */}
      <div className="nps-addbar" style={{ display: 'none' }}>
        <span className="nps-addbar-label">添加控件</span>
        {primaryCandidateIds.length === 0 && moreCandidateIds.length === 0 ? (
          <span className="nps-addbar-empty">已挂载全部覆盖物</span>
        ) : null}
        {primaryCandidateIds.map((id) => (
          <button
            key={id}
            type="button"
            className="nps-add-chip"
            title={`挂载覆盖物「${overlayDisplayLabel(id, overlays)}」到当前节点（点击直接挂载，或拖入时间轴落点）`}
            draggable
            onClick={() => mountOverlay(id)}
            onDragStart={(e) => {
              e.dataTransfer.setData(MATERIAL_DND_MIME, id)
              e.dataTransfer.effectAllowed = 'copy'
            }}
          >
            {overlays?.[id]?.title?.trim() || id}
          </button>
        ))}
        {moreCandidateIds.length > 0 ? (
          <button
            type="button"
            className="nps-add-chip"
            title="展开完整覆盖物列表"
            onClick={() => setMoreOpen((v) => !v)}
          >
            更多 ▾
          </button>
        ) : null}
        {moreOpen ? (
          <div className="nps-more-pop" onPointerLeave={() => setMoreOpen(false)}>
            {moreCandidateIds.length === 0 ? (
              <div className="nps-more-empty">没有更多可挂载的覆盖物</div>
            ) : (
              moreCandidateIds.map((id) => (
                <button key={id} type="button" onClick={() => mountOverlay(id)}>
                  {overlayDisplayLabel(id, overlays)}
                </button>
              ))
            )}
          </div>
        ) : null}
      </div>

      <MaterialTimeline
        materials={materials}
        maxMs={maxMs}
        playheadMs={playheadMs}
        selectedMaterialKey={selectedMountId ? `mount:${selectedMountId}` : null}
        pointMarkers={pointMarkers}
        conditionMarkers={conditionMarkers}
        selectedPointMarkerId={focusedLifecycleIndex != null ? `life:${focusedLifecycleIndex}` : null}
        context="video"
        editable
        emptyHint="该节点暂无挂载覆盖物——用上方「添加控件」挂载一张覆盖物"
        onSeek={seekTo}
        onScrubStart={pauseForScrub}
        onSelectMaterial={(key) => {
          const mid = key.startsWith('mount:') ? key.slice('mount:'.length) : null
          focusMount(mid)
          const it = materials.find((m) => m.key === key)
          if (it) {
            // 选中即定格到该覆盖物可见窗的中段并暂停；动画按该局部时刻精确定帧。
            seekTo(it.startMs + (it.endMs - it.startMs) / 2)
            pauseForScrub()
          }
        }}
        onPatchMaterial={patchMaterial}
        onPointMarkerChange={movePointMarker}
        onSelectPointMarker={(id) => {
          const lifecycleIndex = lifecycleIndexOf(id)
          if (lifecycleIndex != null) onFocusLifecycle?.(lifecycleIndex)
        }}
        onDeleteMaterial={deleteMaterial}
        onDropTemplate={(template, atMs) => mountOverlay(template, atMs)}
      />
    </div>
  )
}
