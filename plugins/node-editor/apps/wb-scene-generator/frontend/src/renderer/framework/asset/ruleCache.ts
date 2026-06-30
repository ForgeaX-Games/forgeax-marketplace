// 💡 共享 tilemap rule 资产缓存(engine-agnostic,与 imageCache 对称)
//
// 各 plugin 在 asset drawMode 下需要 tilemap 拼接规则(基础贴图切割 + 邻域→idx 映射)
// 时都通过这一处异步加载 JSON rule asset。
//
//   1. 通过 /library/serve/<alias> 异步 fetch 后端 'rules' zone 的 JSON 资产。
//      首次 getOrLoadRule(alias) 返回 null 并启动 fetch;onfetch-完成后 bumpTick,
//      通过 subscribeToRuleReadiness 唤醒订阅者重读 cacheKey。
//
//   2. 同 imageCache 的 per-URL load tick 思路:plugin 把"该 master 用到的 rule alias 的
//      url@tick 列表"拼进 useLayerSurface cacheKey,只有用到该 rule 的 master 重 build。
//
//   3. 解析失败 / 后端 404 → 删 cache 等下次 lifecycle 事件触发重试,不死循环。
//
//   4. RenderLifecycle.projectChanged 自动 hook(整库失效),跟图缓存一致。
//
// ── Schema 兼容 ─────────────────────────────────────────────────────────
//
// 支持两种 schema 版本,parser 都规范化成同一种内部形态(NormalizedRule):
//
//   v1(顶面专用):
//     { schemaVersion:1, ppu, basePieces, sprites, map, randomRules? }
//     —— 顶面 4 邻域 (u,d,l,r),立面跳过绘制(适合地面 / 平铺类)。
//
//   v2(顶面 + 立面):
//     { schemaVersion:2, ppu, sprites,
//       faces: { top?:{basePieces,map,randomRules?}, front?:{...} } }
//     —— top 用 (u,d,l,r)= xy 平面同 z 邻居;front 用 (t,b,l,r)= z+1/z-1/x±1
//     同 layer 邻居。faces 缺哪面 → 该面不绘制(适合墙体 / 立面差异化资产)。
//
// 内部 NormalizedRule 是 v2 形态。v1 在 parser 阶段直接包成 v2 的 faces.top。

import { RenderLifecycle } from '../lifecycle'

// ── 公共类型 ──────────────────────────────────────────────────────────────

/** 单个 sprite 在 atlas 中的切片 */
export interface RuleSprite {
  x: number
  y: number
  w: number
  h: number
  /** 9 锚点(默认 'center');v1 暂不全 schema,留给 v2 cliff/wall 等用 */
  anchor?:
    | 'top-left' | 'top-center' | 'top-right'
    | 'mid-left' | 'center'     | 'mid-right'
    | 'bot-left' | 'bot-center' | 'bot-right'
}

/** face variant 触发条件:目前只支持"某 region 是否包含某偏移点" */
export interface FaceVariantWhen {
  regionContains: {
    /** 引用 NormalizedRule.regions 里声明的 region 名 */
    region: string
    /** 相对当前 voxel 的 xy 偏移,e.g. [0, 1] 表示 (cell.x, cell.y+1) */
    offset: [number, number]
  }
}

/** 同一面的备用 map:when 命中就用 variant.map 取代默认 face.map */
export interface FaceVariant {
  when: FaceVariantWhen
  map: Record<string, number>
}

/**
 * 邻域 key 构造模式。决定 pickFaceSprite / buildSurface 给本 face 算多长的 key:
 *   * 缺省 / 'adjacent4' —— 4 位 "up,down,left,right",只看 ±1 直接邻居(历史默认,
 *     所有旧 rule 都是这个;up/down 在竖直方向对称)。
 *   * 'edgeDist2'      —— 6 位 "up,down,left,right,up2,down2",额外探测竖直方向
 *     距离 2 的邻居(up2 = (x,y-2) / down2 = (x,y+2))。让 map 能区分"距某端 1 格"
 *     与"真正中段",从而表达 5 行桥面这类 首尾各两行固定、仅中段重复 的 rule。
 *     水平方向不变(仍只 l/r),因此横向加宽逻辑与 4 邻一致。
 */
