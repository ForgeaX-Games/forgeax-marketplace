// @source wb-character/src/pipelines/vfx/publishSkills.ts
/**
 * publishSkills -- VFX pipeline -> game `character.manifest.json.skills[]`
 *
 * Background:
 *   The VFX pipeline's editor state SkillSlot.effectId covers ~20 named effects
 *   (star blade / meteor / ice combo ...), but the game runtime (ForgeaCharacter +
 *   VfxOverlay) only recognizes 4 primitive types (slash / impact / aura /
 *   projectile). To bring VFX pipeline output into the game, a downgrade mapping
 *   is needed: pick the closest runtime type + color + duration + targeting strategy.
 *
 *   This many-to-few mapping lives in a table rather than scattered in UI code:
 *     1) It is a contract, changed together with EFFECT_TEMPLATES; adding new
 *        effects causes the publishSkills.test.ts assertion to fail loudly
 *     2) Can be covered by unit tests
 *     3) If the runtime expands VfxType in the future, only this table needs updating
 */
import type { SkillSlot } from './VFXTypes'
import type { ExportedSkill, CharacterManifest } from '../../types/CharacterManifest'
import type { VfxBinding, VfxType } from '../../types/VfxBinding'
import { MountPointId } from '../../vfx/mount/MountPointTypes'
import { forgeaxHost } from '../../platform/HostSdkBridge'

type Targeting = ExportedSkill['targeting']
type SlotId = SkillSlot['id']

interface BindingTemplate {
  type: VfxType
  color: string
  duration: number
  scale: number
  targeting: Targeting
}

/**
 * effectId -> runtime VfxBinding template.
 * When adding new EFFECT_TEMPLATES entries, add a row here too; otherwise
 * the publishSkills.test.ts every-effect-has-binding assertion will fail.
 */
export const EFFECT_TO_BINDING: Record<string, BindingTemplate> = {
  // Attack (melee) -> slash
  attack:      { type: 'slash',      color: '#ffd866', duration: 420, scale: 1.6, targeting: 'forward' },
  starblade:   { type: 'slash',      color: '#c996ff', duration: 500, scale: 1.4, targeting: 'forward' },
  weaponslash: { type: 'slash',      color: '#ff9933', duration: 340, scale: 1.3, targeting: 'forward' },
  dashtrail:   { type: 'slash',      color: '#66e0ff', duration: 320, scale: 1.2, targeting: 'forward' },

  // Status / aura -> aura
  poison:      { type: 'aura',       color: '#55ff66', duration: 1200, scale: 1.2, targeting: 'aoe' },
  shield:      { type: 'aura',       color: '#66aaff', duration: 2500, scale: 1.3, targeting: 'aoe' },
  heal:        { type: 'aura',       color: '#66ff88', duration: 2000, scale: 1.3, targeting: 'aoe' },
  hurt:        { type: 'impact',     color: '#ff4444', duration: 200,  scale: 0.8, targeting: 'aoe' },

  // Appear/disappear -> aura (soft field effect)
  'dissolve-out': { type: 'aura',    color: '#a882f0', duration: 600, scale: 1.0, targeting: 'aoe' },
  'dissolve-in':  { type: 'aura',    color: '#a882f0', duration: 600, scale: 1.0, targeting: 'aoe' },
  teleport:       { type: 'aura',    color: '#c099ff', duration: 500, scale: 1.0, targeting: 'aoe' },
  'teleport-in':  { type: 'aura',    color: '#c099ff', duration: 500, scale: 1.0, targeting: 'aoe' },

  // Ice -> projectile (ice spike) or aura (ground/screen)
  ice:         { type: 'projectile', color: '#66ccff', duration: 700,  scale: 1.2, targeting: 'forward' },
  groundfrost: { type: 'aura',       color: '#66ccff', duration: 1500, scale: 1.5, targeting: 'aoe' },
  screenfrost: { type: 'aura',       color: '#bbddff', duration: 1200, scale: 1.8, targeting: 'aoe' },

  // Advanced attacks
  bigfireball:  { type: 'projectile', color: '#ff6622', duration: 800, scale: 1.5, targeting: 'forward' },
  meteor:       { type: 'impact',     color: '#ff5522', duration: 900, scale: 2.0, targeting: 'aoe' },
  magiccannon:  { type: 'projectile', color: '#cc55ff', duration: 600, scale: 1.6, targeting: 'forward' },
  lightning:    { type: 'projectile', color: '#ffee66', duration: 350, scale: 1.3, targeting: 'nearest' },
  arcaneblast:  { type: 'impact',     color: '#c099ff', duration: 600, scale: 1.5, targeting: 'aoe' },
  hitexplosion: { type: 'impact',     color: '#ff8833', duration: 400, scale: 1.2, targeting: 'forward' },
  shockwave:    { type: 'impact',     color: '#88ddff', duration: 700, scale: 1.8, targeting: 'aoe' },
  vinestrike:   { type: 'projectile', color: '#66aa44', duration: 500, scale: 1.3, targeting: 'forward' },
}

