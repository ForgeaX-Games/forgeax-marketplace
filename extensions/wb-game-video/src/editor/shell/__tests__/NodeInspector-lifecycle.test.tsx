import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { GameGraph, GameNodeData } from '../../../runtime/schema/graph-schema'
import type { Reaction } from '../../../runtime/schema/node-config-schema'
import { NodeInspector } from '../NodeInspector'

const originalScrollIntoView = HTMLElement.prototype.scrollIntoView

function lifecycle(ms: number, entityId: string): Reaction {
  return {
    when: { type: 'at', ms },
    do: [{
      kind: 'effect',
      effects: [{ kind: 'attr', entityId, attr: 'attack', op: 'add', value: 0 }],
    }],
  }
}

function graphWith(reactions: Reaction[]): GameGraph {
  const data: GameNodeData = { name: '慈悲狱门口', durationMs: 3_000, reactions }
  return {
    nodes: [{ id: 'gate', type: 'perf', position: { x: 0, y: 0 }, inputs: [], outputs: [], data }],
    edges: [],
  }
}

afterEach(() => {
  cleanup()
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value: originalScrollIntoView,
  })
})

describe('NodeInspector · 结算选中联动', () => {
  it('多个效果时只高亮时间轴指定的配置块，块内编辑不会取消选中', () => {
    const onFocusLifecycle = vi.fn()
    const { container } = render(
      <NodeInspector
        graph={graphWith([lifecycle(0, 'ent-player'), lifecycle(800, 'ent-boss')])}
        nodeId="gate"
        focusedLifecycleIndex={1}
        onFocusLifecycle={onFocusLifecycle}
        onChange={vi.fn()}
      />,
    )

    const first = container.querySelector<HTMLElement>('[data-lifecycle-effect-index="0"]')
    const second = container.querySelector<HTMLElement>('[data-lifecycle-effect-index="1"]')
    expect(first).toHaveAttribute('data-selected', 'false')
    expect(second).toHaveAttribute('data-selected', 'true')
    expect(second?.style.border).toContain('#5ad4c0')
    expect(second?.style.background).toBe('')
    expect(second?.style.boxShadow).toBe('')
    expect(screen.getByText('结算')).toBeTruthy()
    expect(screen.getByRole('button', { name: '＋ 结算' })).toBeTruthy()
    expect(screen.queryByText('生命周期效果')).toBeNull()
    expect(screen.queryByText(/演出播到指定 ms/)).toBeNull()

    fireEvent.pointerDown(second!.querySelector('input')!)
    expect(onFocusLifecycle).toHaveBeenLastCalledWith(1)
    expect(onFocusLifecycle).not.toHaveBeenCalledWith(null)

    fireEvent.pointerDown(first!)
    expect(onFocusLifecycle).toHaveBeenLastCalledWith(0)
  })

  it('重复选择同一个结算时仍把配置块平滑滚到面板中央', () => {
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: scrollIntoView,
    })
    const graph = graphWith([lifecycle(0, 'ent-player'), lifecycle(800, 'ent-boss')])
    const { rerender } = render(
      <NodeInspector
        graph={graph}
        nodeId="gate"
        focusedLifecycleIndex={1}
        focusAnchorRevision={1}
        onChange={vi.fn()}
      />,
    )

    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: 'smooth', block: 'center', inline: 'nearest' })
    scrollIntoView.mockClear()
    rerender(
      <NodeInspector
        graph={graph}
        nodeId="gate"
        focusedLifecycleIndex={1}
        focusAnchorRevision={2}
        onChange={vi.fn()}
      />,
    )
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('选择时间轴覆盖物时滚动到对应挂载卡片，重复选择仍可重新定位', () => {
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: scrollIntoView,
    })
    const graph: GameGraph = {
      nodes: [{
        id: 'gate',
        type: 'perf',
        position: { x: 0, y: 0 },
        inputs: [],
        outputs: [],
        data: {
          name: '慈悲狱门口',
          overlayNodes: [
            { id: 'mount-a', overlay: 'hud' },
            { id: 'mount-b', overlay: 'hud' },
          ],
        },
      }],
      edges: [],
    }
    const overlays = {
      hud: { id: 'hud', children: [{ id: 'hp', component: 'BattlePlayerHpBar' }] },
    }
    const { container, rerender } = render(
      <NodeInspector
        graph={graph}
        nodeId="gate"
        overlays={overlays}
        focusedMountId="mount-b"
        focusAnchorRevision={1}
        onChange={vi.fn()}
      />,
    )

    const focusedMount = container.querySelector<HTMLElement>('[data-focus-anchor="mount:mount-b"]')
    expect(focusedMount).toBeTruthy()
    expect(focusedMount?.style.outline).toContain('#f08840')
    expect(focusedMount?.style.background).toBe('')
    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: 'smooth', block: 'center', inline: 'nearest' })
    scrollIntoView.mockClear()
    rerender(
      <NodeInspector
        graph={graph}
        nodeId="gate"
        overlays={overlays}
        focusedMountId="mount-b"
        focusAnchorRevision={2}
        onChange={vi.fn()}
      />,
    )
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('删除选中项前面的效果后同步修正高亮序号', () => {
    const onFocusLifecycle = vi.fn()
    const onChange = vi.fn()
    const { container } = render(
      <NodeInspector
        graph={graphWith([lifecycle(0, 'ent-player'), lifecycle(800, 'ent-boss')])}
        nodeId="gate"
        focusedLifecycleIndex={1}
        onFocusLifecycle={onFocusLifecycle}
        onChange={onChange}
      />,
    )

    const first = container.querySelector<HTMLElement>('[data-lifecycle-effect-index="0"]')!
    fireEvent.click(Array.from(first.querySelectorAll('button')).find((button) => button.textContent === '移除')!)

    expect(onFocusLifecycle).toHaveBeenLastCalledWith(0)
    const next = onChange.mock.calls.at(-1)?.[0] as GameGraph
    expect(next.nodes[0]?.data.reactions).toHaveLength(1)
  })

  it('统一呈现定时与数值变化结算，动作只开放效果和沿边推进', () => {
    const onChange = vi.fn()
    render(
      <NodeInspector
        graph={graphWith([
          lifecycle(500, 'ent-player'),
          { when: { type: 'watch', of: 'entity.ent-player.attr.hp', on: 'dec' }, do: [] },
        ])}
        nodeId="gate"
        onChange={onChange}
      />,
    )

    const triggerSelects = screen.getAllByTitle('触发条件') as HTMLSelectElement[]
    expect(triggerSelects.map((select) => select.value)).toEqual(['at', 'watch'])
    expect(screen.queryByText('响应规则')).toBeNull()
    expect(screen.queryByRole('button', { name: '＋ 生成组件' })).toBeNull()
    expect(screen.getAllByRole('button', { name: '＋ 效果' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: '＋ 沿边推进' })).toHaveLength(2)

    fireEvent.change(triggerSelects[0]!, { target: { value: 'hidden' } })
    const next = onChange.mock.calls.at(-1)?.[0] as GameGraph
    expect(next.nodes[0]?.data.reactions?.[0]?.when.type).toBe('hidden')
  })
})
