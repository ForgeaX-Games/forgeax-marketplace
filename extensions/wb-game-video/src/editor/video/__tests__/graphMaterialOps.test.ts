import { beforeAll, describe, expect, it } from 'vitest'
import type { GameNode, GameScenario } from '../../../runtime/schema/graph-schema'
import type { OverlayChild } from '../../../runtime/schema/node-config-schema'
import type { QteCue } from '../../../runtime/skins/components/Qte'
import { registerCoreSkins } from '../../../runtime/skins/components'
import { node, scnOf } from '../../../runtime/__tests__/test-fixtures'
import { nodeOverlayId } from '../../../graph/edit/overlay-edit'
import {
  activePreviewOverlaysFromNode,
  addMaterialGraph,
  addQteCueGraph,
  choiceElement,
  collectMaterialsFromNode,
  findElement,
  findNode,
  listAvailableQteOutcomes,
  listSchemeMountTabs,
  listQteOutcomeViews,
  overlayEffects,
  addOptionBranchGraph,
  componentEventsLocked,
  choiceSkinPreviewInteractions,
  listOptionBranches,
  patchMaterialGraph,
  patchOverlayGraph,
  patchOverlayPositionGraph,
  patchSelectedGraph,
  previewSkinChildrenInWindow,
  qteSkinPreviewInteraction,
  clampSettlementSpawnTtlMs,
  removeOptionBranchGraph,
  setOptionBranchEffectsGraph,
  setOptionBranchSpawnGraph,
  setQteOutcomeEffectsGraph,
  setQteOutcomeSpawnGraph,
  setQteOutcomeTargetGraph,
} from '../graphMaterialOps'
import type { MaterialItem } from '../materialTimelineShared'

// `hasCuePointsInput`/`hasOptionEventsInput`（editors）按组件 inputs 结构判定，任何用到
// qteElement/choiceElement 的用例都需要先注册核心组件——放在文件级 beforeAll。
beforeAll(() => {
    registerCoreSkins()
})

function qteEl(scenario: GameScenario, nodeId: string): OverlayChild | undefined {
  return scenario.ui?.overlays?.[nodeOverlayId(nodeId)]?.children?.find(
    (c) => c.component === 'qte' || c.component === 'battleParry' || c.component === 'inkKou',
  )
}
function qteItem(cueId: string): MaterialItem {
  return { key: `qte:x:${cueId}`, id: cueId, kind: 'qte', label: '', startMs: 0, endMs: 1000, zIndex: 2 }
}

function seedQte(): { scenario: GameScenario; node: GameNode; cueId: string } {
  const n = node('a', { durationMs: 8000 })
  let scenario = scnOf({ nodes: [n], edges: [] })
  const nodeRef = scenario.graph.nodes[0]!
  const res = addQteCueGraph(scenario, nodeRef, 8000, 1000)
  scenario = res.scenario
  const cueId = res.selectKey!.split(':').pop()!
  return { scenario, node: scenario.graph.nodes[0]!, cueId }
}

/**
 * `addQteCueGraph` 新建时固定 inkKou 皮肤（不再吃 styleScheme/皮肤下拉切换）——
 * 测其它皮肤（battleParry / 泛用 qte）时直接就地改写已建元素的顶层 `component`，
 * 绕开创建流程，只测样式锁定/结算这些仍然真实存在的读逻辑。
 */
function seedQteSkin(component: string, extraInputs: Record<string, unknown> = {}): { scenario: GameScenario; node: GameNode; cueId: string } {
  const base = seedQte()
  const el = qteEl(base.scenario, 'a')!
  const overlayId = nodeOverlayId('a')
  const overlay = base.scenario.ui!.overlays![overlayId]!
  const scenario: GameScenario = {
    ...base.scenario,
    ui: {
      ...base.scenario.ui,
      overlays: {
        ...base.scenario.ui!.overlays,
        [overlayId]: {
          ...overlay,
          children: overlay.children.map((c) =>
            c.id === el.id ? { ...c, component, inputs: { ...c.inputs, ...extraInputs } } : c,
          ),
        },
      },
    },
  }
  return { scenario, node: findNode(scenario.graph, 'a')!, cueId: base.cueId }
}

describe('graphMaterialOps · QTE 元素级参数', () => {
  it('完美判定 perfectMs 落到元素级 inputs，不写进 cue（成功=命中显示窗内，无独立半窗）', () => {
    const { scenario, node: n, cueId } = seedQte()
    const next = patchSelectedGraph(scenario, n, qteItem(cueId), { perfectMs: 100 })
    const el = qteEl(next, 'a')!
    expect((el.inputs as { perfectMs?: number }).perfectMs).toBe(100)
    const cue = ((el.inputs as { cues?: QteCue[] }).cues ?? []).find((c) => c.id === cueId)!
    expect((cue as { perfectMs?: number }).perfectMs).toBeUndefined()
  })

  it('cue 级参数（label/appearAt）仍写进对应拍点，不污染元素级', () => {
    const { scenario, node: n, cueId } = seedQte()
    const next = patchSelectedGraph(scenario, n, qteItem(cueId), { label: '叩', appearAt: 1200 })
    const el = qteEl(next, 'a')!
    const cue = ((el.inputs as { cues?: QteCue[] }).cues ?? []).find((c) => c.id === cueId)!
    expect(cue.label).toBe('叩')
    expect(cue.appearAt).toBe(1200)
    expect((el.inputs as { label?: unknown }).label).toBeUndefined()
  })
})

