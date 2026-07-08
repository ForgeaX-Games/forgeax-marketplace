/**
 * Player 渲染器 registry —— 按 directive/元素的 `kind` 派发 React 组件（spec §3.3）。
 *
 * 加新玩法 = 注册一个渲染器，**不改 Player 主体**（消除旧 BlueprintPlayer 的 else-if 爆炸）。
 * 表现层(overlay) 与 交互层(interaction) 各一张表。
 */
import type { CSSProperties, ReactNode } from 'react'
import type { OverlaySnap, InteractionSnap } from '../session'
import type { ChoiceParams, HotspotParams } from '../core-kinds'

// ── overlay 渲染器 ────────────────────────────────────────────────────────────
export type OverlayRenderer = (overlay: OverlaySnap) => ReactNode
const OVERLAY = new Map<string, OverlayRenderer>()
export function registerOverlayRenderer(kind: string, r: OverlayRenderer): void {
  OVERLAY.set(kind, r)
}
export function renderOverlay(overlay: OverlaySnap): ReactNode {
  const r = OVERLAY.get(overlay.kind)
  return r ? r(overlay) : null
}

// ── interaction 渲染器 ───────────────────────────────────────────────────────
export type InteractionRenderer = (interaction: InteractionSnap, submit: (input: unknown) => void) => ReactNode
const INTERACTION = new Map<string, InteractionRenderer>()
export function registerInteractionRenderer(kind: string, r: InteractionRenderer): void {
  INTERACTION.set(kind, r)
}
export function renderInteraction(interaction: InteractionSnap, submit: (input: unknown) => void): ReactNode {
  const r = INTERACTION.get(interaction.kind)
  return r ? r(interaction, submit) : null
}

// ── 核心 kind 的默认渲染器 ────────────────────────────────────────────────────
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

function ChoiceButtons(interaction: InteractionSnap, submit: (input: unknown) => void): ReactNode {
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

function QteButtons(_interaction: InteractionSnap, submit: (input: unknown) => void): ReactNode {
  return (
    <div className="gv-qte-layer" style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
      <button style={btn('#16a34a')} onClick={() => submit('pass')}>完美</button>
      <button style={btn('#65a30d')} onClick={() => submit('good')}>成功</button>
      <button style={btn('#dc2626')} onClick={() => submit('fail')}>失败</button>
    </div>
  )
}

function HotspotButtons(interaction: InteractionSnap, submit: (input: unknown) => void): ReactNode {
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
  // 飘字：从下方淡入 → 上浮 → 淡出（伤害数字那种）。
  s.textContent =
    '@keyframes gv-floatup{0%{opacity:0;transform:translate(-50%,-20%) scale(0.9)}15%{opacity:1;transform:translate(-50%,-60%) scale(1.1)}100%{opacity:0;transform:translate(-50%,-140%) scale(1)}}'
  document.head.appendChild(s)
}

function ensureTransitionStyle(): void {
  if (typeof document === 'undefined' || document.getElementById('gv-transition-style')) return
  const s = document.createElement('style')
  s.id = 'gv-transition-style'
  // 转场：淡入 → 短暂遮罩 → 淡出（随节点切换叠层清空自然消失）。
  s.textContent = '@keyframes gv-transition{0%{opacity:0}20%{opacity:1}80%{opacity:1}100%{opacity:0}}'
  document.head.appendChild(s)
}

function TransitionOverlay(overlay: OverlaySnap): ReactNode {
  const p = overlay.params as { durationMs?: number; color?: string }
  const dur = p.durationMs ?? 600
  return (
    <div
      className="gv-transition"
      style={{
        position: 'absolute',
        inset: 0,
        background: p.color ?? '#000',
        pointerEvents: 'none',
        animation: `gv-transition ${dur}ms ease-in-out forwards`,
      }}
    />
  )
}

function DialogueOverlay(overlay: OverlaySnap): ReactNode {
  const p = overlay.params as { speaker?: string; text?: string; color?: string }
  return (
    <div
      className="gv-dialogue"
      style={{
        position: 'absolute',
        left: '8%',
        right: '8%',
        bottom: '10%',
        padding: '12px 16px',
        borderRadius: 12,
        background: 'rgba(12,14,18,0.82)',
        border: '1px solid rgba(255,255,255,0.12)',
        color: '#f0f0f0',
        pointerEvents: 'none',
        boxShadow: '0 6px 24px rgba(0,0,0,0.5)',
      }}
    >
      {p.speaker && <div style={{ fontWeight: 700, fontSize: 13, color: p.color ?? '#ffd54a', marginBottom: 4 }}>{p.speaker}</div>}
      <div style={{ fontSize: 15, lineHeight: 1.5 }}>{p.text}</div>
    </div>
  )
}

function FloatTextOverlay(overlay: OverlaySnap): ReactNode {
  const p = overlay.params as { text?: string; x?: number; y?: number; color?: string; durationMs?: number }
  const dur = p.durationMs ?? 1100
  const neg = typeof p.text === 'string' && p.text.trim().startsWith('-')
  return (
    <div
      className="gv-float-text"
      style={{
        position: 'absolute',
        left: `${(p.x ?? 0.5) * 100}%`,
        top: `${(p.y ?? 0.42) * 100}%`,
        color: p.color ?? (neg ? '#ff5a5a' : '#ffd54a'),
        fontWeight: 800,
        fontSize: 28,
        textShadow: '0 2px 6px rgba(0,0,0,0.8)',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
        animation: `gv-floatup ${dur}ms ease-out forwards`,
      }}
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
