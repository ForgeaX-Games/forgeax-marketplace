// Sino agent op-allowlist gate for POST /api/v1/batch.
//
// Sino may ONLY:
//   - instantiate template groups via scene:pipeline.instantiateTemplate (channel A)
//   - connect + whitelisted composer-utility batteries via applyBatch (channel B)
//
// Non-whitelisted opIds are invisible to AI (scene:composerUtilities.list) and
// rejected server-side here. Template internals (alg_*, rect_grid, …) exist only
// inside groups materialized by instantiateTemplate — never via Sino applyBatch.

/** opId sentinel for group shadow nodes (mirrors node-runtime GROUP_OP_ID). */
const GROUP_OP_ID = '__group__'

/**
 * Composer-utility batteries Sino may place at the top level via createNode.
 * Everything else is template-private or human-only — not in AI tool catalogs.
 *
 * Keep in lockstep with compose-sino-scene/SKILL.md §工具电池目录.
 */
export const SINO_TOP_LEVEL_OPID_ALLOWLIST: ReadonlySet<string> = new Set([
  'empty_scene',
  'text_panel',
  'number_const',
  'seed_control',
  'string_concat',
  'toggle',
  'manual_points',
  'tree_merge',
  'tree_flatten',
  'scene_merge_subtrees',
  'scene_output',
  /** PathConnection POI derivation — door focus + voxel explode (see PathConnection.md §1). */
  'scene_focus_path',
  /** AreaPartition / multi-child templates — fan out each sub-zone for per-branch wiring. */
  'scene_focus_children',
  'node_explode',
  'building_footprint_mask',
])

/** Structural batch ops forbidden for Sino — groups only via instantiateTemplate. */
export const SINO_FORBIDDEN_BATCH_TYPES: ReadonlySet<string> = new Set([
  'createGroup',
  'ungroup',
])

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : null
}

export function isSinoBatch(opts: { actor?: unknown } | undefined, callerAgentId: unknown): boolean {
  const actor = typeof opts?.actor === 'string' ? opts.actor : ''
  if (actor === 'sino' || actor === 'ai:sino' || actor.startsWith('ai:sino')) return true
  if (typeof callerAgentId === 'string' && (callerAgentId === 'sino' || callerAgentId.startsWith('sino-'))) {
    return true
  }
  return false
}

export interface SinoGateRejection {
  reason: string
  opIndex: number
  opId: string
  fix: string
}

function buildSinoRejection(opIndex: number, opId: string, kind: 'op' | 'structural'): SinoGateRejection {
  if (kind === 'structural') {
    return {
      opIndex,
      opId,
      reason: `sino-op-not-allowed: batch op type "${opId}" is forbidden for Sino.`,
      fix:
        'Template groups land ONLY via scene:pipeline.instantiateTemplate (channel A). ' +
        'applyBatch (channel B) is connect + composerUtilities whitelist batteries only.',
    }
  }

  const internalHint =
    opId.startsWith('alg_') || opId === 'rect_grid' || opId === 'grid2node' || opId === 'add_child'
      ? 'This opId is template-internal. '
      : opId === GROUP_OP_ID
        ? 'Group shadow nodes are minted by instantiateTemplate, not createNode. '
        : ''

  return {
    opIndex,
    opId,
    reason: `sino-op-not-allowed: top-level createNode opId "${opId}" is outside the composer-utility allowlist.`,
    fix:
      internalHint +
      'Use scene:pipeline.instantiateTemplate for template groups. ' +
      'For wiring helpers see scene:composerUtilities.list (the only battery catalog exposed to Sino).',
  }
}

/**
 * Validate a Sino batch. Returns first violation or null when allowed.
 */
export function checkSinoOpAllowlist(ops: readonly unknown[]): SinoGateRejection | null {
  if (!Array.isArray(ops)) return null

  for (let i = 0; i < ops.length; i++) {
    const op = asRecord(ops[i])
    if (!op || typeof op.type !== 'string') continue

    if (SINO_FORBIDDEN_BATCH_TYPES.has(op.type)) {
      return buildSinoRejection(i, op.type, 'structural')
    }

    if (op.type !== 'createNode') continue
    const opId = typeof op.opId === 'string' ? op.opId : ''
    if (!SINO_TOP_LEVEL_OPID_ALLOWLIST.has(opId)) {
      return buildSinoRejection(i, opId, 'op')
    }
  }
  return null
}

/** Project full runtime op catalog down to Sino-visible composer utilities. */
export function filterComposerUtilityOps(
  ops: readonly Record<string, unknown>[],
): Array<Record<string, unknown>> {
  return ops.filter((op) => typeof op.id === 'string' && SINO_TOP_LEVEL_OPID_ALLOWLIST.has(op.id))
}