describe('graphMaterialOps · QTE 结算候选（样式驱动，见 qteComponent.outputs）', () => {
  beforeAll(() => registerCoreSkins())

  it('默认（无自定义 events）：泛用 qte 组件不在样式锁定表里，候选仍是 完美/良好/失败 三档', () => {
    const { scenario, node: n } = seedQteSkin('qte', { events: undefined })
    const views = listQteOutcomeViews(scenario, n)
    expect(views).toHaveLength(1)
    expect(views[0]!.key).toBe('pass')
    expect(views[0]!.label).toBe('完美')
    const available = listAvailableQteOutcomes(scenario, n)
    expect(available.map((c) => c.handle)).toEqual(['good', 'fail'])
  })

  it('battleParry：出口由样式锁定为皮肤 defaults；写入的自定义 events 被忽略', () => {
    const { scenario, node: n, cueId } = seedQteSkin('battleParry')
    const next = patchSelectedGraph(scenario, n, qteItem(cueId), {
      events: [{ id: 'ok', label: '自定义' }, { id: 'ng', label: '普通' }],
      defaultEvent: 'fail',
    })
    const n2 = findNode(next.graph, 'a')!
    const el = qteEl(next, 'a')!
    // 落盘也被锁回 battleParryDefaults.events
    expect((el.inputs as { events?: Array<{ id: string; label?: string }> }).events?.map((e) => e.id)).toEqual([
      'pass',
      'good',
      'fail',
    ])
    expect((el.inputs as { events?: Array<{ id: string; label?: string }> }).events?.map((e) => e.label)).toEqual([
      '防反',
      '闪避',
      '受击',
    ])
    const available = listAvailableQteOutcomes(next, n2)
    expect(available.map((c) => c.handle)).toEqual(['good', 'fail'])
    const shown = listQteOutcomeViews(next, n2)
    expect(shown.map((v) => v.key)).toEqual(['pass'])
    expect(shown[0]!.label).toBe('防反')
  })

  it('inkKou：出口由样式锁定为 pass/fail；写入的自定义 events 被忽略', () => {
    const { scenario, node: n, cueId } = seedQte()
    const next = patchSelectedGraph(scenario, n, qteItem(cueId), {
      component: 'inkKou',
      events: [{ id: 'a', label: '自定义' }, { id: 'b', label: '普通' }, { id: 'c', label: '多余' }],
      defaultEvent: 'fail',
    })
    const el = qteEl(next, 'a')!
    expect((el.inputs as { events?: Array<{ id: string; label?: string }> }).events?.map((e) => e.id)).toEqual([
      'pass',
      'fail',
    ])
    expect((el.inputs as { events?: Array<{ id: string; label?: string }> }).events?.map((e) => e.label)).toEqual([
      '完美',
      '失败',
    ])
  })

  it('battleParry 样式出口上可对某一档单独配跳转 + 改数值，互不覆盖', () => {
    const { scenario: s0, node: n0 } = seedQteSkin('battleParry')
    const s1 = setQteOutcomeTargetGraph(s0, n0, 'pass', 'b')
    const n1 = findNode(s1.graph, 'a')!
    const s2 = setQteOutcomeEffectsGraph(s1, n1, 'good', [{ kind: 'attr', entityId: 'ent-boss', attr: 'hp', op: 'add', value: -10 }])
    const n2 = findNode(s2.graph, 'a')!
    const views = listQteOutcomeViews(s2, n2)
    const pass = views.find((v) => v.key === 'pass')!
    const good = views.find((v) => v.key === 'good')!
    expect(pass.targetId).toBe('b')
    expect(pass.effects).toHaveLength(0)
    expect(good.targetId).toBeUndefined()
    expect(good.effects).toHaveLength(1)
  })

  it('QTE 结算 spawn：ttl 截断到节点时长；写 effects 不冲掉 spawn', () => {
    expect(clampSettlementSpawnTtlMs(99999, 8000)).toBe(8000)
    expect(clampSettlementSpawnTtlMs(0, 8000)).toBe(8000)
    const { scenario: s0, node: n0 } = seedQteSkin('battleParry')
    const withScheme = {
      ...s0,
      ui: {
        ...s0.ui,
        overlays: {
          ...(s0.ui?.overlays ?? {}),
          'scheme-dynamic': {
            id: 'scheme-dynamic',
            children: [{ id: 'float', component: 'floatText', trigger: { when: 'enter' as const }, inputs: { text: '+1' } }],
          },
        },
      },
    }
    const s1 = setQteOutcomeSpawnGraph(withScheme, n0, 'pass', {
      from: 'scheme-dynamic/float',
      ttlMs: 99_000,
      inputs: { text: '爆' },
    })
    const n1 = findNode(s1.graph, 'a')!
    const view1 = listQteOutcomeViews(s1, n1).find((v) => v.key === 'pass')!
    expect(view1.spawn?.from).toBe('scheme-dynamic/float')
    expect(view1.spawn?.ttlMs).toBe(8000)
    expect(view1.spawn?.inputs).toEqual({ text: '爆' })
    const s2 = setQteOutcomeEffectsGraph(s1, n1, 'pass', [
      { kind: 'attr', entityId: 'ent-boss', attr: 'hp', op: 'add', value: -1 },
    ])
    const n2 = findNode(s2.graph, 'a')!
    const view2 = listQteOutcomeViews(s2, n2).find((v) => v.key === 'pass')!
    expect(view2.effects).toHaveLength(1)
    expect(view2.spawn?.from).toBe('scheme-dynamic/float')
  })
})

