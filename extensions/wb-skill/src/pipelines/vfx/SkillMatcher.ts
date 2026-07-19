// @source wb-character/src/pipelines/vfx/SkillMatcher.ts
import type { CharacterProfile } from './CharacterState'
import type { SkillSlot } from './VFXTypes'
import { EFFECT_TEMPLATES, SLOT_META } from './VFXTypes'

// Slot order: [normal, skill1, skill2, skill3, skill4, ultimate]
// Melee: normal attack is always slash combo (attack)
const MELEE_PRESETS: Record<string, string[]> = {
  'medieval-fantasy': ['attack', 'starblade', 'shockwave', 'shield', 'heal', 'meteor'],
  'dark-fantasy':     ['attack', 'poison', 'vinestrike', 'shield', 'dissolve-out', 'meteor'],
  'eastern-fantasy':  ['attack', 'starblade', 'shockwave', 'heal', 'dissolve-in', 'meteor'],
  'cyberpunk':        ['attack', 'lightning', 'shockwave', 'shield', 'teleport', 'magiccannon'],
  'sci-fi':           ['attack', 'lightning', 'shockwave', 'shield', 'teleport', 'magiccannon'],
  'post-apocalypse':  ['attack', 'poison', 'shockwave', 'shield', 'groundfrost', 'meteor'],
  'steampunk':        ['attack', 'bigfireball', 'shockwave', 'shield', 'poison', 'magiccannon'],
  'modern-urban':     ['attack', 'hitexplosion', 'shockwave', 'shield', 'heal', 'lightning'],
  'pirate-nautical':  ['attack', 'shockwave', 'poison', 'shield', 'heal', 'meteor'],
  'mythology':        ['attack', 'starblade', 'lightning', 'shield', 'heal', 'meteor'],
  'default':          ['attack', 'starblade', 'shockwave', 'shield', 'heal', 'meteor'],
}

// Ranged: normal attack is ranged projectile (bigfireball/ice/magiccannon etc.)
const RANGED_PRESETS: Record<string, string[]> = {
  'medieval-fantasy': ['bigfireball', 'ice', 'lightning', 'shield', 'heal', 'meteor'],
  'dark-fantasy':     ['poison', 'vinestrike', 'lightning', 'shield', 'dissolve-out', 'meteor'],
  'eastern-fantasy':  ['starblade', 'ice', 'lightning', 'heal', 'dissolve-in', 'bigfireball'],
  'cyberpunk':        ['magiccannon', 'lightning', 'ice', 'shield', 'teleport', 'meteor'],
  'sci-fi':           ['magiccannon', 'lightning', 'ice', 'shield', 'teleport', 'meteor'],
  'post-apocalypse':  ['poison', 'lightning', 'groundfrost', 'shield', 'heal', 'meteor'],
  'steampunk':        ['magiccannon', 'bigfireball', 'lightning', 'shield', 'poison', 'meteor'],
  'modern-urban':     ['lightning', 'bigfireball', 'ice', 'shield', 'heal', 'meteor'],
  'pirate-nautical':  ['bigfireball', 'ice', 'poison', 'shield', 'heal', 'meteor'],
  'mythology':        ['lightning', 'bigfireball', 'starblade', 'shield', 'heal', 'meteor'],
  'default':          ['bigfireball', 'ice', 'lightning', 'shield', 'heal', 'meteor'],
}

export function autoMatchSkills(profile: CharacterProfile): SkillSlot[] {
  const presets = profile.combatType === 'ranged' ? RANGED_PRESETS : MELEE_PRESETS
  const world = (profile.worldSetting || '').toLowerCase()
  const effectIds = presets[world] || presets['default']

  return SLOT_META.map((meta, i) => {
    const eid = effectIds[i] || ''
    const tmpl = EFFECT_TEMPLATES.find(t => t.id === eid)
    return {
      id: meta.id,
      name: meta.label,
      description: '',
      effectId: eid,
      effectLabel: tmpl?.label || '',
      params: {},
      isAIGenerated: false,
    }
  })
}
