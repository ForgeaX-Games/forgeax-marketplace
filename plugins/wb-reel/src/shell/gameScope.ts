/**
 * gameScope —— 把"当前 game（工程）"绑定到影游工坊的剧本库。
 *
 * 背景（2026-06 根因修复）：
 *   wb-reel 作为 iframe 被主界面挂载，主界面已经把当前 game 的 slug 通过
 *   `?slug=<slug>` 喂进 iframe URL（见 interface 的 StandalonePluginIframe
 *   .buildIframeSrc）。但 wb-reel 一直忽略它，于是无论用户在顶栏切到哪个
 *   game，影游工坊永远读的是那份**全局** `.reel-scenarios` 库（activeId 停在
 *   上一次的剧本），新建 game / 新会话里生成的剧情也进不来。
 *
 * 这个模块把 slug 读出来，让剧本库（localStorage + 磁盘镜像 + forge-queue）
 * 按 game 隔离：
 *   - 有 slug：库走 `<root>/.forgeax/games/<slug>/reel/`，每个 game 一套独立
 *     剧本与 activeId；新建 game = 空白影游。
 *   - 无 slug：行为与历史完全一致（全局 `.reel-scenarios`），老剧本零改动。
 *
 * iframe 在 slug 变化时会整体重载（host 侧 src 变 → iframe reload），所以这里
 * 把 slug 缓存为模块级常量即可，一次 page-load 内不变。
 */

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,40}$/

let _cached: string | null | undefined

function readGameSlug(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const p = new URLSearchParams(window.location.search)
    // 主界面用 `slug=`；保留 `game=` 作为别名，便于直接拼 URL 调试。
    const raw = (p.get('slug') ?? p.get('game') ?? '').trim()
    return raw && SLUG_RE.test(raw) ? raw : null
  } catch {
    return null
  }
}

/** 当前 game slug；无（全局库）时为 null。结果缓存（iframe 重载才会变）。 */
export function getGameSlug(): string | null {
  if (_cached !== undefined) return _cached
  _cached = readGameSlug()
  return _cached
}

/**
 * 磁盘/forge-queue 端点的 `?game=<slug>` 查询后缀。
 * 全局库（无 slug）时返回空串，端点行为与历史一致。
 * @param prefix 当 URL 已带 query 时传 '&'，否则默认 '?'。
 */
export function gameQuery(prefix: '?' | '&' = '?'): string {
  const slug = getGameSlug()
  return slug ? `${prefix}game=${encodeURIComponent(slug)}` : ''
}

/** localStorage key 的 per-game 后缀（全局库时为空串）。 */
export function gameKeySuffix(): string {
  const slug = getGameSlug()
  return slug ? `:game:${slug}` : ''
}

/** 仅测试用：清缓存让下次重新读 URL。 */
export function __resetGameScopeForTest(): void {
  _cached = undefined
}