describe('graphMaterialOps · QTE 新建（默认样式固定为叩击 inkKou，无需门槛）', () => {
  it('节点无挂载、无默认样式方案：仍可直接新建，落盘为固定 inkKou 皮肤', () => {
    const n = node('a', { durationMs: 8000 })
    const scenario = scnOf({ nodes: [n], edges: [] })
    const nodeRef = scenario.graph.nodes[0]!
    const res = addMaterialGraph(scenario, nodeRef, 8000, 'qte', undefined, 0)
    expect(res.selectKey).not.toBeNull()
    const el = qteEl(res.scenario, 'a')
    expect(el).toBeDefined()
    expect(el!.component).toBe('inkKou')
    expect(el!.layout).toMatchObject({ left: 0, top: 0, width: 1, height: 1 })
    expect((el!.inputs as { defaultEvent?: string }).defaultEvent).toBe('fail')
  })

  it('新建 inkKou 仍归为 qte 时间轴槽（看 cues 结构，不看字面 component === qte）', () => {
    const n = node('a', { durationMs: 8000 })
    const scenario = scnOf({ nodes: [n], edges: [] })
    const nodeRef = scenario.graph.nodes[0]!
    const res = addMaterialGraph(scenario, nodeRef, 8000, 'qte', undefined, 0)
    const n1 = findNode(res.scenario.graph, 'a')!
    const mats = collectMaterialsFromNode(res.scenario, n1, 8000)
    const el = qteEl(res.scenario, 'a')!
    const item = mats.find((m) => m.key.startsWith(`qte:${el.id}:`))
    expect(item?.kind).toBe('qte')
    expect(item?.componentId).toBe('inkKou')
  })
})

describe('graphMaterialOps · battleParry 时间轴 ↔ 预览时钟对齐', () => {
  /**
   * 直接构造一个已挂载的 battleParry qte 元素（不再走 addQteCueGraph 的创建路径——
   * 新建固定 inkKou，battleParry 只能是已有元素），带一个 windowMs 时长的 cue。
   */
  function seedBattleParryQte(appearAt: number, windowMs: number): { scenario: GameScenario; node: GameNode; cueId: string } {
    const n = node('a', { durationMs: 8000 })
    const cueId = 'q-parry'
    const scenario = scnOf(
      { nodes: [n], edges: [] },
      {
        ui: {
          overlays: {
            'node:a': {
              id: 'node:a',
              children: [
                {
                  id: 'qte-parry',
                  component: 'battleParry',
                  trigger: { when: 'enter' },
                  inputs: {
                    windowMs,
                    events: [{ id: 'pass' }, { id: 'good' }, { id: 'fail' }],
                    defaultEvent: 'fail',
                    cues: [{ id: cueId, shape: 'tap', appearAt, targetAt: appearAt + Math.round(windowMs / 2), endAt: appearAt + windowMs, zIndex: 2 }],
                  },
                },
              ],
            },
          },
        },
      },
    )
    const withMount: GameScenario = {
      ...scenario,
      graph: {
        ...scenario.graph,
        nodes: scenario.graph.nodes.map((nd) =>
          nd.id === 'a' ? { ...nd, data: { ...nd.data, overlayNodes: [{ overlay: 'node:a' }] } } : nd,
        ),
      },
    }
    return { scenario: withMount, node: findNode(withMount.graph, 'a')!, cueId }
  }

  it('battleParry 元素已存在时，追加按键点保留皮肤与既有 windowMs（新建按钮固定走 inkKou，不再回到这里选皮肤）', () => {
    const { scenario, node: n } = seedBattleParryQte(1000, 2600)
    const res = addQteCueGraph(scenario, n, 8000, 5000)
    const el = qteEl(res.scenario, 'a')!
    expect(el.component).toBe('battleParry')
    expect((el.inputs as { windowMs?: number }).windowMs).toBe(2600)
    expect((el.inputs as { cues?: QteCue[] }).cues).toHaveLength(2)
  })

  it('拖时间轴边缘：只改 cue 窗（appearAt/endAt 即时长 SSOT），不再另外维护 windowMs 影子字段', () => {
    const { scenario, node: n, cueId } = seedBattleParryQte(1000, 2600)
    const item: MaterialItem = {
      key: `qte:x:${cueId}`,
      id: cueId,
      kind: 'qte',
      label: '',
      startMs: 1000,
      endMs: 3600,
      zIndex: 2,
    }
    const next = patchMaterialGraph(scenario, n, 8000, item, { startMs: 1500, endMs: 3000 })
    const el = qteEl(next, 'a')!
    const cue = ((el.inputs as { cues?: QteCue[] }).cues ?? []).find((c) => c.id === cueId)!
    expect(cue.appearAt).toBe(1500)
    expect(cue.endAt).toBe(3000)
    // 旧的 windowMs 影子字段维持原值（不再被拖拽同步）——运行时已改成直接读 cue.appearAt/endAt，
    // 不会再看这个字段，留着不影响正确性。
    expect((el.inputs as { windowMs?: number }).windowMs).toBe(2600)
  })

  it('qteSkinPreviewInteraction：播放头在 cue 窗外返回 null，窗内返回 snap', () => {
    const { scenario, node: n } = seedBattleParryQte(2000, 2600)
    expect(qteSkinPreviewInteraction(scenario, n, 500)).toBeNull()
    expect(qteSkinPreviewInteraction(scenario, n, 2500)).not.toBeNull()
    expect(qteSkinPreviewInteraction(scenario, n, 5000)).toBeNull()
  })
})

