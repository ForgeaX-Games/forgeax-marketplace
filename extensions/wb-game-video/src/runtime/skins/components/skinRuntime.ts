/**
 * 皮肤自带运行时（skins/ 内部工具箱）—— 让每个皮肤组件**自闭环**：只依赖 React + 本工具，
 * 不 import 游戏引擎其它代码。样式/SVG 滤镜都由皮肤自己注入，方便用户把组件整包拷走/替换。
 *
 * 提供：
 *   - injectCss(id, css)：幂等注入一份 <style>（同 id HMR 覆盖）。
 *   - ensureInkFilters()：注入水墨毛边 SVG 滤镜 #inkRough / #inkRoughNarr。
 *   - setBrushFontUrl / ensureBrushFont：书法字体 URL 由 **editor** 在 init 注入（runtime 不依赖 assets）。
 */
const injected = new Map<string, HTMLStyleElement>()

export function injectCss(id: string, css: string): void {
  if (typeof document === 'undefined') return
  const existing = injected.get(id)
  if (existing) {
    if (existing.textContent !== css) existing.textContent = css
    return
  }
  const style = document.createElement('style')
  style.setAttribute('data-skin-style', id)
  style.textContent = css
  document.head.appendChild(style)
  injected.set(id, style)
}

const INK_HOST_ID = 'skin-ink-filter-defs'
const INK_DEF = (id: string): string =>
  `<filter id="${id}" x="-20%" y="-60%" width="140%" height="220%">` +
  '<feTurbulence type="fractalNoise" baseFrequency="0.018 0.5" numOctaves="2" seed="7" result="n"/>' +
  '<feDisplacementMap in="SourceGraphic" in2="n" scale="3" xChannelSelector="R" yChannelSelector="G"/>' +
  '</filter>'

/** 注入 #inkRough / #inkRoughNarr 两个水墨毛边滤镜（幂等，全局一次）。 */
export function ensureInkFilters(): void {
  if (typeof document === 'undefined' || document.getElementById(INK_HOST_ID)) return
  const host = document.createElement('div')
  host.id = INK_HOST_ID
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden'
  host.innerHTML = `<svg width="0" height="0" focusable="false" aria-hidden="true">${INK_DEF('inkRough')}${INK_DEF('inkRoughNarr')}</svg>`
  document.body.appendChild(host)
}

/** editor 在 boot 时注入（如 `import url from '../assets/fonts/….woff2?url'`）。 */
let brushFontUrl: string | undefined

export function setBrushFontUrl(url: string): void {
  brushFontUrl = url
}

/**
 * 注入水墨手书字体 HYShangWei（@font-face，幂等）。
 * 未 `setBrushFontUrl` 时跳过——CSS font-family 回落 STKaiti/KaiTi。
 */
export function ensureBrushFont(): void {
  if (!brushFontUrl) return
  injectCss(
    'skin-brush-font',
    `@font-face{font-family:'HYShangWei';src:url('${brushFontUrl}') format('woff2');font-weight:normal;font-style:normal;font-display:swap;}`,
  )
}
