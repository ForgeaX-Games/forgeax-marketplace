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

type GraphNodeLike = {
  id?: string
  name?: string
  opId?: string
  params?: { __groupSourceBatteryName?: string }
}

function isPlaceOneDecorationNode(node: GraphNodeLike | undefined): boolean {
  if (!node) return false
  const bat =
    (typeof node.params?.__groupSourceBatteryName === 'string' && node.params.__groupSourceBatteryName.trim())
    || (typeof node.name === 'string' && node.name.trim())
    || ''
  return bat === 'PlaceOneDecoration'
}

function portRefName(port: unknown): string | undefined {
  if (typeof port === 'string' && port) return port
  if (port && typeof port === 'object') {
    const p = port as { portName?: unknown; label?: unknown }
    if (typeof p.portName === 'string' && p.portName) return p.portName
  }
  return undefined
}

/**
 * Real session failure (清水镇 P5): agent wired `aw_m0_seed.seed` → PlaceOne.`in_3`.
 * PlaceOne has NO Seed port — `in_3` is Point (point2d). That replace/overwrites
 * `manual_points.point` and execute reports empty group outputs. Reject at gate.
 */
export function checkPlaceOneSeedOnPointMiswire(
  ops: readonly unknown[],
  nodes: Record<string, GraphNodeLike> | readonly GraphNodeLike[] | null | undefined,
): SinoGateRejection | null {
  if (!Array.isArray(ops) || !nodes) return null
  const byId = new Map<string, GraphNodeLike>()
  if (Array.isArray(nodes)) {
    for (const n of nodes) {
      if (n?.id) byId.set(n.id, n)
    }
  } else {
    for (const [id, n] of Object.entries(nodes)) {
      byId.set(id, { ...n, id: n.id ?? id })
    }
  }

  for (let i = 0; i < ops.length; i++) {
    const op = asRecord(ops[i])
    if (!op || op.type !== 'connect') continue
    const source = asRecord(op.source)
    const target = asRecord(op.target)
    if (!source || !target) continue
    const srcId = typeof source.nodeId === 'string' ? source.nodeId : ''
    const srcPort = portRefName(source.port)
    const tgtId = typeof target.nodeId === 'string' ? target.nodeId : ''
    const tgtPort = portRefName(target.port)
    const fromSeed = srcId === 'aw_m0_seed' || srcPort === 'seed'
    if (!fromSeed || tgtPort !== 'in_3' || !tgtId) continue
    if (!isPlaceOneDecorationNode(byId.get(tgtId))) continue
    return {
      opIndex: i,
      opId: 'connect',
      reason:
        `placeone-seed-miswire: cannot connect seed → PlaceOneDecoration "${tgtId}".in_3 — ` +
        'in_3 is Point (point2d), PlaceOne has no Seed port.',
      fix:
        'Wire `manual_points.point` → `{ label:"Point", portName:"in_3" }`. ' +
        'Do NOT attach `aw_m0_seed` to PlaceOne. Seed is only for LocalPreciseDecoration / ' +
        'NaturalDecorationDistribution (their in_3) and other templates that expose a Seed label.',
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
