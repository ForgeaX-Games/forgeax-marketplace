// 💡 Backend port of the renderer's framework/asset/matchAssetEntry name→alias
// resolution, used by the cooker so layers that carry only an `asset_name`
// (no exact `asset_alias`) still resolve to a real library sheet — otherwise
// those layers (walls / floors / grass / trees) export blank tiles and vanish
// from the bundled viewer (the editor renders them via name matching).
//
// Mirrors the frontend 4-level match: exact alias → name (field 4) → stripped
// name. Cutout pool (field 8 === '抠图') vs non-cutout pool selection follows
// asset_type ('tile' → non-cutout only; otherwise cutout-first then fall back).

import type { AliasMeta } from '../library/service.js'

function bracketField(alias: string, index: number): string {
  const matches = alias.match(/\[([^\]]*)\]/g)
  if (!matches || matches.length <= index) return ''
  return matches[index]!.slice(1, -1).trim()
}

function stripZonePrefix(name: string): string {
  return name.replace(/^[^一-鿿]*[一-鿿]+\d*_/, '')
}

function findExactAlias(alias: string | undefined, pool: AliasMeta[]): AliasMeta | undefined {
  if (!alias) return undefined
  return pool.find((a) => a.alias === alias)
}

function findByName(name: string, pool: AliasMeta[]): AliasMeta | undefined {
  if (!name) return undefined
  const stripped = stripZonePrefix(name)
  return pool.find((a) => bracketField(a.alias, 4) === name)
    ?? (stripped !== name ? pool.find((a) => bracketField(a.alias, 4) === stripped) : undefined)
}

/**
 * Resolve the primary AliasMeta for a baked layer. Prefers an exact alias, then
 * name-based matching within the appropriate pool. Returns `undefined` when no
 * library asset matches (layer stays a placeholder).
 */
export function resolveLayerAlias(
  entry: { assetName?: string; assetAlias?: string; assetType?: string },
  aliases: ReadonlyArray<AliasMeta>,
): AliasMeta | undefined {
  if (!entry.assetName && !entry.assetAlias) return undefined
  // No library snapshot to match against: still honour an explicit alias binding
  // so the atlas builder fetches it (and missing content surfaces as an error).
  if (aliases.length === 0) return rawAliasFallback(entry.assetAlias)

  const cutout: AliasMeta[] = []
  const nonCutout: AliasMeta[] = []
  for (const a of aliases) {
    if (bracketField(a.alias, 8) === '抠图') cutout.push(a)
    else nonCutout.push(a)
  }

  if (entry.assetType === 'tile') {
    return findExactAlias(entry.assetAlias, nonCutout)
      ?? (entry.assetName ? findByName(entry.assetName, nonCutout) : undefined)
      ?? rawAliasFallback(entry.assetAlias)
  }
  return findExactAlias(entry.assetAlias, cutout)
    ?? (entry.assetName ? findByName(entry.assetName, cutout) : undefined)
    ?? findExactAlias(entry.assetAlias, nonCutout)
    ?? (entry.assetName ? findByName(entry.assetName, nonCutout) : undefined)
    ?? rawAliasFallback(entry.assetAlias)
}

/**
 * When a layer carries an explicit `asset_alias` that is not present in the
 * library snapshot, still surface it as a (tileType-less) meta so the atlas
 * builder attempts to fetch it — preserving the explicit-binding contract and
 * letting genuinely-missing content surface as an error (or be tolerated under
 * allowMissingAssets) rather than silently producing a blank tile.
 */
function rawAliasFallback(alias: string | undefined): AliasMeta | undefined {
  return alias ? { alias } : undefined
}
