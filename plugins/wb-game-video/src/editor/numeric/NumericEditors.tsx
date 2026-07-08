import { useMemo } from 'react'
import type {
  Branch,
  BranchKind,
  ConditionClause,
  Effect,
  EffectOp,
  GameVariable,
  GameVariableKind,
  InventoryItem,
  Scenario,
} from '../../scenario/types'
import { injectStyleOnce } from '../../styles/injectStyle'

/**
 * NumericEditors —— 数值系统的可复用行级编辑器。
 *
 * 从 TimelineDock 抽出(原 VarDefRow / EffectListEditor / BranchGateEditor /
 * ConditionRow)，让时间轴侧栏与「模块 · 数值系统」节点图共用同一套交互，
 * 改一处两处都生效。样式自包含(ks-ne-*)，只依赖全局 --color-* token，
 * 因此放在任何容器里都能正确渲染。
 */

export const VAR_OP_LABELS: Record<'gte' | 'gt' | 'lte' | 'lt' | 'eq' | 'neq', string> = {
  gte: '≥',
  gt: '>',
  lte: '≤',
  lt: '<',
  eq: '=',
  neq: '≠',
}

/** 单个变量定义行(变量名 / 类型 / 初始值 / 删除)。 */
export function VarDefRow({
  variable,
  onChange,
  onRemove,
}: {
  variable: GameVariable
  onChange: (patch: Partial<GameVariable>) => void
  onRemove: () => void
}) {
  return (
    <div className="ks-ne-row">
      <input
        className="ks-ne-name"
        value={variable.name}
        onChange={(e) => onChange({ name: e.target.value })}
        placeholder="变量名"
      />
      <select
        className="ks-ne-kind"
        value={variable.kind}
        onChange={(e) => {
          const kind = e.target.value as GameVariableKind
          onChange({ kind, initial: kind === 'flag' ? 0 : variable.initial })
        }}
      >
        <option value="number">数值</option>
        <option value="flag">旗标</option>
      </select>
      {variable.kind === 'flag' ? (
        <select
          className="ks-ne-init"
          value={variable.initial ? '1' : '0'}
          onChange={(e) => onChange({ initial: e.target.value === '1' ? 1 : 0 })}
        >
          <option value="0">初始否</option>
          <option value="1">初始是</option>
        </select>
      ) : (
        <input
          className="ks-ne-init"
          type="number"
          value={variable.initial}
          onChange={(e) => onChange({ initial: Number(e.target.value) || 0 })}
          title="初始值"
        />
      )}
      <button type="button" className="ks-ne-del" onClick={onRemove} title="删除变量">
        ✕
      </button>
    </div>
  )
}

const EFFECT_KIND_LABELS: Record<Effect['kind'], string> = {
  var: '数值',
  flag: '旗标',
  item: '物品',
  entityStat: '实体属性',
  status: '状态',
}

interface EffectRegistries {
  numberVars: GameVariable[]
  flagVars: GameVariable[]
  items: InventoryItem[]
  entities: { id: string; name: string }[]
  statuses: { id: string; name: string }[]
}

