/**
 * 结构化编辑器 —— 类型化输入（effects / condition / 选项）。
 * 数值与实体·属性·变量一律走选取式下拉，不暴露 entity.xxx 手写框。
 *
 * 控件底：main 的 metaCatalog + ValueExprEditor。
 * 兼容：`EditorPickerCtx` / `pickers`（含 nodeLabel）与直接传 `entities`/`variables`。
 */
import type { CSSProperties, JSX } from 'react'
import type {
  CmpOp,
  Entity,
  GraphClause,
  GraphCondition,
  GraphEffect,
  Layout,
  NumericEffectOp,
  NumOrExpr,
  Variable,
} from '../../runtime/schema/graph-schema'
import type { Formula } from '../persist/formula-authoring'
import { flowHandleDisplay } from '../../graph/flow-handle-labels'
import { buildDefaults, getComponent } from '../../runtime/registry/component-registry'
import { findEntity, listAttrOptions, listEntityOptions, listVarOptions } from './metaCatalog'
import { ValueExprEditor } from './ValueExprEditor'

/** 交互事件目录项（共享壳 = ComponentEvent；kind 扩展字段按 variant 编辑）。 */
export interface ComponentEventLike {
  id: string
  label?: string
  /** choice/skill：逐项门控（组件私有）。 */
  condition?: GraphCondition
  /** hotspot：画面锚点（组件私有，归一化 0~1）。 */
  x?: number
  y?: number
}

export type EventsEditorVariant = 'plain' | 'choice' | 'hotspot'

export type MetaCatalogProps = {
  entities?: Record<string, Entity>
  variables?: Record<string, Variable>
  /** 公式库（「规则 → 公式」维护）；数值字段（ValueInput）借它开出「应用公式」模式。 */
  formulas?: Record<string, Formula>
}

/** 兼容包装：entities/variables + 节点下拉展示。 */
export interface EditorPickerCtx extends MetaCatalogProps {
  /** 节点下拉展示；缺省用 id。 */
  nodeLabel?: (id: string) => string
}

type CatalogArgs = MetaCatalogProps & {
  pickers?: EditorPickerCtx
  nodeLabel?: (id: string) => string
}

function resolveCatalog(args: CatalogArgs): {
  entities: Record<string, Entity> | undefined
  variables: Record<string, Variable> | undefined
  formulas: Record<string, Formula> | undefined
  nodeLabel?: (id: string) => string
} {
  return {
    entities: args.entities ?? args.pickers?.entities,
    variables: args.variables ?? args.pickers?.variables,
    formulas: args.formulas ?? args.pickers?.formulas,
    nodeLabel: args.nodeLabel ?? args.pickers?.nodeLabel,
  }
}

const CMP_OPS: CmpOp[] = ['gte', 'lte', 'gt', 'lt', 'eq', 'neq']
const CMP_LABEL: Record<CmpOp, string> = { gte: '≥', lte: '≤', gt: '>', lt: '<', eq: '=', neq: '≠' }
const EFFECT_KIND_LABEL: Record<string, string> = { attr: '属性', var: '变量', flag: '标记', item: '道具' }
const OP_LABEL: Record<string, string> = { give: '给予', take: '取走' }
const CLAUSE_LABEL: Record<string, string> = {
  attrRatio: '属性比例', attr: '属性值', attrCompare: '属性比较', var: '变量', flag: '标记', visited: '到过节点', score: '分数', hasItem: '拥有道具',
}

const box: CSSProperties = { border: '1px solid #2a2a2a', borderRadius: 6, padding: 6, marginTop: 6 }
const rowStyle: CSSProperties = { display: 'flex', gap: 4, alignItems: 'center', marginBottom: 4 }
const lbl: CSSProperties = { width: 52, opacity: 0.7, flexShrink: 0, fontSize: 11 }
const del: CSSProperties = { color: '#ff6b6b', marginLeft: 'auto' }
const hint: CSSProperties = { fontSize: 11, opacity: 0.55, marginBottom: 4 }

function field(label: string, node: JSX.Element): JSX.Element {
  // 用 div 而非 label：子树常含 button，包在 label 里会点到文字也触发按钮（如「乘」误删）。
  return (
    <div style={rowStyle}>
      <span style={lbl}>{label}</span>
      {node}
    </div>
  )
}

