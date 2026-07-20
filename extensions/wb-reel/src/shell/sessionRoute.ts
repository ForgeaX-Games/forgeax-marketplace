/**
 * sessionRoute —— URL（query string）↔ 会话状态（scenarioId / activeTab）双向同步。
 *
 * 为什么需要：
 *   清空 origin 的部署模式下（容器/SaaS），每次刷新浏览器都被重置为干净状态
 *   （localStorage / IDB 全空），单纯靠 localStorage 持久化"我刚才在编辑哪本剧本/
 *   在哪个 Tab"会失效。把这两个信号写进 URL 解决两件事：
 *     1) 刷新还原：URL 即"最近一次状态快照"，刷新后能精确回到 scenario × tab 组合
 *     2) 可分享：把链接收藏 / 跨设备打开就是同一本剧本（前提是后端有这条剧本数据）
 *
 * 启动顺序（由 App.tsx 的 boot effect 串起来）：
 *   1) readSessionRoute() ─ 同步函数，从 location.search 解析 ?scn / ?tab
 *   2) bootScenarioPersist({ preferredScenarioId: route.scn }) ─
 *      preferredScenarioId 优先于 db.activeId，覆盖"跳到磁盘最新"的旧默认行为
 *   3) shellStore 已经通过 zustand persist 中间件恢复 activeTab；
 *      如果 URL 里 ?tab 与 persist 恢复值不同，URL 优先（writeSessionRouteFromState
 *      在 boot 末尾再写一次确保一致）
 *   4) installSessionRouteSync(): 订阅 scenarioStore 与 shellStore，store 变化
 *      → history.replaceState 写 URL；同时监听 popstate 反向同步
 *
 * 设计原则：
 *   - replaceState（不是 pushState）：刷新到当前 URL 是 idempotent 操作，不污染历史栈
 *   - 只放最少的状态：scenarioId + tab。详情浮层、selectedShotId 等会话态不入 URL
 *   - 跟 localStorage 是双写关系：URL 缺失时 fallback 到 localStorage（lastEditedId），
 *     都不存在再走 db.activeId 兜底
 *
 * 不在这里做的事：
 *   - 不直接调 loadScenario：URL 解析只产出 string id，bootScenarioPersist 决定
 *     如何用它（找不到该 id 时回落 db.activeId，避免链接里指向已删除剧本时崩溃）
 */
import type { ShellTab, ForgeView } from './shellStore'
import { useShellStore } from './shellStore'
import { useScenarioStore } from '../scenario/scenarioStore'

const QUERY_KEY_SCENARIO = 'scn'
const QUERY_KEY_TAB = 'tab'
const QUERY_KEY_VIEW = 'view'
const QUERY_KEY_EPISODE = 'ep'

/**
 * 本地"最近编辑过的剧本 id"——浏览器侧持久化，清空 origin 的部署里每次刷新都会丢；
 * 但同一会话内（用户从历史下拉点切剧本 → 关 tab → 重开）它能命中，作为 URL
 * 缺失时的二级 fallback。
 *
 * key 与 scenario.lastEditedAt 等共用 'reel-studio.' 命名空间，便于将来按命名空间
 * 一次性清。
 */
const LAST_EDITED_KEY = 'reel-studio.lastEditedScenarioId'

const VALID_TABS: readonly ShellTab[] = ['forge', 'player']
const VALID_VIEWS: readonly ForgeView[] = ['script', 'image', 'tree', 'assets']

export interface SessionRoute {
  /** URL ?scn=xxx；缺失时为 undefined（调用方决定用 localStorage / activeId 兜底）*/
  scenarioId: string | undefined
  /** URL ?tab=xxx；非合法值时为 undefined */
  tab: ShellTab | undefined
  /** URL ?view=xxx；FORGE 内的二级视图（仅当 tab='forge' 才生效） */
  forgeView: ForgeView | undefined
  /** URL ?ep=xxx；StoryTree 当前激活的剧集 id；缺失时由 UI 兜底到第一集 */
  episodeId: string | undefined
}

