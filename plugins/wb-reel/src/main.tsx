import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles/global.css'

const root = document.getElementById('root')
if (!root) throw new Error('Root element #root not found')

/**
 * Top-level ErrorBoundary —— 防止某个子组件 throw 后整棵 App 树静默卸载、
 * 用户只看到一片背景但 console 没有红字（曾经的实测 case：StoryTreeTab
 * 路径下的 commitLayoutEffectOnFiber 抛错被 React 默默 unmount）。
 *
 * 现在出错时：
 *   · 屏幕显示一个明显的红色卡片，列出错误消息和 stack
 *   · 同步 console.error 一遍，方便复制
 *   · 按钮 [复制错误] 把 stack 放剪贴板
 *   · 按钮 [刷新] 重启
 */
class TopErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null; errorInfo: ErrorInfo | null }
> {
  override state = { error: null as Error | null, errorInfo: null as ErrorInfo | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[TopErrorBoundary] caught:', error, errorInfo)
    this.setState({ error, errorInfo })
  }

  private handleResetScenario = (): void => {
    try {
      const STORAGE_KEY = 'reel-studio:scenarios:v1'
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const db = JSON.parse(raw)
        if (db && typeof db === 'object') {
          db.activeId = null
          localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
        }
      }
    } catch { /* best-effort */ }
    location.reload()
  }

  private handleClearAll = (): void => {
    if (!confirm('清除所有剧本缓存并重新加载？（剧本仍保留在磁盘 .reel-scenarios/ 中）')) return
    try {
      localStorage.removeItem('reel-studio:scenarios:v1')
    } catch { /* best-effort */ }
    location.reload()
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children

    const stack = `${this.state.error.message}\n\nReact stack:\n${
      this.state.errorInfo?.componentStack ?? '(none)'
    }\n\nJS stack:\n${this.state.error.stack ?? '(none)'}`

    return (
      <div
        style={{
          position: 'fixed',
          inset: 16,
          zIndex: 99999,
          padding: 24,
          background: '#fff5f5',
          border: '2px solid #e54d4d',
          borderRadius: 12,
          color: '#3b1313',
          fontFamily: 'ui-monospace, Consolas, monospace',
          fontSize: 13,
          lineHeight: 1.5,
          overflow: 'auto',
          boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>
          reel-studio 渲染崩溃
        </div>
        <div style={{ marginBottom: 12, color: '#7a2424' }}>
          当前剧本数据可能损坏。可尝试下方按钮恢复，或复制 stack 反馈给开发。
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={this.handleResetScenario}
            style={{
              padding: '6px 14px',
              borderRadius: 8,
              border: '1px solid #2563eb',
              background: '#eff6ff',
              color: '#1e40af',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            切换到默认剧本
          </button>
          <button
            type="button"
            onClick={this.handleClearAll}
            style={{
              padding: '6px 14px',
              borderRadius: 8,
              border: '1px solid #d97706',
              background: '#fffbeb',
              color: '#92400e',
              cursor: 'pointer',
            }}
          >
            清除本地缓存并重载
          </button>
          <button
            type="button"
            onClick={() => void navigator.clipboard?.writeText(stack)}
            style={{
              padding: '6px 14px',
              borderRadius: 8,
              border: '1px solid #e54d4d',
              background: '#fff',
              color: '#7a2424',
              cursor: 'pointer',
            }}
          >
            复制错误 stack
          </button>
          <button
            type="button"
            onClick={() => location.reload()}
            style={{
              padding: '6px 14px',
              borderRadius: 8,
              border: '1px solid #888',
              background: '#fff',
              color: '#333',
              cursor: 'pointer',
            }}
          >
            刷新
          </button>
        </div>
        <details style={{ marginBottom: 8 }}>
          <summary style={{ cursor: 'pointer', color: '#7a2424' }}>错误详情</summary>
          <pre
            style={{
              background: '#fff',
              padding: 12,
              border: '1px solid #f0caca',
              borderRadius: 8,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              margin: '8px 0 0',
              maxHeight: 300,
              overflow: 'auto',
            }}
          >
            {stack}
          </pre>
        </details>
      </div>
    )
  }
}

createRoot(root).render(
  <StrictMode>
    <TopErrorBoundary>
      <App />
    </TopErrorBoundary>
  </StrictMode>,
)