/**
 * slotId -> priority list of actionIds to try (first match in manifest.actions wins).
 *
 *   normal   maps to pixel-char "attack" action
 *   skillN   prefer same name, fall back to "cast", then "attack"
 *   ultimate prefer "ultimate", fall back to "attack"
 */
const SLOT_TO_ACTION_CANDIDATES: Record<SlotId, string[]> = {
  normal:   ['attack'],
  skill1:   ['skill1', 'cast', 'attack'],
  skill2:   ['skill2', 'cast', 'attack'],
  skill3:   ['skill3', 'cast', 'attack'],
  skill4:   ['skill4', 'cast', 'attack'],
  ultimate: ['ultimate', 'attack'],
}

/** Base combat stats per slot. ultimate is ~5x more expensive than normal. */
const SLOT_DEFAULTS: Record<SlotId, { damage: number; range: number; cooldown: number }> = {
  normal:   { damage: 15, range: 70,  cooldown: 400   },
  skill1:   { damage: 25, range: 90,  cooldown: 2000  },
  skill2:   { damage: 30, range: 100, cooldown: 3000  },
  skill3:   { damage: 35, range: 110, cooldown: 4000  },
  skill4:   { damage: 45, range: 120, cooldown: 5000  },
  ultimate: { damage: 80, range: 140, cooldown: 10000 },
}

/**
 * Fallback effect per slot. When user has not configured anything in the VFX
 * pipeline and clicks "Import to Game", all 6 skill slots still get visible VFX.
 * Most importantly, the normal slot always has an attack slash.
 */
export const SLOT_DEFAULT_EFFECT: Record<SlotId, string> = {
  normal:   'attack',       // normal attack -> basic attack combo (gold slash)
  skill1:   'weaponslash',  // skill 1 -> weapon slash (orange slash)
  skill2:   'shockwave',    // skill 2 -> shockwave (cyan-blue impact)
  skill3:   'shield',       // skill 3 -> shield (blue aura)
  skill4:   'poison',       // skill 4 -> poison (green aura)
  ultimate: 'starblade',    // ultimate -> star blade (purple slash)
}

export function pickActionIdForSlot(
  slotId: SlotId,
  available: ReadonlySet<string>,
): string | null {
  const candidates = SLOT_TO_ACTION_CANDIDATES[slotId]
  for (const id of candidates) {
    if (available.has(id)) return id
  }
  return null
}

function toBinding(effectId: string): BindingTemplate | null {
  const tmpl = EFFECT_TO_BINDING[effectId]
  if (!tmpl) return null
  return tmpl
}

function bindingFor(effectId: string, triggerFrame: number): VfxBinding {
  const b = toBinding(effectId) ?? {
    type: 'impact' as VfxType,
    color: '#ffffff',
    duration: 400,
    scale: 1.0,
    targeting: 'forward' as Targeting,
  }
  return {
    type: b.type,
    startFrame: Math.max(0, triggerFrame),
    duration: b.duration,
    color: b.color,
    scale: b.scale,
    effectId,
  }
}

export interface VfxSkillsToExportedResult {
  skills: ExportedSkill[]
  skipped: { slotId: SlotId; reason: string }[]
}

export interface VfxSkillsToExportedOptions {
  /**
   * When a slot's effectId is empty, auto-fill with SLOT_DEFAULT_EFFECT fallback.
   * Default true -- allows "import to game with no config" to still produce 6 visible
   * skills, with the normal slot always having a slash. Set to false for strict mode.
   */
  autoFillEmptySlots?: boolean
}

/**
 * Pure function -- no IO, easy to unit test. Downgrades the VFX pipeline's
 * SkillSlot[] to game-consumable ExportedSkill[], recording a reason for each
 * skipped slot (for UI toast).
 *
 * Decision order:
 *   1. Deduplicate slotId (keep first occurrence)
 *   2. No effectId -> fill SLOT_DEFAULT_EFFECT fallback (unless autoFillEmptySlots=false)
 *   3. No suitable actionId found -> skip (no matching action in manifest)
 *   4. Default triggerFrame = 1 (frame 0 conflicts with idle; frame 1 hits second frame)
 */
