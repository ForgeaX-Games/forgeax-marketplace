/**
 * editor boot —— 注入素材依赖（字体等）并注册核心皮肤。
 * runtime 皮肤代码不 import assets；由本模块在工坊入口调用一次。
 */
import brushFontUrl from './assets/fonts/HYShangWei.woff2?url'
import { setBrushFontUrl } from '../runtime/skins/components/skinRuntime'
import { registerCoreSkins } from '../runtime/skins/components'

let booted = false

/** 幂等：字体 URL + 核心皮肤注册。Studio / Player / PlaySurface 入口调用。 */
export function bootEditorSkins(): void {
  if (booted) return
  booted = true
  setBrushFontUrl(brushFontUrl)
  registerCoreSkins()
}