// ── 位置（x/y 归一化 0~1）——字幕/飘字/选项/通用组件/QTE point 皮肤共用 ──────────────
export function PositionEditor({
  x,
  y,
  defaultX,
  defaultY,
  onChange,
  variant = 'percent',
  resettable,
  disabled,
}: {
  x: number | undefined
  y: number | undefined
  defaultX: number
  defaultY: number
  onChange: (next: { x?: number; y?: number }) => void
  /** percent=数字输入框（%）；slider=0~1 滑条（字幕现状）。 */
  variant?: 'percent' | 'slider'
  /** 显示「归位到默认位置」按钮，清空 x/y 回落到样式默认值。 */
  resettable?: boolean
  /**
   * 该组件不支持自由定位（`isPositionable()` 为 false，如 HUD 血条按角色/规则锚定固定屏幕位置）时置灰：
   * 控件仍展示（不隐藏，方便看清当前坐标从哪来），但禁止输入。
   */
  disabled?: boolean
}): JSX.Element {
  const vx = typeof x === 'number' ? x : defaultX
  const vy = typeof y === 'number' ? y : defaultY
  const hint = disabled ? (
    <div className="gc-inspector-hint" title="该组件按角色/规则锚定固定屏幕位置，渲染不读取 x/y">不支持自由定位</div>
  ) : null
  if (variant === 'slider') {
    return (
      <>
        <div className="gc-field-row">
          <label><span>X {vx.toFixed(2)}</span>
            <input type="range" min={0} max={1} step={0.01} value={vx} disabled={disabled} onChange={(e) => onChange({ x: Number(e.target.value) })} />
          </label>
          <label><span>Y {vy.toFixed(2)}</span>
            <input type="range" min={0} max={1} step={0.01} value={vy} disabled={disabled} onChange={(e) => onChange({ y: Number(e.target.value) })} />
          </label>
        </div>
        {hint}
        {resettable && !disabled ? (
          <button type="button" className="gc-tsp-toggle" onClick={() => onChange({ x: undefined, y: undefined })}>归位到默认位置</button>
        ) : null}
      </>
    )
  }
  return (
    <div className="gc-inspector-grid2">
      <label><span>X%</span>
        <input type="number" value={Math.round(vx * 100)} disabled={disabled} onChange={(e) => onChange({ x: Number(e.target.value) / 100 })} />
      </label>
      <label><span>Y%</span>
        <input type="number" value={Math.round(vy * 100)} disabled={disabled} onChange={(e) => onChange({ y: Number(e.target.value) / 100 })} />
      </label>
      {hint}
      {resettable && !disabled ? (
        <button type="button" className="gc-tsp-toggle" onClick={() => onChange({ x: undefined, y: undefined })}>归位到默认位置</button>
      ) : null}
    </div>
  )
}

/**
 * 该组件是否支持「自由拖拽定位」——编辑器侧判定，**唯一官方入口**，纯结构化推导，不设独立开关字段：
 * 组件 `inputs` 里同时声明了 `x` 和 `y` 才算支持（渲染端才有地方读、写回才有地方落）；
 * 缺其一 → 不支持（HUD 类血条/气力条按角色/规则锚定固定屏幕位置，inputs 里本就没有 x/y）。
 * 未注册组件默认 `true`（保持编辑器旧行为，宁可给手柄不误判）。
 * 新增组件只需在自己 `inputs` 里老实声明 x/y——不必回来改这个函数，也不必再加一个平行的
 * `positionable` 标记跟 inputs 保持同步（那样两处数据源迟早会漂移）。
 * 编辑器预览手柄生成处（`activePreviewOverlaysFromNode`）/ 素材属性面板置灰逻辑均调用此函数。
 * 只读 `getComponent`（registry 对外暴露的查询 API），运行时执行路径（engine.ts / session.ts /
 * rendererRegistry.tsx）从未调用过这个判断——「能不能拖手柄」纯粹是编辑器概念，不是 runtime 关心的事。
 */
export function isPositionable(componentId: string): boolean {
  const inputs = getComponent(componentId)?.inputs
  if (!inputs) return true
  return inputs.some((i) => i.key === 'x') && inputs.some((i) => i.key === 'y')
}

/** 编辑器展示名：读组件 `label`；未注册则退回 id。 */
export function componentTypeLabel(componentId: string): string {
  return getComponent(componentId)?.label || componentId
}

/** 编辑器新建实例：由组件 inputs[].default 组装初值。 */
export function defaultsForComponent(componentId: string): Record<string, unknown> {
  return buildDefaults(getComponent(componentId)?.inputs)
}

