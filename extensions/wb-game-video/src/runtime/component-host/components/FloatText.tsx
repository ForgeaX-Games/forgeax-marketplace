/**
 * 花字/飘字（component id: `floatText`）—— OverlayComponent。
 * 作者配置 text/expr；绘制时用 SkinCtx 求值（与 battleHpBar 同构），引擎只发原样 renderOverlay。
 */
import type { ReactNode } from 'react'
import type { ComponentDef } from '../../registry/component-registry'
import type { GraphTextStyle } from '../../schema/graph-schema'
import { evalExpr, type EvalCtx } from '../../engine/expr'
import type { OverlayProps, SkinCtx } from '../rendererRegistry'

export interface FloatTextParams {
  /** 固定文案；含 `{v}` 时用 expr 求值替换（如 "气力 {v}"）。 */
  text?: string
  /** 动态值表达式（如伤害 `-(entity.ent-player.attr.attack*2 - entity.ent-boss.attr.defense)`）。 */
  expr?: string
  /** 归一化锚点（0~1，画面中心 0.5,0.5）。 */
  x?: number
  y?: number
  /** 文本样式（预设快照，含 fontSize/描边/色/投影）。 */
  style?: GraphTextStyle
  /** 兜底文字色（无 style.color 时用；伤害飘字用）。 */
  color?: string
  /** 飘起淡出总时长 ms。 */
  durationMs?: number
  /** 入场动画预设 id（pop/fade/slide/floatUp…）。 */
  enter?: string
  /** 出场动画预设 id。 */
  exit?: string
}

function signed(v: number): string {
  return v > 0 ? `+${v}` : String(v)
}

function ensureFloatStyle(): void {
  if (typeof document === 'undefined' || document.getElementById('gv-float-style')) return
  const s = document.createElement('style')
  s.id = 'gv-float-style'
  s.textContent =
    '@keyframes gv-floatup{0%{opacity:0;transform:translate(-50%,-20%) scale(0.9)}15%{opacity:1;transform:translate(-50%,-60%) scale(1.1)}100%{opacity:0;transform:translate(-50%,-140%) scale(1)}}'
  document.head.appendChild(s)
}

/** 作者配置的入参（落盘）；expr 可为字符串或 `{ expr }`。 */
function exprSource(expr: unknown): string | undefined {
  if (typeof expr === 'string' && expr) return expr
  if (expr && typeof expr === 'object' && typeof (expr as { expr?: unknown }).expr === 'string') {
    const s = (expr as { expr: string }).expr
    return s || undefined
  }
  return undefined
}

function evalCtxFromSkin(ctx: SkinCtx | undefined): EvalCtx | undefined {
  const st = ctx?.condition?.state
  if (st) {
    return {
      vars: st.vars,
      entities: st.entities,
      flags: st.flags,
      score: st.score,
      rng: st.rng,
    }
  }
  const hud = ctx?.hud
  if (!hud) return undefined
  return {
    vars: hud.vars,
    entities: Object.fromEntries(Object.entries(hud.entities).map(([id, e]) => [id, { attrs: e.attrs }])),
    flags: hud.flags,
    score: hud.score,
  }
}

/** 绘制时：expr + text/`{v}` → 展示文案。 */
export function resolveFloatTextDisplay(
  inputs: FloatTextParams & { expr?: unknown },
  ctx: SkinCtx | undefined,
): string {
  const text = typeof inputs.text === 'string' ? inputs.text : ''
  const src = exprSource(inputs.expr)
  if (!src) return text
  const evalCtx = evalCtxFromSkin(ctx)
  if (!evalCtx) return text
  try {
    const v = evalExpr(src, evalCtx)
    return text ? text.replace('{v}', signed(v)) : signed(v)
  } catch {
    return text
  }
}

/** 组件的注册契约（引擎/编辑器识别用）——与渲染同文件，经 EXTRA_COMPONENTS 注册。 */
export const floatTextComponent: ComponentDef<FloatTextParams> = {
  label: '花字/飘字',
  inputs: [
    { key: 'text', label: '文案', valueType: 'string', default: '' },
    { key: 'expr', label: '表达式', valueType: 'string' },
    { key: 'style', label: '样式', valueType: 'string', component: 'textStyle' },
    { key: 'x', label: 'x', valueType: 'number', default: 0.5 },
    { key: 'y', label: 'y', valueType: 'number', default: 0.45 },
    { key: 'durationMs', label: '时长ms', valueType: 'number' },
    { key: 'color', label: '兜底色', valueType: 'string', component: 'color' },
  ],
  validate: (p) => (p.text || p.expr ? [] : ['floatText 需要 text 或 expr']),
}

export function FloatTextOverlay({ overlay, ctx }: OverlayProps): ReactNode {
  ensureFloatStyle()
  const p = overlay.inputs as FloatTextParams & { expr?: unknown }
  const display = resolveFloatTextDisplay(p, ctx)
  const dur = typeof p.durationMs === 'number' ? p.durationMs : 1100
  const neg = display.trim().startsWith('-')
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
      {display}
    </div>
  )
}
