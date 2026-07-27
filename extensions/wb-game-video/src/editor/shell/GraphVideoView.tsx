/**
 * GraphVideoView —— 「新引擎 › 视频」= 视频素材编辑器（UI/交互对齐旧 VideoCatalogTab）。
 *
 * 与旧视频 tab 一模一样的外壳（左栏视频库 + 中栏预览台 + 5 轨 MaterialTimeline + 右侧检视器），
 * 但**数据全程走 graph**：编辑的是 `selectedSceneId` 对应的演出节点（`node.id === scene.id`），
 * 读投影 + 写映射都在 `./video/graphMaterialOps` 上，写回 `graphScenarioStore.setGraph`。
 * 旧 VideoCatalogTab 仍被旧侧栏「视频」tab 使用、保持零 diff；这里是端口化的一份并存实现。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useGraphScenario, useGraphHistory, graphUndo, graphRedo, graphHistoryClear } from '../persist/graphScenarioStore'
import { getGameSlug } from '../persist/gameScope'
import { ZHANDOU_VIDEOS } from '../assets/catalog'
import {
  VideoAssetLibrary,
  type VideoLibraryEntry,
} from '../assets/VideoAssetLibrary'
import { useVideoAssets } from '../assets/useVideoAssets'
import {
  listRegistryAssets,
  requestGenerateVideo,
  requestGenerateKeyframe,
  getGameStyleAxes,
  setGameStyleAxes,
  importCharacterRefs,
  importSceneRefs,
  resolveMediaSrc,
  registryMediaUrl,
} from './media'
import type { MediaAsset, StyleAxes } from '../assets/registry-types'
import { MaterialTimeline } from '../video/MaterialTimeline'
import {
  type AudioItem,
  type MaterialItem,
  materialClass,
  materialLabel,
} from '../video/materialTimelineShared'
import type { DefaultStyleSlot } from './defaultStyleSlots'
import { GraphMaterialLibraryPanel } from './GraphMaterialLibraryPanel'
import { GraphMaterialInspector } from './GraphMaterialInspector'
import { GraphVideoGenerationPanel } from './GraphVideoGenerationPanel'
import {
  GraphVideoPreviewPanel,
  type GraphVideoPreviewPanelHandle,
} from './GraphVideoPreviewPanel'
import { bootEditorSkins } from '../init'
import { injectStyleOnce } from '../../styles/injectStyle'
import { CATALOG_CSS } from './catalogCss'
import { GRAPH_VIDEO_VIEW_CSS } from './graphVideoViewStyles'
import type { GameScenario } from '../../runtime/schema/graph-schema'
import type { Formula } from '../persist/formula-authoring'
import {
  collectMaterialsFromNode,
  findNode,
  listSchemeMountTabs,
  qteElement,
} from '../video/graphMaterialOps'
import { useGraphVideoEditorActions } from './useGraphVideoEditorActions'

// 「添加控件」/「重新生成」右列与检视器同槽切换（对齐 main 生成面板）。
// 复用视频 tab 的 --gc-* token；不改 CatalogTabs 的全局 CSS，样式自持。
// 视频 tab 的基础栏目/预览台样式（gc-*）复用共享 CATALOG_CSS（原旧 forge/CatalogTabs 全局 CSS）。
// 注册全部组件包（含 filter/fx）；幂等。
bootEditorSkins()

injectStyleOnce('graph-catalog', CATALOG_CSS)
injectStyleOnce('graph-video-view', GRAPH_VIDEO_VIEW_CSS)

interface VideoEntry extends VideoLibraryEntry {}

// 时间轴编辑暂时从视频 Tab 隐藏；保留组件和数据链路，待迁入蓝图节点后再启用。
const SHOW_TIMELINE = false

function refForEntry(entry: VideoEntry): string {
  // demo 统一按 basename 引用；绑定即把节点 media.ref 设为该视频文件名。
  return entry.id
}

export function GraphVideoView(): JSX.Element {
  const game = useMemo(() => getGameSlug() ?? 'game-nodia-fighting', [])
  const videoController = useVideoAssets(game)
  const [regAssets, setRegAssets] = useState<MediaAsset[]>([])
  const [genBusy, setGenBusy] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  // 游戏级风格三轴（P3）：加载 manifest.styleAxes，改动即写回；喂给生成请求。
  const [styleAxes, setStyleAxes] = useState<StyleAxes>({})
  const listBodyRef = useRef<HTMLDivElement | null>(null)
  const previewPanelRef = useRef<GraphVideoPreviewPanelHandle | null>(null)
  const [selectedId, setSelectedId] = useState<string>('')
  // 右列：生成页 / 检视器；速创与导演暂共用同一生成页。
  const [topPanel, setTopPanel] = useState<'library' | 'prompt' | 'inspector'>('prompt')
  const [generationTab, setGenerationTab] = useState<'quick' | 'director'>('quick')
  // 「添加控件」二级栏：'default' = 六个默认样式快建卡片；其它 = 某个已挂载方案的 mountId
  // （该方案目录里的组件，拖入即克隆一份保留绑定等输入）。
  const [addTab, setAddTab] = useState<string>('default')
  const [selectedMaterialKey, setSelectedMaterialKey] = useState<string | null>(null)
  const [playheadMs, setPlayheadMs] = useState(0)
  const [videoDurationMs, setVideoDurationMs] = useState<number | null>(null)
  // 时间轴模式：组件 / 音频（音频仅显示 + 拖动，不做实际音频编辑）。
  const [timelineMode, setTimelineMode] = useState<'material' | 'audio'>('material')
  // 音频条为本地展示态：换节点/换素材时按素材时长重建（不写回 graph）。
  const [audioItems, setAudioItems] = useState<AudioItem[]>([])

  // 撤销/重做历史深度（驱动按钮 disabled）。
  const canUndo = useGraphHistory((s) => s.pastStates.length > 0)
  const canRedo = useGraphHistory((s) => s.futureStates.length > 0)
  const loadEpoch = useGraphScenario((s) => s.loadEpoch)

  const graph = useGraphScenario((s) => s.graph)
  const blueprints = useGraphScenario((s) => s.blueprints)
  const mainBlueprintId = useGraphScenario((s) => s.mainBlueprintId)
  const overlays = useGraphScenario((s) => s.meta.ui?.overlays)
  const setScenario = useGraphScenario((s) => s.setScenario)
  const entities = useGraphScenario((s) => s.meta.entities)
  const variables = useGraphScenario((s) => s.meta.variables)
  // meta.formulas 在 schema 里存为 `Record<string, unknown>`（runtime ↛ editor）；编辑器侧窄化回 Formula。
  const formulas = useGraphScenario((s) => s.meta.formulas) as Record<string, Formula> | undefined
  // 选中节点来自 graph 共享 store（不再依赖旧 scenarioStore）；无选中则落到首个节点。
  const selectedNodeId = useGraphScenario((s) => s.selectedNodeId)
  const selectedSceneId = selectedNodeId ?? graph.nodes[0]?.id ?? ''

  const node = findNode(graph, selectedSceneId)
  // 读投影只需 graph + ui.overlays；随两者变化重建，不必拉全量 scenario（省一次深拷贝）。
  const scenario = useMemo<GameScenario>(
    () => ({ version: 'wb-game-video.graph.v1', graph, ui: { overlays: overlays ?? {} } }),
    [graph, overlays],
  )

  // 共享素材层轮询（mtime 级 5s）：驱动生成中占位 + 角色/场景参考图。
  useEffect(() => {
    let alive = true
    const pull = async (): Promise<void> => {
      const all = await listRegistryAssets(game)
      if (!alive) return
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

  async function refreshRegistryAssets(): Promise<void> {
    setRegAssets(await listRegistryAssets(game))
  }

  function removeRegistryAsset(assetId: string): void {
    setRegAssets((assets) => assets.filter((asset) => asset.id !== assetId))
  }

  const bundledEntries = useMemo<VideoLibraryEntry[]>(() => {
    const clips: VideoLibraryEntry[] = []
    const narr: VideoLibraryEntry[] = []
    for (const [id, url] of Object.entries(ZHANDOU_VIDEOS)) {
      const isNarr = id.startsWith('narr-')
      ;(isNarr ? narr : clips).push({ id, label: id, url, group: isNarr ? '叙事' : '战斗', bundled: true })
    }
    return [...clips, ...narr]
  }, [])

  const supplementalEntries = useMemo<VideoLibraryEntry[]>(() => {
    return regAssets
      .filter((a) => a.kind === 'video' && a.productionType === 'video_clip')
      .map((v) => ({
        id: v.id,
        label: v.label ?? v.id,
        url: v.status === 'ready' ? registryMediaUrl(v.id, game) : '',
        group: '生成',
        status: v.status,
        fromRegistry: true,
        durMs: v.durationMs,
      }))
  }, [regAssets, game])

  const entries = useMemo<VideoEntry[]>(() => {
    const seen = new Set<string>()
    const out: VideoEntry[] = []
    const push = (entry: VideoLibraryEntry): void => {
      if (seen.has(entry.id)) return
      seen.add(entry.id)
      out.push(entry)
    }
    for (const item of videoController.items) {
      push({
        id: item.id,
        label: item.label,
        url: item.url,
        group: '上传',
        fromApi: true,
        durMs: item.durMs,
        type: item.type,
        updatedAt: item.updatedAt,
      })
    }
    for (const entry of bundledEntries) push(entry)
    for (const entry of supplementalEntries) push(entry)
    return out
  }, [bundledEntries, supplementalEntries, videoController.items])

  const boundRef = node?.data.media?.ref
  const boundBare = boundRef?.startsWith('m-') ? boundRef.slice(2) : boundRef
  const boundEntry = entries.find((e) => e.id === boundBare) ?? entries.find((e) => e.id === boundRef)
  const selectedEntry = entries.find((e) => e.id === selectedId)
  const previewEntry = selectedEntry ?? boundEntry
  const editingBoundClip = Boolean(boundEntry && previewEntry && boundEntry.id === previewEntry.id)
  const timelineEntry = editingBoundClip ? boundEntry : previewEntry
  const previewSrc = timelineEntry?.url
    || (timelineEntry?.fromRegistry ? registryMediaUrl(timelineEntry.id, game) : undefined)
    || (timelineEntry ? resolveMediaSrc(timelineEntry.id, game) : undefined)
  const maxMs = Math.max(1000, videoDurationMs ?? timelineEntry?.durMs ?? node?.data.durationMs ?? 0)
  const hasEditableVideo = Boolean(node && editingBoundClip && timelineEntry)
  const isTimedQteNode = Boolean(qteElement(scenario, node))

  const materials = useMemo(() => collectMaterialsFromNode(scenario, node, maxMs), [scenario, node, maxMs])
  // 「添加控件」二级栏：每个已挂载方案一个 tab，tab 下是该方案目录里的组件（可拖入克隆）。
  const schemeMountTabs = useMemo(() => listSchemeMountTabs(scenario, node), [scenario, node])
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
  }, [timelineEntry?.id, selectedSceneId, editingBoundClip])

  // 换节点 → 清选中 + 回到提示词面板；遗留「添加控件」页不再作为默认入口。
  useEffect(() => { setSelectedMaterialKey(null); setTopPanel('prompt'); setTimelineMode('material') }, [selectedSceneId])

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

  const editorActions = useGraphVideoEditorActions({
    scenario,
    node,
    selectedSceneId,
    maxMs,
    entities,
    playheadMs,
    materials,
    selectedMaterial,
    selectedMaterialKey,
    hasEditableVideo,
    isTimedQteNode,
    onScenarioChange: setScenario,
    onSelectedMaterialKeyChange: setSelectedMaterialKey,
    onTopPanelChange: setTopPanel,
  })

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
      editorActions.bindVideo(asset.id, asset.durationMs ?? maxMs)
      setRegAssets(await listRegistryAssets(game))
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
      setRegAssets(await listRegistryAssets(game))
    } catch (e) {
      setGenError((e as Error).message)
    } finally {
      setGenBusy(false)
    }
  }

  function handleVideoDeleted(id: string): void {
    if (selectedId === id) {
      setSelectedId('')
    }
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

  function seekTo(ms: number): void {
    previewPanelRef.current?.seekTo(ms)
  }
  function pauseForScrub(): void {
    previewPanelRef.current?.pause()
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

  return (
    <div className="gc-tab gc-tab-video">
      <VideoAssetLibrary
        gameId={game}
        scenario={scenario}
        blueprints={blueprints}
        mainPackId={mainBlueprintId}
        bundledEntries={bundledEntries}
        supplementalEntries={supplementalEntries}
        selectedId={selectedId}
        boundId={boundBare ?? boundRef}
        onSelect={setSelectedId}
        onDeleted={handleVideoDeleted}
        controller={videoController}
        listBodyRef={listBodyRef}
      />
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
                  <div className="gvv-toolseg" role="group" aria-label="视频生成方式">
                    <button
                      type="button"
                      className={generationTab === 'quick' ? 'is-on' : ''}
                      aria-pressed={generationTab === 'quick'}
                      onClick={() => {
                        setGenerationTab('quick')
                        setTopPanel('prompt')
                      }}
                    >
                      速创
                    </button>
                    <button
                      type="button"
                      className={generationTab === 'director' ? 'is-on' : ''}
                      aria-pressed={generationTab === 'director'}
                      onClick={() => {
                        setGenerationTab('director')
                        setTopPanel('prompt')
                      }}
                    >
                      导演
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="gc-action"
                    onClick={() => {
                      if (node && previewEntry) {
                        editorActions.bindVideo(refForEntry(previewEntry), previewEntry.durMs ?? maxMs)
                      }
                    }}
                  >
                    {node ? '绑定到当前节点' : '选择节点后绑定'}
                  </button>
                )}
              </div>
            </div>
            <div className="gc-video-top">
              <GraphVideoPreviewPanel
                ref={previewPanelRef}
                timelineEntry={timelineEntry}
                previewEntry={previewEntry}
                previewSrc={previewSrc}
                scenario={scenario}
                node={node}
                graphOverlays={overlays}
                editingBoundClip={editingBoundClip}
                maxMs={maxMs}
                playheadMs={playheadMs}
                selectedMaterialKey={selectedMaterialKey}
                uploading={videoController.uploading}
                onReplace={videoController.replaceResource}
                onPlayheadChange={setPlayheadMs}
                onDurationChange={(ms) => {
                  setVideoDurationMs(ms)
                  if (node && editingBoundClip && node.data.durationMs !== ms) {
                    editorActions.bindVideo(node.data.media?.ref ?? '', ms)
                  }
                }}
                onSelectMaterial={handleSelectMaterial}
                onMoveOverlay={editorActions.moveOverlay}
              />
              {editingBoundClip && topPanel === 'inspector' && selectedMaterial ? (
                <div className="gvv-toolpanel">
                  <span className="gvv-toolpanel-head">素材属性</span>
                  <GraphMaterialInspector
                    scenario={scenario}
                    node={node}
                    item={selectedMaterial}
                    entities={entities}
                    variables={variables}
                    formulas={formulas}
                    onPatch={editorActions.patchSelected}
                    onPatchLayout={editorActions.patchSelectedLayout}
                    onTiming={(item, start, end) =>
                      editorActions.patchMaterial(item, { startMs: start, endMs: end })}
                    onResetOverride={editorActions.resetMaterialOverride}
                    onRemoveQteCue={editorActions.removeQteCue}
                    onAddBranch={editorActions.addBranch}
                    onSetBranchLabel={editorActions.setBranchLabel}
                    onSetBranchTarget={editorActions.setBranchTarget}
                    onSetBranchEffects={editorActions.setBranchEffects}
                    onSetBranchSpawn={editorActions.setBranchSpawn}
                    onRemoveBranch={editorActions.removeBranch}
                    onSyncChoiceStyleLocked={editorActions.syncChoiceStyleLocked}
                    onSetQteOutcomeTarget={editorActions.setQteOutcomeTarget}
                    onSetQteOutcomeEffects={editorActions.setQteOutcomeEffects}
                    onSetQteOutcomeSpawn={editorActions.setQteOutcomeSpawn}
                    onAddQteOutcome={editorActions.addQteOutcome}
                    onRemoveQteOutcome={editorActions.removeQteOutcome}
                  />
                </div>
              ) : editingBoundClip && topPanel === 'library' ? (
                <GraphMaterialLibraryPanel
                  addTab={addTab}
                  schemeMountTabs={schemeMountTabs}
                  defaultSlotDisabledReason={DEFAULT_SLOT_DISABLED_REASON}
                  addDisabledReason={addDisabled}
                  onAddTabChange={setAddTab}
                  onAddMaterial={editorActions.addMaterial}
                />
              ) : (
                <GraphVideoGenerationPanel
                  game={game}
                  enabled={Boolean(node)}
                  prompt={node?.data.media?.prompt ?? ''}
                  styleAxes={styleAxes}
                  characterRefs={characterRefs}
                  sceneRefs={sceneRefs}
                  generationBusy={genBusy}
                  generationError={genError}
                  onPromptChange={editorActions.setPrompt}
                  onStyleAxisChange={updateAxis}
                  onImportRefs={importRefs}
                  onAssetsChanged={refreshRegistryAssets}
                  onAssetDeleted={removeRegistryAsset}
                  onGenerateVideo={generateVideoForNode}
                  onGenerateStoryboard={generateStoryboardForNode}
                />
              )}
            </div>
            {SHOW_TIMELINE && editingBoundClip ? (
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
                onPatchMaterial={editorActions.patchMaterial}
                onDeleteMaterial={editorActions.deleteMaterial}
                onDropTemplate={editorActions.addMaterialAt}
              />
            ) : SHOW_TIMELINE ? (
              <div className="gc-readonly-note">这是素材预览。绑定到当前节点后可编辑时间轴控件。</div>
            ) : null}
          </div>
        ) : (
          <EmptyPreview text="选择一个视频素材以预览" />
        )}
      </section>
    </div>
  )
}

      function EmptyPreview({text}: {text: string }): JSX.Element {
  return (
      <div className="gc-stage gc-empty-preview">
        <div className="gc-empty-note">{text}</div>
      </div>
      )
}
