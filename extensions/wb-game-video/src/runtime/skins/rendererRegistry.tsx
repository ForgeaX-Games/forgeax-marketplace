/**
 * Player 渲染器 registry —— 按 `component`（顶层组件 id）派发**独立 React 组件**（spec §3.3）。
 *
 * 多局并行：每个 GraphSession 持有自己的 `SkinRegistry`；模块级 `register*` / `render*`
 * 仍指向 `defaultSkinRegistry`（编辑器兼容）。
 */
import { Component, createContext, useContext, type ComponentType, type CSSProperties, type ErrorInfo, type ReactNode } from 'react'
import type { OverlaySnap, OverlayChildSnap, OverlayMountSnap, InteractionSnap, HudSnap } from '../engine/session'
import type { ConditionTarget } from '../engine/condition'
import type { Layout } from '../schema/node-config-schema'
import { childWrapStyle, layoutHasExplicitSize, layoutIsEffectivelyEmpty, layoutToCss, mountWrapStyle } from '../schema/layout'
import type { ChoiceParams, HotspotParams } from '../registry/core-components'
import { isPlayerFocused } from '../input/playerFocus'
import { isOptionLocked } from './optionLock'

/** 皮肤/HUD 组件渲染时可读的游戏态上下文（vars/entities/score/flags）。 */
export interface SkinCtx {
  hud: HudSnap
  /**
   * 选项门控求值目标（与引擎 condition 同源）。
   * 试玩面应注入 `runtime.state`；缺省时 `isOptionLocked` 用 hud 拼弱化态。
   */
  condition?: ConditionTarget
}

/** HUD 元素在屏幕上的锚点位置（皮肤自定位用；缺省由皮肤按角色推断）。 */
export type HudPos = 'top-left' | 'top' | 'top-right' | 'bottom-left' | 'bottom' | 'bottom-right'

/** 单个 HUD 元素定义 —— 渲染层视图。 */
export interface HudElementView {
  element: string
  show?: 'always' | 'never' | 'battle' | 'qte'
  /** 渲染皮肤组件 id（HUD 皮肤 registry），缺省=内置通用血条/数值。 */
  component?: string
  /** 可选：绑定的实体/变量 id（缺省用 element 本身）。 */
  bind?: string
  /** 绑定的属性名（缺省 hp；来自 OverlayChild.inputs.attr）。 */
  attr?: string
  label?: string
  accent?: string
  /** @deprecated 用 layout（CSS inset）；皮肤内硬编码定位的遗留字段。 */
  pos?: HudPos
  /** OverlayChild.layout；有则外包一层绝对定位。 */
  layout?: Layout
}

// ── 组件 props 契约（每类渲染组件的统一入参）──────────────────────────────────────
export interface OverlayProps {
  overlay: OverlaySnap
  /** 展示组件的非阻塞事件回调（按钮点击等）；由试玩面注入，路由到 session.emitEvent。 */
  emit?: (key: string) => void
  /** 编辑器预览：纯 CSS 动画已由宿主 `.gc-preview-clock.is-paused` 统一冻住，多数皮肤无需接这两个。 */
  preview?: boolean
  previewTimeMs?: number
}
export interface InteractionProps {
  interaction: InteractionSnap
  submit: (input: unknown) => void
  ctx?: SkinCtx
  /** 编辑器预览：由 previewTimeMs 驱动显隐/动画冻结，不吃键、不 submit。 */
  preview?: boolean
  previewTimeMs?: number
}
export interface HudProps {
  element: HudElementView
  ctx: SkinCtx
  /** 编辑器预览：同 OverlayProps，多数 HUD 皮肤（常驻血条等）无需接。 */
  preview?: boolean
  previewTimeMs?: number
}
export type OverlayComponent = ComponentType<OverlayProps>
export type InteractionComponent = ComponentType<InteractionProps>
export type HudComponent = ComponentType<HudProps>

/** Player 根节点（供交互皮做焦点门控）。由 GraphPlayer / PlaySurface 注入。 */
export const PlayerRootContext = createContext<HTMLElement | null>(null)

