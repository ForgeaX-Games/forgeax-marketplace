import type { ResolveAsset } from '../../play'
import type { RuntimeAssetManifest } from './game-package-client'

const DIRECT_URL = /^(https?:|blob:|data:)/

export function createAssetResolver(manifest: RuntimeAssetManifest): ResolveAsset {
  const assets = new Map(manifest.assets.map((asset) => [asset.id, asset]))

  return (mediaId, gameId) => {
    if (!mediaId) return undefined
    if (DIRECT_URL.test(mediaId)) return mediaId
    const asset = assets.get(mediaId)
    if (!asset) return undefined
    if (asset.url && DIRECT_URL.test(asset.url)) return asset.url
    return `/__gva__/media/${encodeURIComponent(asset.id)}?game=${encodeURIComponent(gameId)}`
  }
}