export type FaceKeyMode = 'adjacent4' | 'edgeDist2'

/** 单一 face 的查表 + 变体规则 */
export interface FaceRule {
  /** sprites[] 中归本 face 的"基础"贴图数(不含变体行);仅供 RulePreview 显示 + v1 推导变体 */
  basePieces: number
  /** 邻域 key 构造模式(缺省 'adjacent4',与历史行为一致)。见 FaceKeyMode。 */
  keyMode?: FaceKeyMode
  /**
   * 邻域键 → sprite idx。
   *   * top 面 (adjacent4) 键格式 "up,down,left,right",分别 = (x,y-1,z) (x,y+1,z) (x-1,y,z) (x+1,y,z) 同 layer
   *   * top 面 (edgeDist2) 键格式 "up,down,left,right,up2,down2",末两位 = (x,y-2,z) (x,y+2,z) 同 layer
   *   * front 面键格式 "top,bottom,left,right",分别 = (x,y,z+1) (x,y,z-1) (x-1,y,z) (x+1,y,z) 同 layer
   *   * '*' 通配符(lookupWithWildcard 解析)
   */
  map: Record<string, number>
  /**
   * 备用 map 列表:按数组顺序评估 when,第一个命中的 variant.map 取代默认 map。
   * 其它字段(randomRules / variantIdxs)对默认 map 和 variant map 共用。
   */
  variants?: FaceVariant[]
  /** 命中某 idx 时按 keepProbability 决定保留还是从 variantIdxs 选变体 */
  randomRules?: Array<{ tileId: number; keepProbability: number }>
  /**
   * 变体候选 sprite idx 列表(再经透明像素探测过滤后才采样)。
   *   * 缺省 = `sprites[basePieces..length-1]` —— 适合 v1 单 face / 顶面专用场景
   *   * v2 多 face 强烈建议显式声明:不同 face 的基础贴图可能各占 atlas 不同区段,
   *     不显式给 variantIdxs 会让"顶面的变体扫到立面的基础"
   */
  variantIdxs?: number[]
}

/**
 * Region 声明:rule 用的"外部 cell 集合"语义抽象。
 *   * source: "parent" —— 当前渲染调用收到的全部 voxels 的 xy 并集(单建筑 scene 下 = 父节点 footprint)
 *   * source: "self"   —— 当前 layer 自己的 xy 并集
 * Renderer 在 build 阶段解析成 Set<"x,y">,挂到 LayerAssetBinding。
 */
export interface RegionDecl {
  source: 'parent' | 'self'
}

/** 内部规范化后的 rule 形态。所有下游(buildVoxelMaster / RulePreview)只面对它 */
export interface NormalizedRule {
  /** 原始 schemaVersion(1 / 2),仅供调试 / 显示参考 */
  schemaVersion: 1 | 2
  name?: string
  description?: string
  ppu: number
  sprites: RuleSprite[]
  faces: {
    top?: FaceRule
    front?: FaceRule
  }
  /** 命名 region 声明,face.variants 通过 region 名引用 */
  regions?: Record<string, RegionDecl>
}

/** 历史名,保留导出避免破坏其它 import */
export type RuleAsset = NormalizedRule

// ── URL 构造(与 imageCache 同站点,单租户无 slug)──────────────────────

function getRuleUrl(alias: string): string {
  return `/api/v1/library/serve/${encodeURIComponent(alias)}`
}

// ── 缓存核心 ─────────────────────────────────────────────────────────────

type CacheEntry =
  | { state: 'loading' }
  | { state: 'ready'; rule: NormalizedRule }
  | { state: 'error' }

