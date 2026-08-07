import { create } from 'zustand'

export type RuleSection = 'entities' | 'variables' | 'formulas'

interface RuleSelectionStore {
  section: RuleSection
  itemId: string | null
  select(section: RuleSection, itemId?: string | null): void
}

const CHANNEL = 'wb-game-video:rule-selection-sync'
let channel: BroadcastChannel | null = null
let applyingRemote = false

export const useRuleSelection = create<RuleSelectionStore>((set) => ({
  section: 'entities',
  itemId: null,
  select(section, itemId = null) {
    set((state) => {
      if (state.section === section && state.itemId === itemId) return state
      if (!applyingRemote) channel?.postMessage({ section, itemId })
      return { section, itemId }
    })
  },
}))

export function installRuleSelectionSync(): () => void {
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(CHANNEL)
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const value = event.data as { section?: unknown, itemId?: unknown }
      if (value.section !== 'entities' && value.section !== 'variables' && value.section !== 'formulas') return
      applyingRemote = true
      try {
        useRuleSelection.getState().select(value.section, typeof value.itemId === 'string' ? value.itemId : null)
      } finally {
        applyingRemote = false
      }
    }
  }
  return () => {
    channel?.close()
    channel = null
  }
}
