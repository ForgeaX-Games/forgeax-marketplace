import { create } from 'zustand'
import type { DocumentType } from '../assets/registry-types'
import { gameKeySuffix } from './gameScope'

const DOCUMENT_TYPES: readonly DocumentType[] = ['intake', 'core', 'inquiry', 'pillar']
// 按 game 隔离键 / 频道：storage 事件与 BroadcastChannel 都是同源跨 tab 广播，
// 不加后缀会让多开的不同 game 互相把「文档类型」同步过去。
// 后缀惰性求值：进程内挂载的 game 标识由宿主注入，晚于本模块求值。
const LS_KEY_BASE = 'wb-game-video:document:type'
const CHANNEL_BASE = 'wb-game-video:document-sync'

function lsKey(): string {
  return `${LS_KEY_BASE}${gameKeySuffix()}`
}

function readStored(): DocumentType | null {
  try {
    const value = localStorage.getItem(lsKey())
    if (DOCUMENT_TYPES.includes(value as DocumentType)) return value as DocumentType
  } catch { /* best effort */ }
  return null
}

interface DocumentNavStore {
  documentType: DocumentType
  setDocumentType(documentType: DocumentType): void
}

let channel: BroadcastChannel | null = null
let applyingRemote = false

export const useDocumentNav = create<DocumentNavStore>((set) => ({
  documentType: readStored() ?? 'intake',
  setDocumentType(documentType) {
    set((state) => {
      if (state.documentType === documentType) return state
      try { localStorage.setItem(lsKey(), documentType) } catch { /* best effort */ }
      if (!applyingRemote) channel?.postMessage(documentType)
      return { documentType }
    })
  },
}))

export function installDocumentNavSync(): () => void {
  const applyRemote = (value: unknown): void => {
    if (!DOCUMENT_TYPES.includes(value as DocumentType)) return
    applyingRemote = true
    try {
      useDocumentNav.getState().setDocumentType(value as DocumentType)
    } finally {
      applyingRemote = false
    }
  }
  const scopedKey = lsKey()
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== scopedKey) return
    applyRemote(event.newValue)
  }
  // 模块求值时宿主可能还没注入 game 标识，此刻的键才是最终的，补一次 hydrate。
  const stored = readStored()
  if (stored) applyRemote(stored)
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage)
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(`${CHANNEL_BASE}${gameKeySuffix()}`)
    channel.onmessage = (event: MessageEvent) => applyRemote(event.data)
  }
  return () => {
    channel?.close()
    channel = null
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage)
  }
}
