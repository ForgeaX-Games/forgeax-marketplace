// 💡 变体可见性候选集(透明像素探测)—— RENDER 与 EXPORT 共用的唯一实现
//
// autotile 的 randomRules 在 sprites[basePieces..] 的变体区段里随机替换,但 atlas
// 上变体槽不一定都有内容(可能是空/透明占位)。挑选候选时必须先把"全透明"的变体槽
// 剔除,否则随机替换会把一个透明块当作有效变体选中 —— 渲染器看到的是空,导出却落了
// 一个透明占位块,二者发散。
//
// 关键点:渲染器(浏览器 canvas / @napi-rs/canvas)用 getImageData 取变体子矩形的
// 像素;导出(headless)用自带的 PNG 解码器取像素。二者像素来源不同,但"哪些变体非
// 透明"这个判定逻辑必须是同一份代码,否则又退化成两套实现 —— 这正是 common-16 透明
// 变体 bug 的根因。本模块把该判定收敛为一个纯函数,只吃一个最小 RGBA 视图,render
// 和 export 都喂各自解出来的像素进来,得到逐字节一致的候选集。

import type { FaceRule, RuleSprite } from './ruleCache'

/**
 * 最小 RGBA 视图。浏览器侧用 `ctx.getImageData(...).data`(Uint8ClampedArray),
 * headless 侧用 PNG 解码出的 Buffer —— 两者都满足 `data[(y*width+x)*4 + 3]` 是 alpha。
 */
export interface RgbaView {
  width: number
  height: number
  /** Straight RGBA8, row-major; length = width*height*4. */
  data: { readonly length: number; readonly [i: number]: number }
}

/**
 * 变体面的"原始"候选区段:面显式声明 `variantIdxs` 用之,否则按习惯取
 * `sprites[basePieces..length-1]`。这是 OPACITY 过滤之前的全集。
 */
export function rawVariantCandidates(face: FaceRule, spriteCount: number): number[] {
  if (face.variantIdxs) return face.variantIdxs.slice()
  const range: number[] = []
  for (let i = face.basePieces; i < spriteCount; i++) range.push(i)
  return range
}

/**
 * 变体子矩形是否含可见像素(任一 alpha>0)。`img` 为 null(无法取像素)时乐观判定
 * 为 true —— 与渲染器"无 ctx 不丢候选"的行为一致,避免误删本该有内容的变体。
 */
export function spriteHasVisiblePixel(img: RgbaView | null, sprite: RuleSprite): boolean {
  if (!img) return true
  const x0 = Math.max(0, Math.floor(sprite.x))
  const y0 = Math.max(0, Math.floor(sprite.y))
  const x1 = Math.min(img.width, x0 + Math.max(1, Math.floor(sprite.w)))
  const y1 = Math.min(img.height, y0 + Math.max(1, Math.floor(sprite.h)))
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (img.data[(y * img.width + x) * 4 + 3]! > 0) return true
    }
  }
  return false
}

/**
 * 给定 face + 全部 sprite 矩形 + 解出的 sheet 像素,返回**非透明**变体候选 idx。
 * randomRules 只会从这个集合里采样,因此透明占位块永远不会被选中。RENDER 与 EXPORT
 * 都调用本函数(各自喂像素),所以两侧候选集逐字节一致。
 *
 * `img` 为 null 时退化为原始候选区段(乐观:像素不可得就不剔除)。
 */
export function computeValidVariantIdxs(
  face: FaceRule,
  sprites: ReadonlyArray<RuleSprite>,
  img: RgbaView | null,
): number[] {
  const candidates = rawVariantCandidates(face, sprites.length)
  const out: number[] = []
  for (const i of candidates) {
    if (i >= 0 && i < sprites.length && spriteHasVisiblePixel(img, sprites[i]!)) out.push(i)
  }
  return out
}
