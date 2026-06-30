/**
 * dialogueSelection · 共享选中 dialogue id 的轻量 store
 *
 * 设计动机：
 *   原本 Timeline 内部的 toolbarSel 表示"时间轴选中的 clip（含 kind: shot/audio/
 *   dialogue/cue/branch/...）"。重构 dialogue 编辑入口为"右侧 Dock 字幕 tab 详情面板"
 *   后，Dock（TimelineDock）需要知道当前选中的是哪条 dialogue 才能渲染详情。
 *   两个组件并列，不便靠 props 串通——抽到一个最小 store。
 *
 *   选 Zustand 是因为项目里已经在用，避免引入新的状态机。但这个 store 只关心
 *   "当前选中的 dialogue id"——不存 dialogue 内容（仍在 scenarioStore）、
 *   不存场景 id（dialogue id 全局唯一）。
 *
 *   联动：
 *     - Timeline 在 setToolbarSel({kind:'dialogue', id}) 时同步 setSelected(id)
 *     - Timeline 在 setToolbarSel(其他/null) 时 setSelected(null)
 *     - Timeline 切场景时 setSelected(null)
 *     - Dock 读 selectedId 决定渲染空态 / 详情卡
 */
import { create } from 'zustand'

interface DialogueSelectionState {
  selectedId: string | null
  setSelected(id: string | null): void
}

export const useDialogueSelection = create<DialogueSelectionState>((set) => ({
  selectedId: null,
  setSelected: (id) => set({ selectedId: id }),
}))
