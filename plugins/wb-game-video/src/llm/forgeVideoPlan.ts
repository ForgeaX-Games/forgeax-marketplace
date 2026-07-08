/**
 * forgeVideoPlan —— 视频编排 Planner（v3.8 新增）
 *
 * 定位：吃一个 scene + 已有的 shots[] + persona + scenario 上下文，
 * 产出一份完整的 `VideoPlan`，交给 `videoSchedule` 拆 DAG、`videoPipelineRunner` 跑。
 *
 * **设计核心：LLM 只做语义决策，纯函数只做物理计算。**
 *
 *   语义决策（LLM）：
 *     - 哪些 shot 属于同一个 continuityGroup（同场追逐 / 同一情绪弧）
 *     - 每段视频的 kineticVideoPrompt（时间刻度 + 运镜 + 动作）
 *   物理计算（纯函数）：
 *     - durationSec > maxSingleClipSec 时拆成几段、每段多长
 *     - startFrameStrategy 选择（同组首段 vs 非首段）
 *     - dependsOnSegmentId 链条
 *
 * 这样分工确保：
 *   - LLM 不会把"30s 拆 3 段"算错（它不擅长算术）
 *   - 代码不会替作者决定"追逐戏是否算一组"（那是导演判断）
 *
 * 与 `forgeKineticVideo.ts` 的关系：
 *   `forgeKineticVideo` 仍保留为"单段 kinetic prompt 生成"的底层 helper。
 *   `forgeVideoPlan` 在 planner 流程里**批量**调用它（每个 segment 一次），
 *   并做 continuity context 注入（previousShotTail / nextShotHead）。
 *
 * 后续升级空间：
 *   - 可以把"continuity 决策"和"段内 prompt 生成"合并成一次 LLM 调用（省 tokens）
 *     本 v1 先分开：继续/并行调试时语义决策错了容易排查。
 */
import type { Scene, Scenario, Shot, DirectorStyleId, VisualStyle } from '../scenario/types'
import { SKILLS } from './skills'
import type { TextClient } from './types'
import { streamOrFallback } from './types'
import { resolveDirectorPersona, serializePersonaToPrompt } from './directorPersonas'
import {
  getCapability,
  splitDurationToSegments,
  type ModelCapability,
  type VideoModelId,
} from './modelCapabilities'
import { planClipSegments } from './settleClipDuration'
import type {
  VideoPlan,
  VideoSegment,
  LLMContinuityDecision,
} from './videoPlanTypes'
import { forgeKineticVideoPrompt } from './forgeKineticVideo'

export interface ForgeVideoPlanArgs {
  scene: Scene
  scenario: Scenario
  modelId?: VideoModelId | string
  directorStyle?: DirectorStyleId
  directorCustomPersona?: string
  visualStyle?: VisualStyle
  uiStylePrompt?: string
}

export interface ForgeVideoPlanStreamOpts {
  onProgress?: (ev:
    | { kind: 'stage'; label: string; detail?: string }
    | { kind: 'delta'; delta: string; cumulative: string }
  ) => void
  signal?: AbortSignal
}

/**
 * 主入口：规划整个 scene 的视频生成方案。
 *
 * 流程：
 *   1) 物理拆段：shots → segments（纯函数，modelCapabilities 主导）
 *   2) LLM 判 continuity 组（语义决策，一次调用）
 *   3) 批量生 kineticVideoPrompt（每段一次调用，带 continuity 上下文）
 *   4) 组装 VideoPlan 返回
 */