/**
 * 编辑器：组件 inputs 是否声明了多拍点结构（`component: 'qteCues'`）。
 * 有 ⇒ 时间轴走拍点交互；组件侧只需在 inputs 里声明该项，不必另加分类标签。
 */
export function hasCuePointsInput(componentId: string): boolean {
  const inputs = getComponent(componentId)?.inputs
  return !!inputs?.some((i) => i.component === 'qteCues')
}

/**
 * 编辑器：组件 inputs 是否声明了选项出口清单（`component: 'events'`）。
 * 已有拍点结构的走拍点分支，不落进本分支。
 */
export function hasOptionEventsInput(componentId: string): boolean {
  if (hasCuePointsInput(componentId)) return false
  const inputs = getComponent(componentId)?.inputs
  return !!inputs?.some((i) => i.component === 'events')
}

/**
 * 该组件是否读取 `Layout.width/height` 这个整体尺寸盒子——编辑器侧判定，**只问 inputs 结构**：
 * - 声明了 `x`+`y` → 自定位，通常配 STAGE_FILL，不消费宽高滑杆
 * - 声明了拍点（`qteCues`）或选项清单（`events`）→ 在铺满盒内自绘，同样不消费
 * 不按 component id 枚举。
 */
export function isSizable(componentId: string): boolean {
  const plugin = getComponent(componentId)
  if (!plugin) return true
  const keys = new Set((plugin.inputs ?? []).map((i) => i.key))
  if (keys.has('x') && keys.has('y')) return false
  if (hasCuePointsInput(componentId) || hasOptionEventsInput(componentId)) return false
  return true
}

// ── 尺寸（width/height 归一化 0~1，相对舞台）——对所有组件通用，对应 `Layout.width/height` ──────
// 与 PositionEditor 同一套「slider + 百分比读数」范式；未开启时 = undefined（沿用皮肤自身尺寸/
// fit-content），开启后写入 Layout.width/height——预览与全屏试玩共用同一份 childWrapStyle 换算
// SSOT（见 runtime/schema/layout.ts），两边看到的百分比含义完全一致。
export function SizeEditor({
  width,
  height,
  onChange,
  disabled,
}: {
  width: number | undefined
  height: number | undefined
  onChange: (next: Pick<Layout, 'width' | 'height'>) => void
  /**
   * 该组件不读 Layout 盒子（`isSizable()` 为 false）时置灰：拖动滑杆预览/试玩
   * 都不会有任何变化，不能悄悄啥都不做，得显式说明，否则会被当成「拖了没反应，是不是坏了」的 bug。
   */
  disabled?: boolean
}): JSX.Element {
  const hasW = typeof width === 'number'
  const hasH = typeof height === 'number'
  return (
    <>
      <div className="gc-field-row">
        <label>
          <span>
            <input type="checkbox" checked={hasW} disabled={disabled} onChange={(e) => onChange({ width: e.target.checked ? (width ?? 0.3) : undefined })} />
            {' '}宽 {hasW ? `${Math.round(width! * 100)}%` : '自适应'}
          </span>
          <input
            type="range"
            min={1}
            max={100}
            step={1}
            disabled={disabled || !hasW}
            value={hasW ? Math.round(width! * 100) : 30}
            onChange={(e) => onChange({ width: Number(e.target.value) / 100 })}
          />
        </label>
        <label>
          <span>
            <input type="checkbox" checked={hasH} disabled={disabled} onChange={(e) => onChange({ height: e.target.checked ? (height ?? 0.3) : undefined })} />
            {' '}高 {hasH ? `${Math.round(height! * 100)}%` : '自适应'}
          </span>
          <input
            type="range"
            min={1}
            max={100}
            step={1}
            disabled={disabled || !hasH}
            value={hasH ? Math.round(height! * 100) : 30}
            onChange={(e) => onChange({ height: Number(e.target.value) / 100 })}
          />
        </label>
      </div>
      {disabled ? (
        <div className="gc-inspector-hint" title="该组件按自身锚点/铺满舞台呈现，不读取宽高盒子，拖动无效果">
          该组件按锚点自身定位/铺满舞台，不支持配置整体尺寸
        </div>
      ) : null}
    </>
  )
}

