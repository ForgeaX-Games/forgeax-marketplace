/**
 * 核心元素 kind 模块（三职责，低耦合可复用）—— 注册后即可被任意节点复用。
 *
 * 每个 kind 只声明：role + params 校验 + 输出 handle + 运行时契约（run/resolve）。引擎按 role 调用；
 * presentation 由引擎发泛型 renderOverlay，Player 按 kind 渲染。新增玩法 = 加一个这样的模块，核心不改。
 *
 * 覆盖 nodia 所需（数值结算/副作用一律走 node.data.reactions 的生命周期相位，无 logic 结算组件）：
 *  - floatText(view) 漂字：纯展示，params 交给 Player。
 *  - choice(interaction) / skill(interaction) 选择/技能：每选项一个 opt:<key> 出口。
 *  - qte(interaction)   三档判定：pass/good/fail 出口。
 *  - hotspot(interaction) 热点：每热点一个 hs:<id> 出口。
 */
import type { GraphCondition, GraphEffect, GraphTextStyle } from '../schema/graph-schema'
import type { FormField, KindPlugin } from './kind-registry'
import { KindRegistry, registerKind } from './kind-registry'
import { evalExpr } from '../engine/expr'

// ── presentation: floatText（花字/飘字：文案飘起淡出，支持固定文案或动态表达式）──────
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
export const floatTextKind: KindPlugin<FloatTextParams> = {
  kind: 'floatText',
  role: 'presentation',
  label: '花字/飘字',
  defaults: () => ({ text: '', x: 0.5, y: 0.45 }),
  form: [
    { t: 'text', key: 'text', label: '文案', placeholder: '含 {v} 用 expr 替换' },
    { t: 'text', key: 'expr', label: '表达式', placeholder: 'entity.ent-boss.attr.hp', mono: true },
    { t: 'textStyle', key: 'style', label: '样式', group: 'overlay' },
    { t: 'number', key: 'x', label: 'x', step: 0.05 },
    { t: 'number', key: 'y', label: 'y', step: 0.05 },
    { t: 'number', key: 'durationMs', label: '时长ms' },
    { t: 'color', key: 'color', label: '兜底色', placeholder: '#ffd54a' },
  ],
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
        component: 'floatText',
        params: { text: display, x: p.x, y: p.y, color: p.color, style: p.style, durationMs: p.durationMs, enter: p.enter, exit: p.exit, float: true },
      },
    ]
  },
}

// ── presentation: hud（血条等；皮 id 如 battleHpBar 为 alias）──────────────────
export interface HudParams {
  bind?: string
  label?: string
  accent?: string
}
export const hudKind: KindPlugin<HudParams> = {
  kind: 'hud',
  role: 'presentation',
  surface: 'hud',
  aliases: ['battleHpBar'],
  label: 'HUD',
  defaults: () => ({}),
  validate: () => [],
  outputs: () => [],
  events: [],
}

// ── interaction: choice / skill ───────────────────────────────────────────────
export interface ChoiceOption {
  key: string
  label?: string
  effects?: GraphEffect[]
  /** 逐项门控：条件不成立则该选项被锁定（皮肤灰置禁选）。如「灭世需 qi≥5」。 */
  condition?: GraphCondition
}
/** 选项呈现形态：列表 / 画面热区。 */
export type ChoicePresentation = 'list' | 'hotspot'
/** 选项 UI 皮肤（对齐 legacy ChoiceUi）。 */
export type ChoiceUi = 'default' | 'battleSkillBar' | 'inkYingMo'
export interface ChoiceParams {
  options: ChoiceOption[]
  /** 限时 ms（0/缺省=不限时）。 */
  timeoutMs?: number
  /** 超时默认出口 key。 */
  defaultKey?: string
  prompt?: string
  presentation?: ChoicePresentation
  ui?: ChoiceUi
  /** 热区（presentation='hotspot' 时按 key 对应画面区域）。 */
  hotspots?: HotspotItem[]
  /** 渲染皮肤组件 id（皮肤 registry），缺省=通用按钮。 */
  component?: string
}
const CHOICE_FORM: FormField[] = [
  { t: 'text', key: 'prompt', label: '提示' },
  { t: 'select', key: 'presentation', label: '呈现', options: [{ value: 'list', label: '列表' }, { value: 'hotspot', label: '热区' }] },
  { t: 'select', key: 'ui', label: '皮肤', options: [{ value: 'default', label: '默认' }, { value: 'battleSkillBar', label: '战斗技能条' }, { value: 'inkYingMo', label: '水墨影魔' }] },
  { t: 'number', key: 'timeoutMs', label: '限时ms' },
  { t: 'text', key: 'defaultKey', label: '超时key' },
  { t: 'options', key: 'options', label: '选项' },
]
function choiceLike(kind: string, label: string): KindPlugin<ChoiceParams> {
  return {
    kind,
    role: 'interaction',
    label,
    defaults: () => ({ options: [{ key: 'opt0', label: '选项一' }], presentation: 'list', ui: 'default' }),
    form: CHOICE_FORM,
    validate: (p) =>
      Array.isArray(p.options) && p.options.length > 0 ? [] : [`${kind}.options must be non-empty`],
    outputs: (p) => (p.options ?? []).map((o) => ({ id: `opt:${o.key}`, label: o.label })),
    resolve: (_ctx, p, input) => {
      // input = 选项 key（超时/缺省时用 defaultKey）
      const key = typeof input === 'string' ? input : p.defaultKey ?? p.options[0]?.key
      const opt = p.options.find((o) => o.key === key)
      return { outcome: `opt:${key}`, effects: opt?.effects }
    },
  }
}
export const choiceKind = {
  ...choiceLike('choice', '选项'),
  aliases: ['inkYingMo', 'battleSkillBar'],
} as KindPlugin<ChoiceParams>
export const skillKind = choiceLike('skill', '技能')