const cache = new Map<string, CacheEntry>()
const loadTickByAlias = new Map<string, number>()
const subscribers = new Set<() => void>()

function bumpTick(alias: string): void {
  loadTickByAlias.set(alias, (loadTickByAlias.get(alias) ?? 0) + 1)
}

function notifyReadiness(): void {
  for (const cb of subscribers) cb()
}

/** alias 当前 tick;首次 0,fetch 完成或失效 +1。plugin 拼进 cacheKey */
export function getRuleLoadTick(alias: string): number {
  return loadTickByAlias.get(alias) ?? 0
}

/** 订阅"任一 rule alias tick 变化"脉冲。返回 unsubscribe 函数 */
export function subscribeToRuleReadiness(cb: () => void): () => void {
  subscribers.add(cb)
  return () => { subscribers.delete(cb) }
}

/**
 * 取(或异步开始加载)指定 alias 的 NormalizedRule。
 * 返回 null = 加载中 / 失败 / schema 不合法,本帧用整图 fallback。
 */
export function getOrLoadRule(alias: string): NormalizedRule | null {
  const cached = cache.get(alias)
  if (cached) {
    return cached.state === 'ready' ? cached.rule : null
  }
  cache.set(alias, { state: 'loading' })
  fetch(getRuleUrl(alias))
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    })
    .then((json: unknown) => {
      const rule = parseRule(json)
      if (!rule) throw new Error('schema validation failed')
      cache.set(alias, { state: 'ready', rule })
      bumpTick(alias)
      notifyReadiness()
    })
    .catch(() => {
      cache.delete(alias)
    })
  return null
}

// ── Schema 解析 + v1→v2 规范化 ──────────────────────────────────────────

function parseRule(json: unknown): NormalizedRule | null {
  if (!json || typeof json !== 'object') return null
  const o = json as Record<string, unknown>
  const v = o.schemaVersion
  if (v !== 1 && v !== 2) return null
  if (typeof o.ppu !== 'number' || o.ppu <= 0) return null
  if (!Array.isArray(o.sprites) || o.sprites.length === 0) return null
  for (const s of o.sprites) {
    if (!s || typeof s !== 'object') return null
    const sp = s as Record<string, unknown>
    if (typeof sp.x !== 'number' || typeof sp.y !== 'number'
      || typeof sp.w !== 'number' || typeof sp.h !== 'number') return null
  }

  if (v === 1) {
    // v1:整体只有顶面查表;封装成 v2 内部形态的 faces.top
    if (typeof o.basePieces !== 'number' || o.basePieces < 0) return null
    const map = o.map as Record<string, unknown> | undefined
    if (!map || typeof map !== 'object') return null
    if (!validateMap(map)) return null
    return {
      schemaVersion: 1,
      name: typeof o.name === 'string' ? o.name : undefined,
      description: typeof o.description === 'string' ? o.description : undefined,
      ppu: o.ppu,
      sprites: o.sprites as RuleSprite[],
      faces: {
        top: {
          basePieces: o.basePieces,
          map: map as Record<string, number>,
          randomRules: parseRandomRules(o.randomRules),
        },
      },
    }
  }

  // v2
  const faces = o.faces as Record<string, unknown> | undefined
  if (!faces || typeof faces !== 'object') return null
  const top = parseFace(faces.top)
  const front = parseFace(faces.front)
  if (!top && !front) return null  // 至少要有一个 face 否则这个 rule 不画任何东西
  const regions = parseRegions(o.regions)
  return {
    schemaVersion: 2,
    name: typeof o.name === 'string' ? o.name : undefined,
    description: typeof o.description === 'string' ? o.description : undefined,
    ppu: o.ppu,
    sprites: o.sprites as RuleSprite[],
    faces: {
      ...(top ? { top } : {}),
      ...(front ? { front } : {}),
    },
    ...(regions ? { regions } : {}),
  }
}

