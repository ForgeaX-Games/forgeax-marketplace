/**
 * Player 渲染器 registry —— 按 `kind` / `component`(皮肤 id) 派发**独立 React 组件**（spec §3.3）。
 *
 * 关键：注册的是**组件类型**（不是被直接调用的函数）。渲染时以 `<Comp key=.. {...props}/>` 挂成子元素——
 * 每个组件有自己的 fiber/hook 作用域，可自由用 useState/useEffect 等（自闭环、可独立运行、可被用户替换的组件）。
 * 若把组件当普通函数调用（内联进父组件），其 hooks 会算作父组件的 → 交互出现/消失时 hook 数变化会崩
 * （"Rendered more hooks than during the previous render"）。故一律走元素化渲染。
 *
 * 三张表：overlay(表现层) / interaction(交互层) / hud(HUD 皮肤)。加新玩法/皮肤 = 注册一个组件，不改 Player 主体。
 */
import { Component, type ComponentType, type CSSProperties, type ErrorInfo, type ReactNode } from 'react'
import type { OverlaySnap, InteractionSnap, HudSnap } from '../session'
import type { ChoiceParams, HotspotParams } from '../core-kinds'

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

// ── 错误隔离：坏组件只提示、不拖垮引擎 ──────────────────────────────────────────
// 这些组件只是「盖在视频上的展示层」，绝不应因某个（可能来自用户）组件抛错就把整个 Player/引擎搞崩。
// 用 React error boundary 捕获其**渲染/生命周期**异常 → 渲染一个可见的错误提示（并可回退到默认组件），
// 主状态机逻辑不受影响。注意：事件回调/RAF/setTimeout 里的异步错误 boundary 抓不到，故 submit 也包一层 try/catch。
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

/** 包一层 try/catch，防止组件 submit/事件回调里抛错冒泡打断引擎驱动。 */
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

// ── overlay 渲染器 ────────────────────────────────────────────────────────────
const OVERLAY = new Map<string, OverlayComponent>()
export function registerOverlayRenderer(kind: string, c: OverlayComponent): void {
  OVERLAY.set(kind, c)
}
export function renderOverlay(overlay: OverlaySnap): ReactNode {
  const C = OVERLAY.get(overlay.kind)
  if (!C) return null
  return (
    <SkinErrorBoundary key={overlay.elementId} name={overlay.kind}>
      <C overlay={overlay} />
    </SkinErrorBoundary>
  )
}

// ── interaction 渲染器 ───────────────────────────────────────────────────────
// 一张表同时承载「按 kind 的默认组件」与「按 component id 的皮肤组件」；
// 渲染时优先取元素 params.component 指定的皮肤，未指定/未知才回退到 kind 默认。
const INTERACTION = new Map<string, InteractionComponent>()
export function registerInteractionRenderer(kind: string, c: InteractionComponent): void {
  INTERACTION.set(kind, c)
}
/** 注册一个交互皮肤组件（按 component id）。 */
export function registerInteractionSkin(id: string, c: InteractionComponent): void {
  INTERACTION.set(id, c)
}
export function renderInteraction(interaction: InteractionSnap, submit: (input: unknown) => void, ctx?: SkinCtx): ReactNode {
  const component = (interaction.params as { component?: string }).component
  const Skin = component ? INTERACTION.get(component) : undefined
  const Default = INTERACTION.get(interaction.kind)
  const C = Skin ?? Default
  if (!C) return null
  const name = component ?? interaction.kind
  const props: InteractionProps = { interaction, submit: safe(name, submit), ctx }
  // 皮肤崩了 → 回退到 kind 默认交互组件（保证玩家仍能操作推进流程），并提示错误。
  const fallback = Skin && Default && Default !== Skin ? <Default {...props} /> : undefined
  // key 取 elementId + 皮肤 id：切换到别的交互/皮肤时干净重挂，hook 作用域不串。
  return (
    <SkinErrorBoundary key={`${interaction.elementId}:${name}`} name={name} fallback={fallback}>
      <C {...props} />
    </SkinErrorBoundary>
  )
}

// ── HUD 皮肤渲染器（按 component id；每个 ui.hud 元素可指定）──────────────────────
const HUD = new Map<string, HudComponent>()
export function registerHudRenderer(id: string, c: HudComponent): void {
  HUD.set(id, c)
}
/** 有指定 component 且命中皮肤则渲染，否则返回 null（调用方回退内置渲染）。 */
export function renderHudElement(element: HudElementView, ctx: SkinCtx): ReactNode {
  const C = element.component ? HUD.get(element.component) : undefined
  if (!C) return null
  return (
    <SkinErrorBoundary key={element.element} name={element.component ?? element.element}>
      <C element={element} ctx={ctx} />
    </SkinErrorBoundary>
  )
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

function ChoiceButtons({ interaction, submit }: InteractionProps): ReactNode {
  const params = interaction.params as unknown as ChoiceParams
  return (
    <div className="gv-choice-layer" style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
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
    <div className="gv-qte-layer" style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
      <button style={btn('#16a34a')} onClick={() => submit('pass')}>完美</button>
      <button style={btn('#65a30d')} onClick={() => submit('good')}>成功</button>
      <button style={btn('#dc2626')} onClick={() => submit('fail')}>失败</button>
    </div>
  )
}

function HotspotButtons({ interaction, submit }: InteractionProps): ReactNode {
  const params = interaction.params as unknown as HotspotParams
  return (
    <div className="gv-hotspot-layer" style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
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

let _registered = false
/** 注册核心 kind 的默认渲染器（幂等）。 */
export function registerCoreRenderers(): void {
  if (_registered) return
  _registered = true
  ensureFloatStyle()
  ensureTransitionStyle()
  registerInteractionRenderer('choice', ChoiceButtons)
  registerInteractionRenderer('skill', ChoiceButtons)
  registerInteractionRenderer('qte', QteButtons)
  registerInteractionRenderer('hotspot', HotspotButtons)
  registerOverlayRenderer('floatText', FloatTextOverlay)
  registerOverlayRenderer('transition', TransitionOverlay)
  registerOverlayRenderer('dialogue', DialogueOverlay)
}
