import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MaterialTimeline } from '../MaterialTimeline'

afterEach(cleanup)

describe('MaterialTimeline · 结算选中联动', () => {
  it('按下某个效果菱形时上抛其 id，并只点亮受控选中项', () => {
    const onSelectPointMarker = vi.fn()
    const { container } = render(
      <MaterialTimeline
        materials={[]}
        maxMs={3_000}
        playheadMs={0}
        selectedMaterialKey={null}
        editable={false}
        onSelectMaterial={vi.fn()}
        onPatchMaterial={vi.fn()}
        pointMarkers={[
          { id: 'life:0', ms: 0, kind: 'lifecycle', label: '结算 · ent-player.attack add 0' },
          { id: 'life:1', ms: 3_000, kind: 'lifecycle', label: '结算 · ent-boss.attack add 0' },
        ]}
        selectedPointMarkerId="life:1"
        onSelectPointMarker={onSelectPointMarker}
      />,
    )

    const first = screen.getByRole('slider', { name: /ent-player\.attack add 0/ })
    const second = screen.getByRole('slider', { name: /ent-boss\.attack add 0/ })
    const viewport = container.querySelector('.gc-mtimeline-viewport')!
    const laneLabel = screen.getByText('结算')
    expect(container.querySelectorAll('.gc-mtrackline')).toHaveLength(6)
    expect(getComputedStyle(viewport).height).toBe('264px')
    expect(laneLabel).toBeTruthy()
    expect(getComputedStyle(laneLabel).left).toBe('50%')
    expect(first).toHaveStyle({ left: '9px' })
    expect(second).toHaveStyle({ left: '-9px' })
    expect(first.closest('.gc-point-mark')).not.toHaveClass('is-selected')
    expect(second.closest('.gc-point-mark')).toHaveClass('is-selected')

    fireEvent.pointerDown(first)
    expect(onSelectPointMarker).toHaveBeenCalledWith('life:0')
  })

  it('第 7 条轨道出现后才开启纵向滚动', () => {
    const { container } = render(
      <MaterialTimeline
        materials={[{
          key: 'mount:track-6',
          id: 'track-6',
          kind: 'mount',
          label: '第六轨组件',
          startMs: 0,
          endMs: 1_000,
          zIndex: 5,
        }]}
        maxMs={3_000}
        playheadMs={0}
        selectedMaterialKey={null}
        editable={false}
        onSelectMaterial={vi.fn()}
        onPatchMaterial={vi.fn()}
      />,
    )

    const viewport = container.querySelector('.gc-mtimeline-viewport')!
    const canvas = container.querySelector('.gc-mtimeline-canvas')!
    expect(container.querySelectorAll('.gc-mtrackline')).toHaveLength(7)
    expect(getComputedStyle(viewport).overflow).toBe('auto')
    expect(Number.parseFloat(getComputedStyle(canvas).height)).toBeGreaterThan(
      Number.parseFloat(getComputedStyle(viewport).height),
    )
  })
})
