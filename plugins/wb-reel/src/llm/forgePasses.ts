/**
 * Forge 三步向导的 LLM 流水线入口 —— 三 pass：
 *
 *   pass 1: schemaForgePass
 *     输入：idea（一句话）或 script（整段剧本）
 *     输出：完整 Scenario（scenes/characters/locations/dialogue/branches）
 *     复用：forgeScenarioFromIdea / forgeScenarioFromScript（不改它们）
 *
 *   pass 2: qteEnhancePass（仅 script 模式调用）
 *     输入：pass 1 的 Scenario
 *     输出：在启发式选出的 1-2 场上追加 QTE 配置
 *     逻辑：本地启发式 pickQteCandidates → 对命中场景**本地**生成默认 QTECue
 *       （不再回调 LLM —— 减 token 消耗 + 稳定性；LLM 的语义理解在 pass 1 已完成）
 *
 *   pass 3: characterRefPass
 *     输入：pass 1 的 Scenario + ImageClient
 *     输出：为每个 Character 生成三视图参考图，为每个 Location 生成空场基准图
 *     调用方负责把结果写入 scenarioStore（通过回调注入，保持此模块纯净）
 *
 * pass 1/2 是**纯粹组合**，不碰 scenarioStore / mediaStore。
 * pass 3 是生图副作用，通过回调解耦，调用方控制写入时机。
 */

import type { Scenario, Scene, QTECue, QTESpec } from '../scenario/types'
import type { TextClient, ImageClient, ImageResult } from './types'
import {
  forgeScenarioFromIdea,
  forgeScenarioFromScript,
  type ForgeScenarioResult,
  type ForgeScriptArgs,
  type ForgeScenarioArgs,
} from './promptForge'
import { pickQteCandidates } from './qteHeuristic'
import {
  buildCharacterTurnaroundPrompt,
  buildLocationAnglePrompts,
  buildPropRefPrompt,
} from './forgeImagePipeline'
import { composeVisualPrompt } from './visualStylePresets'
import { runWithConcurrency } from './batchImageGen'
import { IMAGE_BATCH_CONCURRENCY } from './concurrency'

export type SchemaPassMode = 'idea' | 'script'

export interface SchemaPassArgs {
  mode: SchemaPassMode
  idea?: string
  script?: string
  hint?: ForgeScriptArgs['hint']
  sceneCount?: number
  characterCount?: number
}

/**
 * pass 1：根据模式分派到对应 LLM 调用，返回完整 Scenario（v2 schema）。
 *
 * 注意：底层 forgeScenarioFromIdea / forgeScenarioFromScript 当前产出
 * schemaVersion=1 的 Scenario。这里统一走 loadScenario 时的 migrate，
 * 但调用方也可以直接拿到返回的 scenario 并手动 migrate；我们保证这里
 * 返回的 scenario 的 schemaVersion 在 TS 类型上是 1 | 2（forge 函数内部还是 1）。
 */
export async function schemaForgePass(
  llm: TextClient,
  args: SchemaPassArgs,
): Promise<ForgeScenarioResult> {
  if (args.mode === 'idea') {
    if (!args.idea || !args.idea.trim()) {
      throw new Error('[schemaForgePass] idea 模式需要非空 idea')
    }
    const ideaArgs: ForgeScenarioArgs = {
      idea: args.idea,
      sceneCount: args.sceneCount,
      characterCount: args.characterCount,
    }
    return forgeScenarioFromIdea(llm, ideaArgs)
  }
  if (!args.script || !args.script.trim()) {
    throw new Error('[schemaForgePass] script 模式需要非空 script')
  }
  const scriptArgs: ForgeScriptArgs = {
    script: args.script,
    hint: args.hint,
  }
  return forgeScenarioFromScript(llm, scriptArgs)
}

/**
 * pass 2：对 script 模式产物做 QTE 增强。
 *
 * 只**追加**或替换极少数场景的 qte 字段，其他场景保持 pass 1 结果。
 * 副作用：修改一份新的 scenario 副本，原对象不动（纯函数）。
 *
 * 选项 limit 控制最多增强几场（默认 2）。
 */
export function qteEnhancePass(
  scenario: Scenario,
  limit = 2,
): Scenario {
  const scenes = Object.values(scenario.scenes)
  const candidates = pickQteCandidates(scenes, limit)
  if (candidates.length === 0) return scenario

  const nextScenes: Record<string, Scene> = { ...scenario.scenes }
  for (const c of candidates) {
    const scene = nextScenes[c.sceneId]
    if (!scene) continue
    if (scene.qte && scene.qte.cues.length > 0) continue // 已有 qte 保留
    nextScenes[c.sceneId] = {
      ...scene,
      qte: defaultQteForScene(scene),
    }
  }
  return { ...scenario, scenes: nextScenes }
}

/**
 * 为一个场景生成默认 QTE 配置：
 *   - 1 个 tap cue（居中偏下），targetAt = 场景总时长的 60%
 *   - hitWindow = 80 / 180 / 300ms（标准音游档位）
 *   - score = 100 / 60 / 30 / -10
 *
 * 后续作者可以在 StoryTree 节点膨胀态 · QTE sub-tab 里调整 / 追加。
 */
