// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerCoreSkins } from '../../../runtime/component-host/components'
import { registerComponent, unregisterComponent } from '../../../runtime/registry/component-registry'
import type { GameGraph, Overlay, OverlayEventRef } from '../../../runtime/schema/graph-schema'
import type { Formula } from '../../persist/formula-authoring'
import { ComponentEventsEditor } from '../ComponentEventsEditor'
import { ComponentFormFields } from '../component-form-fields'
import { NodeInspector } from '../NodeInspector'
import { OverlaySchemeEditor } from '../OverlaySchemeEditor'

registerCoreSkins()
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const event: OverlayEventRef = {
  eventId: 'pass',
  mountId: 'hud',
  childId: 'q',
  localEventId: 'pass',
  label: '成功',
  componentId: 'qte',
}

describe('ComponentEventsEditor', () => {
  it('catalog mode writes stable keys and never offers advance', () => {
    const onCatalogChange = vi.fn()
    render(
      <ComponentEventsEditor
        mode="catalog"
        events={[event]}
        spawnOptions={[]}
        onCatalogChange={onCatalogChange}
      />,
    )
    expect(screen.getByText('q:pass')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /沿边推进/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /效果/ }))
    expect(onCatalogChange).toHaveBeenCalledWith([
      expect.objectContaining({ when: { type: 'event', id: 'q:pass' } }),
    ])
  })

  it('mount mode shows inherited catalog actions and edits additions separately', () => {
    render(
      <ComponentEventsEditor
        mode="mount"
        events={[event]}
        catalogReactions={[{
          when: { type: 'event', id: 'q:pass' },
          do: [{ kind: 'effect', effects: [] }],
        }]}
        spawnOptions={[]}
        onMountActionsChange={vi.fn()}
      />,
    )
    expect(screen.getByText('目录继承动作：效果')).toBeTruthy()
    expect(screen.getByText('挂载追加动作')).toBeTruthy()
    expect(screen.getByRole('button', { name: /沿边推进/ })).toBeTruthy()
  })

  it('enables applying formulas inside catalog event effects when the formula library is provided', () => {
    const formula: Formula = {
      id: 'formula-damage',
      name: '伤害',
      ast: { t: 'num', id: 'n0', v: 12 },
    }
    render(
      <ComponentEventsEditor
        mode="catalog"
        events={[event]}
        catalogReactions={[{
          when: { type: 'event', id: 'q:pass' },
          do: [{
            kind: 'effect',
            effects: [{ kind: 'var', varId: '', op: 'set', value: 0 }],
          }],
        }]}
        spawnOptions={[]}
        pickers={{ formulas: { 'formula-damage': formula } }}
        onCatalogChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: '应用公式' })).not.toBeDisabled()
  })
})

describe('NodeInspector overlay events', () => {
  it('omits the event response area when the mounted overlay exports no events', () => {
    const graph: GameGraph = {
      nodes: [{
        id: 'n1',
        type: 'perf',
        position: { x: 0, y: 0 },
        inputs: [],
        outputs: [],
        data: {
          name: '无事件节点',
          overlayNodes: [{ overlay: 'hud' }],
        },
      }],
      edges: [],
    }
    render(
      <NodeInspector
        graph={graph}
        nodeId="n1"
        overlays={{
          hud: {
            id: 'hud',
            children: [{ id: 'damage', component: 'DamageFloatText', inputs: {} }],
          },
        }}
        onChange={vi.fn()}
      />,
    )

    expect(screen.queryByText('事件响应')).toBeNull()
    expect(screen.queryByText(/无导出事件/)).toBeNull()
    expect(screen.queryByText('位置')).toBeNull()
    expect(screen.queryByText('继承方案')).toBeNull()
    expect(screen.queryByText(/细调/)).toBeNull()
  })

  it('rewrites mount reaction aliases to one local event key when routing changes', () => {
    const onChange = vi.fn()
    const graph: GameGraph = {
      nodes: [
        {
          id: 'n1',
          type: 'perf',
          position: { x: 0, y: 0 },
          inputs: [],
          outputs: [],
          data: {
            name: '事件节点',
            overlayNodes: [{
              overlay: 'hud',
              reactions: [
                { when: { type: 'event', id: 'q:pass' }, do: [{ kind: 'effect', effects: [] }] },
                { when: { type: 'event', id: 'hud:q:pass' }, do: [{ kind: 'advance', edgeId: 'stale' }] },
              ],
            }],
          },
        },
        {
          id: 'n2',
          type: 'perf',
          position: { x: 100, y: 0 },
          inputs: [],
          outputs: [],
          data: { name: '目标节点' },
        },
      ],
      edges: [],
    }

    render(
      <NodeInspector
        graph={graph}
        nodeId="n1"
        overlays={{
          hud: {
            id: 'hud',
            children: [{
              id: 'q',
              component: 'qte',
              inputs: { events: [{ id: 'pass', label: '成功' }] },
            }],
          },
        }}
        onChange={onChange}
      />,
    )

    fireEvent.change(screen.getByLabelText('目标节点'), { target: { value: 'n2' } })

    const next = onChange.mock.calls.at(-1)?.[0] as GameGraph
    const reactions = next.nodes[0]?.data.overlayNodes?.[0]?.reactions ?? []
    const eventReactions = reactions.filter((reaction) => reaction.when.type === 'event')
    expect(eventReactions).toHaveLength(1)
    expect(eventReactions[0]?.when).toEqual({ type: 'event', id: 'pass' })
    expect(eventReactions[0]?.do.map((action) => action.kind)).toEqual(['effect', 'advance'])
  })
})

