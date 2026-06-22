import type {
  Blockout,
  BlockoutCamera,
  BlockoutObject,
  Transform,
  Vec3,
} from '../../scenario/types'

/**
 * normalizeBlockout —— 把不可信 raw（旧持久化 / LLM / 导入）收敛成合法 Blockout。
 *
 * 规则（非破坏性，与 normalizeScenario 同风格：能补则补、非法静默丢弃）：
 *   - transform 补默认（pos 0 / rot 0 / scale 1）。
 *   - cameras 按 order 升序**稳定**排序（同 order 保持输入序），再把 order 重排为 0..n-1。
 *   - 对象 linkedAnchor 的目标 id 不在对应有效集合时，置 linkedAnchor=undefined（保留对象）。
 *   - 缺 id/kind 的对象、缺 id 的相机直接丢弃。
 */

export interface NormalizeBlockoutCtx {
  validCharacterIds?: ReadonlySet<string>
  validLocationIds?: ReadonlySet<string>
  validPropIds?: ReadonlySet<string>
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function normalizeVec3(v: unknown, fallback: Vec3): Vec3 {
  const o = (v ?? {}) as Partial<Vec3>
  return {
    x: num(o.x, fallback.x),
    y: num(o.y, fallback.y),
    z: num(o.z, fallback.z),
  }
}

export function normalizeTransform(t: unknown): Transform {
  const o = (t ?? {}) as Partial<Transform>
  return {
    pos: normalizeVec3(o.pos, { x: 0, y: 0, z: 0 }),
    rot: normalizeVec3(o.rot, { x: 0, y: 0, z: 0 }),
    scale: normalizeVec3(o.scale, { x: 1, y: 1, z: 1 }),
  }
}

const OBJECT_KINDS = new Set(['billboard', 'box', 'capsule', 'figure', 'cylinder', 'plane'])
const FIGURE_POSES = new Set([
  'stand', 'apose', 'tpose', 'walk', 'run', 'sit', 'crouch', 'point', 'wave', 'cross', 'fight',
])
const CAMERA_MOVES = new Set(['static', 'dolly-in', 'dolly-out', 'orbit', 'pan', 'crane'])
const FRAMINGS = new Set(['wide', 'medium', 'close', 'insert', 'ots', 'pov'])

function validIdsFor(
  kind: 'character' | 'location' | 'prop',
  ctx: NormalizeBlockoutCtx,
): ReadonlySet<string> | undefined {
  if (kind === 'character') return ctx.validCharacterIds
  if (kind === 'location') return ctx.validLocationIds
  return ctx.validPropIds
}

function normalizeObject(
  raw: unknown,
  ctx: NormalizeBlockoutCtx,
): BlockoutObject | null {
  const o = (raw ?? {}) as Partial<BlockoutObject>
  if (!o.id || !o.kind || !OBJECT_KINDS.has(o.kind)) return null

  let linkedAnchor = o.linkedAnchor
  if (linkedAnchor) {
    const valid = validIdsFor(linkedAnchor.kind, ctx)
    // 仅当调用方提供了该类别的有效集合且不包含时才判非法；未提供集合则不校验（保留）
    if (valid && !valid.has(linkedAnchor.id)) linkedAnchor = undefined
  }

  return {
    id: o.id,
    kind: o.kind,
    label: o.label,
    transform: normalizeTransform(o.transform),
    linkedAnchor,
    texMediaId: o.texMediaId,
    colorRole: o.colorRole,
    pose: o.pose && FIGURE_POSES.has(o.pose) ? o.pose : undefined,
  }
}

function normalizeCamera(raw: unknown): BlockoutCamera | null {
  const c = (raw ?? {}) as Partial<BlockoutCamera>
  if (!c.id) return null
  return {
    id: c.id,
    order: num(c.order, 0),
    name: typeof c.name === 'string' && c.name ? c.name : '机位',
    transform: normalizeTransform(c.transform),
    fovMm: num(c.fovMm, 35),
    framing: c.framing && FRAMINGS.has(c.framing) ? c.framing : 'medium',
    move: c.move && CAMERA_MOVES.has(c.move) ? c.move : 'static',
    targetObjectId: c.targetObjectId,
  }
}

export function normalizeBlockout(
  raw: unknown,
  ctx: NormalizeBlockoutCtx = {},
): Blockout {
  const b = (raw ?? {}) as Partial<Blockout>

  const objects = (Array.isArray(b.objects) ? b.objects : [])
    .map((o) => normalizeObject(o, ctx))
    .filter((o): o is BlockoutObject => o !== null)

  const cameras = (Array.isArray(b.cameras) ? b.cameras : [])
    .map((c) => normalizeCamera(c))
    .filter((c): c is BlockoutCamera => c !== null)
    // JS Array.sort 稳定：同 order 保持输入顺序
    .sort((a, z) => a.order - z.order)
    .map((c, i) => ({ ...c, order: i }))

  return {
    id: typeof b.id === 'string' && b.id ? b.id : 'blockout',
    name: typeof b.name === 'string' ? b.name : '',
    objects,
    cameras,
  }
}