describe('graphMaterialOps · choice 皮肤时间轴预览', () => {
  beforeAll(() => registerCoreSkins())

  it('inkYingMo 顶层组件：播放头窗内可预览、窗外卸掉', () => {
    const n = node('a', { durationMs: 8000 })
    const scenario = scnOf(
      { nodes: [n], edges: [] },
      {
        ui: {
          overlays: {
            'node:a': {
              id: 'node:a',
              children: [
                {
                  id: 'choice-ym',
                  component: 'inkYingMo',
                  trigger: { when: 'enter' },
                  window: { startMs: 1000, endMs: 3500 },
                  inputs: { events: [{ id: 'ying', label: '應' }, { id: 'mo', label: '默' }] },
                },
              ],
            },
          },
        },
      },
    )
    const withMount: GameScenario = {
      ...scenario,
      graph: {
        ...scenario.graph,
        nodes: scenario.graph.nodes.map((nd) =>
          nd.id === 'a' ? { ...nd, data: { ...nd.data, overlayNodes: [{ overlay: 'node:a' }] } } : nd,
        ),
      },
    }
    const n1 = findNode(withMount.graph, 'a')!
    const el = choiceElement(withMount, n1)
    expect(el).toBeDefined()
    expect(el!.component).toBe('inkYingMo')
    expect((el!.inputs as { events?: { id: string }[] }).events?.map((o) => o.id)).toEqual(['ying', 'mo'])
    expect(el!.window).toEqual({ startMs: 1000, endMs: 3500 })

    expect(choiceSkinPreviewInteractions(withMount, n1, 500, 8000)).toHaveLength(0)
    const snaps = choiceSkinPreviewInteractions(withMount, n1, 2000, 8000)
    expect(snaps).toHaveLength(1)
    expect(snaps[0]!.component).toBe('inkYingMo')
    expect(choiceSkinPreviewInteractions(withMount, n1, 5000, 8000)).toHaveLength(0)
  })

  it('默认清单（无皮肤 component）：不进预览皮肤层', () => {
    const n = node('a', { durationMs: 8000 })
    let scenario = scnOf({ nodes: [n], edges: [] })
    const res = addMaterialGraph(scenario, scenario.graph.nodes[0]!, 8000, 'option', undefined, 0)
    const n1 = findNode(res.scenario.graph, 'a')!
    expect(choiceSkinPreviewInteractions(res.scenario, n1, 100, 8000)).toHaveLength(0)
  })

  it('新建选项落盘 STAGE_FILL + defaultEvent=opt0（试玩与超时 emit 对齐）', () => {
    const n = node('a', { durationMs: 8000 })
    const scenario = scnOf({ nodes: [n], edges: [] })
    const res = addMaterialGraph(scenario, scenario.graph.nodes[0]!, 8000, 'option', undefined, 0)
    const el = choiceElement(res.scenario, findNode(res.scenario.graph, 'a')!)
    expect(el).toBeDefined()
    expect(el!.layout).toMatchObject({ left: 0, top: 0, width: 1, height: 1 })
    expect((el!.inputs as { defaultEvent?: string }).defaultEvent).toBe('opt0')
  })

  it('选项预览可拖空间锚点：movable + 写回 inputs.x/y', () => {
    const n = node('a', { durationMs: 8000 })
    let scenario = scnOf({ nodes: [n], edges: [] })
    const res = addMaterialGraph(scenario, scenario.graph.nodes[0]!, 8000, 'option', undefined, 0)
    const n1 = findNode(res.scenario.graph, 'a')!
    const overlays = activePreviewOverlaysFromNode(res.scenario, n1, 100, 8000)
    const opt = overlays.find((o) => o.kind === 'option')
    expect(opt?.movable).toBe(true)
    expect(opt?.target).toEqual({ kind: 'element', elementId: expect.any(String) })
    const next = patchOverlayPositionGraph(res.scenario, n1, opt!.target, 0.33, 0.44)
    const el = next.ui?.overlays?.[nodeOverlayId('a')]?.children?.find((c) => c.id === (opt!.target as { elementId: string }).elementId)
    expect((el?.inputs as { x?: number; y?: number }).x).toBe(0.33)
    expect((el?.inputs as { x?: number; y?: number }).y).toBe(0.44)
    const moved = activePreviewOverlaysFromNode(next, findNode(next.graph, 'a')!, 100, 8000).find((o) => o.kind === 'option')
    expect(moved?.x).toBe(0.33)
    expect(moved?.y).toBe(0.44)
  })

  it('选项结算 spawn：与改数值并存，ttl 截断到节点时长', () => {
    const n = node('a', { durationMs: 5000 })
    let scenario = scnOf({ nodes: [n], edges: [] }, {
      ui: {
        overlays: {
          'scheme-dynamic': {
            id: 'scheme-dynamic',
            children: [{ id: 'float', component: 'floatText', trigger: { when: 'enter' }, inputs: { text: '+30' } }],
          },
        },
      },
    })
    const res = addMaterialGraph(scenario, scenario.graph.nodes[0]!, 5000, 'option', undefined, 0)
    const n1 = findNode(res.scenario.graph, 'a')!
    const key = listOptionBranches(res.scenario, n1)[0]!.key
    const s1 = setOptionBranchSpawnGraph(res.scenario, n1, key, { from: 'scheme-dynamic/float', ttlMs: 50_000 })
    const n2 = findNode(s1.graph, 'a')!
    const s2 = setOptionBranchEffectsGraph(s1, n2, key, [
      { kind: 'attr', entityId: 'ent-boss', attr: 'hp', op: 'add', value: -10 },
    ])
    const n3 = findNode(s2.graph, 'a')!
    const branch = listOptionBranches(s2, n3).find((b) => b.key === key)!
    expect(branch.effects).toHaveLength(1)
    expect(branch.spawn?.from).toBe('scheme-dynamic/float')
    expect(branch.spawn?.ttlMs).toBe(5000)
  })
})

