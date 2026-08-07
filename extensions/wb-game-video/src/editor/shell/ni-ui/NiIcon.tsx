/**
 * NiIcon —— 节点面板图标。几何全部来自 Figma 导出的 svg（`assets/ni-icons/`），
 * 这里只负责尺寸与上色：用 mask 让图标吃 `currentColor`，同一个文件可以在
 * 白 100% / 60% / 40% 三档下复用，不用为每种颜色再导一份。
 */
import type { CSSProperties, JSX } from 'react'
import { ensureNiUiStyle } from './theme'
import chevronUrl from '../assets/ni-icons/chevron.svg'
import muteUrl from '../assets/ni-icons/mute.svg'
import pencilUrl from '../assets/ni-icons/pencil.svg'
import playUrl from '../assets/ni-icons/play.svg'
import plusUrl from '../assets/ni-icons/plus.svg'
import trashUrl from '../assets/ni-icons/trash.svg'
import unfoldUrl from '../assets/ni-icons/unfold.svg'
import volumeUrl from '../assets/ni-icons/volume.svg'

/** `close` 与 `plus` 同一份几何：设计稿里的 ✕ 就是把 ＋ 转 45°（Figma 15635:81615）。 */
const ICON_URL = {
  chevron: chevronUrl,
  mute: muteUrl,
  pencil: pencilUrl,
  play: playUrl,
  plus: plusUrl,
  close: plusUrl,
  trash: trashUrl,
  /** 上下双箭头，折叠卡片的展开/收起（Figma dfrunfold-more · 15635:84476）。 */
  unfold: unfoldUrl,
  volume: volumeUrl,
} as const

export type NiIconName = keyof typeof ICON_URL

/** 导出的 chevron 指向左；面板里的四个方向都由它旋转得到。 */
const ICON_ROTATION: Partial<Record<NiIconName, number>> = {
  close: 45,
}

export function NiIcon({
  name,
  size = 14,
  rotate,
  style,
}: {
  name: NiIconName
  size?: number
  /** 额外旋转角（度）。chevron 传 -90 得到向下、90 得到向上。 */
  rotate?: number
  style?: CSSProperties
}): JSX.Element {
  // 图标可能渲染在 .ni-root 之外（共享编辑器），样式表不能只靠面板根去注入。
  ensureNiUiStyle()
  const url = ICON_URL[name]
  const deg = (ICON_ROTATION[name] ?? 0) + (rotate ?? 0)
  // url() 必须加引号：Vite 会把这些小 svg 内联成含单引号的 data URI，不加引号整条声明会被
  // CSS 解析器丢掉，图标就退化成一块纯色方块。
  const maskUrl = `url("${url}")`
  return (
    <span
      className="ni-icon"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        WebkitMaskImage: maskUrl,
        maskImage: maskUrl,
        ...(deg ? { transform: `rotate(${deg}deg)` } : {}),
        ...style,
      }}
    />
  )
}

/**
 * 给注入式 CSS 用的图标 mask 声明。
 *
 * 有些按钮由共享编辑器（editors.tsx 等）渲染，改不了它的 JSX，只能在作用域 CSS 里把文字
 * 压掉、用伪元素贴图标。这里统一产出那两行声明，顺便把 url() 的引号钉死——Vite 会把这些
 * 小 svg 内联成含单引号的 data URI，漏引号整条声明会被 CSS 解析器丢掉，图标退化成色块。
 *
 * 用法：`.foo::before { content:''; width:12px; height:12px; background:currentColor; ${niIconMaskCss('trash')} }`
 */
export function niIconMaskCss(name: NiIconName): string {
  const url = `url("${ICON_URL[name]}") no-repeat center / contain`
  return `-webkit-mask: ${url}; mask: ${url};`
}

/** 下拉右侧的展开箭头：稿子里是 16px 方框里一枚向下的 chevron。 */
export function NiChevronDown({ size = 16 }: { size?: number }): JSX.Element {
  return (
    <span
      className="ni-select-chevron"
      aria-hidden="true"
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: size, height: size }}
    >
      <NiIcon name="chevron" size={size * 0.667} rotate={-90} />
    </span>
  )
}
