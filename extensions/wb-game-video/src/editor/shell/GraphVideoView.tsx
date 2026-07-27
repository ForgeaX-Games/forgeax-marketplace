/**
 * GraphVideoView —— 「新引擎 › 视频」= 视频素材编辑器（UI/交互对齐旧 VideoCatalogTab）。
 *
 * 保留素材库、纯视频预览、提示词与图片参考；不再承载节点绑定、组件编辑或时间轴能力。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useT } from '../../i18n'
import { useGraphScenario } from '../persist/graphScenarioStore'
import { getGameSlug } from '../persist/gameScope'
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
import { GraphVideoGenerationPanel } from './GraphVideoGenerationPanel'
import {
  GraphVideoPreviewPanel,
} from './GraphVideoPreviewPanel'
import { bootEditorSkins } from '../init'
import { injectStyleOnce } from '../../styles/injectStyle'
import { CATALOG_CSS } from './catalogCss'
import { GRAPH_VIDEO_VIEW_CSS } from './graphVideoViewStyles'
import type { GameScenario } from '../../runtime/schema/graph-schema'
import {
  findNode,
  setNodePromptGraph,
} from '../video/graphMaterialOps'

// 「添加控件」/「重新生成」右列与检视器同槽切换（对齐 main 生成面板）。
// 复用视频 tab 的 --gc-* token；不改 CatalogTabs 的全局 CSS，样式自持。
// 视频 tab 的基础栏目/预览台样式（gc-*）复用共享 CATALOG_CSS（原旧 forge/CatalogTabs 全局 CSS）。
// 注册全部组件包（含 filter/fx）；幂等。
bootEditorSkins()

injectStyleOnce('graph-catalog', CATALOG_CSS)
injectStyleOnce('graph-video-view', GRAPH_VIDEO_VIEW_CSS)

interface VideoEntry extends VideoLibraryEntry {}

export function GraphVideoView(): JSX.Element {
  const t = useT()
  const generatedGroup = t('videoAssets.group.generated')
  const uploadGroup = t('videoAssets.group.upload')
  const game = useMemo(() => getGameSlug() ?? 'game-nodia-fighting', [])
  const videoController = useVideoAssets(game)
  const [regAssets, setRegAssets] = useState<MediaAsset[]>([])
  const [genBusy, setGenBusy] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  // 游戏级风格三轴（P3）：加载 manifest.styleAxes，改动即写回；喂给生成请求。
  const [styleAxes, setStyleAxes] = useState<StyleAxes>({})
  const listBodyRef = useRef<HTMLDivElement | null>(null)
  const [selectedId, setSelectedId] = useState<string>('')
  const [playheadMs, setPlayheadMs] = useState(0)
  const [videoDurationMs, setVideoDurationMs] = useState<number | null>(null)

  const graph = useGraphScenario((s) => s.graph)
  const setScenario = useGraphScenario((s) => s.setScenario)
  // 选中节点来自 graph 共享 store（不再依赖旧 scenarioStore）；无选中则落到首个节点。
  const selectedNodeId = useGraphScenario((s) => s.selectedNodeId)
  const selectedSceneId = selectedNodeId ?? graph.nodes[0]?.id ?? ''

  const node = findNode(graph, selectedSceneId)
  const scenario = useMemo<GameScenario>(
    () => ({ version: 'wb-game-video.graph.v1', graph }),
    [graph],
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

  function updateAxis(axis: keyof StyleAxes, value: string): void {
    const next: StyleAxes = { ...styleAxes, [axis]: value || undefined }
    setStyleAxes(next)
    void setGameStyleAxes(game, { [axis]: value || undefined } as StyleAxes)
  }

  const characterRefs = useMemo(() => regAssets.filter((a) => a.productionType === 'character_ref'), [regAssets])
  const sceneRefs = useMemo(() => regAssets.filter((a) => a.productionType === 'scene_ref'), [regAssets])

  // 载入游戏级风格三轴（一次）。
  useEffect(() => {
    let alive = true
    void getGameStyleAxes(game).then((a) => { if (alive && a) setStyleAxes(a) })
    return () => { alive = false }
  }, [game])

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

  const supplementalEntries = useMemo<VideoLibraryEntry[]>(() => {
    return regAssets
      .filter((a) => a.kind === 'video' && a.productionType === 'video_clip')
      .map((v) => ({
        id: v.id,
        label: v.label ?? v.id,
        url: v.status === 'ready' ? registryMediaUrl(v.id, game) : '',
        group: generatedGroup,
        status: v.status,
        fromRegistry: true,
        durMs: v.durationMs,
      }))
  }, [regAssets, game, generatedGroup])

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
        group: uploadGroup,
        fromApi: true,
        durMs: item.durMs,
        type: item.type,
        updatedAt: item.updatedAt,
      })
    }
    for (const entry of supplementalEntries) push(entry)
    return out
  }, [supplementalEntries, videoController.items, uploadGroup])

  const selectedEntry = entries.find((e) => e.id === selectedId)
  const timelineEntry = selectedEntry
  const previewSrc = timelineEntry?.url
    || (timelineEntry?.fromRegistry ? registryMediaUrl(timelineEntry.id, game) : undefined)
    || (timelineEntry ? resolveMediaSrc(timelineEntry.id, game) : undefined)
  const maxMs = Math.max(1000, videoDurationMs ?? timelineEntry?.durMs ?? node?.data.durationMs ?? 0)
  useEffect(() => {
    setVideoDurationMs(null)
    setPlayheadMs(0)
  }, [timelineEntry?.id])

  // 视频页保留素材生成，不再把生成结果绑定到当前图节点。
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
      setRegAssets(await listRegistryAssets(game))
      setSelectedId(asset.id)
    } catch (e) {
      setGenError((e as Error).message)
    } finally {
      setGenBusy(false)
    }
  }

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

  function updatePrompt(prompt: string): void {
    const state = useGraphScenario.getState()
    const current = { ...state.authoringScenario(), graph: state.graph }
    const currentNode = findNode(current.graph, selectedSceneId)
    if (currentNode) setScenario(setNodePromptGraph(current, currentNode, prompt))
  }

  return (
    <div className="gc-tab gc-tab-video">
      <VideoAssetLibrary
        gameId={game}
        scenario={scenario}
        supplementalEntries={supplementalEntries}
        selectedId={selectedId}
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
                <div className="gc-video-sub">素材预览</div>
              </div>
            </div>
            <div className="gc-video-top">
              <GraphVideoPreviewPanel
                timelineEntry={timelineEntry}
                previewEntry={selectedEntry}
                previewSrc={previewSrc}
                maxMs={maxMs}
                playheadMs={playheadMs}
                uploading={videoController.uploading}
                onReplace={videoController.replaceResource}
                onPlayheadChange={setPlayheadMs}
                onDurationChange={(ms) => {
                  setVideoDurationMs(ms)
                }}
              />
              <GraphVideoGenerationPanel
                game={game}
                enabled={Boolean(node)}
                prompt={node?.data.media?.prompt ?? ''}
                styleAxes={styleAxes}
                characterRefs={characterRefs}
                sceneRefs={sceneRefs}
                generationBusy={genBusy}
                generationError={genError}
                onPromptChange={updatePrompt}
                onStyleAxisChange={updateAxis}
                onImportRefs={importRefs}
                onAssetsChanged={refreshRegistryAssets}
                onAssetDeleted={removeRegistryAsset}
                onGenerateVideo={generateVideoForNode}
                onGenerateStoryboard={generateStoryboardForNode}
              />
            </div>
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