// ── NumOrExpr（常量 / 选取公式）───────────────────────────────────────────────
export function ValueInput({
  value,
  onChange,
  entities,
  variables,
  formulas,
  effectOp,
}: {
  value: NumOrExpr | undefined
  onChange: (v: NumOrExpr) => void
  /** 挂了这个 = 这个值要配一个 Effect「运算」符号按钮，嵌进编辑器顶部（跟常量/选取公式同一行）。 */
  effectOp?: { op: NumericEffectOp; onOpChange: (next: { op: NumericEffectOp; value?: NumOrExpr }) => void }
} & MetaCatalogProps): JSX.Element {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <ValueExprEditor value={value} entities={entities} variables={variables} formulas={formulas} onChange={onChange} effectOp={effectOp} />
    </div>
  )
}

export function EntitySelect({
  value,
  entities,
  onChange,
}: {
  value: string
  entities: Record<string, Entity> | undefined
  onChange: (id: string) => void
}): JSX.Element {
  const opts = listEntityOptions(entities)
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ flex: 1 }}>
      <option value="" disabled={opts.length > 0}>选择对象…</option>
      {opts.map((o) => (
        <option key={o.id} value={o.id}>{o.label}</option>
      ))}
    </select>
  )
}

/** 属性下拉：依 `entityId` 实时扫该实体的 attrs（复用同一份 metaCatalog，与 EntitySelect 同源联动）。 */
export function AttrSelect({
  entityId,
  value,
  entities,
  onChange,
}: {
  entityId: string
  value: string
  entities: Record<string, Entity> | undefined
  onChange: (attr: string) => void
}): JSX.Element {
  const attrs = listAttrOptions(findEntity(entities, entityId))
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ flex: 1 }}>
      <option value="" disabled={attrs.length > 0}>选择属性…</option>
      {attrs.map((a) => (
        <option key={a.id} value={a.id}>{a.label}</option>
      ))}
    </select>
  )
}

function VarSelect({
  value,
  variables,
  flagsOnly,
  numbersOnly,
  onChange,
}: {
  value: string
  variables: Record<string, Variable> | undefined
  flagsOnly?: boolean
  numbersOnly?: boolean
  onChange: (id: string) => void
}): JSX.Element {
  const opts = listVarOptions(variables, { flagsOnly, numbersOnly })
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ flex: 1 }}>
      <option value="" disabled={opts.length > 0}>选择变量…</option>
      {opts.map((o) => (
        <option key={o.id} value={o.id}>{o.label}</option>
      ))}
    </select>
  )
}

// ── effects ───────────────────────────────────────────────────────────────────
type EffectKind = GraphEffect['kind']
// 「标记」(flag) 从新建下拉隐藏（避免与「变量」混淆）；已有 flag 数据仍可编辑。
const EFFECT_KINDS: EffectKind[] = ['attr', 'var', 'item']

/** 新建一条效果的默认值（属性 / 变量 / …）；供 EffectsEditor 与「＋ 效果」动作共用。 */
export function createDefaultEffect(
  kind: EffectKind,
  entities: Record<string, Entity> | undefined,
  variables: Record<string, Variable> | undefined,
): GraphEffect {
  const ent = listEntityOptions(entities)[0]?.id ?? ''
  const attr = listAttrOptions(findEntity(entities, ent))[0]?.id ?? 'hp'
  const numVar = listVarOptions(variables, { numbersOnly: true })[0]?.id ?? ''
  const flagVar = listVarOptions(variables, { flagsOnly: true })[0]?.id ?? ''
  switch (kind) {
    case 'attr':
      return { kind: 'attr', entityId: ent, attr, op: 'add', value: 0 }
    case 'var':
      return { kind: 'var', varId: numVar, op: 'add', value: 0 }
    case 'flag':
      return { kind: 'flag', varId: flagVar, value: true }
    case 'item':
      return { kind: 'item', itemId: '', op: 'give', count: 1 }
  }
}

function defaultEffect(
  kind: EffectKind,
  entities: Record<string, Entity> | undefined,
  variables: Record<string, Variable> | undefined,
): GraphEffect {
  return createDefaultEffect(kind, entities, variables)
}

function formatEffectValue(v: NumOrExpr | undefined): string {
  if (v === undefined) return '…'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'object' && v && 'expr' in v) {
    const expr = String((v as { expr: string }).expr)
    return expr.length > 36 ? `${expr.slice(0, 36)}…` : expr
  }
  return String(v)
}

