import type { Scenario, Scene, Branch } from './types'

/**
 * 剧情树"断链修复"纯函数。
 *
 * 背景：早期版本 clearSceneTimeline 误把 scene.branches 一并清掉了 —— 而
 * branches[] 同时承担"剧情树出边"语义，导致清空后节点断连、Player 走到
 * 这一幕就停在黑屏。
 *
 * 当前代码已修复不再误删，但已经落盘到 localStorage 的旧数据仍然是断的。
 * 这组工具给作者一个"一键查漏补缺"能力：
 *   1) detectOrphans() 找出 branches 为空、但按画布 x 顺序看并不应是终点的 scene
 *   2) suggestReconnectPlan() 给每个断头推荐一个下一场（按画布 x / y 扫描）
 *   3) applyReconnectPlan() 接收作者确认的 plan，批量补 auto 边
 *
 * 设计要点：
 *   - 纯函数，输入输出不变；副作用交给 store action 调
 *   - 叶子场景（rootSceneId 外、没有任何其他 scene 指向它们 **也** 没有出边）
 *     其实有两种：设计上的结局 vs 被误清的断头。我们无法 100% 区分，所以把
 *     **所有**出边为空的场景都列出来，让作者决定哪些是结局、哪些要补
 *   - idMaker 可注入，方便单测断言稳定 id
 */

export interface OrphanInfo {
  sceneId: string
  title: string
  /** 画布 x（若作者拖过），用于排序/推荐 */
  x: number
  /** 画布 y（若作者拖过），用于同列候选过滤 */
  y: number
  /** 按几何推荐的下一场 sceneId；null 表示找不到合理候选 */
  suggestedTargetId: string | null
}

export interface ReconnectEntry {
  sceneId: string
  /** 作者确认后的目标；null = 明确标记为结局不连 */
  targetSceneId: string | null
  /**
   * v3.5 · 作者明确标这个 scene 为"结局"。仅当 targetSceneId === null 时生效。
   * apply 后 scene.isEnding = true，下次 detectOrphans 不再把它列为 orphan。
   */
  markEnding?: boolean
}

export interface ReconnectPlan {
  entries: ReconnectEntry[]
}

/**
 * 找出所有"出边断链"的场景并给出推荐目标。
 *
 * 断链定义（v3.5）：以下任一视为断链：
 *   1. `branches[]` 为空（`length === 0`）—— 原始定义
 *   2. **野指针**：`branches[]` 不空，但每一条 `targetSceneId` 都指向已删 scene。
 *      常见于旧快照 / 作者删场景没同步清引用。画布上会"安静地"不画这条边，
 *      肉眼像接好了，Player 播到这里就卡住。
 *
 * 推荐算法：按画布 x 升序扫所有 scene，断头场景的推荐目标 = 第一个 x 严格
 * 大于本场且 y 差 < Y_TOLERANCE 的 scene。没有则再松限制用全局下一个。
 * 都没有（比如断头本身就是最右） → null。
 */
export function detectOrphans(scenario: Scenario): OrphanInfo[] {
  const scenes = Object.values(scenario.scenes)
  const ordered = [...scenes].sort(byPos)
  const orphans: OrphanInfo[] = []
  for (const s of ordered) {
    // v3.5：作者显式标为结局的场景跳过（不再骚扰作者去"修复"）
    if (s.isEnding) continue
    if (!isDangling(s, scenario)) continue
    orphans.push({
      sceneId: s.id,
      title: s.title,
      x: s.pos?.x ?? 0,
      y: s.pos?.y ?? 0,
      suggestedTargetId: suggestNextFor(s, ordered),
    })
  }
  return orphans
}

/**
 * 判定一个 scene 是否"出边断链"——空 branches 或者全是野指针。
 * 注意：只要有一条 branch 的 target 指向仍然存在的 scene，就算"有活路"不算断。
 */
function isDangling(scene: Scene, scenario: Scenario): boolean {
  const branches = scene.branches ?? []
  if (branches.length === 0) return true
  const hasAliveBranch = branches.some(
    (b) => b.targetSceneId && !!scenario.scenes[b.targetSceneId],
  )
  return !hasAliveBranch
}

