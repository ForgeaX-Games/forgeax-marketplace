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
import {
  listVideoAssetInfos,
  listRegistryAssets,
  requestGenerateVideo,
  requestGenerateKeyframe,
  getGameStyleAxes,
  setGameStyleAxes,
  importCharacterRefs,
  importSceneRefs,
  resolveMediaSrc,
  registryMediaUrl,
  type VideoAssetInfo,
} from './media'
import type { MediaAsset, MediaStatus, StyleAxes } from '../assets/registry-types'

// 风格三轴 UI 选项（id 对齐 server/engine/scenario/types.ts 的 VisualStyle/FilmLook/DirectorStyleId；
// 权威 coerce 在服务端 composeAxes，未知 id 自动回退，故此处仅作便捷选择器）。
const ART_MEDIA_OPTIONS: Array<[string, string]> = [
  ['', '（默认）'], ['photoreal', '写实'], ['anime', '日系动画'], ['cartoon', '卡通'],
  ['pixelart', '像素'], ['watercolor', '水彩'], ['ink', '水墨'], ['render3d2d', '3D转2D'],
]
const FILM_LOOK_OPTIONS: Array<[string, string]> = [
  ['', '（默认）'], ['teal-orange', '蒂尔橙'], ['noir-lowkey', '黑色低调'], ['warm-nostalgia', '暖怀旧'],
  ['bleach-bypass', '漂白'], ['clinical-scifi', '冷科幻'], ['morandi-muted', '莫兰迪'],
  ['bronze-epic', '青铜史诗'], ['retro-future', '复古未来'], ['baroque-chiaroscuro', '巴洛克明暗'],
  ['pastel-symmetry', '粉彩对称'],
]
const DIRECTOR_OPTIONS: Array<[string, string]> = [
  ['', '（默认）'], ['minimal-epic', '极简史诗'], ['precision-noir', '克制黑色'],
  ['foreknowledge-suspense', '预知悬疑'], ['mood-neon', '情绪霓虹'], ['luminous-anime', '通透动画'],
  ['kinetic-clarity', '动感清晰'], ['cyberpunk-neonoir', '赛博霓虹黑'], ['unseen-horror', '未见恐怖'],
  ['nonlinear-scifi', '非线性科幻'], ['pulp-dialogue', '话痨黑色'],
]
import { MATERIAL_DND_MIME, MaterialTimeline } from '../video/MaterialTimeline'
import {
  type AudioItem,
  type MaterialItem,
  type MaterialKind,
  materialClass,
  materialLabel,
} from '../video/materialTimelineShared'
import { computeVideoContentRect, pointerToVideoNorm, type VideoContentRect } from '../video/videoContentRect'
import { DEFAULT_STYLE_SLOTS, ICON_COMPONENT, type DefaultStyleSlot } from './defaultStyleSlots'
import { registerFxComponents } from '../../runtime/registry/fx-components'
import { fxNeedsColor, resolveVideoFxForNode } from '../../runtime/fx/video-fx'
import { resolveGraphTextCss } from '../text/text-css'
import { GraphTextStylePicker } from './GraphTextStylePicker'
import { EffectsEditor, PositionEditor } from './editors'
import { ComponentFormFields } from './component-form-fields'
import { SettlementEditor } from './SettlementEditor'
import { renderOverlayChildPreview } from './overlayChildPreview'
import { PreviewClockProvider, previewClockLayerClassName } from './previewClock'
import type { SkinCtx } from '../../runtime/skins/rendererRegistry'
import { initState } from '../../runtime/engine/engine-init'
import { FloatValuePickEditor } from './ValueExprEditor'
import { bootEditorSkins } from '../init'
import { injectStyleOnce } from '../../styles/injectStyle'
import { createCoreSkinRegistry, skinPositioning, skinDefaultAnchor } from '../../runtime/skins/components'
import { CATALOG_CSS } from './catalogCss'
import type { Entity, GameNode, GameScenario, GraphTextStyle } from '../../runtime/schema/graph-schema'
import type { QteCue } from '../../runtime/registry/core-components'
import { getComponent, getComponentManifest } from '../../runtime/registry/component-registry'
import {
  type MaterialTemplate,
  type PreviewOverlay,
  OPTION_XY,
  OVERLAY_XY,
  SUBTITLE_XY,
  addMaterialGraph,
  addOptionBranchGraph,
  addQteCueGraph,
  addQteOutcomeGraph,
  bindVideoGraph,
  applyStyleLockedEventParams,
  choiceElement,
  componentEventsLocked,
  collectMaterialsFromNode,
  confirmMaterialDelete,
  deleteMaterialGraph,
  findElement,
  findNode,
  listAvailableQteOutcomes,
  listComponentEventViews,
  listSchemeMountTabs,
  listOptionBranches,
  listQteOutcomeViews,
  listSpawnTemplateOptions,
  nodePlayDurationMs,
  previewSkinChildrenInWindow,
  patchMaterialGraph,
  patchOverlayGraph,
  patchOverlayPositionGraph,
  patchSelectedGraph,
  qteElement,
  qteElementOfCue,
  removeOptionBranchGraph,
  setComponentEventEffectsGraph,
  setComponentEventSpawnGraph,
  removeQteCueGraph,
  removeQteOutcomeGraph,
  resetMaterialOverrideGraph,
  setOptionBranchEffectsGraph,
  setOptionBranchSpawnGraph,
  setOptionTargetGraph,
  setQteOutcomeEffectsGraph,
  setQteOutcomeSpawnGraph,
  setQteOutcomeTargetGraph,
  overlayEffects,
  setNodePromptGraph,
  styleVariantsFor,
  syncChoiceStyleLockedOptionsGraph,
  updateOptionLabelGraph,
  activePreviewOverlaysFromNode,
  type QteOutcomeHandle,
  type SettlementSpawn,
} from '../video/graphMaterialOps'

