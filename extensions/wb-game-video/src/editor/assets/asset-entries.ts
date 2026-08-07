import type { ManagedAsset, ManagedAssetKind } from './assetLibraryClient'
import { rootForId } from './asset-directory'
import type { ProjectComponentAsset } from './project-component-assets'
import type { AssetLibraryRootKind } from './registry-types'

export type BrowserAssetKind = ManagedAssetKind | 'video'

export interface BrowserAsset {
  id: string
  kind: BrowserAssetKind
  name: string
  url?: string
  mime?: string
  bytes?: number
  readOnly?: boolean
}

export type AssetListEntry =
  | { source: 'media', asset: BrowserAsset }
  | { source: 'project-component', component: ProjectComponentAsset }

export function assetEntryKey(entry: AssetListEntry): string {
  return entry.source === 'media' ? entry.asset.id : `component:${entry.component.componentId}`
}

export function assetEntryRoot(entry: AssetListEntry): AssetLibraryRootKind {
  if (entry.source === 'project-component') return 'control'
  return rootForBrowserAsset(entry.asset)
}

export function assetEntryName(entry: AssetListEntry): string {
  return entry.source === 'media' ? entry.asset.name : entry.component.manifest.label ?? entry.component.componentId
}

export function rootForBrowserAsset(asset: BrowserAsset): AssetLibraryRootKind {
  return asset.kind === 'image' ? 'image' : asset.kind === 'audio' ? 'audio' : asset.kind === 'font' ? 'font' : 'video'
}

export function assetEntries(
  managed: readonly ManagedAsset[],
  videos: readonly BrowserAsset[],
  components: readonly ProjectComponentAsset[],
): AssetListEntry[] {
  return [
    ...managed.map((asset) => ({ source: 'media' as const, asset: { ...asset, readOnly: false } })),
    ...videos.map((asset) => ({ source: 'media' as const, asset })),
    ...components.map((component) => ({ source: 'project-component' as const, component })),
  ]
}

export function rootIdForAssetEntry(entry: AssetListEntry): `root:${AssetLibraryRootKind}` {
  return `root:${assetEntryRoot(entry)}`
}

export function parentFolderIdForAssetEntry(
  entry: AssetListEntry,
  placements: Readonly<Record<string, string>>,
): string {
  return placements[assetEntryKey(entry)] ?? rootIdForAssetEntry(entry)
}

export function isAssetRootId(id: string): boolean {
  return rootForId(id) !== undefined
}
