// Sino agent op-allowlist gate for POST /api/v1/batch.
//
// Sino (the "scene composer" agent, plugin @forgeax-plugin/agent-sino) is a
// deliberately constrained role: it may only compose scenes out of the 6
// prebuilt scene template groups plus a small whitelist of top-level utility
// batteries (see SINO_TOP_LEVEL_OPID_ALLOWLIST). This is the SERVER-SIDE half of
// a two-layer guard — the other half is the skill doc (compose-sino-scene)
// constraining the AI's op choices. Here we hard-reject any top-level
// `createNode` whose opId is outside the whitelist when (and only when) the
// batch is attributed to Sino.
//
// Design constraints honoured:
//   - DEFAULT-OFF for everyone else. A non-Sino caller (UI 'editor'/'ui',
//     other agents, CLI, tests) is never affected — `isSinoBatch` must return
//     false for them, so the existing behaviour is byte-for-byte unchanged.
//   - Template-group instantiation MUST keep working. A group is materialized as
//     `createNode`(inner members) + `connect`(inner edges) + `createGroup`. The
//     inner members use arbitrary opIds (alg_*, scene_passthrough, …) that are
//     NOT in the whitelist — they are the group's private implementation. So we
//     EXEMPT every createNode whose nodeId appears in some createGroup's
//     `memberNodeIds` in the same batch, and only validate createNodes that stay
//     at the top level.
//   - Structural ops (connect/disconnect/updateNode/deleteNode/createGroup/
//     updateGroup/deleteGroup/ungroup/setMetadata) are never opId-gated.
//
// The whitelist below is kept in lockstep with the op-allowlist section of
// skills/compose-sino-scene/SKILL.md (and agent-sino/persona/zh.md). When you
// change one, change the other.

/** opId sentinel for group shadow nodes (mirrors node-runtime GROUP_OP_ID). */
const GROUP_OP_ID = '__group__'

/**
 * Top-level utility batteries Sino may place directly on the canvas via
 * `createNode`. Anything else (notably `alg_*` algorithm batteries) is rejected
 * at the top level — those may only appear as private members of an
 * instantiated template group. Source of truth shared with the skill doc.
 */
export const SINO_TOP_LEVEL_OPID_ALLOWLIST: ReadonlySet<string> = new Set([
  // group shadow sentinel — the 6 scene template groups all land via this
  GROUP_OP_ID,
  // semantic / scalar panels
  'text_panel',
  'number_const',
  'seed_control',
  'string_concat',
  // scene composition utilities
  'scene_focus_path',
  // scene query / analysis batteries — let sino precisely target a sub-region
  // (e.g. focus a building's `outer_door` child before connecting roads) instead
  // of only passing whole template-group scenes around. See compose-sino-scene
  // SKILL「善用场景查询/分析节点」and PathConnection/README POI 进阶用法.
  'scene_focus_children',
  'scene_get_attribute',
  'scene_merge_subtrees',
  'tree_merge',
  'tree_flatten',
  'add_child',
  'scene_output',
  // bridges used at the top level (empty_scene = the AddBaseGrid起手式 scene source)
  'empty_scene',
  'rect_grid',
  'grid2node',
  'voxel_slice',
  'node_explode',
  'building_footprint_mask',
  'grid_to_json',
  'scene_passthrough',
])

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : null
}

/**
 * Is this batch attributed to the Sino agent? We accept either signal:
 *   - `opts.actor` is/starts-with the sino marker (the AI sets `ai:sino` per the
 *     skill doc); we also tolerate a bare `sino`.
 *   - the forwarded caller agent id header is `sino` (tool-handlers.ts forwards
 *     ctx.caller.agentId as `x-forgeax-caller-agent-id`).
 * Anything else (UI editor, other agents, CLI, tests) is NOT sino → gate off.
 */
export function isSinoBatch(opts: { actor?: unknown } | undefined, callerAgentId: unknown): boolean {
  const actor = typeof opts?.actor === 'string' ? opts.actor : ''
  if (actor === 'sino' || actor === 'ai:sino' || actor.startsWith('ai:sino')) return true
  if (typeof callerAgentId === 'string' && callerAgentId === 'sino') return true
  return false
}

export interface SinoGateRejection {
  reason: string
  opIndex: number
  opId: string
}

/**
 * Validate a Sino batch against the top-level op allowlist. Returns the first
 * offending top-level `createNode` (opId outside the whitelist), or null when
 * the batch is allowed. createNodes collected as members of any `createGroup`
 * in the same batch are exempt (group-private implementation nodes).
 *
 * This is a pure function over the ops array so it is trivially unit-testable
 * and has no Fastify/runtime dependency.
 */
export function checkSinoOpAllowlist(ops: readonly unknown[]): SinoGateRejection | null {
  if (!Array.isArray(ops)) return null

  // Pass 1: collect every nodeId that some createGroup in this batch will
  // adopt as a member — those createNodes are the group's private internals and
  // are exempt from the top-level opId allowlist.
  const groupedMemberIds = new Set<string>()
  for (const raw of ops) {
    const op = asRecord(raw)
    if (!op || op.type !== 'createGroup') continue
    const members = op.memberNodeIds
    if (Array.isArray(members)) {
      for (const id of members) if (typeof id === 'string') groupedMemberIds.add(id)
    }
  }

  // Pass 2: gate only top-level createNodes (not adopted by a createGroup).
  for (let i = 0; i < ops.length; i++) {
    const op = asRecord(ops[i])
    if (!op || op.type !== 'createNode') continue
    const nodeId = typeof op.nodeId === 'string' ? op.nodeId : ''
    if (nodeId && groupedMemberIds.has(nodeId)) continue // group-private member → exempt
    const opId = typeof op.opId === 'string' ? op.opId : ''
    if (!SINO_TOP_LEVEL_OPID_ALLOWLIST.has(opId)) {
      return {
        reason: `sino-op-not-allowed: top-level createNode opId "${opId}" is outside the sino allowlist. ` +
          `Sino may only use the 6 scene template groups + whitelisted utility batteries; ` +
          `algorithm batteries are allowed only as members of an instantiated template group.`,
        opIndex: i,
        opId,
      }
    }
  }
  return null
}
