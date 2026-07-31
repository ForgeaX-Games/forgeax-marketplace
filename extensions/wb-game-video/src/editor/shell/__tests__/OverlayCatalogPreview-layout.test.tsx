import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_OVERLAY_DESIGN_CANVAS,
  OverlayCatalogPreview,
  placeOverlayBox,
} from '../OverlayCatalogPreview'

afterEach(cleanup)

const LOGICAL_CANVAS = { left: 0, top: 0, width: 1, height: 1 }

describe('OverlayCatalogPreview fixed canvas', () => {
  it('uses a centered 80% viewport with its own full logical coordinate stage', () => {
    expect(DEFAULT_OVERLAY_DESIGN_CANVAS).toEqual({ left: 0.1, top: 0.1, width: 0.8, height: 0.8 })

    const { container } = render(
      <OverlayCatalogPreview
        overlay={{ id: 'scheme', children: [] }}
        entities={{}}
        variables={{}}
        onAddChild={vi.fn()}
      />,
    )
    expect(container.querySelector('[data-overlay-design-canvas]')).toHaveStyle({
      left: '10%',
      top: '10%',
      width: '80%',
      height: '80%',
    })
    expect(container.querySelector('[data-overlay-coordinate-stage]')).toHaveStyle({
      left: '10%',
      top: '10%',
      width: '80%',
      height: '80%',
    })
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
    render(
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

  it('snaps to the canvas center on both axes', () => {
    const placed = placeOverlayBox(
      LOGICAL_CANVAS,
      { width: 0.2, height: 0.15 },
      { left: 0.405, top: 0.43 },
      { x: 0.02, y: 0.02 },
    )
    expect(placed.snap).toBe('vertical-center')
    expect(placed.left).toBeCloseTo(0.4)
    expect(placed.top).toBeCloseTo(0.425)
  })
})