/** 交互皮 keydown 前调用：仅当前焦点 Player 放行。 */
export function usePlayerKeyGate(): (e?: KeyboardEvent) => boolean {
  const root = useContext(PlayerRootContext)
  return () => isPlayerFocused(root)
}

// ── 错误隔离：坏组件只提示、不拖垮引擎 ──────────────────────────────────────────
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

function safe(name: string, submit: (input: unknown) => void): (input: unknown) => void {
  return (input) => {
    try {
      submit(input)
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`[skin:${name}] submit 出错，已隔离：`, e)
    }
  }
}

/** 可注入的 Overlay / Interaction / HUD 渲染表（每局 Session 一份）。 */
export class SkinRegistry {
  private readonly overlay = new Map<string, OverlayComponent>()
  private readonly interaction = new Map<string, InteractionComponent>()
  private readonly hud = new Map<string, HudComponent>()
  private coreRenderersRegistered = false

  registerOverlayRenderer(kind: string, c: OverlayComponent): void {
    this.overlay.set(kind, c)
  }
  registerInteractionRenderer(kind: string, c: InteractionComponent): void {
    this.interaction.set(kind, c)
  }
  registerInteractionSkin(id: string, c: InteractionComponent): void {
    this.interaction.set(id, c)
  }
  registerHudRenderer(id: string, c: HudComponent): void {
    this.hud.set(id, c)
  }
  /** 是否已注册 HUD 皮肤（预览分流用；与 ComponentDef.surface 解耦）。 */
  hasHudRenderer(id: string): boolean {
    return this.hud.has(id)
  }
  /** 是否已注册表现层 overlay 渲染器。 */
  hasOverlayRenderer(id: string): boolean {
    return this.overlay.has(id)
  }
  /** 是否已注册交互/皮肤渲染器。 */
  hasInteractionRenderer(id: string): boolean {
    return this.interaction.has(id)
  }

  /**
   * 渲染一份挂载的全部 children。
   * - 表现层（dialogue / floatText …）走 overlay 表；
   * - **HUD（battleHpBar 等）走 hud 表**：引擎仍把它们放进 overlayMounts（enter 即发射），
   *   但皮肤注册在 hud registry——无 ctx 时只能静默跳过，试玩必须传入 `{ hud }`。
   */
  /** 子项是否「舞台锚定」：自定位表现层（floatText 用 x/y）或走 hud 表的皮肤（血条按 CSS 角锚定舞台）。 */
  private isStageAnchoredChild(child: OverlayChildSnap): boolean {
    if (this.overlay.get(child.component)) return !!child.selfPositioned
    return !!this.hud.get(child.component)
  }

  renderOverlayMount(
    mount: OverlayMountSnap,
    emit?: (elementId: string, key: string) => void,
    ctx?: SkinCtx,
  ): ReactNode {
    const mountHasSize = layoutHasExplicitSize(mount.mountLayout)
    // 无显式 layout 且含舞台锚定子项（HUD 血条 / 自定位飘字）→ 挂载盒必须铺满舞台，否则 fit-content 会塌成
    // 左上角 0×0，子项的角锚定（right/bottom/left:50%…）相对 0×0 盒解析 → 跑到屏幕外/挤到左上角。
    const stageAnchored =
      layoutIsEffectivelyEmpty(mount.mountLayout) && mount.children.some((c) => this.isStageAnchoredChild(c))
    const wrapStyle: CSSProperties = stageAnchored
      ? { position: 'absolute', inset: 0, pointerEvents: 'none' }
      : mountWrapStyle(mount.mountLayout)
    return (
      <div key={mount.mountId} style={wrapStyle}>
        {mount.children.map((child) => {
          const C = this.overlay.get(child.component)
          if (C) {
            const snap: OverlaySnap = {
              elementId: child.elementId,
              component: child.component,
              inputs: child.inputs,
            }
            // 自定位组件（floatText 等用 x/y）：子盒铺满挂载盒且点击穿透，
            // 让组件内部的百分比相对完整父框解析（否则会塌成左上角、被裁切）。
            const wrapStyle: CSSProperties = child.selfPositioned
              ? { position: 'absolute', inset: 0, pointerEvents: 'none' }
              : childWrapStyle(child.childLayout, mountHasSize)
            return (
              <div key={child.elementId} style={wrapStyle}>
                <SkinErrorBoundary name={child.component}>
                  <C overlay={snap} emit={(key) => emit?.(child.elementId, key)} />
                </SkinErrorBoundary>
              </div>
            )
          }
          // HUD 回退：挂载的静态方案（血条/气力）等 surface:'hud' 组件不在 overlay 表。
          if (ctx) {
            const inputs = child.inputs as { bind?: string; label?: string; accent?: string }
            const Hud = this.hud.get(child.component)
            if (Hud) {
              const bind = typeof inputs.bind === 'string' ? inputs.bind : child.elementId
              const el: HudElementView = {
                element: bind,
                component: child.component,
                bind,
                label: typeof inputs.label === 'string' ? inputs.label : undefined,
                accent: typeof inputs.accent === 'string' ? inputs.accent : undefined,
                layout: child.childLayout,
              }
              return (
                <span key={child.elementId} style={{ display: 'contents' }}>
                  {this.renderHudElement(el, ctx)}
                </span>
              )
            }
          }
          return null
        })}
      </div>
    )
  }

