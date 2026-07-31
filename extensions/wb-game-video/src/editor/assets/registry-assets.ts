/** Reads shared-registry assets from the extension and preserves failures. */
import { getWorkbenchHost, readExtensionJson } from '../../lib/workbench-host'
import type { MediaAsset, MediaKind } from './registry-types'

export async function fetchRegistryAssets(game?: string, kind?: MediaKind): Promise<MediaAsset[]> {
  const params = new URLSearchParams()
  void game
  if (kind) params.set('kind', kind)
  const qs = params.toString()
  const r = await getWorkbenchHost().extension.fetch(`assets${qs ? `?${qs}` : ''}`)
  const j = await readExtensionJson(r) as { assets?: MediaAsset[] }
  if (!Array.isArray(j.assets)) throw new Error('Extension returned an invalid assets response')
  return j.assets
}