function defaultQteForScene(scene: Scene): QTESpec {
  const target = Math.max(1000, Math.round(scene.durationMs * 0.6))
  const appear = Math.max(0, target - 800)
  const cue: QTECue = {
    id: `cue-${scene.id}-auto`,
    shape: 'tap',
    x: 0.5,
    y: 0.65,
    appearAt: appear,
    targetAt: target,
  }
  return {
    cues: [cue],
    window: { perfect: 80, great: 180, good: 300 },
    score: { perfect: 100, great: 60, good: 30, miss: -10 },
  }
}

// ============================================================================
// Pass 3: characterRefPass —— 角色三视图 + 场所基准图生成
// ============================================================================

export interface CharacterRefPassProgress {
  kind: 'character' | 'location' | 'prop'
  id: string
  name: string
  done: number
  total: number
}

export interface CharacterRefPassOpts {
  scenario: Scenario
  client: ImageClient
  /**
   * 角色三视图定妆照生成完成回调 —— 调用方写 character.turnaroundRefImageId。
   * 当前角色锚点的唯一回调（每角色 1 张三视图，单张单行）。
   */
  onCharacterRef?: (characterId: string, result: ImageResult) => void
  /** @deprecated 双图锚点已回退为单张三视图，本回调不再触发。 */
  onCharacterHeadshot?: (characterId: string, result: ImageResult) => void
  /** @deprecated 双图锚点已回退为单张三视图，本回调不再触发。 */
  onCharacterFullbody?: (characterId: string, result: ImageResult) => void
  /** 场所基准图生成完成回调（第一个角度图同时触发此回调，兼容旧逻辑） */
  onLocationRef?: (locationId: string, result: ImageResult) => void
  /** v3.6 · 每个场所角度图生成完成时触发 */
  onLocationAngleRef?: (
    locationId: string,
    angle: import('../scenario/types').LocationAngleRef,
    result: ImageResult,
  ) => void
  /** v3.7 · 关键道具参考图生成完成回调 */
  onPropRef?: (propId: string, result: ImageResult) => void
  onProgress?: (ev: CharacterRefPassProgress) => void
  /** 并发度，默认 IMAGE_BATCH_CONCURRENCY（统一定义在 llm/concurrency.ts） */
  concurrency?: number
}

/**
 * pass 3：在剧本锻造完成后，批量生成所有角色三视图 + 场所基准图。
 *
 * 这是"一致性地基"pass：先把角色 / 场所基准图落地，后续分镜关键帧才能
 * 通过 referenceImageDataUrl 注入这些 ref，做到跨镜视觉一致。
 *
 * 设计约束：
 *   · 纯函数形状（不直接写 store）—— 调用方通过 onCharacterRef / onLocationRef 写回
 *   · 失败不阻断 —— 单张失败只记录，不影响其他任务（runWithConcurrency 保证）
 *   · 幂等 —— 调用方可检查 character.turnaroundRefImageId 是否已存在再决定是否跳过
 */
export async function characterRefPass(opts: CharacterRefPassOpts): Promise<void> {
  const { scenario, client, concurrency = IMAGE_BATCH_CONCURRENCY } = opts
  const visualStyle = scenario.visualStyle

  const characters = Object.values(scenario.characters ?? {})
  const locations = Object.values(scenario.locations ?? {})
  const props = Object.values(scenario.props ?? {})

  // 每个 location 展开为 3 个角度任务
  const ANGLE_COUNT = 3
  type AngleTask = {
    location: (typeof locations)[number]
    id: string
    label: string
    anglePrompt: string
    fullPrompt: string
  }
  const angleTasks: AngleTask[] = locations.flatMap((l) =>
    buildLocationAnglePrompts(l, ANGLE_COUNT).map((a) => ({ location: l, ...a })),
  )

  // 每个角色 1 张三视图定妆照（单张单行）
  const total = characters.length * 1 + angleTasks.length + props.length
  if (total === 0) return

  let done = 0

  await runWithConcurrency(
    characters,
    async (c) => {
      const turnaround = await client.generate({
        prompt: composeVisualPrompt(
          buildCharacterTurnaroundPrompt(c, { visualStyle }),
          visualStyle,
        ),
        size: '1536x1024',
      })
      opts.onCharacterRef?.(c.id, turnaround)
      done++
      opts.onProgress?.({ kind: 'character', id: c.id, name: c.name, done, total })
    },
    { concurrency },
  )

  await runWithConcurrency(
    angleTasks,
    async (task) => {
      const out = await client.generate({
        prompt: composeVisualPrompt(task.fullPrompt, visualStyle),
        size: '1536x1024',
      })
      // 兼容旧回调：第一个角度图同时触发 onLocationRef
      if (task.id.endsWith('-angle1')) opts.onLocationRef?.(task.location.id, out)
      opts.onLocationAngleRef?.(task.location.id, {
        id: task.id,
        label: task.label,
        anglePrompt: task.anglePrompt,
      }, out)
      done++
      opts.onProgress?.({
        kind: 'location',
        id: task.location.id,
        name: `${task.location.name} · ${task.label}`,
        done,
        total,
      })
    },
    { concurrency },
  )

  await runWithConcurrency(
    props,
    async (p) => {
      const out = await client.generate({
        prompt: composeVisualPrompt(buildPropRefPrompt(p), visualStyle),
        size: '1024x1024',
      })
      opts.onPropRef?.(p.id, out)
      done++
      opts.onProgress?.({ kind: 'prop', id: p.id, name: p.name, done, total })
    },
    { concurrency },
  )
}
