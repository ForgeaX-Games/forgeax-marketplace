/**
 * 核心元素 kind 模块（三职责，低耦合可复用）—— 注册后即可被任意节点复用。
 *
 * 每个 kind 只声明：role + params 校验 + 输出 handle + 运行时契约（run/resolve）。引擎按 role 调用；
 * presentation 由引擎发泛型 renderOverlay，Player 按 kind 渲染。新增玩法 = 加一个这样的模块，核心不改。
 *
 * 覆盖 nodia 所需：
 *  - settle(logic)   数值结算：应用一组 effect（可含公式/随机）。
 *  - floatText(view) 漂字：纯展示，params 交给 Player。
 *  - choice(interaction) / skill(interaction) 选择/技能：每选项一个 opt:<key> 出口。
 *  - qte(interaction)   三档判定：pass/good/fail 出口。
 *  - hotspot(interaction) 热点：每热点一个 hs:<id> 出口。
 */
import type { GraphEffect } from './graph-schema'
import type { KindPlugin } from './kind-registry'
import { registerKind } from './kind-registry'
import { evalExpr } from './expr'

// ── logic: settle ─────────────────────────────────────────────────────────────
export interface SettleParams {
  effects: GraphEffect[]
}
export const settleKind: KindPlugin<SettleParams> = {
  kind: 'settle',
  role: 'logic',
  validate: (p) => (Array.isArray(p.effects) ? [] : ['settle.effects must be an array']),
  outputs: () => [],
  run: (_ctx, p) => ({ effects: p.effects ?? [] }),
}

// ── presentation: floatText（飘字：伤害数字那种飘起淡出，支持固定文案或动态表达式）──────
export interface FloatTextParams {
  /** 固定文案；含 `{v}` 时用 expr 求值替换（如 "气力 {v}"）。 */
  text?: string
  /** 动态值表达式（如伤害 `-(entity.ent-player.attr.attack*2 - entity.ent-boss.attr.defense)`）。 */
  expr?: string
  x?: number
  y?: number
  color?: string
  durationMs?: number
}
function signed(v: number): string {
  return v > 0 ? `+${v}` : String(v)
}
export const floatTextKind: KindPlugin<FloatTextParams> = {
  kind: 'floatText',
  role: 'presentation',
  validate: (p) => (p.text || p.expr ? [] : ['floatText 需要 text 或 expr']),
  outputs: () => [],
  // 到触发时机时按当前状态算出要飘的文本，emit 一个已解析的 renderOverlay（Player 只管飘起淡出动画）。
  render: (ctx, p) => {
    let display = p.text ?? ''
    if (p.expr) {
      const v = evalExpr(p.expr, ctx.state)
      display = p.text ? p.text.replace('{v}', signed(v)) : signed(v)
    }
    return [
      {
        type: 'renderOverlay',
        nodeId: ctx.nodeId,
        elementId: ctx.elementId ?? 'float',
        kind: 'floatText',
        params: { text: display, x: p.x, y: p.y, color: p.color, durationMs: p.durationMs, float: true },
      },
    ]
  },
}

// ── interaction: choice / skill ───────────────────────────────────────────────
export interface ChoiceOption {
  key: string
  label?: string
  effects?: GraphEffect[]
}
export interface ChoiceParams {
  options: ChoiceOption[]
  /** 限时 ms（0/缺省=不限时）。 */
  timeoutMs?: number
  /** 超时默认出口 key。 */
  defaultKey?: string
  prompt?: string
}
function choiceLike(kind: string): KindPlugin<ChoiceParams> {
  return {
    kind,
    role: 'interaction',
    validate: (p) =>
      Array.isArray(p.options) && p.options.length > 0 ? [] : [`${kind}.options must be non-empty`],
    outputs: (p) => (p.options ?? []).map((o) => ({ id: `opt:${o.key}`, label: o.label, kind })),
    resolve: (_ctx, p, input) => {
      // input = 选项 key（超时/缺省时用 defaultKey）
      const key = typeof input === 'string' ? input : p.defaultKey ?? p.options[0]?.key
      const opt = p.options.find((o) => o.key === key)
      return { outcome: `opt:${key}`, effects: opt?.effects }
    },
  }
}
export const choiceKind = choiceLike('choice')
export const skillKind = choiceLike('skill')

