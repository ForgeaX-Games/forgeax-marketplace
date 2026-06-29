// @source wb-character/src/shared/GlobalState.ts
/**
 * CharacterState -- minimal localStorage adapter for wb-skill (D-8).
 *
 * D-8: wb-skill must NOT import from wb-character at runtime.
 * vfx2-bootstrap.ts needs globalState.profile.{charClass,worldSetting}
 * and globalState.subscribe(). This file replaces globalState with a
 * direct localStorage read, avoiding the cross-plugin import.
 *
 * The authoritative persistence logic lives in:
 *   wb-character/src/shared/GlobalState.ts (STORAGE_KEY, CharacterProfile)
 *
 * Only the fields accessed by vfx2-bootstrap are declared here.
 */

const STORAGE_KEY = 'character-editor:global-design'

export interface CharacterProfile {
  charClass: string
  worldSetting: string
}

export interface CharacterState {
  profile: CharacterProfile
}

function readFromStorage(): CharacterState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { profile: { charClass: '', worldSetting: '' } }
    const parsed = JSON.parse(raw)
    const prof = parsed?.profile ?? {}
    return {
      profile: {
        charClass: (prof.charClass as string) ?? '',
        worldSetting: (prof.worldSetting as string) ?? '',
      },
    }
  } catch {
    return { profile: { charClass: '', worldSetting: '' } }
  }
}

type Listener = () => void

class CharacterStateReader {
  private _state: CharacterState = readFromStorage()
  private listeners = new Set<Listener>()

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (ev: StorageEvent) => {
        if (ev.key === STORAGE_KEY) {
          this._state = readFromStorage()
          this.listeners.forEach(fn => fn())
        }
      })
    }
  }

  get profile(): CharacterProfile {
    return this._state.profile
  }

  /** Subscribe to profile changes (mirrors globalState.subscribe API). */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
}

export const characterState = new CharacterStateReader()
