/**
 * runActBatchUpgradeOnScenario —— 把已经成型的 Scenario 走一遍 batch trio，
 * 把 prompts.video / shots[] / prompts.scene 一次性补齐 / 升级。
 *
 * 这一层是 Phase 4 的"接线层"：
 *   - 不改变 scenario 的剧情结构（scenes / branches / characters / acts 全部保留）
 *   - 只升级"可机器再生"的 prompts / shots 字段
 *   - 失败的 scene 原值保留，调用方可继续用老路径补救
 *
 * 设计取舍：
 *
 *   A. 为什么不依赖 outline 里 actId → sceneId 的对应？
 *      forgeScenarioFromScript 内部自己生成 sceneId，与 outline.act.id
 *      没有可靠的 1:1 映射。强行映射会让"换了一行台词就重排"，得不偿失。
 *      于是本模块把整 scenario 视为一个 super-act，让 planBatches 按 6 scene/批切。
 *      跨原 act 的语义一致性，由 batch-prompt-trio.skill 的 system prompt 自己照看。
 *
 *   B. 为什么按 BFS 顺序而不是 Object.keys 顺序？
 *      Object.keys 顺序是写入顺序，对作者拖拽分支后的 scenario 不稳定；
 *      BFS 顺序对应"播放体验"，作者在 Player 里看到的前 Act 也确实是这一批。
 *
 *   C. 为什么失败 scene 保留原值而不抛错？
 *      老路径（forgeImagePrompt / forgeStoryboard / forgeVideoPrompt 逐 scene）
 *      仍然完全可用，调用方可以拿 failures[] 的 sceneIds 走逐 scene fallback。
 *      抛错会让"前 80% scene 升级成功"被一并丢掉，失去了 batch 的价值。
 */

import type { Scenario, Scene } from '../scenario/types'
import type { TextClient } from './types'
import {
  runActBatchPipeline,
  type ActBatchPipelineArgs,
  type ActBatchSpec,
} from './actBatchPipeline'
import type { ActScenePromptTrio } from './forgePromptTrioForAct'
import { buildLockedAnchorsPrompt } from './actLoopbackContext'

export interface RunActBatchUpgradeArgs {
  /** 单批最多 scene 数（默认走 actBatchPipeline 内部默认） */
  maxScenesPerBatch?: number
  /** 单批输出 token 估算上限 */
  maxBatchOutputTokens?: number
  /** 并发批次数 */
  concurrency?: number
  /**
   * Phase 5 · 一致性回流策略。
   *
   *   - 'auto'（默认）：根据 scene 数量决定 —— ≤ 18 用 'sequential'，> 18 用 'none'
   *   - 'none'：强制并发（速度优先，不做 preceding context 回流）
   *   - 'sequential'：强制顺序（一致性优先，跨 Act 摘要滚雪球喂下一批）
   *
   *   不论选哪种，作者已确认锚点（characters/locations/props/uiStyle）总是注入。
   */
  loopback?: 'auto' | 'none' | 'sequential'
  /** 进度回调（同 actBatchPipeline 透传） */
  onBatchStart?: (batch: ActBatchSpec) => void
  onBatchDone?: (batch: ActBatchSpec, ok: ActScenePromptTrio[]) => void
  onBatchFail?: (batch: ActBatchSpec, error: Error) => void
  signal?: AbortSignal
}

export interface RunActBatchUpgradeResult {
  /** 升级后的 scenario 副本（失败 scene 原值保留） */
  scenario: Scenario
  /** 成功升级的 sceneId 集合 */
  upgradedSceneIds: string[]
  /** 失败批次的 sceneIds（调用方应针对这些 scene 走老路径 fallback） */
  failedSceneIds: string[]
  /** 累加 warnings */
  warnings: string[]
  /** 总耗时 ms */
  totalMs: number
}