// ── interaction: qte ──────────────────────────────────────────────────────────
export interface QteParams {
  qteKind?: 'parry' | 'timing' | 'mash' | 'sequence' | 'sweep'
  windowMs?: number
  passingHits?: number
  cues?: unknown[]
  outcomeLabels?: Record<string, string>
}
export const qteKind: KindPlugin<QteParams> = {
  kind: 'qte',
  role: 'interaction',
  validate: () => [],
  outputs: () => [{ id: 'pass', kind: 'qte' }, { id: 'good', kind: 'qte' }, { id: 'fail', kind: 'qte' }],
  resolve: (_ctx, p, input) => {
    // input 允许两种：① 直接给三档结果字符串 'pass'|'good'|'fail'；② { hits:number } 由 passingHits 判。
    if (input === 'pass' || input === 'good' || input === 'fail') return { outcome: input }
    if (input && typeof input === 'object' && 'hits' in input) {
      const hits = Number((input as { hits: number }).hits)
      const need = p.passingHits ?? 1
      return { outcome: hits >= need ? 'pass' : 'fail' }
    }
    return { outcome: 'fail' }
  },
}

// ── presentation: dialogue（原地对话：说话人 + 台词，底部对话框）──────────────────
export interface DialogueParams {
  speaker?: string
  text: string
  color?: string
}
export const dialogueKind: KindPlugin<DialogueParams> = {
  kind: 'dialogue',
  role: 'presentation',
  validate: (p) => (p.text ? [] : ['dialogue 需要 text']),
  outputs: () => [],
  // 无 render()：走引擎泛型 renderOverlay，Player 侧 dialogue 渲染器画底部对话框。
}

// ── presentation: transition（转场：全屏淡入/淡出，durationMs 控时长）──────────────
export interface TransitionParams {
  durationMs?: number
  style?: 'fade' | 'wipe'
  color?: string
}
export const transitionKind: KindPlugin<TransitionParams> = {
  kind: 'transition',
  role: 'presentation',
  validate: () => [],
  outputs: () => [],
  // 无 render()：走引擎泛型 renderOverlay，Player 侧 transition 渲染器按 durationMs 做淡入淡出，换节点时随叠层清空。
}

// ── interaction: hotspot ──────────────────────────────────────────────────────
export interface HotspotItem {
  id: string
  target?: string
  label?: string
  x?: number
  y?: number
}
export interface HotspotParams {
  hotspots: HotspotItem[]
}
export const hotspotKind: KindPlugin<HotspotParams> = {
  kind: 'hotspot',
  role: 'interaction',
  validate: (p) => (Array.isArray(p.hotspots) ? [] : ['hotspot.hotspots must be an array']),
  outputs: (p) => (p.hotspots ?? []).map((h) => ({ id: `hs:${h.id}`, label: h.label, kind: 'hotspot' })),
  resolve: (_ctx, _p, input) => ({ outcome: `hs:${String(input)}` }),
}

export const CORE_KINDS: KindPlugin[] = [
  settleKind as unknown as KindPlugin,
  floatTextKind as unknown as KindPlugin,
  dialogueKind as unknown as KindPlugin,
  transitionKind as unknown as KindPlugin,
  choiceKind as unknown as KindPlugin,
  skillKind as unknown as KindPlugin,
  qteKind as unknown as KindPlugin,
  hotspotKind as unknown as KindPlugin,
]

/** 注册全部核心 kind（幂等：重复调用覆盖同名）。 */
export function registerCoreKinds(): void {
  for (const k of CORE_KINDS) registerKind(k)
}
