import { Engine } from './core/Engine'
import { CameraStore } from './core/CameraStore'
import { SceneManager } from './core/SceneManager'
import { CharacterPreview } from './core/CharacterPreview'
import { EventBus } from './core/EventBus'
import { PipelineRegistry } from './core/PipelineRegistry'
import { PlatformBridge } from './platform/Bridge'
import { forgeaxHost } from './platform/HostSdkBridge'
import { UIManager } from './ui/UIManager'
import type { PipelineContext } from './core/types'
import { bindHideableEvents, ensureHideableStyles } from './shared/HideableImage'
import { globalState } from './shared/GlobalState'

const T0 = performance.now()
let TLAST = T0
function tick(label: string): string {
  const now = performance.now()
  const total = (now - T0).toFixed(0)
  const delta = (now - TLAST).toFixed(0)
  TLAST = now
  return `[+${total}ms Δ${delta}ms] ${label}`
}

function setLoadingText(msg: string) {
  const el = document.getElementById('loading-text')
  if (el) el.textContent = msg
  console.log(`[main] ${tick(msg)}`)
}

function hideLoading() {
  const el = document.getElementById('loading-screen')
  if (el) el.classList.add('hidden')
}

/** Studio split-surface: read ?pane= and tag body so CSS hides irrelevant
 *  regions. See docs/v2-vision/modules/16-three-pane-embedding.md.
 *  Standalone (no query) → no attribute → full 4-region UI. */
function applyPaneAttribute() {
  const pane = new URLSearchParams(location.search).get('pane')
  if (pane === 'left' || pane === 'center') {
    document.body.setAttribute('data-pane', pane)
  }
}

