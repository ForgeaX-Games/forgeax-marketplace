import { useEffect, useMemo, useState } from 'react'
import type { MediaAsset } from '../registry-types'
import type { VideoAssetsController } from '../useVideoAssets'
import { useClipGeneration } from './useClipGeneration'
import type { VgenImageAsset } from './VgenImagePicker'
import { listRegistryAssets, resolveAssetSrc } from '../../shell/media'
import type { RecentGeneratedClip } from './VideoGenSheet'

export function useVideoGenerationWorkspace(game: string, videoController: VideoAssetsController) {
  const [regAssets, setRegAssets] = useState<MediaAsset[]>([])

  useEffect(() => {
    let alive = true
    const pull = async (): Promise<void> => {
      const assets = await listRegistryAssets(game)
      if (alive) setRegAssets(assets)
    }
    void pull()
    const timer = window.setInterval(() => void pull(), 5000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [game])

  const imageAssets = useMemo<VgenImageAsset[]>(() => {
    return regAssets.flatMap((asset) => {
      if (asset.kind !== 'image' || asset.status !== 'ready') return []
      const kind = asset.productionType === 'character_ref'
        ? 'character_ref'
        : asset.productionType === 'scene_ref'
          ? 'scene_ref'
          : asset.productionType === 'shot_image'
            ? 'keyframe'
            : null
      if (!kind) return []
      return [{
        id: asset.id,
        resourceId: asset.provider?.kind === 'kino'
          ? nonEmptyString(asset.provider.upstreamResourceId)
          : undefined,
        label: asset.label ?? asset.name ?? asset.id,
        kind,
        thumbUrl: resolveAssetSrc(asset, game),
      }]
    })
  }, [game, regAssets])

  const recentClips = useMemo<RecentGeneratedClip[]>(() => {
    const clips: RecentGeneratedClip[] = regAssets
      .filter(isRecentClipAsset)
      .map((asset) => ({
        id: asset.id,
        label: asset.label ?? asset.name ?? asset.id,
        createdAt: asset.createdAt,
        status: asset.status,
        posterUrl: stringMeta(asset.meta, 'posterUrl') ?? stringMeta(asset.meta, 'thumbnailUrl'),
        playbackUrl: asset.status === 'ready' ? resolveAssetSrc(asset, game) : undefined,
      }))
    for (const item of videoController.items) {
      if (item.type !== 'GENERATION') continue
      clips.push({
        id: item.id,
        label: item.label,
        createdAt: item.updatedAt ?? 0,
        status: 'ready',
        playbackUrl: item.url,
      })
    }
    return [...new Map(clips.map((clip) => [clip.id, clip])).values()]
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, 5)
  }, [game, regAssets, videoController.items])

  const clipGeneration = useClipGeneration(regAssets, {
    gameSlug: game,
    onTerminal: videoController.refresh,
  })

  return { regAssets, imageAssets, recentClips, clipGeneration }
}

function stringMeta(meta: Readonly<Record<string, unknown>> | undefined, key: string): string | undefined {
  const value = meta?.[key]
  return typeof value === 'string' ? value : undefined
}

function nonEmptyString(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

function isRecentClipAsset(
  asset: MediaAsset,
): asset is MediaAsset & { status: RecentGeneratedClip['status'] } {
  return asset.kind === 'video'
    && asset.productionType === 'video_clip'
    && asset.status !== 'placeholder'
}
