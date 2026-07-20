import { describe, expect, it } from 'vitest'
import {
  moveCuePatch,
  moveCueTargetOnlyPatch,
  resizeTrigBandLeadInPatch,
} from '../cueDrag'
import type { QTECue } from '../../../scenario/types'

const SCENE = 5000

function cue(over: Partial<QTECue> = {}): QTECue {
  return {
    id: 'q1',
    shape: 'tap',
    x: 0.5,
    y: 0.5,
    appearAt: 800,
    targetAt: 1200,
    ...over,
  }
}

describe('moveCuePatch —— pin 整体平移', () => {
  it('正方向 → appear/target 同步右移，间隔保留', () => {
    const p = moveCuePatch(cue(), 300, SCENE)
    expect(p).toEqual({ appearAt: 1100, targetAt: 1500 })
  })

  it('负方向 → appear/target 同步左移', () => {
    const p = moveCuePatch(cue(), -200, SCENE)
    expect(p).toEqual({ appearAt: 600, targetAt: 1000 })
  })

  it('appear 撞 0 → 整体停在 appearAt=0，保间隔', () => {
    const p = moveCuePatch(cue({ appearAt: 200, targetAt: 600 }), -1000, SCENE)
    expect(p).toEqual({ appearAt: 0, targetAt: 400 })
  })

  it('target 撞右边 sceneDuration → 整体停在 targetAt=duration', () => {
    const p = moveCuePatch(cue({ appearAt: 4000, targetAt: 4500 }), 2000, SCENE)
    expect(p).toEqual({ appearAt: 4500, targetAt: SCENE })
  })

  it('appearAt > targetAt 的不合法输入 → 不抛错（保持相对间隔）', () => {
    // 防御退化数据：若 appearAt > targetAt（理论上不该发生）, 也不应炸
    const p = moveCuePatch(cue({ appearAt: 1500, targetAt: 1200 }), 0, SCENE)
    expect(p).toEqual({})
  })

  it('delta=0 → 空 patch', () => {
    const p = moveCuePatch(cue(), 0, SCENE)
    expect(p).toEqual({})
  })
})

describe('moveCueTargetOnlyPatch —— 仅拖目标点，appearAt 不动', () => {
  it('正方向 → targetAt 增大', () => {
    const p = moveCueTargetOnlyPatch(cue(), 400, SCENE)
    expect(p).toEqual({ targetAt: 1600 })
  })

  it('targetAt 不能小于 appearAt（最小重合）', () => {
    const p = moveCueTargetOnlyPatch(cue({ appearAt: 1000, targetAt: 1500 }), -2000, SCENE)
    expect(p).toEqual({ targetAt: 1000 })
  })

  it('targetAt 不能超过 sceneDuration', () => {
    const p = moveCueTargetOnlyPatch(cue({ appearAt: 4000, targetAt: 4800 }), 1000, SCENE)
    expect(p).toEqual({ targetAt: SCENE })
  })

  it('delta=0 → 空 patch', () => {
    const p = moveCueTargetOnlyPatch(cue(), 0, SCENE)
    expect(p).toEqual({})
  })
})

describe('resizeTrigBandLeadInPatch —— 拖 TRIG band 左 handle 改 leadInMs', () => {
  it('cue 没 slowMo → 返回空 patch（safety）', () => {
    const p = resizeTrigBandLeadInPatch(cue({ slowMo: undefined }), -200)
    expect(p).toEqual({})
  })

  it('左拖（负 delta）= band 起点更早 = leadInMs 增大', () => {
    const p = resizeTrigBandLeadInPatch(
      cue({ appearAt: 1000, slowMo: { rate: 0.3, leadInMs: 200 } }),
      -300,
    )
    expect(p).toEqual({ slowMo: { rate: 0.3, leadInMs: 500 } })
  })

  it('右拖（正 delta）= band 起点更晚 = leadInMs 减小', () => {
    const p = resizeTrigBandLeadInPatch(
      cue({ appearAt: 1000, slowMo: { rate: 0.3, leadInMs: 400 } }),
      150,
    )
    expect(p).toEqual({ slowMo: { rate: 0.3, leadInMs: 250 } })
  })

  it('leadInMs 不能小于 0（撞底）', () => {
    const p = resizeTrigBandLeadInPatch(
      cue({ appearAt: 1000, slowMo: { rate: 0.3, leadInMs: 100 } }),
      500,
    )
    expect(p).toEqual({ slowMo: { rate: 0.3, leadInMs: 0 } })
  })

  it('leadInMs 不能超过 appearAt（band 起点不能小于 0）', () => {
    const p = resizeTrigBandLeadInPatch(
      cue({ appearAt: 1000, slowMo: { rate: 0.3, leadInMs: 200 } }),
      -2000,
    )
    expect(p).toEqual({ slowMo: { rate: 0.3, leadInMs: 1000 } })
  })

  it('未提供 leadInMs → 视为 0 起算', () => {
    const p = resizeTrigBandLeadInPatch(
      cue({ appearAt: 1000, slowMo: { rate: 0.3 } }),
      -250,
    )
    expect(p).toEqual({ slowMo: { rate: 0.3, leadInMs: 250 } })
  })

  it('保留 slowMo 其他字段（holdAfterHitMs/requireHit/failSceneId）', () => {
    const p = resizeTrigBandLeadInPatch(
      cue({
        appearAt: 1000,
        slowMo: {
          rate: 0.25,
          leadInMs: 200,
          holdAfterHitMs: 80,
          requireHit: false,
          failSceneId: 'gameover',
        },
      }),
      -100,
    )
    expect(p.slowMo).toEqual({
      rate: 0.25,
      leadInMs: 300,
      holdAfterHitMs: 80,
      requireHit: false,
      failSceneId: 'gameover',
    })
  })

  it('delta=0 → 空 patch', () => {
    const p = resizeTrigBandLeadInPatch(
      cue({ appearAt: 1000, slowMo: { rate: 0.3, leadInMs: 200 } }),
      0,
    )
    expect(p).toEqual({})
  })
})