async function main() {
  applyPaneAttribute()

  // Studio 把当前 game slug 拼进 iframe URL(?slug=)。bridge 的 STUDIO_INIT 也会
  // 带 slug,但那是异步的;handoff 加载要尽早拿到 slug,所以先从 URL 兜底读一次。
  const urlSlug = new URLSearchParams(location.search).get('slug')
  if (urlSlug) globalState.setSlug(urlSlug)

  const bridge = new PlatformBridge()
  bridge.onMessage((msg: unknown) => {
    const m = msg as { type?: string; ctx?: { slug?: string | null } }
    if ((m.type === 'studio:init' || m.type === 'studio:ctx') && m.ctx?.slug) {
      globalState.setSlug(m.ctx.slug)
    }
  })
  bridge.sendLoading(0, '初始化引擎...')

  if (forgeaxHost.available) {
    forgeaxHost.handshake(2000).then((r) => {
      if (r.ctx?.sessionId) globalState.setSlug(r.ctx.sessionId)
    }).catch(() => { /* standalone or host not ready */ })

    forgeaxHost.onSurfaceDispatch(({ actionId }) => {
      const w = window as typeof window & { __ceInvoke?: (id: string) => boolean }
      const handled = w.__ceInvoke ? w.__ceInvoke(actionId) : false
      return { handled }
    })
  }

  setLoadingText('正在创建引擎...')
  const canvas = document.getElementById('viewport') as HTMLCanvasElement
  if (!canvas) throw new Error('#viewport canvas not found')

  const engine = new Engine(canvas)
  bridge.sendLoading(20, '引擎已创建')
  setLoadingText('引擎已创建')

  const cameraStore = new CameraStore()
  const sceneManager = new SceneManager(engine)
  const characterPreview = new CharacterPreview(engine)
  const eventBus = new EventBus()

  bridge.sendLoading(40, '正在发现管线...')
  setLoadingText('正在发现管线...')
  const registry = new PipelineRegistry()

  // Workbench bridge ── 暴露给主工程的 workbench 编辑器 / 智能体调用。
  // 详细契约见 `docs/workbench-bridge.md`。
  const win = window as typeof window & {
    __ceManifest?: () => ReturnType<PipelineRegistry['getAgentManifest']>
    __ceInvoke?: (id: string) => boolean
  }
  win.__ceManifest = () => registry.getAgentManifest()
  ;(win as any).__ceRegistry = registry
  win.__ceInvoke = (id: string): boolean => {
    if (!registry.has(id)) {
      console.warn(`[ce:invoke] pipeline not found: ${id}`)
      return false
    }
    // 实际加载发生在 PipelinePanel 的 ce:switch-pipeline 处理器里(懒加载)。
    window.dispatchEvent(new CustomEvent('ce:switch-pipeline', { detail: { id } }))
    return true
  }

  bridge.sendLoading(60, '正在加载相机预设...')
  setLoadingText('正在加载相机预设...')
  await cameraStore.init()

  const context: PipelineContext = {
    engine,
    sceneManager,
    characterPreview,
    eventBus,
    workspacePath: './workspace',
  }

  ensureHideableStyles()
  bindHideableEvents()

  bridge.sendLoading(80, '正在构建界面...')
  setLoadingText('正在构建界面...')
  const uiRoot = document.getElementById('ui-root')!
  const uiManager = new UIManager(uiRoot, engine, sceneManager, cameraStore, registry, context)
  uiManager.init()
  console.log(tick('UI 构建完成'))

  // UI 已就绪,先把启动屏关掉、引擎跑起来,后续模块在后台并发加载,
  // 不再阻塞首屏可见时间。
  hideLoading()
  console.log(tick('🎬 loading 屏幕已隐藏'))
  bridge.sendLoading(100, '准备就绪')
  bridge.sendReady()
  engine.start()

  // CharacterRenderPanel 仅 video 管线用到 — 懒加载以缩短首屏时间。
  import('./core/CharacterRenderPanel')
    .then(m => { m.initCharacterRenderPanel(engine); console.log(tick('CharacterRenderPanel 已懒加载就绪')) })
    .catch(e => console.warn('[CharRenderPanel] lazy init failed:', e))

  ;(window as any).__ceEngine  = engine
  ;(window as any).__ceContext = context

  window.dispatchEvent(new CustomEvent('__ce:ready', { detail: { engine, context } }))

  // 跨工作台交接(走文件):wb-character「生成动画」时把 active-character 指针
  // 落盘到 .forgeax/games/<slug>/active-character.json,并(为快路径)发一次
  // postMessage 让宿主切 tab + 写一份 localStorage 信号。这里挂载时直接读盘
  // 拿 charId/role,按 charId 从磁盘把角色 portrait 灌进 globalState,再按
  // role 路由到对应管线(载具→vehicle-design,角色→pixel-char)。
  void consumeAnimHandoff(registry)

  // keep-alive 下本 iframe 可能早已 mount、main() 不会重跑。宿主每次切过来都会
  // (重新)写 handoff 信号 —— 写操作发生在 parent window,会在本 iframe 触发
  // 'storage' 事件,据此再消费一次,实现「已挂载时也能接收新角色」。
  window.addEventListener('storage', (ev: StorageEvent) => {
    if (ev.key === ANIM_HANDOFF_KEY && ev.newValue) {
      void consumeAnimHandoff(registry)
    }
  })

  console.log('[CharacterEditor] 就绪')
}

/** localStorage key the host writes the cross-workbench handoff payload to.
 *  Mirror of ANIM_HANDOFF_KEY in interface/StandalonePluginIframe.tsx. */
const ANIM_HANDOFF_KEY = 'forgeax:anim-handoff'

interface AnimHandoff { charId?: string; role?: string; slug?: string; portraitUrl?: string; ts?: number }

/** role → wb-anim 管线 id。载具走载具设计;角色(hero/npc/monster)默认走像素
 *  四方向。用户进来后仍可在顶栏切到 spine / video。 */
function pipelineForRole(role: string | undefined): string {
  return role === 'vehicle' ? 'vehicle-design' : 'pixel-char'
}

/** 读取并消费跨工作台交接:加载角色 + 路由管线。
 *
 *  「走文件连通」:真正的事实源是工程目录里的 active-character.json 指针文件
 *  (由 server /api/wb/character/active-character 读写)。localStorage 信号只是
 *  快路径 + slug 来源 + 私密模式兜底。优先读盘指针;读不到再退回 localStorage。
 *  消费后清掉 localStorage 信号,避免重复触发(指针文件不清,它是长期状态)。 */
