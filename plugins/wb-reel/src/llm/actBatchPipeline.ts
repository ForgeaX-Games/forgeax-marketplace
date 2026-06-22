/**
 * actBatchPipeline —— 把"整个 scenario 的 Act × scenes"切成多批 batch，
 * 并发调 forgePromptTrioForAct 一次性产出三件套（image / shots / video）。
 *
 * 定位：
 *   单 Act 一次 LLM call 的瓶颈是**输出 token 数**。
 *   8 个 scene × (image 300 字 + shots 8×300 字 + video 900 字) ≈ 28k 字 ≈ 42k token，
 *   恰好在 Claude Opus / GPT-4o / DeepSeek 的可控输出区间。再多 LLM 容易截断。
 *
 *   于是本模块按以下规则切批：
 *     1. 一个 batch 只放**同一个 Act 的 scenes**（跨 Act 一致性约束意义不大）
 *     2. 单批最多 8 个 scene
 *     3. 单批估算输出 token ≤ MAX_BATCH_OUTPUT_TOKENS（默认 50k）
 *     4. 估算输出 token = sum(scene.sceneDurationSec → 估算镜数 → 估算字数)
 *
 *   batch 之间用 LLM_TEXT_BATCH_CONCURRENCY 控并发。
 *   失败的 batch 不抛错，只记 failure；调用方应针对 failure 退回到老路径（逐 scene 调
 *   forgeImagePrompt / forgeStoryboard / forgeVideoPrompt）。
 *
 * 与上下游：
 *   - 上游：IdeaForge 在 P3/P4/idea 路径产出 Scenario 后，**可选**调本模块"补全 prompts/shots"
 *     （注意：现有 forgeScenarioFrom* 已经填了基础 prompts.scene，本模块的角色是
 *     "升级"——把 prompts.video / shots[] 也批量补齐）。
 *   - 下游：调用方拿到 BatchPipelineResult.byScene 后写回 store；生图/生视频走老链路。
 */

import type {
  Scene,
  Character,
  VisualStyle,
  DirectorStyleId,
  Location,
} from '../scenario/types'
import type { TextClient } from './types'
import { runWithConcurrency } from './batchImageGen'
import { LLM_TEXT_BATCH_CONCURRENCY } from './concurrency'
import {
  forgePromptTrioForAct,
  type ActSceneInput,
  type ActScenePromptTrio,
} from './forgePromptTrioForAct'
import {
  summarizeForPrecedingContext,
  buildPrecedingContextPrompt,
  type PrecedingSceneSummary,
} from './actLoopbackContext'

// ─────────────────────────────────────────────────────────────────────────────
// 公开接口
// ─────────────────────────────────────────────────────────────────────────────

/** 一个 Act 的最小描述（来自 outline / scenario.acts 之类的上游结构）。 */
export interface ActDesc {
  actId: string
  actTitle: string
  actBeat?: string
  /** 该 Act 下 scene 的 id 列表（顺序即播放顺序） */
  sceneIds: string[]
}

