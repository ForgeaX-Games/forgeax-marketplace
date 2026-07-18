// @source wb-character/src/pipelines/vfx/VFXTypes.ts
export interface SkillSlot {
  id: 'normal' | 'skill1' | 'skill2' | 'skill3' | 'skill4' | 'ultimate'
  name: string
  description: string
  effectId: string
  effectLabel: string
  params: Record<string, number>
  isAIGenerated: boolean
  aiCode?: string
  tmplParams?: Record<string, any>  // AI template effect params (effectId prefixed with "tmpl:")
}

export type VFXTabId = 'config' | 'preview' | 'tune' | 'export'

export interface VFXEditorState {
  skills: SkillSlot[]
  activeSkillIdx: number
  activeTab: VFXTabId
}

export const VFX_TAB_META: { id: VFXTabId; label: string; icon: string }[] = [
  { id: 'config',  label: 'Skill Config',   icon: '⚙' },
  { id: 'preview', label: 'Effect Preview', icon: '👁' },
  { id: 'tune',    label: 'Param Tuning',   icon: '🎛' },
  { id: 'export',  label: 'Export',         icon: '📦' },
]

export const SLOT_META: { id: SkillSlot['id']; label: string; icon: string }[] = [
  { id: 'normal',   label: 'Normal Attack', icon: '⚔' },
  { id: 'skill1',   label: 'Skill 1',       icon: '1' },
  { id: 'skill2',   label: 'Skill 2',       icon: '2' },
  { id: 'skill3',   label: 'Skill 3',       icon: '3' },
  { id: 'skill4',   label: 'Skill 4',       icon: '4' },
  { id: 'ultimate', label: 'Ultimate',       icon: '💥' },
]

export interface EffectTemplate {
  id: string
  label: string
  icon: string
  group: string
  method: string
}

export const EFFECT_TEMPLATES: EffectTemplate[] = [
  { id: 'attack',       label: 'Basic Attack Combo', icon: '⚔',  group: 'Attack Effects',     method: 'attackFullCombo' },
  { id: 'starblade',    label: 'Star Blade',         icon: '🌟', group: 'Attack Effects',     method: 'fireStarBlade' },
  { id: 'poison',       label: 'Poison System',      icon: '☠',  group: 'Status Effects',     method: 'firePoison' },
  { id: 'shield',       label: 'Summon Shield',      icon: '🛡', group: 'Status Effects',     method: 'toggleShield' },
  { id: 'heal',         label: 'Heal Aura',          icon: '✚',  group: 'Status Effects',     method: 'toggleHealAura' },
  { id: 'dissolve-out', label: 'Dissolve Out',       icon: '💧', group: 'Appear/Disappear',   method: 'triggerDissolveOut' },
  { id: 'dissolve-in',  label: 'Dissolve In',        icon: '↗',  group: 'Appear/Disappear',   method: 'triggerDissolveIn' },
  { id: 'teleport',     label: 'Teleport',           icon: '✨', group: 'Appear/Disappear',   method: 'triggerTeleport' },
  { id: 'ice',          label: 'Ice Combo',          icon: '❄',  group: 'Ice Effects',        method: 'fireIceCombo' },
  { id: 'groundfrost',  label: 'Ground Frost',       icon: '🧊', group: 'Ice Effects',        method: 'triggerGroundFrost' },
  { id: 'screenfrost',  label: 'Screen Frost',       icon: '🌨', group: 'Ice Effects',        method: 'triggerScreenFrost' },
  { id: 'bigfireball',  label: 'Big Fireball',       icon: '🔥', group: 'Advanced Attacks',   method: 'fireBigFireball' },
  { id: 'meteor',       label: 'Meteor Strike',      icon: '☄',  group: 'Advanced Attacks',   method: 'fireMeteor' },
  { id: 'magiccannon',  label: 'Magic Cannon',       icon: '💠', group: 'Advanced Attacks',   method: 'fireMagicCannon' },
  { id: 'lightning',    label: 'Lightning Attack',   icon: '⚡', group: 'Advanced Attacks',   method: 'fireLightning' },
  { id: 'hitexplosion', label: 'Hit Explosion',      icon: '💥', group: 'Advanced Attacks',   method: 'triggerHitExplosion' },
  { id: 'shockwave',    label: 'Shockwave',          icon: '🌊', group: 'Advanced Attacks',   method: 'triggerShockwave' },
  { id: 'vinestrike',   label: 'Vine Strike',        icon: '🌿', group: 'Advanced Attacks',   method: 'fireVineStrike' },
]

export function createDefaultSkills(): SkillSlot[] {
  return SLOT_META.map(m => ({
    id: m.id,
    name: m.label,
    description: '',
    effectId: '',
    effectLabel: '',
    params: {},
    isAIGenerated: false,
  }))
}

export function createDefaultVFXState(): VFXEditorState {
  return {
    skills: createDefaultSkills(),
    activeSkillIdx: 0,
    activeTab: 'config',
  }
}