export function vfxSkillsToExported(
  slots: readonly SkillSlot[],
  manifest: Pick<CharacterManifest, 'actions'>,
  opts: VfxSkillsToExportedOptions = {},
): VfxSkillsToExportedResult {
  const autoFill = opts.autoFillEmptySlots !== false
  const availableActions = new Set(manifest.actions.map(a => a.id))
  const skills: ExportedSkill[] = []
  const skipped: VfxSkillsToExportedResult['skipped'] = []
  const seen = new Set<SlotId>()

  for (const slot of slots) {
    if (seen.has(slot.id)) continue
    seen.add(slot.id)

    const effectId = slot.effectId || (autoFill ? SLOT_DEFAULT_EFFECT[slot.id] : '')
    if (!effectId) {
      skipped.push({ slotId: slot.id, reason: 'no effect assigned' })
      continue
    }

    const actionId = pickActionIdForSlot(slot.id, availableActions)
    if (!actionId) {
      skipped.push({ slotId: slot.id, reason: `no action available (tried ${SLOT_TO_ACTION_CANDIDATES[slot.id].join(', ')})` })
      continue
    }

    const d = SLOT_DEFAULTS[slot.id]
    const triggerFrame = 1
    const b = toBinding(effectId)

    skills.push({
      slotId: slot.id,
      name: slot.name || slot.id,
      actionId,
      triggerFrame,
      damage: d.damage,
      range: d.range,
      cooldown: d.cooldown,
      targeting: b?.targeting ?? 'forward',
      vfx: bindingFor(effectId, triggerFrame),
      mountPointId: MountPointId.WEAPON_ROOT,
    })
  }

  return { skills, skipped }
}

// ── IO layer -- used by the VFX pipeline UI ────────────────────────────────

export interface WorkspaceGame {
  gameId: string
  hasPlayerSlot: boolean
}

export async function listWorkspaceGames(): Promise<WorkspaceGame[]> {
  const resp = await fetch('/__ce-api__/list-workspace-games')
  const data = await resp.json()
  if (!data?.success) throw new Error(data?.error || 'Failed to list workspace games')
  return data.games || []
}

export interface MergeSkillsResult {
  success: true
  dir: string
  skillsApplied: number
  skillsSkipped: number
}

/**
 * POST to server merge endpoint.
 * Server reads -> upserts by slotId -> writes. characterId must already exist
 * (user must have gone through pixel-char "import to game as protagonist" first).
 */
export async function mergeSkillsToWorkspaceGame(params: {
  gameId: string
  characterId: string
  skills: ExportedSkill[]
}): Promise<MergeSkillsResult> {
  // P4 funnel: prefer host.tool.call, fall back to direct POST.
  if (forgeaxHost.available) {
    try {
      const r = await forgeaxHost.tool.call('character:merge-skills-to-workspace-game', params)
      if (r.ok) {
        const d = r.result as MergeSkillsResult | undefined
        if (d?.success) return d
      }
    } catch { /* fall through */ }
  }
  const resp = await fetch('/__ce-api__/merge-skills-to-workspace-game', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const data = await resp.json()
  if (!data?.success) throw new Error(data?.error || 'Failed to merge skills')
  return data
}

/**
 * Reverse-map game-side manifest skills back to editor-side SkillSlot shape.
 *
 * Use case: VFX pipeline UI shows "game currently has these skills", and lets
 * user pull game config back into the editor ("sync from game" button).
 *
 * Note: reverse-mapping is lossy -- manifest only stores 4 runtime types
 * (slash/impact/aura/projectile). We reverse-lookup via effectId -> binding table;
 * when multiple entries share the same type, color match wins. Only used for
 * display / fallback, does not affect publish.
 */
export function manifestSkillsToSkillSlots(
  manifestSkills: ReadonlyArray<ExportedSkill>,
): { slotId: string; effectId: string; effectLabel: string; vfxType: string; color: string }[] {
  return manifestSkills.map(s => {
    let bestId = ''
    let bestScore = -1
    for (const [effectId, b] of Object.entries(EFFECT_TO_BINDING)) {
      let score = 0
      if (b.type === s.vfx.type) score += 1
      if (b.color.toLowerCase() === (s.vfx.color || '').toLowerCase()) score += 2
      if (score > bestScore) { bestScore = score; bestId = effectId }
    }
    return {
      slotId: s.slotId,
      effectId: bestId,
      effectLabel: bestId || `(${s.vfx.type})`,
      vfxType: s.vfx.type,
      color: s.vfx.color,
    }
  })
}
