import { useCallback, useEffect, useState } from 'react'
import { pluginFetch } from '../../lib/plugin-http'
import type {
  AssetLibraryFolder,
  AssetLibraryRootKind,
  AssetLibraryState,
} from './registry-types'

export interface AssetDirectoryRoot {
  id: `root:${AssetLibraryRootKind}`
  kind: AssetLibraryRootKind
  name: string
  icon: string
}

export const ASSET_DIRECTORY_ROOTS: readonly AssetDirectoryRoot[] = [
  { id: 'root:image', kind: 'image', name: '图像', icon: '▣' },
  { id: 'root:video', kind: 'video', name: '视频', icon: '▶' },
  { id: 'root:control', kind: 'control', name: '控件', icon: '◇' },
  { id: 'root:sound', kind: 'sound', name: '音效', icon: '✦' },
  { id: 'root:audio', kind: 'audio', name: '音频', icon: '♪' },
  { id: 'root:font', kind: 'font', name: '字体', icon: 'Aa' },
]

export const EMPTY_ASSET_DIRECTORY: AssetLibraryState = {
  version: 1,
  folders: [],
  placements: {},
}

export interface AssetDirectoryClient {
  get(gameId: string): Promise<AssetLibraryState>
  save(gameId: string, assetLibrary: AssetLibraryState): Promise<AssetLibraryState>
}

export function createManifestAssetDirectoryClient(): AssetDirectoryClient {
  return {
    async get(gameId) {
      void gameId
      const response = await pluginFetch('asset-library')
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body = (await response.json()) as { assetLibrary?: AssetLibraryState | null }
      return body.assetLibrary ?? EMPTY_ASSET_DIRECTORY
    },
    async save(gameId, assetLibrary) {
      void gameId
      const response = await pluginFetch('asset-library', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assetLibrary }),
      })
      const body = (await response.json()) as { assetLibrary?: AssetLibraryState | null, error?: string }
      if (!response.ok || !body.assetLibrary) throw new Error(body.error ?? `HTTP ${response.status}`)
      return body.assetLibrary
    },
  }
}

export function rootForFolder(folder: AssetLibraryFolder): AssetDirectoryRoot {
  const root = ASSET_DIRECTORY_ROOTS.find((candidate) => candidate.kind === folder.rootKind)
  if (!root) throw new Error(`Unknown asset directory root: ${folder.rootKind}`)
  return root
}

export function rootForId(id: string): AssetDirectoryRoot | undefined {
  return ASSET_DIRECTORY_ROOTS.find((root) => root.id === id)
}

export function childrenOf(
  assetLibrary: AssetLibraryState,
  parentId: string,
  rootKind: AssetLibraryRootKind,
): AssetLibraryFolder[] {
  const parentFolderId = rootForId(parentId) ? undefined : parentId
  return assetLibrary.folders
    .filter((folder) => folder.rootKind === rootKind && folder.parentId === parentFolderId)
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
}

function nextId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `folder-${crypto.randomUUID()}`
  }
  return `folder-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function createDirectoryFolder(
  assetLibrary: AssetLibraryState,
  input: { parentId: string, rootKind: AssetLibraryRootKind, name: string, now?: number },
): AssetLibraryState {
  const name = input.name.trim()
  if (!name) throw new Error('文件夹名称不能为空')
  const now = input.now ?? Date.now()
  const parentId = rootForId(input.parentId) ? undefined : input.parentId
  return {
    ...assetLibrary,
    folders: [
      ...assetLibrary.folders,
      { id: nextId(), parentId, rootKind: input.rootKind, name, createdAt: now, updatedAt: now },
    ],
  }
}

export function renameDirectoryFolder(
  assetLibrary: AssetLibraryState,
  folderId: string,
  name: string,
  now = Date.now(),
): AssetLibraryState {
  const nextName = name.trim()
  if (!nextName) throw new Error('文件夹名称不能为空')
  return {
    ...assetLibrary,
    folders: assetLibrary.folders.map((folder) => folder.id === folderId
      ? { ...folder, name: nextName, updatedAt: now }
      : folder),
  }
}

export function removeDirectoryFolder(
  assetLibrary: AssetLibraryState,
  folderId: string,
): AssetLibraryState {
  if (assetLibrary.folders.some((folder) => folder.parentId === folderId)
    || Object.values(assetLibrary.placements).some((placement) => placement === folderId)) {
    throw new Error('文件夹非空，无法删除')
  }
  return {
    ...assetLibrary,
    folders: assetLibrary.folders.filter((folder) => folder.id !== folderId),
  }
}

/** Moves a user folder under another folder in the same immutable asset root. */
export function moveDirectoryFolder(
  assetLibrary: AssetLibraryState,
  folderId: string,
  parentId: string,
  now = Date.now(),
): AssetLibraryState {
  const folder = assetLibrary.folders.find((candidate) => candidate.id === folderId)
  const parent = assetLibrary.folders.find((candidate) => candidate.id === parentId)
  if (!folder || !parent) throw new Error('目标文件夹不存在')
  if (folder.id === parent.id) throw new Error('文件夹不能移动到自身')
  if (folder.rootKind !== parent.rootKind) throw new Error('文件夹不能跨资产类型移动')

  let ancestor: AssetLibraryFolder | undefined = parent
  while (ancestor) {
    if (ancestor.id === folder.id) throw new Error('文件夹不能移动到其子文件夹')
    ancestor = ancestor.parentId
      ? assetLibrary.folders.find((candidate) => candidate.id === ancestor?.parentId)
      : undefined
  }

  return {
    ...assetLibrary,
    folders: assetLibrary.folders.map((candidate) => candidate.id === folderId
      ? { ...candidate, parentId, updatedAt: now }
      : candidate),
  }
}

export function placeAsset(
  assetLibrary: AssetLibraryState,
  assetId: string,
  folderId: string,
): AssetLibraryState {
  const folder = assetLibrary.folders.find((candidate) => candidate.id === folderId)
  if (!folder) throw new Error('目标文件夹不存在')
  return { ...assetLibrary, placements: { ...assetLibrary.placements, [assetId]: folderId } }
}

/** Moves an asset to a user folder, or back to its immutable type root. */
export function moveAsset(
  assetLibrary: AssetLibraryState,
  assetId: string,
  folderId?: string,
): AssetLibraryState {
  if (folderId) return placeAsset(assetLibrary, assetId, folderId)
  const placements = { ...assetLibrary.placements }
  delete placements[assetId]
  return { ...assetLibrary, placements }
}

export interface AssetDirectoryController {
  assetLibrary: AssetLibraryState
  loading: boolean
  saving: boolean
  error: string | null
  refresh(): Promise<void>
  save(next: AssetLibraryState): Promise<AssetLibraryState | undefined>
}

export function useAssetDirectory(
  gameId: string,
  client: AssetDirectoryClient = manifestAssetDirectoryClient,
): AssetDirectoryController {
  const [assetLibrary, setAssetLibrary] = useState<AssetLibraryState>(EMPTY_ASSET_DIRECTORY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setAssetLibrary(await client.get(gameId))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '资产目录加载失败')
    } finally {
      setLoading(false)
    }
  }, [client, gameId])
  const save = useCallback(async (next: AssetLibraryState) => {
    setSaving(true)
    setError(null)
    try {
      const saved = await client.save(gameId, next)
      setAssetLibrary(saved)
      return saved
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '资产目录保存失败')
      return undefined
    } finally {
      setSaving(false)
    }
  }, [client, gameId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { assetLibrary, loading, saving, error, refresh, save }
}

const manifestAssetDirectoryClient = createManifestAssetDirectoryClient()