function parseFace(raw: unknown): FaceRule | null {
  if (!raw || typeof raw !== 'object') return null
  const f = raw as Record<string, unknown>
  if (typeof f.basePieces !== 'number' || f.basePieces < 0) return null
  if (!f.map || typeof f.map !== 'object') return null
  if (!validateMap(f.map as Record<string, unknown>)) return null
  const variantIdxs = Array.isArray(f.variantIdxs)
    && f.variantIdxs.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 0)
    ? (f.variantIdxs as number[])
    : undefined
  const variants = parseFaceVariants(f.variants)
  const keyMode = f.keyMode === 'edgeDist2' ? 'edgeDist2' : undefined
  return {
    basePieces: f.basePieces,
    map: f.map as Record<string, number>,
    randomRules: parseRandomRules(f.randomRules),
    ...(keyMode ? { keyMode } : {}),
    ...(variantIdxs ? { variantIdxs } : {}),
    ...(variants ? { variants } : {}),
  }
}

function parseFaceVariants(raw: unknown): FaceVariant[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: FaceVariant[] = []
  for (const v of raw) {
    if (!v || typeof v !== 'object') continue
    const r = v as Record<string, unknown>
    const when = parseFaceVariantWhen(r.when)
    if (!when) continue
    if (!r.map || typeof r.map !== 'object') continue
    if (!validateMap(r.map as Record<string, unknown>)) continue
    out.push({ when, map: r.map as Record<string, number> })
  }
  return out.length > 0 ? out : undefined
}

function parseFaceVariantWhen(raw: unknown): FaceVariantWhen | null {
  if (!raw || typeof raw !== 'object') return null
  const w = raw as Record<string, unknown>
  const rc = w.regionContains as Record<string, unknown> | undefined
  if (!rc || typeof rc !== 'object') return null
  if (typeof rc.region !== 'string') return null
  if (!Array.isArray(rc.offset) || rc.offset.length !== 2) return null
  if (!rc.offset.every((n) => typeof n === 'number' && Number.isInteger(n))) return null
  return {
    regionContains: {
      region: rc.region,
      offset: [rc.offset[0] as number, rc.offset[1] as number],
    },
  }
}

function parseRegions(raw: unknown): Record<string, RegionDecl> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: Record<string, RegionDecl> = {}
  for (const [name, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue
    const src = (v as Record<string, unknown>).source
    if (src !== 'parent' && src !== 'self') continue
    out[name] = { source: src }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function validateMap(m: Record<string, unknown>): boolean {
  for (const v of Object.values(m)) {
    if (typeof v !== 'number') return false
  }
  return true
}

function parseRandomRules(raw: unknown): FaceRule['randomRules'] {
  if (!Array.isArray(raw)) return undefined
  const out: NonNullable<FaceRule['randomRules']> = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const rr = r as Record<string, unknown>
    if (typeof rr.tileId !== 'number' || typeof rr.keepProbability !== 'number') continue
    out.push({ tileId: rr.tileId, keepProbability: rr.keepProbability })
  }
  return out.length > 0 ? out : undefined
}

// ── 失效入口 ─────────────────────────────────────────────────────────────

/** 单个 rule alias 失效:清缓存 + bumpTick + notify */
export function clearRuleCache(alias: string): void {
  cache.delete(alias)
  bumpTick(alias)
  notifyReadiness()
}

/** 整库失效 */
export function clearAllRuleCache(): void {
  for (const alias of cache.keys()) bumpTick(alias)
  cache.clear()
  notifyReadiness()
}

// ── Lifecycle 自动 hook ──────────────────────────────────────────────────
// 注:legacy 的 registeredAssetReady / libraryZoneInvalidated 两个事件本仓库
// 尚未存在,故只 hook projectChanged(整库失效)。alias 级失效仍可由调用方
// 直接调 clearRuleCache。

RenderLifecycle.projectChanged.on(() => clearAllRuleCache())
