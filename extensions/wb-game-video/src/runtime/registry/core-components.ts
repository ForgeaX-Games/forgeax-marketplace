/**
 * 核心组件模块（三职责，低耦合可复用）—— 注册后即可被任意节点复用。
 *
 * 每个组件只声明：role + inputs 校验 + 输出 handle + 运行时契约（run/resolve）。引擎按 role 调用；
 * presentation 由引擎发泛型 renderOverlay，Player 按 component id 渲染。新增玩法 = 加一个这样的模块，核心不改。
 *
 * 覆盖 nodia 所需（数值结算/副作用一律走 node.data.reactions 的生命周期相位，无 logic 结算组件）：
 *  - floatText(view) 漂字：纯展示，inputs 交给 Player。
 *  - choice(interaction) / skill(interaction) 选择/技能：每个 event 一个同名出口。
 *  - qte(interaction)   判定：默认 pass/good/fail（inkKou 仅 pass/fail），或 inputs.events 自定义。
 *  - hotspot(interaction) 热点：每个 HotspotSpot（id + 可选 x/y）一个同名出口。
 *
 * 交互目录：共享壳是 ComponentEvent；choice/skill 用 ChoiceOption（可带 condition），
 * hotspot 用 HotspotSpot（可带 x/y）。出口 id === event.id；副作用一律进 reactions。
 *
 * 「皮肤」不是独立维度：叩击/防反/應默/战斗技能条各自是完全独立注册的顶层组件 id，不经由
 * 「基础类型 + inputs.component 覆盖」这层间接——创建时一次性选定是哪个组件，创建后不提供
 * 「换皮肤/换类型」的编辑入口。它们要不要走某种专属交互，只看各自 inputs 里声明了什么结构
 * （如 `component: 'qteCues'`），不设跨组件的分类/家族标签。
 */
import type { GraphCondition, GraphTextStyle } from '../schema/graph-schema'
import type { ComponentEvent, ComponentInput } from '../schema/node-config-schema'
import type { ComponentDef } from './component-registry'
import { ComponentRegistry, registerComponent } from './component-registry'
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
export const floatTextComponent: ComponentDef<FloatTextParams> = {
  role: 'presentation',
  stageRelative: true,
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
        inputs: { text: display, x: p.x, y: p.y, color: p.color, style: p.style, durationMs: p.durationMs, enter: p.enter, exit: p.exit, float: true },
      },
    ]
  },
}

// ── interaction: choice / skill ───────────────────────────────────────────────
/** 选项呈现形态：列表 / 画面热区。 */
export type ChoicePresentation = 'list' | 'hotspot'
/**
 * choice/skill 的选项项 = 共享事件 + 本组件门控。
 * `condition` 不成立 → 皮肤用实时态灰置禁选（≠ 边 condition；引擎不注入 _locked）。
 */
export type ChoiceOption = ComponentEvent & { condition?: GraphCondition }
export interface ChoiceParams {
  /** 交互目录：每个 option 一个同名出口（id === 出口 handle）。 */
  events: ChoiceOption[]
  /** 限时 ms（0/缺省=不限时）。 */
  timeoutMs?: number
  /** 超时默认出口 event id。 */
  defaultEvent?: string
  presentation?: ChoicePresentation
  /** 整组选项锚点（归一化 0~1；预览拖拽 / 试玩共用）。 */
  x?: number
  y?: number
}
const CHOICE_INPUTS: ComponentInput[] = [
  { key: 'presentation', label: '呈现', valueType: 'string', default: 'list', options: [{ value: 'list', label: '列表' }, { value: 'hotspot', label: '热区' }] },
  { key: 'timeoutMs', label: '限时ms', valueType: 'number' },
  { key: 'defaultEvent', label: '超时出口', valueType: 'string' },
  { key: 'events', label: '选项', valueType: 'string', component: 'events', default: [{ id: 'opt0', label: '选项一' }] },
  // x/y 补进 inputs 契约（此前只在 ChoiceParams 类型上有、manifest 里缺失）：
  // isPositionable() 按「inputs 是否同时声明 x + y」推断能不能拖，这两项缺了会被误判成不可定位。
  { key: 'x', label: 'x', valueType: 'number' },
  { key: 'y', label: 'y', valueType: 'number' },
]
const validateChoiceEvents = (p: ChoiceParams): string[] =>
  Array.isArray(p.events) && p.events.length > 0 ? [] : ['events must be non-empty']
