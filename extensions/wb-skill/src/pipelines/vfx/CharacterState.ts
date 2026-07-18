// @source wb-character/src/shared/GlobalState.ts
// Minimal re-declaration: CharacterProfile type + localStorage direct reader.
// D-1 (minimal re-declaration) + D-8 (GlobalState -> localStorage).
// Reactive subscription is intentionally omitted (R1 known risk per plan-strategy D-8).

export type CombatType = 'melee' | 'ranged'
export type Gender = 'male' | 'female'

export interface CharacterProfile {
  name: string
  charId: string
  gender: Gender
  combatType: CombatType
  charClass: string
  age: string
  worldSetting: string
  artStyle: string
  artStyleCustom: string
  extraDesc: string
  bodyType: string
  characterRole: string
}

const CHARACTER_STORAGE_KEY = 'character-editor:global-design'
const IMAGE_MODEL_STORAGE_KEY = 'ce:image-model'

function defaultProfile(): CharacterProfile {
  return {
    name: '',
    charId: '',
    gender: 'male',
    combatType: 'melee',
    charClass: '',
    age: '',
    worldSetting: '',
    artStyle: '',
    artStyleCustom: '',
    extraDesc: '',
    bodyType: 'humanoid',
    characterRole: 'hero',
  }
}

/** Read CharacterProfile from localStorage (D-8 direct read, no reactive updates). */
export function readCharacterProfile(): CharacterProfile {
  try {
    const raw = localStorage.getItem(CHARACTER_STORAGE_KEY)
    if (!raw) return defaultProfile()
    const parsed = JSON.parse(raw)
    const p = parsed?.profile ?? {}
    return {
      ...defaultProfile(),
      ...p,
    }
  } catch {
    return defaultProfile()
  }
}

/** Read character image from localStorage (D-8 direct read). */
export function readCharacterImage(): string | null {
  try {
    const raw = localStorage.getItem(CHARACTER_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed?.characterImage ?? null
  } catch {
    return null
  }
}

/** Whether a character image is available (D-8 direct read). */
export function hasCharacter(): boolean {
  return readCharacterImage() !== null
}

export { IMAGE_MODEL_STORAGE_KEY }