describe('OverlaySchemeEditor selected child', () => {
  it('defaults overlapping components to the visually topmost child', async () => {
    const { container } = render(
      <OverlaySchemeEditor
        overlayId="double-subtitle"
        overlay={{
          id: 'double-subtitle',
          children: [
            { id: 'subtitle-a', component: 'Dialogue', inputs: { text: 'A' } },
            { id: 'subtitle-b', component: 'Dialogue', inputs: { text: 'B' } },
          ],
        }}
        entities={{}}
        variables={{}}
        usageCount={0}
        onRename={vi.fn()}
        onRemove={vi.fn()}
        onAddChild={vi.fn()}
        onRemoveChild={vi.fn()}
        onPatchChild={vi.fn()}
        onReactionsChange={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(container.querySelector('[data-canvas-item="subtitle-b"]')?.classList.contains('is-selected')).toBe(true)
    })
    expect(container.querySelector('[data-canvas-item="subtitle-a"]')?.classList.contains('is-selected')).toBe(false)
  })

  it('moves the design canvas with its children and keeps a manually shrunken canvas clipped', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-overlay-fit-target')) {
        return {
          x: 50,
          y: 60,
          left: 50,
          top: 60,
          right: 150,
          bottom: 90,
          width: 100,
          height: 30,
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
    let latest: Overlay | undefined
    function Harness(): JSX.Element {
      const [overlay, setOverlay] = useState<Overlay>({
        id: 'double-subtitle',
        children: [
          {
            id: 'subtitle-a',
            component: 'Dialogue',
            inputs: { text: 'A' },
            layout: { left: 0, top: 0, width: 1, height: 1 },
          },
          {
            id: 'subtitle-b',
            component: 'Dialogue',
            inputs: { text: 'B' },
            layout: { left: 0, top: 0, width: 1, height: 1 },
          },
        ],
      })
      latest = overlay
      return (
        <>
          <OverlaySchemeEditor
            overlayId={overlay.id}
            overlay={overlay}
            entities={{}}
            variables={{}}
            usageCount={0}
            onRename={vi.fn()}
            onRemove={vi.fn()}
            onAddChild={vi.fn()}
            onRemoveChild={vi.fn()}
            onPatchChild={(childId, patch) => {
              setOverlay((current) => ({
                ...current,
                children: current.children.map((child) =>
                  child.id === childId
                    ? {
                        ...child,
                        ...(patch.inputs ? { inputs: patch.inputs } : {}),
                        ...(patch.layout ? { layout: { ...child.layout, ...patch.layout } } : {}),
                      }
                    : child),
              }))
            }}
            onMoveCanvas={(moveDelta) => setOverlay((current) => ({
              ...current,
              children: current.children.map((child) => ({
                ...child,
                layout: {
                  ...child.layout,
                  left: (typeof child.layout?.left === 'number' ? child.layout.left : 0) + moveDelta.x,
                  top: (typeof child.layout?.top === 'number' ? child.layout.top : 0) + moveDelta.y,
                  right: undefined,
                  bottom: undefined,
                },
              })),
            }))}
            onReactionsChange={vi.fn()}
          />
        </>
      )
    }
    render(<Harness />)

    await waitFor(() => expect(screen.getByLabelText('覆盖物画布 宽%')).toHaveValue(50))
    expect(screen.getByLabelText('覆盖物画布 高%')).toHaveValue(50)
    expect(screen.queryByRole('button', { name: /调整dialogue大小/ })).toBeNull()
    expect(document.querySelectorAll('[data-overflow-child]')).not.toHaveLength(0)
    expect((document.querySelector('[data-overlay-content-clip]') as HTMLElement).style.clipPath).toContain('inset(')

    const canvas = screen.getByRole('application', { name: '界面方案画布' })
    expect(fireEvent.keyDown(window, { key: ' ', code: 'Space' })).toBe(false)
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 2, clientX: 60, clientY: 30 })
    fireEvent.pointerMove(canvas, { pointerId: 2, clientX: 80, clientY: 40 })
    fireEvent.pointerUp(canvas, { pointerId: 2, clientX: 80, clientY: 40 })
    fireEvent.keyUp(window, { key: ' ', code: 'Space' })

    await waitFor(() => {
      expect((document.querySelector('[data-canvas-item="__overlay-canvas__"]') as HTMLElement).style.left).toBe('35%')
    })
    expect(latest?.children[0]?.layout?.left).toBeCloseTo(0.1)
    expect(latest?.children[0]?.layout?.top).toBeCloseTo(0.1)
    expect(latest?.children[1]?.layout?.left).toBeCloseTo(0.1)
    expect(latest?.children[1]?.layout?.top).toBeCloseTo(0.1)
    expect(screen.getAllByRole('button', { name: /调整覆盖物画布大小/ })).toHaveLength(8)

    const resize = screen.getByRole('button', { name: '调整覆盖物画布大小：右下' })
    fireEvent.pointerDown(resize, { pointerId: 3, clientX: 170, clientY: 85 })
    fireEvent.pointerMove(resize, { pointerId: 3, clientX: 130, clientY: 65 })
    fireEvent.pointerUp(resize, { pointerId: 3, clientX: 130, clientY: 65 })

    await waitFor(() => expect(screen.getByLabelText('覆盖物画布 宽%')).toHaveValue(30))
    expect(screen.getByLabelText('覆盖物画布 高%')).toHaveValue(30)
    expect(Object.prototype.hasOwnProperty.call(latest, 'layout')).toBe(false)
    expect(document.querySelectorAll('[data-overflow-child]')).not.toHaveLength(0)
  })

  it('defaults to the first child and immediately shows parameters and events below the canvas', () => {
    render(
      <OverlaySchemeEditor
        overlayId="hud"
        overlay={{
          id: 'hud',
          children: [{
            id: 'q',
            component: 'qte',
            inputs: { events: [{ id: 'pass', label: '成功' }], timeoutMs: 800 },
          }],
        }}
        entities={{}}
        variables={{}}
        usageCount={0}
        onRename={vi.fn()}
        onRemove={vi.fn()}
        onAddChild={vi.fn()}
        onRemoveChild={vi.fn()}
        onPatchChild={vi.fn()}
        onReactionsChange={vi.fn()}
      />,
    )
    expect(screen.getByTestId('overlay-selected-child-editor')).toBeTruthy()
    expect(screen.getByText(/^参数 ·/)).toBeTruthy()
    expect(screen.getByText('事件')).toBeTruthy()
    expect(screen.getByText('q:pass')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /调整qte大小/ })).toBeNull()
  })

  it('allows parameter edits while the base scheme structure is locked', () => {
    const onPatchChild = vi.fn()
    render(
      <OverlaySchemeEditor
        overlayId="base:BattlePlayerHpBar"
        overlay={{
          id: 'base:BattlePlayerHpBar',
          children: [{
            id: 'hp',
            component: 'BattlePlayerHpBar',
            inputs: { current: 50, max: 90, label: '我方', qi: 3, qiMax: 5 },
          }],
        }}
        entities={{}}
        variables={{}}
        usageCount={0}
        locked
        onRename={vi.fn()}
        onRemove={vi.fn()}
        onAddChild={vi.fn()}
        onRemoveChild={vi.fn()}
        onPatchChild={onPatchChild}
        onReactionsChange={vi.fn()}
      />,
    )
    const current = screen.getByText('当前血量').closest('label')!.querySelector('input') as HTMLInputElement
    expect(current.disabled).toBe(false)
    fireEvent.change(current, { target: { value: '60' } })
    expect(onPatchChild).toHaveBeenCalledWith('hp', {
      inputs: expect.objectContaining({ current: 60 }),
    })
  })

  it('keeps catalog event actions disabled for locked base schemes', () => {
    render(
      <OverlaySchemeEditor
        overlayId="base:InkYingMo"
        overlay={{ id: 'base:InkYingMo', children: [{ id: 'choice', component: 'InkYingMo', inputs: {} }] }}
        entities={{}}
        variables={{}}
        usageCount={0}
        locked
        onRename={vi.fn()}
        onRemove={vi.fn()}
        onAddChild={vi.fn()}
        onRemoveChild={vi.fn()}
        onPatchChild={vi.fn()}
        onReactionsChange={vi.fn()}
      />,
    )
    expect((screen.getByTestId('overlay-event-editor') as HTMLFieldSetElement).disabled).toBe(true)
    expect(screen.getByText('choice:ying')).toBeTruthy()
  })

  it('does not render an event section for a component without exported events', () => {
    render(
      <OverlaySchemeEditor
        overlayId="float"
        overlay={{ id: 'float', children: [{ id: 'damage', component: 'DamageFloatText', inputs: { text: '-25' } }] }}
        entities={{}}
        variables={{}}
        usageCount={0}
        onRename={vi.fn()}
        onRemove={vi.fn()}
        onAddChild={vi.fn()}
        onRemoveChild={vi.fn()}
        onPatchChild={vi.fn()}
        onReactionsChange={vi.fn()}
      />,
    )
    expect(screen.getByTestId('overlay-selected-child-editor')).toBeTruthy()
    expect(screen.queryByText('事件')).toBeNull()
  })
})