async function consumeAnimHandoff(registry: PipelineRegistry): Promise<void> {
  // 1) 先吃掉 localStorage 快路径信号(取 slug + 一次性触发),随即清掉。
  let sig: AnimHandoff | null = null
  try {
    const raw = localStorage.getItem(ANIM_HANDOFF_KEY)
    if (raw) {
      try { sig = JSON.parse(raw) as AnimHandoff } catch { sig = null }
      try { localStorage.removeItem(ANIM_HANDOFF_KEY) } catch { /* ignore */ }
    }
  } catch { /* unavailable */ }
  if (sig?.slug) globalState.setSlug(sig.slug)

  // Fast path: portrait URL written by wb-character right before navigate.
  if (sig?.portraitUrl) {
    const ok = await globalState.loadPortraitFromUrl(sig.portraitUrl)
    if (ok && sig.charId) {
      globalState.updateProfile({ charId: sig.charId })
    }
  }

  // 2) 以工程目录指针文件为事实源,确定要加载哪个 charId/role。
  const slug = globalState.getSlug()
  let charId = ''
  let role: string | undefined
  if (slug) {
    const ptr = await readActiveCharacterPointer(slug)
    if (ptr?.charId) { charId = ptr.charId; role = ptr.role }
  }
  // 指针文件读不到(老数据 / 服务端未就绪)时,退回 localStorage 信号里的 charId/role。
  if (!charId && sig?.charId) { charId = sig.charId; role = sig.role }
  // 即使没拿到 charId,只要 handoff 信号带了 role,也用它路由——manifest 写盘
  // 可能失败(slug 缺失 / 服务端未就绪)导致 charId 为空,但用户的意图(载具/角色)
  // 在 sig.role 里是明确的,不能因为缺 charId 就静默停在默认 pixel-char。
  if (!role && sig?.role) role = sig.role

  // 有 charId 才尝试从磁盘加载角色数据(portrait 等);loadCharacterFromDisk 成功
  // 返回的 role 以磁盘 manifest 为准,失败(返回 null)则保留上面已确定的 role,
  // 不覆盖成兜底值。
  if (charId) {
    const r = await globalState.loadCharacterFromDisk(charId, { force: !sig?.portraitUrl })
    if (r?.role) role = r.role
  }

  // 既没 charId 也没 role:用户可能是从画廊直接进来的,静默退出(后续可加角色选择器)。
  if (!charId && !role) return

  // 用 handoff 已确定的 role 标记 upstream —— 这样即使磁盘 manifest 缺失
  // (loadCharacterFromDisk 没设上 _upstreamRole),vehicle-design 也能据此把
  // characterImage 同步成 designImage,图片才会真正出现在「载具动画」里。
  if (role) globalState.setUpstreamRole(role)

  const pid = pipelineForRole(role)
  console.log('[anim-handoff] charId=%s role=%s → pipeline=%s (sig.role=%s)',
    charId, role, pid, sig?.role)
  // PipelinePanel 的 ce:switch-pipeline 监听器会懒加载并激活该管线。
  // 带重试:handoff 是 async(读盘),其 dispatch 可能与 PipelinePanel.render()
  // 里「默认激活 mainMetas[0](pixel-char)」存在竞态——若 switch 事件在监听器
  // 注册前到达、或被默认激活覆盖,管线就停在 pixel-char。重试几次确保切过去。
  if (registry.has(pid)) {
    let tries = 0
    const fire = () => {
      window.dispatchEvent(new CustomEvent('ce:switch-pipeline', { detail: { id: pid } }))
      tries++
      // 多补发几次(0 / 120 / 360 / 720ms),覆盖默认激活的 async 完成时点。
      if (tries < 4) setTimeout(fire, tries * 240)
    }
    fire()
  }
}

/** 读工程目录里的 active-character 指针(GET /api/wb/character/active-character)。 */
async function readActiveCharacterPointer(
  slug: string,
): Promise<{ charId: string; role: string } | null> {
  try {
    const res = await fetch(
      `/api/wb/character/active-character?slug=${encodeURIComponent(slug)}`,
    )
    if (!res.ok) return null
    const j = await res.json() as { charId?: string | null; role?: string | null }
    if (!j.charId) return null
    return { charId: j.charId, role: j.role ?? 'hero' }
  } catch { return null }
}

main().catch((err) => {
  console.error('[main] Fatal:', err)
  hideLoading()
  const overlay = document.getElementById('error-overlay')
  if (overlay) {
    overlay.classList.add('visible')
    overlay.innerHTML = `<h2>启动错误</h2>${err?.stack || err}`
  }
})