export async function runActBatchUpgradeOnScenario(
  llm: TextClient,
  scenario: Scenario,
  opts: RunActBatchUpgradeArgs = {},
): Promise<RunActBatchUpgradeResult> {
  const orderedSceneIds = orderScenesForUpgrade(scenario)
  if (orderedSceneIds.length === 0) {
    return {
      scenario,
      upgradedSceneIds: [],
      failedSceneIds: [],
      warnings: ['scenario 没有可升级的 scene（rootSceneId 缺失或所有 scene 不可达）'],
      totalMs: 0,
    }
  }

  const args: ActBatchPipelineArgs = {
    scenesById: scenario.scenes,
    charactersById: scenario.characters ?? {},
    locationsById: scenario.locations,
    acts: [
      {
        actId: `${scenario.id}_super`,
        actTitle: scenario.title || 'scenario',
        actBeat: scenario.synopsis,
        sceneIds: orderedSceneIds,
      },
    ],
    visualStyle: scenario.visualStyle,
    uiStylePrompt: scenario.uiStyle?.prompt,
    directorStyle: scenario.directorStyle,
    directorCustomPersona: scenario.directorCustomPersona,
    maxScenesPerBatch: opts.maxScenesPerBatch,
    maxBatchOutputTokens: opts.maxBatchOutputTokens,
    concurrency: opts.concurrency,
    onBatchStart: opts.onBatchStart,
    onBatchDone: opts.onBatchDone,
    onBatchFail: opts.onBatchFail,
    signal: opts.signal,
    // Phase 5 · 一致性回流：作者已确认锚点 + 顺序滚雪球策略
    lockedAnchorsPrompt: buildLockedAnchorsPrompt(scenario),
    precedingContextStrategy: resolveLoopbackStrategy(opts.loopback, orderedSceneIds.length),
  }

  const result = await runActBatchPipeline(llm, args)

  const nextScenes: Record<string, Scene> = { ...scenario.scenes }
  const upgraded: string[] = []
  for (const [sceneId, trio] of Object.entries(result.byScene)) {
    const original = nextScenes[sceneId]
    if (!original) continue
    nextScenes[sceneId] = mergeTrioIntoScene(original, trio)
    upgraded.push(sceneId)
  }

  const failedSceneIds = result.failures.flatMap((f) => f.batch.sceneIds)

  const nextScenario: Scenario = {
    ...scenario,
    scenes: nextScenes,
  }

  return {
    scenario: nextScenario,
    upgradedSceneIds: upgraded,
    failedSceneIds,
    warnings: result.warnings,
    totalMs: result.totalMs,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers · 可单测
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 决定 Phase 5 的 loopback 策略：
 *   - 'sequential' / 'none' 显式覆盖
 *   - 'auto'（默认）：scene 数 ≤ 18 用 sequential（一致性优先），> 18 用 none（速度优先）
 */
export function resolveLoopbackStrategy(
  mode: 'auto' | 'none' | 'sequential' | undefined,
  sceneCount: number,
): 'none' | 'sequential' {
  if (mode === 'sequential') return 'sequential'
  if (mode === 'none') return 'none'
  return sceneCount <= 18 ? 'sequential' : 'none'
}

/**
 * 把 scenario.scenes 按 BFS（rootSceneId 起）排序；不可达的 scene 追加在尾部。
 * 不可达 scene 也会被升级（作者将来可能改分支让它"接回主线"），但优先级低。
 */
export function orderScenesForUpgrade(scenario: Scenario): string[] {
  const allIds = Object.keys(scenario.scenes)
  const root = scenario.rootSceneId
  if (!root || !scenario.scenes[root]) {
    return allIds
  }

  const visited = new Set<string>()
  const ordered: string[] = []
  const queue: string[] = [root]
  while (queue.length > 0) {
    const id = queue.shift()!
    if (visited.has(id)) continue
    const scene = scenario.scenes[id]
    if (!scene) continue
    visited.add(id)
    ordered.push(id)
    for (const b of scene.branches ?? []) {
      const tgt = b.targetSceneId
      if (tgt && !visited.has(tgt) && scenario.scenes[tgt]) {
        queue.push(tgt)
      }
    }
  }
  // 不可达 scene 追尾，保证作者后续修分支也能享受 batch 升级过的字段
  for (const id of allIds) {
    if (!visited.has(id)) ordered.push(id)
  }
  return ordered
}

/**
 * 把单 scene 的 trio 结果合并回 Scene。
 *
 * 写入策略：
 *   - prompts.scene：trio.image 优先；空时保留原值
 *   - prompts.video：trio.video 优先；空时保留原值
 *   - shots：trio.shots 非空时**整体替换**；空时保留原值
 *     （batch trio 是"重新出齐分镜"的产物，部分替换会让相邻 shot 的 transitionHint 错位）
 *   - media.prompt：与 prompts.scene 同步（保持单一主提示词来源）
 *
 * 不动的字段：dialogue / branches / qte / characterIds / locationId / pos 等
 * 由作者手工编辑或上游剧本生成的字段。
 */
export function mergeTrioIntoScene(scene: Scene, trio: ActScenePromptTrio): Scene {
  const nextImage = trio.image?.trim() || scene.prompts?.scene || scene.media?.prompt || ''
  const nextVideo = trio.video?.trim() || scene.prompts?.video

  const nextPrompts = {
    ...(scene.prompts ?? { scene: nextImage }),
    scene: nextImage,
    video: nextVideo,
  }

  const nextShots = trio.shots.length > 0 ? trio.shots : scene.shots

  return {
    ...scene,
    prompts: nextPrompts,
    shots: nextShots,
    media: {
      ...scene.media,
      prompt: nextImage,
    },
  }
}