describe('graphMaterialOps · 选项/组件结算统一写 mount.reactions（修复 2026-07-16 误写 node.data.reactions 导致运行时不生效的 bug）', () => {
  it('setOptionBranchEffectsGraph 写进挂载级 reactions（node:<id>），不落 node.data.reactions', () => {
    const n = node('a', { durationMs: 5000 })
    const scenario = scnOf({ nodes: [n], edges: [] })
    const res = addMaterialGraph(scenario, scenario.graph.nodes[0]!, 5000, 'option', undefined, 0)
    const n1 = findNode(res.scenario.graph, 'a')!
    const key = listOptionBranches(res.scenario, n1)[0]!.key
    const next = setOptionBranchEffectsGraph(res.scenario, n1, key, [
      { kind: 'attr', entityId: 'ent-boss', attr: 'hp', op: 'add', value: -10 },
    ])
    const n2 = findNode(next.graph, 'a')!
    expect(n2.data.reactions).toBeUndefined()
    const mount = (n2.data.overlayNodes ?? []).find((m) => (m.id ?? m.overlay) === nodeOverlayId('a'))
    expect(mount?.reactions?.some((r) => r.when.type === 'event' && r.when.id === key)).toBe(true)
  })

  it('读兜底：升级前遗留在 node.data.reactions 的旧配置仍能读回，不会静默消失', () => {
    const key = 'opt0'
    const n = node('a', {
      durationMs: 5000,
      reactions: [{
        when: { type: 'event', id: key },
        do: [{ kind: 'effect', effects: [{ kind: 'attr', entityId: 'ent-boss', attr: 'hp', op: 'add', value: -20 }] }],
      }],
    })
    const scenario = scnOf({ nodes: [n], edges: [] })
    const res = addMaterialGraph(scenario, scenario.graph.nodes[0]!, 5000, 'option', undefined, 0)
    const n1 = findNode(res.scenario.graph, 'a')!
    const branch = listOptionBranches(res.scenario, n1).find((b) => b.key === key)
    expect(branch?.effects).toHaveLength(1)
    expect(branch?.effects[0]).toMatchObject({ entityId: 'ent-boss', attr: 'hp', value: -20 })
  })

  it('写入会顺带清理同 key 的 legacy node.data.reactions 残留（不留新旧两处数据）', () => {
    const key = 'opt0'
    const n = node('a', {
      durationMs: 5000,
      reactions: [{
        when: { type: 'event', id: key },
        do: [{ kind: 'effect', effects: [{ kind: 'attr', entityId: 'ent-boss', attr: 'hp', op: 'add', value: -20 }] }],
      }],
    })
    const scenario = scnOf({ nodes: [n], edges: [] })
    const res = addMaterialGraph(scenario, scenario.graph.nodes[0]!, 5000, 'option', undefined, 0)
    const n1 = findNode(res.scenario.graph, 'a')!
    const next = setOptionBranchEffectsGraph(res.scenario, n1, key, [
      { kind: 'attr', entityId: 'ent-boss', attr: 'hp', op: 'add', value: -30 },
    ])
    const n2 = findNode(next.graph, 'a')!
    expect(n2.data.reactions).toBeUndefined()
    const branch = listOptionBranches(next, n2).find((b) => b.key === key)
    expect(branch?.effects[0]).toMatchObject({ value: -30 })
  })
})

