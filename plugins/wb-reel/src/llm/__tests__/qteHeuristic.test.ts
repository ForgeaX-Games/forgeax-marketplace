import { describe, it, expect } from 'vitest'
import { scoreSceneForQte, pickQteCandidates } from '../qteHeuristic'
import type { Scene } from '../../scenario/types'

function mk(overrides: Partial<Scene>): Scene {
  return {
    id: 's',
    title: '',
    media: { kind: 'IMAGE_PROMPT', prompt: '' },
    durationMs: 3000,
    dialogue: [],
    branches: [],
    ...overrides,
  }
}

describe('scoreSceneForQte', () => {
  it('含强动作动词 → 正分', () => {
    const r = scoreSceneForQte(
      mk({
        id: 's1',
        title: '厨房险境',
        media: { kind: 'IMAGE_PROMPT', prompt: '她猛地扔出菜刀' },
      }),
    )
    expect(r.score).toBeGreaterThan(0)
    expect(r.matchedVerbs).toContain('扔')
  })

  it('长场景 + 紧迫感词 → 分数更高', () => {
    const r = scoreSceneForQte(
      mk({
        id: 's2',
        title: '',
        durationMs: 8000,
        media: { kind: 'IMAGE_PROMPT', prompt: '' },
        dialogue: [
          { id: 'd1', role: 'narration', text: '千钧一发，他一把抓住缰绳', startMs: 0 },
        ],
      }),
    )
    // 抓 (+3) + 长 (+2) + 紧迫感 (+1)
    expect(r.score).toBe(6)
  })

  it('纯对话场景无动词 → 0', () => {
    const r = scoreSceneForQte(
      mk({
        id: 's3',
        dialogue: [
          { id: 'd', role: 'character', text: '我们是否应该告诉他真相？', startMs: 0 },
        ],
      }),
    )
    expect(r.score).toBe(0)
  })

  it('已经有 QTE 的场景 → 负分（不重复加）', () => {
    const r = scoreSceneForQte(
      mk({
        id: 's4',
        title: '他冲过去',
        qte: {
          cues: [
            {
              id: 'c',
              shape: 'tap',
              x: 0.5,
              y: 0.5,
              appearAt: 100,
              targetAt: 500,
            },
          ],
          window: { perfect: 80, great: 180, good: 300 },
          score: { perfect: 100, great: 60, good: 30, miss: -10 },
        },
      }),
    )
    // +3 冲 -5 已有 qte → -2
    expect(r.score).toBe(-2)
  })

  it('分支 ≥ 3 的场景 → 惩罚', () => {
    const r = scoreSceneForQte(
      mk({
        id: 's5',
        title: '他扔出石块',
        branches: [
          { id: 'a', kind: 'choice', label: 'A', targetSceneId: 'x' },
          { id: 'b', kind: 'choice', label: 'B', targetSceneId: 'y' },
          { id: 'c', kind: 'choice', label: 'C', targetSceneId: 'z' },
        ],
      }),
    )
    // +3 扔 -5 分支多 → -2
    expect(r.score).toBe(-2)
  })
})

describe('pickQteCandidates', () => {
  it('按分数降序挑 TOP 2', () => {
    const scenes = [
      mk({ id: 'a', title: '开场闲谈', dialogue: [] }),
      mk({
        id: 'b',
        title: '追逐战',
        media: { kind: 'IMAGE_PROMPT', prompt: '他冲过去一把抓住她' },
        durationMs: 7000,
      }),
      mk({
        id: 'c',
        title: '小小推搡',
        media: { kind: 'IMAGE_PROMPT', prompt: '轻轻推了一下' },
      }),
      mk({ id: 'd', title: '和平', dialogue: [] }),
    ]
    const pick = pickQteCandidates(scenes, 2)
    expect(pick.map((p) => p.sceneId)).toEqual(['b', 'c'])
  })

  it('所有场景都 ≤ 0 → 返回空数组', () => {
    const scenes = [
      mk({ id: 'a', title: '纯对话' }),
      mk({ id: 'b', title: '纯对话' }),
    ]
    expect(pickQteCandidates(scenes, 2)).toEqual([])
  })

  it('limit 约束生效', () => {
    const scenes = [
      mk({ id: 'a', title: '他扔砸推', durationMs: 7000 }),
      mk({ id: 'b', title: '她抓刺劈', durationMs: 7000 }),
      mk({ id: 'c', title: '跳撞拉', durationMs: 7000 }),
    ]
    expect(pickQteCandidates(scenes, 1)).toHaveLength(1)
  })
})