  /** @deprecated 用 renderOverlayMount */
  renderOverlay(overlay: OverlaySnap, emit?: (key: string) => void, preview?: { timeMs?: number }): ReactNode {
    const C = this.overlay.get(overlay.component)
    if (!C) return null
    return (
      <SkinErrorBoundary key={overlay.elementId} name={overlay.component}>
        <C overlay={overlay} emit={emit} preview={!!preview} previewTimeMs={preview?.timeMs} />
      </SkinErrorBoundary>
    )
  }

  renderInteraction(interaction: InteractionSnap, submit: (input: unknown) => void, ctx?: SkinCtx, preview?: { timeMs?: number }): ReactNode {
    const C = this.interaction.get(interaction.component)
    if (!C) return null
    const name = interaction.component
    const props: InteractionProps = {
      interaction,
      submit: safe(name, submit),
      ctx,
      preview: !!preview,
      previewTimeMs: preview?.timeMs,
    }
    return (
      <SkinErrorBoundary key={`${interaction.elementId}:${name}`} name={name}>
        <C {...props} />
      </SkinErrorBoundary>
    )
  }

  renderHudElement(element: HudElementView, ctx: SkinCtx, preview?: { timeMs?: number }): ReactNode {
    const C = element.component ? this.hud.get(element.component) : undefined
    if (!C) return null
    const body = (
      <SkinErrorBoundary key={element.element} name={element.component ?? element.element}>
        <C element={element} ctx={ctx} preview={!!preview} previewTimeMs={preview?.timeMs} />
      </SkinErrorBoundary>
    )
    if (!element.layout) return body
    const hasBox = element.layout.width != null || element.layout.height != null
      || (element.layout.left != null && element.layout.right != null)
      || (element.layout.top != null && element.layout.bottom != null)
    const wrapStyle: CSSProperties = hasBox
      ? { ...layoutToCss(element.layout), pointerEvents: 'none' }
      : { position: 'absolute', inset: 0, pointerEvents: 'none' }
    return <div style={wrapStyle}>{body}</div>
  }