// ── interaction: qte ──────────────────────────────────────────────────────────
/** QTE 单拍的几何/判定形态（对齐 legacy QTECue.shape）。 */
export type QteCueShape = 'tap' | 'hold' | 'sweep'
export interface QteCue {
  id: string
  shape?: QteCueShape
  /** 归一化坐标（0~1）。 */
  x?: number
  y?: number
  /** 提示环出现 / 判定命中时刻（相对演出 ms）。 */
  appearAt?: number
  targetAt?: number
  /** 单个按键的结束 / 消失时刻（相对演出 ms）；缺省由 targetAt/durationMs 派生。 */
  endAt?: number
  /** hold 时长 / sweep 划动窗口 ms。 */
  durationMs?: number
  /** sweep 方向。 */
  sweepDir?: 'left' | 'right' | 'up' | 'down'
  label?: string
  /** 触发键（键盘）。 */
  triggerKey?: string
  /** 慢动作系数（<1 减速）。 */
  slowMo?: number
  zIndex?: number
}
export interface QteParams {
  qteKind?: 'parry' | 'timing' | 'mash' | 'sequence' | 'sweep'
  windowMs?: number
  passingHits?: number
  /** 结构化拍点。 */
  cues?: QteCue[]
  /** 判定容差 ms。 */
  tolerance?: number
  /** 满分。 */
  score?: number
  /** 过关分数线。 */
  passingScore?: number
  /** sequence 型的按键序列。 */
  sequence?: string[]
  /** UI 皮肤 id。 */
  ui?: string
  outcomeLabels?: Record<string, string>
  /** 渲染皮肤组件 id（皮肤 registry），缺省=通用按钮。 */
  component?: string
  /** 皮肤自管时限 ms（如叩击/防反的收圈时长；缺省各皮肤自带）。 */
  durationMs?: number
}
export const qteKind: KindPlugin<QteParams & { exits?: Array<{ key: string; label?: string }>; defaultKey?: string; timeoutMs?: number }> = {
  kind: 'qte',
  role: 'interaction',
  aliases: ['battleParry', 'inkKou'],
  label: 'QTE',
  events: [
    { id: 'pass', label: '完美' },
    { id: 'good', label: '良好' },
    { id: 'fail', label: '失败' },
  ],
  defaults: () => ({ qteKind: 'parry', cues: [], passingHits: 1 }),
  form: [
    { t: 'select', key: 'qteKind', label: 'QTE型', options: [{ value: 'parry', label: '完美防反' }, { value: 'timing', label: '打点' }, { value: 'mash', label: '连打' }, { value: 'sequence', label: '连招' }, { value: 'sweep', label: '划动' }] },
    { t: 'number', key: 'passingHits', label: '过关次' },
    { t: 'number', key: 'passingScore', label: '过关分' },
    { t: 'number', key: 'tolerance', label: '容差ms' },
    { t: 'number', key: 'score', label: '满分' },
    { t: 'number', key: 'windowMs', label: '窗口ms' },
    { t: 'text', key: 'ui', label: '皮肤' },
    { t: 'qteCues', key: 'cues', label: '拍点' },
  ],
  validate: () => [],
  outputs: (p) => {
    const exits = p.exits
    if (Array.isArray(exits) && exits.length > 0) {
      return exits.map((e) => ({ id: e.key, label: e.label ?? p.outcomeLabels?.[e.key] }))
    }
    // inkKou 只出 pass|fail；其余 QTE 默认三档（可用 outcomeLabels 补文案）
    if (p.component === 'inkKou') {
      return [
        { id: 'pass', label: p.outcomeLabels?.pass },
        { id: 'fail', label: p.outcomeLabels?.fail },
      ]
    }
    return [
      { id: 'pass', label: p.outcomeLabels?.pass },
      { id: 'good', label: p.outcomeLabels?.good },
      { id: 'fail', label: p.outcomeLabels?.fail },
    ]
  },
  resolve: (_ctx, p, input) => {
    // ① 字符串 outcome（含 exits key / pass|good|fail）；② { hits } 由 passingHits 判；③ 超时 defaultKey。
    if (typeof input === 'string' && input) return { outcome: input }
    if (input && typeof input === 'object' && 'key' in input && typeof (input as { key: unknown }).key === 'string') {
      return { outcome: (input as { key: string }).key }
    }
    if (input && typeof input === 'object' && 'hits' in input) {
      const hits = Number((input as { hits: number }).hits)
      const need = p.passingHits ?? 1
      return { outcome: hits >= need ? 'pass' : 'fail' }
    }
    return { outcome: p.defaultKey ?? 'fail' }
  },
}

