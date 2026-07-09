// 必须最先求值：把历史 reel-studio* localStorage 键迁移到 gamevideo* 命名空间，
// 早于任何 store 在模块求值期的 hydrate。详见该模块头注。
import './bootMigrateLegacyKeys'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { GraphApp } from './GraphApp'
import { GraphPlayer } from './editor/shell/GraphPlayer'
import { GraphStudio } from './editor/shell/GraphStudio'
import { NODIA_DEMO } from './editor/demo/demo'
import './styles/global.css'

const root = document.getElementById('root')
if (!root) throw new Error('Root element #root not found')

/**
 * 剪贴板兜底：在缺 clipboard-write 权限的 iframe / 非安全上下文里，
 * navigator.clipboard 不可用，退回临时 textarea + execCommand('copy')。
 */
function fallbackCopy(text: string): boolean {
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

/**
 * Top-level ErrorBoundary —— 防止某个子组件 throw 后整棵 App 树静默卸载、
 * 用户只看到一片背景但 console 没有红字（曾经的实测 case：StoryTreeTab
 * 路径下的 commitLayoutEffectOnFiber 抛错被 React 默默 unmount）。
 *
 * 现在出错时：
 *   · 屏幕显示一个明显的红色卡片，列出错误消息和 stack
 *   · 同步 console.error 一遍，方便复制
 *   · 按钮 [复制错误] 把 stack 放剪贴板（iframe 内走 execCommand 兜底）
 *   · 按钮 [清除本地缓存并重载] / [刷新] 恢复
 */
class TopErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null; errorInfo: ErrorInfo | null; copied: boolean }
> {
  override state = {
    error: null as Error | null,
    errorInfo: null as ErrorInfo | null,
    copied: false,
  }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[TopErrorBoundary] caught:', error, errorInfo)
    this.setState({ error, errorInfo })
  }

  private composeStack(): string {
    return `${this.state.error?.message ?? ''}\n\nReact stack:\n${
      this.state.errorInfo?.componentStack ?? '(none)'
    }\n\nJS stack:\n${this.state.error?.stack ?? '(none)'}`
  }

  private handleClearAll = (): void => {
    if (!confirm('清除本地缓存并重新加载？（游戏仍保留在磁盘 .gamevideo-scenarios/ 中）')) return
    try {
      localStorage.removeItem('gamevideo:scenarios:v1')
    } catch { /* best-effort */ }
    location.reload()
  }

  // 工坊在 studio 里以 iframe 嵌入，iframe 缺 clipboard-write 权限时
  // navigator.clipboard.writeText 会被静默拒绝 → 退回 textarea + execCommand。
  private handleCopy = async (): Promise<void> => {
    const text = this.composeStack()
    let ok = false
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        ok = true
      }
    } catch { ok = false }
    if (!ok) ok = fallbackCopy(text)
    if (ok) {
      this.setState({ copied: true })
      window.setTimeout(() => this.setState({ copied: false }), 1800)
    } else {
      alert('复制失败，请手动选中下方「错误详情」里的文本后复制。')
    }
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children

    const stack = this.composeStack()

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
          页面渲染崩溃
        </div>
        <div style={{ marginBottom: 12, color: '#7a2424' }}>
          游戏运行异常。可尝试下方按钮恢复，或复制错误信息反馈给开发。
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
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
            onClick={() => void this.handleCopy()}
            style={{
              padding: '6px 14px',
              borderRadius: 8,
              border: '1px solid #e54d4d',
              background: this.state.copied ? '#e54d4d' : '#fff',
              color: this.state.copied ? '#fff' : '#7a2424',
              cursor: 'pointer',
            }}
          >
            {this.state.copied ? '已复制 ✓' : '复制错误信息'}
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

// 表面路由（新引擎 graph-only）：
//   默认                         → GraphApp（蓝图/视频/界面/规则/试玩 五 tab，新引擎唯一外壳）
//   ?surface=graphstudio        → GraphStudio（单独看蓝图编辑 + 试玩）
//   ?surface=graphplay          → GraphPlayer（纯试玩）
// graph* 表面不套 StrictMode，避免 start() 被双调用重复推进。
const _surface = new URLSearchParams(location.search).get('surface')
if (_surface === 'graphstudio' || _surface === 'graphplay') {
  createRoot(root).render(
    <TopErrorBoundary>
      <div style={{ position: 'fixed', inset: 0 }}>
        {_surface === 'graphplay' ? (
          <GraphPlayer scenario={NODIA_DEMO} />
        ) : (
          <GraphStudio scenario={NODIA_DEMO} />
        )}
      </div>
    </TopErrorBoundary>,
  )
} else {
  createRoot(root).render(
    <TopErrorBoundary>
      <GraphApp />
    </TopErrorBoundary>,
  )
}