export interface ActBatchPipelineArgs {
  /** 全局 scenes lookup —— scene.id → Scene */
  scenesById: Record<string, Scene>
  /** 全局 characters lookup —— character.id → Character */
  charactersById: Record<string, Character>
  /** 全局 locations lookup —— location.id → Location */
  locationsById?: Record<string, Location>
  /** 整 scenario 的 acts 列表 */
  acts: ActDesc[]
  /** 全局视觉风格 */
  visualStyle?: VisualStyle
  uiStylePrompt?: string
  directorStyle?: DirectorStyleId
  directorCustomPersona?: string
  /** 单批最多 scene 数（默认 6，硬上限 8） */
  maxScenesPerBatch?: number
  /** 单批输出 token 估算上限（默认 50000） */
  maxBatchOutputTokens?: number
  /** 并发批次数（默认 LLM_TEXT_BATCH_CONCURRENCY=3） */
  concurrency?: number
  /**
   * Phase 5 · 一致性回流：作者已确认锚点（LOCKED_ANCHORS）。
   *
   * 调用方一般用 actLoopbackContext.buildLockedAnchorsPrompt(scenario) 生成。
   * 透传给每批 forgePromptTrioForAct，让 LLM 把这些当硬约束遵守。
   */
  lockedAnchorsPrompt?: string
  /**
   * Phase 5 · 一致性回流策略。
   *
   *   - 'none'（默认）：所有批次并发，互不感知；速度优先
   *   - 'sequential'：批次串行，每批跑完取 trio 摘要喂下一批的 PRECEDING_ACT_CONTEXT
   *     · 跨 Act 的视觉/光影/角色一致性最好
   *     · 整体耗时 ≈ N × 单批时间，对长 scenario 可能拖到 1-2 分钟
   *
   *   建议：scenario 规模 ≤ 18 scene 用 'sequential'；> 18 scene 用 'none'
   *   （一致性靠 lockedAnchorsPrompt 兜底已够）。
   */
  precedingContextStrategy?: 'none' | 'sequential'
  /** 进度 / 失败回调 */
  onBatchStart?: (batch: ActBatchSpec) => void
  onBatchDone?: (batch: ActBatchSpec, ok: ActScenePromptTrio[]) => void
  onBatchFail?: (batch: ActBatchSpec, error: Error) => void
  signal?: AbortSignal
}

/** 一个 batch 的描述（跑前 plan 出来，跑后映射回 result）。 */
export interface ActBatchSpec {
  /** 该批所属 Act */
  actId: string
  actTitle: string
  /** 该 Act 内的批次序号（0-based）—— 同一 Act 拆成多批时区分用 */
  subBatchIndex: number
  /** 该批包含的 scene id 列表 */
  sceneIds: string[]
  /** 估算的输出 token 数（plan 阶段） */
  estimatedOutputTokens: number
}

export interface ActBatchPipelineResult {
  /** scene.id → 三件套；只包含**成功**的 scene */
  byScene: Record<string, ActScenePromptTrio>
  /** 所有批次（含成功/失败）的 spec —— 用于复盘 */
  batches: ActBatchSpec[]
  /** 失败的批次（调用方应针对这些 scene 走老路径 fallback） */
  failures: { batch: ActBatchSpec; error: Error }[]
  /** Act 级 / scene 级累加 warnings */
  warnings: string[]
  /** 总耗时 ms */
  totalMs: number
}

// ─────────────────────────────────────────────────────────────────────────────
// 入口
// ─────────────────────────────────────────────────────────────────────────────

