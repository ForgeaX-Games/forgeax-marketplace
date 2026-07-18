/**
 * clipSelection · 共享「文字叠加 / 搜索段」选中 id 的轻量 store
 *
 * 与 dialogueSelection 同理：Timeline 的 toolbarSel 是内部状态，右侧 Dock
 * 需要知道当前选中的文字/搜索段 clip 才能渲染对应详情面板。两组件并列，
 * 抽一个最小 store 串通。只存「当前选中 id」，内容仍在 scenarioStore。
 *
 * 联动：
 *   - Timeline 在 setToolbarSel({kind:'textOverlay'|'searchSegment', id}) 时同步
 *   - 选其他 / null / 切场景时置 null
 *   - Dock 读对应 id 自动切 tab + 渲染详情
 */
import { create } from 'zustand'

/** 后期效果 clip 的选中描述（轨道上点选 → EffectsRail 切到对应编辑器）。 */
export type FxSelection =
  | { kind: 'filter'; id: string }
  | { kind: 'adjust'; id: string }
  | { kind: 'effect'; id: string }
  | { kind: 'sticker'; id: string }
  | { kind: 'transition'; id: string }

interface ClipSelectionState {
  textOverlayId: string | null
  searchSegmentId: string | null
  fxSelection: FxSelection | null
  setTextOverlay(id: string | null): void
  setSearchSegment(id: string | null): void
  setFxSelection(sel: FxSelection | null): void
}

export const useClipSelection = create<ClipSelectionState>((set) => ({
  textOverlayId: null,
  searchSegmentId: null,
  fxSelection: null,
  setTextOverlay: (id) => set({ textOverlayId: id }),
  setSearchSegment: (id) => set({ searchSegmentId: id }),
  setFxSelection: (sel) => set({ fxSelection: sel }),
}))
