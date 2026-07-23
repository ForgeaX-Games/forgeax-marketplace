/**
 * editor boot —— 注入素材依赖（字体等），并填充**默认**组件/Skin 表（画布/校验用）。
 * 多局试玩各自用 GraphSession 内的隔离表，不依赖本函数。
 */
import brushFontUrl from './assets/fonts/HYShangWei.woff2?url'
import { setBrushFontUrl } from '../runtime/component-host/components/skinRuntime'
import { registerBuiltins } from '../runtime/component-host'

let booted = false

/**
 * 幂等：字体 URL + 平台内建组件集注册（经 component-host）。Studio / Player / PlaySurface 入口调用。
 * 游戏专属组件由 store.ensureBoot 经 `component-host.loadGameComponents(slug)` 按 game 加载。
 */
export function bootEditorSkins(): void {
  if (booted) return
  booted = true
  setBrushFontUrl(brushFontUrl)
  registerBuiltins()
}