/**
 * 同步读 URL 当前的会话状态。
 *
 * 老链接迁移（2026-05）：
 *   - 旧版 `?tab=storytree` → `?tab=forge&view=tree`
 *     这一段 swap 只在 readSessionRoute 里发生，让所有读 URL 的地方拿到的都是
 *     新枚举；installSessionRouteSync 启动时会调一次 writeSessionRouteFromState
 *     把 URL 反写成新形式，老链接彻底消化干净。
 *
 * SSR 安全：window 不存在时返回全 undefined。
 */
export function readSessionRoute(): SessionRoute {
  if (typeof window === 'undefined') {
    return { scenarioId: undefined, tab: undefined, forgeView: undefined, episodeId: undefined }
  }
  const params = new URLSearchParams(window.location.search)
  const rawScn = params.get(QUERY_KEY_SCENARIO)?.trim()
  const rawTab = params.get(QUERY_KEY_TAB)?.trim()
  const rawView = params.get(QUERY_KEY_VIEW)?.trim()
  const rawEp = params.get(QUERY_KEY_EPISODE)?.trim()

  let tab: ShellTab | undefined
  let forgeView: ForgeView | undefined

  if (rawTab === 'storytree') {
    // 兼容老链接：原 storytree tab 折叠为 forge.tree 视图
    tab = 'forge'
    forgeView = 'tree'
  } else if (rawTab && (VALID_TABS as readonly string[]).includes(rawTab)) {
    tab = rawTab as ShellTab
  }

  if (rawView && (VALID_VIEWS as readonly string[]).includes(rawView)) {
    // URL 显式给了 view 时它优先于 tab 自动迁移产生的 view
    forgeView = rawView as ForgeView
  }

  return {
    scenarioId: rawScn ? rawScn : undefined,
    tab,
    forgeView,
    episodeId: rawEp || undefined,
  }
}

/**
 * 读取 localStorage 的 lastEditedScenarioId（per-user 兜底；清空 origin 的环境下也丢）。
 * 不可用环境（SSR / privacy mode）静默返回 undefined。
 */
export function readLastEditedScenarioId(): string | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    const v = window.localStorage.getItem(LAST_EDITED_KEY)
    return v ? v : undefined
  } catch {
    return undefined
  }
}

/**
 * 把"我现在在编辑这本剧本"记到 localStorage。
 * 由 installSessionRouteSync 内部在 scenarioId 变化时自动调，外部一般不直接用。
 */
export function writeLastEditedScenarioId(id: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(LAST_EDITED_KEY, id)
  } catch {
    /* quota / privacy mode：忽略 */
  }
}

/**
 * 决定启动时该加载哪个剧本 id —— 优先级：URL > localStorage > undefined（让 boot 兜底）。
 *
 * 不返回 db.activeId：那一层兜底由 bootScenarioPersist 自己处理（接收 undefined 时
 * 回落到旧的 pickActive 路径，但只在 store 仍为 demo 时 swap，不再无脑覆盖）。
 */
export function resolvePreferredScenarioId(): string | undefined {
  const fromUrl = readSessionRoute().scenarioId
  if (fromUrl) return fromUrl
  return readLastEditedScenarioId()
}

/**
 * 把当前 store 状态写回 URL —— 由 installSessionRouteSync 订阅触发，也可手动调
 * （boot 末尾兜底写一次）。
 *
 * 写入策略：
 *   - replaceState：不污染浏览器后退栈
 *   - 仅当 URL 与目标不同时才写：避免不必要的 history 抖动 + popstate 误触发
 *   - tab === 'forge'（默认值）时**仍写**到 URL：让"我手动选了 forge"和
 *     "默认就是 forge"两种语义都明确（分享链接给别人时，对方拿到的也是 forge）
 *   - forgeView 仅在 tab='forge' 时写出；切到 player 时清掉 ?view=
 */