/** 一行人话摘要：类型 · 谁 · 做什么。 */
function summarizeEffect(
  eff: GraphEffect,
  entities?: Record<string, Entity>,
  variables?: Record<string, Variable>,
): string {
  const kind = EFFECT_KIND_LABEL[eff.kind] ?? eff.kind
  const entLabel = (id: string) => listEntityOptions(entities).find((o) => o.id === id)?.label ?? id
  const varLabel = (id: string) => listVarOptions(variables).find((o) => o.id === id)?.label ?? id
  const attrLabel = (entityId: string, attr: string) =>
    listAttrOptions(findEntity(entities, entityId)).find((a) => a.id === attr)?.label ?? attr
  switch (eff.kind) {
    case 'attr':
      return `${kind} · ${entLabel(eff.entityId)} 的 ${attrLabel(eff.entityId, eff.attr)} ${OP_LABEL[eff.op] ?? eff.op} ${formatEffectValue(eff.value)}`
    case 'var':
      return `${kind} · ${varLabel(eff.varId)} ${OP_LABEL[eff.op] ?? eff.op} ${formatEffectValue(eff.value)}`
    case 'flag':
      return `${kind} · ${varLabel(eff.varId)} 设为 ${eff.value ? '是' : '否'}`
    case 'item':
      return `${kind} · ${OP_LABEL[eff.op] ?? eff.op} ${eff.itemId || '？'} ×${eff.count}`
  }
}

function EffectRow({
  eff,
  entities,
  variables,
  formulas,
  onChange,
  onDelete,
}: {
  eff: GraphEffect
  onChange: (e: GraphEffect) => void
  onDelete: () => void
} & MetaCatalogProps): JSX.Element {
  const entityOpts = listEntityOptions(entities)
  const numVars = listVarOptions(variables, { numbersOnly: true })
  const flagVars = listVarOptions(variables, { flagsOnly: true })
  const summary = summarizeEffect(eff, entities, variables)

  return (
    <div style={box}>
      <div style={rowStyle}>
        <span style={{ fontSize: 12, fontWeight: 600, flex: 1, minWidth: 0 }} title={summary}>
          {summary}
        </span>
        <button type="button" style={del} onClick={onDelete} title={`删除：${summary}`}>删除</button>
      </div>
      {field('类型', (
        <select
          value={eff.kind}
          onChange={(e) => onChange(defaultEffect(e.target.value as EffectKind, entities, variables))}
          title="效果类型：属性 / 变量 / 道具"
        >
          {(eff.kind === 'flag' ? [...EFFECT_KINDS, 'flag' as EffectKind] : EFFECT_KINDS).map((k) => (
            <option key={k} value={k}>{EFFECT_KIND_LABEL[k] ?? k}</option>
          ))}
        </select>
      ))}
      {eff.kind === 'attr' && (
        <>
          {entityOpts.length === 0 && <p style={hint}>请先到「配置」添加实体</p>}
          {field('实体', (
            <EntitySelect
              value={eff.entityId}
              entities={entities}
              onChange={(entityId) => {
                const attr = listAttrOptions(findEntity(entities, entityId))[0]?.id ?? eff.attr
                onChange({ ...eff, entityId, attr })
              }}
            />
          ))}
          {field('属性', (
            <AttrSelect
              entityId={eff.entityId}
              value={eff.attr}
              entities={entities}
              onChange={(attr) => onChange({ ...eff, attr })}
            />
          ))}
          {field('值', (
            <ValueInput
              value={eff.value}
              entities={entities}
              variables={variables}
              formulas={formulas}
              onChange={(v) => onChange({ ...eff, value: v })}
              effectOp={{ op: eff.op, onOpChange: (next) => onChange({ ...eff, ...next }) }}
            />
          ))}
        </>
      )}
      {eff.kind === 'var' && (
        <>
          {numVars.length === 0 && <p style={hint}>请先到「配置」添加数值变量</p>}
          {field('变量', (
            <VarSelect
              value={eff.varId}
              variables={variables}
              numbersOnly
              onChange={(varId) => onChange({ ...eff, varId })}
            />
          ))}
          {field('值', (
            <ValueInput
              value={eff.value}
              entities={entities}
              variables={variables}
              formulas={formulas}
              onChange={(v) => onChange({ ...eff, value: v })}
              effectOp={{ op: eff.op, onOpChange: (next) => onChange({ ...eff, ...next }) }}
            />
          ))}
        </>
      )}
      {eff.kind === 'flag' && (
        <>
          {flagVars.length === 0 && <p style={hint}>请先到「配置」添加标记变量</p>}
          {field('标记', (
            <VarSelect
              value={eff.varId}
              variables={variables}
              flagsOnly
              onChange={(varId) => onChange({ ...eff, varId })}
            />
          ))}
          {field('值', (
            <select value={String(eff.value)} onChange={(e) => onChange({ ...eff, value: e.target.value === 'true' })}>
              <option value="true">是</option>
              <option value="false">否</option>
            </select>
          ))}
        </>
      )}
      {eff.kind === 'item' && (
        <>
          {field('道具', <input value={eff.itemId} onChange={(e) => onChange({ ...eff, itemId: e.target.value })} style={{ flex: 1 }} />)}
          {field('操作', (
            <select value={eff.op} onChange={(e) => onChange({ ...eff, op: e.target.value as 'give' | 'take' })}>
              <option value="give">{OP_LABEL.give}</option>
              <option value="take">{OP_LABEL.take}</option>
            </select>
          ))}
          {field('数量', <input type="number" value={eff.count} onChange={(e) => onChange({ ...eff, count: Number(e.target.value) || 0 })} style={{ width: 90 }} />)}
        </>
      )}
    </div>
  )
}

