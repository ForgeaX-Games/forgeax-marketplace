/**
 * onboardingStore —— 新手引导/帮助面板的全局开关（zustand）。
 *
 * 为什么用 store：触发点（时间轴工具栏的「?」按钮、首次进入 SceneDetailDrawer 的自动起
 * tour）与渲染点（挂在 SceneDetailDrawer 的 TimelineTour / HelpPanel）分散在不同子树，
 * 用一个共享 store 免去多层 prop 透传。
 */

import { create } from 'zustand'
import { loadTourSeen, saveTourSeen } from './onboardingPref'

interface OnboardingStore {
  /** 交互式分步引导是否展开。 */
  tourOpen: boolean
  /** 速查/帮助面板是否展开。 */
  helpOpen: boolean
  openTour: () => void
  closeTour: () => void
  /** 跳过/看完 → 记住不再自动弹，并关闭。 */
  finishTour: () => void
  setHelpOpen: (open: boolean) => void
  /** 首次进入时调用：未看过则自动起 tour。 */
  maybeAutoStart: () => void
}

export const useOnboardingStore = create<OnboardingStore>((set) => ({
  tourOpen: false,
  helpOpen: false,
  openTour: () => set({ tourOpen: true }),
  closeTour: () => set({ tourOpen: false }),
  finishTour: () => {
    saveTourSeen(true)
    set({ tourOpen: false })
  },
  setHelpOpen: (open) => set({ helpOpen: open }),
  maybeAutoStart: () => {
    if (!loadTourSeen()) set({ tourOpen: true })
  },
}))
