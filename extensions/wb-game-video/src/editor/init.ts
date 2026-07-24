/**
 * editor boot —— 填充**默认**组件/Skin 表（画布/校验用）。
 * 多局试玩各自用 GraphSession 内的隔离表，不依赖本函数。
 *
 * 字体已下沉到 component-host 层自带（皮肤组件自调 `ensureBrushFont()`），
 * 这里不再注入字体——boot 只负责注册平台内建组件集。
 */
import { registerBuiltins } from '../runtime/component-host'

let booted = false

/**
 * 幂等：注册平台内建组件集（经 component-host）。Studio / Player / PlaySurface 入口调用。
 * 游戏专属组件由 store.ensureBoot 经 `component-host.loadGameComponents(slug)` 按 game 加载。
 */
export function bootEditorSkins(): void {
  if (booted) return
  booted = true
  registerBuiltins()
}
