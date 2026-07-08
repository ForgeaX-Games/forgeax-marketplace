/**
 * qteHeuristic —— QTE 增强候选挑选的纯启发式逻辑。
 *
 * 为什么独立成纯函数：
 *   - `qteEnhancePass` 要调 LLM，重跑慢且消耗 token；我们希望先用本地启发式
 *     过滤出 "最值得加 QTE 的 1-2 场"，再只对这几场调 LLM 细化
 *   - 启发式本身有多个启发点（动作动词命中、当前已 QTE 跳过、场景长度加权），
 *     在纯函数里比较好测
 *
 * 评分规则（简单加权）：
 *   +3  包含强动作动词（扔/抓/冲/扑/砸/刺/按/跳/劈/撞/扣/拉/推/踢/挥/闪/躲/抢/夺）
 *   +2  场景时长 ≥ 6000ms（长场景适合放节奏点）
 *   +1  包含紧迫感词（快、及时、赶在、眨眼、下一秒、千钧一发、电光火石、一瞬）
 *   -5  已经有 qte（不重复加）
 *   -5  分支多于 2（选择为主的场景不适合 QTE）
 *
 * 默认挑总分 > 0 的前 2 名；原文本上没有动词特征的场景返回空数组。
 */

import type { Scene } from '../scenario/types'

const STRONG_VERBS = [
  '扔', '抓', '冲', '扑', '砸', '刺', '按', '跳', '劈',
  '撞', '扣', '拉', '推', '踢', '挥', '闪', '躲', '抢', '夺',
  '追', '跑', '钻', '爆', '炸', '击', '戳', '捅',
]
const URGENCY_WORDS = ['快', '及时', '赶在', '眨眼', '下一秒', '千钧', '电光', '一瞬', '瞬间']

export interface QteCandidate {
  sceneId: string
  score: number
  /** 命中的动词列表（给 LLM pass 当 hint） */
  matchedVerbs: string[]
}

export function scoreSceneForQte(scene: Scene): QteCandidate {
  const corpus = collectText(scene)
  let score = 0
  const matched: string[] = []
  for (const v of STRONG_VERBS) {
    if (corpus.includes(v)) {
      score += 3
      matched.push(v)
    }
  }
  if (scene.durationMs >= 6000) score += 2
  for (const w of URGENCY_WORDS) {
    if (corpus.includes(w)) {
      score += 1
      break // 紧迫感只加 1，不叠加
    }
  }
  if (scene.qte && scene.qte.cues.length > 0) score -= 5
  if (scene.branches.length > 2) score -= 5
  return { sceneId: scene.id, score, matchedVerbs: matched }
}

/**
 * 选出最多 `limit` 个候选场景，按得分降序；不含得分 ≤ 0 的场景。
 */
export function pickQteCandidates(
  scenes: Scene[],
  limit = 2,
): QteCandidate[] {
  const scored = scenes.map(scoreSceneForQte)
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

function collectText(scene: Scene): string {
  const parts: string[] = [scene.title]
  parts.push(scene.media.prompt ?? '')
  parts.push(scene.prompts?.scene ?? '')
  for (const d of scene.dialogue) parts.push(d.text ?? '')
  return parts.join(' ')
}