export async function runActBatchPipeline(
  llm: TextClient,
  args: ActBatchPipelineArgs,
): Promise<ActBatchPipelineResult> {
  const t0 = Date.now()
  const batches = planBatches(args)

  const byScene: Record<string, ActScenePromptTrio> = {}
  const failures: { batch: ActBatchSpec; error: Error }[] = []
  const warnings: string[] = []

  const strategy = args.precedingContextStrategy ?? 'none'

  // —— sequential 模式：串行跑 + preceding context 滚雪球累加 ——
  if (strategy === 'sequential') {
    const summaries: PrecedingSceneSummary[] = []
    for (const batch of batches) {
      if (args.signal?.aborted) break
      args.onBatchStart?.(batch)
      try {
        const precedingContextPrompt =
          summaries.length > 0 ? buildPrecedingContextPrompt(summaries) : undefined
        const trio = await runOneBatch(llm, batch, args, {
          precedingContextPrompt,
        })
        for (const sc of trio.scenes) {
          byScene[sc.sceneId] = sc
          if (sc.warnings.length > 0) {
            warnings.push(`[${batch.actId}/${sc.sceneId}] ${sc.warnings.join('；')}`)
          }
        }
        if (trio.warnings.length > 0) {
          warnings.push(`[${batch.actId}#${batch.subBatchIndex}] ${trio.warnings.join('；')}`)
        }
        // 滚雪球：把本批成功的 scene 摘要追加到 summaries，喂给下一批
        const newSummaries = summarizeForPrecedingContext(args.scenesById, trio.scenes)
        summaries.push(...newSummaries)
        args.onBatchDone?.(batch, trio.scenes)
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e))
        failures.push({ batch, error: err })
        args.onBatchFail?.(batch, err)
        // sequential 模式下单批失败不中止后续批；后续批的 preceding summaries
        // 不会包含本批的 scene，但前 Act 的产物仍能继续传播
      }
    }
    return {
      byScene,
      batches,
      failures,
      warnings,
      totalMs: Date.now() - t0,
    }
  }

  // —— none 模式：批次并发 ——
  const concurrency = Math.max(
    1,
    args.concurrency ?? LLM_TEXT_BATCH_CONCURRENCY,
  )

  const result = await runWithConcurrency<ActBatchSpec, void>(
    batches,
    async (batch) => {
      args.onBatchStart?.(batch)
      try {
        const trio = await runOneBatch(llm, batch, args)
        for (const sc of trio.scenes) {
          byScene[sc.sceneId] = sc
          if (sc.warnings.length > 0) {
            warnings.push(`[${batch.actId}/${sc.sceneId}] ${sc.warnings.join('；')}`)
          }
        }
        if (trio.warnings.length > 0) {
          warnings.push(`[${batch.actId}#${batch.subBatchIndex}] ${trio.warnings.join('；')}`)
        }
        args.onBatchDone?.(batch, trio.scenes)
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e))
        failures.push({ batch, error: err })
        args.onBatchFail?.(batch, err)
        throw err
      }
    },
    {
      concurrency,
      signal: args.signal,
    },
  )

  return {
    byScene,
    batches,
    failures,
    warnings,
    totalMs: result.totalMs,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers · 可单测
// ─────────────────────────────────────────────────────────────────────────────

/** 单批默认 scene 数上限。8 是经验值（再多模型容易截断）。 */
export const DEFAULT_MAX_SCENES_PER_BATCH = 6
/** 单批默认输出 token 估算上限。Claude Opus / GPT-4o 单次响应都能稳吃 50k。 */
export const DEFAULT_MAX_BATCH_OUTPUT_TOKENS = 50000
export const HARD_MAX_SCENES_PER_BATCH = 8

/**
 * 估算单个 scene 在 batch 输出中占用的 token 数。
 *
 * 经验公式：image 300 字 + shots N×280 字 + video 900 字
 * N 由 sceneDurationSec 决定（≤10s→1; ≤20s→2; ≤40s→5; ≤60s→7; >60s→9）
 * 字 → token：中文 ≈ 1.5 × 字
 */
export function estimateSceneOutputTokens(sceneDurationSec: number): number {
  const dur = Math.max(10, Math.min(180, Math.round(sceneDurationSec)))
  let shots: number
  if (dur <= 10) shots = 1
  else if (dur <= 20) shots = 2
  else if (dur <= 40) shots = 5
  else if (dur <= 60) shots = 7
  else shots = 9
  const chars = 300 + shots * 280 + 900
  return Math.round(chars * 1.5)
}

/**
 * 根据 acts × sceneIds 切批。规则：
 *   1. 不跨 Act
 *   2. 每批不超过 maxScenesPerBatch（默认 6，硬上限 8）
 *   3. 每批输出 token 估算不超过 maxBatchOutputTokens
 */
export function planBatches(args: ActBatchPipelineArgs): ActBatchSpec[] {
  const maxScenes = Math.min(
    HARD_MAX_SCENES_PER_BATCH,
    Math.max(1, args.maxScenesPerBatch ?? DEFAULT_MAX_SCENES_PER_BATCH),
  )
  const maxTokens = Math.max(
    8000,
    args.maxBatchOutputTokens ?? DEFAULT_MAX_BATCH_OUTPUT_TOKENS,
  )

  const out: ActBatchSpec[] = []

  for (const act of args.acts) {
    if (act.sceneIds.length === 0) continue

    let buf: string[] = []
    let bufTokens = 0
    let subIdx = 0

    const flush = () => {
      if (buf.length === 0) return
      out.push({
        actId: act.actId,
        actTitle: act.actTitle,
        subBatchIndex: subIdx++,
        sceneIds: buf,
        estimatedOutputTokens: bufTokens,
      })
      buf = []
      bufTokens = 0
    }

    for (const sid of act.sceneIds) {
      const scene = args.scenesById[sid]
      const dur = scene
        ? Math.round((scene.durationMs ?? 45_000) / 1000)
        : 45
      const tk = estimateSceneOutputTokens(dur)

      // 加上当前 scene 后是否会爆 → 先 flush
      if (buf.length >= maxScenes || (buf.length > 0 && bufTokens + tk > maxTokens)) {
        flush()
      }
      buf.push(sid)
      bufTokens += tk
    }
    flush()
  }

  return out
}

/** 单批：把 ActBatchSpec 翻译成 forgePromptTrioForAct 的输入并调用一次 LLM。 */
async function runOneBatch(
  llm: TextClient,
  batch: ActBatchSpec,
  args: ActBatchPipelineArgs,
  overrides: { precedingContextPrompt?: string } = {},
): Promise<{
  scenes: ActScenePromptTrio[]
  warnings: string[]
  raw: string
}> {
  const sceneInputs: ActSceneInput[] = batch.sceneIds.map((sid) => {
    const scene = args.scenesById[sid]
    if (!scene) {
      // scene 缺失 —— 用最小占位让 LLM 跑（不至于全批失败）
      return {
        sceneId: sid,
        title: sid,
        beat: '（scene 详情缺失，请基于 actBeat 推断）',
      }
    }
    const place = scene.locationId
      ? args.locationsById?.[scene.locationId]
      : undefined
    return {
      sceneId: scene.id,
      title: scene.title || scene.id,
      beat: scene.prompts?.scene?.trim() || scene.media?.prompt?.trim() || scene.title || '',
      place: place ? { name: place.name, prompt: place.prompt } : undefined,
      sceneDurationSec: Math.round((scene.durationMs ?? 45_000) / 1000),
      dialogue: scene.dialogue?.map((d) => ({
        role: d.role,
        speaker: d.speaker,
        text: d.text,
      })),
      sceneRef: scene,
    }
  })

  const characters = collectActCharacters(batch.sceneIds, args)

  const trio = await forgePromptTrioForAct(llm, {
    actId: batch.actId,
    actTitle: batch.actTitle,
    actBeat: args.acts.find((a) => a.actId === batch.actId)?.actBeat,
    characters,
    visualStyle: args.visualStyle,
    uiStylePrompt: args.uiStylePrompt,
    directorStyle: args.directorStyle,
    directorCustomPersona: args.directorCustomPersona,
    locationsById: args.locationsById,
    scenes: sceneInputs,
    lockedAnchorsPrompt: args.lockedAnchorsPrompt,
    precedingContextPrompt: overrides.precedingContextPrompt,
  }, { signal: args.signal })

  return { scenes: trio.scenes, warnings: trio.warnings, raw: trio.raw }
}

/** 收集该批 scenes 涉及的所有 character（去重，按出场顺序）。 */
function collectActCharacters(
  sceneIds: string[],
  args: ActBatchPipelineArgs,
): Character[] {
  const seen = new Set<string>()
  const out: Character[] = []
  for (const sid of sceneIds) {
    const scene = args.scenesById[sid]
    if (!scene) continue
    for (const cid of scene.characterIds ?? []) {
      if (seen.has(cid)) continue
      const ch = args.charactersById[cid]
      if (!ch) continue
      seen.add(cid)
      out.push(ch)
    }
  }
  return out
}
