import type { Blockout } from '../../scenario/types'
import { useMediaStore } from '../../media/mediaStore'
import { renderStillFromBlockout } from './blockoutScene'

/** 机位静帧 tag（按 blockout + camera 归组，便于复用/识别）。 */
export function blockoutStillTag(blockoutId: string, cameraId: string): string {
  return `reel:blockout:${blockoutId}:${cameraId}`
}

/**
 * 渲染某机位白模构图静帧 → ingest 进 mediaStore（kind=image）→ 返回 mediaId。
 *
 * 该静帧是「软参考」：调用方应把它作为 referenceImageUrls 之一（绝不 startFrame），
 * 并配 BLOCKOUT_GUARD 提示词，防止模型把白模/色块画进成片。
 */
export async function renderCameraStill(args: {
  blockout: Blockout
  cameraId: string
  sceneId?: string
  width?: number
  height?: number
}): Promise<string> {
  const { blockout, cameraId, sceneId } = args
  const width = args.width ?? 1024
  const height = args.height ?? 576

  const texResolve = (mediaId: string | undefined): string | undefined =>
    mediaId ? useMediaStore.getState().entries[mediaId]?.url : undefined

  const dataUrl = await renderStillFromBlockout({
    blockout,
    cameraId,
    texResolve,
    width,
    height,
  })

  const cam = blockout.cameras.find((c) => c.id === cameraId)
  const mediaId = useMediaStore.getState().ingestDataUrl(dataUrl, {
    mimeType: 'image/png',
    sceneId,
    tags: [blockoutStillTag(blockout.id, cameraId)],
    promptKind: 'blockout-ref',
    humanReadableName: `3D 机位 · ${blockout.name || blockout.id} · ${cam?.name ?? cameraId}`,
  })
  return mediaId
}
