import { useEffect } from 'react'
import { InspectorPane } from '../editor/InspectorPane'
import { useShellStore } from './shellStore'
import { injectStyleOnce } from '../styles/injectStyle'

/**
 * InspectorDrawer —— 右侧滑出的属性抽屉。
 *
 * 触发方式：
 *   - TopBar 右侧的"Inspector"切换按钮（shellStore.toggleInspector）
 *   - 任何 Tab 内的"Edit Meta"类按钮可主动 setInspectorOpen(true)
 *   - ESC 关闭
 *   - 点击遮罩空白关闭
 *
 * 设计决策：
 *   - 使用 fixed 定位，从 body 层级浮起来，不占 flex 流
 *   - 宽 420px，移动端收缩为 100vw
 *   - 抽屉内容是现有 InspectorPane（保持所有场景属性卡片逻辑不动）
 *   - 关闭时仍挂载 DOM（只改 translateX + pointer-events），避免每次打开重新渲染 InspectorPane
 */
export function InspectorDrawer() {
  const open = useShellStore((s) => s.inspectorOpen)
  const setOpen = useShellStore((s) => s.setInspectorOpen)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const t = e.target as HTMLElement | null
        // 输入框内按 ESC 让组件自己处理
        if (
          t?.tagName === 'INPUT' ||
          t?.tagName === 'TEXTAREA' ||
          t?.isContentEditable
        ) {
          return
        }
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  return (
    <>
      {open && (
        <div
          className="ks-inspector-scrim"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}
      <aside
        className={`ks-inspector-drawer ${open ? 'is-open' : ''}`}
        role="dialog"
        aria-label="场景属性抽屉"
        aria-hidden={!open}
      >
        <header className="ks-inspector-drawer-head">
          <span className="ks-inspector-drawer-title ks-mono">
            INSPECTOR
          </span>
          <button
            type="button"
            className="ks-inspector-drawer-close"
            onClick={() => setOpen(false)}
            aria-label="关闭属性抽屉"
          >
            ×
          </button>
        </header>
        <div className="ks-inspector-drawer-body">
          <InspectorPane />
        </div>
      </aside>
    </>
  )
}

const css = `
.ks-inspector-scrim {
  position: fixed;
  inset: 0;
  background: var(--ks-overlay-scrim);
  backdrop-filter: blur(16px) saturate(150%);
  -webkit-backdrop-filter: blur(16px) saturate(150%);
  z-index: 900;
  animation: ks-drawer-fade 200ms var(--ks-ease);
}
.ks-inspector-drawer {
  position: fixed;
  top: 16px;
  right: 16px;
  bottom: 16px;
  width: 440px;
  max-width: calc(100vw - 32px);
  background: var(--ks-surface-glass);
  backdrop-filter: var(--ks-glass-blur-strong);
  -webkit-backdrop-filter: var(--ks-glass-blur-strong);
  border: 1px solid var(--ks-border);
  border-radius: var(--ks-radius-xl);
  box-shadow: var(--ks-shadow-lift), var(--ks-shadow-inset-hi);
  z-index: 901;
  display: flex;
  flex-direction: column;
  transform: translateX(calc(100% + 24px));
  transition: transform 280ms var(--ks-ease);
  pointer-events: none;
  overflow: hidden;
}
.ks-inspector-drawer.is-open {
  transform: translateX(0);
  pointer-events: auto;
}
.ks-inspector-drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid var(--ks-border-soft);
  flex-shrink: 0;
}
.ks-inspector-drawer-title {
  font-family: var(--ks-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.26em;
  color: var(--ks-amber);
  font-weight: 600;
  text-transform: uppercase;
}
.ks-inspector-drawer-close {
  background: var(--ks-panel-elev);
  border: 1px solid var(--ks-border);
  color: var(--ks-text-soft);
  width: 30px;
  height: 30px;
  border-radius: 50%;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  transition: all var(--ks-dur-fast) var(--ks-ease);
}
.ks-inspector-drawer-close:hover {
  background: var(--ks-amber-soft);
  color: var(--ks-amber);
  border-color: var(--ks-border-strong);
}
.ks-inspector-drawer-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 8px;
}
@keyframes ks-drawer-fade {
  from { opacity: 0; }
  to   { opacity: 1; }
}
`
injectStyleOnce('inspector-drawer', css)