describe('graphMaterialOps · 挂载组件全量上时间轴', () => {
  beforeAll(() => {
        registerCoreSkins()
  })

  it('未分类按挂载实例列槽（同类型两份血条各一格）；添加时克隆 bind/label', () => {
    const n = node('a', { durationMs: 8000 })
    const scenario = scnOf(
      { nodes: [n], edges: [] },
      {
        ui: {
          overlays: {
            'ov-a': {
              id: 'ov-a',
              children: [
                {
                  id: 'hp-player',
                  component: 'battleHpBar',
                  trigger: { when: 'enter' },
                  window: { startMs: 0, endMs: 8000 },
                  inputs: { bind: 'ent-player', label: '我方' },
                },
                {
                  id: 'hp-boss',
                  component: 'battleHpBar',
                  trigger: { when: 'enter' },
                  window: { startMs: 0, endMs: 8000 },
                  inputs: { bind: 'ent-boss', label: '敌方' },
                },
                {
                  id: 'fade',
                  component: 'transition',
                  trigger: { when: 'at', ms: 100 },
                  window: { startMs: 100, endMs: 800 },
                  inputs: { durationMs: 600 },
                },
                {
                  id: 'line',
                  component: 'dialogue',
                  trigger: { when: 'enter' },
                  window: { startMs: 0, endMs: 2000 },
                  inputs: { text: '字幕' },
                },
              ],
            },
          },
        },
      },
    )
    const withMount: GameScenario = {
      ...scenario,
      graph: {
        ...scenario.graph,
        nodes: scenario.graph.nodes.map((nd) =>
          nd.id === 'a' ? { ...nd, data: { ...nd.data, overlayNodes: [{ overlay: 'ov-a' }] } } : nd,
        ),
      },
    }
    const nodeA = findNode(withMount.graph, 'a')!
    const mats = collectMaterialsFromNode(withMount, nodeA, 8000)
    expect(mats.filter((m) => m.kind === 'component' && m.componentId === 'battleHpBar')).toHaveLength(2)
    expect(mats.find((m) => m.id === 'hp-player')?.label).toBe('我方')
    expect(mats.find((m) => m.id === 'hp-boss')?.label).toBe('敌方')
    const skinKids = previewSkinChildrenInWindow(withMount, nodeA, 200, 8000)
    expect(skinKids.filter((c) => c.component === 'battleHpBar')).toHaveLength(2)

    const tabs = listSchemeMountTabs(withMount, nodeA)
    expect(tabs.map((t) => t.mountId)).toEqual(['ov-a'])
    const extras = tabs.flatMap((t) => t.components)
    // 按实例：mountId/childId；不按 kind 过滤——方案里的字幕/转场等一律列出。
    expect(extras.map((c) => c.id).sort()).toEqual(['ov-a/fade', 'ov-a/hp-boss', 'ov-a/hp-player', 'ov-a/line'])
    expect(extras.find((c) => c.id === 'ov-a/hp-player')).toEqual({
      id: 'ov-a/hp-player',
      label: '我方',
      componentId: 'battleHpBar',
    })
    expect(extras.find((c) => c.id === 'ov-a/hp-boss')?.label).toBe('敌方')
    expect(extras.find((c) => c.id === 'ov-a/fade')?.label).toBe('转场 · fade')
    expect(listSchemeMountTabs(withMount, undefined)).toEqual([])

    // 从「敌方」模板添加 → 新实例带上 ent-boss / 敌方
    const added = addMaterialGraph(withMount, nodeA, 8000, 'ov-a/hp-boss', undefined, 0)
    const newId = added.selectKey?.replace(/^component:/, '')
    expect(newId).toBeTruthy()
    const cloned = findElement(added.scenario, findNode(added.scenario.graph, 'a')!, newId!)
    expect(cloned?.component).toBe('battleHpBar')
    expect(cloned?.inputs).toMatchObject({ bind: 'ent-boss', label: '敌方' })
  })

  it('第二份挂载的 HUD 方案也进时间轴与预览（不只看 primary 内容挂载）', () => {
    const n = node('a', { durationMs: 8000 })
    const scenario = scnOf(
      { nodes: [n], edges: [] },
      {
        ui: {
          overlays: {
            'node:a': { id: 'node:a', children: [] },
            'scheme-static': {
              id: 'scheme-static',
              children: [
                {
                  id: 'hp-player',
                  component: 'battleHpBar',
                  trigger: { when: 'enter' },
                  inputs: { bind: 'ent-player', label: '我方' },
                },
              ],
            },
          },
        },
      },
    )
    // 内容挂载在前（空），HUD 方案挂第二份——旧逻辑只读 primary 会漏掉血条
    const withMount: GameScenario = {
      ...scenario,
      graph: {
        ...scenario.graph,
        nodes: scenario.graph.nodes.map((nd) =>
          nd.id === 'a'
            ? {
                ...nd,
                data: {
                  ...nd.data,
                  overlayNodes: [{ overlay: 'node:a' }, { overlay: 'scheme-static' }],
                },
              }
            : nd,
        ),
      },
    }
    const nodeA = findNode(withMount.graph, 'a')!
    const mats = collectMaterialsFromNode(withMount, nodeA, 8000)
    expect(mats.some((m) => m.id === 'hp-player' && m.kind === 'component')).toBe(true)
    const skinKids = previewSkinChildrenInWindow(withMount, nodeA, 100, 8000)
    expect(skinKids.some((c) => c.id === 'hp-player' && c.component === 'battleHpBar')).toBe(true)
    const extras = listSchemeMountTabs(withMount, nodeA).flatMap((t) => t.components)
    expect(extras.some((c) => c.id === 'scheme-static/hp-player' && c.label === '我方')).toBe(true)
  })

  it('添加控件额外槽：排除 node:* 本地 children 与 mount.added（不因 override 增生模板卡）', () => {
    const n = node('a', { durationMs: 8000 })
    const scenario = scnOf(
      { nodes: [n], edges: [] },
      {
        ui: {
          overlays: {
            'node:a': {
              id: 'node:a',
              children: [
                {
                  id: 'timeline-hp',
                  component: 'battleHpBar',
                  trigger: { when: 'enter' },
                  inputs: { bind: 'ent-player', label: '时间轴新建' },
                },
              ],
            },
            'scheme-static': {
              id: 'scheme-static',
              children: [
                {
                  id: 'hp-player',
                  component: 'battleHpBar',
                  trigger: { when: 'enter' },
                  inputs: { bind: 'ent-player', label: '我方' },
                },
              ],
            },
          },
        },
      },
    )
    const withMount: GameScenario = {
      ...scenario,
      graph: {
        ...scenario.graph,
        nodes: scenario.graph.nodes.map((nd) =>
          nd.id === 'a'
            ? {
                ...nd,
                data: {
                  ...nd.data,
                  overlayNodes: [
                    { overlay: 'node:a' },
                    {
                      overlay: 'scheme-static',
                      added: [
                        {
                          id: 'hp-added',
                          component: 'battleHpBar',
                          trigger: { when: 'enter' },
                          inputs: { bind: 'ent-boss', label: 'override新增' },
                        },
                      ],
                    },
                  ],
                },
              }
            : nd,
        ),
      },
    }
    const nodeA = findNode(withMount.graph, 'a')!
    const extras = listSchemeMountTabs(withMount, nodeA).flatMap((t) => t.components)
    expect(extras.map((c) => c.id)).toEqual(['scheme-static/hp-player'])
    expect(extras.some((c) => c.id.includes('timeline-hp') || c.id.includes('hp-added'))).toBe(false)
  })
})

