/**
 * 媒体解析：把节点演出的 media 引用解析成可播 URL。
 *  - 已是 http/blob/data URL → 原样用。
 *  - 否则视为**资产 id** → `/__reel__/assets/<id>?game=<slug>`（reelAssetsPlugin 提供）。
 * 返回 undefined = 无演出源（渲染占位）。
 */
import { zhandouUrl } from '../assets'

export function resolveMediaSrc(ref: string | undefined, game?: string): string | undefined {
  if (!ref) return undefined
  if (/^(https?:|blob:|data:|\/)/.test(ref)) return ref
  // demo 里统一按 zhandou 文件名(basename)引用（战斗/叙事视频同源）；兼容运行时 m- 前缀。
  const bare = ref.startsWith('m-') ? ref.slice(2) : ref
  const local = zhandouUrl(bare)
  if (local) return local
  // 其余按资产 id 走 reelAssets。
  const q = game ? `?game=${encodeURIComponent(game)}` : ''
  return `/__reel__/assets/${encodeURIComponent(ref)}${q}`
}

/**
 * 列出该 game 现有的视频资产 id（供演出节点「视频」下拉）。读 reelAssets 的 manifest
 * （GET /__reel__/assets?game=<slug>&kind=video）。离线/无端点时返回 []。
 */
export async function listVideoAssets(game?: string): Promise<string[]> {
  return (await listVideoAssetInfos(game)).map((a) => a.id)
}

export interface VideoAssetInfo {
  id: string
  bytes?: number
  mimeType?: string
}

/** 同上，但带元信息（视频库视图用）。 */
export async function listVideoAssetInfos(game?: string): Promise<VideoAssetInfo[]> {
  try {
    const q = game ? `?game=${encodeURIComponent(game)}&kind=video` : '?kind=video'
    const r = await fetch(`/__reel__/assets${q}`)
    if (!r.ok) return []
    const j = (await r.json()) as { assets?: Array<{ id?: string; bytes?: number; mimeType?: string }> }
    return (j.assets ?? [])
      .filter((a): a is { id: string; bytes?: number; mimeType?: string } => typeof a.id === 'string')
      .map((a) => ({ id: a.id, bytes: a.bytes, mimeType: a.mimeType }))
  } catch {
    return []
  }
}
