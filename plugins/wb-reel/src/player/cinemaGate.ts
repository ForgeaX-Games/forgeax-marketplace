import { useEffect } from 'react'
import { create } from 'zustand'

/**
 * cinemaGate —— 电影模式"禁入闸门"
 *
 * 作用：让需要玩家注意的浮层（选择层 / 结算屏 / QTE 高峰 / 菜单抽屉）
 * 可以在挂载 / 打开时**暂停**电影模式，即使玩家此刻没动鼠标也要让 UI 常驻。
 *
 * 典型调用：
 *   useCinemaHold(open)   // open=true 时占一个计数，false 或卸载时释放
 *
 * App 顶层订阅 `holds > 0` → 强制 is-cinema=false，并且阻止 idle timer 再激活。
 *
 * 为什么是计数器而不是布尔：可能同时多个 overlay（比如 PlayerMenu + ChoiceLayer
 * 叠加，或 PlayerMenu + SettlementOverlay 交替），各自管理自己的 hold，
 * 不必知道别人是不是也在 hold。全部 release 才允许进入 cinema。
 */
interface CinemaGateState {
  holds: number
  hold: () => void
  release: () => void
}

export const useCinemaGate = create<CinemaGateState>((set) => ({
  holds: 0,
  hold: () => set((s) => ({ holds: s.holds + 1 })),
  release: () => set((s) => ({ holds: Math.max(0, s.holds - 1) })),
}))

/**
 * React hook 语法糖：`active` 为 true 时占一个 hold，false/卸载时释放。
 * 调用方不需要手动管 counter 对称。
 */
export function useCinemaHold(active: boolean): void {
  useEffect(() => {
    if (!active) return
    useCinemaGate.getState().hold()
    return () => {
      useCinemaGate.getState().release()
    }
  }, [active])
}
