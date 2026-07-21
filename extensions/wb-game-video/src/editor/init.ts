/**
 * editor boot —— 注入素材依赖（字体等），并填充**默认**组件/Skin 表（画布/校验用）。
 * 多局试玩各自用 GraphSession 内的隔离表，不依赖本函数。
 */
import brushFontUrl from './assets/fonts/HYShangWei.woff2?url'
import { setBrushFontUrl } from '../runtime/skins/components/skinRuntime'
import { registerCoreSkins } from '../runtime/skins/components'

let booted = false

/** 幂等：字体 URL + 默认组件包（契约+渲染）注册。Studio / Player / PlaySurface 入口调用。 */
export function bootEditorSkins(): void {
  if (booted) return
  booted = true
  setBrushFontUrl(brushFontUrl)
  registerCoreSkins()
}