  /** 注册核心 kind 默认渲染器（对本实例幂等）。 */
  registerCoreRenderers(): void {
    if (this.coreRenderersRegistered) return
    this.coreRenderersRegistered = true
    ensureFloatStyle()
    ensureTransitionStyle()
    this.registerInteractionRenderer('choice', ChoiceButtons)
    this.registerInteractionRenderer('skill', ChoiceButtons)
    this.registerInteractionRenderer('qte', QteButtons)
    this.registerInteractionRenderer('hotspot', HotspotButtons)
    this.registerOverlayRenderer('floatText', FloatTextOverlay)
    this.registerOverlayRenderer('transition', TransitionOverlay)
    this.registerOverlayRenderer('dialogue', DialogueOverlay)
  }
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
export function renderOverlay(overlay: OverlaySnap, emit?: (key: string) => void, preview?: { timeMs?: number }): ReactNode {
  return defaultSkinRegistry.renderOverlay(overlay, emit, preview)
}
export function registerInteractionRenderer(kind: string, c: InteractionComponent): void {
  defaultSkinRegistry.registerInteractionRenderer(kind, c)
}
export function registerInteractionSkin(id: string, c: InteractionComponent): void {
  defaultSkinRegistry.registerInteractionSkin(id, c)
}
export function renderInteraction(
  interaction: InteractionSnap,
  submit: (input: unknown) => void,
  ctx?: SkinCtx,
  preview?: { timeMs?: number },
): ReactNode {
  return defaultSkinRegistry.renderInteraction(interaction, submit, ctx, preview)
}
export function registerHudRenderer(id: string, c: HudComponent): void {
  defaultSkinRegistry.registerHudRenderer(id, c)
}
export function renderHudElement(element: HudElementView, ctx: SkinCtx, preview?: { timeMs?: number }): ReactNode {
  return defaultSkinRegistry.renderHudElement(element, ctx, preview)
}
export function registerCoreRenderers(): void {
  defaultSkinRegistry.registerCoreRenderers()
}

// ── 核心 kind 的默认渲染组件 ──────────────────────────────────────────────────
const btn = (bg: string): CSSProperties => ({
  padding: '8px 16px',
  borderRadius: 10,
  border: 'none',
  background: bg,
  color: '#fff',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
})

const bottomRow: CSSProperties = { position: 'absolute', left: 0, right: 0, bottom: '7%', display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', pointerEvents: 'auto' }

/**
 * 归一化锚点（0~1，画面中心 0.5,0.5）→ 居中于该点的绝对定位样式。
 * 与编辑器预览拖拽手柄（`activePreviewOverlaysFromNode` / `GraphVideoView` 的 `o.x/o.y`）用同一套坐标语义，
 * 保证「预览手柄在哪、试玩/成片就画在哪」——这两处历史上各写各的定位 CSS，是「拖动手柄能动、真实呈现不动」的根因。
 */
function anchorStyle(x: number, y: number, extra?: CSSProperties): CSSProperties {
  return {
    position: 'absolute',
    left: `${x * 100}%`,
    top: `${y * 100}%`,
    transform: 'translate(-50%, -50%)',
    maxWidth: '84%',
    ...extra,
  }
}

/** x/y 均为有限数字才算「有锚点」；否则回退各组件自带的固定布局（历史默认样式不变）。 */
function hasAnchor(x: unknown, y: unknown): x is number {
  return typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y)
}

function ChoiceButtons({ interaction, submit, ctx }: InteractionProps): ReactNode {
  const inputs = interaction.inputs as unknown as ChoiceParams
  const rowStyle = hasAnchor(inputs.x, inputs.y)
    ? anchorStyle(inputs.x as number, inputs.y as number, { display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', pointerEvents: 'auto' })
    : bottomRow
  return (
    <div className="gv-choice-layer" style={rowStyle}>
      {(inputs.events ?? []).map((e) => {
        const locked = isOptionLocked(e, ctx)
        return (
          <button
            key={e.id}
            style={{ ...btn('#2563eb'), ...(locked ? { opacity: 0.4, cursor: 'not-allowed' } : null) }}
            disabled={locked}
            onClick={() => { if (!locked) submit(e.id) }}
          >
            {e.label ?? e.id}
          </button>
        )
      })}
    </div>
  )
}

function QteButtons({ submit }: InteractionProps): ReactNode {
  return (
    <div className="gv-qte-layer" style={bottomRow}>
      <button style={btn('#16a34a')} onClick={() => submit('pass')}>完美</button>
      <button style={btn('#65a30d')} onClick={() => submit('good')}>成功</button>
      <button style={btn('#dc2626')} onClick={() => submit('fail')}>失败</button>
    </div>
  )
}

function HotspotButtons({ interaction, submit }: InteractionProps): ReactNode {
  const inputs = interaction.inputs as unknown as HotspotParams
  const spots = inputs.events ?? []
  const positioned = spots.some((e) => typeof e.x === 'number' || typeof e.y === 'number')
  if (!positioned) {
    return (
      <div className="gv-hotspot-layer" style={bottomRow}>
        {spots.map((e) => (
          <button key={e.id} style={btn('#0891b2')} onClick={() => submit(e.id)}>
            {e.label ?? e.id}
          </button>
        ))}
      </div>
    )
  }
  return (
    <div className="gv-hotspot-layer" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {spots.map((e) => (
        <button
          key={e.id}
          style={{
            ...btn('#0891b2'),
            position: 'absolute',
            left: `${(e.x ?? 0.5) * 100}%`,
            top: `${(e.y ?? 0.5) * 100}%`,
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'auto',
          }}
          onClick={() => submit(e.id)}
        >
          {e.label ?? e.id}
        </button>
      ))}
    </div>
  )
}

function ensureFloatStyle(): void {
  if (typeof document === 'undefined' || document.getElementById('gv-float-style')) return
  const s = document.createElement('style')
  s.id = 'gv-float-style'
  s.textContent =
    '@keyframes gv-floatup{0%{opacity:0;transform:translate(-50%,-20%) scale(0.9)}15%{opacity:1;transform:translate(-50%,-60%) scale(1.1)}100%{opacity:0;transform:translate(-50%,-140%) scale(1)}}'
  document.head.appendChild(s)
}

function ensureTransitionStyle(): void {
  if (typeof document === 'undefined' || document.getElementById('gv-transition-style')) return
  const s = document.createElement('style')
  s.id = 'gv-transition-style'
  s.textContent = '@keyframes gv-transition{0%{opacity:0}20%{opacity:1}80%{opacity:1}100%{opacity:0}}'
  document.head.appendChild(s)
}

function TransitionOverlay({ overlay }: OverlayProps): ReactNode {
  const p = overlay.inputs as { durationMs?: number; color?: string }
  const dur = p.durationMs ?? 600
  return (
    <div
      className="gv-transition"
      style={{ position: 'absolute', inset: 0, background: p.color ?? '#000', pointerEvents: 'none', animation: `gv-transition ${dur}ms ease-in-out forwards` }}
    />
  )
}

const dialogueBoxStyle: CSSProperties = {
  padding: '12px 16px',
  borderRadius: 12,
  background: 'rgba(12,14,18,0.82)',
  border: '1px solid rgba(255,255,255,0.12)',
  color: '#f0f0f0',
  pointerEvents: 'none',
  boxShadow: '0 6px 24px rgba(0,0,0,0.5)',
}

function DialogueOverlay({ overlay }: OverlayProps): ReactNode {
  const p = overlay.inputs as { speaker?: string; text?: string; color?: string; x?: number; y?: number }
  const boxPos = hasAnchor(p.x, p.y)
    ? anchorStyle(p.x as number, p.y as number)
    : { position: 'absolute', left: '8%', right: '8%', bottom: '10%' } as CSSProperties
  return (
    <div className="gv-dialogue" style={{ ...boxPos, ...dialogueBoxStyle }}>
      {p.speaker && <div style={{ fontWeight: 700, fontSize: 13, color: p.color ?? '#ffd54a', marginBottom: 4 }}>{p.speaker}</div>}
      <div style={{ fontSize: 15, lineHeight: 1.5 }}>{p.text}</div>
    </div>
  )
}

function FloatTextOverlay({ overlay }: OverlayProps): ReactNode {
  const p = overlay.inputs as { text?: string; x?: number; y?: number; color?: string; durationMs?: number }
  const dur = p.durationMs ?? 1100
  const neg = typeof p.text === 'string' && p.text.trim().startsWith('-')
  return (
    <div
      className="gv-float-text"
      style={{ position: 'absolute', left: `${(p.x ?? 0.5) * 100}%`, top: `${(p.y ?? 0.42) * 100}%`, color: p.color ?? (neg ? '#ff5a5a' : '#ffd54a'), fontWeight: 800, fontSize: 28, textShadow: '0 2px 6px rgba(0,0,0,0.8)', pointerEvents: 'none', whiteSpace: 'nowrap', animation: `gv-floatup ${dur}ms ease-out forwards` }}
    >
      {p.text}
    </div>
  )
}