describe('ComponentFormFields defaults', () => {
  it('shows declared defaults as placeholders without writing them into values', () => {
    registerComponent('test-default-input', {
      inputs: [
        { key: 'text', label: '文本', valueType: 'string', default: '默认文本' },
        { key: 'count', label: '数量', valueType: 'number', default: 3 },
      ],
    })
    const onChange = vi.fn()
    function Harness(): JSX.Element {
      const [values, setValues] = useState<Record<string, unknown>>({ text: '原文本' })
      return (
        <ComponentFormFields
          componentId="test-default-input"
          values={values}
          onChange={(next) => {
            setValues(next)
            onChange(next)
          }}
        />
      )
    }
    render(<Harness />)
    const input = screen.getByDisplayValue('原文本')
    expect(input.getAttribute('placeholder')).toBe('默认文本')
    expect(screen.getByPlaceholderText('3')).toBeTruthy()

    fireEvent.change(input, { target: { value: '' } })
    expect(onChange).toHaveBeenNthCalledWith(1, {})

    fireEvent.blur(input)
    expect(onChange).toHaveBeenCalledTimes(1)
    unregisterComponent('test-default-input')
  })

  it('edits damage float text as either a fixed number or an applied formula', () => {
    const formula: Formula = {
      id: 'formula-float-damage',
      name: '飘字伤害',
      ast: { t: 'num', id: 'n0', v: -12 },
    }
    const onChange = vi.fn()
    render(
      <ComponentFormFields
        componentId="DamageFloatText"
        values={{}}
        pickers={{ formulas: { [formula.id]: formula } }}
        onChange={onChange}
      />,
    )

    expect(screen.getByRole('textbox', { name: '常量数值' })).toHaveValue('-25')
    const applyFormula = screen.getByRole('button', { name: '应用公式' })
    expect(applyFormula).not.toBeDisabled()
    fireEvent.click(applyFormula)
    expect(onChange).toHaveBeenCalledWith({
      value: {
        expr: '-12',
        pick: {
          mode: 'formula',
          formulaId: formula.id,
          holeBindings: {},
        },
      },
    })
  })
})
