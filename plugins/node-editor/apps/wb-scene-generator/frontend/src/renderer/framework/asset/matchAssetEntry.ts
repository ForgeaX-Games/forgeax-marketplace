// 💡 asset_name + asset_type → alias 匹配(scene-driven,告别 nameList 路由)
//
// 输入:scene 节点的 asset_name(必须)+ asset_type(可选,'tile' / 'asset' / undefined)
// 输出:AssetMatch | null
//
// 老 mode-texture 那一套 routeLayerToBindings(端口名 [N][M] / 打包 / 多条目隔离)
// 在新世界里**不存在**:scene 投影时已把每个 voxel layer 一对一 paired 一个 entry,
// id 跟 layer.value 对齐,没有打包 / 数组 id / 多条目这种东西了。
// 因此匹配收敛成一个纯函数:在合适的池(cutout / non-cutout)里按 name 4 级匹配,
// 命中后做变体组合并 + 提取 tileType/anchor。
//
// 资产 alias 字符串约定(沿用老规则,见 autoTextureMapping.ts):
//   * 第 5 字段(index 4)= "物品名称"      — 精确匹配的目标
//   * 第 9 字段(index 8)= "类型"         — '抠图' = cutout,其他都是 non-cutout
//   * 前 12 字段(index 0~11)            — 变体组基准键(同前 12 字段 = 同一资产的变体)
//   * 第 13 字段(index 12)= 变体值        — 同变体组中 alias 互为变体

// ── 公共类型 ─────────────────────────────────────────────────────────────

/** 资产库 alias 元数据(含可选 tileType 字段,标识 autotile 模板类型) */
export interface AliasMeta {
  alias: string
  tileType?: string
  /** Anchor X: 0=left, 1=right, 0.5=center (default) */
  anchorX?: number
  /** Anchor Y: 0=bottom, 1=top, 0.5=center (default) */
  anchorY?: number
  widthPx?: number
  heightPx?: number
  ppu?: number
  objectHeightPx?: number
  geometry?: {
    collisionMask?: CollisionMask
  }
}

export type CollisionMask =
  | { kind: 'rectangle'; x: number; y: number; width: number; height: number }
  | { kind: 'polygon'; points: Array<{ x: number; y: number }> }

export interface AssetEntry {
  /** scene attribute `asset_name`(降级 nodeName);驱动名称 4 级匹配 */
  assetName: string
  /** scene attribute `asset_alias`; exact selected library alias when available */
  assetAlias?: string
  /** scene attribute `asset_type`('tile' / 'asset' / undefined);驱动池选择 */
  assetType?: string
}

export interface AssetMatch {
  /** 主 alias(渲染时拿这个去 imageCache.getOrLoadImage) */
  primary: string
  /** 同变体组所有 alias(>=1;>1 时渲染随机选,确保变体等概率) */
  variants: string[]
  /** alias.tileType(如 'cliff' / 'wall' / 'tilemap');用于 autotile 路径 */
  tileType?: string
  /** alias.anchorX/Y → {x,y};用于精确 sprite 锚点 */
  anchor?: { x: number; y: number }
  /** alias 第 10 字段(index 9)= PPU(像素/单元);object 按此保持原图大小 */
  ppu?: number
  widthPx?: number
  heightPx?: number
  objectHeightPx?: number
  geometry?: AliasMeta['geometry']
}

// ── 内部工具 ─────────────────────────────────────────────────────────────

/** 去除 alias 前的区域前缀(如 "基准地块1_普通地板" → "普通地板") */
function stripZonePrefix(name: string): string {
  return name.replace(/^[^一-鿿]*[一-鿿]+\d*_/, '')
}

/** alias 第 N 个 [...] 字段;失败时返回空串 */
function bracketField(alias: string, index: number): string {
  const matches = alias.match(/\[([^\]]*)\]/g)
  if (!matches || matches.length <= index) return ''
  return matches[index].slice(1, -1).trim()
}

/** 前 12 个 [...] 字段拼接;失败时返回 alias 原文(防止误合并) */
function variantGroupKey(alias: string): string {
  const matches = alias.match(/\[([^\]]*)\]/g)
  if (!matches || matches.length < 12) return alias
  return matches.slice(0, 12).join('')
}

/**
 * 按 name 在 alias 池里做 4 级匹配(精确 → 去前缀精确 → 包含 → 去前缀包含)。
 * fuzzy=false 时仅用第 5 字段做精确比;fuzzy=true 时整 alias 字符串参与。
 * 命中后若该 alias ≥13 字段(含变体字段),自动收集所有"前 12 字段相同"的变体。
 */
