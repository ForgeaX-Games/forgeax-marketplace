import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SkinRegistry } from '../component-host/rendererRegistry'

afterEach(cleanup)

function Probe({ preview, previewTimeMs }: { preview?: boolean; previewTimeMs?: number }): JSX.Element {
  return <span data-testid="probe" data-preview={String(preview)} data-time={previewTimeMs} />
}

describe('SkinRegistry overlay mount layout', () => {
  it('uses the same mount and child layout projection for preview rendering', () => {
    const registry = new SkinRegistry()
    registry.registerOverlayRenderer('probe', Probe)

    const view = render(
      <>
        {registry.renderOverlayMount(
          {
            mountId: 'mount',
            mountLayout: { left: 0.1, top: 0.2, width: 0.5, height: 0.6 },
            children: [{
              elementId: 'child',
              component: 'probe',
              inputs: {},
              childLayout: { left: 0.25, top: 0.3, width: 0.4, height: 0.2, zIndex: 7 },
            }],
          },
          undefined,
          undefined,
          { timeMs: 420 },
        )}
      </>,
    )

    const mount = view.container.firstElementChild as HTMLElement
    const child = mount.firstElementChild as HTMLElement
    expect(mount.style.left).toBe('10%')
    expect(mount.style.top).toBe('20%')
    expect(mount.style.width).toBe('50%')
    expect(mount.style.height).toBe('60%')
    expect(child.style.left).toBe('25%')
    expect(child.style.top).toBe('30%')
    expect(child.style.width).toBe('40%')
    expect(child.style.height).toBe('20%')
    expect(child.style.zIndex).toBe('7')
    expect(view.getByTestId('probe')).toHaveAttribute('data-preview', 'true')
    expect(view.getByTestId('probe')).toHaveAttribute('data-time', '420')
  })
})
