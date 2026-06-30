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

  // Studio 现在经 iframe URL `?slug=` 注入 per-game slug —— 旧的 STUDIO_INIT
  // 消息已退役(全仓无发送方)、host-sdk handshake 的 ctx 也不带 slug。每个
  // pane(left 表单 / center 预览)是独立 iframe,各自从自己的 URL 读,否则
  // center pane 的写盘类动作(生成动画 / 生成 3D 四视图 / 写 manifest)会因
  // slug 为空被拦。STUDIO_CTX 监听保留,供 host 后续推送 slug 变更。
  const slugParam = new URLSearchParams(location.search).get('slug')
  if (slugParam) globalState.setSlug(slugParam)

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

  // Keep-alive: when the studio CSS-hides this panel (instead of unmounting),
  // pause the 3D render loop so an off-screen but alive editor stops burning
  // GPU/CPU; resume when it's shown again. No-op when running standalone.
  if (forgeaxHost.available) {
    forgeaxHost.onVisibilityChange((visible) => engine.setPanelVisible(visible))
  }

  ;(window as any).__ceEngine  = engine
  ;(window as any).__ceContext = context

  window.dispatchEvent(new CustomEvent('__ce:ready', { detail: { engine, context } }))

  console.log('[CharacterEditor] 就绪')
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
