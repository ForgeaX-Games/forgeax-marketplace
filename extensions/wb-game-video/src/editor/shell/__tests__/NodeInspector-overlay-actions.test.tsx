import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type { GameGraph, GameNodeData } from '../../../runtime/schema/graph-schema'
import { registerCoreSkins } from '../../../runtime/component-host/components'
import { PRESET_SCHEME_BY_ID } from '../schemeOverlays'
import { NodeInspector } from '../NodeInspector'

afterEach(cleanup)
beforeAll(registerCoreSkins)

describe('NodeInspector · 界面事件动作入口', () => {
  it('aligns component and event-effect labels inside the blueprint node interface section', () => {
    const overlay = structuredClone(PRESET_SCHEME_BY_ID.n_door!)
    overlay.children.unshift({
      id: 'damage',
      component: 'DamageFloatText',
      inputs: { fixedText: '-', parameter: 70 },
    })
    const data: GameNodeData = {
      name: '慈悲狱门口',
      overlayNodes: [{
        overlay: overlay.id,
        reactions: [{
          when: { type: 'event', id: 'pass' },
          do: [{
            kind: 'effect',
            effects: [{ kind: 'attr', entityId: 'hero', attr: 'hp', op: 'add', value: 70 }],
          }],
        }],
      }],
    }
    const graph: GameGraph = {
      nodes: [{ id: 'gate', type: 'perf', position: { x: 0, y: 0 }, inputs: [], outputs: [], data }],
      edges: [],
    }

    const { container } = render(
      <NodeInspector
        graph={graph}
        nodeId="gate"
        overlays={{ [overlay.id]: overlay }}
        onChange={vi.fn()}
      />,
    )

    const mountSection = container.querySelector<HTMLElement>('[data-focus-anchor="mount:n_door"]')!
    const componentLabel = within(mountSection).getByText('触发按键', { selector: 'span' })
    const fixedTextLabel = within(mountSection).getByText('固定文本', { selector: 'span' })
    const parameterLabel = within(mountSection).getByText('参数', { selector: 'span' })
    const gridColumns = fixedTextLabel.closest('label')?.style.gridTemplateColumns ?? ''
    const labelWidth = gridColumns.split(' ')[0]!
    expect(Number.parseFloat(labelWidth)).toBeLessThan(77)
    expect(componentLabel.closest('label')?.style.gridTemplateColumns).toBe(gridColumns)
    expect(parameterLabel.parentElement?.style.gridTemplateColumns).toBe(gridColumns)
    expect(gridColumns).toContain('minmax(0, 320px)')

    for (const label of ['类型', '实体', '属性', '操作', '数值来源', '数值']) {
      expect(within(mountSection).getByText(label, { selector: 'span' })).toHaveStyle({ width: labelWidth })
    }
  })

  it('事件响应保留沿边推进入口，并把走边选择收进目标节点路由', () => {
    const overlay = structuredClone(PRESET_SCHEME_BY_ID.n_door!)
    const data: GameNodeData = {
      name: '慈悲狱门口',
      overlayNodes: [{ overlay: overlay.id }],
    }
    const graph: GameGraph = {
      nodes: [{ id: 'gate', type: 'perf', position: { x: 0, y: 0 }, inputs: [], outputs: [], data }],
      edges: [],
    }

    render(
      <NodeInspector
        graph={graph}
        nodeId="gate"
        overlays={{ [overlay.id]: overlay }}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getAllByRole('button', { name: '＋ 添加效果' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: '＋ 沿边推进' })).toHaveLength(2)
    expect(screen.queryByText('走边')).toBeNull()
    expect(screen.queryByRole('combobox', { name: '绑定界面' })).toBeNull()
    expect(screen.getByText('界面')).toBeTruthy()
    expect(screen.queryByText('覆盖物事件')).toBeNull()
    const overlaySelect = screen.getByTitle(/从目录追加一张 overlay 挂载/) as HTMLSelectElement
    expect(overlaySelect.options[0]?.text).toBe('＋ 添加界面')
    expect([...overlaySelect.options].find((option) => option.value === overlay.id)?.text).toBe(overlay.title)
    expect(overlaySelect.textContent).not.toContain(`(${overlay.id})`)
    expect(screen.queryByText(/尚未挂载/)).toBeNull()
  })

  it('允许同一界面方案重复添加，并为第二份生成独立挂载 id', () => {
    const overlay = structuredClone(PRESET_SCHEME_BY_ID.n_door!)
    const graph: GameGraph = {
      nodes: [{
        id: 'gate',
        type: 'perf',
        position: { x: 0, y: 0 },
        inputs: [],
        outputs: [],
        data: { name: '慈悲狱门口', overlayNodes: [{ overlay: overlay.id }] },
      }],
      edges: [],
    }
    const onChange = vi.fn()
    render(
      <NodeInspector
        graph={graph}
        nodeId="gate"
        overlays={{ [overlay.id]: overlay }}
        onChange={onChange}
      />,
    )

    fireEvent.change(screen.getByTitle(/从目录追加一张 overlay 挂载/), { target: { value: overlay.id } })

    const next = onChange.mock.calls.at(-1)?.[0] as GameGraph
    expect(next.nodes[0]?.data.overlayNodes).toEqual([
      { overlay: 'n_door' },
      { id: 'n_door__2', overlay: 'n_door', layout: { left: 0, top: 0, width: 1, height: 1 } },
    ])
  })

  it('界面配置标题只展示名称，不拼接 overlay id', () => {
    const overlay = { id: 'base:InkKou', title: '叩击', children: [] }
    const graph: GameGraph = {
      nodes: [{
        id: 'gate',
        type: 'perf',
        position: { x: 0, y: 0 },
        inputs: [],
        outputs: [],
        data: { name: '慈悲狱门口', overlayNodes: [{ overlay: overlay.id }] },
      }],
      edges: [],
    }

    const { container } = render(
      <NodeInspector
        graph={graph}
        nodeId="gate"
        overlays={{ [overlay.id]: overlay }}
        onChange={vi.fn()}
      />,
    )

    const mountCard = container.querySelector('[data-focus-anchor="mount:base:InkKou"]')
    expect(mountCard).toBeTruthy()
    expect(mountCard).toHaveTextContent('叩击')
    expect(mountCard).not.toHaveTextContent('叩击 (base:InkKou)')
  })

  it('only stores the field changed in a shared scheme component override', () => {
    const overlay = {
      id: 'scheme-shared',
      title: '共享提示',
      children: [{
        id: 'notice',
        component: 'StatusNotice',
        inputs: { text: '原始提示', color: '#ffffff', durationMs: 1600 },
      }],
    }
    const graph: GameGraph = {
      nodes: [{
        id: 'gate',
        type: 'perf',
        position: { x: 0, y: 0 },
        inputs: [],
        outputs: [],
        data: { name: '门口', overlayNodes: [{ overlay: overlay.id }] },
      }],
      edges: [],
    }
    const onChange = vi.fn()
    render(
      <NodeInspector
        graph={graph}
        nodeId="gate"
        overlays={{ [overlay.id]: overlay }}
        onChange={onChange}
      />,
    )

    const durationField = screen.getByText('总时长ms').parentElement!
    fireEvent.change(within(durationField).getByRole('spinbutton'), { target: { value: '2000' } })

    const next = onChange.mock.calls.at(-1)?.[0] as GameGraph
    expect(next.nodes[0]?.data.overlayNodes?.[0]?.overrides).toEqual({
      notice: { inputs: { durationMs: 2000 } },
    })
  })

  it('stores a direct entity hp selection from the node-mounted scheme entry', () => {
    const overlay = {
      id: 'battle-hud',
      title: '战斗 HUD',
      children: [{
        id: 'hp',
        component: 'BattlePlayerHpBar',
        inputs: { label: '我方', current: 0, max: 100 },
      }],
    }
    const graph: GameGraph = {
      nodes: [{
        id: 'gate',
        type: 'perf',
        position: { x: 0, y: 0 },
        inputs: [],
        outputs: [],
        data: { name: '门口', overlayNodes: [{ overlay: overlay.id }] },
      }],
      edges: [],
    }
    const onChange = vi.fn()
    render(
      <NodeInspector
        graph={graph}
        nodeId="gate"
        overlays={{ [overlay.id]: overlay }}
        entities={{ hero: { id: 'hero', name: '主角', attrs: { hp: 80, hpMax: 100 } } }}
        onChange={onChange}
      />,
    )

    const hpSelect = within(screen.getByText('血量').parentElement!)
      .getByRole('combobox', { name: '数值内容' })
    fireEvent.click(hpSelect)
    fireEvent.click(screen.getByRole('menuitem', { name: '实体属性' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '主角' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'hp' }))

    const next = onChange.mock.calls.at(-1)?.[0] as GameGraph
    expect(next.nodes[0]?.data.overlayNodes?.[0]?.overrides).toEqual({
      hp: {
        inputs: {
          current: {
            expr: 'entity.hero.attr.hp',
            pick: {
              mode: 'pick',
              terms: [{
                source: 'entity',
                refId: 'hero',
                attr: 'hp',
                op: '+',
                constValue: undefined,
              }],
            },
          },
        },
      },
    })
  })
})
