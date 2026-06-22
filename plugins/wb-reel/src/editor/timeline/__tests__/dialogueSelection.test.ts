import { describe, expect, it, beforeEach } from 'vitest'
import { useDialogueSelection } from '../dialogueSelection'

/**
 * dialogueSelection 是个极简 Zustand store，逻辑只有 set/get。
 * 即便如此还是写一笔 smoke test，是因为它跨模块联通了 Timeline ↔ TimelineDock
 * 两个组件，回归很容易因为「id 没清干净」「切场景没 reset」而表现成"上一条
 * dialogue 的属性还在右侧面板显示"——肉眼回归不可靠，加一个最小契约校验。
 */
describe('dialogueSelection store', () => {
  beforeEach(() => {
    useDialogueSelection.setState({ selectedId: null })
  })

  it('默认未选中', () => {
    expect(useDialogueSelection.getState().selectedId).toBeNull()
  })

  it('setSelected 写入与清空都生效', () => {
    useDialogueSelection.getState().setSelected('d-abc')
    expect(useDialogueSelection.getState().selectedId).toBe('d-abc')
    useDialogueSelection.getState().setSelected(null)
    expect(useDialogueSelection.getState().selectedId).toBeNull()
  })

  it('多次设置会覆盖前值（不是 union 累加）', () => {
    useDialogueSelection.getState().setSelected('d-1')
    useDialogueSelection.getState().setSelected('d-2')
    expect(useDialogueSelection.getState().selectedId).toBe('d-2')
  })
})
