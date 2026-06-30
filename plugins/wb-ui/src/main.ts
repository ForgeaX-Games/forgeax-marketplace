import pipeline from './pipelines/ui-design'
import './ui/styles.css'

type Pane = 'left' | 'center' | 'standalone'

function detectPane(): Pane {
  const pane = new URLSearchParams(location.search).get('pane')
  if (pane === 'left' || pane === 'center') return pane
  return 'standalone'
}

function el(id: string): HTMLElement {
  const node = document.getElementById(id)
  if (!node) throw new Error(`#${id} not found`)
  return node
}

async function bootstrap(): Promise<void> {
  const pane = detectPane()
  document.body.dataset.pane = pane

  const left = el('left-root')
  const center = el('center-root')
  const right = el('right-root')
  const bottom = el('bottom-root')
  const toolbar = el('toolbar-root')

  await pipeline.init({ workspacePath: './workspace' })
  pipeline.createUI(left, { center, right, bottom, toolbar })

  window.addEventListener('beforeunload', () => {
    pipeline.destroyUI?.()
    pipeline.dispose?.()
  })

  window.parent?.postMessage({ type: 'forgeax:plugin-ready', pluginId: '@forgeax-plugin/wb-ui', pane }, '*')
}

bootstrap().catch(error => {
  console.error('[wb-ui] bootstrap failed', error)
  document.body.innerHTML = `<pre class="boot-error">${String(error?.stack || error)}</pre>`
})
