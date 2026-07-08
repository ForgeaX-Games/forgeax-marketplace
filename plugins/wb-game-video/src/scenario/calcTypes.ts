/**
 * Blueprint 「计算」组 —— 预定义计算类型目录（对齐交互原型 BP_CALC_TYPES）。
 * Scene.calcType 存 id；运行时仍由 performance / branches / rules 执行具体结算。
 */

export type CalcTypeId =
  | '出手判断'
  | '血量判定'
  | '回合结束判定'
  | '胜负判定'
  | '行为树决策'
  | '命中判定'
  | '伤害结算'
  | '条件分支'
  | '轻攻击'
  | '轻攻击·变招'
  | '重攻击'
  | '变招判定'
  | '重攻击·变招'
  | '冥想'
  | '灭世'
  | '防反判定'
  | '防反·大成功'
  | '防反·成功'
  | '防反·失败'

export interface CalcTypeSpec {
  id: CalcTypeId
  /** 给作者看的计算方式说明（只读）。 */
  method: string
}

export const CALC_TYPE_CATALOG: readonly CalcTypeSpec[] = [
  { id: '出手判断', method: '比较双方「出手速度」，速度大者先手（相等则空藏先手），计算本回合先攻方' },
  { id: '血量判定', method: '比较双方当前血量，判断是否有一方清空' },
  { id: '回合结束判定', method: '双方均已出手后，结算双方血量、判断是否分出胜负' },
  { id: '胜负判定', method: '战斗结束时比较双方存活：我方存活为胜利、我方倒下为失败' },
  { id: '行为树决策', method: '读取双方血量 / 状态评估，本回合发起进攻（攻击前摇 → 防反判定）' },
  { id: '命中判定', method: '依命中 / 闪避 / 抵抗等数值，计算技能是否命中及暴击' },
  { id: '伤害结算', method: '依攻防 / 技能系数 / 增益减益，计算伤害 / 治疗数值并更新血量' },
  { id: '条件分支', method: '读取标记 / 数值阈值，按条件判定走向' },
  {
    id: '轻攻击',
    method: '单段轻击（不消耗气力·不可破防·命中后气力+2）：伤害 = ⌊1.0 × 攻击 × 100÷(100+防御) × 浮动 × 暴击⌋；命中100%',
  },
  {
    id: '轻攻击·变招',
    method: '变招轻击：沿演出 4 次逐次递增结算，单段伤害 = ⌊系数 × 攻击 × 100÷(100+防御) × 浮动 × 暴击⌋，系数 0.25→0.3→0.35→0.4（合计1.3）；命中100%',
  },
  {
    id: '重攻击',
    method: '单段重劈（消耗气力2·可破防）：伤害 = ⌊1.8 × 攻击 × 100÷(100+防御) × 浮动 × 暴击⌋；命中95%·暴击+5%',
  },
  { id: '变招判定', method: '选定轻攻击 / 重攻击后、出手前 50% 概率判定：本次以原招式或其「变招」打出（二选一，非追加）' },
  {
    id: '重攻击·变招',
    method: '变招重击：沿演出 2 次逐次递增结算，单段伤害 = ⌊系数 × 攻击 × 100÷(100+防御) × 浮动 × 暴击⌋，系数 1.0→1.4（合计2.4）；命中100%·暴击+5%',
  },
  { id: '冥想', method: '冥想调息（不造成伤害·3回合冷却）：回复气力+2、回血12%最大生命、解除异常状态' },
  { id: '灭世', method: '全力一击（需气力满5·释放清空气力）：伤害 = ⌊3.0 × 攻击 × 100÷(100+防御) × 浮动 × 暴击⌋；命中100%' },
  { id: '防反判定', method: '小怪攻击前摇内空藏做防反 QTE，按时机三档：完美=受击防反、命中窗口=受击闪避、错过/未输入=受击' },
  { id: '防反·大成功', method: '受击防反：完全免疫来袭；顺势反击敌方（威力1.2×攻击…）；本次气力返还（净0消耗）' },
  { id: '防反·成功', method: '受击闪避：完全免疫来袭；顺势反击敌方（威力0.8×攻击…）；消耗气力1' },
  { id: '防反·失败', method: '受击：承受小怪攻击全额伤害（命中100%·暴击8%）并扣减血量，受击积累气力+1' },
] as const

const CALC_METHOD_BY_ID = new Map<string, string>(
  CALC_TYPE_CATALOG.map((entry) => [entry.id, entry.method]),
)

export function calcTypeMethod(id: string | undefined): string | undefined {
  if (!id) return undefined
  return CALC_METHOD_BY_ID.get(id)
}

export function isCalcTypeId(value: string): value is CalcTypeId {
  return CALC_METHOD_BY_ID.has(value)
}
