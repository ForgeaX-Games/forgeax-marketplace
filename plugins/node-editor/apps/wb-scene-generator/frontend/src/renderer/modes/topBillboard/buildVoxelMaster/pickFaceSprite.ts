// 💡 单 face 的 autotile sprite 选取
//
// 三步:
//   ① 算邻域 key —— 'top' 用 (u,d,l,r) 同 z 平面 4 邻;'front' 用 (t,b,l,r) z 上下 + xy 左右
//   ② 选 map     —— face.variants 顺序匹配 when.regionContains,首条命中走 variant.map,
//                    否则走默认 face.map
//   ③ 查表 + 变体 randomRules —— 命中 randomRules.tileId 时按 cellRng 决定保留 / 换变体

import { buildTopFaceKey, lookupWithWildcard } from '../../../framework/asset/neighborKey'
import type { FaceRule, RuleSprite } from '../../../framework/asset/ruleCache'
import type { CollectedCell } from './types'

/**
 * pickFaceSprite 的所有依赖打包。比一堆位置参数好读、好扩展。
 * 拓扑感知 / 区域查询的演化(加新 region source、加 face condition kind)只动 ctx
 * 类型 + 函数内部分支,调用方签名不变。
 */
export interface PickFaceContext {
  face: FaceRule
  faceTag: 'top' | 'front'
  sprites: ReadonlyArray<RuleSprite>
  validVariantIdxs: ReadonlyArray<number>
  cell: CollectedCell
  /** per-layer 3D 坐标集,邻域 has() 查这里 */
  coordsByLayerIdx: Map<number, Set<string>>
  /** rule.regions 解析结果,name → "x,y" set;face.variants 评估查这里 */
  regions: Map<string, Set<string>>
}

export function pickFaceSprite(ctx: PickFaceContext): RuleSprite | null {
  const idx = pickFaceSpriteIndex(ctx)
  return ctx.sprites[idx] ?? ctx.sprites[0] ?? null
}

/**
 * The face's resolved sprite INDEX into `ctx.sprites` — the canonical autotile
 * pick (neighbour-key incl. `edgeDist2`, variant region-map selection,
 * randomRules variant substitution). `pickFaceSprite` is just this + an array
 * lookup; consumers that need the index itself (e.g. the headless scene
 * exporter, which maps the index to an atlas sub-tile) call this directly so
 * there is ONE implementation of the pick — no parallel re-derivation. Always
 * returns a valid index into `ctx.sprites` (clamped to 0).
 */
export function pickFaceSpriteIndex(ctx: PickFaceContext): number {
  const { face, faceTag, sprites, validVariantIdxs, cell, coordsByLayerIdx, regions } = ctx
  const layerSet = coordsByLayerIdx.get(cell.layerIdx)
  const has = (dx: number, dy: number, dz: number): boolean =>
    !!layerSet && layerSet.has(`${cell.x + dx},${cell.y + dy},${cell.z + dz}`)

  // ① 邻域 key
  let key: string
  if (faceTag === 'top') {
    // top 面:adjacent4 = (u,d,l,r);edgeDist2 额外带 (u2,d2) 竖直距离 2 探测。
    key = buildTopFaceKey((dx, dy) => has(dx, dy, 0), face.keyMode)
  } else {
    // front: t/b 走 z 轴,l/r 同 z 平面
    const t = has(0, 0,  1) ? 1 : 0
    const b = has(0, 0, -1) ? 1 : 0
    const l = has(-1, 0, 0) ? 1 : 0
    const r = has( 1, 0, 0) ? 1 : 0
    key = `${t},${b},${l},${r}`
  }

  // ② 选 map:variants 顺序匹配,首条 when.regionContains 命中的 variant.map 取代默认 face.map
  // when.regionContains:相对当前 voxel 的 xy 偏移 cell 是否在指定 region 集合内。
  // region 已在 binding 阶段解析为 Set<"x,y">,这里 O(1) 查表。
  let map: Record<string, number> = face.map
  if (face.variants && face.variants.length > 0) {
    for (const v of face.variants) {
      const rc = v.when.regionContains
      const set = regions.get(rc.region)
      if (!set) continue
      const probeKey = `${cell.x + rc.offset[0]},${cell.y + rc.offset[1]}`
      if (set.has(probeKey)) {
        map = v.map
        break
      }
    }
  }

  // ③ 查表 + randomRules 变体替换
  let idx = lookupWithWildcard(map, key) ?? 0
  if (face.randomRules && face.randomRules.length > 0 && validVariantIdxs.length > 0) {
    // saltBase 把 face 拉开,避免同一 (x,y) 顶面立面变体撞车
    const saltBase = faceTag === 'top' ? 0 : 100
    for (const r of face.randomRules) {
      if (idx !== r.tileId) continue
      if (cellRng(cell.x, cell.y, saltBase) < r.keepProbability) break
      idx = validVariantIdxs[Math.floor(cellRng(cell.x, cell.y, saltBase + 1) * validVariantIdxs.length)]
      break
    }
  }
  if (idx < 0 || idx >= sprites.length) idx = 0
  return idx
}

/**
 * 把 (x, y, salt) 散到 [0,1)。同 (x,y) 跨帧返回同样值 → 变体不闪烁。
 * 不同 cell 之间散列均匀(三个素数倍数 + xor + 32-bit 截断)。
 */
function cellRng(x: number, y: number, salt: number): number {
  const h = ((x * 2654435769) ^ (y * 1234567891) ^ (salt * 1013904223)) >>> 0
  return h / 4294967296
}
