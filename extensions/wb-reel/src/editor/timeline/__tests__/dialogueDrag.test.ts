import { describe, expect, it } from 'vitest'
import {
  moveDialoguePatch,
  resizeDialogueLeftPatch,
  resizeDialogueRightPatch,
  DIALOGUE_MIN_DURATION_MS,
} from '../dialogueDrag'
import type { DialogueLine } from '../../../scenario/types'

const SCENE = 5000

function line(over: Partial<DialogueLine> = {}): DialogueLine {
  return {
    id: 'd1',
    role: 'narration',
    text: '台词',
    startMs: 1000,
    endMs: 2000,
    ...over,
  }
}

describe('moveDialoguePatch —— 整体平移', () => {
  it('正方向位移 → start/end 同步右移', () => {
    const p = moveDialoguePatch(line(), 500, SCENE)
    expect(p).toEqual({ startMs: 1500, endMs: 2500 })
  })

  it('负方向位移 → start/end 同步左移', () => {
    const p = moveDialoguePatch(line(), -300, SCENE)
    expect(p).toEqual({ startMs: 700, endMs: 1700 })
  })

  it('左边撞 0 → 整体停在 start=0，保持原宽度', () => {
    const p = moveDialoguePatch(line({ startMs: 200, endMs: 1200 }), -800, SCENE)
    expect(p).toEqual({ startMs: 0, endMs: 1000 })
  })

  it('右边撞 sceneDuration → 整体停在 end=duration，保持原宽度', () => {
    const p = moveDialoguePatch(line({ startMs: 3500, endMs: 4500 }), 1000, SCENE)
    expect(p).toEqual({ startMs: 4000, endMs: 5000 })
  })

  it('endMs 缺省 → 仅平移 startMs（不创造 endMs）', () => {
    const p = moveDialoguePatch(line({ endMs: undefined }), 200, SCENE)
    expect(p.startMs).toBe(1200)
    expect('endMs' in p).toBe(false)
  })

  it('endMs 缺省 + 撞左边 0', () => {
    const p = moveDialoguePatch(line({ startMs: 200, endMs: undefined }), -500, SCENE)
    expect(p.startMs).toBe(0)
  })

  it('endMs 缺省 + 撞右边 → start 不能超 sceneDuration', () => {
    const p = moveDialoguePatch(line({ startMs: 4800, endMs: undefined }), 500, SCENE)
    expect(p.startMs).toBe(SCENE)
  })

  it('delta=0 → 不返回任何字段（empty patch）', () => {
    const p = moveDialoguePatch(line(), 0, SCENE)
    expect(p).toEqual({})
  })
})

describe('resizeDialogueLeftPatch —— 拖左 handle 改 startMs', () => {
  it('左拖（负 delta）→ startMs 减小，endMs 不变', () => {
    const p = resizeDialogueLeftPatch(line(), -300, SCENE)
    expect(p).toEqual({ startMs: 700 })
  })

  it('右拖（正 delta）→ startMs 增大，endMs 不变', () => {
    const p = resizeDialogueLeftPatch(line(), 200, SCENE)
    expect(p).toEqual({ startMs: 1200 })
  })

  it('startMs 不能小于 0', () => {
    const p = resizeDialogueLeftPatch(line({ startMs: 200, endMs: 1500 }), -500, SCENE)
    expect(p).toEqual({ startMs: 0 })
  })

  it('startMs 不能超过 endMs - MIN_DURATION', () => {
    const p = resizeDialogueLeftPatch(line({ startMs: 1000, endMs: 2000 }), 5000, SCENE)
    expect(p).toEqual({ startMs: 2000 - DIALOGUE_MIN_DURATION_MS })
  })

  it('endMs 缺省 → 退化为整体平移 startMs（仅约束 0..sceneDuration）', () => {
    const p = resizeDialogueLeftPatch(line({ endMs: undefined }), 300, SCENE)
    expect(p).toEqual({ startMs: 1300 })
  })
})

describe('resizeDialogueRightPatch —— 拖右 handle 改 endMs', () => {
  it('右拖 → endMs 增大', () => {
    const p = resizeDialogueRightPatch(line(), 500, SCENE)
    expect(p).toEqual({ endMs: 2500 })
  })

  it('左拖 → endMs 减小', () => {
    const p = resizeDialogueRightPatch(line(), -300, SCENE)
    expect(p).toEqual({ endMs: 1700 })
  })

  it('endMs 不能超 sceneDuration', () => {
    const p = resizeDialogueRightPatch(line({ startMs: 3000, endMs: 4500 }), 2000, SCENE)
    expect(p).toEqual({ endMs: SCENE })
  })

  it('endMs 不能小于 startMs + MIN_DURATION', () => {
    const p = resizeDialogueRightPatch(line({ startMs: 1000, endMs: 2000 }), -5000, SCENE)
    expect(p).toEqual({ endMs: 1000 + DIALOGUE_MIN_DURATION_MS })
  })

  it('endMs 缺省 → 由 right handle 写入：默认起始 = startMs + 2000（与渲染回退一致）', () => {
    const p = resizeDialogueRightPatch(line({ startMs: 1000, endMs: undefined }), 200, SCENE)
    expect(p.endMs).toBe(3200)
  })
})