// ── presentation: dialogue（原地对话：说话人 + 台词，底部对话框）──────────────────
export interface DialogueParams {
  speaker?: string
  text: string
  color?: string
  /** 文本样式（字幕预设快照）。 */
  style?: GraphTextStyle
  /** 归一化位置（缺省=底部居中字幕带）。 */
  x?: number
  y?: number
}
export const dialogueKind: KindPlugin<DialogueParams> = {
  kind: 'dialogue',
  role: 'presentation',
  label: '字幕/对白',
  defaults: () => ({ text: '', speaker: '' }),
  form: [
    { t: 'text', key: 'speaker', label: '说话人' },
    { t: 'text', key: 'text', label: '台词' },
    { t: 'textStyle', key: 'style', label: '样式', group: 'subtitle' },
    { t: 'number', key: 'x', label: 'x', step: 0.05 },
    { t: 'number', key: 'y', label: 'y', step: 0.05 },
  ],
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
  label: '转场',
  defaults: () => ({ durationMs: 600, style: 'fade' }),
  form: [
    { t: 'number', key: 'durationMs', label: '时长ms' },
    { t: 'select', key: 'style', label: '样式', options: [{ value: 'fade', label: '淡入淡出' }, { value: 'wipe', label: '擦除' }] },
    { t: 'color', key: 'color', label: '颜色', placeholder: '#000000' },
  ],
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
  label: '热点',
  defaults: () => ({ hotspots: [] }),
  form: [{ t: 'hotspots', key: 'hotspots', label: '热点' }],
  validate: (p) => (Array.isArray(p.hotspots) ? [] : ['hotspot.hotspots must be an array']),
  outputs: (p) => (p.hotspots ?? []).map((h) => ({ id: `hs:${h.id}`, label: h.label })),
  resolve: (_ctx, _p, input) => ({ outcome: `hs:${String(input)}` }),
}

export const CORE_KINDS: KindPlugin[] = [
  floatTextKind as unknown as KindPlugin,
  hudKind as unknown as KindPlugin,
  dialogueKind as unknown as KindPlugin,
  transitionKind as unknown as KindPlugin,
  choiceKind as unknown as KindPlugin,
  skillKind as unknown as KindPlugin,
  qteKind as unknown as KindPlugin,
  hotspotKind as unknown as KindPlugin,
]

/** 注册全部核心 kind 到默认表（幂等：重复调用覆盖同名）。编辑器 / 单测用。 */
export function registerCoreKinds(): void {
  for (const k of CORE_KINDS) registerKind(k)
}

/** 新建一份已装核心 kind 的隔离注册表（多局 Runtime 各持一份）。 */
export function createCoreKindRegistry(): KindRegistry {
  const reg = new KindRegistry()
  for (const k of CORE_KINDS) reg.registerKind(k)
  return reg
}