export const choiceComponent: ComponentDef<ChoiceParams> = {
  role: 'interaction',
  label: '选项',
  inputs: CHOICE_INPUTS,
  validate: validateChoiceEvents,
}
export const skillComponent: ComponentDef<ChoiceParams> = {
  role: 'interaction',
  label: '技能',
  inputs: CHOICE_INPUTS,
  validate: validateChoiceEvents,
}
export const inkYingMoComponent: ComponentDef<ChoiceParams> = {
  role: 'interaction',
  label: '應/默 抉择',
  inputs: CHOICE_INPUTS,
  validate: validateChoiceEvents,
}
export const battleSkillBarComponent: ComponentDef<ChoiceParams> = {
  role: 'interaction',
  label: '战斗技能条',
  inputs: CHOICE_INPUTS,
  validate: validateChoiceEvents,
}

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
  /**
   * 完美判定半窗 ms：|玩家按下时刻 − 拍点「命中(targetAt)」时刻| ≤ 此值 → pass（完美）。
   * 「成功(good)」不需要独立参数——命中落在拍点显示窗 [appearAt, endAt] 内即成功、窗外/超时=fail。
   * 缺省=窗内命中即完美。运行时由各 QTE 皮肤消费。
   */
  perfectMs?: number
  /** @deprecated 由 perfectMs 取代（成功=命中于拍点显示窗内，无需独立半窗）；保留仅为旧数据兼容。 */
  tolerance?: number
  /** 满分。 */
  score?: number
  /** 过关分数线。 */
  passingScore?: number
  /** sequence 型的按键序列。 */
  sequence?: string[]
  /** 交互目录：自定义判定出口（缺省见本组件 `events`；皮肤自带 defaults 写进 params.events）。 */
  events?: ComponentEvent[]
  /** 超时默认出口 event id（缺省 'fail'）。 */
  defaultEvent?: string
  /** 限时 ms。 */
  timeoutMs?: number
  /** 皮肤自管时限 ms（如收圈时长；缺省各皮肤自带）。 */
  durationMs?: number
}
/** @deprecated 旧草稿字段；新数据用 `events` / `defaultEvent`（边路由统一）。 */
export type QteExit = { key: string; label?: string }
export type QteFullParams = QteParams & {
  exits?: QteExit[]
  defaultKey?: string
  outcomeLabels?: Record<string, string>
}
/** 无皮肤 / 未落盘 events 时的通用三档出口（皮肤差异在各自 preset，不在此分支）。 */
const QTE_DEFAULT_EVENTS: ComponentEvent[] = [
  { id: 'pass', label: '完美' },
  { id: 'good', label: '良好' },
  { id: 'fail', label: '失败' },
]
const QTE_INPUTS: ComponentInput[] = [
  { key: 'qteKind', label: 'QTE型', valueType: 'string', default: 'parry', options: [{ value: 'parry', label: '完美防反' }, { value: 'timing', label: '打点' }, { value: 'mash', label: '连打' }, { value: 'sequence', label: '连招' }, { value: 'sweep', label: '划动' }] },
  { key: 'passingHits', label: '过关次', valueType: 'number', default: 1 },
  { key: 'passingScore', label: '过关分', valueType: 'number' },
  { key: 'perfectMs', label: '完美半窗ms', valueType: 'number' },
  { key: 'tolerance', label: '容差ms', valueType: 'number' },
  { key: 'score', label: '满分', valueType: 'number' },
  { key: 'windowMs', label: '窗口ms', valueType: 'number' },
  { key: 'durationMs', label: '收圈时长ms', valueType: 'number' },
  { key: 'timeoutMs', label: '限时ms', valueType: 'number' },
  { key: 'defaultEvent', label: '超时出口', valueType: 'string' },
  { key: 'glyph', label: '字形（inkKou）', valueType: 'string' },
  { key: 'events', label: '出口', valueType: 'string', component: 'events' },
  { key: 'cues', label: '拍点', valueType: 'string', component: 'qteCues', default: [] },
]
// 出口 = inputs.events（若配）否则组件 events（pass/good/fail）；由 registry.handlesOf 派生。
export const qteComponent: ComponentDef<QteFullParams> = {
  role: 'interaction',
  label: 'QTE',
  events: QTE_DEFAULT_EVENTS,
  inputs: QTE_INPUTS,
}
export const inkKouComponent: ComponentDef<QteFullParams> = {
  role: 'interaction',
  label: '叩击 QTE',
  events: QTE_DEFAULT_EVENTS,
  inputs: QTE_INPUTS,
}
export const battleParryComponent: ComponentDef<QteFullParams> = {
  role: 'interaction',
  label: '防反 QTE',
  events: QTE_DEFAULT_EVENTS,
  inputs: QTE_INPUTS,
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
export const dialogueComponent: ComponentDef<DialogueParams> = {
  role: 'presentation',
  stageRelative: true,
  label: '字幕/对白',
  inputs: [
    { key: 'speaker', label: '说话人', valueType: 'string', default: '' },
    { key: 'text', label: '台词', valueType: 'string', default: '' },
    { key: 'color', label: '说话人色', valueType: 'string', component: 'color' },
    { key: 'style', label: '样式', valueType: 'string', component: 'textStyle' },
    { key: 'x', label: 'x', valueType: 'number' },
    { key: 'y', label: 'y', valueType: 'number' },
  ],
  validate: (p) => (p.text ? [] : ['dialogue 需要 text']),
  // 无 render()：走引擎泛型 renderOverlay，Player 侧 dialogue 渲染器画底部对话框。
}

// ── presentation: transition（转场：全屏淡入/淡出，durationMs 控时长）──────────────
export interface TransitionParams {
  durationMs?: number
  style?: 'fade' | 'wipe'
  color?: string
}
export const transitionComponent: ComponentDef<TransitionParams> = {
  role: 'presentation',
  stageRelative: true,
  label: '转场',
  inputs: [
    { key: 'durationMs', label: '时长ms', valueType: 'number', default: 600 },
    { key: 'style', label: '样式', valueType: 'string', default: 'fade', options: [{ value: 'fade', label: '淡入淡出' }, { value: 'wipe', label: '擦除' }] },
    { key: 'color', label: '颜色', valueType: 'string', component: 'color' },
  ],
  // 无 render()：走引擎泛型 renderOverlay，Player 侧 transition 渲染器按 durationMs 做淡入淡出，换节点时随叠层清空。
}

// ── interaction: hotspot ──────────────────────────────────────────────────────
/** 热点项 = 共享事件 + 本组件画面锚点（归一化 0~1）。 */
export type HotspotSpot = ComponentEvent & { x?: number; y?: number }
export interface HotspotParams {
  /** 交互目录：每个 spot 一个同名出口；坐标由本组件 inputs 决定。 */
  events: HotspotSpot[]
}
export const hotspotComponent: ComponentDef<HotspotParams> = {
  role: 'interaction',
  label: '热点',
  // 标记用 'hotspotEvents'（非 'events'）：本组件的出口带画面坐标 x/y，编辑器要出专属的锚点
  // 编辑器而非纯文本清单，用独立标记跟 choice 系的 'events' 区分，不必回查任何分类表。
  inputs: [{ key: 'events', label: '热点', valueType: 'string', component: 'hotspotEvents', default: [] }],
  validate: (p) => (Array.isArray(p.events) ? [] : ['hotspot.events must be an array']),
}

export const CORE_COMPONENTS: Array<[string, ComponentDef]> = [
  ['floatText', floatTextComponent as unknown as ComponentDef],
  ['dialogue', dialogueComponent as unknown as ComponentDef],
  ['transition', transitionComponent as unknown as ComponentDef],
  ['choice', choiceComponent as unknown as ComponentDef],
  ['skill', skillComponent as unknown as ComponentDef],
  ['inkYingMo', inkYingMoComponent as unknown as ComponentDef],
  ['battleSkillBar', battleSkillBarComponent as unknown as ComponentDef],
  ['qte', qteComponent as unknown as ComponentDef],
  ['inkKou', inkKouComponent as unknown as ComponentDef],
  ['battleParry', battleParryComponent as unknown as ComponentDef],
  ['hotspot', hotspotComponent as unknown as ComponentDef],
]

/** 注册全部核心组件到默认表（幂等：重复调用覆盖同名）。编辑器 / 单测用。 */
export function registerCoreComponents(): void {
  for (const [id, c] of CORE_COMPONENTS) registerComponent(id, c)
}

/** 新建一份已装核心组件的隔离注册表（多局 Runtime 各持一份）。 */
export function createCoreComponentRegistry(): ComponentRegistry {
  const reg = new ComponentRegistry()
  for (const [id, c] of CORE_COMPONENTS) reg.registerComponent(id, c)
  return reg
}