export async function forgeVideoPlan(
  llm: TextClient,
  args: ForgeVideoPlanArgs,
  opts: ForgeVideoPlanStreamOpts = {},
): Promise<VideoPlan> {
  const cap = getCapability(args.modelId)
  const warnings: string[] = []
  const rationaleParts: string[] = [`[model] ${cap.id} (asOf ${cap.asOf})`]

  // 步骤 1 · 物理拆段 —— 纯函数，确定性
  opts.onProgress?.({ kind: 'stage', label: '拆分视频段' })
  const rawSegments = buildSegmentsFromShots(args.scene, cap)
  rationaleParts.push(`[split] ${(args.scene.shots ?? []).length} shots → ${rawSegments.length} segments`)

  // 步骤 2 · LLM 判 continuity（语义）
  let decision: LLMContinuityDecision = { assignments: {}, rationale: '未调用 LLM（单 shot / 无 shots）' }
  if ((args.scene.shots ?? []).length >= 2) {
    opts.onProgress?.({ kind: 'stage', label: '判连续组（LLM 决策）' })
    decision = await decideContinuityGroups(llm, args, opts).catch((e) => {
      warnings.push(`continuity 决策失败，全部视为独立组：${e instanceof Error ? e.message : String(e)}`)
      return { assignments: {}, rationale: 'LLM 调用失败，fallback 独立组' }
    })
  }
  rationaleParts.push(`[continuity] ${decision.rationale}`)

  // 把 continuity 决策落到 segments 上
  applyContinuityAssignments(rawSegments, decision.assignments, args.scene)

  // 步骤 3 · 批量生 kineticVideoPrompt
  opts.onProgress?.({ kind: 'stage', label: `生成 ${rawSegments.length} 段视频 prompt` })
  await fillKineticPrompts(llm, args, rawSegments, opts).catch((e) => {
    warnings.push(`部分 kinetic prompt 生成失败：${e instanceof Error ? e.message : String(e)}`)
  })

  return {
    sceneId: args.scene.id,
    segments: rawSegments,
    modelId: cap.id,
    rationale: rationaleParts.join('\n'),
    warnings,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 纯函数 · 可单测
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 选时长结算器（P3-C）：
 *   - Seedance 2.0 类模型（以 `supportsVideoExtend` 标识）→ `planClipSegments`
 *     （floor 取官方区间下限 4s、宁多勿少）
 *   - 其余旧模型 → 沿用历史 `splitDurationToSegments`（floor=minUsefulClipSec，保留 1s 快切）
 * 这样 2.0 的「4–15s 结算」接进生产路径，又不改旧模型既有拆段行为。
 */
function settleSegmentsForCap(targetDuration: number, cap: ModelCapability): number[] {
  return cap.supportsVideoExtend
    ? planClipSegments(targetDuration, cap)
    : splitDurationToSegments(targetDuration, cap)
}

/**
 * 续接策略决策（P3-C，纯函数）。
 *   - 承接前段的段（startFrameStrategy='prev-segment-tail'）→ 'continuation'
 *     （尾帧 + 参考集 + 连续镜头声明提示词；不走原生视频延长）
 *   - 其余 → 'standalone'（用自己的关键帧起手）
 */
export function decideExtendStrategy(
  startFrameStrategy: VideoSegment['startFrameStrategy'],
): NonNullable<VideoSegment['extendStrategy']> {
  return startFrameStrategy === 'prev-segment-tail' ? 'continuation' : 'standalone'
}

/**
 * 连续镜头声明（P3-C，纯函数）—— 续接段提示词的前缀，**明确告诉视频模型这是同一镜头的延续**，
 * 让它据「尾帧 + 角色/场景参考」自然续接，而不是重新构图/切镜。
 */
export function composeContinuityDeclaration(): string {
  return (
    '【连续镜头·一镜到底】本段是上一画面的直接延续，参考图含上一段尾帧——' +
    '保持同一镜头不切换：机位运动、景别、人物、场景与光线全程连贯，' +
    '不要重新构图、不要跳剪、不要黑场转场，从尾帧呈现的状态自然往下续接当前动作。'
  )
}

/**
 * 把 shots[] 拆成 segments[]。
 *
 * 规则：
 *   - shot.durationSec 缺失 → 默认 5s
 *   - durationSec ≤ cap.maxSingleClipSec → 1 个 segment
 *   - durationSec >  cap.maxSingleClipSec → splitDurationToSegments 拆多段
 *   - 单 shot 内多段自动同 continuityGroupId（= `grp-<shotId>`）
 *   - 第 0 段 startFrame 策略依据 shot.keyframeStrategy：
 *       'ab'     → 'shot-start-frame'
 *       'single' → 'shot-keyframe'
 *       缺省     → 'shot-keyframe'
 *   - 第 N≥1 段固定 'prev-segment-tail' + dependsOnSegmentId 指向前一段
 */
export function buildSegmentsFromShots(
  scene: Scene,
  cap: ReturnType<typeof getCapability>,
): VideoSegment[] {
  const out: VideoSegment[] = []

  ;(scene.shots ?? []).forEach((shot, shotOrder) => {
    const targetDuration = typeof shot.durationSec === 'number' && shot.durationSec > 0
      ? shot.durationSec
      : 5
    const segDurations = settleSegmentsForCap(targetDuration, cap)
    if (segDurations.length === 0) return

    const intraGroupId = `grp-${shot.id}`
    let prevSegId: string | undefined

    segDurations.forEach((dur, segIdx) => {
      const segId = `${scene.id}-${shot.id}-seg${String(segIdx).padStart(2, '0')}`

      let startFrameStrategy: VideoSegment['startFrameStrategy']
      if (segIdx > 0) {
        startFrameStrategy = 'prev-segment-tail'
      } else if (shot.keyframeStrategy === 'ab') {
        startFrameStrategy = 'shot-start-frame'
      } else {
        startFrameStrategy = 'shot-keyframe'
      }

      out.push({
        id: segId,
        sceneId: scene.id,
        shotId: shot.id,
        segmentIndex: segIdx,
        durationSec: dur,
        prompt: '', // 由 fillKineticPrompts 填充
        continuityGroupId: intraGroupId,
        dependsOnSegmentId: prevSegId,
        startFrameStrategy,
        extendStrategy: decideExtendStrategy(startFrameStrategy),
        shotOrder,
      })
      prevSegId = segId
    })
  })

  return out
}

/**
 * 把 LLM 给的 continuityGroup 决策应用到 segments。
 *
 * 规则：
 *   - 只能"合并"单 shot 内组 → 跨 shot 组（不能拆散单 shot 内的多段连续）
 *   - 决策里没提到的 shotId 保留原 `grp-<shotId>`
 *   - 跨 shot 合并时，同组内**按 shotOrder 升序**串行：后 shot 的第 0 段依赖前 shot 的最后一段
 */
export function applyContinuityAssignments(
  segments: VideoSegment[],
  assignments: Record<string, string>,
  scene: Scene,
): void {
  // 先把 assignment 写入同 shot 所有段
  segments.forEach((seg) => {
    const gid = assignments[seg.shotId]
    if (gid && typeof gid === 'string' && gid.trim()) {
      seg.continuityGroupId = gid.trim()
    }
  })

  // 按 groupId 聚合，跨 shot 连接 dependsOn 链
  const byGroup = new Map<string, VideoSegment[]>()
  segments.forEach((seg) => {
    const list = byGroup.get(seg.continuityGroupId) ?? []
    list.push(seg)
    byGroup.set(seg.continuityGroupId, list)
  })

  byGroup.forEach((segs) => {
    segs.sort((a, b) => {
      if (a.shotOrder !== b.shotOrder) return a.shotOrder - b.shotOrder
      return a.segmentIndex - b.segmentIndex
    })
    // 组内第一段保留 shot-keyframe / shot-start-frame
    // 组内其余段：如果是**跨 shot 承接**的第 0 段，升级 startFrameStrategy 到 prev-segment-tail
    for (let i = 1; i < segs.length; i++) {
      const cur = segs[i]!
      const prev = segs[i - 1]!
      if (cur.segmentIndex === 0 && cur.shotId !== prev.shotId) {
        // 跨 shot 承接 → 升为连续镜头延续
        cur.startFrameStrategy = 'prev-segment-tail'
        cur.extendStrategy = decideExtendStrategy(cur.startFrameStrategy)
      }
      cur.dependsOnSegmentId = prev.id
    }
  })

  // scene 参数预留：将来可能需要按 scene 层级做额外约束（目前未用）
  void scene
}

// ─────────────────────────────────────────────────────────────────────────────
// LLM 调用 · 副作用
// ─────────────────────────────────────────────────────────────────────────────

async function decideContinuityGroups(
  llm: TextClient,
  args: ForgeVideoPlanArgs,
  opts: ForgeVideoPlanStreamOpts,
): Promise<LLMContinuityDecision> {
  const persona = resolveDirectorPersona(args.directorStyle, args.directorCustomPersona)
  const systemPrompt = [
    serializePersonaToPrompt(persona),
    '',
    '---',
    '',
    '你是这位导演的剪辑师助手。现在你会收到一场戏的所有分镜（shots）。',
    '你的**唯一任务**是判断哪些 shots 在叙事上是"物理连续的同一段一镜到底"',
    '（例如：同一场追逐戏的 3 个连续镜头 / 同一段对话的正反打 / 同一事件的慢镜延续）。',
    '',
    '输出一个 JSON：',
    '{',
    '  "groups": [',
    '    { "groupId": "chase-roof", "shotIds": ["shot-a", "shot-b"], "reason": "屋顶追逐一镜到底" },',
    '    { "groupId": "dialogue-kitchen", "shotIds": ["shot-d", "shot-e"], "reason": "厨房对话正反打" }',
    '  ],',
    '  "rationale": "整体剪辑逻辑的一段人话说明（50-150 字）"',
    '}',
    '',
    '规则：',
    '- 只列"需要连续"的组（即两个及以上 shotId 属同一组）',
    '- 不属于任何连续组的 shot 不用出现',
    '- groupId 要语义化（chase-roof / dialogue-kitchen），不要用随机 hash',
    '- 根据 persona 的剪辑语法调整（维伦纽瓦慢派系会多合并、米勒快剪派系会少合并）',
    '- 输出必须是可被 JSON.parse 的纯 JSON，不要 markdown 代码块',
  ].join('\n')

  const shotsDump = (args.scene.shots ?? []).map((s, i) => {
    return [
      `[${i}] shotId=${s.id}  framing=${s.framing}  duration=${s.durationSec ?? '?'}s`,
      `    prompt: ${truncate(s.prompt, 120)}`,
      s.cameraHint ? `    camera: ${truncate(s.cameraHint, 80)}` : '',
      s.sourceTextSpan ? `    script: 「${truncate(s.sourceTextSpan, 80)}」` : '',
      s.transitionHint ? `    transition: ${s.transitionHint}` : '',
    ].filter(Boolean).join('\n')
  }).join('\n\n')

  const userPrompt = [
    `【场景】${args.scene.id}`,
    args.scene.prompts?.scene ? `【剧本原文】\n${truncate(args.scene.prompts.scene, 400)}` : '',
    '',
    `【分镜清单】共 ${(args.scene.shots ?? []).length} 镜`,
    shotsDump,
    '',
    '请输出 JSON：',
  ].filter(Boolean).join('\n')

  const raw = await streamOrFallback(
    llm,
    { systemPrompt, userPrompt, temperature: 0.3, maxTokens: 1200, jsonMode: true },
    (ev) => {
      if (ev.type === 'text') {
        opts.onProgress?.({ kind: 'delta', delta: ev.delta, cumulative: ev.cumulative })
      }
    },
    opts.signal,
  )

  return parseContinuityDecision(raw)
}

/**
 * 解析 LLM 输出为 LLMContinuityDecision。
 * 容错：剥 ```json```、修首尾杂字、失败则返回空。
 */
export function parseContinuityDecision(raw: string): LLMContinuityDecision {
  const cleaned = stripJsonFence(raw)
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    return { assignments: {}, rationale: `LLM 输出无法解析为 JSON：${truncate(cleaned, 120)}` }
  }
  if (!parsed || typeof parsed !== 'object') {
    return { assignments: {}, rationale: 'LLM 输出非对象' }
  }
  const obj = parsed as Record<string, unknown>
  const assignments: Record<string, string> = {}
  const groups = Array.isArray(obj.groups) ? obj.groups : []
  for (const g of groups) {
    if (!g || typeof g !== 'object') continue
    const gg = g as Record<string, unknown>
    const groupId = typeof gg.groupId === 'string' ? gg.groupId.trim() : ''
    const shotIds = Array.isArray(gg.shotIds) ? gg.shotIds : []
    if (!groupId || shotIds.length < 2) continue
    for (const sid of shotIds) {
      if (typeof sid === 'string' && sid.trim()) {
        assignments[sid.trim()] = groupId
      }
    }
  }
  const rationale = typeof obj.rationale === 'string' && obj.rationale.trim()
    ? obj.rationale.trim()
    : 'LLM 未提供 rationale'
  return { assignments, rationale }
}

async function fillKineticPrompts(
  llm: TextClient,
  args: ForgeVideoPlanArgs,
  segments: VideoSegment[],
  opts: ForgeVideoPlanStreamOpts,
): Promise<void> {
  const shotById = new Map((args.scene.shots ?? []).map((s) => [s.id, s]))

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!
    const shot = shotById.get(seg.shotId)
    if (!shot) continue

    // previousShotTail / nextShotHead 来自同组前后段对应的 shot prompt
    const prevSeg = seg.dependsOnSegmentId
      ? segments.find((x) => x.id === seg.dependsOnSegmentId)
      : undefined
    const prevShot = prevSeg ? shotById.get(prevSeg.shotId) : undefined

    const nextSeg = segments.find(
      (x) => x.dependsOnSegmentId === seg.id,
    )
    const nextShot = nextSeg ? shotById.get(nextSeg.shotId) : undefined

    // 临时 Shot 覆盖 durationSec 为段时长（让 skill 按段时长算时间刻度）
    const shotForSegment: Shot = {
      ...shot,
      durationSec: seg.durationSec,
    }

    opts.onProgress?.({
      kind: 'stage',
      label: `段 ${i + 1}/${segments.length} prompt`,
      detail: `${seg.id} · ${seg.durationSec}s · ${seg.startFrameStrategy}`,
    })

    try {
      const result = await forgeKineticVideoPrompt(
        llm,
        {
          shot: shotForSegment,
          scene: args.scene,
          directorStyle: args.directorStyle,
          directorCustomPersona: args.directorCustomPersona,
          visualStyle: args.visualStyle,
          uiStylePrompt: args.uiStylePrompt,
        },
        { signal: opts.signal },
      )
      seg.prompt = augmentPromptWithContinuityContext(
        result.prompt,
        prevShot?.prompt,
        nextShot?.prompt,
        seg.segmentIndex,
      )
      // 续接段：在提示词最前明确声明「同一连续镜头」，交给视频模型据尾帧+参考集续接
      if (seg.extendStrategy === 'continuation') {
        seg.prompt = `${composeContinuityDeclaration()}\n${seg.prompt}`
      }
    } catch (e) {
      // 单段失败不阻塞；占位 prompt 让作者能看到问题
      seg.prompt = `[PROMPT_GEN_FAILED] ${shot.prompt}`
      void e
    }
  }
}

