import { describe, expect, it } from 'vitest'
import { buildPrototypeChromeCss } from '../prototype-assets'

describe('buildPrototypeChromeCss', () => {
  it('为 genre 布局按钮与 uid-live-icon 生成 iframe 内联样式', () => {
    const css = buildPrototypeChromeCss({
      buttonPrimary: 'data:image/png;base64,pri',
      buttonNormal: 'data:image/png;base64,norm',
      titleDeco: 'data:image/png;base64,title',
      panelTexture: 'data:image/png;base64,panel',
      icons: ['data:image/png;base64,i0', 'data:image/png;base64,i1'],
    })
    expect(css).toContain('.gl-proto-genre-shell .upv-start-item.primary')
    expect(css).toContain('.gl-proto-genre-shell .gl-fps-match-btn')
    expect(css).toContain('.gl-proto-genre-shell .gl-fps-topnav button')
    expect(css).not.toContain('.gl-proto-genre-shell .gl-fps-mode')
    expect(css).toContain('.gl-proto-genre-shell .gl-ow-brand')
    expect(css).toContain('.uid-live-icon-0')
    expect(css).toContain('background-size: contain !important')
    expect(css).toContain('data:image/png;base64,pri')
  })
})
