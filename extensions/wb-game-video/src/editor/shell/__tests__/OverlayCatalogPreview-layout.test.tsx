import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_OVERLAY_DESIGN_CANVAS,
  OverlayCatalogPreview,
  placeOverlayBox,
} from '../OverlayCatalogPreview'

afterEach(cleanup)

describe('OverlayCatalogPreview fixed canvas', () => {
  it('uses a centered 80% by 80% design canvas', () => {
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
  })

  it('clamps a component inside the fixed canvas', () => {
    const placed = placeOverlayBox(
      DEFAULT_OVERLAY_DESIGN_CANVAS,
      { width: 0.2, height: 0.15 },
      { left: 0.95, top: -0.4 },
      { x: 0, y: 0 },
    )
    expect(placed.left).toBeCloseTo(0.7)
    expect(placed.top).toBeCloseTo(0.1)
  })

  it.each([
    ['top-left', 0.125, 0.135, 0.12, 0.13],
    ['top-right', 0.675, 0.135, 0.68, 0.13],
    ['bottom-left', 0.125, 0.715, 0.12, 0.72],
    ['bottom-right', 0.675, 0.715, 0.68, 0.72],
  ] as const)('snaps to %s', (kind, left, top, expectedLeft, expectedTop) => {
    const placed = placeOverlayBox(
      DEFAULT_OVERLAY_DESIGN_CANVAS,
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
      DEFAULT_OVERLAY_DESIGN_CANVAS,
      { width: 0.2, height: 0.15 },
      { left: 0.405, top: 0.43 },
      { x: 0.02, y: 0.02 },
    )
    expect(placed.snap).toBe('vertical-center')
    expect(placed.left).toBeCloseTo(0.4)
    expect(placed.top).toBeCloseTo(0.425)
  })
})
