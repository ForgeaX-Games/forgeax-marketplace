import { describe, expect, it } from 'vitest'
import {
  makeInsertDialogue,
  makeInsertCue,
  makeInsertBranch,
  duplicateDialogue,
} from '../insertFactories'

const SCENE = 5000

describe('makeInsertDialogue', () => {
  it('startMs 跟随光标位置；endMs 默认 +1500ms', () => {
    const d = makeInsertDialogue({ ms: 1200, sceneDurationMs: SCENE })
    expect(d.startMs).toBe(1200)
    expect(d.endMs).toBe(2700)
    expect(d.role).toBe('narration')
    expect(typeof d.text).toBe('string')
    expect(d.id).toMatch(/^d-/)
  })

  it('end 撞 sceneDuration → 截断到 duration', () => {
    const d = makeInsertDialogue({ ms: 4500, sceneDurationMs: SCENE })
    expect(d.endMs).toBe(SCENE)
  })

  it('start 不能小于 0', () => {
    const d = makeInsertDialogue({ ms: -200, sceneDurationMs: SCENE })
    expect(d.startMs).toBe(0)
  })

  it('start 不能 ≥ sceneDuration（夹回 duration - 100）', () => {
    const d = makeInsertDialogue({ ms: SCENE + 200, sceneDurationMs: SCENE })
    expect(d.startMs).toBe(SCENE - 100)
    expect(d.endMs).toBe(SCENE)
  })

  it('多次调用 id 不重复', () => {
    const a = makeInsertDialogue({ ms: 100, sceneDurationMs: SCENE })
    const b = makeInsertDialogue({ ms: 100, sceneDurationMs: SCENE })
    expect(a.id).not.toBe(b.id)
  })
})

describe('makeInsertCue', () => {
  it('targetAt = 光标位置；appearAt 默认 -1500ms（人类反应窗口）', () => {
    const c = makeInsertCue({ ms: 2500, sceneDurationMs: SCENE })
    expect(c.targetAt).toBe(2500)
    expect(c.appearAt).toBe(1000)
    expect(c.shape).toBe('tap')
    expect(c.x).toBeGreaterThan(0)
    expect(c.x).toBeLessThan(1)
    expect(c.id).toMatch(/^q-/)
  })

  it('appearAt 不能小于 0（光标过早）', () => {
    const c = makeInsertCue({ ms: 100, sceneDurationMs: SCENE })
    expect(c.appearAt).toBe(0)
    expect(c.targetAt).toBe(100)
  })

  it('targetAt 不能超过 sceneDuration', () => {
    const c = makeInsertCue({ ms: SCENE + 200, sceneDurationMs: SCENE })
    expect(c.targetAt).toBe(SCENE)
  })

  it('多次调用 id 不重复', () => {
    const a = makeInsertCue({ ms: 100, sceneDurationMs: SCENE })
    const b = makeInsertCue({ ms: 100, sceneDurationMs: SCENE })
    expect(a.id).not.toBe(b.id)
  })
})

describe('makeInsertBranch', () => {
  it('showAt = 光标位置；kind=choice；指向 defaultTargetId', () => {
    const b = makeInsertBranch({
      ms: 2200,
      sceneDurationMs: SCENE,
      defaultTargetSceneId: 'sceneB',
    })
    expect(b.kind).toBe('choice')
    expect(b.showAt).toBe(2200)
    expect(b.targetSceneId).toBe('sceneB')
    expect(b.id).toMatch(/^b-/)
  })

  it('showAt 夹到 [0, sceneDuration]', () => {
    const a = makeInsertBranch({
      ms: -200,
      sceneDurationMs: SCENE,
      defaultTargetSceneId: 'x',
    })
    expect(a.showAt).toBe(0)
    const b = makeInsertBranch({
      ms: SCENE + 999,
      sceneDurationMs: SCENE,
      defaultTargetSceneId: 'x',
    })
    expect(b.showAt).toBe(SCENE)
  })

  it('多次调用 id 不重复', () => {
    const a = makeInsertBranch({
      ms: 100,
      sceneDurationMs: SCENE,
      defaultTargetSceneId: 'x',
    })
    const b = makeInsertBranch({
      ms: 100,
      sceneDurationMs: SCENE,
      defaultTargetSceneId: 'x',
    })
    expect(a.id).not.toBe(b.id)
  })
})

describe('duplicateDialogue', () => {
  const orig = {
    id: 'd-original',
    role: 'protagonist' as const,
    speaker: '小红',
    text: '原台词',
    startMs: 1000,
    endMs: 2000,
  }

  it('id 重新生成；其他字段拷贝', () => {
    const dup = duplicateDialogue(orig, 1000, SCENE)
    expect(dup.id).not.toBe(orig.id)
    expect(dup.id).toMatch(/^d-/)
    expect(dup.role).toBe('protagonist')
    expect(dup.speaker).toBe('小红')
    expect(dup.text).toBe('原台词')
  })

  it('带 offset 平移 start/end，整段不超界', () => {
    const dup = duplicateDialogue(orig, 1000, SCENE)
    expect(dup.startMs).toBe(2000)
    expect(dup.endMs).toBe(3000)
  })

  it('end 撞右边界 → 整段贴边但保间隔', () => {
    const dup = duplicateDialogue(orig, 5000, SCENE) // 1000+5000=6000 > 5000
    expect(dup.startMs).toBe(SCENE - (orig.endMs - orig.startMs))
    expect(dup.endMs).toBe(SCENE)
  })

  it('end 缺省的台词 → 仅平移 startMs', () => {
    const noEnd = { ...orig, endMs: undefined }
    const dup = duplicateDialogue(noEnd, 500, SCENE)
    expect(dup.endMs).toBeUndefined()
    expect(dup.startMs).toBe(1500)
  })

  it('offset=0 → 直接覆盖在原台词上（仅生成新 id，避免多余动作）', () => {
    const dup = duplicateDialogue(orig, 0, SCENE)
    expect(dup.startMs).toBe(orig.startMs)
    expect(dup.endMs).toBe(orig.endMs)
  })
})
