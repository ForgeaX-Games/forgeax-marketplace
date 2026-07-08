/**
 * 合成 Scenario fixture —— 覆盖 Loop / 转场 / QTE / 状态机(条件路由) / Boss / 选择，
 * 给蓝图编译器、reactflow 转换层、运行时引擎做确定性单测。
 */

import type { Branch, Effect, Scene, Scenario } from '../../scenario/types'

function scene(partial: Partial<Scene> & { id: string }): Scene {
  return {
    title: partial.id,
    media: { kind: 'VIDEO', ref: `media-${partial.id}` },
    durationMs: 5000,
    dialogue: [],
    branches: [],
    ...partial,
  }
}

function branch(b: Branch): Branch {
  return b
}

function varEffect(id: string, varId: string, value: number): Effect {
  return { id, kind: 'var', varId, op: 'add', value }
}

function hpEffect(id: string, entityId: string, value: number): Effect {
  return { id, kind: 'entityStat', entityId, stat: 'hp', op: 'add', value }
}

/** start(loop+转场) → choice → {qte → boss} | {boss(+effect)} → good/bad 结局。 */
export function makeDemoScenario(): Scenario {
  const scenes: Record<string, Scene> = {}
  const add = (s: Scene): void => {
    scenes[s.id] = s
  }

  add(
    scene({
      id: 'start',
      title: '开场对峙',
      mediaPlayMode: 'loop',
      transition: { presetId: 'dissolve', durationMs: 600 },
      branches: [branch({ id: 'b-start', kind: 'auto', targetSceneId: 'choose' })],
    }),
  )

  add(
    scene({
      id: 'choose',
      title: '抉择',
      choice: { prompt: '怎么办？' },
      branches: [
        branch({ id: 'opt-qte', kind: 'choice', label: '迎击（QTE）', targetSceneId: 'qte' }),
        branch({
          id: 'opt-rush',
          kind: 'choice',
          label: '直冲 Boss',
          targetSceneId: 'boss',
          effects: [varEffect('opt-rush-brave', 'brave', 1)],
        }),
      ],
    }),
  )

  add(
    scene({
      id: 'qte',
      title: '防反 QTE',
      qte: {
        cues: [
          { id: 'c1', shape: 'tap', x: 0.4, y: 0.5, appearAt: 800, targetAt: 1000 },
          { id: 'c2', shape: 'tap', x: 0.6, y: 0.5, appearAt: 1600, targetAt: 1800 },
        ],
        tolerance: { perfect: 80, great: 140, good: 220 },
        score: { perfect: 100, great: 70, good: 40, miss: -10 },
      },
      branches: [
        branch({ id: 'b-qpass', kind: 'qte_pass', targetSceneId: 'boss' }),
        branch({ id: 'b-qfail', kind: 'qte_fail', targetSceneId: 'badEnd' }),
      ],
    }),
  )

  add(
    scene({
      id: 'boss',
      title: 'Boss 战',
      boss: {
        entityId: 'foe',
        playerEntityId: 'hero',
        rounds: [
          { id: 'r1', label: '一招', hitEffects: [hpEffect('r1-boss-hp', 'foe', -100)], missEffects: [hpEffect('r1-player-hp', 'hero', -60)] },
          { id: 'r2', label: '二招', hitEffects: [hpEffect('r2-boss-hp', 'foe', -100)], missEffects: [hpEffect('r2-player-hp', 'hero', -60)] },
        ],
        winSceneId: 'goodEnd',
        loseSceneId: 'badEnd',
      },
      branches: [],
    }),
  )

  add(scene({ id: 'goodEnd', title: '胜利结局', isEnding: true, hudPreset: 'hidden', branches: [] }))
  add(scene({ id: 'badEnd', title: '失败结局', isEnding: true, hudPreset: 'hidden', branches: [] }))

  return {
    id: 'demo-bp',
    title: '蓝图运行时 demo',
    rootSceneId: 'start',
    scenes,
    defaultCharMs: 40,
    schemaVersion: 9,
    variables: {
      brave: { id: 'brave', name: '勇气', kind: 'number', initial: 0 },
    },
    entities: {
      foe: { id: 'foe', name: '妖将', kind: 'boss', maxHp: 150 },
      hero: { id: 'hero', name: '主角', kind: 'player', maxHp: 100 },
    },
  }
}

/** start → container(subflow) → after；container 自动进入 innerStart → innerEnd 后再走 after。 */
export function makeSubflowScenario(): Scenario {
  const scenes: Record<string, Scene> = {}
  const add = (s: Scene): void => {
    scenes[s.id] = s
  }

  add(
    scene({
      id: 'start',
      title: '入口',
      branches: [branch({ id: 'b-start', kind: 'auto', targetSceneId: 'container' })],
    }),
  )
  add(
    scene({
      id: 'container',
      title: '封装节点',
      branches: [branch({ id: 'b-container', kind: 'auto', targetSceneId: 'after' })],
      subFlowRef: 'g-inner',
    } as unknown as Partial<Scene> & { id: string }),
  )
  add(scene({ id: 'after', title: '父图后续', branches: [] }))
  add(
    scene({
      id: 'innerStart',
      title: '子图入口',
      branches: [branch({ id: 'b-inner', kind: 'auto', targetSceneId: 'innerEnd' })],
    }),
  )
  add(scene({ id: 'innerEnd', title: '子图出口', branches: [] }))

  return {
    id: 'demo-subflow',
    title: '子蓝图运行时 demo',
    rootSceneId: 'start',
    scenes,
    defaultCharMs: 40,
    schemaVersion: 9,
    blueprintGraphs: {
      'g-inner': {
        id: 'g-inner',
        title: '子图',
        rootSceneId: 'innerStart',
        sceneIds: ['innerStart', 'innerEnd'],
        parentSceneId: 'container',
      },
    },
  } as unknown as Scenario
}
