import { injectStyleOnce } from './injectStyle'
// Vite 把字体解析成带 hash 的最终 URL 字符串（dev 给源路径），运行时零成本。
import hyShangWeiUrl from '../assets/fonts/HYShangWei.woff2?url'

/**
 * injectBrushFontOnce —— 注入战斗 HUD 用的水墨手书字体 HYShangWei（@font-face，全局一次）。
 *
 * 来源：从「新影游平台交互原型-standalone.html」内嵌的 base64 字体抽取，转成 woff2 落盘为
 * `src/assets/fonts/HYShangWei.woff2` 随插件入仓。血条名牌 / 技能名 / 技能按键(X/A/Y/B) /
 * 防反按键(A/B) 的 font-family 首选 'HYShangWei'，命中即得原型的毛笔笔锋，缺字自动回落
 * KaiTi/STKaiti。
 */
export function injectBrushFontOnce(): void {
  injectStyleOnce(
    'reel-brush-font',
    `@font-face{font-family:'HYShangWei';src:url('${hyShangWeiUrl}') format('woff2');font-weight:normal;font-style:normal;font-display:swap;}`,
  )
}
