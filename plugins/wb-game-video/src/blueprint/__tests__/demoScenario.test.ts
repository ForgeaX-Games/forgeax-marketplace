import { describe, expect, test } from 'vitest'
import { getBlueprintCombatDemoScenario, getDemoScenario } from '../../scenario/demoScenario'
import { getVideoClip } from '../../scenario/gameAssetCatalog'
import { scenarioToBlueprint } from '../scenarioToBlueprint'
import { BlueprintRuntime } from '../runtime/engine'
import type { GameVideoBlueprintGraph } from '../blueprint-schema'

/**
 * 用「真实内置 demo 蓝图」验证编译器 + 运行时不崩：
 *  - 编译出连通且自洽的 BlueprintGraph。
 *  - 自动驾驶（按 phase 选第一项/通过 QTE/Boss 命中）能走到结局或步数上限内不抛错。
 */
describe('real demo blueprint', () => {
  test('default demo is the standalone prototype combat scenario', () => {
    const scenario = getDemoScenario()
    expect(scenario.id).toBe('demo-001')
    // 起点是「进战待机」(enter)，不是子蓝图入口「我方回合」(a_my)。
    expect(scenario.rootSceneId).toBe('enter')
    expect(scenario.title).toBe('战斗蓝图')
    expect(scenario.scenes.enter?.title).toBe('进战待机')
    expect(scenario.scenes.a_my?.subFlowRef).toBe('g-cb-my')
  })

  test('root is the standby entry; subflow entries stay subflow-typed', () => {
    const graph = scenarioToBlueprint(getBlueprintCombatDemoScenario())
    const typeOf = (id: string) => graph.nodes.find((n) => n.id === id)?.elementType
    // enter 是唯一起点；a_my/b_ai 都是子蓝图节点（同色），不该被 start 抢占。
    expect(typeOf('enter')).toBe('start')
    expect(typeOf('a_my')).toBe('subflow')
    expect(typeOf('b_ai')).toBe('subflow')
    expect(graph.nodes.filter((n) => n.elementType === 'start').map((n) => n.id)).toEqual(['enter'])
  })

  test('enter loop advances immediately through init logic without waiting durationMs', () => {
    const scenario = getBlueprintCombatDemoScenario()
    const graph = scenarioToBlueprint(scenario)
    const rt = new BlueprintRuntime(graph, scenario)
    rt.start()
    expect(rt.state.currentNodeId).toBe('enter')
    expect(rt.state.phase).toBe('playing')
    rt.onClipEnded()
    // init 无演出，同步穿过；应已访问出手判断并到达子蓝图/交互态。
    expect(rt.state.visited.has('init')).toBe(true)
    expect(['awaitChoice', 'playing', 'awaitQte', 'awaitBoss']).toContain(rt.state.phase)
    expect(rt.state.currentNodeId).not.toBe('enter')
  })

  test('compiles to a self-consistent graph', () => {
    const graph = scenarioToBlueprint(getBlueprintCombatDemoScenario())
    expect(graph.nodes.length).toBeGreaterThan(0)
    const ids = new Set(graph.nodes.map((n) => n.id))
    expect(graph.edges.every((e) => ids.has(e.sourceRef) && ids.has(e.targetRef))).toBe(true)
    expect(graph.nodes.some((n) => n.elementType === 'start')).toBe(true)
    // incoming/outgoing 必须能在 edges 里找到对应 flow。
    for (const n of graph.nodes) {
      for (const fid of [...n.incoming, ...n.outgoing]) {
        expect(graph.edges.some((e) => e.id === fid)).toBe(true)
      }
    }
  })

  test('matches the prototype combat blueprint structure and clip ids', () => {
    const scenario = getBlueprintCombatDemoScenario()
    const graph = scenarioToBlueprint(scenario)
    expect(graph.nodes.map((n) => n.id)).toEqual([
      'enter',
      'init',
      'a_my',
      'b_ai',
      'a_chk',
      'b_chk',
      'a_ai',
      'b_my',
      'round',
      'settle',
      'win',
      'lose',
    ])
    expect(graph.edges.map((e) => `${e.sourceRef}->${e.targetRef}:${e.name ?? ''}`)).toEqual([
      'enter->init:Out',
      'init->a_my:我方先手',
      'init->b_ai:敌方先手',
      'a_my->a_chk:行动完毕',
      'b_ai->b_chk:行动完毕',
      'a_chk->a_ai:敌方出手',
      'a_chk->settle:分出胜负',
      'b_chk->b_my:我方出手',
      'b_chk->settle:分出胜负',
      'a_ai->round:行动完毕',
      'b_my->round:行动完毕',
      'round->init:下一回合',
      'round->settle:分出胜负',
      'settle->win:胜利',
      'settle->lose:失败',
    ])

    const my = graph.subflows?.['g-cb-my']
    expect(my?.nodes.map((n) => n.id)).toEqual([
      'wait',
      'pjudge',
      'pu',
      'pu2',
      'zjudge',
      'zhong',
      'z2',
      'fuzhu',
      'ult',
      'my-done',
    ])
    expect(my?.nodes.find((n) => n.id === 'wait')?.extensionElements.clipId).toBe('vd-wcc-idle')
    expect(my?.nodes.find((n) => n.id === 'pu')?.extensionElements.clipId).toBe('vd-wcc-pugong')
    expect(my?.nodes.find((n) => n.id === 'z2')?.extensionElements.clipId).toBe('vd-wcc-zhong2')
    const waitEdges = my?.edges.filter((e) => e.sourceRef === 'wait') ?? []
    expect(waitEdges.find((e) => e.name === '灭世')?.extension?.condition).toEqual({
      all: [{ type: 'var', varId: 'qi', op: 'gte', value: 5 }],
    })
    expect(waitEdges.find((e) => e.name === '灭世')?.extension?.effects).toEqual([
      { id: 'my-ult-qi', kind: 'var', varId: 'qi', op: 'set', value: 0 },
    ])

    const ai = graph.subflows?.['g-cb-ai']
    expect(ai?.nodes.map((n) => n.id)).toEqual(['bt', 'tele', 'block', 'dodgeP', 'hurt', 'ai-done'])
    expect(ai?.nodes.find((n) => n.id === 'tele')?.extensionElements.clipId).toBe('vd-wcc-qianyao')
    expect(ai?.nodes.find((n) => n.id === 'tele')?.extensionElements.calcType).toBe('防反判定')
    expect(my?.nodes.find((n) => n.id === 'pu')?.extensionElements.calcType).toBe('轻攻击')
    expect(graph.nodes.find((n) => n.id === 'init')?.extensionElements.calcType).toBe('出手判断')
    expect(ai?.edges.map((e) => `${e.sourceRef}->${e.targetRef}:${e.name}:${e.extension?.qteOutcome ?? ''}`)).toEqual([
      'bt->tele:进攻:',
      'tele->block:受击防反:pass',
      'tele->dodgeP:受击闪避:good',
      'tele->hurt:受击:fail',
      'block->ai-done:Out:',
      'dodgeP->ai-done:Out:',
      'hurt->ai-done:Out:',
    ])
  })

  test('performance nodes resolve to a fixed clip; pure-logic nodes carry no clip', () => {
    const graph = scenarioToBlueprint(getBlueprintCombatDemoScenario())
    const nodes = [
      ...graph.nodes,
      ...Object.values(graph.subflows ?? {}).flatMap((subflow) => subflow.nodes),
    ]

    // 对齐原型 clip:'' / 隐藏计算节点（原型里 a_chk/b_chk/round 用 CB_CHECK/CB_ROUND
    // 占位符，我们 clipId 留空以免引擎误换片；子流程入口 a_my/b_my/a_ai/b_ai 在原型为
    // LOOP_CB_* 符号、无直接演出，同样留空）。
    const logicNodeIds = new Set([
      'init', 'a_my', 'b_ai', 'a_chk', 'b_chk', 'a_ai', 'b_my', 'round', 'settle',
      'pjudge', 'zjudge', 'my-done', 'bt', 'ai-done',
    ])

    expect(nodes.length).toBeGreaterThan(0)
    for (const node of nodes) {
      const clipId = node.extensionElements.clipId
      if (logicNodeIds.has(node.id)) {
        expect(clipId, `${node.id} is a pure-logic node and should carry no clip`).toBeFalsy()
        continue
      }
      // subflow 下钻节点本身不直接演出（进入即下钻），不强求 clip。
      if (node.extensionElements.subFlowRef) continue
      expect(clipId, `${node.id} should specify a fixed video clip`).toBeTruthy()
      expect(getVideoClip(clipId), `${node.id} clip ${clipId} should resolve`).toBeTruthy()
    }
  })

  test('skill choice appears on the idle loop and advances immediately after picking', () => {
    const scenario = getBlueprintCombatDemoScenario()
    const wait = scenario.scenes.wait

    expect(wait?.mediaPlayMode).toBe('loop')
    expect(wait?.choice).toMatchObject({
      prompt: '选择技能',
      window: { startMs: 1000 },
      fireAt: 'on_pick',
    })
  })

  test('light attack choice walks pjudge → pu → my-done in player subflow', () => {
    const scenario = getBlueprintCombatDemoScenario()
    const graph = scenarioToBlueprint(scenario, 'g-cb-my')
    const rt = new BlueprintRuntime(graph, scenario)
    rt.start()
    expect(rt.state.currentNodeId).toBe('wait')
    expect(rt.state.phase).toBe('awaitChoice')

    rt.chooseOption('my-s1')
    expect(rt.state.visited.has('pjudge')).toBe(true)
    expect(rt.state.currentNodeId).toBe('pu')
    expect(rt.state.phase).toBe('playing')

    rt.onClipEnded()
    expect(rt.state.currentNodeId).toBe('my-done')
    expect(rt.state.visited.has('pu')).toBe(true)
  })

  test('light attack on full graph visits parent HP check after skill clip', () => {
    const scenario = getBlueprintCombatDemoScenario()
    const graph = scenarioToBlueprint(scenario)
    const rt = new BlueprintRuntime(graph, scenario)
    rt.start()
    rt.onClipEnded()
    expect(rt.state.currentNodeId).toBe('wait')

    rt.chooseOption('my-s1')
    rt.onClipEnded()
    expect(rt.state.visited.has('my-done')).toBe(true)
    expect(rt.state.visited.has('a_chk')).toBe(true)
  })

  test('runtime auto-pilot walks the demo without throwing', () => {
    const scenario = getBlueprintCombatDemoScenario()
    const graph = scenarioToBlueprint(scenario)
    const rt = new BlueprintRuntime(graph, scenario)
    rt.start()

    const terminal = new Set(['ended', 'victory', 'defeat'])
    let steps = 0
    while (!terminal.has(rt.state.phase) && steps < 1000) {
      steps += 1
      switch (rt.state.phase) {
        case 'playing':
        case 'awaitHotspot':
          for (const point of findBlueprintNode(graph, rt.state.currentNodeId)?.extensionElements.dmgPoints ?? []) {
            rt.applyDamagePoint(point)
          }
          rt.onClipEnded()
          break
        case 'awaitChoice': {
          const node = rt.state.currentNodeId
          const graphNode = findBlueprintNode(graph, node)
          const first = graphNode?.extensionElements.options?.[0]?.key
          if (first) rt.chooseOption(first)
          else rt.onClipEnded()
          break
        }
        case 'awaitQte':
          rt.submitQte(99)
          break
        case 'awaitBoss':
          rt.submitBossRound(true)
          break
        default:
          steps = 1000
      }
    }
    expect(terminal.has(rt.state.phase)).toBe(true)
    expect(steps).toBeGreaterThan(0)
    expect(rt.state.visited.size).toBeGreaterThan(0)
  })

  test('enemy parry QTE can route to the prototype good outcome', () => {
    const scenario = getBlueprintCombatDemoScenario()
    const graph = scenarioToBlueprint(scenario, 'g-cb-ai')
    const rt = new BlueprintRuntime(graph, scenario)
    rt.start()
    rt.onClipEnded()

    const out = rt.submitQteOutcome('good')
    expect(rt.state.visited.has('dodgeP')).toBe(true)
    expect(out.some((d) => d.type === 'playClip' && d.nodeId === 'dodgeP')).toBe(true)
  })
})

function findBlueprintNode(graph: GameVideoBlueprintGraph, nodeId: string | null) {
  if (!nodeId) return undefined
  return (
    graph.nodes.find((n) => n.id === nodeId) ??
    Object.values(graph.subflows ?? {})
      .flatMap((subflow) => subflow.nodes)
      .find((n) => n.id === nodeId)
  )
}