describe('graphMaterialOps · choice 顶层组件样式锁定选项集合（创建时定组件，创建后不可切皮肤）', () => {
  beforeAll(() => registerCoreSkins())

  function seedDefaultOption(): { scenario: GameScenario; node: GameNode } {
    const n = node('a', { durationMs: 8000 })
    let scenario = scnOf({ nodes: [n], edges: [] })
    const res = addMaterialGraph(scenario, scenario.graph.nodes[0]!, 8000, 'option', undefined, 0)
    return { scenario: res.scenario, node: findNode(res.scenario.graph, 'a')! }
  }

  /** 挂载一个方案，目录原型里放一个指定皮肤的 choice 组件；克隆它到节点，得到顶层就是该皮肤的实例。 */
  function seedSkinnedOptionFromScheme(
    component: string,
    events: Array<{ id: string; label?: string }>,
  ): { scenario: GameScenario; node: GameNode } {
    const n = node('a', { durationMs: 8000 })
    const scenario = scnOf(
      { nodes: [n], edges: [] },
      {
        ui: {
          overlays: {
            'scheme-choice': {
              id: 'scheme-choice',
              children: [{ id: 'choice-proto', component, trigger: { when: 'enter' }, inputs: { events } }],
            },
          },
        },
      },
    )
    const withMount: GameScenario = {
      ...scenario,
      graph: {
        ...scenario.graph,
        nodes: scenario.graph.nodes.map((nd) =>
          nd.id === 'a' ? { ...nd, data: { ...nd.data, overlayNodes: [{ overlay: 'scheme-choice' }] } } : nd,
        ),
      },
    }
    const nodeRef = findNode(withMount.graph, 'a')!
    const res = addMaterialGraph(withMount, nodeRef, 8000, 'scheme-choice/choice-proto', undefined, 0)
    return { scenario: res.scenario, node: findNode(res.scenario.graph, 'a')! }
  }

  it('默认清单（component: choice）：无样式锁定，可自由增删选项', () => {
    const { scenario, node: n } = seedDefaultOption()
    expect(listOptionBranches(scenario, n)).toHaveLength(1)
    const el = findElement(scenario, n, choiceElement(scenario, n)!.id)!
    expect(componentEventsLocked(el.component)).toBe(false)
    const added = addOptionBranchGraph(scenario, n)
    expect(listOptionBranches(added, findNode(added.graph, 'a')!)).toHaveLength(2)
  })

  it('inkYingMo 顶层组件：克隆自方案后结算条数固定為應/默两条，样式锁定为真', () => {
    const { scenario, node: n } = seedSkinnedOptionFromScheme('inkYingMo', [
      { id: 'ying', label: '應' },
      { id: 'mo', label: '默' },
    ])
    const branches = listOptionBranches(scenario, n)
    expect(branches.map((b) => b.key)).toEqual(['ying', 'mo'])
    expect(branches.map((b) => b.label)).toEqual(['應', '默'])
    const el = choiceElement(scenario, n)!
    expect(el.component).toBe('inkYingMo')
    expect(componentEventsLocked(el.component)).toBe(true)
  })

  it('battleSkillBar 顶层组件：样式锁定后 addOptionBranchGraph/removeOptionBranchGraph 为 no-op', () => {
    const events = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }]
    const { scenario, node: n } = seedSkinnedOptionFromScheme('battleSkillBar', events)
    expect(listOptionBranches(scenario, n)).toHaveLength(3)
    const afterAdd = addOptionBranchGraph(scenario, n)
    expect(listOptionBranches(afterAdd, findNode(afterAdd.graph, 'a')!)).toHaveLength(3)
    const afterRemove = removeOptionBranchGraph(scenario, n, 'a')
    expect(listOptionBranches(afterRemove, findNode(afterRemove.graph, 'a')!)).toHaveLength(3)
  })

  it('回归：方案目录里的皮肤原型缺 inputs（老数据/手改 JSON）时，克隆出的实例仍按皮肤 defaults 补全出口，不会退化成空/泛用选项', () => {
    const n = node('a', { durationMs: 8000 })
    const scenario = scnOf(
      { nodes: [n], edges: [] },
      {
        ui: {
          overlays: {
            'scheme-choice': {
              id: 'scheme-choice',
              // 有意不写 inputs：复刻老数据/手改 JSON 里皮肤原型缺字段的真实情况。
              children: [{ id: 'choice-proto', component: 'inkYingMo', trigger: { when: 'enter' } }],
            },
          },
        },
      },
    )
    const withMount: GameScenario = {
      ...scenario,
      graph: {
        ...scenario.graph,
        nodes: scenario.graph.nodes.map((nd) =>
          nd.id === 'a' ? { ...nd, data: { ...nd.data, overlayNodes: [{ overlay: 'scheme-choice' }] } } : nd,
        ),
      },
    }
    const nodeRef = findNode(withMount.graph, 'a')!
    const res = addMaterialGraph(withMount, nodeRef, 8000, 'scheme-choice/choice-proto', undefined, 0)
    const afterNode = findNode(res.scenario.graph, 'a')!
    const el = choiceElement(res.scenario, afterNode)!
    expect(el.component).toBe('inkYingMo')
    const branches = listOptionBranches(res.scenario, afterNode)
    expect(branches.map((b) => b.label)).toEqual(['應', '默'])
  })
})