export function EffectsEditor({
  value,
  onChange,
  entities,
  variables,
  formulas,
  pickers,
}: {
  value: GraphEffect[] | undefined
  onChange: (v: GraphEffect[]) => void
  pickers?: EditorPickerCtx
} & MetaCatalogProps): JSX.Element {
  const cat = resolveCatalog({ entities, variables, formulas, pickers })
  const list = value ?? []
  return (
    <div>
      {list.map((eff, i) => (
        <EffectRow
          key={i}
          eff={eff}
          entities={cat.entities}
          variables={cat.variables}
          formulas={cat.formulas}
          onChange={(next) => onChange(list.map((e, idx) => (idx === i ? next : e)))}
          onDelete={() => onChange(list.filter((_, idx) => idx !== i))}
        />
      ))}
      <button style={{ marginTop: 4 }} onClick={() => onChange([...list, defaultEffect('attr', cat.entities, cat.variables)])}>+ 效果</button>
    </div>
  )
}

// ── condition（GraphCondition = { all: GraphClause[] }）────────────────────────
type ClauseType = GraphClause['type']
const CLAUSE_TYPES: ClauseType[] = ['attrRatio', 'attr', 'attrCompare', 'var', 'flag', 'visited', 'score', 'hasItem']

function defaultClause(
  type: ClauseType,
  entities: Record<string, Entity> | undefined,
  variables: Record<string, Variable> | undefined,
): GraphClause {
  const ents = listEntityOptions(entities)
  const ent = ents[0]?.id ?? ''
  const ent2 = ents[1]?.id ?? ent
  const attr = listAttrOptions(findEntity(entities, ent))[0]?.id ?? 'hp'
  const numVar = listVarOptions(variables, { numbersOnly: true })[0]?.id ?? ''
  const flagVar = listVarOptions(variables, { flagsOnly: true })[0]?.id ?? ''
  switch (type) {
    case 'var':
      return { type: 'var', varId: numVar, op: 'gte', value: 0 }
    case 'flag':
      return { type: 'flag', varId: flagVar, equals: true }
    case 'visited':
      return { type: 'visited', nodeId: '' }
    case 'attr':
      return { type: 'attr', entityId: ent, attr, op: 'lte', value: 0 }
    case 'attrRatio':
      return { type: 'attrRatio', entityId: ent, attr, op: 'lte', value: 0 }
    case 'attrCompare':
      return { type: 'attrCompare', left: ent, right: ent2, attr: listAttrOptions(findEntity(entities, ent)).find((a) => a.id === 'speed')?.id ?? attr, op: 'gte' }
    case 'score':
      return { type: 'score', op: 'gte', value: 0 }
    case 'hasItem':
      return { type: 'hasItem', itemId: '', count: 1 }
  }
}

const opSelect = (op: CmpOp, onChange: (op: CmpOp) => void): JSX.Element => (
  <select value={op} onChange={(e) => onChange(e.target.value as CmpOp)}>
    {CMP_OPS.map((o) => (
      <option key={o} value={o}>{CMP_LABEL[o]}</option>
    ))}
  </select>
)