export function writeSessionRouteFromState(): void {
  if (typeof window === 'undefined') return
  const scn = useScenarioStore.getState().scenario.id
  const tab = useShellStore.getState().activeTab
  const forgeView = useShellStore.getState().forgeView
  const activeEpisodeId = useShellStore.getState().activeEpisodeId
  const url = new URL(window.location.href)
  const params = url.searchParams
  const before = url.search

  if (scn) params.set(QUERY_KEY_SCENARIO, scn)
  else params.delete(QUERY_KEY_SCENARIO)
  if (tab) params.set(QUERY_KEY_TAB, tab)
  else params.delete(QUERY_KEY_TAB)
  if (tab === 'forge' && forgeView) params.set(QUERY_KEY_VIEW, forgeView)
  else params.delete(QUERY_KEY_VIEW)
  if (activeEpisodeId) params.set(QUERY_KEY_EPISODE, activeEpisodeId)
  else params.delete(QUERY_KEY_EPISODE)

  // URL 没变就别写：避免和 popstate 之间的抖动（replaceState 不触发 popstate，
  // 但 React DevTools / 嵌入容器可能监听同步变化）
  url.search = params.toString() ? `?${params.toString()}` : ''
  if (url.search === before) return
  window.history.replaceState(window.history.state, '', url.toString())
}

/**
 * 安装订阅：store 变化 → URL；URL 变化（popstate）→ store。
 *
 * 返回 dispose 函数，App effect cleanup 时调。
 */
export function installSessionRouteSync(): () => void {
  if (typeof window === 'undefined') return () => undefined

  // store → URL
  const unsubScenario = useScenarioStore.subscribe((s, prev) => {
    if (s.scenario.id === prev.scenario.id) return
    writeSessionRouteFromState()
    writeLastEditedScenarioId(s.scenario.id)
  })
  const unsubShell = useShellStore.subscribe((s, prev) => {
    if (
      s.activeTab === prev.activeTab &&
      s.forgeView === prev.forgeView &&
      s.activeEpisodeId === prev.activeEpisodeId
    ) return
    writeSessionRouteFromState()
  })

  // popstate → store（用户手动改 URL / 浏览器前进后退）
  function onPopState(): void {
    const route = readSessionRoute()
    // tab + forgeView + episodeId 都同步（合法即采纳）；scenario 不在这里同步 ——
    // 因为切剧本要走 loadScenarioFromHistory（含 mediaStore 重 hydrate 链），
    // 不能在这里直接 set scenarioStore。让用户自己点历史下拉，或在
    // sessionRoute 之外做更复杂的"URL 切剧本"按钮。
    const shell = useShellStore.getState()
    if (route.tab && route.tab !== shell.activeTab) {
      shell.setActiveTab(route.tab)
    }
    if (route.forgeView && route.forgeView !== shell.forgeView) {
      shell.setForgeView(route.forgeView)
    }
    // episodeId 变化：URL 缺失 → null，UI 层会兜底到第一集
    const nextEpId = route.episodeId ?? null
    if (nextEpId !== shell.activeEpisodeId) {
      shell.setActiveEpisodeId(nextEpId)
    }
  }
  window.addEventListener('popstate', onPopState)

  return () => {
    unsubScenario()
    unsubShell()
    window.removeEventListener('popstate', onPopState)
  }
}

/**
 * 组装"分享当前剧本"的可粘贴链接 —— TopBar"复制链接"按钮用。
 * 包含 origin + pathname + ?scn=&tab=&view=，剥掉 hash 与其它 query。
 */
export function buildShareableUrl(
  scenarioId: string,
  tab?: ShellTab,
  forgeView?: ForgeView,
): string {
  if (typeof window === 'undefined') return ''
  const url = new URL(window.location.href)
  url.hash = ''
  // 不保留其它 query（避免把 dev 调试 query 也分享出去）
  url.search = ''
  url.searchParams.set(QUERY_KEY_SCENARIO, scenarioId)
  if (tab) url.searchParams.set(QUERY_KEY_TAB, tab)
  if (tab === 'forge' && forgeView) url.searchParams.set(QUERY_KEY_VIEW, forgeView)
  return url.toString()
}