function seedFloat(): { scenario: GameScenario; node: GameNode; floatId: string } {
  const n = node('a', { durationMs: 8000 })
  let scenario = scnOf({ nodes: [n], edges: [] })
  const nodeRef = scenario.graph.nodes[0]!
  const res = addMaterialGraph(scenario, nodeRef, 8000, 'overlay', undefined, 0)
  scenario = res.scenario
  const floatId = res.selectKey!.split(':').pop()!
  return { scenario, node: scenario.graph.nodes[0]!, floatId }
}

describe('graphMaterialOps · 飘字 effects/expr（结算写回 node.data.reactions，前端表现对齐旧「选取式」）', () => {
  it('新建飘字自带默认到点效果（Boss hp −100）', () => {
    const { scenario, node: n, floatId } = seedFloat()
    const fx = overlayEffects(scenario, n, floatId)
    expect(fx).toHaveLength(1)
    expect(fx[0]).toMatchObject({ kind: 'attr', attr: 'hp', op: 'add', value: -100, id: `${floatId}-settle` })
  })

  it('effects 往返：EffectsEditor 产出的完整列表写入后可读回，首条打上定位 id', () => {
    const { scenario, node: n, floatId } = seedFloat()
    const next = patchOverlayGraph(
      scenario,
      n,
      floatId,
      { effects: [{ kind: 'attr', entityId: 'ent-player', attr: 'hp', op: 'add', value: 30 }] },
      undefined,
    )
    const curNode = findNode(next.graph, n.id)!
    const fx = overlayEffects(next, curNode, floatId)
    expect(fx).toHaveLength(1)
    expect(fx[0]).toMatchObject({ kind: 'attr', entityId: 'ent-player', attr: 'hp', op: 'add', value: 30, id: `${floatId}-settle` })
  })

  it('effects 传空数组＝清除结算（纯展示，不改数值）', () => {
    const { scenario, node: n, floatId } = seedFloat()
    const next = patchOverlayGraph(scenario, n, floatId, { effects: [] }, undefined)
    const curNode = findNode(next.graph, n.id)!
    expect(overlayEffects(next, curNode, floatId)).toEqual([])
    expect(curNode.data.reactions).toBeUndefined()
  })

  it('expr 往返：勾选自定义显示数值后写回 inputs（NumOrExpr），取消勾选清空', () => {
    const { scenario, node: n, floatId } = seedFloat()
    const withExpr = patchOverlayGraph(
      scenario,
      n,
      floatId,
      { expr: { expr: 'entity.ent-boss.attr.hp' } },
      undefined,
    )
    const el = findElement(withExpr, findNode(withExpr.graph, n.id), floatId)!
    expect(el.inputs?.expr).toEqual({ expr: 'entity.ent-boss.attr.hp' })

    const cleared = patchOverlayGraph(
      withExpr,
      findNode(withExpr.graph, n.id)!,
      floatId,
      { expr: undefined },
      undefined,
    )
    const el2 = findElement(cleared, findNode(cleared.graph, n.id), floatId)!
    expect(el2.inputs?.expr).toBeUndefined()
  })

  it('content 只改显示文案，不影响结算 effects', () => {
    const { scenario, node: n, floatId } = seedFloat()
    const next = patchOverlayGraph(scenario, n, floatId, { content: '会心一击 {v}' }, undefined)
    const curNode = findNode(next.graph, n.id)!
    const el = findElement(next, curNode, floatId)!
    expect(el.inputs?.text).toBe('会心一击 {v}')
    expect(overlayEffects(next, curNode, floatId)).toHaveLength(1)
  })
})
