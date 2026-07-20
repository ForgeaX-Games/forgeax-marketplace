// @source wb-character/src/pipelines/vfx/__tests__/publishSkills.test.ts
import { describe, it, expect } from 'vitest'
import type { SkillSlot } from '../VFXTypes'
import { createDefaultSkills } from '../VFXTypes'
import {
  EFFECT_TO_BINDING,
  vfxSkillsToExported,
  pickActionIdForSlot,
} from '../publishSkills'

/**
 * These tests pin down the contract between the VFX pipeline's SkillSlot
 * (rich editor state) and the character manifest's ExportedSkill (what the
 * game runtime consumes -- only knows slash / impact / aura / projectile).
 *
 * If a new VFX template is added to EFFECT_TEMPLATES in VFXTypes.ts, the
 * "every effect has a binding" test will fail loudly so the mapping table
 * cannot silently drift.
 */

const manifestActions = [
  { id: 'idle' }, { id: 'walk' }, { id: 'run' }, { id: 'attack' },
  { id: 'hurt' }, { id: 'death' }, { id: 'dodge' }, { id: 'cast' },
  { id: 'ultimate' },
] as unknown as Parameters<typeof vfxSkillsToExported>[1]['actions']

const manifest = {
  schemaVersion: 1 as const,
  id: 'player',
  name: 'Pixel Character',
  headBodyRatio: 4,
  defaultAction: 'idle',
  actions: manifestActions,
  skills: [],
  exportedAt: 0,
}

function bareSkill(id: SkillSlot['id'], effectId: string): SkillSlot {
  return {
    id,
    name: id,
    description: '',
    effectId,
    effectLabel: effectId,
    params: {},
    isAIGenerated: false,
  }
}

describe('EFFECT_TO_BINDING', () => {
  it('maps every effectId used by the VFX pipeline to a runtime VfxBinding', async () => {
    const { EFFECT_TEMPLATES } = await import('../VFXTypes')
    for (const tmpl of EFFECT_TEMPLATES) {
      const binding = EFFECT_TO_BINDING[tmpl.id]
      expect(binding, `effectId="${tmpl.id}" missing from EFFECT_TO_BINDING`).toBeDefined()
      expect(['slash', 'impact', 'aura', 'projectile']).toContain(binding!.type)
    }
  })

  it('assigns a color to every mapping (no black defaults)', () => {
    for (const [id, b] of Object.entries(EFFECT_TO_BINDING)) {
      expect(b.color, `${id} has empty color`).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })
})

describe('pickActionIdForSlot', () => {
  const avail = new Set(['idle', 'walk', 'attack', 'cast', 'ultimate'])

  it('normal returns attack (primary)', () => {
    expect(pickActionIdForSlot('normal', avail)).toBe('attack')
  })

  it('ultimate returns ultimate (exact match wins over fallbacks)', () => {
    expect(pickActionIdForSlot('ultimate', avail)).toBe('ultimate')
  })

  it('skill1 falls back to cast when skill1 action is missing', () => {
    expect(pickActionIdForSlot('skill1', avail)).toBe('cast')
  })

  it('skill1 falls back to attack when cast is also missing', () => {
    const noCast = new Set(['idle', 'walk', 'attack'])
    expect(pickActionIdForSlot('skill1', noCast)).toBe('attack')
  })

  it('returns null when no fallback action exists', () => {
    const empty = new Set(['idle'])
    expect(pickActionIdForSlot('skill3', empty)).toBeNull()
  })
})

describe('vfxSkillsToExported', () => {
  it('auto-fills all slots with SLOT_DEFAULT_EFFECT when user configured nothing', () => {
    const slots = createDefaultSkills()
    const { skills, skipped } = vfxSkillsToExported(slots, manifest)
    expect(skipped).toHaveLength(0)
    expect(skills).toHaveLength(6)
    const normal = skills.find(s => s.slotId === 'normal')!
    expect(normal.vfx.type).toBe('slash')
    expect(normal.vfx.color).toMatch(/^#/)
    expect(normal.damage).toBeGreaterThan(0)
  })

  it('skips slots with empty effectId when autoFillEmptySlots=false (strict mode)', () => {
    const slots = createDefaultSkills()
    const { skills, skipped } = vfxSkillsToExported(slots, manifest, { autoFillEmptySlots: false })
    expect(skills).toHaveLength(0)
    expect(skipped).toHaveLength(6)
    expect(skipped[0].reason).toMatch(/no effect/i)
  })

  it('converts one filled slot to a valid ExportedSkill (strict mode)', () => {
    const slots = createDefaultSkills()
    slots[5] = bareSkill('ultimate', 'meteor')
    slots[5].name = 'Meteor Strike'
    const { skills } = vfxSkillsToExported(slots, manifest, { autoFillEmptySlots: false })
    expect(skills).toHaveLength(1)
    const sk = skills[0]
    expect(sk.slotId).toBe('ultimate')
    expect(sk.name).toBe('Meteor Strike')
    expect(sk.actionId).toBe('ultimate')
    expect(sk.vfx.type).toBe('impact')
    expect(sk.vfx.color).toMatch(/^#/)
    expect(sk.damage).toBeGreaterThan(0)
    expect(sk.cooldown).toBeGreaterThan(0)
    expect(sk.targeting).toBeDefined()
  })

  it('skips slots whose resolved actionId is not in the manifest', () => {
    const slots = createDefaultSkills()
    slots[2] = bareSkill('skill2', 'lightning')
    const miniManifest = { ...manifest, actions: [{ id: 'idle' }, { id: 'walk' }] as any }
    const { skills, skipped } = vfxSkillsToExported(slots, miniManifest, { autoFillEmptySlots: false })
    expect(skills).toHaveLength(0)
    const noAction = skipped.filter(s => /no action/i.test(s.reason))
    expect(noAction).toHaveLength(1)
    expect(noAction[0].slotId).toBe('skill2')
  })

  it('ultimate gets bigger cooldown/damage than normal', () => {
    const slots = createDefaultSkills()
    slots[0] = bareSkill('normal', 'attack')
    slots[5] = bareSkill('ultimate', 'meteor')
    const { skills } = vfxSkillsToExported(slots, manifest)
    const normal = skills.find(s => s.slotId === 'normal')!
    const ulti   = skills.find(s => s.slotId === 'ultimate')!
    expect(ulti.damage).toBeGreaterThan(normal.damage)
    expect(ulti.cooldown).toBeGreaterThan(normal.cooldown)
  })

  it('produces unique slotIds (no duplicates even if VFX state has repeats)', () => {
    const slots = createDefaultSkills()
    slots[0] = bareSkill('normal', 'attack')
    const dup = { ...bareSkill('normal', 'lightning') }
    const withDup = [...slots, dup]
    const { skills } = vfxSkillsToExported(withDup, manifest)
    const slotIds = skills.map(s => s.slotId)
    const uniq = new Set(slotIds)
    expect(uniq.size).toBe(slotIds.length)
  })
})