function ClauseRow({
  clause,
  nodeIds,
  entities,
  variables,
  nodeLabel,
  onChange,
  onDelete,
}: {
  clause: GraphClause
  nodeIds: string[]
  nodeLabel?: (id: string) => string
  onChange: (c: GraphClause) => void
  onDelete: () => void
} & MetaCatalogProps): JSX.Element {
  return (
    <div style={box}>
      <div style={rowStyle}>
        <select value={clause.type} onChange={(e) => onChange(defaultClause(e.target.value as ClauseType, entities, variables))}>
          {CLAUSE_TYPES.map((t) => (
            <option key={t} value={t}>{CLAUSE_LABEL[t] ?? t}</option>
          ))}
        </select>
        <button style={del} onClick={onDelete}>删除</button>
      </div>
      {(clause.type === 'attr' || clause.type === 'attrRatio') && (
        <>
          {field('实体', (
            <EntitySelect
              value={clause.entityId}
              entities={entities}
              onChange={(entityId) => {
                const attr = listAttrOptions(findEntity(entities, entityId))[0]?.id ?? clause.attr
                onChange({ ...clause, entityId, attr })
              }}
            />
          ))}
          {field('属性', (
            <AttrSelect
              entityId={clause.entityId}
              value={clause.attr}
              entities={entities}
              onChange={(attr) => onChange({ ...clause, attr })}
            />
          ))}
          {field('op', opSelect(clause.op, (op) => onChange({ ...clause, op })))}
          {field('值', <input type="number" value={clause.value} onChange={(e) => onChange({ ...clause, value: Number(e.target.value) || 0 })} style={{ width: 90 }} />)}
        </>
      )}
      {clause.type === 'attrCompare' && (
        <>
          {field('左', (
            <EntitySelect value={clause.left} entities={entities} onChange={(left) => onChange({ ...clause, left })} />
          ))}
          {field('右', (
            <EntitySelect value={clause.right} entities={entities} onChange={(right) => onChange({ ...clause, right })} />
          ))}
          {field('属性', (
            <AttrSelect
              entityId={clause.left}
              value={clause.attr}
              entities={entities}
              onChange={(attr) => onChange({ ...clause, attr })}
            />
          ))}
          {field('op', opSelect(clause.op, (op) => onChange({ ...clause, op })))}
        </>
      )}
      {clause.type === 'var' && (
        <>
          {field('变量', (
            <VarSelect
              value={clause.varId}
              variables={variables}
              numbersOnly
              onChange={(varId) => onChange({ ...clause, varId })}
            />
          ))}
          {field('op', opSelect(clause.op, (op) => onChange({ ...clause, op })))}
          {field('值', <input type="number" value={clause.value} onChange={(e) => onChange({ ...clause, value: Number(e.target.value) || 0 })} style={{ width: 90 }} />)}
        </>
      )}
      {clause.type === 'flag' && (
        <>
          {field('标记', (
            <VarSelect
              value={clause.varId}
              variables={variables}
              flagsOnly
              onChange={(varId) => onChange({ ...clause, varId })}
            />
          ))}
          {field('等于', (
            <select value={String(clause.equals)} onChange={(e) => onChange({ ...clause, equals: e.target.value === 'true' })}>
              <option value="true">是</option>
              <option value="false">否</option>
            </select>
          ))}
        </>
      )}
      {clause.type === 'visited' && field('节点', (
        <select value={clause.nodeId} onChange={(e) => onChange({ ...clause, nodeId: e.target.value })} style={{ flex: 1 }}>
          <option value="">（选节点）</option>
          {nodeIds.map((id) => (
            <option key={id} value={id}>{nodeLabel?.(id) ?? id}</option>
          ))}
        </select>
      ))}
      {clause.type === 'score' && (
        <>
          {field('op', opSelect(clause.op, (op) => onChange({ ...clause, op })))}
          {field('值', <input type="number" value={clause.value} onChange={(e) => onChange({ ...clause, value: Number(e.target.value) || 0 })} style={{ width: 90 }} />)}
        </>
      )}
      {clause.type === 'hasItem' && (
        <>
          {field('道具', <input value={clause.itemId} onChange={(e) => onChange({ ...clause, itemId: e.target.value })} style={{ flex: 1 }} />)}
          {field('数量', <input type="number" value={clause.count ?? 1} onChange={(e) => onChange({ ...clause, count: Number(e.target.value) || 0 })} style={{ width: 90 }} />)}
        </>
      )}
    </div>
  )
}

