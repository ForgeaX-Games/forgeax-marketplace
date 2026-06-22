/**
 * `<ToastHost />` —— 全局 toast 渲染器。挂到 App 顶层，固定右上角堆叠。
 *
 * 设计：
 *   · 一次最多显示 4 条（更多的静默排队；当前其实用不到）
 *   · 每条自己带 ttl 倒计时；超时自动从 store dismiss
 *   · error 染红框 + 加粗文字，让作者一眼区分"噪声"与"真故障"
 *   · 点击条目可立刻关闭
 *   · 样式内联（≤50 行），不新增 CSS 文件；颜色用 theme 变量
 */
import { useEffect, useRef } from 'react'
import { useToastStore, type ToastItem } from './toastStore'
import { injectStyleOnce } from '../styles/injectStyle'

injectStyleOnce(
  'reel-toast-host',
  /* css */ `
.ks-toast-host {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none; /* 容器透传点击；单个 toast 自己 enable */
}
.ks-toast {
  pointer-events: auto;
  max-width: 420px;
  padding: 10px 14px;
  border-radius: 10px;
  font-family: var(--ks-font-cn, var(--ks-font-ui));
  font-size: 12.5px;
  line-height: 1.5;
  background: var(--ks-panel-solid);
  color: var(--ks-text);
  border: 1px solid var(--ks-border);
  box-shadow: var(--ks-shadow-lift);
  cursor: pointer;
  animation: ks-toast-in 180ms var(--ks-ease);
  white-space: pre-wrap;
  word-break: break-word;
}
.ks-toast.ks-t-success { border-color: color-mix(in oklab, #3ad07a 60%, var(--ks-border)); }
.ks-toast.ks-t-warning { border-color: color-mix(in oklab, #e6b200 60%, var(--ks-border)); }
.ks-toast.ks-t-error {
  border-color: color-mix(in oklab, #e54d4d 70%, var(--ks-border));
  background: color-mix(in oklab, #e54d4d 10%, var(--ks-panel-solid));
  font-weight: 500;
}
@keyframes ks-toast-in {
  from { opacity: 0; transform: translateY(-6px); }
  to   { opacity: 1; transform: translateY(0); }
}
`,
)

export function ToastHost(): JSX.Element | null {
  const items = useToastStore((s) => s.items)
  const dismiss = useToastStore((s) => s.dismiss)

  // 为每一条 item 注册一次性的 timeout（下次这条不在列表里自动清）
  const timers = useRef<Map<number, number>>(new Map())
  useEffect(() => {
    const alive = new Set(items.map((i) => i.id))
    // 已消失的定时器清掉
    for (const [id, t] of timers.current) {
      if (!alive.has(id)) {
        window.clearTimeout(t)
        timers.current.delete(id)
      }
    }
    // 新加的注册
    for (const item of items) {
      if (timers.current.has(item.id)) continue
      const remaining = Math.max(
        0,
        item.ttl - (Date.now() - item.createdAt),
      )
      const t = window.setTimeout(() => dismiss(item.id), remaining)
      timers.current.set(item.id, t)
    }
    return () => {
      // 不在 return 里清全部：下一次 effect 会接着 diff
    }
  }, [items, dismiss])

  // 组件卸载时清全部
  useEffect(() => {
    const map = timers.current
    return () => {
      for (const t of map.values()) window.clearTimeout(t)
      map.clear()
    }
  }, [])

  if (items.length === 0) return null
  // 最多显示最新 4 条（旧的仍在 store 里倒计时，只是不渲染）
  const visible = items.slice(-4)
  return (
    <div className="ks-toast-host" role="status" aria-live="polite">
      {visible.map((it) => (
        <ToastOne key={it.id} item={it} onDismiss={() => dismiss(it.id)} />
      ))}
    </div>
  )
}

function ToastOne({
  item,
  onDismiss,
}: {
  item: ToastItem
  onDismiss: () => void
}): JSX.Element {
  return (
    <div
      className={`ks-toast ks-t-${item.kind}`}
      onClick={onDismiss}
      title="点击关闭"
    >
      {item.message}
    </div>
  )
}