// 「添加控件」/「重新生成」右列与检视器同槽切换（对齐 main 生成面板）。
// 复用视频 tab 的 --gc-* token；不改 CatalogTabs 的全局 CSS，样式自持。
// 视频 tab 的基础栏目/预览台样式（gc-*）复用共享 CATALOG_CSS（原旧 forge/CatalogTabs 全局 CSS）。
// 注册滤镜/特效组件（registry 全局单例 → 校验 + 运行时可见）；幂等。
registerFxComponents()
bootEditorSkins()

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
.gc-lib-empty { color: var(--gc-faint); font-size: 12px; padding: 12px 4px; }
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
.gvv-row-status { margin-left: auto; font-size: 10px; padding: 1px 6px; border-radius: 999px; line-height: 1.6; white-space: nowrap; }
.gvv-row-status.is-generating { background: rgba(240,136,64,.22); color: var(--gc-accent); }
.gvv-row-status.is-failed { background: rgba(224,72,72,.2); color: #ff8f8f; }
.gvv-row-status.is-placeholder { background: var(--gc-accent-soft); color: var(--gc-faint); }
.gvv-gen { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
.gvv-gen button { border: 1px solid var(--gc-accent-line); background: var(--gc-accent); color: #1a1206; font-weight: 700; padding: 9px 12px; border-radius: 9px; cursor: pointer; font-size: 13px; }
.gvv-gen button:hover:not(:disabled) { filter: brightness(1.06); }
.gvv-gen button:disabled { opacity: 0.5; cursor: default; }
.gvv-gen-hint { font-size: 11px; color: var(--gc-faint); line-height: 1.5; }
.gvv-gen-hint.is-error { color: #ff8f8f; }
.gvv-axes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.gvv-axes label { display: flex; flex-direction: column; gap: 3px; font-size: 10px; color: var(--gc-faint); letter-spacing: .04em; }
.gvv-axes select { background: var(--gc-panel2); color: var(--gc-text); border: 1px solid var(--gc-line-soft); border-radius: 7px; padding: 5px 6px; font-size: 12px; }
.gvv-gen-row { display: flex; gap: 8px; }
.gvv-gen-row button { flex: 1; }
.gvv-gen-row button.gvv-gen-alt { background: var(--gc-accent-soft); color: var(--gc-text); border-color: var(--gc-accent-line); font-weight: 600; }
.gc-prompt {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
  background: var(--gc-panel2);
  border: 1px solid var(--gc-line-soft);
  border-radius: 12px;
  padding: 12px;
}
.gc-prompt > span { color: var(--gc-faint); font-size: 11px; letter-spacing: 0.1em; }
.gc-prompt textarea {
  flex: 1;
  width: 100%;
  min-height: clamp(72px, 16dvh, 160px);
  resize: vertical;
  border: 1px solid var(--gc-line);
  background: rgba(0,0,0,0.28);
  color: var(--gc-text);
  border-radius: 8px;
  padding: 8px 10px;
  font: inherit;
  font-size: 13px;
  line-height: 1.5;
}
`,
)

interface VideoEntry {
  id: string
  label: string
  url: string
  group: string
  type?: string
  durMs?: number
  status?: MediaStatus
  fromRegistry?: boolean
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
  const [regAssets, setRegAssets] = useState<MediaAsset[]>([])
  const [genBusy, setGenBusy] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  // 游戏级风格三轴（P3）：加载 manifest.styleAxes，改动即写回；喂给生成请求。
  const [styleAxes, setStyleAxes] = useState<StyleAxes>({})
  const listBodyRef = useRef<HTMLDivElement | null>(null)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [selectedId, setSelectedId] = useState<string>('')
  const [contentRect, setContentRect] = useState<VideoContentRect | null>(null)
  // 右列：库（添加控件）/ 提示词（重新生成）/ 检视器（素材属性）。
  const [topPanel, setTopPanel] = useState<'library' | 'prompt' | 'inspector'>('library')
  // 「添加控件」二级栏：'default' = 六个默认样式快建卡片；其它 = 某个已挂载方案的 mountId
  // （该方案目录里的组件，拖入即克隆一份保留绑定等输入）。
  const [addTab, setAddTab] = useState<string>('default')
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
  const overlays = useGraphScenario((s) => s.meta.ui?.overlays)
  const setScenario = useGraphScenario((s) => s.setScenario)
  const entities = useGraphScenario((s) => s.meta.entities)
  const variables = useGraphScenario((s) => s.meta.variables)
  // 选中节点来自 graph 共享 store（不再依赖旧 scenarioStore）；无选中则落到首个节点。
  const selectedNodeId = useGraphScenario((s) => s.selectedNodeId)
  const selectedSceneId = selectedNodeId ?? graph.nodes[0]?.id ?? ''

  const node = findNode(graph, selectedSceneId)
  // 读投影只需 graph + ui.overlays；随两者变化重建，不必拉全量 scenario（省一次深拷贝）。
  const scenario = useMemo<GameScenario>(
    () => ({ schemaVersion: 'wb-game-video.graph.v1', graph, ui: { overlays: overlays ?? {} } }),
    [graph, overlays],
  )

  // 共享素材层轮询（mtime 级 5s）：驱动库缩略图三态 + 生成中占位实时转就绪。
  useEffect(() => {
    let alive = true
    const pull = async (): Promise<void> => {
      const [vs, all] = await Promise.all([listVideoAssetInfos(game), listRegistryAssets(game)])
      if (!alive) return
      setAssets(vs)
      setRegAssets(all)
    }
    void pull()
    const timer = window.setInterval(() => void pull(), 5000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [game])

  const characterRefs = useMemo(() => regAssets.filter((a) => a.productionType === 'character_ref'), [regAssets])
  const sceneRefs = useMemo(() => regAssets.filter((a) => a.productionType === 'scene_ref'), [regAssets])

  // 载入游戏级风格三轴（一次）。
  useEffect(() => {
    let alive = true
    void getGameStyleAxes(game).then((a) => { if (alive && a) setStyleAxes(a) })
    return () => { alive = false }
  }, [game])

  // 改一轴：本地即时 + 写回 manifest（浅合并；空串=清该轴）。
  function updateAxis(axis: keyof StyleAxes, value: string): void {
    const next: StyleAxes = { ...styleAxes, [axis]: value || undefined }
    setStyleAxes(next)
    void setGameStyleAxes(game, { [axis]: value || undefined } as StyleAxes)
  }

  // 跨模块只读拿料：把角色/场景模块产物登记成 ref，随后刷新 registry。
  async function importRefs(kind: 'character' | 'scene'): Promise<void> {
    setGenError(null)
    const res = kind === 'character' ? await importCharacterRefs(game) : await importSceneRefs(game)
    if (res.error && res.refs.length === 0) {
      setGenError(`导入${kind === 'character' ? '角色' : '场景'}参考图失败：${res.error}`)
    }
    setRegAssets(await listRegistryAssets(game))
  }

  const entries = useMemo<VideoEntry[]>(() => {
    const seen = new Set<string>()
    const clips: VideoEntry[] = []
    const narr: VideoEntry[] = []
    // 内置 bundle 视频（assets/zhandou/*.mp4）：按文件名列出，narr-* 归叙事、其余归战斗。
    for (const [id, url] of Object.entries(ZHANDOU_VIDEOS)) {
      seen.add(id)
      const isNarr = id.startsWith('narr-')
        ; (isNarr ? narr : clips).push({ id, label: id, url, group: isNarr ? '叙事' : '战斗' })
    }
    // 共享素材层里的自产视频资产（与 bundle 去重）：带三态 status。
    for (const v of assets) {
      if (seen.has(v.id)) continue
      seen.add(v.id)
      narr.push({
        id: v.id,
        label: v.label ?? v.id,
        url: v.status === 'ready' ? registryMediaUrl(v.id, game) : '',
        group: '生成',
        status: v.status,
        fromRegistry: true,
      })
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
  const isTimedQteNode = Boolean(qteElement(scenario, node))

  const materials = useMemo(() => collectMaterialsFromNode(scenario, node, maxMs), [scenario, node, maxMs])
  // 「添加控件」二级栏：每个已挂载方案一个 tab，tab 下是该方案目录里的组件（可拖入克隆）。
  const schemeMountTabs = useMemo(() => listSchemeMountTabs(scenario, node), [scenario, node])
  const activeAddTab = schemeMountTabs.some((t) => t.mountId === addTab) ? addTab : 'default'
  const activeMountComponents = schemeMountTabs.find((t) => t.mountId === activeAddTab)?.components ?? []
  const previewSkinChildren = useMemo(
    () => (node && editingBoundClip ? previewSkinChildrenInWindow(scenario, node, playheadMs, maxMs) : []),
    [scenario, node, editingBoundClip, playheadMs, maxMs],
  )
  // 与界面 tab OverlayCatalogPreview 同源：完整皮肤表，不依赖 default 单例是否被 HMR 冲掉。
  const previewSkinReg = useMemo(() => createCoreSkinRegistry(), [])
  const previewSkinCtx = useMemo((): SkinCtx => {
    const st = initState(scenario)
    const toHudEnt = (attrs: Record<string, number>, attrMeta?: Record<string, { max?: number }>) => {
      const attrMax: Record<string, number> = {}
      for (const [k, v] of Object.entries(attrs)) attrMax[k] = attrMeta?.[k]?.max ?? v
      return {
        hp: attrs.hp ?? 0,
        maxHp: attrMeta?.hp?.max ?? attrs.hp ?? 0,
        attrs: { ...attrs },
        attrMax,
      }
    }
    const entities: SkinCtx['hud']['entities'] = Object.fromEntries(
      Object.entries(st.entities).map(([id, e]) => [id, toHudEnt(e.attrs, e.attrMeta)]),
    )
    // 与目录预览一致：缺实体时给常见战斗 id 兜底，避免血条 bind 后渲成 null。
    if (!entities['ent-player']) entities['ent-player'] = toHudEnt({ hp: 72 }, { hp: { max: 100 } })
    if (!entities['ent-boss']) entities['ent-boss'] = toHudEnt({ hp: 58 }, { hp: { max: 100 } })
    return {
      hud: {
        entities,
        vars: { qi: 3, ...st.vars },
        score: st.score,
        flags: st.flags,
      },
      // 编辑器预览：用初始态做门控求值（无 visited）
      condition: { state: st, visited: new Set<string>() },
    }
  }, [scenario])
  const skinnedPreviewIds = useMemo(() => new Set(previewSkinChildren.map((c) => c.id)), [previewSkinChildren])
  // 预览皮肤层的泛用时钟：暂停即冻（CSS）；context 供子树内想读时钟又不想接 props 的皮肤用。
  const previewClockValue = useMemo(() => ({ playing: isVideoPlaying, playheadMs }), [isVideoPlaying, playheadMs])
  const previewOverlays = useMemo(() => {
    if (!node || !editingBoundClip) return []
    // 皮肤层只作展示（pointer-events:none），可拖定位手柄叠在皮肤之上。
    return activePreviewOverlaysFromNode(scenario, node, playheadMs, maxMs)
  }, [scenario, node, editingBoundClip, playheadMs, maxMs])
  // 滤镜/特效预览：按当前播放头解析出 filter / transform / 覆盖层，实时施加到预览视频。
  const videoFx = useMemo(
    () => (node && editingBoundClip ? resolveVideoFxForNode(node, overlays, playheadMs, maxMs) : { overlays: [] }),
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
      setAudioItems([{ key: 'clip-audio', label: `素材音轨 · ${timelineEntry.label}`, startMs: 0, endMs: maxMs, zIndex: 0, src: previewSrc, builtin: true }])
    } else {
      setAudioItems([])
    }
  }, [editingBoundClip, timelineEntry?.id, selectedSceneId, maxMs, previewSrc])

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

  // ── scenario 写入封装：始终以最新 scenario re-find 节点（overlay children 住在 ui.overlays）。
  function editScenario(fn: (s: GameScenario, n: GameNode) => GameScenario): void {
    const s = useGraphScenario.getState().scn()
    const n = findNode(s.graph, selectedSceneId)
    if (!n) return
    setScenario(fn(s, n))
  }

  function bindCurrent(): void {
    if (!node || !previewEntry) return
    editScenario((s, n) => bindVideoGraph(s, n, refForEntry(previewEntry), previewEntry.durMs ?? maxMs))
  }

  function setPrompt(next: string): void {
    editScenario((g, n) => setNodePromptGraph(g, n, next))
  }

  // 「重新生成」→ 真实服务端 headless 生成（P3/P4 编排）。必传角色+场景参考图（缺则闸住）。
  // 成功后把成片资产绑到当前节点 media.ref；轮询由上面的 5s registry 拉取接管三态。
  async function generateVideoForNode(): Promise<void> {
    if (!node || genBusy) return
    setGenError(null)
    if (characterRefs.length === 0 || sceneRefs.length === 0) {
      setGenError('缺参考图：需先从上游模块导入至少 1 张角色参考图 + 1 张场景参考图，才能生成视频。')
      return
    }
    setGenBusy(true)
    try {
      const res = await requestGenerateVideo(game, {
        sceneNodeId: node.id,
        nodeName: node.data.name || node.id,
        storyText: node.data.media?.prompt ?? node.data.name ?? '',
        durationSeconds: Math.max(4, Math.round((node.data.durationMs ?? 8000) / 1000)),
        characterRefIds: characterRefs.map((a) => a.id),
        sceneRefIds: sceneRefs.map((a) => a.id),
        label: `视频 · ${node.data.name || node.id}`,
        styleAxes,
      })
      if (res.error || !res.asset) {
        setGenError(res.error ?? '生成失败')
        return
      }
      const asset = res.asset
      editScenario((g, n) => bindVideoGraph(g, n, asset.id, asset.durationMs ?? maxMs))
      const [vs, all] = await Promise.all([listVideoAssetInfos(game), listRegistryAssets(game)])
      setAssets(vs)
      setRegAssets(all)
      setSelectedId(asset.id)
    } catch (e) {
      setGenError((e as Error).message)
    } finally {
      setGenBusy(false)
    }
  }

  // 「分镜故事板」分支（P4）：生成 6 面板黑白 previs（grid_storyboard），落素材层、不改绑定。
  async function generateStoryboardForNode(): Promise<void> {
    if (!node || genBusy) return
    setGenError(null)
    setGenBusy(true)
    try {
      const res = await requestGenerateKeyframe(game, {
        sceneNodeId: node.id,
        nodeName: node.data.name || node.id,
        beat: node.data.media?.prompt ?? node.data.name ?? '',
        refAssetIds: [...characterRefs.map((a) => a.id), ...sceneRefs.map((a) => a.id)],
        label: `分镜故事板 · ${node.data.name || node.id}`,
        styleAxes,
        mode: 'grid_storyboard',
      })
      if (res.error || !res.asset) {
        setGenError(res.error ?? '故事板生成失败')
        return
      }
      const [vs, all] = await Promise.all([listVideoAssetInfos(game), listRegistryAssets(game)])
      setAssets(vs)
      setRegAssets(all)
    } catch (e) {
      setGenError((e as Error).message)
    } finally {
      setGenBusy(false)
    }
  }

  function patchMaterial(item: MaterialItem, patch: { startMs?: number; endMs?: number; zIndex?: number }): void {
    editScenario((g, n) => patchMaterialGraph(g, n, maxMs, item, patch))
  }

  // 音频条拖动（仅本地展示态；不写回 graph）。
  function patchAudio(item: AudioItem, patch: { startMs?: number; endMs?: number; zIndex?: number }): void {
    setAudioItems((list) =>
      list.map((a) =>
        a.key === item.key
          ? { ...a, startMs: patch.startMs ?? a.startMs, endMs: patch.endMs ?? a.endMs, zIndex: patch.zIndex ?? a.zIndex }
          : a,
      ),
    )
  }

  function deleteMaterial(item: MaterialItem): void {
    if (!node) return
    if (!confirmMaterialDelete(scenario, node, item)) return
    editScenario((s, n) => deleteMaterialGraph(s, n, item))
    if (selectedMaterialKey === item.key) {
      setSelectedMaterialKey(null)
      setTopPanel('library')
    }
  }

  // 素材属性「↺ 回连方案」：清掉该素材所属组件在挂载上的差量，改回跟随共享方案。
  function resetMaterialOverride(item: MaterialItem): void {
    editScenario((s, n) => resetMaterialOverrideGraph(s, n, item))
  }

  function addMaterial(template: MaterialTemplate): void {
    if (!node) return
    const res = addMaterialGraph(scenario, node, maxMs, template, entities, playheadMs)
    setScenario(res.scenario)
    if (res.selectKey) setSelectedMaterialKey(res.selectKey)
    setTopPanel('inspector')
  }

  // 从素材库把控件卡片拖进时间轴 → 在落点时刻/轨新增。
  function addMaterialAt(template: string, atMs: number, zIndex: number): void {
    if (!node) return
    if (template === 'option' ? optionDisabled : !hasEditableVideo) return
    if (template === 'qte' && qteDisabled) return
    const res = addMaterialGraph(scenario, node, maxMs, template, entities, playheadMs, { ms: atMs, zIndex })
    setScenario(res.scenario)
    if (res.selectKey) setSelectedMaterialKey(res.selectKey)
    setTopPanel('inspector')
  }

  function addQteCue(afterCueId?: string): void {
    if (!node) return
    const res = addQteCueGraph(scenario, node, maxMs, playheadMs, afterCueId)
    setScenario(res.scenario)
    if (res.selectKey) setSelectedMaterialKey(res.selectKey)
  }

  function removeQteCue(cueId: string): void {
    if (!node) return
    const whole = (qteElementOfCue(scenario, node, cueId)?.inputs?.cues as QteCue[] | undefined)?.length ?? 0
    if (whole <= 1) {
      const cueItem = materials.find((m) => m.kind === 'qte' && m.id === cueId)
      if (cueItem && !confirmMaterialDelete(scenario, node, cueItem)) return
      editScenario((s, n) => removeQteCueGraph(s, n, cueId))
      setSelectedMaterialKey(null)
      setTopPanel('library')
      return
    }
    editScenario((s, n) => removeQteCueGraph(s, n, cueId))
    if (selectedMaterialKey?.endsWith(`:${cueId}`)) {
      const rest = (qteElementOfCue(scenario, node, cueId)?.inputs?.cues as QteCue[] | undefined)?.find((c) => c.id !== cueId)
      const el = qteElement(scenario, node)
      setSelectedMaterialKey(rest && el ? `qte:${el.id}:${rest.id}` : null)
    }
  }

  function patchSelected(patch: Record<string, unknown>): void {
    if (!node || !selectedMaterial) return
    if (selectedMaterial.kind === 'overlay') {
      editScenario((s, n) => patchOverlayGraph(s, n, selectedMaterial.id, patch, entities))
    } else {
      editScenario((s, n) => patchSelectedGraph(s, n, selectedMaterial, patch))
    }
  }

  // ── 预览叠层拖拽定位 ─────────────────────────────────────────────────────────
  function positionFromFrame(e: React.PointerEvent): { x: number; y: number } | null {
    const frame = frameRef.current
    if (!frame) return null
    return pointerToVideoNorm(e.clientX, e.clientY, frame, videoRef.current)
  }
  function moveOverlay(o: PreviewOverlay, x: number, y: number): void {
    editScenario((s, n) => patchOverlayPositionGraph(s, n, o.target, x, y))
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
  const qteDisabled = addDisabled
  // 默认六槏位各自的禁用判断（依赖当前节点状态，故不下沉进 defaultStyleSlots.tsx 的纯展示表）。
  const DEFAULT_SLOT_DISABLED_REASON: Record<DefaultStyleSlot['id'], string | undefined> = {
    subtitle: addDisabled,
    overlay: addDisabled,
    qte: qteDisabled,
    option: optionDisabled,
    filter: addDisabled,
    fx: addDisabled,
  }

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
              {it.status && it.status !== 'ready' ? (
                <span className={`gvv-row-status is-${it.status}`}>
                  {it.status === 'generating' ? '生成中…' : it.status === 'failed' ? '失败' : '占位'}
                </span>
              ) : null}
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
                        if (node && editingBoundClip && node.data.durationMs !== ms) {
                          editScenario((s, n) => bindVideoGraph(s, n, n.data.media?.ref ?? '', ms))
                        }
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
                      {previewSkinChildren.length > 0 ? (
                        <PreviewClockProvider value={previewClockValue}>
                          <div className={`gc-preview-skin-layer ${previewClockLayerClassName(isVideoPlaying)}`} aria-hidden>
                            {previewSkinChildren.map((child) => (
                              <div key={child.id} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                                {renderOverlayChildPreview(child, previewSkinReg, previewSkinCtx, playheadMs)}
                              </div>
                            ))}
                          </div>
                        </PreviewClockProvider>
                      ) : null}
                      {previewOverlays.map((o) => {
                        const selected = selectedMaterialKey === o.materialKey
                        // 有皮肤层时：手柄压过皮肤；隐藏默认文案避免与真实组件重复。
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
                    scenario={scenario}
                    node={node}
                    item={selectedMaterial}
                    entities={entities}
                    variables={variables}
                    onPatch={patchSelected}
                    onTiming={(item, start, end) => patchMaterial(item, { startMs: start, endMs: end })}
                    onResetOverride={resetMaterialOverride}
                    onRemoveQteCue={removeQteCue}
                    onAddBranch={() => editScenario((s, n) => addOptionBranchGraph(s, n))}
                    onSetBranchLabel={(key, label) => editScenario((s, n) => updateOptionLabelGraph(s, n, key, label))}
                    onSetBranchTarget={(key, target) => editScenario((s, n) => setOptionTargetGraph(s, n, key, target))}
                    onSetBranchEffects={(key, effects) => editScenario((s, n) =>
                      selectedMaterial?.kind === 'component'
                        ? setComponentEventEffectsGraph(s, n, selectedMaterial.id, key, effects)
                        : setOptionBranchEffectsGraph(s, n, key, effects))}
                    onSetBranchSpawn={(key, spawn) => editScenario((s, n) =>
                      selectedMaterial?.kind === 'component'
                        ? setComponentEventSpawnGraph(s, n, selectedMaterial.id, key, spawn)
                        : setOptionBranchSpawnGraph(s, n, key, spawn))}
                    onRemoveBranch={(key) => editScenario((s, n) => removeOptionBranchGraph(s, n, key))}
                    onSyncChoiceStyleLocked={() => editScenario((s, n) => syncChoiceStyleLockedOptionsGraph(s, n))}
                    onSetQteOutcomeTarget={(handle, target) => editScenario((s, n) => setQteOutcomeTargetGraph(s, n, handle, target))}
                    onSetQteOutcomeEffects={(handle, effects) => editScenario((s, n) => setQteOutcomeEffectsGraph(s, n, handle, effects))}
                    onSetQteOutcomeSpawn={(handle, spawn) => editScenario((s, n) => setQteOutcomeSpawnGraph(s, n, handle, spawn))}
                    onAddQteOutcome={(handle) => editScenario((s, n) => addQteOutcomeGraph(s, n, handle))}
                    onRemoveQteOutcome={(handle) => editScenario((s, n) => removeQteOutcomeGraph(s, n, handle))}
                  />
                </div>
              ) : editingBoundClip && topPanel === 'library' ? (
                <div className="gvv-toolpanel">
                  <span className="gvv-toolpanel-head">添加控件</span>
                  {schemeMountTabs.length > 0 ? (
                    <div className="gvv-toolseg" role="group" aria-label="添加控件分类">
                      <button
                        type="button"
                        className={activeAddTab === 'default' ? 'is-on' : ''}
                        aria-pressed={activeAddTab === 'default'}
                        onClick={() => setAddTab('default')}
                      >
                        默认样式
                      </button>
                      {schemeMountTabs.map((t) => (
                        <button
                          key={t.mountId}
                          type="button"
                          className={activeAddTab === t.mountId ? 'is-on' : ''}
                          aria-pressed={activeAddTab === t.mountId}
                          onClick={() => setAddTab(t.mountId)}
                        >
                          {t.title}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {activeAddTab === 'default' ? (
                    <div className="gc-lib-grid">
                      {DEFAULT_STYLE_SLOTS.map((slot) => (
                        <MaterialCard
                          key={slot.id}
                          icon={slot.icon}
                          title={slot.title}
                          template={slot.id}
                          desc={slot.desc}
                          disabledReason={DEFAULT_SLOT_DISABLED_REASON[slot.id]}
                          onClick={() => addMaterial(slot.id)}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="gc-lib-grid">
                      {activeMountComponents.length > 0 ? activeMountComponents.map((c) => (
                        <MaterialCard
                          key={c.id}
                          icon={ICON_COMPONENT}
                          title={c.label}
                          template={c.id}
                          desc={`从挂载方案克隆「${c.label}」（${c.componentId} · ${c.id}）到时间轴，保留其绑定等输入。`}
                          disabledReason={addDisabled}
                          onClick={() => addMaterial(c.id)}
                        />
                      )) : (
                        <span className="gc-lib-empty">这个方案目录里还没有组件。</span>
                      )}
                    </div>
                  )}
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
                  <div className="gvv-gen">
                    <div className="gvv-axes" role="group" aria-label="风格三轴">
                      <label>
                        <span>渲染媒介</span>
                        <select value={styleAxes.artMedia ?? ''} onChange={(e) => updateAxis('artMedia', e.target.value)}>
                          {ART_MEDIA_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </label>
                      <label>
                        <span>导演流派</span>
                        <select value={styleAxes.director ?? ''} onChange={(e) => updateAxis('director', e.target.value)}>
                          {DIRECTOR_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </label>
                      <label>
                        <span>电影调色</span>
                        <select value={styleAxes.filmLook ?? ''} onChange={(e) => updateAxis('filmLook', e.target.value)}>
                          {FILM_LOOK_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </label>
                    </div>
                    <div className="gvv-toolseg" role="group" aria-label="导入参考图">
                      <button type="button" onClick={() => void importRefs('character')} disabled={genBusy}>
                        导入角色图 ({characterRefs.length})
                      </button>
                      <button type="button" onClick={() => void importRefs('scene')} disabled={genBusy}>
                        导入场景图 ({sceneRefs.length})
                      </button>
                    </div>
                    <div className="gvv-gen-row">
                      <button
                        type="button"
                        disabled={!node || genBusy}
                        onClick={() => void generateVideoForNode()}
                      >
                        {genBusy ? '生成中…' : '▶ 生成视频'}
                      </button>
                      <button
                        type="button"
                        className="gvv-gen-alt"
                        disabled={!node || genBusy}
                        title="生成 6 面板黑白 previs 故事板（分镜图分支，落素材层，不改当前绑定）"
                        onClick={() => void generateStoryboardForNode()}
                      >
                        ▦ 分镜故事板
                      </button>
                    </div>
                    <span className={`gvv-gen-hint${genError ? ' is-error' : ''}`}>
                      {genError
                        ? genError
                        : `参考图：角色 ${characterRefs.length} · 场景 ${sceneRefs.length}（视频生成必传各 ≥1；缺则先「导入」）`}
                    </span>
                  </div>
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
function cuesOfEl(el: { inputs?: Record<string, unknown> } | undefined): QteCue[] | undefined {
  const cues = el?.inputs?.cues
  return Array.isArray(cues) ? (cues as QteCue[]) : undefined
}

/** MaterialKind → overlay child 的 component id（用于按类型查「默认样式方案」里的同类变体）。qte/option 结构性，不接样式方案。 */
const STYLE_COMPONENT: Partial<Record<MaterialKind, string>> = {
  subtitle: 'dialogue',
  overlay: 'floatText',
  filter: 'filter',
  fx: 'fx',
}

function GraphMaterialInspector({
  scenario,
  node,
  item,
  entities,
  variables,
  onPatch,
  onTiming,
  onResetOverride,
  onRemoveQteCue,
  onAddBranch,
  onSetBranchLabel,
  onSetBranchTarget,
  onSetBranchEffects,
  onSetBranchSpawn,
  onRemoveBranch,
  onSyncChoiceStyleLocked,
  onSetQteOutcomeTarget,
  onSetQteOutcomeEffects,
  onSetQteOutcomeSpawn,
  onAddQteOutcome,
  onRemoveQteOutcome,
}: {
  scenario: GameScenario
  node: GameNode | undefined
  item: MaterialItem | null
  entities: Record<string, Entity> | undefined
  variables: GameScenario['variables']
  onPatch: (patch: Record<string, unknown>) => void
  onTiming: (item: MaterialItem, startMs: number, endMs: number) => void
  onResetOverride: (item: MaterialItem) => void
  onRemoveQteCue: (cueId: string) => void
  onAddBranch: () => void
  onSetBranchLabel: (key: string, label: string) => void
  onSetBranchTarget: (key: string, target: string) => void
  onSetBranchEffects: (key: string, effects: import('../../runtime/schema/graph-schema').GraphEffect[]) => void
  onSetBranchSpawn: (key: string, spawn: SettlementSpawn | undefined) => void
  onRemoveBranch: (key: string) => void
  onSyncChoiceStyleLocked: () => void
  onSetQteOutcomeTarget: (handle: QteOutcomeHandle, target: string) => void
  onSetQteOutcomeEffects: (handle: QteOutcomeHandle, effects: import('../../runtime/schema/graph-schema').GraphEffect[]) => void
  onSetQteOutcomeSpawn: (handle: QteOutcomeHandle, spawn: SettlementSpawn | undefined) => void
  onAddQteOutcome: (handle: QteOutcomeHandle) => void
  onRemoveQteOutcome: (handle: QteOutcomeHandle) => void
}): JSX.Element {
  const el = node && item
    ? (item.kind === 'qte' ? qteElementOfCue(scenario, node, item.id) : findElement(scenario, node, item.id))
    : undefined
  const inputs = (el?.inputs ?? {}) as Record<string, unknown>
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  const qteSkinId = item?.kind === 'qte' && el ? (el.component || 'qte') : 'qte'
  const styleLocksQteEvents = item?.kind === 'qte' && componentEventsLocked(qteSkinId)
  const choiceSkinId = item?.kind === 'option' && el ? el.component : ''
  const styleLocksOptions = item?.kind === 'option' && componentEventsLocked(choiceSkinId)

  // 打开检视器时把脏 events 写回样式锁定值（与运行时 submit 对齐）
  useEffect(() => {
    if (!item || item.kind !== 'qte' || !styleLocksQteEvents) return
    const locked = applyStyleLockedEventParams(inputs, qteSkinId)
    const sameEvents = JSON.stringify(locked.events) === JSON.stringify(inputs.events)
    const sameDefault = (locked.defaultEvent ?? 'fail') === (inputs.defaultEvent ?? inputs.defaultKey ?? 'fail')
    if (!sameEvents || !sameDefault) {
      onPatch({ events: locked.events, defaultEvent: locked.defaultEvent ?? 'fail' })
    }
  }, [item?.kind, item?.id, qteSkinId, styleLocksQteEvents, inputs.events, inputs.defaultEvent, inputs.defaultKey, onPatch])

  // 打开检视器时把脏 events 写回样式锁定值（應默/技能条选项数与皮肤对齐）
  useEffect(() => {
    if (!item || item.kind !== 'option' || !styleLocksOptions) return
    const locked = applyStyleLockedEventParams(inputs, choiceSkinId)
    if (JSON.stringify(locked.events) !== JSON.stringify(inputs.events)) {
      onSyncChoiceStyleLocked()
    }
  }, [item?.kind, item?.id, choiceSkinId, styleLocksOptions, inputs.events, onSyncChoiceStyleLocked])

  if (!node || !item) {
    return <div className="gc-inspector-empty"><span>选择时间轴上的素材以编辑属性</span></div>
  }
  const cue = item.kind === 'qte' ? cuesOfEl(el)?.find((c) => c.id === item.id) : undefined
  const overlayFx = item.kind === 'overlay' ? overlayEffects(scenario, node, item.id) : []
  const overlayDisplayCustom = item.kind === 'overlay' && typeof inputs.expr === 'string' && inputs.expr.length > 0
  const branches = item.kind === 'option' ? listOptionBranches(scenario, node) : []
  const qteOutcomes = item.kind === 'qte' ? listQteOutcomeViews(scenario, node) : []
  const qteAvailable = item.kind === 'qte' ? listAvailableQteOutcomes(scenario, node) : []
  const componentEvents = item.kind === 'component' && el
    ? listComponentEventViews(scenario, node, el)
    : []
  const spawnTemplates = (item.kind === 'qte' || item.kind === 'option' || item.kind === 'component')
    ? listSpawnTemplateOptions(scenario)
    : []
  const nodeDurMs = nodePlayDurationMs(node)
  const nodeOptions = scenario.graph.nodes.filter((n) => n.id !== node.id)
  const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  const qteManifest = item.kind === 'qte' ? getComponentManifest(qteSkinId) : undefined
  const qteConfigInputs = (qteManifest?.inputs ?? []).filter((i) => i.key !== 'events' && i.key !== 'defaultEvent')
  const qteLockedEvents = styleLocksQteEvents
    ? ((applyStyleLockedEventParams(inputs, qteSkinId).events as Array<{ id: string; label?: string }> | undefined) ?? qteManifest?.events ?? [])
    : (qteManifest?.events ?? [])
  const qteFirstLabel = qteOutcomes[0]?.label ?? qteLockedEvents[0]?.label ?? '第一档'
  const qteGoodLabel = qteOutcomes.find((o) => o.key === 'good')?.label
    ?? qteLockedEvents.find((e) => e.id === 'good')?.label
    ?? '良好'
  const qtePassLabel = qteOutcomes.find((o) => o.key === 'pass')?.label
    ?? qteLockedEvents.find((e) => e.id === 'pass')?.label
    ?? '完美'

  // 「默认样式方案」里同类型（component 相同）的其它变体——只有 ≥2 个才值得给下拉切（1 个时已经是默认，无需切）。
  const styleComponent = STYLE_COMPONENT[item.kind]
  const styleVariants = styleComponent ? styleVariantsFor(scenario, node, styleComponent) : []
  const currentSkin = el ? el.component : ''
  const currentVariantId = styleVariants.find((v) => {
    if (v.component !== currentSkin) return false
    const vp = Object.fromEntries(Object.entries(v.inputs ?? {}).filter(([k]) => k !== 'component'))
    const cur = Object.fromEntries(Object.entries(inputs).filter(([k]) => k !== 'component'))
    return JSON.stringify(vp) === JSON.stringify(cur)
  })?.id ?? ''

  return (
    <div className="gc-inspector-card">
      <div className="gc-inspector-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span>{materialLabel(item.kind)}</span>
        {item.overridden ? (
          <button
            type="button"
            title="已脱离方案跟随，点击清掉本组件差量、改回跟随共享方案"
            onClick={() => onResetOverride(item)}
            style={{ fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}
          >
            ↺ 回连方案
          </button>
        ) : null}
      </div>
      {item.overridden ? (
        <p className="gc-inspector-hint" style={{ marginTop: -6 }}>
          本控件已脱离共享方案跟随；回连后会重新同步方案原型。
        </p>
      ) : null}
      {styleVariants.length > 1 && (
        <label className="gc-field"><span>方案样式</span>
          <select
            value={currentVariantId}
            onChange={(e) => {
              const v = styleVariants.find((x) => x.id === e.target.value)
              if (!v) return
              onPatch({ ...(v.inputs ?? {}) })
            }}
            title="来自节点「默认样式」方案里同类型的其它变体；切换即整体套用该变体（含皮肤）"
          >
            <option value="">（自定义）</option>
            {styleVariants.map((v, i) => (
              <option key={v.id} value={v.id}>{v.note?.trim() || `样式 ${i + 1}`}</option>
            ))}
          </select>
        </label>
      )}
      {item.kind !== 'qte' ? (
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
      ) : null}

      {item.kind === 'subtitle' && el && (
        <>
          <ComponentFormFields
            componentId={el.component}
            values={inputs}
            onChange={(next) => onPatch(next)}
            pickers={{ entities, variables }}
            excludeKeys={['speaker', 'style', 'x', 'y']}
          />
          <div className="gc-field"><span>样式预设</span>
            <GraphTextStylePicker group="subtitle" value={inputs.style as GraphTextStyle | undefined} onChange={(style) => onPatch({ style })} />
          </div>
          <label className="gc-tsp-check">
            <input type="checkbox" checked={inputs.speaker != null} onChange={(e) => onPatch(e.target.checked ? { speaker: '' } : { speaker: undefined })} />
            <span>显示说话人前缀</span>
          </label>
          {inputs.speaker != null && (
            <label className="gc-field"><span>说话人</span>
              <input value={str(inputs.speaker)} onChange={(e) => onPatch({ speaker: e.target.value })} />
            </label>
          )}
          <PositionEditor
            x={inputs.x as number | undefined}
            y={inputs.y as number | undefined}
            defaultX={SUBTITLE_XY.x}
            defaultY={SUBTITLE_XY.y}
            variant="slider"
            resettable
            onChange={(next) => onPatch(next)}
          />
        </>
      )}

      {item.kind === 'overlay' && el && (
        <>
          <ComponentFormFields
            componentId={el.component}
            values={inputs}
            onChange={(next) => onPatch(next)}
            pickers={{ entities, variables }}
            excludeKeys={['style', 'x', 'y', 'expr']}
          />
          <div className="gc-field"><span>样式预设</span>
            <GraphTextStylePicker group="overlay" value={inputs.style as GraphTextStyle | undefined} onChange={(style) => onPatch({ style })} />
          </div>
          <div className="gc-field"><span>到点效果</span>
            <EffectsEditor value={overlayFx} entities={entities} variables={variables} onChange={(effects) => onPatch({ effects })} />
          </div>
          <p className="gc-inspector-hint">飘字出现时把这些效果广播出去（如给 Boss 的 hp 加负值＝扣血）。留空＝纯展示、不改数值。文案里的 {'{v}'} 默认显示第一条效果的数值。</p>
          <label className="gc-tsp-check">
            <input
              type="checkbox"
              checked={overlayDisplayCustom}
              onChange={(e) => (e.target.checked
                ? onPatch({ expr: str(inputs.expr) || '0' })
                : onPatch({ expr: undefined, valuePick: undefined }))}
            />
            <span>自定义显示数值（默认＝效果值）</span>
          </label>
          {overlayDisplayCustom && (
            <div className="gc-field">
              <span>显示数值</span>
              <FloatValuePickEditor
                valuePick={inputs.valuePick}
                damageValue={str(inputs.expr) ? { expr: str(inputs.expr) } : 0}
                entities={entities}
                variables={variables}
                onChange={({ valuePick, damageValue }) =>
                  onPatch({ valuePick, expr: typeof damageValue === 'number' ? String(damageValue) : damageValue.expr })}
              />
            </div>
          )}
          <PositionEditor
            x={inputs.x as number | undefined}
            y={inputs.y as number | undefined}
            defaultX={OVERLAY_XY.x}
            defaultY={OVERLAY_XY.y}
            onChange={(next) => onPatch(next)}
          />
        </>
      )}

      {item.kind === 'qte' && cue && el && (
        <>
          <label className="gc-field"><span>标签</span>
            <input value={cue.label ?? ''} onChange={(e) => onPatch({ label: e.target.value || undefined })} />
          </label>
          {skinPositioning(qteSkinId) !== 'fixed' && (
            <PositionEditor
              x={cue.x}
              y={cue.y}
              defaultX={skinDefaultAnchor(qteSkinId)?.x ?? 0.5}
              defaultY={skinDefaultAnchor(qteSkinId)?.y ?? 0.55}
              onChange={(next) => onPatch(next)}
            />
          )}
          {/* 配置区 = manifest.inputs（出口 exits 不在 inputs 里，样式锁定） */}
          {styleLocksQteEvents && qteLockedEvents.length > 0 ? (
            <p className="gc-inspector-hint">
              样式出口（只读）：{qteLockedEvents.map((e) => e.label || e.id).join(' · ')}
            </p>
          ) : null}
          {qteConfigInputs.map((input) => {
            if (input.key === 'windowMs') {
              // 时长与「出现 ms」并排，见下方时间区
              return null
            }
            if (input.key === 'perfectMs') {
              return (
                <div key={input.key}>
                  <label className="gc-field">
                    <span>{input.label ?? input.key}</span>
                    <input
                      type="number"
                      min={0}
                      step={10}
                      value={num(inputs.perfectMs, NaN) >= 0 ? (inputs.perfectMs as number) : ''}
                      placeholder="留空=皮肤内置手感"
                      onChange={(e) => onPatch({
                        perfectMs: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value) || 0),
                      })}
                    />
                  </label>
                  <p className="gc-inspector-hint">
                    以命中锚点为中心 ±此毫秒内按下=完美；命中落在显示窗内=良好，窗外/超时=失败。
                  </p>
                </div>
              )
            }
            if (input.valueType === 'number') {
              return (
                <label className="gc-field" key={input.key}>
                  <span>{input.label ?? input.key}</span>
                  <input
                    type="number"
                    value={typeof inputs[input.key] === 'number' ? (inputs[input.key] as number) : ''}
                    onChange={(e) => onPatch({
                      [input.key]: e.target.value === '' ? undefined : Number(e.target.value),
                    })}
                  />
                </label>
              )
            }
            if (input.valueType === 'string') {
              return (
                <label className="gc-field" key={input.key}>
                  <span>{input.label ?? input.key}</span>
                  <input
                    value={str(inputs[input.key])}
                    onChange={(e) => onPatch({ [input.key]: e.target.value || undefined })}
                  />
                </label>
              )
            }
            return null
          })}
          {/* 结算区：只配跳转/改数值；候选 = 样式锁定的 events */}
          <SettlementEditor
            branches={qteOutcomes}
            nodeOptions={nodeOptions}
            spawnTemplates={spawnTemplates}
            overlays={scenario.ui?.overlays}
            nodeDurMs={nodeDurMs}
            entities={entities}
            variables={variables}
            onSetTarget={onSetQteOutcomeTarget}
            onSetEffects={onSetQteOutcomeEffects}
            onSetSpawn={onSetQteOutcomeSpawn}
            removable={() => qteOutcomes.length > 1}
            onRemove={onRemoveQteOutcome}
            addable={{ candidates: qteAvailable.map((c) => ({ key: c.handle, label: c.label })), onAdd: onAddQteOutcome }}
            fallsBackToPassHint={<>未单独配置「{qteGoodLabel}」时，也会按「{qtePassLabel}」结算。</>}
            hint={styleLocksQteEvents
              ? '出口由样式锁定；此处只配跳转与改数值'
              : `默认可配「${qteFirstLabel}」且不跳转；未配「${qteGoodLabel}」时按「${qtePassLabel}」结算`}
          />
          {styleLocksQteEvents ? (
            <>
              <p className="gc-inspector-hint">出现=整段出现（左缘）· 时长=收圈总时长（超过未按任一键＝超时/未命中档）。</p>
              <div className="gc-field-row">
                <label><span>出现 ms</span>
                  <input type="number" min={0} step={100} value={cue.appearAt ?? 0}
                    onChange={(e) => {
                      const appearAt = Math.max(0, Number(e.target.value) || 0)
                      const windowMs = num(inputs.windowMs, 2600)
                      onPatch({ appearAt, endAt: appearAt + windowMs })
                    }} />
                </label>
                <label><span>{qteConfigInputs.find((i) => i.key === 'windowMs')?.label ?? '时长 ms'}</span>
                  <input type="number" min={200} step={100} value={num(inputs.windowMs, 2600)}
                    onChange={(e) => {
                      const windowMs = Math.max(200, Number(e.target.value) || 2600)
                      onPatch({ windowMs, endAt: (cue.appearAt ?? 0) + windowMs })
                    }} />
                </label>
              </div>
            </>
          ) : (
            <>
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
            </>
          )}
          <button type="button" className="gc-mini-danger" onClick={() => onRemoveQteCue(cue.id)}>删除当前按键点</button>
        </>
      )}

      {item.kind === 'filter' && el && (
        <>
          <p className="gc-inspector-hint">在这段时间内给整帧画面调色，强度 0=原图、1=最强。效果在上方预览实时可见。</p>
          <ComponentFormFields
            componentId={el.component}
            values={inputs}
            onChange={(next) => onPatch(next)}
            pickers={{ entities, variables }}
          />
        </>
      )}

      {item.kind === 'fx' && el && (
        <>
          <p className="gc-inspector-hint">画面特效叠加在视频上，强度 0~1。效果在上方预览实时可见。</p>
          <ComponentFormFields
            componentId={el.component}
            values={inputs}
            onChange={(next) => onPatch(next)}
            pickers={{ entities, variables }}
            excludeKeys={fxNeedsColor(str(inputs.fx) || 'flash') ? undefined : ['color']}
          />
        </>
      )}

      {item.kind === 'option' && el && (
        <>
          <ComponentFormFields
            componentId={el.component}
            values={inputs}
            onChange={(next) => onPatch(next)}
            pickers={{ entities, variables }}
            excludeKeys={['presentation', 'x', 'y', 'timeoutMs', 'defaultEvent', 'events']}
          />
          <PositionEditor
            x={inputs.x as number | undefined}
            y={inputs.y as number | undefined}
            defaultX={OPTION_XY.x}
            defaultY={OPTION_XY.y}
            onChange={(next) => onPatch(next)}
          />
          {!styleLocksOptions && (
            <label className="gc-field"><span>呈现</span>
              <select value={str(inputs.presentation) || 'list'} onChange={(e) => onPatch({ presentation: e.target.value })}>
                <option value="list">清单</option>
                <option value="hotspot">画面热区</option>
              </select>
            </label>
          )}
          <label className="gc-field"><span>倒计时 ms（0=不限时）</span>
            <input type="number" min={0} step={100} value={num(inputs.timeoutMs, 0) || ''} placeholder="不限时"
              onChange={(e) => onPatch({ timeoutMs: e.target.value === '' ? undefined : Number(e.target.value) })} />
          </label>
          <SettlementEditor
            branches={branches}
            nodeOptions={nodeOptions}
            spawnTemplates={spawnTemplates}
            overlays={scenario.ui?.overlays}
            nodeDurMs={nodeDurMs}
            entities={entities}
            variables={variables}
            onSetTarget={onSetBranchTarget}
            onSetEffects={onSetBranchEffects}
            onSetSpawn={onSetBranchSpawn}
            labelEditable={!styleLocksOptions}
            onSetLabel={onSetBranchLabel}
            removable={() => !styleLocksOptions && branches.length > 1}
            onRemove={!styleLocksOptions ? onRemoveBranch : undefined}
            hint={`${branches.length} 条 · 每条选项可独立跳转 / 改数值${styleLocksOptions ? ' · 选项由皮肤决定' : '；默认不跳转'}`}
          />
          {!styleLocksOptions && (
            <button type="button" className="gc-add-branch-btn" onClick={onAddBranch}>＋ 添加选项</button>
          )}
        </>
      )}

      {item.kind === 'component' && el && (
        <>
          <p className="gc-inspector-hint">
            组件 · {item.componentId || el.component}
          </p>
          <PositionEditor
            x={inputs.x as number | undefined}
            y={inputs.y as number | undefined}
            defaultX={0.5}
            defaultY={0.5}
            onChange={(next) => onPatch(next)}
          />
          <ComponentFormFields
            componentId={item.componentId || el.component}
            values={inputs}
            onChange={(next) => onPatch(next)}
            pickers={{ entities, variables }}
            excludeKeys={['x', 'y', 'events', 'defaultEvent']}
          />
          {componentEvents.length > 0 ? (
            <SettlementEditor
              branches={componentEvents}
              nodeOptions={nodeOptions}
              spawnTemplates={spawnTemplates}
              overlays={scenario.ui?.overlays}
              nodeDurMs={nodeDurMs}
              entities={entities}
              variables={variables}
              labelColumnWidth={72}
              onSetTarget={onSetBranchTarget}
              onSetEffects={onSetBranchEffects}
              onSetSpawn={onSetBranchSpawn}
              hint={`${componentEvents.length} 条事件 · 跳转 / 改数值 / 显示组件`}
            />
          ) : null}
        </>
      )}
        </div>
      )
}

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

      function EmptyPreview({text}: {text: string }): JSX.Element {
  return (
      <div className="gc-stage gc-empty-preview">
        <div className="gc-empty-note">{text}</div>
      </div>
      )
}
