/**
 * 「无演出节点」运行时行为单测 —— 对齐原型：纯逻辑/判定节点不换视频，逻辑就地叠加在
 * 上一段正在播放的视频之上执行；只有带演出（clip/media）的节点才产出 playClip。
 */

import { describe, expect, test } from 'vitest'
import type { Branch, Effect, Scenario, Scene } from '../../scenario/types'
import type { RuntimeDirective } from '../runtime/directives'
import { scenarioToBlueprint } from '../scenarioToBlueprint'
import { BlueprintRuntime } from '../runtime/engine'

function auto(id: string, targetSceneId: string, label?: string): Branch {
  return { id, kind: 'auto', targetSceneId, label }
}

function choice(id: string, targetSceneId: string, label: string): Branch {
  return { id, kind: 'choice', targetSceneId, label }
}

/** 演出节点：带 clip。 */
function perf(id: string, clipId: string, branches: Branch[], extra?: Partial<Scene>): Scene {
  return {
    id,
    title: id,
    media: { kind: 'PLACEHOLDER', meta: {} },
    clipId,
    durationMs: 3000,
    dialogue: [],
    branches,
    ...extra,
  }
}

/** 无演出节点：clip 为空、media 非视频 → nodeHasPerformance=false。 */
function logic(id: string, branches: Branch[], extra?: Partial<Scene>): Scene {
  return {
    id,
    title: id,
    media: { kind: 'PLACEHOLDER', meta: {} },
    clipId: '',
    durationMs: 300,
    dialogue: [],
    branches,
    ...extra,
  }
}

function scenarioOf(scenes: Scene[], rootSceneId: string, extra?: Partial<Scenario>): Scenario {
  const map: Record<string, Scene> = {}
  for (const s of scenes) map[s.id] = s
  return {
    id: 'no-perf-demo',
    title: 'no-perf demo',
    rootSceneId,
    scenes: map,
    defaultCharMs: 40,
    schemaVersion: 9,
    variables: { flag: { id: 'flag', name: 'flag', kind: 'number', initial: 0 } },
    ...extra,
  } as Scenario
}

function playClips(dirs: RuntimeDirective[]): string[] {
  return dirs.filter((d): d is Extract<RuntimeDirective, { type: 'playClip' }> => d.type === 'playClip').map((d) => d.nodeId)
}

describe('BlueprintRuntime — 无演出节点', () => {
  test('logic node passes through synchronously without emitting a playClip', () => {
    const varEffect: Effect = { id: 'set-flag', kind: 'var', varId: 'flag', op: 'set', value: 1 }
    const scenario = scenarioOf(
      [
        perf('p1', 'clip-1', [auto('p1-next', 'calc')], { mediaPlayMode: 'loop' }),
        logic('calc', [auto('calc-next', 'p2')], { onEnterEffects: [varEffect] }),
        perf('p2', 'clip-2', []),
      ],
      'p1',
    )
    const rt = new BlueprintRuntime(scenarioToBlueprint(scenario), scenario)

    const startOut = rt.start()
    expect(playClips(startOut)).toEqual(['p1'])
    expect(rt.state.phase).toBe('playing')

    // 上一段 p1 播完：引擎应同步穿过无演出的 calc 节点直达 p2，全程只对 p2 换片一次，
    // 且 calc 的 onEnter 副作用已生效（不换片、不空等）。
    const out = rt.onClipEnded()
    expect(playClips(out)).toEqual(['p2'])
    expect(out.some((d) => d.type === 'playClip' && d.nodeId === 'calc')).toBe(false)
    expect(rt.state.currentNodeId).toBe('p2')
    expect(rt.state.visited.has('calc')).toBe(true)
    expect(rt.state.vars.flag).toBe(1)
  })

  test('no-performance choice node opens the choice over the previous clip (no re-play)', () => {
    const scenario = scenarioOf(
      [
        perf('p1', 'clip-1', [auto('p1-next', 'pick')], { mediaPlayMode: 'loop' }),
        logic('pick', [choice('go-a', 'a', 'A'), choice('go-b', 'b', 'B')], {
          kind: 'choice',
          decision: { optType: 'static', prompt: '选' },
        }),
        perf('a', 'clip-a', []),
        perf('b', 'clip-b', []),
      ],
      'p1',
    )
    const rt = new BlueprintRuntime(scenarioToBlueprint(scenario), scenario)
    rt.start()

    // 进入无演出选择节点：开选项、但不换片（保留上一段 p1 在底下继续播）。
    const openOut = rt.onClipEnded()
    expect(openOut.some((d) => d.type === 'openChoice' && d.nodeId === 'pick')).toBe(true)
    expect(playClips(openOut)).toEqual([])
    expect(rt.state.phase).toBe('awaitChoice')
    expect(rt.state.currentNodeId).toBe('pick')

    // 选完才进入下一段演出。
    const pickOut = rt.chooseOption('go-b')
    expect(playClips(pickOut)).toEqual(['b'])
    expect(rt.state.currentNodeId).toBe('b')
  })

  test('onEnter entity HP effect emits a floatEffects directive (generic on-enter heal +30)', () => {
    const heal: Effect = { id: 'heal', kind: 'entityStat', entityId: 'ent-player', stat: 'hp', op: 'add', value: 30 }
    const scenario = scenarioOf(
      [
        perf('p1', 'clip-1', [auto('p1-next', 'rest')], { mediaPlayMode: 'loop' }),
        perf('rest', 'clip-rest', [], { onEnterEffects: [heal] }),
      ],
      'p1',
      {
        entities: {
          'ent-player': { id: 'ent-player', name: '空藏', kind: 'player', maxHp: 300, initialHp: 100 },
        },
      },
    )
    const rt = new BlueprintRuntime(scenarioToBlueprint(scenario), scenario)
    rt.start()

    const out = rt.onClipEnded()
    const float = out.find((d): d is Extract<RuntimeDirective, { type: 'floatEffects' }> => d.type === 'floatEffects')
    expect(float).toBeDefined()
    expect(float?.effects[0]).toMatchObject({ kind: 'entityStat', stat: 'hp', value: 30 })
    // onEnter 立即结算：100 + 30 = 130（封顶 maxHp 300）。
    expect(rt.state.entities['ent-player']?.hp).toBe(130)
  })

  test('a cycle of always-true no-performance nodes is guarded (no stack overflow)', () => {
    // l1 → l2 → l1 全为无演出且 auto 恒真：不应爆栈，应被环防护停下。
    const scenario = scenarioOf(
      [
        perf('p1', 'clip-1', [auto('p1-next', 'l1')]),
        logic('l1', [auto('l1-next', 'l2')]),
        logic('l2', [auto('l2-next', 'l1')]),
      ],
      'p1',
    )
    const rt = new BlueprintRuntime(scenarioToBlueprint(scenario), scenario)
    rt.start()

    expect(() => rt.onClipEnded()).not.toThrow()
    expect(rt.state.phase).toBe('playing')
  })
})
