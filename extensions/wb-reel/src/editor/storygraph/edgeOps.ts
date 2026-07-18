/**
 * StoryGraph 边操作 —— 纯函数层。
 *
 * react-flow 把"边"叫 Edge，作者剧本里把同等概念叫 Branch。两边映射规则：
 *
 *   Edge.id          := formatEdgeId(sceneId, branch.id)
 *   Edge.source      := sceneId（branch 所在 scene）
 *   Edge.target      := branch.targetSceneId
 *   Edge.label       := branch.label
 *
 * 这层把"事件 → store action"之间的所有判定（去重、自环、空 id）抽出来，方便单测，
 * 也方便 B7 工具栏 / B8 ContextMenu 复用。
 */

import type { Branch, BranchKind, Scenario } from '../../scenario/types'

const SEP = '__'

/** 用 sceneId + branchId 拼出唯一 react-flow Edge id */
export function formatEdgeId(sceneId: string, branchId: string): string {
  return `${sceneId}${SEP}${branchId}`
}

/**
 * 反解 Edge id。允许 sceneId 含有 `__`（罕见，但 LLM 偶尔生成出来），
 * 取最后一个分隔符当 branch 边界。malformed → null。
 */
export function parseEdgeId(
  id: string,
): { sceneId: string; branchId: string } | null {
  if (!id || typeof id !== 'string') return null
  const idx = id.lastIndexOf(SEP)
  if (idx <= 0 || idx === id.length - SEP.length) return null
  const sceneId = id.slice(0, idx)
  const branchId = id.slice(idx + SEP.length)
  if (!sceneId || !branchId) return null
  return { sceneId, branchId }
}

/** 由 Edge id 在 scenario 里找到对应 branch；未找到返回 null（不抛错） */
export function resolveBranchFromEdge(
  scenario: Scenario,
  edgeId: string,
): { sceneId: string; branch: Branch } | null {
  const parsed = parseEdgeId(edgeId)
  if (!parsed) return null
  const scene = scenario.scenes[parsed.sceneId]
  if (!scene) return null
  const branch = scene.branches.find((b) => b.id === parsed.branchId)
  if (!branch) return null
  return { sceneId: parsed.sceneId, branch }
}

/**
 * 拖出新连边时的语义判定 —— 返回新 Branch（store 直接 addBranch），或 null 拒绝。
 *
 * 拒绝条件：
 *   - source/target 任一为空
 *   - source === target（自环；StoryGraph 视觉无意义）
 *   - source / target 不在 scenario 里
 *   - 已存在 source → target 的 branch（去重；要改 kind/label 用菜单）
 */
export function buildBranchFromConnect(
  scenario: Scenario,
  source: string | null | undefined,
  target: string | null | undefined,
  defaults?: { kind?: BranchKind; label?: string },
): Branch | null {
  if (!source || !target) return null
  if (source === target) return null
  const src = scenario.scenes[source]
  if (!src) return null
  if (!scenario.scenes[target]) return null
  if (src.branches.some((b) => b.targetSceneId === target)) return null

  return {
    id: makeBranchId(),
    kind: defaults?.kind ?? 'auto',
    label: defaults?.label,
    targetSceneId: target,
  }
}

/** 短随机 id —— 与 scenarioStore 保持同样的 base36 风格，避免 import nanoid 进图层 */
function makeBranchId(): string {
  const t = Date.now().toString(36).slice(-4)
  const r = Math.random().toString(36).slice(2, 8)
  return `br-${t}${r}`
}
