import { create } from 'zustand'
import { gameKeySuffix } from './gameScope'

export type VideoLibraryFolderTarget =
  | { kind: 'all' }
  | { kind: 'untagged' }
  | { kind: 'tag', name: string }

interface VideoLibraryLocation {
  folder: VideoLibraryFolderTarget
  entryId: string | null
}
interface VideoLibraryNavStore extends VideoLibraryLocation {
  setLocation(location: { folder?: VideoLibraryFolderTarget, entryId?: string | null }): void
}

// 按 game 隔离频道，避免同源多开不同 game 时跨 tab 串台。
// 后缀在 install 时才求值：进程内挂载的 game 标识由宿主注入，晚于本模块求值。
const CHANNEL_BASE = 'wb-game-video:video-library-nav-sync'
const ALL_VIDEOS: VideoLibraryFolderTarget = { kind: 'all' }

let channel: BroadcastChannel | null = null
let applyingRemote = false

function sameFolder(left: VideoLibraryFolderTarget, right: VideoLibraryFolderTarget): boolean {
  return left.kind === right.kind
    && (left.kind !== 'tag' || (right.kind === 'tag' && left.name === right.name))
}

function validFolder(value: unknown): value is VideoLibraryFolderTarget {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<VideoLibraryFolderTarget>
  return candidate.kind === 'all'
    || candidate.kind === 'untagged'
    || (candidate.kind === 'tag' && typeof candidate.name === 'string' && candidate.name.trim().length > 0)
}

function validLocation(value: unknown): value is VideoLibraryLocation {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<VideoLibraryLocation>
  return validFolder(candidate.folder)
    && (candidate.entryId === null || typeof candidate.entryId === 'string')
}

export const useVideoLibraryNav = create<VideoLibraryNavStore>((set) => ({
  folder: ALL_VIDEOS,
  entryId: null,
  setLocation(location) {
    set((state) => {
      const folder = location.folder ?? state.folder
      const entryId = location.entryId === undefined ? state.entryId : location.entryId
      if (sameFolder(state.folder, folder) && state.entryId === entryId) return state
      const next = { folder, entryId }
      if (!applyingRemote) channel?.postMessage(next)
      return next
    })
  },
}))

export function installVideoLibraryNavSync(): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {}
  channel = new BroadcastChannel(`${CHANNEL_BASE}${gameKeySuffix()}`)
  channel.onmessage = (event: MessageEvent) => {
    if (!validLocation(event.data)) return
    applyingRemote = true
    try {
      useVideoLibraryNav.getState().setLocation(event.data)
    } finally {
      applyingRemote = false
    }
  }
  return () => {
    channel?.close()
    channel = null
  }
}
