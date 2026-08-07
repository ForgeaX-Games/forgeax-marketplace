/**
 * GraphVideoView —— 「新引擎 › 视频」= 视频素材编辑器（UI/交互对齐旧 VideoCatalogTab）。
 *
 * 保留素材库和全屏视频预览；不再承载节点绑定、生成配置或组件编辑能力。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useT } from '../../i18n'
import { useGraphScenario } from '../persist/graphScenarioStore'
import { useGraphView } from '../persist/graphViewStore'
import {
  VideoAssetLibrary,
  type VideoLibraryEntry,
} from '../assets/VideoAssetLibrary'
import { useVideoAssets } from '../assets/useVideoAssets'
import { createKinoVideoClient } from '../assets/kino-api'
import { VideoExternalImportDialog } from '../assets/VideoExternalImportDialog'
import { useVideoGenerationWorkspace } from '../assets/generation/useVideoGenerationWorkspace'
import { consumeVideoAssetSelection } from '../assets/generation/videoGenerationNavigation'
import {
  VideoGenSheet,
} from '../assets/generation/VideoGenSheet'
import {
  resolveMediaSrc,
  registryMediaUrl,
} from './media'
import {
  GraphVideoPreviewPanel,
} from './GraphVideoPreviewPanel'
import { bootEditorSkins } from '../init'
import { injectStyleOnce } from '../../styles/injectStyle'
import { CATALOG_CSS } from './catalogCss'
import { GRAPH_VIDEO_VIEW_CSS } from './graphVideoViewStyles'
import type { GameScenario } from '../../runtime/schema/graph-schema'

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
  const game = useGraphScenario((s) => s.game)
  const videoController = useVideoAssets(game)
  const kinoClient = useMemo(() => createKinoVideoClient(), [])
  const setView = useGraphView((state) => state.setView)
  const { regAssets, imageAssets, recentClips, clipGeneration } = useVideoGenerationWorkspace(game, videoController)
  const listBodyRef = useRef<HTMLDivElement | null>(null)
  const [selectedId, setSelectedId] = useState<string>(() => consumeVideoAssetSelection() ?? '')
  const [genSheetOpen, setGenSheetOpen] = useState(false)
  const [externalImportOpen, setExternalImportOpen] = useState(false)
  const [videoDurationMs, setVideoDurationMs] = useState<number | null>(null)
  const [fullscreenRequest, setFullscreenRequest] = useState<{ id: string, nonce: number } | null>(null)

  const graph = useGraphScenario((s) => s.graph)
  const scenario = useMemo<GameScenario>(
    () => ({ version: 'wb-game-video.graph.v1', graph }),
    [graph],
  )

  // 共享素材层轮询、生成参考图与最近任务由 generation workspace 统一维护。

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
  const maxMs = Math.max(1000, videoDurationMs ?? timelineEntry?.durMs ?? 0)
  useEffect(() => {
    setVideoDurationMs(null)
  }, [timelineEntry?.id])

  function handleVideoDeleted(id: string): void {
    if (selectedId === id) {
      setSelectedId('')
    }
  }

  return (
    <div className="gc-tab gc-tab-video val-video-workspace">
      <VideoAssetLibrary
        gameId={game}
        scenario={scenario}
        supplementalEntries={supplementalEntries}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onOpenPreview={(id) => setFullscreenRequest((current) => ({ id, nonce: (current?.nonce ?? 0) + 1 }))}
        onOpenGenerate={() => {
          setGenSheetOpen(true)
          setView('video-generate')
        }}
        onOpenExternalImport={() => setExternalImportOpen(true)}
        onDeleted={handleVideoDeleted}
        controller={videoController}
        listBodyRef={listBodyRef}
      />
      {timelineEntry ? (
        <GraphVideoPreviewPanel
          timelineEntry={timelineEntry}
          previewEntry={selectedEntry}
          previewSrc={previewSrc}
          maxMs={maxMs}
          fullscreenRequest={fullscreenRequest?.id === timelineEntry.id ? fullscreenRequest.nonce : undefined}
          fullscreenOnly
          uploading={videoController.uploading}
          onReplace={videoController.replaceResource}
          onDurationChange={setVideoDurationMs}
        />
      ) : null}
      <VideoGenSheet
        open={genSheetOpen}
        gameSlug={game}
        imageAssets={imageAssets}
        recentClips={recentClips}
        genState={clipGeneration.state}
        onSubmit={clipGeneration.submit}
        onCancel={clipGeneration.cancel}
        onTrack={clipGeneration.track}
        onClose={() => setGenSheetOpen(false)}
        onLocateAsset={(assetId) => {
          setSelectedId(assetId)
          setGenSheetOpen(false)
        }}
      />
      <VideoExternalImportDialog
        open={externalImportOpen}
        targetGameId={game}
        client={kinoClient}
        onImport={async (source, name) => {
          const imported = await videoController.importExternal(source, name)
          if (imported) {
            setSelectedId(imported.resource_id)
          }
          return imported
        }}
        onClose={() => setExternalImportOpen(false)}
      />
    </div>
  )
}
