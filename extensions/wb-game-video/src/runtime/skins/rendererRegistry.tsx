/**
 * Player 渲染器 registry —— 按 `component`（顶层组件 id）派发**独立 React 组件**。
 *
 * 全部组件统一 overlay 表（含原 interaction）；事件经 `emit` → session.emitEvent。
 */
import { Component, createContext, useContext, type ComponentType, type CSSProperties, type ErrorInfo, type ReactNode } from 'react'
import type { OverlaySnap, OverlayMountSnap, HudSnap } from '../engine/session'
import type { ConditionTarget } from '../engine/condition'
import { childWrapStyle, layoutHasExplicitSize, mountWrapStyle } from '../schema/layout'
import { isPlayerFocused } from '../input/playerFocus'

/** 皮肤组件渲染时可读的游戏态上下文（vars/entities/score/flags）。 */
export interface SkinCtx {
  hud: HudSnap
  /**
   * 选项门控求值目标（与引擎 condition 同源）。
   * 试玩面应注入 `runtime.state`；缺省时 `isOptionLocked` 用 hud 拼弱化态。
   */
  condition?: ConditionTarget
}

export interface OverlayProps {
  overlay: OverlaySnap
  /** 组件事件（点击 / 判定 / 超时）；由试玩面注入，路由到 session.emitEvent。 */
  emit?: (key: string) => void
  /** 绘制时 resolve（battleHpBar / floatText expr）与选项门控。 */
  ctx?: SkinCtx
  /** 编辑器预览。 */
  preview?: boolean
  previewTimeMs?: number
}
export type OverlayComponent = ComponentType<OverlayProps>

/** Player 根节点（供交互皮做焦点门控）。由 GraphPlayer / PlaySurface 注入。 */
export const PlayerRootContext = createContext<HTMLElement | null>(null)

/** 交互皮 keydown 前调用：仅当前焦点 Player 放行。 */
export function usePlayerKeyGate(): (e?: KeyboardEvent) => boolean {
  const root = useContext(PlayerRootContext)
  return () => isPlayerFocused(root)
}

function SkinErrorChip({ name, message }: { name: string; message: string }): ReactNode {
  return (
    <div
      style={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 999, maxWidth: '80%', padding: '6px 12px', borderRadius: 8, background: 'rgba(120,20,20,0.92)', border: '1px solid #ff6b6b', color: '#ffdede', fontSize: 12, pointerEvents: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.5)' }}
    >
      ⚠ 组件「{name}」渲染出错（已隔离，不影响流程）：{message}
    </div>
  )
}

class SkinErrorBoundary extends Component<{ name: string; fallback?: ReactNode; children: ReactNode }, { err: Error | null }> {
  override state: { err: Error | null } = { err: null }
  static getDerivedStateFromError(err: Error): { err: Error } {
    return { err }
  }
  override componentDidCatch(err: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error(`[skin:${this.props.name}] 渲染出错，已隔离：`, err, info?.componentStack)
  }
  override render(): ReactNode {
    if (this.state.err) {
      return (
        <>
          {this.props.fallback}
          <SkinErrorChip name={this.props.name} message={this.state.err.message} />
        </>
      )
    }
    return this.props.children
  }
}

/** 可注入的 Overlay 渲染表（每局 Session 一份）。 */
export class SkinRegistry {
  private readonly overlay = new Map<string, OverlayComponent>()

  registerOverlayRenderer(kind: string, c: OverlayComponent): void {
    this.overlay.set(kind, c)
  }
  /** 是否已注册 overlay 渲染器。 */
  hasOverlayRenderer(id: string): boolean {
    return this.overlay.has(id)
  }

  /**
   * 渲染一份挂载的全部 children。
   * 舞台尺寸由 OverlayNode.layout / OverlayChild.layout 配置（如 `STAGE_FILL_LAYOUT`）。
   */
  renderOverlayMount(
    mount: OverlayMountSnap,
    emit?: (elementId: string, key: string) => void,
    ctx?: SkinCtx,
  ): ReactNode {
    const mountHasSize = layoutHasExplicitSize(mount.mountLayout)
    const wrapStyle: CSSProperties = mountWrapStyle(mount.mountLayout)
    return (
      <div key={mount.mountId} style={wrapStyle}>
        {mount.children.map((child) => {
          const C = this.overlay.get(child.component)
          if (!C) return null
          const snap: OverlaySnap = {
            elementId: child.elementId,
            component: child.component,
            inputs: child.inputs,
          }
          const childWrap: CSSProperties = childWrapStyle(child.childLayout, mountHasSize)
          return (
            <div key={child.elementId} style={childWrap}>
              <SkinErrorBoundary name={child.component}>
                <C
                  overlay={snap}
                  emit={(key) => emit?.(child.elementId, key)}
                  ctx={ctx}
                />
              </SkinErrorBoundary>
            </div>
          )
        })}
      </div>
    )
  }

  /** @deprecated 用 renderOverlayMount */
  renderOverlay(
    overlay: OverlaySnap,
    emit?: (key: string) => void,
    preview?: { timeMs?: number },
    ctx?: SkinCtx,
  ): ReactNode {
    const C = this.overlay.get(overlay.component)
    if (!C) return null
    return (
      <SkinErrorBoundary key={overlay.elementId} name={overlay.component}>
        <C
          overlay={overlay}
          emit={emit}
          ctx={ctx}
          preview={!!preview}
          previewTimeMs={preview?.timeMs}
        />
      </SkinErrorBoundary>
    )
  }

  /**
   * @deprecated 默认渲染器已迁到 `skins/components/*`，由 `createCoreSkinRegistry` /
   * `registerCoreSkins` 安装。保留为空操作以免旧调用方炸。
   */
  registerCoreRenderers(): void {}
}

export const defaultSkinRegistry = new SkinRegistry()

export function registerOverlayRenderer(kind: string, c: OverlayComponent): void {
  defaultSkinRegistry.registerOverlayRenderer(kind, c)
}
export function renderOverlayMount(
  mount: OverlayMountSnap,
  emit?: (elementId: string, key: string) => void,
  ctx?: SkinCtx,
): ReactNode {
  return defaultSkinRegistry.renderOverlayMount(mount, emit, ctx)
}
export function renderOverlay(
  overlay: OverlaySnap,
  emit?: (key: string) => void,
  preview?: { timeMs?: number },
  ctx?: SkinCtx,
): ReactNode {
  return defaultSkinRegistry.renderOverlay(overlay, emit, preview, ctx)
}
/** @deprecated 见 `SkinRegistry.registerCoreRenderers`；请用 `registerCoreSkins()`。 */
export function registerCoreRenderers(): void {
  defaultSkinRegistry.registerCoreRenderers()
}
