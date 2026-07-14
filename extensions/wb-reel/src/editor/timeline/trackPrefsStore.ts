/**
 * trackPrefsStore —— 逐轨显隐/静音/锁定的全局共享状态(zustand)。
 *
 * 为什么用 store 而不是组件 state + 回调:
 *   时间轴(Timeline)改轨头开关后,画面预览(StagePane 的特效/贴纸/文字/字幕叠层)和
 *   编辑器内「试玩」(Player)都要立刻跟着隐藏/显示。它们分散在不同子树,用一个共享
 *   store 订阅最干净,免去多层 prop 透传。落盘仍走 trackVisibility.ts(含旧 DIA key 兼容)。
 */

import { create } from 'zustand'
import {
  loadTrackPrefs,
  saveTrackPrefs,
  withTrack,
  type TrackKey,
  type TrackPrefs,
  type TrackState,
} from './trackVisibility'

interface TrackPrefsStore {
  prefs: TrackPrefs
  /** 局部更新某轨某字段,落盘并广播。 */
  patch: (key: TrackKey, patch: Partial<TrackState>) => void
  /** 整体替换(用于「全部显示」等批量操作),落盘并广播。 */
  replace: (next: TrackPrefs) => void
  /** 从 localStorage 重新读取(跨窗口/外部变更时)。 */
  reload: () => void
}

export const useTrackPrefsStore = create<TrackPrefsStore>((set, get) => ({
  prefs: loadTrackPrefs(),
  patch: (key, patch) => {
    const next = withTrack(get().prefs, key, patch)
    saveTrackPrefs(next)
    set({ prefs: next })
  },
  replace: (next) => {
    saveTrackPrefs(next)
    set({ prefs: next })
  },
  reload: () => set({ prefs: loadTrackPrefs() }),
}))

/** 选择器:某视觉/音频轨当前是否可见(供 StagePane/Player 叠层 gating)。 */
export function selectTrackVisible(key: TrackKey) {
  return (s: TrackPrefsStore) => s.prefs[key].visible
}