const Y_TOLERANCE = 120

function byPos(a: Scene, b: Scene): number {
  const ax = a.pos?.x ?? 0
  const bx = b.pos?.x ?? 0
  if (ax !== bx) return ax - bx
  const ay = a.pos?.y ?? 0
  const by = b.pos?.y ?? 0
  return ay - by
}

function suggestNextFor(orphan: Scene, ordered: Scene[]): string | null {
  const ox = orphan.pos?.x ?? 0
  const oy = orphan.pos?.y ?? 0
  // 1) 同行（|Δy| < Y_TOLERANCE）且 x > ox 的第一个
  const sameRow = ordered.find(
    (s) =>
      s.id !== orphan.id &&
      (s.pos?.x ?? 0) > ox &&
      Math.abs((s.pos?.y ?? 0) - oy) < Y_TOLERANCE,
  )
  if (sameRow) return sameRow.id
  // 2) 放宽：任意 x > ox 的第一个
  const anyNext = ordered.find(
    (s) => s.id !== orphan.id && (s.pos?.x ?? 0) > ox,
  )
  if (anyNext) return anyNext.id
  return null
}

/**
 * 从 detect 结果直接生成默认 plan（全部采纳推荐），UI 可在此基础上让
 * 作者逐条修改 targetSceneId 或置 null。
 */
export function defaultPlan(orphans: OrphanInfo[]): ReconnectPlan {
  return {
    entries: orphans.map((o) => ({
      sceneId: o.sceneId,
      targetSceneId: o.suggestedTargetId,
    })),
  }
}

export interface ApplyOpts {
  /** 注入 id 生成器便于测试；默认 `auto-fix-${sceneId}-${Date.now()}` */
  idMaker?: (sceneId: string) => string
}

/**
 * 按 plan 给每个 entry 的源场景补一条 auto 边。
 *
 * 规则（v3.5）：
 *   - 跳过 `targetSceneId === null`（作者标为结局）
 *   - 跳过源场景 / 目标场景不存在
 *   - **源场景已有至少一条指向存在 scene 的 branch** → 跳过（有活路，不覆盖作者分支）
 *   - 源场景**空 branches** 或 **全是野指针** → 写入新 auto 边（野指针情况下
 *     相当于整个 branches[] 被替换，这正是我们想要的"修复断链"语义）
 *   - 返回新的 scenario；没有任何修改时返回 `scenario` 原引用（避免订阅抖动）
 */
export function applyReconnectPlan(
  scenario: Scenario,
  plan: ReconnectPlan,
  opts: ApplyOpts = {},
): Scenario {
  const idMaker = opts.idMaker ?? ((sid) => `auto-fix-${sid}-${Date.now()}`)
  const nextScenes: Record<string, Scene> = { ...scenario.scenes }
  let touched = false
  for (const entry of plan.entries) {
    const src = nextScenes[entry.sceneId]
    if (!src) continue

    // 分支 A：作者选"结局·不连" + markEnding —— 写 isEnding=true
    // 仅 targetSceneId===null 时处理；targetSceneId!==null 时下面的补边分支兜底
    if (entry.targetSceneId === null) {
      if (entry.markEnding && !src.isEnding) {
        nextScenes[entry.sceneId] = { ...src, isEnding: true }
        touched = true
      }
      continue
    }

    // 分支 B：补 auto 边
    if (!nextScenes[entry.targetSceneId]) continue
    // 有至少一条 live branch → 作者已经接好了，别覆盖
    if (!isDangling(src, { ...scenario, scenes: nextScenes })) continue
    const newBranch: Branch = {
      id: idMaker(entry.sceneId),
      kind: 'auto',
      targetSceneId: entry.targetSceneId,
      label: '',
    }
    // 注意：野指针场景的 branches[] 会被**替换**成 [newBranch]。这是想要的 ——
    // 脏引用清走、新 auto 边写入。
    nextScenes[entry.sceneId] = {
      ...src,
      branches: [newBranch],
    }
    touched = true
  }
  if (!touched) return scenario
  return {
    ...scenario,
    scenes: nextScenes,
  }
}
