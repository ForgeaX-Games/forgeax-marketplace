/** Reads shared-registry assets from the extension and preserves failures. */
import { getWorkbenchHost, readExtensionJson } from '../../lib/workbench-host'
import type { MediaAsset, MediaKind } from './registry-types'

export async function fetchRegistryAssets(
  game?: string,
  kind?: MediaKind,
  options: { signal?: AbortSignal } = {},
): Promise<MediaAsset[]> {
  const params = new URLSearchParams()
  void game
  if (kind) params.set('kind', kind)
  const qs = params.toString()
  const path = `assets${qs ? `?${qs}` : ''}`
  const r = options.signal
    ? await getWorkbenchHost().extension.fetch(path, { signal: options.signal })
    : await getWorkbenchHost().extension.fetch(path)
  const j = await readExtensionJson(r) as { assets?: MediaAsset[]; error?: unknown }
  if (typeof j.error === 'string' && j.error.length > 0) {
    throw new Error(j.error)
  }
  if (!Array.isArray(j.assets)) throw new Error('Extension returned an invalid assets response')
  return j.assets
}