function newEffectId(): string {
  return `eff-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

/** 按可用注册表决定能新建哪些 effect 类型（无对应词汇表则不提供）。 */
function effectKindOptions(reg: EffectRegistries): Effect['kind'][] {
  const out: Effect['kind'][] = []
  if (reg.numberVars.length) out.push('var')
  if (reg.items.length) out.push('item')
  if (reg.entities.length) out.push('entityStat')
  if (reg.flagVars.length) out.push('flag')
  if (reg.entities.length && reg.statuses.length) out.push('status')
  return out
}

function makeDefaultEffect(kind: Effect['kind'], reg: EffectRegistries): Effect {
  const id = newEffectId()
  switch (kind) {
    case 'var':
      return { id, kind: 'var', varId: reg.numberVars[0]?.id ?? '', op: 'add', value: 1 }
    case 'flag':
      return { id, kind: 'flag', varId: reg.flagVars[0]?.id ?? '', value: true }
    case 'item':
      return { id, kind: 'item', itemId: reg.items[0]?.id ?? '', op: 'give', count: 1 }
    case 'entityStat':
      return { id, kind: 'entityStat', entityId: reg.entities[0]?.id ?? '', stat: 'hp', op: 'add', value: -10 }
    case 'status':
      return { id, kind: 'status', statusId: reg.statuses[0]?.id ?? '', entityId: reg.entities[0]?.id, op: 'add' }
  }
}

/** 单条 effect 行 —— kind 选择器 + 按 kind 渲染字段。 */
function EffectRow({
  eff,
  kinds,
  reg,
  onChange,
  onRemove,
}: {
  eff: Effect
  kinds: Effect['kind'][]
  reg: EffectRegistries
  onChange: (next: Effect) => void
  onRemove: () => void
}) {
  return (
    <div className="ks-ne-row">
      <select
        className="ks-ne-kind"
        value={eff.kind}
        onChange={(e) => onChange(makeDefaultEffect(e.target.value as Effect['kind'], reg))}
        title="效果类型"
      >
        {kinds.map((k) => (
          <option key={k} value={k}>
            {EFFECT_KIND_LABELS[k]}
          </option>
        ))}
      </select>

      {eff.kind === 'var' && (
        <>
          <select className="ks-ne-name" value={eff.varId} onChange={(e) => onChange({ ...eff, varId: e.target.value })}>
            {reg.numberVars.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
          <select className="ks-ne-op" value={eff.op} onChange={(e) => onChange({ ...eff, op: e.target.value as EffectOp })}>
            <option value="add">增加</option>
            <option value="set">设为</option>
          </select>
          <input
            className="ks-ne-init"
            type="number"
            value={eff.value}
            onChange={(e) => onChange({ ...eff, value: Number(e.target.value) || 0 })}
          />
        </>
      )}

      {eff.kind === 'flag' && (
        <>
          <select className="ks-ne-name" value={eff.varId} onChange={(e) => onChange({ ...eff, varId: e.target.value })}>
            {reg.flagVars.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
          <select
            className="ks-ne-op"
            value={eff.value ? '1' : '0'}
            onChange={(e) => onChange({ ...eff, value: e.target.value === '1' })}
          >
            <option value="1">设为真</option>
            <option value="0">设为假</option>
          </select>
        </>
      )}

      {eff.kind === 'item' && (
        <>
          <select className="ks-ne-name" value={eff.itemId} onChange={(e) => onChange({ ...eff, itemId: e.target.value })}>
            {reg.items.map((it) => (
              <option key={it.id} value={it.id}>{it.name}</option>
            ))}
          </select>
          <select className="ks-ne-op" value={eff.op} onChange={(e) => onChange({ ...eff, op: e.target.value as 'give' | 'take' })}>
            <option value="give">获得</option>
            <option value="take">消耗</option>
          </select>
          <input
            className="ks-ne-init"
            type="number"
            min={1}
            value={eff.count}
            onChange={(e) => onChange({ ...eff, count: Math.max(1, Number(e.target.value) || 1) })}
          />
        </>
      )}

      {eff.kind === 'entityStat' && (
        <>
          <select className="ks-ne-name" value={eff.entityId} onChange={(e) => onChange({ ...eff, entityId: e.target.value })}>
            {reg.entities.map((en) => (
              <option key={en.id} value={en.id}>{en.name}</option>
            ))}
          </select>
          <select className="ks-ne-op" value={eff.stat} onChange={(e) => onChange({ ...eff, stat: e.target.value as 'hp' | 'qi' | 'shield' })}>
            <option value="hp">HP</option>
            <option value="qi">气力</option>
            <option value="shield">护盾</option>
          </select>
          <select className="ks-ne-op" value={eff.op} onChange={(e) => onChange({ ...eff, op: e.target.value as EffectOp })}>
            <option value="add">增减</option>
            <option value="set">设为</option>
          </select>
          <input
            className="ks-ne-init"
            type="number"
            value={eff.value}
            onChange={(e) => onChange({ ...eff, value: Number(e.target.value) || 0 })}
          />
        </>
      )}

      {eff.kind === 'status' && (
        <>
          <select className="ks-ne-name" value={eff.statusId} onChange={(e) => onChange({ ...eff, statusId: e.target.value })}>
            {reg.statuses.map((st) => (
              <option key={st.id} value={st.id}>{st.name}</option>
            ))}
          </select>
          <select className="ks-ne-op" value={eff.op} onChange={(e) => onChange({ ...eff, op: e.target.value as 'add' | 'remove' })}>
            <option value="add">施加</option>
            <option value="remove">移除</option>
          </select>
          <select
            className="ks-ne-name"
            value={eff.entityId ?? ''}
            onChange={(e) => onChange({ ...eff, entityId: e.target.value || undefined })}
            title="作用目标（缺省 = 默认目标）"
          >
            <option value="">默认目标</option>
            {reg.entities.map((en) => (
              <option key={en.id} value={en.id}>{en.name}</option>
            ))}
          </select>
        </>
      )}

      <button type="button" className="ks-ne-del" onClick={onRemove} title="删除效果">
        ✕
      </button>
    </div>
  )
}

/**
 * 一组副作用编辑器（用于 scene.onEnterEffects 和 branch.effects）。
 * 支持 var / flag / item / entityStat / status 五类；可新建的 kind 取决于传入的
 * 注册表（无变量则不能建 var，无物品则不能建 item……），避免建出空引用的效果。
 */
export function EffectListEditor({
  variables,
  effects,
  onChange,
  items = [],
  entities = [],
  statuses = [],
}: {
  variables: GameVariable[]
  effects: Effect[]
  onChange: (effects: Effect[]) => void
  /** 背包物品（非空时可建「获得/消耗物品」）。 */
  items?: InventoryItem[]
  /** 玩法实体（非空时可建「实体属性」「状态」）。 */
  entities?: { id: string; name: string }[]
  /** 状态注册表（配合 entities 非空时可建「状态」）。 */
  statuses?: { id: string; name: string }[]
}) {
  const reg: EffectRegistries = {
    numberVars: variables.filter((v) => v.kind === 'number'),
    flagVars: variables.filter((v) => v.kind === 'flag'),
    items,
    entities,
    statuses,
  }
  const kinds = effectKindOptions(reg)
  if (kinds.length === 0) {
    return <div className="ks-ne-empty">先定义变量 / 物品 / 实体，才能设置效果</div>
  }
  return (
    <>
      {effects.map((eff) => (
        <EffectRow
          key={eff.id}
          eff={eff}
          kinds={kinds}
          reg={reg}
          onChange={(next) => onChange(effects.map((x) => (x.id === eff.id ? next : x)))}
          onRemove={() => onChange(effects.filter((x) => x.id !== eff.id))}
        />
      ))}
      <button
        type="button"
        className="ks-ne-addbtn"
        onClick={() => onChange([...effects, makeDefaultEffect(kinds[0]!, reg)])}
      >
        ＋ 新增效果
      </button>
    </>
  )
}

/** 单条条件子句行（数值 / 旗标 / 经历过 / 拥有物品 / 血量比例 / QTE分数 / 状态）。 */
export function ConditionRow({
  clause,
  variables,
  sceneOptions,
  items = [],
  entities = [],
  statuses = [],
  onChange,
  onRemove,
}: {
  clause: ConditionClause
  variables: GameVariable[]
  sceneOptions: { id: string; title: string }[]
  /** 背包物品（非空时才提供「拥有物品」条件）。 */
  items?: InventoryItem[]
  /** 玩法实体（非空时才提供「血量比例」「状态」条件的目标选择）。 */
  entities?: { id: string; name: string }[]
  /** 状态效果注册表（非空时才提供「状态」条件）。 */
  statuses?: { id: string; name: string }[]
  onChange: (c: ConditionClause) => void
  onRemove: () => void
}) {
  const firstVarId = variables[0]?.id ?? ''
  const firstItemId = items[0]?.id ?? ''
  const firstEntityId = entities[0]?.id ?? ''
  const firstStatusId = statuses[0]?.id ?? ''
  return (
    <div className="ks-ne-row">
      <select
        className="ks-ne-kind"
        value={clause.type}
        onChange={(e) => {
          const type = e.target.value as ConditionClause['type']
          if (type === 'var') onChange({ type: 'var', varId: firstVarId, op: 'gte', value: 1 })
          else if (type === 'flag') onChange({ type: 'flag', varId: firstVarId, equals: true })
          else if (type === 'hasItem') onChange({ type: 'hasItem', itemId: firstItemId, count: 1 })
          else if (type === 'hpRatio') onChange({ type: 'hpRatio', entityId: firstEntityId, op: 'gt', value: 0 })
          else if (type === 'score') onChange({ type: 'score', op: 'gte', value: 1 })
          else if (type === 'status') onChange({ type: 'status', statusId: firstStatusId, present: true })
          else if (type === 'attrCompare')
            onChange({ type: 'attrCompare', left: firstEntityId, attr: 'speed', op: 'gte', right: entities[1]?.id ?? firstEntityId })
          else onChange({ type: 'visited', sceneId: sceneOptions[0]?.id ?? '' })
        }}
      >
        <option value="var">数值</option>
        <option value="flag">旗标</option>
        <option value="visited">经历过</option>
        {items.length > 0 && <option value="hasItem">拥有物品</option>}
        {entities.length > 0 && <option value="hpRatio">血量比例</option>}
        <option value="score">QTE分数</option>
        {statuses.length > 0 && <option value="status">状态</option>}
        {entities.length > 0 && <option value="attrCompare">属性比较</option>}
      </select>

      {clause.type === 'hasItem' && (
        <>
          <select
            className="ks-ne-name"
            value={clause.itemId}
            onChange={(e) => onChange({ ...clause, itemId: e.target.value })}
          >
            {items.map((it) => (
              <option key={it.id} value={it.id}>
                {it.name}
              </option>
            ))}
          </select>
          <input
            className="ks-ne-init"
            type="number"
            min={1}
            value={clause.count ?? 1}
            onChange={(e) =>
              onChange({ ...clause, count: Math.max(1, Number(e.target.value) || 1) })
            }
            title="需要数量"
          />
        </>
      )}

      {clause.type === 'var' && (
        <>
          <select
            className="ks-ne-name"
            value={clause.varId}
            onChange={(e) => onChange({ ...clause, varId: e.target.value })}
          >
            {variables.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          <select
            className="ks-ne-op"
            value={clause.op}
            onChange={(e) => onChange({ ...clause, op: e.target.value as typeof clause.op })}
          >
            <option value="gte">≥</option>
            <option value="gt">&gt;</option>
            <option value="lte">≤</option>
            <option value="lt">&lt;</option>
            <option value="eq">=</option>
            <option value="neq">≠</option>
          </select>
          <input
            className="ks-ne-init"
            type="number"
            value={clause.value}
            onChange={(e) => onChange({ ...clause, value: Number(e.target.value) || 0 })}
          />
        </>
      )}

      {clause.type === 'flag' && (
        <>
          <select
            className="ks-ne-name"
            value={clause.varId}
            onChange={(e) => onChange({ ...clause, varId: e.target.value })}
          >
            {variables.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          <select
            className="ks-ne-init"
            value={clause.equals ? '1' : '0'}
            onChange={(e) => onChange({ ...clause, equals: e.target.value === '1' })}
          >
            <option value="1">为是</option>
            <option value="0">为否</option>
          </select>
        </>
      )}

      {clause.type === 'visited' && (
        <select
          className="ks-ne-name ks-ne-scenesel"
          value={clause.sceneId}
          onChange={(e) => onChange({ ...clause, sceneId: e.target.value })}
        >
          {sceneOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.title}
            </option>
          ))}
        </select>
      )}

      {clause.type === 'hpRatio' && (
        <>
          <select
            className="ks-ne-name"
            value={clause.entityId}
            onChange={(e) => onChange({ ...clause, entityId: e.target.value })}
          >
            {entities.map((en) => (
              <option key={en.id} value={en.id}>
                {en.name}
              </option>
            ))}
          </select>
          <select
            className="ks-ne-op"
            value={clause.op}
            onChange={(e) => onChange({ ...clause, op: e.target.value as typeof clause.op })}
          >
            <option value="gte">≥</option>
            <option value="gt">&gt;</option>
            <option value="lte">≤</option>
            <option value="lt">&lt;</option>
            <option value="eq">=</option>
            <option value="neq">≠</option>
          </select>
          <input
            className="ks-ne-init"
            type="number"
            min={0}
            max={100}
            value={Math.round((clause.value ?? 0) * 100)}
            onChange={(e) =>
              onChange({ ...clause, value: Math.max(0, Math.min(100, Number(e.target.value) || 0)) / 100 })
            }
            title="血量百分比 0~100"
          />
          <span className="ks-ne-suffix">%</span>
        </>
      )}

      {clause.type === 'score' && (
        <>
          <span className="ks-ne-suffix ks-ne-suffix-lead">分数</span>
          <select
            className="ks-ne-op"
            value={clause.op}
            onChange={(e) => onChange({ ...clause, op: e.target.value as typeof clause.op })}
          >
            <option value="gte">≥</option>
            <option value="gt">&gt;</option>
            <option value="lte">≤</option>
            <option value="lt">&lt;</option>
            <option value="eq">=</option>
            <option value="neq">≠</option>
          </select>
          <input
            className="ks-ne-init"
            type="number"
            value={clause.value}
            onChange={(e) => onChange({ ...clause, value: Number(e.target.value) || 0 })}
          />
        </>
      )}

      {clause.type === 'status' && (
        <>
          <select
            className="ks-ne-name"
            value={clause.statusId}
            onChange={(e) => onChange({ ...clause, statusId: e.target.value })}
          >
            {statuses.map((st) => (
              <option key={st.id} value={st.id}>
                {st.name}
              </option>
            ))}
          </select>
          <select
            className="ks-ne-kind"
            value={clause.entityId ?? ''}
            onChange={(e) =>
              onChange({ ...clause, entityId: e.target.value || undefined })
            }
            title="目标实体（留空=任意）"
          >
            <option value="">任意</option>
            {entities.map((en) => (
              <option key={en.id} value={en.id}>
                {en.name}
              </option>
            ))}
          </select>
          <select
            className="ks-ne-op"
            value={clause.present ? '1' : '0'}
            onChange={(e) => onChange({ ...clause, present: e.target.value === '1' })}
          >
            <option value="1">带有</option>
            <option value="0">没有</option>
          </select>
        </>
      )}

      {clause.type === 'attrCompare' && (
        <>
          <select
            className="ks-ne-name"
            value={clause.left}
            onChange={(e) => onChange({ ...clause, left: e.target.value })}
            title="左侧实体"
          >
            {entities.map((en) => (
              <option key={en.id} value={en.id}>
                {en.name}
              </option>
            ))}
          </select>
          <select
            className="ks-ne-op"
            value={clause.op}
            onChange={(e) => onChange({ ...clause, op: e.target.value as typeof clause.op })}
          >
            <option value="gte">≥</option>
            <option value="gt">&gt;</option>
            <option value="lte">≤</option>
            <option value="lt">&lt;</option>
            <option value="eq">=</option>
            <option value="neq">≠</option>
          </select>
          <select
            className="ks-ne-name"
            value={clause.right}
            onChange={(e) => onChange({ ...clause, right: e.target.value })}
            title="右侧实体"
          >
            {entities.map((en) => (
              <option key={en.id} value={en.id}>
                {en.name}
              </option>
            ))}
          </select>
          <span className="ks-ne-unit" title="比较属性">出手速度</span>
        </>
      )}

      <button type="button" className="ks-ne-del" onClick={onRemove} title="删除条件">
        ✕
      </button>
    </div>
  )
}

/** 默认新增一条条件子句（优先 var，没有变量时退回 visited）。 */
export function makeDefaultClause(
  variables: GameVariable[],
  sceneOptions: { id: string; title: string }[],
): ConditionClause {
  return variables[0]
    ? { type: 'var', varId: variables[0].id, op: 'gte', value: 1 }
    : { type: 'visited', sceneId: sceneOptions[0]?.id ?? '' }
}

/** 单条分支的「解锁条件 + 不满足表现 + 选择效果」编辑器。 */
export function BranchGateEditor({
  branch,
  scenario,
  variables,
  items = [],
  onPatch,
  onRemove,
  lockKind = false,
}: {
  branch: Branch
  scenario: Scenario
  variables: GameVariable[]
  /** 背包物品（非空时分支可设「拥有物品」条件与「获得/消耗物品」效果）。 */
  items?: InventoryItem[]
  onPatch: (patch: Partial<Branch>) => void
  onRemove?: () => void
  /** true = 锁定分支触发类型（不渲染 kind 下拉）。用于「选项」检视器：语境已固定为玩家选择。 */
  lockKind?: boolean
}) {
  const clauses = branch.condition?.all ?? []
  const sceneOptions = useMemo(
    () => Object.values(scenario.scenes).map((s) => ({ id: s.id, title: s.title ?? s.id })),
    [scenario.scenes],
  )
  const entityOptions = useMemo(
    () => Object.values(scenario.entities ?? {}).map((en) => ({ id: en.id, name: en.name })),
    [scenario.entities],
  )
  const statusOptions = useMemo(
    () => Object.values(scenario.statuses ?? {}).map((st) => ({ id: st.id, name: st.name })),
    [scenario.statuses],
  )
  const targetTitle = scenario.scenes[branch.targetSceneId]?.title || branch.targetSceneId
  const hasEffects = (branch.effects?.length ?? 0) > 0

  function setClauses(next: ConditionClause[]): void {
    onPatch({ condition: next.length ? { all: next } : undefined })
  }

  return (
    <div className="ks-ne-gate">
      <div className="ks-ne-gate-head">
        <span className={`ks-ne-kindpill kind-${branch.kind}`}>{BRANCH_KIND_LABELS[branch.kind]}</span>
        <span className="ks-ne-gate-arrow">→</span>
        <span className="ks-ne-gate-target" title={targetTitle}>{targetTitle}</span>
        {onRemove && (
          <button type="button" className="ks-ne-del" onClick={onRemove} title="删除选项">
            ✕
          </button>
        )}
      </div>

      <div className="ks-ne-gate-typerow">
        {!lockKind && (
          <select
            className="ks-ne-kind"
            value={branch.kind}
            onChange={(e) => onPatch({ kind: e.target.value as BranchKind })}
            title="分支连线类型"
          >
            <option value="choice">玩家选择</option>
            <option value="auto">自动续播</option>
            <option value="qte_pass">QTE 通过</option>
            <option value="qte_fail">QTE 失败</option>
          </select>
        )}
        <input
          className="ks-ne-gate-labelinput"
          value={branch.label ?? ''}
          onChange={(e) => onPatch({ label: e.target.value || undefined })}
          placeholder={branch.kind === 'choice' ? '按钮文字' : '标签(可选)'}
        />
      </div>

      {(branch.kind === 'qte_pass' || branch.kind === 'qte_fail') && (
        <div className="ks-ne-gate-typerow">
          <span className="ks-ne-suffix ks-ne-suffix-lead">判定档</span>
          <select
            className="ks-ne-name"
            value={branch.qteOutcome ?? (branch.kind === 'qte_pass' ? 'pass' : 'fail')}
            onChange={(e) => onPatch({ qteOutcome: e.target.value as 'pass' | 'good' | 'fail' })}
            title="该分支对应的 QTE 判定档（多档防反：完美 pass / 成功 good / 失败 fail）"
          >
            <option value="pass">完美 pass</option>
            <option value="good">成功 good</option>
            <option value="fail">失败 fail</option>
          </select>
        </div>
      )}

      <div className="ks-ne-sublabel">
        <span className="ks-ne-sublabel-txt">跳转目标</span>
        <span className="ks-ne-sublabel-hint">玩家选择后进入的节点</span>
      </div>
      <select
        className="ks-ne-name"
        value={branch.targetSceneId}
        onChange={(e) => onPatch({ targetSceneId: e.target.value })}
      >
        {sceneOptions.map((scene) => (
          <option key={scene.id} value={scene.id}>
            {scene.title}
          </option>
        ))}
      </select>

      <div className="ks-ne-sublabel">
        <span className="ks-ne-sublabel-txt">解锁条件</span>
        <span className="ks-ne-sublabel-hint">满足才出现这条分支</span>
      </div>
      {clauses.map((c, i) => (
        <ConditionRow
          key={i}
          clause={c}
          variables={variables}
          sceneOptions={sceneOptions}
          items={items}
          entities={entityOptions}
          statuses={statusOptions}
          onChange={(nc) => setClauses(clauses.map((x, j) => (j === i ? nc : x)))}
          onRemove={() => setClauses(clauses.filter((_, j) => j !== i))}
        />
      ))}
      {clauses.length === 0 && <div className="ks-ne-inline-empty">无条件 · 始终可走</div>}
      <div className="ks-ne-gate-actions">
        <button
          type="button"
          className="ks-ne-addbtn ks-ne-gate-addcond"
          onClick={() => setClauses([...clauses, makeDefaultClause(variables, sceneOptions)])}
        >
          ＋ 解锁条件
        </button>
        {clauses.length > 0 && (
          <label className="ks-ne-gate-mode">
            不满足时
            <select
              value={branch.gateMode ?? 'hide'}
              onChange={(e) => onPatch({ gateMode: e.target.value as 'hide' | 'lock' })}
            >
              <option value="hide">隐藏</option>
              <option value="lock">锁定显示</option>
            </select>
          </label>
        )}
      </div>

      <div className="ks-ne-sublabel">
        <span className="ks-ne-sublabel-txt">{branch.kind === 'choice' ? '选中后' : '经过后'}效果</span>
        <span className="ks-ne-sublabel-hint">{hasEffects ? '改变状态' : '可选 · 改变数值/物品/状态'}</span>
      </div>
      <EffectListEditor
        variables={variables}
        effects={branch.effects ?? []}
        onChange={(effects) => onPatch({ effects: effects.length ? effects : undefined })}
        items={items}
        entities={entityOptions}
        statuses={statusOptions}
      />
    </div>
  )
}

/** 分支类型的可读中文标签。 */
export const BRANCH_KIND_LABELS: Record<BranchKind, string> = {
  choice: '玩家选择',
  auto: '自动续播',
  qte_pass: 'QTE通过',
  qte_fail: 'QTE失败',
}

const css = `
.ks-ne-empty {
  padding: 8px;
  font-size: 10px;
  letter-spacing: 0.1em;
  color: var(--color-text-tertiary);
  text-align: center;
  border: 1px dashed var(--color-border-subtle);
  border-radius: var(--radius-md, 8px);
}
.ks-ne-addbtn {
  appearance: none;
  border: 1px dashed var(--color-border-default);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 11px;
  padding: 5px 8px;
  border-radius: var(--radius-md, 8px);
  cursor: pointer;
  font-family: inherit;
}
.ks-ne-addbtn:hover {
  color: var(--color-text-primary);
  border-color: var(--color-border-strong, var(--color-border-default));
}
.ks-ne-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.ks-ne-row > input,
.ks-ne-row > select {
  appearance: auto;
  min-width: 0;
  height: 26px;
  padding: 0 5px;
  font-size: 11px;
  color: var(--color-text-primary);
  background: var(--color-background-base);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md, 8px);
  font-family: inherit;
}
.ks-ne-name { flex: 1 1 auto; }
.ks-ne-kind { flex: 0 0 auto; }
.ks-ne-op { flex: 0 0 46px; text-align: center; }
.ks-ne-init { flex: 0 0 64px; }
.ks-ne-suffix {
  flex: 0 0 auto;
  font-size: 10px;
  color: var(--color-text-tertiary);
}
.ks-ne-suffix-lead { margin-right: 2px; }
.ks-ne-del {
  appearance: none;
  flex: 0 0 auto;
  width: 22px;
  height: 26px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  border-radius: var(--radius-md, 8px);
}
.ks-ne-del:hover {
  color: var(--color-status-danger, #f87171);
  border-color: var(--color-status-danger, #f87171);
}
.ks-ne-gate {
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md, 8px);
  padding: 7px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  background: rgba(255,255,255,0.015);
}
.ks-ne-gate-typerow { display: flex; gap: 5px; align-items: center; }
.ks-ne-gate-labelinput {
  flex: 1 1 auto;
  min-width: 0;
  height: 26px;
  padding: 0 7px;
  font-size: 11px;
  color: var(--color-text-primary);
  background: var(--color-background-base);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md, 8px);
  font-family: inherit;
}
.ks-ne-gate-head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.ks-ne-kindpill {
  flex: 0 0 auto;
  font-size: 10px;
  font-weight: 700;
  padding: 1px 7px;
  border-radius: 6px;
  color: var(--color-text-secondary);
  background: color-mix(in srgb, var(--color-text-tertiary) 14%, transparent);
}
.ks-ne-kindpill.kind-choice { color: var(--color-brand-primary); background: color-mix(in srgb, var(--color-brand-primary) 16%, transparent); }
.ks-ne-kindpill.kind-auto { color: #8fb3ff; background: color-mix(in srgb, #8fb3ff 16%, transparent); }
.ks-ne-kindpill.kind-qte_pass { color: #67d4a6; background: color-mix(in srgb, #67d4a6 16%, transparent); }
.ks-ne-kindpill.kind-qte_fail { color: #f0a070; background: color-mix(in srgb, #f0a070 16%, transparent); }
.ks-ne-gate-arrow { flex: 0 0 auto; color: var(--color-text-tertiary); font-size: 11px; }
.ks-ne-gate-target {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ks-ne-sublabel {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-top: 3px;
}
.ks-ne-sublabel-txt {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-secondary);
}
.ks-ne-sublabel-hint {
  font-size: 10px;
  color: var(--color-text-tertiary);
}
.ks-ne-inline-empty {
  font-size: 10.5px;
  color: var(--color-text-tertiary);
  padding: 2px 2px 0;
}
.ks-ne-gate-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ks-ne-gate-addcond { flex: 1 1 auto; }
.ks-ne-gate-mode {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 9.5px;
  color: var(--color-text-tertiary);
}
.ks-ne-gate-mode select {
  height: 24px;
  font-size: 10px;
  color: var(--color-text-primary);
  background: var(--color-background-base);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md, 8px);
  font-family: inherit;
}
.ks-ne-gate-sub {
  font-size: 9px;
  letter-spacing: 0.16em;
  color: var(--color-text-tertiary);
  margin-top: 2px;
}
`
injectStyleOnce('numeric-editors', css)
