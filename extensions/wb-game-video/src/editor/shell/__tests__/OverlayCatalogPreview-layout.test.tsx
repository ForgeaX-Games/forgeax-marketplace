import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_OVERLAY_DESIGN_CANVAS,
  interfaceCanvasPreviewTimeMs,
  isOverlayBoxCentered,
  OVERLAY_GRID_STEP_VMIN,
  overlayAiControlSide,
  overlayBoxCenterAlignment,
  overlaySizeLabelSide,
  OverlayCatalogPreview,
  placeOverlayBox,
} from '../OverlayCatalogPreview'

afterEach(cleanup)

const LOGICAL_CANVAS = { left: 0, top: 0, width: 1, height: 1 }

describe('OverlayCatalogPreview fixed canvas', () => {
  it('keeps short animated components on a visible frame in the interface canvas', () => {
    expect(interfaceCanvasPreviewTimeMs({
      id: 'damage',
      component: 'DamageFloatText',
      inputs: { durationMs: 5 },
    }, 400)).toBe(2)
    expect(interfaceCanvasPreviewTimeMs({
      id: 'gain',
      component: 'GainFloatText',
      inputs: {},
    }, 400)).toBe(400)

    const { rerender } = render(
      <OverlayCatalogPreview
        overlay={{
          id: 'scheme',
          children: [{
            id: 'damage',
            component: 'DamageFloatText',
            inputs: { parameter: '-100', durationMs: 5 },
          }],
        }}
        entities={{}}
        variables={{}}
        centerChildren
        showSelectionFrames
        showTimeScrubber={false}
      />,
    )

    expect(screen.getByText('-100').parentElement).toHaveStyle({ '--preview-t': '2ms' })

    rerender(
      <OverlayCatalogPreview
        overlay={{
          id: 'scheme-gain',
          children: [{
            id: 'gain',
            component: 'GainFloatText',
            inputs: {},
          }],
        }}
        entities={{}}
        variables={{}}
        centerChildren
        showSelectionFrames
        showTimeScrubber={false}
      />,
    )
    expect(screen.getByText('+50').parentElement).toHaveStyle({ '--preview-t': '400ms' })
  })

  it('uses the full viewport without exposing read-only size controls', () => {
    expect(DEFAULT_OVERLAY_DESIGN_CANVAS).toEqual({ left: 0, top: 0, width: 1, height: 1 })
    expect(OVERLAY_GRID_STEP_VMIN).toBe(1.5)

    const { container } = render(
      <OverlayCatalogPreview
        overlay={{ id: 'scheme', children: [] }}
        entities={{}}
        variables={{}}
        onAddChild={vi.fn()}
      />,
    )
    expect(container.querySelector('[data-overlay-design-canvas]')).toHaveStyle({
      left: '0%',
      top: '0%',
      width: '100%',
      height: '100%',
      '--ocp-grid-step': '1.5vmin',
    })
    expect(container.querySelector('[data-overlay-coordinate-stage]')).toHaveStyle({
      left: '0%',
      top: '0%',
      width: '100%',
      height: '100%',
    })
    expect(container.querySelector('[data-overlay-bounds-readout]')).toBeNull()
  })

  it('writes movement in logical 0..1 coordinates inside the inset viewport', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-overlay-coordinate-stage')) {
        return {
          x: 20,
          y: 10,
          left: 20,
          top: 10,
          right: 180,
          bottom: 90,
          width: 160,
          height: 80,
          toJSON: () => ({}),
        }
      }
      if (this.hasAttribute('data-overlay-fit-target')) {
        return {
          x: 20,
          y: 10,
          left: 20,
          top: 10,
          right: 60,
          bottom: 30,
          width: 40,
          height: 20,
          toJSON: () => ({}),
        }
      }
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 200,
        bottom: 100,
        width: 200,
        height: 100,
        toJSON: () => ({}),
      }
    })
    const onPatchChildLayout = vi.fn()
    const { container } = render(
      <OverlayCatalogPreview
        overlay={{
          id: 'scheme',
          children: [{
            id: 'damage',
            component: 'DamageFloatText',
            layout: { left: 0, top: 0 },
            inputs: { value: 10 },
          }],
        }}
        entities={{}}
        variables={{}}
        selectedChildId="damage"
        onSelectChild={vi.fn()}
        onPatchChildLayout={onPatchChildLayout}
      />,
    )

    await waitFor(() => expect(screen.getByRole('application', { name: '界面方案画布' })).toBeTruthy())
    fireEvent.keyDown(window, { key: 'ArrowRight' })

    await waitFor(() => {
      expect(onPatchChildLayout).toHaveBeenCalledWith('damage', expect.objectContaining({
        left: 1 / 160,
        top: 0,
      }))
    })
  })

  it('clamps stored coordinates to the full logical canvas', () => {
    const placed = placeOverlayBox(
      LOGICAL_CANVAS,
      { width: 0.2, height: 0.15 },
      { left: 0.95, top: -0.4 },
      { x: 0, y: 0 },
    )
    expect(placed.left).toBeCloseTo(0.8)
    expect(placed.top).toBeCloseTo(0)
  })

  it.each([
    ['top-left', 0.025, 0.035, 0.02, 0.03],
    ['top-right', 0.775, 0.035, 0.78, 0.03],
    ['bottom-left', 0.025, 0.815, 0.02, 0.82],
    ['bottom-right', 0.775, 0.815, 0.78, 0.82],
  ] as const)('snaps to %s', (kind, left, top, expectedLeft, expectedTop) => {
    const placed = placeOverlayBox(
      LOGICAL_CANVAS,
      { width: 0.2, height: 0.15 },
      { left, top },
      { x: 0.02, y: 0.02 },
      { x: 0.02, y: 0.03 },
    )
    expect(placed.snap).toBe(kind)
    expect(placed.left).toBeCloseTo(expectedLeft)
    expect(placed.top).toBeCloseTo(expectedTop)
  })

  it.each([
    ['x-center', { left: 0.405, top: 0.2 }, { left: 0.4, top: 0.2 }],
    ['y-center', { left: 0.2, top: 0.43 }, { left: 0.2, top: 0.425 }],
    ['center', { left: 0.405, top: 0.43 }, { left: 0.4, top: 0.425 }],
  ] as const)('snaps independently to %s', (kind, desired, expected) => {
    const placed = placeOverlayBox(
      LOGICAL_CANVAS,
      { width: 0.2, height: 0.15 },
      desired,
      { x: 0.02, y: 0.02 },
    )
    expect(placed.snap).toBe(kind)
    expect(placed.left).toBeCloseTo(expected.left)
    expect(placed.top).toBeCloseTo(expected.top)
  })

  it('shows selected size on a visible side and only reveals disabled AI controls on hover', async () => {
    const onKeyConflictIconClick = vi.fn()
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-overlay-fit-target')) {
        return {
          x: 80,
          y: 40,
          left: 80,
          top: 40,
          right: 120,
          bottom: 60,
          width: 40,
          height: 20,
          toJSON: () => ({}),
        }
      }
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 200,
        bottom: 100,
        width: 200,
        height: 100,
        toJSON: () => ({}),
      }
    })

    const { container } = render(
      <OverlayCatalogPreview
        overlay={{
          id: 'scheme',
          children: [{
            id: 'damage',
            component: 'DamageFloatText',
            layout: { left: 0, top: 0 },
            inputs: { value: -25 },
          }],
        }}
        entities={{}}
        variables={{}}
        selectedChildId="damage"
        onSelectChild={vi.fn()}
        onPatchChildLayout={vi.fn()}
        keyConflictChildIds={new Set(['damage'])}
        onKeyConflictIconClick={onKeyConflictIconClick}
      />,
    )

    expect(isOverlayBoxCentered(
      LOGICAL_CANVAS,
      { left: 0.4, top: 0.4, width: 0.2, height: 0.2 },
    )).toBe(true)
    expect(overlayBoxCenterAlignment(
      LOGICAL_CANVAS,
      { left: 0.4, top: 0.2, width: 0.2, height: 0.2 },
    )).toBe('x-center')
    expect(overlayBoxCenterAlignment(
      LOGICAL_CANVAS,
      { left: 0.2, top: 0.4, width: 0.2, height: 0.2 },
    )).toBe('y-center')
    expect(overlaySizeLabelSide(
      { left: 0.4, top: 0.8, width: 0.2, height: 0.2 },
      { w: 200, h: 100 },
    )).toBe('top')
    expect(overlayAiControlSide(
      { left: 0.4, top: 0.4, width: 0.2, height: 0.2 },
      { w: 200, h: 100 },
      'bottom',
    )).toBe('right')
    const size = await screen.findByText('40 × 20')
    expect(size).toHaveAttribute('data-size-label-side', 'bottom')
    fireEvent.click(screen.getByRole('button', { name: '按键重复' }))
    expect(onKeyConflictIconClick).toHaveBeenCalledWith('damage')
    const previewStyles = document.querySelector(
      'style[data-reel-style="overlay-catalog-preview"]',
    )?.textContent
    expect(previewStyles).toContain(
      '.ocp-key-warn-icon:hover:not(:disabled),\n.ocp-key-warn-icon:active:not(:disabled) {\n  background:#d8d8d8; color:#ff5b5b;',
    )
    expect(screen.queryByText(/轴居中/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'AI 补全参数' })).toBeNull()

    fireEvent.pointerMove(screen.getByRole('application', { name: '界面方案画布' }), {
      clientX: 100,
      clientY: 50,
    })

    await waitFor(() => {
      expect(container.querySelector('[data-canvas-item="damage"]')).toHaveClass('is-hovered')
      const ai = screen.getByRole('button', { name: 'AI 补全参数' })
      expect(ai).toBeDisabled()
      expect(ai).toHaveStyle({ cursor: 'not-allowed' })
      expect(ai.querySelector('img')).toHaveAttribute('width', '18')
      expect(ai.querySelector('img')).toHaveAttribute('height', '18')
      expect(screen.getByTestId('ai-hover-zone-damage')).toHaveAttribute('data-ai-control-side', 'right')
    })

    const aiZone = screen.getByTestId('ai-hover-zone-damage')
    fireEvent.pointerEnter(aiZone)
    fireEvent.pointerMove(screen.getByRole('application', { name: '界面方案画布' }), {
      clientX: 199,
      clientY: 99,
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'AI 补全参数' })).toBeDisabled())
    fireEvent.pointerLeave(screen.getByTestId('ai-hover-zone-damage'))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'AI 补全参数' })).toBeNull())
  })

  it('keeps an unselected hover to a yellow frame without helper copy', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-overlay-fit-target')) {
        return {
          left: 80, top: 40, right: 120, bottom: 60, width: 40, height: 20,
          x: 80, y: 40, toJSON: () => ({}),
        } as DOMRect
      }
      return {
        left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100,
        x: 0, y: 0, toJSON: () => ({}),
      } as DOMRect
    })
    const { container } = render(
      <OverlayCatalogPreview
        overlay={{
          id: 'scheme',
          children: [{ id: 'damage', component: 'DamageFloatText', inputs: { value: -25 } }],
        }}
        entities={{}}
        variables={{}}
        onSelectChild={vi.fn()}
        onPatchChildLayout={vi.fn()}
      />,
    )

    fireEvent.pointerMove(screen.getByRole('application', { name: '界面方案画布' }), {
      clientX: 100,
      clientY: 50,
    })
    await waitFor(() => expect(container.querySelector('[data-canvas-item="damage"]')).toHaveClass('is-hovered'))
    expect(container.querySelector('[data-canvas-item="damage"]')).toHaveClass('is-passive')
    expect(screen.queryByText(/轴居中|×/)).toBeNull()
    expect(screen.queryByText('DamageFloatText')).toBeNull()
  })
})
