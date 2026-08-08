import { create } from 'zustand'
import type { AssetLibraryRootKind } from '../assets/registry-types'

const ROOT_KINDS: readonly AssetLibraryRootKind[] = ['image', 'video', 'control', 'sound', 'audio', 'font']
const LS_KEY = 'wb-game-video:asset:root'
const CHANNEL = 'wb-game-video:asset-root-sync'

function initialRoot(): AssetLibraryRootKind | null {
  try {
    const value = localStorage.getItem(LS_KEY)
    return value && ROOT_KINDS.includes(value as AssetLibraryRootKind) ? value as AssetLibraryRootKind : null
  } catch {
    return null
  }
}

interface AssetNavStore {
  root: AssetLibraryRootKind | null
  folderId: string | null
  entryKey: string | null
  setLocation(location: { root: AssetLibraryRootKind | null, folderId?: string | null, entryKey?: string | null }): void
  setRoot(root: AssetLibraryRootKind | null): void
}

let channel: BroadcastChannel | null = null
let applyingRemote = false

export const useAssetNav = create<AssetNavStore>((set) => ({
  root: initialRoot(),
  folderId: null,
  entryKey: null,
  setLocation(location) {
    set((state) => {
      const root = location.root
      const folderId = location.folderId ?? null
      const entryKey = location.entryKey ?? null
      if (state.root === root && state.folderId === folderId && state.entryKey === entryKey) return state
      try {
        if (root) localStorage.setItem(LS_KEY, root)
        else localStorage.removeItem(LS_KEY)
      } catch { /* best effort */ }
      if (!applyingRemote) channel?.postMessage({ root, folderId, entryKey })
      return { root, folderId, entryKey }
    })
  },
  setRoot(root) {
    useAssetNav.getState().setLocation({ root })
  },
}))

export function installAssetNavSync(): () => void {
  const applyRemoteLocation = (value: unknown): void => {
    const location = typeof value === 'string' || value === null
      ? { root: value }
      : value as { root?: unknown, folderId?: unknown, entryKey?: unknown }
    const root = location.root
    if (root !== null && !ROOT_KINDS.includes(root as AssetLibraryRootKind)) return
    const folderId = typeof location.folderId === 'string' ? location.folderId : null
    const entryKey = typeof location.entryKey === 'string' ? location.entryKey : null
    applyingRemote = true
    try {
      useAssetNav.getState().setLocation({ root: root as AssetLibraryRootKind | null, folderId, entryKey })
    } finally {
      applyingRemote = false
    }
  }
  const onStorage = (event: StorageEvent): void => {
    if (event.key === LS_KEY) applyRemoteLocation(event.newValue)
  }
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage)
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(CHANNEL)
    channel.onmessage = (event: MessageEvent) => applyRemoteLocation(event.data)
  }
  return () => {
    channel?.close()
    channel = null
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage)
  }
}
