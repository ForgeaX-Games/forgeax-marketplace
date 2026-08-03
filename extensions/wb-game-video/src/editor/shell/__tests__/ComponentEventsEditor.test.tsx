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
    fireEvent.click(screen.getByRole('button', { name: '＋ 效果' }))
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

    const content = screen.getByRole('combobox', { name: '数值内容' })
    expect(content.querySelector('option[value="formula:formula-damage"]')).toBeTruthy()
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

  it('keeps the design canvas fixed at 80% and clips content to it', async () => {
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

    await waitFor(() => expect(screen.getByLabelText('覆盖物画布 宽%')).toHaveValue(80))
    expect(screen.getByLabelText('覆盖物画布 高%')).toHaveValue(80)
    expect(screen.queryByRole('button', { name: /调整dialogue大小/ })).toBeNull()
    expect(document.querySelectorAll('[data-overflow-child]')).toHaveLength(0)
    expect((document.querySelector('[data-overlay-content-clip]') as HTMLElement).style.clipPath).toContain('inset(')
    expect(document.querySelector('[data-overlay-design-canvas]')).toHaveStyle({
      left: '10%', top: '10%', width: '80%', height: '80%',
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
    const currentField = screen.getByText('当前血量').parentElement!
    expect(screen.getByText(/不能增删组件或调整组件大小/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /调整BattlePlayerHpBar大小/ })).toBeNull()
    expect(currentField.style.gridTemplateColumns).toBe('4em minmax(0, 1fr)')
    expect(currentField.style.columnGap).toBe('8px')
    expect(currentField.style.fontSize).toBe('11px')
    const modeRow = screen.getByRole('radiogroup', { name: '血量方式' }).parentElement!
    expect(modeRow.style.gridTemplateColumns).toBe('4em minmax(0, 1fr)')
    expect(screen.getByRole('radio', { name: '分别设置' })).toHaveAttribute('aria-checked', 'true')
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
        onReactionsChange={onReactionsChange}
      />,
    )
    expect((screen.getByTestId('overlay-event-editor') as HTMLFieldSetElement).disabled).toBe(false)
    expect(screen.getByText('choice:ying')).toBeTruthy()
    const effectButtons = screen.getAllByRole('button', { name: '＋ 效果' })
    const spawnButtons = screen.getAllByRole('button', { name: '＋ 生成组件' })
    expect(effectButtons[0]).not.toBeDisabled()
    expect(spawnButtons[0]).not.toBeDisabled()
    fireEvent.click(effectButtons[0]!)
    expect(onReactionsChange).toHaveBeenCalled()
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
    fireEvent.change(screen.getByRole('combobox', { name: '数值内容' }), {
      target: { value: `formula:${formula.id}` },
    })
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

  it('shows inferred state content without rewriting the stored expression', () => {
    const onChange = vi.fn()
    render(
      <ComponentFormFields
        componentId="DamageFloatText"
        values={{ value: { expr: 'entity.hero.attr.hp' } }}
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

    expect(screen.getByRole('combobox', { name: '数值内容' })).toHaveValue('entity:hero:hp')
    expect(screen.getByText(/常量：10 · 状态：entity\.hero\.attr\.hp \/ var\.qi/)).toBeTruthy()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('switches hp bars between bound and custom value modes', () => {
    const onChange = vi.fn()
    let latest: Record<string, unknown> = {}
    function Harness(): JSX.Element {
      const [values, setValues] = useState<Record<string, unknown>>({})
      latest = values
      return (
        <ComponentFormFields
          componentId="BattlePlayerHpBar"
          values={values}
          pickers={{
            entities: {
              'ent-player': {
                id: 'ent-player',
                name: '空藏',
                attrs: { hp: 80, hpMax: 100 },
              },
            },
          }}
          onChange={(next) => {
            setValues(next)
            onChange(next)
          }}
        />
      )
    }
    render(<Harness />)

    expect(screen.getByRole('radio', { name: '绑定属性' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('绑定对象')).toBeTruthy()
    expect(screen.queryByText('当前血量')).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: '分别设置' }))

    const currentField = screen.getByText('当前血量').parentElement!
    const maxField = screen.getByText('最大血量').parentElement!
    const qiField = screen.getByText('当前气力').parentElement!
    const qiMaxField = screen.getByText('气力上限').parentElement!
    const labelField = screen.getByText('显示名').parentElement!
    const current = within(currentField).getByRole('combobox', { name: '数值内容' })
    expect(currentField.style.display).toBe('grid')
    expect(currentField.style.gridTemplateColumns).toBe('max-content minmax(0, 1fr)')
    expect(currentField.style.flexBasis).toBe('100%')
    expect(maxField.style.flexBasis).toBe('100%')
    expect(qiField.style.flexBasis).toBe('100%')
    expect(qiMaxField.style.flexBasis).toBe('100%')
    expect(labelField.style.flexBasis).toBe('100%')
    expect(labelField.compareDocumentPosition(currentField) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByText('绑定对象')).toBeNull()
    expect(current).toHaveValue('entity:ent-player:hp')
    expect(within(maxField).getByRole('combobox', { name: '数值内容' })).toHaveValue('entity:ent-player:hpMax')
    expect(within(qiField).getByRole('combobox', { name: '数值内容' })).toHaveValue('empty')
    expect(within(qiMaxField).getByRole('combobox', { name: '数值内容' })).toHaveValue('const')
    expect(within(labelField).getByRole('combobox', { name: '文本内容' })).toHaveValue('literal')
    expect(latest.current).toBeTruthy()
    expect(latest.max).toBeTruthy()

    fireEvent.click(screen.getByRole('radio', { name: '绑定属性' }))
    expect(latest.current).toBeUndefined()
    expect(latest.max).toBeUndefined()
    expect(screen.getByText('绑定对象')).toBeTruthy()
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('lists configured properties and repairs the property when the bound object changes', () => {
    const onChange = vi.fn()
    let latest: Record<string, unknown> = {}
    function Harness(): JSX.Element {
      const [values, setValues] = useState<Record<string, unknown>>({})
      latest = values
      return (
        <ComponentFormFields
          componentId="BattlePlayerHpBar"
          values={values}
          pickers={{
            entities: {
              'ent-player': {
                id: 'ent-player',
                name: '默认角色',
                attrs: { hp: 80 },
              },
              hero: {
                id: 'hero',
                name: '自定义角色',
                attrs: { rage: 12 },
                attrMeta: { stamina: { label: '耐力', initial: 20 } },
              },
              boss: {
                id: 'boss',
                name: '首领',
                attrs: { hp: 200 },
              },
            },
          }}
          onChange={(next) => {
            latest = next
            setValues(next)
            onChange(next)
          }}
        />
      )
    }
    render(<Harness />)

    const entity = screen.getByRole('combobox', { name: '绑定对象' })
    const attr = screen.getByRole('combobox', { name: '绑定属性' })
    expect(entity).toHaveValue('ent-player')
    expect(attr).toHaveValue('hp')

    fireEvent.change(entity, { target: { value: 'hero' } })
    expect(latest).toEqual({ bind: 'hero', attr: 'rage' })
    expect(attr).toHaveValue('rage')
    expect(within(attr).getByRole('option', { name: 'rage' })).toBeTruthy()
    expect(within(attr).getByRole('option', { name: '耐力（stamina）' })).toBeTruthy()

    fireEvent.change(attr, { target: { value: 'stamina' } })
    expect(latest).toEqual({ bind: 'hero', attr: 'stamina' })

    fireEvent.change(entity, { target: { value: 'boss' } })
    expect(latest).toEqual({ bind: 'boss' })
    expect(attr).toHaveValue('hp')
    expect(onChange).toHaveBeenCalledTimes(3)
  })

  it('shows the new hp bar default property when the entity catalog has no attributes', () => {
    render(
      <ComponentFormFields
        componentId="BattlePlayerHpBar"
        values={{}}
        pickers={{ entities: {} }}
        onChange={vi.fn()}
      />,
    )

    const attr = screen.getByRole('combobox', { name: '绑定属性' })
    expect(attr).toHaveValue('hp')
    expect(within(attr).getByRole('option', { name: 'hp（未在对象中声明）' })).toBeTruthy()
  })

  it('removes the undeclared marker when hp is added to the bound object', () => {
    function Harness(): JSX.Element {
      const [entities, setEntities] = useState<Record<string, Entity>>({
        'ent-player': { id: 'ent-player', name: '主角', attrs: {} },
      })
      return (
        <>
          <button
            type="button"
            onClick={() => setEntities({
              'ent-player': { ...entities['ent-player']!, attrs: { hp: 100 } },
            })}
          >
            添加 hp
          </button>
          <ComponentFormFields
            componentId="BattlePlayerHpBar"
            values={{}}
            pickers={{ entities }}
            onChange={vi.fn()}
          />
        </>
      )
    }
    render(<Harness />)

    const attr = screen.getByRole('combobox', { name: '绑定属性' })
    expect(within(attr).getByRole('option', { name: 'hp（未在对象中声明）' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '添加 hp' }))

    expect(within(attr).getByRole('option', { name: 'hp' })).toBeTruthy()
    expect(within(attr).queryByRole('option', { name: 'hp（未在对象中声明）' })).toBeNull()
  })

  it('uses the dynamic text picker for subtitle speaker and text', () => {
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
    expect(pickers).toHaveLength(2)
    fireEvent.change(pickers[0]!, { target: { value: 'entity-name:hero' } })
    expect(onChange).toHaveBeenCalledWith({
      speaker: { ref: 'entity.hero.name' },
    })
  })
})
