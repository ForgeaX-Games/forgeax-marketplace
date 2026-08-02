// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerCoreSkins } from '../../../runtime/component-host/components'
import { registerComponent, unregisterComponent } from '../../../runtime/registry/component-registry'
import type { Entity, GameGraph, OverlayEventRef } from '../../../runtime/schema/graph-schema'
import type { Formula } from '../../persist/formula-authoring'
import { ComponentEventsEditor } from '../ComponentEventsEditor'
import { ComponentFormFields } from '../component-form-fields'
import { ensureEntity, ensureEntityAttribute } from '../metaCatalog'
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

function chooseCascade(trigger: HTMLElement, ...labels: string[]): void {
  fireEvent.click(trigger)
  for (const label of labels) {
    fireEvent.click(screen.getByRole('menuitem', { name: label }))
  }
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

  it('mount mode edits additions without showing catalog or mount action labels', () => {
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
    expect(screen.queryByText(/目录继承动作/)).toBeNull()
    expect(screen.queryByText(/挂载追加动作/)).toBeNull()
    expect(screen.getByRole('button', { name: /沿边推进/ })).toBeTruthy()
  })

  it('renders one advance action with custom route controls and preserves it when side effects change', () => {
    const onMountActionsChange = vi.fn()
    render(
      <ComponentEventsEditor
        mode="mount"
        events={[event]}
        mountReactions={[{
          when: { type: 'event', id: 'pass' },
          do: [{ kind: 'advance', edgeId: 'edge-1' }],
        }]}
        spawnOptions={[]}
        renderRoute={() => <div>从事件节点到目标节点</div>}
        onMountActionsChange={onMountActionsChange}
      />,
    )

    expect(screen.getByText('沿边推进')).toBeTruthy()
    expect(screen.getByText('从事件节点到目标节点')).toBeTruthy()
    expect(screen.queryByText('走边')).toBeNull()
    expect(screen.queryByRole('button', { name: /沿边推进/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '＋ 添加效果' }))
    expect(onMountActionsChange).toHaveBeenCalledWith(event, [
      { kind: 'advance', edgeId: 'edge-1' },
      expect.objectContaining({ kind: 'effect' }),
    ])
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

    const content = screen.getByRole('combobox', { name: '数值来源' })
    fireEvent.click(content)
    fireEvent.click(screen.getByRole('menuitem', { name: '公式' }))
    expect(screen.getByRole('menuitem', { name: '伤害' })).toBeTruthy()
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
  it('requires confirmation before deleting a custom interface scheme', () => {
    const onRemove = vi.fn()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(
      <OverlaySchemeEditor
        overlayId="custom-hud"
        overlay={{ id: 'custom-hud', title: '战斗界面', children: [] }}
        entities={{}}
        variables={{}}
        usageCount={2}
        onRename={vi.fn()}
        onRemove={onRemove}
        onAddChild={vi.fn()}
        onRemoveChild={vi.fn()}
        onPatchChild={vi.fn()}
        onReactionsChange={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(confirm).toHaveBeenCalledWith('确定删除自定义界面方案「战斗界面」？当前仍被 2 个节点引用，删除后这些挂载将无法解析界面。')
    expect(onRemove).not.toHaveBeenCalled()

    confirm.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(onRemove).toHaveBeenCalledTimes(1)
  })

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

  it('uses a full editor viewport backed by full-stage logical coordinates', async () => {
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
    render(
      <OverlaySchemeEditor
        overlayId="double-subtitle"
        overlay={{
          id: 'double-subtitle',
          children: [{
            id: 'subtitle-a',
            component: 'Dialogue',
            inputs: { text: 'A' },
            layout: { left: 0, top: 0, width: 1, height: 1 },
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

    await waitFor(() => expect(document.querySelector('[data-overlay-design-canvas]')).toBeTruthy())
    expect(document.querySelector('[data-overlay-bounds-readout]')).toBeNull()
    expect(screen.queryByRole('button', { name: /调整dialogue大小/ })).toBeNull()
    expect(document.querySelectorAll('[data-overflow-child]')).toHaveLength(0)
    expect((document.querySelector('[data-overlay-content-clip]') as HTMLElement).style.clipPath).toContain('inset(')
    expect(document.querySelector('[data-overlay-design-canvas]')).toHaveStyle({
      left: '0%', top: '0%', width: '100%', height: '100%',
    })
    expect(document.querySelector('[data-overlay-coordinate-stage]')).toHaveStyle({
      left: '0%', top: '0%', width: '100%', height: '100%',
    })
    expect(screen.queryByRole('button', { name: /调整覆盖物画布大小/ })).toBeNull()
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
    const currentField = screen.getByText('血量').parentElement!
    expect(screen.getByText(/不能增删或拖动组件/)).toBeTruthy()
    expect(document.querySelector('[data-overlay-design-canvas]')).toBeNull()
    expect(document.querySelector('[data-overlay-centered-child="hp"]')).toBeTruthy()
    expect(screen.getByLabelText('基础界面组件边界')).toBeTruthy()
    expect(document.querySelector('[data-canvas-item="hp"]')).toHaveClass('is-selected')
    expect(screen.queryByText('虚拟画布尺寸')).toBeNull()
    expect(screen.queryByRole('button', { name: /调整BattlePlayerHpBar大小/ })).toBeNull()
    expect(currentField.style.gridTemplateColumns).toBe('7em minmax(0, 1fr)')
    expect(currentField.style.columnGap).toBe('8px')
    expect(currentField.style.fontSize).toBe('11px')
    expect(screen.queryByRole('radiogroup', { name: '血量来源' })).toBeNull()
    const current = currentField
      .querySelector('input[aria-label="常量数值"]') as HTMLInputElement
    expect(current.disabled).toBe(false)
    fireEvent.change(current, { target: { value: '60' } })
    expect(onPatchChild).toHaveBeenCalledWith('hp', {
      inputs: expect.objectContaining({ current: 60 }),
    })
  })

  it('renders entity name references from rule metadata in the interface canvas', () => {
    const { container } = render(
      <OverlaySchemeEditor
        overlayId="base:BattleEnemyHpBar"
        overlay={{
          id: 'base:BattleEnemyHpBar',
          children: [{
            id: 'hp',
            component: 'BattleEnemyHpBar',
            inputs: { label: { ref: 'entity.ent-player.name' } },
          }],
        }}
        entities={{
          'ent-player': { id: 'ent-player', name: '空藏', attrs: { hp: 80 } },
          'ent-boss': { id: 'ent-boss', name: '小怪', attrs: { hp: 100 } },
        }}
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
    expect(container.querySelector('.ks-hud-boss-name')?.textContent).toBe('空藏')
  })

  it('keeps base structure locked while allowing catalog event actions', () => {
    const onReactionsChange = vi.fn()
    const { container } = render(
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
        onReactionsChange={onReactionsChange}
      />,
    )
    expect(container.querySelector('[data-overlay-design-canvas]')).toBeNull()
    expect(container.querySelector('[data-overlay-centered-child="choice"]')).toBeTruthy()
    expect(screen.queryByText('虚拟画布尺寸')).toBeNull()
    expect(screen.queryByLabelText('界面方案画布')).toBeNull()
    expect(screen.getByLabelText('基础界面组件边界')).toBeTruthy()
    expect(container.querySelector('[data-canvas-item="choice"]')).toHaveClass('is-selected')
    expect((screen.getByTestId('overlay-event-editor') as HTMLFieldSetElement).disabled).toBe(false)
    expect(screen.getByText('choice:ying')).toBeTruthy()
    const effectButtons = screen.getAllByRole('button', { name: '＋ 添加效果' })
    const spawnButtons = screen.getAllByRole('combobox', { name: '添加显示界面' })
    expect(effectButtons[0]).not.toBeDisabled()
    expect(spawnButtons[0]).not.toBeDisabled()
    fireEvent.click(effectButtons[0]!)
    expect(onReactionsChange).toHaveBeenCalled()
  })

  it('does not render an event section for a component without exported events', () => {
    render(
      <OverlaySchemeEditor
        overlayId="float"
        overlay={{ id: 'float', children: [{ id: 'damage', component: 'DamageFloatText', inputs: { parameter: '-25' } }] }}
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
  it.each([
    [
      'StatusNotice',
      { fixedText: '获得道具', parameter: '〈xxx〉', color: '#f0f0f0', fontSize: 2.4, durationMs: 1600 },
      ['固定文本', '参数', '字色', '字号', '总时长ms'],
    ],
    [
      'DamageFloatText',
      { fixedText: '', parameter: '-25', color: '#ff5a5a', fontSize: 3.5, durationMs: 1100 },
      ['固定文本', '参数', '字色', '字号', '总时长ms'],
    ],
    [
      'GainFloatText',
      { fixedText: '', parameter: '+50', color: '#ffd54a', fontSize: 3.5, durationMs: 1100 },
      ['固定文本', '参数', '字色', '字号', '总时长ms'],
    ],
  ])('gives %s compact parameters one full-width row with readable labels', (componentId, values, labels) => {
    render(
      <ComponentFormFields
        componentId={componentId}
        values={values}
        density="compact"
        labelWidth="7em"
        onChange={() => undefined}
      />,
    )

    for (const label of labels) {
      const row = screen.getByText(label).parentElement!
      expect(row.style.display).toBe('grid')
      expect(row.style.width).toBe('100%')
      expect(row.style.gridTemplateColumns).toBe(
        label === '参数' ? '7em minmax(0, 1fr)' : '7em minmax(0, 320px)',
      )
    }

    for (const input of screen.queryAllByRole('spinbutton')) {
      expect(input).toHaveStyle({ width: '100%' })
    }
  })

  it('stacks formula selection above its parameter bindings in compact component fields', () => {
    const formula: Formula = {
      id: 'formula-layout',
      name: '伤害公式',
      ast: {
        t: 'hole',
        id: 'coefficient',
        holeId: 'coefficient',
        kind: 'number',
        label: '系数',
      },
    }
    render(
      <ComponentFormFields
        componentId="DamageFloatText"
        values={{
          parameter: {
            expr: '0',
            pick: {
              mode: 'formula',
              formulaId: formula.id,
              holeBindings: {},
            },
          },
        }}
        pickers={{ formulas: { [formula.id]: formula } }}
        density="compact"
        labelWidth="7em"
        onChange={() => undefined}
      />,
    )

    const valueRow = screen.getByText('参数').parentElement!
    const picker = within(valueRow).getByRole('combobox', { name: '文本内容' })
    const valueEditor = picker.parentElement?.parentElement?.parentElement as HTMLElement

    expect(valueRow.style.alignItems).toBe('start')
    expect(screen.getByText('参数')).toHaveStyle({ paddingTop: '6px' })
    expect(valueEditor.style.flexDirection).toBe('column')
    expect(valueEditor.style.width).toBe('100%')
    expect(within(valueRow).getByRole('group', { name: '参数：系数' })).toBeTruthy()
  })

  it('forwards formula attribute creation from GainFloatText into the binding editor', () => {
    const formula: Formula = {
      id: 'formula-hp-max',
      name: '生命上限公式',
      ast: {
        t: 'hole',
        id: 'max-hp',
        holeId: 'maxHp',
        kind: 'entityAttr',
        label: '生命上限',
        suggestAttr: 'hpMax',
      },
    }
    render(
      <ComponentFormFields
        componentId="GainFloatText"
        values={{
          parameter: {
            expr: '0',
            pick: {
              mode: 'formula',
              formulaId: formula.id,
              holeBindings: {
                maxHp: { kind: 'entityAttr', entityId: 'ent-0', attr: 'hpMax' },
              },
            },
          },
        }}
        pickers={{
          formulas: { [formula.id]: formula },
          entities: {
            'ent-0': { id: 'ent-0', name: '我方', attrs: { hp: 80 } },
          },
        }}
        density="compact"
        onCreateEntityAttribute={vi.fn()}
        onChange={() => undefined}
      />,
    )

    expect(screen.queryByText(/参数绑定未完成/)).toBeNull()
    chooseCascade(
      screen.getByRole('combobox', { name: '生命上限来源' }),
      '实体属性',
      '我方',
      '配置「生命上限」属性',
    )
    expect(screen.getByRole('textbox', { name: '我方的新属性 ID' })).toHaveValue('hpMax')
    expect(screen.getByRole('menuitem', { name: '确认创建并选择' })).toBeEnabled()
  })

  it('never offers an unset/default option for interface enum settings', () => {
    registerComponent('test-enum-input', {
      inputs: [
        {
          key: 'mode',
          label: '模式',
          valueType: 'string',
          default: 'second',
          options: [
            { value: 'first', label: '第一项' },
            { value: 'second', label: '第二项' },
          ],
        },
        {
          key: 'alignment',
          label: '对齐',
          valueType: 'string',
          options: [
            { value: 'left', label: '左侧' },
            { value: 'right', label: '右侧' },
          ],
        },
      ],
    })

    render(
      <ComponentFormFields
        componentId="test-enum-input"
        values={{}}
        onChange={() => undefined}
      />,
    )

    const mode = screen.getByRole('combobox', { name: '模式' })
    const alignment = screen.getByRole('combobox', { name: '对齐' })
    expect(mode).toHaveValue('second')
    expect(alignment).toHaveValue('left')
    expect(within(mode).queryByRole('option', { name: /默认|未选|未设置/ })).toBeNull()
    expect(within(alignment).queryByRole('option', { name: /默认|未选|未设置/ })).toBeNull()
    expect(within(mode).getAllByRole('option')).toHaveLength(2)
    expect(within(alignment).getAllByRole('option')).toHaveLength(2)

    unregisterComponent('test-enum-input')
  })

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

  it('fills a declared numeric default only after an emptied input loses focus', () => {
    registerComponent('test-number-default-input', {
      inputs: [{ key: 'hp', label: '血量', valueType: 'number', default: 60 }],
    })
    const onChange = vi.fn()
    function Harness(): JSX.Element {
      const [values, setValues] = useState<Record<string, unknown>>({ hp: 60 })
      return (
        <ComponentFormFields
          componentId="test-number-default-input"
          values={values}
          onChange={(next) => {
            setValues(next)
            onChange(next)
          }}
        />
      )
    }
    render(<Harness />)

    const input = screen.getByDisplayValue('60')
    fireEvent.change(input, { target: { value: '' } })

    expect(input).toHaveValue(null)
    expect(onChange).toHaveBeenNthCalledWith(1, {})

    fireEvent.blur(input)

    expect(input).toHaveValue(60)
    expect(onChange).toHaveBeenNthCalledWith(2, { hp: 60 })
    unregisterComponent('test-number-default-input')
  })

  it('edits damage float text parameter as either a constant or an applied formula', () => {
    const formula: Formula = {
      id: 'formula-float-damage',
      name: '飘字伤害',
      ast: { t: 'num', id: 'n0', v: -12 },
    }
    const onChange = vi.fn()
    render(
      <ComponentFormFields
        componentId="DamageFloatText"
        values={{ parameter: '-25' }}
        pickers={{ formulas: { [formula.id]: formula } }}
        onChange={onChange}
      />,
    )

    expect(within(screen.getByText('参数').parentElement!)
      .getByRole('textbox', { name: '固定文本' })).toHaveValue('-25')
    chooseCascade(screen.getByRole('combobox', { name: '文本内容' }), '公式', '飘字伤害')
    expect(onChange).toHaveBeenCalledWith({
      parameter: {
        expr: '-12',
        pick: {
          mode: 'formula',
          formulaId: formula.id,
          holeBindings: {},
        },
      },
    })
  })

  it('uses the declared parameter default without offering an unset option', () => {
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

    const picker = screen.getByRole('combobox', { name: '文本内容' })
    expect(picker).toHaveValue('literal')
    expect(within(screen.getByText('参数').parentElement!)
      .getByRole('textbox', { name: '固定文本' })).toHaveValue('-25')
    fireEvent.click(picker)
    expect(screen.queryByRole('menuitem', { name: '未设置（使用组件默认）' })).toBeNull()

    fireEvent.click(screen.getByRole('menuitem', { name: '公式' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '飘字伤害' }))
    expect(onChange).toHaveBeenLastCalledWith({
      parameter: {
        expr: '-12',
        pick: {
          mode: 'formula',
          formulaId: formula.id,
          holeBindings: {},
        },
      },
    })
  })

  it('shows inferred state content without rewriting the stored expression', () => {
    const onChange = vi.fn()
    render(
      <ComponentFormFields
        componentId="DamageFloatText"
        values={{ parameter: { ref: 'entity.hero.attr.hp' } }}
        pickers={{
          entities: {
            hero: { id: 'hero', name: '主角', attrs: { hp: 80, attack: 12 } },
          },
          variables: {
            qi: { id: 'qi', name: '气力', initial: 2 },
          },
        }}
        onChange={onChange}
      />,
    )

    expect(screen.getByRole('combobox', { name: '文本内容' })).toHaveValue('entity-attr:hero:hp')
    expect(screen.queryByText(/常量：10 · 状态：entity\.hero\.attr\.hp \/ var\.qi/)).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('shows only direct enemy hp bar parameters and prioritizes matching entity values', () => {
    const formula: Formula = {
      id: 'formula-hp',
      name: '血量公式',
      ast: { t: 'num', id: 'n0', v: 42 },
    }
    const onChange = vi.fn()
    let latest: Record<string, unknown> = {}
    function Harness(): JSX.Element {
      const [values, setValues] = useState<Record<string, unknown>>({
        label: { ref: 'entity.ent-boss.name' },
        current: { expr: 'entity.ent-boss.attr.vitality' },
        max: { expr: 'entity.ent-boss.attr.vitalityLimit' },
      })
      latest = values
      return (
        <ComponentFormFields
          componentId="BattleEnemyHpBar"
          values={values}
          pickers={{
            entities: {
              'ent-player': {
                id: 'ent-player',
                kind: 'player',
                name: '空藏',
                attrs: { hp: 80, hpMax: 100 },
                attrMeta: { hp: { label: '生命' } },
              },
              'ent-boss': {
                id: 'ent-boss',
                kind: 'boss',
                name: '小怪',
                attrs: {
                  vitality: 700,
                  vitalityLimit: 700,
                  hp: 20,
                  hpMax: 30,
                  attack: 75,
                  defense: 50,
                },
                attrMeta: {
                  vitality: { label: '当前血量' },
                  vitalityLimit: { label: '最大血量' },
                  hp: { label: '攻击力' },
                  hpMax: { label: '防御上限' },
                },
              },
            },
            formulas: { [formula.id]: formula },
          }}
          onChange={(next) => {
            setValues(next)
            onChange(next)
          }}
        />
      )
    }
    render(<Harness />)

    expect(screen.queryByText('实体')).toBeNull()
    expect(screen.queryByText('属性')).toBeNull()
    expect(screen.queryByRole('radiogroup', { name: '血量来源' })).toBeNull()
    expect(screen.queryByText('当前值来源')).toBeNull()
    expect(screen.queryByText('上限来源')).toBeNull()
    expect(screen.getAllByRole('combobox')).toHaveLength(3)

    const labelField = screen.getByText('显示名').parentElement!
    const currentField = screen.getByText('血量').parentElement!
    const maxField = screen.getByText('最大血量').parentElement!
    const labelSelect = within(labelField).getByRole('combobox', { name: '文本内容' })
    const currentSelect = within(currentField).getByRole('combobox', { name: '数值内容' })
    const maxSelect = within(maxField).getByRole('combobox', { name: '数值内容' })

    expect(labelField.style.flexBasis).toBe('100%')
    expect(currentField.style.flexBasis).toBe('100%')
    expect(maxField.style.flexBasis).toBe('100%')
    expect(labelSelect).toHaveValue('entity-name:ent-boss')
    expect(currentSelect).toHaveValue('entity:ent-boss:vitality')
    expect(maxSelect).toHaveValue('entity:ent-boss:vitalityLimit')
    expect(labelSelect).toHaveTextContent('小怪')
    expect(currentSelect).toHaveTextContent('小怪的当前血量')
    expect(maxSelect).toHaveTextContent('小怪的最大血量')

    fireEvent.click(currentSelect)
    expect(screen.getByRole('menuitem', { name: '当前血量' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'attack' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'defense' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: '攻击力' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: '防御上限' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: '最大血量' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: '公式' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '血量公式' }))
    expect(latest.current).toEqual({
      expr: '42',
      pick: {
        mode: 'formula',
        formulaId: formula.id,
        holeBindings: {},
      },
    })

    fireEvent.click(maxSelect)
    expect(screen.getByRole('menuitem', { name: '最大血量' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: '当前血量' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: '防御上限' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: '常量' }))
    fireEvent.change(within(maxField).getByRole('textbox', { name: '常量数值' }), {
      target: { value: '900' },
    })
    const maxEditorRow = within(maxField).getByRole('textbox', { name: '常量数值' }).parentElement!
    expect(maxEditorRow).toHaveStyle({ display: 'flex', flexWrap: 'nowrap' })
    expect(latest.max).toBe(900)
    expect(onChange).toHaveBeenCalledTimes(3)
  })

  it('does not offer an unset option for player hp bar values', () => {
    render(
      <ComponentFormFields
        componentId="BattlePlayerHpBar"
        values={{ current: 80, max: 100 }}
        pickers={{ entities: {} }}
        onChange={() => undefined}
      />,
    )

    const qiField = screen.getByText('当前气力').parentElement!
    const qiPicker = within(qiField).getByRole('combobox', { name: '数值内容' })
    const qiValue = within(qiField).getByRole('textbox', { name: '常量数值' })
    expect(qiPicker).toHaveTextContent('常量')
    expect(qiValue).toHaveValue('3')

    fireEvent.click(qiPicker)
    expect(screen.queryByRole('menuitem', { name: '未设置（使用组件默认）' })).toBeNull()
  })

  it('offers a confirmed rule attribute setup when the required hp value is missing', () => {
    const onChange = vi.fn()
    let latestValues: Record<string, unknown> = { label: '敌方', current: 0, max: 100 }
    function Harness(): JSX.Element {
      const [entities, setEntities] = useState<Record<string, Entity>>({
        boss: {
          id: 'boss',
          kind: 'boss',
          name: '小怪',
          attrs: { attack: 20, defense: 10, hp: 30 },
          attrMeta: { hp: { label: '攻击力' } },
        },
      })
      const [values, setValues] = useState<Record<string, unknown>>(latestValues)
      latestValues = values
      return (
        <>
          <ComponentFormFields
            componentId="BattleEnemyHpBar"
            values={values}
            pickers={{ entities }}
            onCreateEntityAttribute={(request) => {
              setEntities((current) => ensureEntityAttribute(current, request) ?? current)
            }}
            onChange={(next) => {
              setValues(next)
              onChange(next)
            }}
          />
          <output data-testid="entities-state">{JSON.stringify(entities)}</output>
        </>
      )
    }
    render(<Harness />)

    const hpPicker = within(screen.getByText('血量').parentElement!)
      .getByRole('combobox', { name: '数值内容' })
    chooseCascade(hpPicker, '实体属性', '小怪', '配置「当前血量」属性')

    expect(screen.queryByRole('menuitem', { name: 'attack' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'defense' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: '攻击力' })).toBeNull()
    expect(screen.getByRole('textbox', { name: '小怪的新属性 ID' })).toHaveValue('hp2')
    expect(screen.getByRole('textbox', { name: '小怪的新属性显示名' })).toHaveValue('当前血量')
    expect(screen.getByRole('textbox', { name: '小怪的新属性初始值' })).toHaveValue('100')
    expect(screen.queryByRole('menuitem', { name: '最小值：0' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: '最大值：100' })).toBeNull()

    fireEvent.change(screen.getByRole('textbox', { name: '小怪的新属性 ID' }), {
      target: { value: 'lifeNow' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: '小怪的新属性显示名' }), {
      target: { value: '生命值' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: '小怪的新属性初始值' }), {
      target: { value: '88' },
    })
    fireEvent.click(screen.getByRole('menuitem', { name: '确认创建并选择' }))

    expect(screen.getByTestId('entities-state')).toHaveTextContent(
      '"attrs":{"attack":20,"defense":10,"hp":30,"lifeNow":88}',
    )
    expect(screen.getByTestId('entities-state')).toHaveTextContent(
      '"lifeNow":{"label":"生命值","initial":88,"min":0,"max":100}',
    )
    expect(latestValues.current).toMatchObject({ expr: 'entity.boss.attr.lifeNow' })
    expect(onChange).toHaveBeenCalled()
  })

  it('offers a confirmed entity setup for an hp label when the entity catalog is empty', () => {
    let latestValues: Record<string, unknown> = { label: '敌方', current: 0, max: 100 }
    function Harness(): JSX.Element {
      const [entities, setEntities] = useState<Record<string, Entity>>({})
      const [values, setValues] = useState<Record<string, unknown>>(latestValues)
      latestValues = values
      return (
        <>
          <ComponentFormFields
            componentId="BattleEnemyHpBar"
            values={values}
            pickers={{ entities }}
            onCreateEntity={(request) => {
              setEntities((current) => ensureEntity(current, request))
            }}
            onChange={setValues}
          />
          <output data-testid="entities-state">{JSON.stringify(entities)}</output>
        </>
      )
    }
    render(<Harness />)

    const labelPicker = within(screen.getByText('显示名').parentElement!)
      .getByRole('combobox', { name: '文本内容' })
    chooseCascade(labelPicker, '实体', '配置「敌方」实体')

    expect(screen.getByRole('textbox', { name: '新实体 ID' })).toHaveValue('ent-boss')
    expect(screen.getByRole('textbox', { name: '新实体显示名' })).toHaveValue('敌方')
    expect(screen.queryByRole('textbox', { name: '新实体类型' })).toBeNull()

    fireEvent.change(screen.getByRole('textbox', { name: '新实体 ID' }), {
      target: { value: 'enemy-chief' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: '新实体显示名' }), {
      target: { value: '首领' },
    })
    fireEvent.click(screen.getByRole('menuitem', { name: '确认创建并选择' }))

    expect(screen.getByTestId('entities-state')).toHaveTextContent(
      '"enemy-chief":{"id":"enemy-chief","name":"首领","attrs":{},"attrMeta":{}}',
    )
    expect(latestValues.label).toEqual({ ref: 'entity.enemy-chief.name' })
  })

  it('creates an entity and the required hp property from an empty catalog', () => {
    let latestValues: Record<string, unknown> = { label: '敌方', current: 0, max: 100 }
    function Harness(): JSX.Element {
      const [entities, setEntities] = useState<Record<string, Entity>>({})
      const [values, setValues] = useState<Record<string, unknown>>(latestValues)
      latestValues = values
      return (
        <>
          <ComponentFormFields
            componentId="BattleEnemyHpBar"
            values={values}
            pickers={{ entities }}
            onCreateEntity={(request) => {
              setEntities((current) => ensureEntity(current, request))
            }}
            onCreateEntityAttribute={(request) => {
              setEntities((current) => ensureEntityAttribute(current, request) ?? current)
            }}
            onChange={setValues}
          />
          <output data-testid="entities-state">{JSON.stringify(entities)}</output>
        </>
      )
    }
    render(<Harness />)

    const hpPicker = within(screen.getByText('血量').parentElement!)
      .getByRole('combobox', { name: '数值内容' })
    chooseCascade(hpPicker, '实体属性', '配置「敌方」实体')

    expect(screen.getByRole('textbox', { name: '新实体 ID' })).toHaveValue('ent-boss')
    expect(screen.getByRole('textbox', { name: '新实体显示名' })).toHaveValue('敌方')
    expect(screen.queryByRole('textbox', { name: '新实体类型' })).toBeNull()
    expect(screen.getByRole('textbox', { name: '新属性 ID' })).toHaveValue('hp')
    expect(screen.getByRole('textbox', { name: '新属性显示名' })).toHaveValue('当前血量')
    expect(screen.getByRole('textbox', { name: '新属性初始值' })).toHaveValue('100')
    expect(screen.queryByRole('menuitem', { name: '最小值：0' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: '最大值：100' })).toBeNull()

    fireEvent.change(screen.getByRole('textbox', { name: '新实体 ID' }), {
      target: { value: 'enemy-boss' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: '新实体显示名' }), {
      target: { value: '魔王' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: '新属性 ID' }), {
      target: { value: 'vitality' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: '新属性显示名' }), {
      target: { value: '生命值' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: '新属性初始值' }), {
      target: { value: '90' },
    })
    fireEvent.click(screen.getByRole('menuitem', { name: '确认创建并选择' }))

    expect(screen.getByTestId('entities-state')).toHaveTextContent(
      '"enemy-boss":{"id":"enemy-boss","name":"魔王","attrs":{"vitality":90}',
    )
    expect(screen.getByTestId('entities-state')).toHaveTextContent(
      '"vitality":{"label":"生命值","initial":90,"min":0,"max":100}',
    )
    expect(latestValues.current).toMatchObject({ expr: 'entity.enemy-boss.attr.vitality' })
  })

  it('uses the dynamic text picker for subtitle speaker only', () => {
    const onChange = vi.fn()
    render(
      <ComponentFormFields
        componentId="Dialogue"
        values={{}}
        pickers={{
          entities: {
            hero: { id: 'hero', name: '空藏', attrs: { hp: 80 } },
          },
          variables: {
            qi: { id: 'qi', name: '气力', initial: 3 },
          },
        }}
        onChange={onChange}
      />,
    )

    const pickers = screen.getAllByRole('combobox', { name: '文本内容' })
    expect(pickers).toHaveLength(1)
    chooseCascade(pickers[0]!, '实体', '空藏', '名称')
    expect(onChange).toHaveBeenCalledWith({
      speaker: { ref: 'entity.hero.name' },
    })
  })
})
