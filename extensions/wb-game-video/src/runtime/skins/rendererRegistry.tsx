/**
 * Player 渲染器 registry —— 按 `kind` / `component`(皮肤 id) 派发**独立 React 组件**（spec §3.3）。
 *
 * 多局并行：每个 GraphSession 持有自己的 `SkinRegistry`；模块级 `register*` / `render*`
 * 仍指向 `defaultSkinRegistry`（编辑器兼容）。
 */
import { Component, createContext, useContext, type ComponentType, type CSSProperties, type ErrorInfo, type ReactNode } from 'react'
import type { OverlaySnap, InteractionSnap, HudSnap } from '../engine/session'
import type { ChoiceParams, HotspotParams } from '../registry/core-kinds'
import { isPlayerFocused } from '../input/playerFocus'

/** 皮肤/HUD 组件渲染时可读的游戏态上下文（vars/entities/score/flags）。 */
export interface SkinCtx {
  hud: HudSnap
}

/** HUD 元素在屏幕上的锚点位置（皮肤自定位用；缺省由皮肤按角色推断）。 */
export type HudPos = 'top-left' | 'top' | 'top-right' | 'bottom-left' | 'bottom' | 'bottom-right'

/** 单个 HUD 元素定义（scenario.ui.hud[i]）——渲染层视图。 */
export interface HudElementView {
  element: string
  show?: 'always' | 'never' | 'battle' | 'qte'
  /** 渲染皮肤组件 id（HUD 皮肤 registry），缺省=内置通用血条/数值。 */
  component?: string
  /** 可选：绑定的实体/变量 id（缺省用 element 本身）。 */
  bind?: string
  label?: string
  accent?: string
  /** 屏幕锚点（皮肤自定位）。 */
  pos?: HudPos
}

// ── 组件 props 契约（每类渲染组件的统一入参）──────────────────────────────────────
export interface OverlayProps {
  overlay: OverlaySnap
}
export interface InteractionProps {
  interaction: InteractionSnap
  submit: (input: unknown) => void
  ctx?: SkinCtx
}
export interface HudProps {
  element: HudElementView
  ctx: SkinCtx
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

  renderOverlay(overlay: OverlaySnap): ReactNode {
    const C = this.overlay.get(overlay.kind)
    if (!C) return null
    return (
      <SkinErrorBoundary key={overlay.elementId} name={overlay.kind}>
        <C overlay={overlay} />
      </SkinErrorBoundary>
    )
  }

  renderInteraction(interaction: InteractionSnap, submit: (input: unknown) => void, ctx?: SkinCtx): ReactNode {
    const component = (interaction.params as { component?: string }).component
    const Skin = component ? this.interaction.get(component) : undefined
    const Default = this.interaction.get(interaction.kind)
    const C = Skin ?? Default
    if (!C) return null
    const name = component ?? interaction.kind
    const props: InteractionProps = { interaction, submit: safe(name, submit), ctx }
    const fallback = Skin && Default && Default !== Skin ? <Default {...props} /> : undefined
    return (
      <SkinErrorBoundary key={`${interaction.elementId}:${name}`} name={name} fallback={fallback}>
        <C {...props} />
      </SkinErrorBoundary>
    )
  }

  renderHudElement(element: HudElementView, ctx: SkinCtx): ReactNode {
    const C = element.component ? this.hud.get(element.component) : undefined
    if (!C) return null
    return (
      <SkinErrorBoundary key={element.element} name={element.component ?? element.element}>
        <C element={element} ctx={ctx} />
      </SkinErrorBoundary>
    )
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
export function renderOverlay(overlay: OverlaySnap): ReactNode {
  return defaultSkinRegistry.renderOverlay(overlay)
}
export function registerInteractionRenderer(kind: string, c: InteractionComponent): void {
  defaultSkinRegistry.registerInteractionRenderer(kind, c)
}
export function registerInteractionSkin(id: string, c: InteractionComponent): void {
  defaultSkinRegistry.registerInteractionSkin(id, c)
}
export function renderInteraction(interaction: InteractionSnap, submit: (input: unknown) => void, ctx?: SkinCtx): ReactNode {
  return defaultSkinRegistry.renderInteraction(interaction, submit, ctx)
}
export function registerHudRenderer(id: string, c: HudComponent): void {
  defaultSkinRegistry.registerHudRenderer(id, c)
}
export function renderHudElement(element: HudElementView, ctx: SkinCtx): ReactNode {
  return defaultSkinRegistry.renderHudElement(element, ctx)
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

function ChoiceButtons({ interaction, submit }: InteractionProps): ReactNode {
  const params = interaction.params as unknown as ChoiceParams
  return (
    <div className="gv-choice-layer" style={bottomRow}>
      {(params.options ?? []).map((o) => (
        <button key={o.key} style={btn('#2563eb')} onClick={() => submit(o.key)}>
          {o.label ?? o.key}
        </button>
      ))}
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
  const params = interaction.params as unknown as HotspotParams
  return (
    <div className="gv-hotspot-layer" style={bottomRow}>
      {(params.hotspots ?? []).map((h) => (
        <button key={h.id} style={btn('#0891b2')} onClick={() => submit(h.id)}>
          {h.label ?? h.id}
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
  const p = overlay.params as { durationMs?: number; color?: string }
  const dur = p.durationMs ?? 600
  return (
    <div
      className="gv-transition"
      style={{ position: 'absolute', inset: 0, background: p.color ?? '#000', pointerEvents: 'none', animation: `gv-transition ${dur}ms ease-in-out forwards` }}
    />
  )
}

function DialogueOverlay({ overlay }: OverlayProps): ReactNode {
  const p = overlay.params as { speaker?: string; text?: string; color?: string }
  return (
    <div
      className="gv-dialogue"
      style={{ position: 'absolute', left: '8%', right: '8%', bottom: '10%', padding: '12px 16px', borderRadius: 12, background: 'rgba(12,14,18,0.82)', border: '1px solid rgba(255,255,255,0.12)', color: '#f0f0f0', pointerEvents: 'none', boxShadow: '0 6px 24px rgba(0,0,0,0.5)' }}
    >
      {p.speaker && <div style={{ fontWeight: 700, fontSize: 13, color: p.color ?? '#ffd54a', marginBottom: 4 }}>{p.speaker}</div>}
      <div style={{ fontSize: 15, lineHeight: 1.5 }}>{p.text}</div>
    </div>
  )
}

function FloatTextOverlay({ overlay }: OverlayProps): ReactNode {
  const p = overlay.params as { text?: string; x?: number; y?: number; color?: string; durationMs?: number }
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
