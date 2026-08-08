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
  useVideoLibraryNav,
  type VideoLibraryFolderTarget,
} from '../persist/videoLibraryNavStore'
import {
  VideoAssetLibrary,
  type VideoLibraryEntry,
} from '../assets/VideoAssetLibrary'
import { useVideoAssets } from '../assets/useVideoAssets'
import type { VideoAssetsController } from '../assets/useVideoAssets'
import { createKinoVideoClient } from '../assets/kino-api'
import { VideoExternalImportDialog } from '../assets/VideoExternalImportDialog'
import { consumeVideoAssetSelection } from '../assets/generation/videoGenerationNavigation'
import { useVideoGenerationStore } from '../assets/generation/videoGenerationStore'
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

const EMPTY_GENERATION_TASKS: readonly never[] = []

function activeFolderFor(target: VideoLibraryFolderTarget): string {
  return target.kind === 'all' ? 'all' : target.kind === 'untagged' ? 'untagged' : target.name
}

function folderTargetFor(activeFolder: string): VideoLibraryFolderTarget {
  return activeFolder === 'all'
    ? { kind: 'all' }
    : activeFolder === 'untagged'
      ? { kind: 'untagged' }
      : { kind: 'tag', name: activeFolder }
}

function GraphVideoViewContent({ videoController }: { videoController: VideoAssetsController }): JSX.Element {
  const t = useT()
  const generatedGroup = t('videoAssets.group.generated')
  const uploadGroup = t('videoAssets.group.upload')
  const game = useGraphScenario((s) => s.game)
  const kinoClient = useMemo(() => createKinoVideoClient(), [])
  const setView = useGraphView((state) => state.setView)
  const requestedFolder = useVideoLibraryNav((state) => state.folder)
  const requestedEntryId = useVideoLibraryNav((state) => state.entryId)
  const setVideoLocation = useVideoLibraryNav((state) => state.setLocation)
  const generationEntry = useVideoGenerationStore((state) => state.byGame[game])
  const generationTasks = generationEntry?.tasks ?? EMPTY_GENERATION_TASKS
  const selectGeneration = useVideoGenerationStore((state) => state.select)
  const listBodyRef = useRef<HTMLDivElement | null>(null)
  const [pendingSelection] = useState(() => consumeVideoAssetSelection())
  const pendingSelectionApplied = useRef(false)
  const [selectedId, setSelectedId] = useState<string>(
    () => pendingSelection ?? requestedEntryId ?? '',
  )
  const [externalImportOpen, setExternalImportOpen] = useState(false)
  const [videoDurationMs, setVideoDurationMs] = useState<number | null>(null)
  const [fullscreenRequest, setFullscreenRequest] = useState<{ id: string, nonce: number } | null>(null)

  const graph = useGraphScenario((s) => s.graph)
  const scenario = useMemo<GameScenario>(
    () => ({ version: 'wb-game-video.graph.v1', graph }),
    [graph],
  )

  const supplementalEntries = useMemo<VideoLibraryEntry[]>(() => {
    return generationTasks.map((task) => ({
        id: `generation:${task.generationId}`,
        generationId: task.generationId,
        label: task.prompt?.trim() || t('videoAssets.status.generating'),
        url: '',
        group: generatedGroup,
        status: 'generating' as const,
        updatedAt: task.createdAt,
      }))
  }, [generatedGroup, generationTasks, t])

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

  useEffect(() => {
    if (!pendingSelectionApplied.current && pendingSelection) {
      pendingSelectionApplied.current = true
      if (requestedEntryId !== pendingSelection) {
        setVideoLocation({ entryId: pendingSelection })
        return
      }
    }
    setSelectedId(requestedEntryId ?? '')
  }, [pendingSelection, requestedEntryId, setVideoLocation])

  function selectVideo(id: string): void {
    setSelectedId(id)
    setVideoLocation({ entryId: id })
  }

  function handleVideoDeleted(id: string): void {
    if (selectedId === id) {
      setSelectedId('')
      setVideoLocation({ entryId: null })
    }
  }

  return (
    <div className="gc-tab gc-tab-video val-video-workspace">
      <VideoAssetLibrary
        gameId={game}
        scenario={scenario}
        supplementalEntries={supplementalEntries}
        selectedId={selectedId}
        requestedFolder={activeFolderFor(requestedFolder)}
        onFolderChange={(folder) => setVideoLocation({ folder: folderTargetFor(folder), entryId: null })}
        onSelect={selectVideo}
        onOpenPreview={(id) => setFullscreenRequest((current) => ({ id, nonce: (current?.nonce ?? 0) + 1 }))}
        onOpenGenerate={() => {
          selectGeneration(game, undefined)
          setView('video-generate')
        }}
        onOpenGeneration={(generationId) => {
          selectGeneration(game, generationId)
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
      <VideoExternalImportDialog
        open={externalImportOpen}
        targetGameId={game}
        client={kinoClient}
        onImport={async (source, name) => {
          const imported = await videoController.importExternal(source, name)
          if (imported) {
            selectVideo(imported.resource_id)
          }
          return imported
        }}
        onClose={() => setExternalImportOpen(false)}
      />
    </div>
  )
}

function GraphVideoViewWithOwnedController(): JSX.Element {
  const game = useGraphScenario((state) => state.game)
  const videoController = useVideoAssets(game)
  return <GraphVideoViewContent videoController={videoController} />
}

export function GraphVideoView({
  controller,
}: {
  controller?: VideoAssetsController
} = {}): JSX.Element {
  return controller
    ? <GraphVideoViewContent videoController={controller} />
    : <GraphVideoViewWithOwnedController />
}
