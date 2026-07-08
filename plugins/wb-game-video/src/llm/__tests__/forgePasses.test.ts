import { describe, it, expect } from 'vitest'
import { qteEnhancePass } from '../forgePasses'
import type { Scenario, Scene } from '../../scenario/types'

function mkScene(overrides: Partial<Scene>): Scene {
  return {
    id: 's',
    title: '',
    media: { kind: 'IMAGE_PROMPT', prompt: '' },
    durationMs: 5000,
    dialogue: [],
    branches: [],
    ...overrides,
  }
}

function mkScenario(scenes: Record<string, Scene>): Scenario {
  return {
    id: 'sc',
    title: 'T',
    rootSceneId: Object.keys(scenes)[0] ?? '',
    scenes,
    defaultCharMs: 60,
    schemaVersion: 2,
  }
}

describe('qteEnhancePass', () => {
  it('script 模式下对强动作场景追加默认 QTE', () => {
    const s1 = mkScene({
      id: 's1',
      title: '他冲过去猛地扑住她',
      durationMs: 7000,
    })
    const s2 = mkScene({ id: 's2', title: '闲谈' })
    const scenario = mkScenario({ s1, s2 })

    const out = qteEnhancePass(scenario, 2)
    expect(out.scenes.s1?.qte).toBeDefined()
    expect(out.scenes.s1?.qte?.cues.length).toBe(1)
    expect(out.scenes.s2?.qte).toBeUndefined()
  })

  it('限制 limit=1 只增强最强 1 场', () => {
    const scenario = mkScenario({
      a: mkScene({ id: 'a', title: '他扔出匕首', durationMs: 6000 }),
      b: mkScene({ id: 'b', title: '她抓住窗沿', durationMs: 8000 }),
      c: mkScene({ id: 'c', title: '闲谈' }),
    })
    const out = qteEnhancePass(scenario, 1)
    const withQte = Object.values(out.scenes).filter((s) => s.qte).length
    expect(withQte).toBe(1)
  })

  it('已经有 QTE 的场景不被覆盖', () => {
    const s1 = mkScene({
      id: 's1',
      title: '他冲过去',
      durationMs: 7000,
      qte: {
        cues: [
          {
            id: 'existing',
            shape: 'hold',
            x: 0.3,
            y: 0.3,
            appearAt: 100,
            targetAt: 500,
            durationMs: 1000,
          },
        ],
        window: { perfect: 80, great: 180, good: 300 },
        score: { perfect: 100, great: 60, good: 30, miss: -10 },
      },
    })
    const scenario = mkScenario({ s1 })
    const out = qteEnhancePass(scenario, 2)
    expect(out.scenes.s1?.qte?.cues[0]?.id).toBe('existing')
  })

  it('无候选场景 → 返回原 scenario 未变（引用相等）', () => {
    const scenario = mkScenario({
      a: mkScene({ id: 'a', title: '纯闲谈' }),
      b: mkScene({ id: 'b', title: '普通对话' }),
    })
    const out = qteEnhancePass(scenario, 2)
    expect(out).toBe(scenario)
  })

  it('生成的默认 QTE targetAt 在场景时长内', () => {
    const scenario = mkScenario({
      a: mkScene({ id: 'a', title: '他扔砸', durationMs: 5000 }),
    })
    const out = qteEnhancePass(scenario, 1)
    const cue = out.scenes.a?.qte?.cues[0]
    expect(cue?.targetAt).toBeGreaterThan(0)
    expect(cue?.targetAt).toBeLessThanOrEqual(5000)
    expect(cue?.appearAt).toBeLessThan(cue?.targetAt ?? 0)
  })
})
