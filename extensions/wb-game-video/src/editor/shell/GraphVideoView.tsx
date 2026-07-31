/**
 * GraphVideoView —— 「新引擎 › 视频」= 视频素材编辑器（UI/交互对齐旧 VideoCatalogTab）。
 *
 * 保留素材库和纯视频预览；不再承载节点绑定、生成配置或组件编辑能力。
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
  resolveMediaSrc,
  registryMediaUrl,
} from './media'
import type { MediaAsset } from '../assets/registry-types'
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
  const game = useMemo(() => getGameSlug() ?? 'game-nodia-fighting', [])
  const videoController = useVideoAssets(game)
  const [regAssets, setRegAssets] = useState<MediaAsset[]>([])
  const listBodyRef = useRef<HTMLDivElement | null>(null)
  const [selectedId, setSelectedId] = useState<string>('')
  const [videoDurationMs, setVideoDurationMs] = useState<number | null>(null)

  const graph = useGraphScenario((s) => s.graph)
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
                uploading={videoController.uploading}
                onReplace={videoController.replaceResource}
                onDurationChange={(ms) => {
                  setVideoDurationMs(ms)
                }}
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
