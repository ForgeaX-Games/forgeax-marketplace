// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComponentLibrary } from '../ComponentLibrary'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ComponentLibrary', () => {
  it('renders only the eleven new-spec components', () => {
    render(<ComponentLibrary />)

    expect(screen.getByText('控件库')).toBeTruthy()
    expect(screen.getByText('（11）')).toBeTruthy()
    expect(screen.getAllByTitle(/^拖到画布添加：/)).toHaveLength(11)
    expect(screen.getByLabelText('组件库路径')).toHaveTextContent('游戏组件')
    expect(screen.getByLabelText('搜索控件')).toHaveAttribute('placeholder', '搜索控件')
    expect(screen.getByTestId('component-library').querySelectorAll('.ocl-card')).toHaveLength(11)
    expect(screen.getByTestId('component-library').querySelectorAll('[data-overlay-fit-target]').length).toBeGreaterThan(0)
    expect(document.querySelector('style[data-reel-style="overlay-component-library"]')?.textContent)
      .toContain('.ocl-render-stage * {\n  pointer-events:none !important;')
    expect(document.querySelector('style[data-reel-style="overlay-component-library"]')?.textContent)
      .toContain('.ocl-card:hover { background:transparent; color:#ffc066; }')
    expect(document.querySelector('style[data-reel-style="overlay-component-library"]')?.textContent)
      .toContain('border-radius:6px; background:rgba(255,255,255,.1);')
    expect(document.querySelector('style[data-reel-style="overlay-component-library"]')?.textContent)
      .toContain('.ocl-card:hover .ocl-preview { background:rgba(255,255,255,.2); }')
    expect(document.querySelector('style[data-reel-style="overlay-component-library"]')?.textContent)
      .toContain('position:relative; flex:none; width:134px; height:108px; overflow:hidden;')
    expect(document.querySelector('style[data-reel-style="overlay-component-library"]')?.textContent)
      .toContain('.ocl-preview:hover .ocl-ai-slot { visibility:visible; }')
    expect(document.querySelector('style[data-reel-style="overlay-component-library"]')?.textContent)
      .not.toContain('border-bottom:1px solid #464646')
    const aiButtons = screen.getByTestId('component-library').querySelectorAll<HTMLButtonElement>('.ocl-ai-quick')
    expect(aiButtons).toHaveLength(11)
    expect(aiButtons[0]).toBeDisabled()
    expect(aiButtons[0]).toHaveStyle({ cursor: 'not-allowed' })
    expect(aiButtons[0]).toHaveAttribute('aria-label', 'AI 补全参数')
    expect(aiButtons[0]).toHaveAttribute('title', 'AI 补全暂不可用')
    expect(aiButtons[0]?.querySelector('img')).toHaveAttribute('src', expect.stringContaining('ai-parameter-fill'))
    expect(aiButtons[0]?.querySelector('img')).toHaveAttribute('width', '18')
    expect(aiButtons[0]?.querySelector('img')).toHaveAttribute('height', '18')
    expect(screen.getByText('示例对白')).toBeTruthy()
    expect(document.querySelector('.gv-status-notice')).toHaveStyle({ '--preview-t': '400ms' })
    expect(screen.queryByText('转场')).toBeNull()
    expect(screen.queryByText('水墨血条')).toBeNull()
  })

  it('filters the dynamic manifest cards by label or id', () => {
    render(<ComponentLibrary />)

    fireEvent.change(screen.getByLabelText('搜索控件'), { target: { value: 'Dialogue' } })
    expect(screen.getAllByTitle(/^拖到画布添加：/)).toHaveLength(1)
    expect(screen.getByText('字幕/对白')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('搜索控件'), { target: { value: '不存在' } })
    expect(screen.queryAllByTitle(/^拖到画布添加：/)).toHaveLength(0)
    expect(screen.getByText('没有匹配的组件')).toBeTruthy()
  })

  it('uses measured component content as the drag image instead of the card', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('ocl-render-stage')) {
        return { left: 0, top: 0, right: 640, bottom: 360, width: 640, height: 360 } as DOMRect
      }
      if (this.classList.contains('ocl-preview')) {
        return { left: 0, top: 0, right: 134, bottom: 108, width: 134, height: 108 } as DOMRect
      }
      if (this.hasAttribute('data-overlay-fit-target')) {
        return { left: 120, top: 80, right: 320, bottom: 120, width: 200, height: 40 } as DOMRect
      }
      return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 } as DOMRect
    })
    render(<ComponentLibrary />)
    const card = document.querySelector<HTMLElement>('[data-component-id="BattleEnemyHpBar"]')!
    await waitFor(() => expect(card.querySelector('.ocl-render-stage')).toHaveStyle({ visibility: 'visible' }))
    const setDragImage = vi.fn()
    const dataTransfer = {
      setData: vi.fn(),
      setDragImage,
      effectAllowed: '',
    }

    fireEvent.dragStart(card, { dataTransfer, clientX: 100, clientY: 60 })

    const ghost = document.body.querySelector<HTMLElement>('.ocl-drag-image')!
    expect(ghost).toHaveClass('ocl-drag-image')
    expect(ghost).toHaveStyle({
      left: '0px',
      top: '0px',
      width: '200px',
      height: '40px',
    })
    expect(setDragImage.mock.calls[0]?.[0]).toBeInstanceOf(HTMLCanvasElement)
    expect(setDragImage).toHaveBeenCalledWith(expect.any(HTMLCanvasElement), 0, 0)

    fireEvent.dragEnd(card)
    expect(document.body.querySelector('.ocl-drag-image')).toBeNull()
  })
})
