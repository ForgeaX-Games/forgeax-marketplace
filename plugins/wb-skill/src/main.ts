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

  // Studio 把当前 game slug 拼进 iframe URL(?slug=)。bridge 的 studio:init 也会
  // 带 slug,但那是异步的;跨工作台交接要尽早拿到 slug,所以先从 URL 兜底读一次。
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

  import('./vfx2-bootstrap').catch(e => console.warn('[VFX2] bootstrap load failed:', e))

  // 跨工作台交接(走文件):从工程目录的 active-character 指针读取上游角色设计
  // 产出,按 charId 从磁盘 manifest 把角色 portrait 灌进 globalState(同时写回
  // 'character-editor:global-design',vfx 管线的 CharacterState 直接读得到)。
  // keep-alive 下本 iframe 可能早已 mount,宿主切过来会重写 handoff 信号触发
  // 'storage' 事件,据此再消费一次。
  void consumeCharacterHandoff()
  window.addEventListener('storage', (ev: StorageEvent) => {
    if (ev.key === ANIM_HANDOFF_KEY && ev.newValue) {
      void consumeCharacterHandoff()
    }
  })

  console.log('[CharacterEditor] 就绪')
}

/** localStorage 快路径信号 key(宿主导航时写),与 interface / wb-anim 对齐。 */
const ANIM_HANDOFF_KEY = 'forgeax:anim-handoff'

/** 读工程目录 active-character 指针 + 加载上游角色。事实源是磁盘指针文件;
 *  localStorage 信号只作快路径触发 + slug 兜底。 */
async function consumeCharacterHandoff(): Promise<void> {
  // 吃掉一次性快路径信号(取 slug),随即清掉。
  let sigCharId = ''
  try {
    const raw = localStorage.getItem(ANIM_HANDOFF_KEY)
    if (raw) {
      try {
        const sig = JSON.parse(raw) as { charId?: string; slug?: string }
        if (sig.slug) globalState.setSlug(sig.slug)
        if (sig.charId) sigCharId = sig.charId
      } catch { /* ignore */ }
      try { localStorage.removeItem(ANIM_HANDOFF_KEY) } catch { /* ignore */ }
    }
  } catch { /* unavailable */ }

  const slug = globalState.getSlug()
  if (!slug) return
  let charId = sigCharId
  try {
    const res = await fetch(
      `/api/wb/character/active-character?slug=${encodeURIComponent(slug)}`,
    )
    if (res.ok) {
      const j = await res.json() as { charId?: string | null }
      if (j.charId) charId = j.charId
    }
  } catch { /* server not ready — fall back to sig charId */ }
  if (!charId) return
  await globalState.loadCharacterFromDisk(charId)
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
