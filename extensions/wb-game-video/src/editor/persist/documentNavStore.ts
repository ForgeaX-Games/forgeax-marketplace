import { create } from 'zustand'
import type { DocumentType } from '../assets/registry-types'

const DOCUMENT_TYPES: readonly DocumentType[] = ['proposal', 'outline', 'script']
const LS_KEY = 'wb-game-video:document:type'
const CHANNEL = 'wb-game-video:document-sync'

function initialDocumentType(): DocumentType {
  try {
    const value = localStorage.getItem(LS_KEY)
    if (DOCUMENT_TYPES.includes(value as DocumentType)) return value as DocumentType
  } catch { /* best effort */ }
  return 'proposal'
}

interface DocumentNavStore {
  documentType: DocumentType
  setDocumentType(documentType: DocumentType): void
}

let channel: BroadcastChannel | null = null
let applyingRemote = false

export const useDocumentNav = create<DocumentNavStore>((set) => ({
  documentType: initialDocumentType(),
  setDocumentType(documentType) {
    set((state) => {
      if (state.documentType === documentType) return state
      try { localStorage.setItem(LS_KEY, documentType) } catch { /* best effort */ }
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
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== LS_KEY) return
    applyRemote(event.newValue)
  }
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage)
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(CHANNEL)
    channel.onmessage = (event: MessageEvent) => applyRemote(event.data)
  }
  return () => {
    channel?.close()
    channel = null
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage)
  }
}
