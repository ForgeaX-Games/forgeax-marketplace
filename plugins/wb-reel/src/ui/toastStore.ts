/**
 * `toastStore` —— 全局轻量 toast 机制。
 *
 * 为什么不用 react-hot-toast / sonner 等库：
 *   · reel-studio 是离线内网工具，尽量不新增依赖
 *   · BatchGenBar 已经有一套 .ks-bgb-toast 样式（作者调过手感），新 toast
 *     复用同一视觉，避免并存两种 UI
 *
 * 架构：
 *   · `useToastStore`（zustand）维护 `items: ToastItem[]`
 *   · `useFireToast()` 返回一个稳定引用的 fire(msg, opts) 函数
 *   · `<ToastHost />` 挂到 App 根节点，订阅 store，负责渲染 + 自动过期
 *   · 失败提示支持 kind='error' 染红 + 更长停留
 *
 * 在三处场景用于替换本地 fireToast：
 *   · BatchGenBar   —— 批量生图/视频 start/finish/错误
 *   · PromptTabs    —— SCENE / VIDEO / SHOT 三个 tab 的锻造/生成反馈
 *   · 其他任意组件   —— 只要 `useFireToast()` 就能用
 */
import { create } from 'zustand'

export type ToastKind = 'info' | 'success' | 'error' | 'warning'

export interface ToastItem {
  id: number
  message: string
  kind: ToastKind
  /** 毫秒；超时自动消失 */
  ttl: number
  /** 创建时间戳，用于 ToastHost 倒计时 */
  createdAt: number
}

interface ToastState {
  items: ToastItem[]
  fire: (message: string, opts?: { kind?: ToastKind; ttl?: number }) => number
  dismiss: (id: number) => void
  clear: () => void
}

let _seq = 0

export const useToastStore = create<ToastState>((set) => ({
  items: [],
  fire: (message, opts) => {
    const id = ++_seq
    const kind = opts?.kind ?? 'info'
    // error 停留更久（8s）方便作者截屏排错；其他 3.5s 与 BatchGenBar 旧值一致
    const ttl = opts?.ttl ?? (kind === 'error' ? 8000 : 3500)
    set((s) => ({
      items: [
        ...s.items,
        { id, message, kind, ttl, createdAt: Date.now() },
      ],
    }))
    return id
  },
  dismiss: (id) =>
    set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
  clear: () => set({ items: [] }),
}))

/**
 * 组件级 hook —— 返回"fire 函数"。稳定引用（zustand 的 setter 天生稳定），
 * 可放进 useEffect 依赖不会触发循环。
 *
 * 用法：
 *   const toast = useFireToast()
 *   toast('保存成功')
 *   toast('生成失败: xxx', { kind: 'error' })
 */
export function useFireToast(): ToastState['fire'] {
  return useToastStore((s) => s.fire)
}