function findAliasesByName(
  name: string,
  pool: string[],
  fuzzy: boolean,
): string[] {
  const stripped = stripZonePrefix(name)
  let firstMatch: string | undefined

  if (!fuzzy) {
    firstMatch = pool.find(a => bracketField(a, 4) === name)
    if (!firstMatch && stripped !== name) {
      firstMatch = pool.find(a => bracketField(a, 4) === stripped)
    }
  } else {
    firstMatch = pool.find(a => a === name)
    if (!firstMatch && stripped !== name) {
      firstMatch = pool.find(a => a === stripped)
    }
    if (!firstMatch) {
      firstMatch = pool.find(a => a.includes(name) || name.includes(a))
    }
    if (!firstMatch && stripped !== name) {
      firstMatch = pool.find(a => a.includes(stripped) || stripped.includes(a))
    }
  }

  if (!firstMatch) return []

  // 含变体字段 → 收集变体组
  const matches = firstMatch.match(/\[([^\]]*)\]/g)
  if (!matches || matches.length < 13) return [firstMatch]
  const groupKey = variantGroupKey(firstMatch)
  const variants = pool.filter(a => variantGroupKey(a) === groupKey)
  return variants.length > 0 ? variants : [firstMatch]
}

function findExactAlias(alias: string | undefined, pool: string[]): string[] {
  if (!alias) return []
  return pool.includes(alias) ? [alias] : []
}

/** 把 AliasMeta 列表分到 cutout / non-cutout 两池(按第 9 字段 '抠图') */
function splitPools(aliases: ReadonlyArray<AliasMeta>): {
  cutout: AliasMeta[]
  nonCutout: AliasMeta[]
} {
  const cutout: AliasMeta[] = []
  const nonCutout: AliasMeta[] = []
  for (const a of aliases) {
    if (bracketField(a.alias, 8) === '抠图') cutout.push(a)
    else nonCutout.push(a)
  }
  return { cutout, nonCutout }
}

// ── 主入口 ───────────────────────────────────────────────────────────────

/**
 * 根据 entry.assetType 选池后,在该池里按 entry.assetName 4 级匹配。
 *
 *   * 'tile'                  → 仅 non-cutout 池(tile 类是 autotile 模板,不能从抠图池出)
 *   * 'asset' / undefined     → cutout 池优先,空池或未命中 → 降级 non-cutout 池
 *
 * 命中后从 AliasMeta 提取 tileType / anchor 附在结果里。
 */
export function matchAssetEntry(
  entry: AssetEntry,
  aliases: ReadonlyArray<AliasMeta>,
  fuzzy: boolean,
): AssetMatch | null {
  if ((!entry.assetName && !entry.assetAlias) || aliases.length === 0) return null

  const { cutout, nonCutout } = splitPools(aliases)
  const cutoutNames = cutout.map(a => a.alias)
  const nonCutoutNames = nonCutout.map(a => a.alias)

  let matched: string[] = []
  if (entry.assetType === 'tile') {
    matched = findExactAlias(entry.assetAlias, nonCutoutNames)
    if (matched.length === 0 && entry.assetName) matched = findAliasesByName(entry.assetName, nonCutoutNames, fuzzy)
  } else {
    matched = findExactAlias(entry.assetAlias, cutoutNames)
    if (matched.length === 0 && entry.assetName) matched = findAliasesByName(entry.assetName, cutoutNames, fuzzy)
    if (matched.length === 0) {
      matched = findExactAlias(entry.assetAlias, nonCutoutNames)
      if (matched.length === 0 && entry.assetName) matched = findAliasesByName(entry.assetName, nonCutoutNames, fuzzy)
    }
  }
  if (matched.length === 0) return null

  // tileType / anchor 以 primary 为基准(变体间共享)
  const primary = matched[0]
  const meta = aliases.find(a => a.alias === primary)
  const out: AssetMatch = { primary, variants: matched }
  if (meta?.tileType) out.tileType = meta.tileType
  if (meta && (meta.anchorX !== undefined || meta.anchorY !== undefined)) {
    out.anchor = { x: meta.anchorX ?? 0.5, y: meta.anchorY ?? 0.5 }
  }
  if (meta?.widthPx !== undefined) out.widthPx = meta.widthPx
  if (meta?.heightPx !== undefined) out.heightPx = meta.heightPx
  if (meta?.objectHeightPx !== undefined) out.objectHeightPx = meta.objectHeightPx
  if (meta?.geometry) out.geometry = meta.geometry
  const ppu = parseInt(bracketField(primary, 9), 10)
  if (meta?.ppu !== undefined) out.ppu = meta.ppu
  else if (Number.isFinite(ppu) && ppu > 0) out.ppu = ppu
  return out
}
