// 💡 邻域 key 查表工具(rule asset 公共)
//
// 任何"邻居 0/1 多元组键 → sprite idx"的查表逻辑都走这里。`*` 是通配符。
// 多个通配键命中时,**通配符越少(越具体)优先级越高**。
//
// 用例:
//   * tile rule asset 的 face.map(pickFaceSprite 调用)
//   * legacy mode-texture 的 valueOverrides / cliff map2 等(通过 re-export 走老路径)

import type { FaceKeyMode } from './ruleCache'

/**
 * 构造 top-face 的邻域查表 key。`has(dx,dy)` 返回该相对偏移处是否有同 layer 同 type cell。
 *   * 'adjacent4'(缺省) → 4 位 "up,down,left,right"(±1 直接邻居,与历史一致)
 *   * 'edgeDist2'        → 6 位 "up,down,left,right,up2,down2",末两位探测竖直距离 2
 *     的邻居,使 map 能区分"距某端 1 格"与"真正中段"(5 行桥面首尾固定 / 中段重复)。
 * 注:up = (x,y-1)(图像上方);down = (x,y+1)(图像下方)。up2/down2 同理 ±2。
 */
export function buildTopFaceKey(
  has: (dx: number, dy: number) => boolean,
  keyMode?: FaceKeyMode,
): string {
  const b = (v: boolean): 0 | 1 => (v ? 1 : 0)
  const u = b(has(0, -1))
  const d = b(has(0, 1))
  const l = b(has(-1, 0))
  const r = b(has(1, 0))
  if (keyMode !== 'edgeDist2') return `${u},${d},${l},${r}`
  const u2 = b(has(0, -2))
  const d2 = b(has(0, 2))
  return `${u},${d},${l},${r},${u2},${d2}`
}

/**
 * 支持通配符 `*` 的 map 查表函数。
 * 先精确匹配,若未命中则将 key 中每一位依次替换为 `*` 后再查;
 * 多个通配键命中时,通配符越少的(越具体)优先级越高。
 *
 * 例如 key="1,0,1,0",会依次尝试:
 *   1,0,1,0  →  *,0,1,0 / 1,*,1,0 / ...  →  *,*,1,0 / ...  →  *,*,*,*
 */
export function lookupWithWildcard(map: Record<string, number>, key: string): number | undefined {
  if (key in map) return map[key]
  const parts = key.split(',')
  const n = parts.length
  // 按通配符数量从少到多枚举(优先最具体的规则)
  for (let wildcards = 1; wildcards <= n; wildcards++) {
    // 枚举所有 C(n, wildcards) 种位置组合
    const indices = Array.from({ length: wildcards }, (_, i) => i)
    while (true) {
      const candidate = parts.slice()
      for (const i of indices) candidate[i] = '*'
      const k = candidate.join(',')
      if (k in map) return map[k]
      // 移动到下一个组合
      let pos = wildcards - 1
      while (pos >= 0 && indices[pos] === n - wildcards + pos) pos--
      if (pos < 0) break
      indices[pos]++
      for (let j = pos + 1; j < wildcards; j++) indices[j] = indices[j - 1] + 1
    }
  }
  return undefined
}