/**
 * 把前后镜画面线索拼到 prompt 末尾 —— 轻量补丁，让视频模型感知上下文。
 * 不重复核心画面，只挂 20 字内的承接锚点。
 */
export function augmentPromptWithContinuityContext(
  base: string,
  prevTail: string | undefined,
  nextHead: string | undefined,
  segmentIndex: number,
): string {
  const extras: string[] = []
  if (prevTail && segmentIndex === 0) {
    extras.push(`（承接前镜：${truncate(prevTail, 30)}）`)
  }
  if (nextHead) {
    extras.push(`（预接下镜：${truncate(nextHead, 30)}）`)
  }
  if (extras.length === 0) return base
  return `${base}${extras.join('')}`
}

function truncate(s: string, max: number): string {
  if (!s) return ''
  if (s.length <= max) return s
  return s.slice(0, max - 1) + '…'
}

function stripJsonFence(raw: string): string {
  let s = String(raw ?? '').trim()
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fence && fence[1]) s = fence[1]
  // 掐掉 LLM 前置客套
  s = s.replace(/^(好的|以下是|这是你要的|以下为)[，,：:]?\s*/u, '')
  return s.trim()
}

// SKILLS / modelCapabilities / videoPlanTypes 被下游消费；留作未来 planner 扩展使用
void SKILLS