export function ConditionEditor({
  value,
  nodeIds,
  onChange,
  entities,
  variables,
  pickers,
}: {
  value: GraphCondition | undefined
  nodeIds: string[]
  onChange: (v: GraphCondition | undefined) => void
  pickers?: EditorPickerCtx
} & MetaCatalogProps): JSX.Element {
  const cat = resolveCatalog({ entities, variables, pickers })
  const all = value?.all ?? []
  const set = (next: GraphClause[]) => onChange(next.length ? { all: next } : undefined)
  return (
    <div>
      {all.length === 0 && <div style={{ opacity: 0.5, fontSize: 11 }}>无条件（恒真）</div>}
      {all.map((c, i) => (
        <ClauseRow
          key={i}
          clause={c}
          nodeIds={nodeIds}
          entities={cat.entities}
          variables={cat.variables}
          nodeLabel={cat.nodeLabel}
          onChange={(next) => set(all.map((x, idx) => (idx === i ? next : x)))}
          onDelete={() => set(all.filter((_, idx) => idx !== i))}
        />
      ))}
      <button style={{ marginTop: 4 }} onClick={() => set([...all, defaultClause('attrRatio', cat.entities, cat.variables)])}>+ 条件（AND）</button>
    </div>
  )
}

// ── 交互事件目录（共享 id/label；choice→condition / hotspot→x,y 为组件私有扩展）──
function allocEventId(list: ComponentEventLike[]): string {
  let i = list.length
  let id = `opt${i}`
  const used = new Set(list.map((e) => e.id))
  while (used.has(id)) {
    i += 1
    id = `opt${i}`
  }
  return id
}

export function EventsEditor({
  value,
  onChange,
  variant = 'plain',
  pickers,
}: {
  value: ComponentEventLike[] | undefined
  onChange: (v: ComponentEventLike[]) => void
  /** plain=目录；choice=可配门控；hotspot=可配锚点。 */
  variant?: EventsEditorVariant
  pickers?: EditorPickerCtx
}): JSX.Element {
  const list = value ?? []
  const cat = pickers ?? {}
  const patch = (i: number, p: Partial<ComponentEventLike>) => onChange(list.map((e, idx) => (idx === i ? { ...e, ...p } : e)))
  return (
    <div>
      <div style={{ fontSize: 11, opacity: 0.55, marginBottom: 4 }}>
        每项 = 一个出口事件；出边 <code>sourceHandle === 此 id</code>。副作用请写节点 reactions（event 同名）。
        {variant === 'choice' ? ' 门控 condition 属本组件（灰置禁选）。' : null}
        {variant === 'hotspot' ? ' 坐标 x/y 属本组件画面锚点。' : null}
      </div>
      {list.map((o, i) => (
        <div key={`${o.id}-${i}`} style={box}>
          <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4 }} title={o.id}>
            出口 · {flowHandleDisplay(o.id, o.label)}
          </div>
          {field('标识', (
            <input
              value={o.id}
              onChange={(e) => patch(i, { id: e.target.value })}
              style={{ flex: 1, fontFamily: 'monospace', fontSize: 11 }}
              title="落盘 id；出边 sourceHandle = 此 id"
            />
          ))}
          {field('显示文案', <input value={o.label ?? ''} onChange={(e) => patch(i, { label: e.target.value })} style={{ flex: 1 }} />)}
          {variant === 'hotspot' ? (
            <div style={{ display: 'flex', gap: 4 }}>
              {field('x', (
                <input type="number" step={0.05} value={o.x ?? ''} onChange={(e) => patch(i, { x: e.target.value === '' ? undefined : Number(e.target.value) })} style={{ flex: 1, fontSize: 11 }} />
              ))}
              {field('y', (
                <input type="number" step={0.05} value={o.y ?? ''} onChange={(e) => patch(i, { y: e.target.value === '' ? undefined : Number(e.target.value) })} style={{ flex: 1, fontSize: 11 }} />
              ))}
            </div>
          ) : null}
          {variant === 'choice' ? (
            <>
              <div style={{ fontSize: 11, opacity: 0.7, margin: '4px 0 2px' }}>可选条件（不成立则锁定）</div>
              <ConditionEditor
                value={o.condition}
                nodeIds={[]}
                pickers={cat}
                entities={cat.entities}
                variables={cat.variables}
                onChange={(condition) => patch(i, { condition: condition ?? undefined })}
              />
            </>
          ) : null}
          <button style={{ ...del, marginTop: 4 }} onClick={() => onChange(list.filter((_, idx) => idx !== i))}>删除</button>
        </div>
      ))}
      <button
        style={{ marginTop: 4 }}
        onClick={() => {
          const id = allocEventId(list)
          onChange([...list, { id, label: `选项 ${list.length + 1}` }])
        }}
      >
        + 事件
      </button>
    </div>
  )
}
