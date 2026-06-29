/**
 * forgePromptTrioForAct —— 单 Act 一次出齐 image / storyboard / video 三件套。
 *
 * 定位（Phase 4 · 长文本管线优化的"批量提示词"层）：
 *
 *   一个 Act ≈ 3-8 个 scenes。在传统路径里，每个 scene 都要分别调
 *   `forgeImagePrompt` / `forgeStoryboard` / `forgeVideoPrompt` 三次 LLM call，
 *   即一个 Act 要 3N 次。1.5 万字小说炸成 5 个 Act × 4 scene = 60 次 LLM call，
 *   既贵又慢，而且**跨 scene 的人物 / 道具 / 光源一致性**全靠下游 normalize 兜底。
 *
 *   本模块用 `batch-prompt-trio.skill.md` 把"整 Act 的三类提示词一次出齐"，
 *   一次 LLM call 就能拿到 N×3 段提示词，而且同一上下文里 LLM 自然能让各 scene
 *   的角色外观 / 道具 / 光源**前后呼应**。
 *
 * 与上下游的关系：
 *
 *   - 上游：actBatchPipeline.ts 负责把整 scenario 切成 Act 批，按 token 预算
 *     再把单个 Act 拆成多个 sub-batch（最多 8 scene / batch），逐批调本模块。
 *   - 下游：调用方拿到 ActPromptTrioResult.scenes[] 后，
 *     · `image` 直接写到 scene.prompts.scene
 *     · `video` 直接写到 scene.prompts.video
 *     · `shots`（已归一化）直接写到 scene.shots
 *
 *   保留三件分别 forge 的老路径作为 fallback：本批失败时调用方逐 scene 退回老路径。
 */

import type {
  Character,
  Location,
  Scene,
  Shot,
  VisualStyle,
  DirectorStyleId,
} from '../scenario/types'
import { SKILLS } from './skills'
import { parseJSONLoose } from './parseJSONLoose'
import type { TextClient } from './types'
import { streamOrFallback } from './types'
import { resolveDirectorPersona, serializePersonaToPrompt } from './directorPersonas'
import { normalizeStoryboardShots, computeShotQuota } from './forgeStoryboard'

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/** 单个 scene 在 batch 输入里的最小描述。 */
export interface ActSceneInput {
  sceneId: string
  title: string
  /** 场景节拍 / 意图（一句话即可） */
  beat: string
  /** 场所 —— 名称 + 简述 */
  place?: { name: string; prompt?: string }
  /** 目标总时长（秒）；30-90 区间，缺省 45 */
  sceneDurationSec?: number
  /** 已有台词（逐字保留，按出现顺序） */
  dialogue?: { role: string; speaker?: string; text: string }[]
  /** 本场原文段落（script 模式下塞进来，让 LLM 逐字保留台词） */
  sceneText?: string
  /** 完整 scene 引用 —— 仅供 normalizeStoryboardShots 兜底 fallback prompt 取值 */
  sceneRef?: Scene
}

export interface ForgePromptTrioForActArgs {
  actId: string
  actTitle: string
  actBeat?: string
  /** 整 Act 共用的角色锚点 */
  characters?: Character[]
  /** 整 Act 共用的关键道具（可选） */
  keyProps?: string[]
  visualStyle?: VisualStyle
  uiStylePrompt?: string
  directorStyle?: DirectorStyleId
  directorCustomPersona?: string
  locationsById?: Record<string, Location>
  /** 该 Act 下要一次产出三件套的 scene 列表（建议 ≤ 8） */
  scenes: ActSceneInput[]
  /**
   * 已确认锚点（LOCKED ANCHORS）—— Phase 5 一致性回流。
   *
   * 调用方用 actLoopbackContext.buildLockedAnchorsPrompt(scenario) 生成；
   * 内容是作者已编辑/已确认的 characters / locations / props / uiStyle，
   * 注入后 LLM 必须把它们当不可改写的硬约束。空字符串 = 不注入。
   */
  lockedAnchorsPrompt?: string
  /**
   * 前 Act 摘要（PRECEDING_ACT_CONTEXT）—— Phase 5 一致性回流。
   *
   * 调用方用 actLoopbackContext.buildPrecedingContextPrompt(summaries) 生成；
   * 内容是本批之前已成功产出的 scene 简要画面/视频提示词；LLM 用它对齐
   * 光影 / 服装 / 道具 / 节奏。空字符串 = 不注入（首批跑时通常为空）。
   */
  precedingContextPrompt?: string
}

export interface ActScenePromptTrio {
  sceneId: string
  /** 单帧画面提示词（150-300 字中文单段） */
  image: string
  /** 镜头列表 —— 已经过 normalizeStoryboardShots 对齐到 Shot[] */
  shots: Shot[]
  /** 视频提示词（按时间码自然分段，多行） */
  video: string
  /** 该 scene 范围内的归一化告警 */
  warnings: string[]
}

export interface ForgePromptTrioForActResult {
  actId: string
  scenes: ActScenePromptTrio[]
  /** LLM 原始 raw —— 调试用 */
  raw: string
  /** Act 级告警（数量不匹配 等） */
  warnings: string[]
}

export interface ForgePromptTrioStreamOpts {
  onProgress?: (ev:
    | { kind: 'stage'; label: string; detail?: string }
    | { kind: 'delta'; delta: string; cumulative: string }
  ) => void
  signal?: AbortSignal
}

// ─────────────────────────────────────────────────────────────────────────────
// 入口
// ─────────────────────────────────────────────────────────────────────────────

export async function forgePromptTrioForAct(
  llm: TextClient,
  args: ForgePromptTrioForActArgs,
  opts: ForgePromptTrioStreamOpts = {},
): Promise<ForgePromptTrioForActResult> {
  if (args.scenes.length === 0) {
    return { actId: args.actId, scenes: [], raw: '', warnings: ['scenes 为空，跳过 LLM call'] }
  }

  const persona = resolveDirectorPersona(args.directorStyle, args.directorCustomPersona)
  const systemPrompt = [
    serializePersonaToPrompt(persona),
    '',
    '---',
    '',
    SKILLS.batchPromptTrio,
  ].join('\n')

  const userPrompt = buildBatchUserPrompt(args, persona.displayName)

  opts.onProgress?.({
    kind: 'stage',
    label: '调用 batch trio',
    detail: `${llm.getProviderName()} · ${llm.getModel()} · ${persona.displayName} · ${args.scenes.length} scenes`,
  })

  // maxTokens 估算：每 scene 三件套 ≈ image(300字) + shots(8×300字) + video(900字) ≈ 3500 字
  // 中文 token 比 ≈ 1.5；留 2× buffer
  const sceneCount = args.scenes.length
  const maxTokens = Math.min(64000, Math.max(8000, sceneCount * 6000))

  const raw = await streamOrFallback(
    llm,
    {
      systemPrompt,
      userPrompt,
      temperature: 0.85,
      maxTokens,
      jsonMode: true,
    },
    (ev) => {
      if (ev.type === 'text') {
        opts.onProgress?.({ kind: 'delta', delta: ev.delta, cumulative: ev.cumulative })
      } else if (ev.type === 'done') {
        opts.onProgress?.({
          kind: 'stage',
          label: 'batch trio 输出完成',
          detail: `${ev.full.length} 字 · ${ev.latencyMs}ms`,
        })
      }
    },
    opts.signal,
  )

  opts.onProgress?.({ kind: 'stage', label: '解析 JSON' })
  const parsed = parseJSONLoose(raw)
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('[BATCH-TRIO] 模型未返回合法 JSON · raw=' + raw.slice(0, 240))
  }

  const result = normalizeActTrioRaw(parsed as Record<string, unknown>, args)
  result.raw = raw

  opts.onProgress?.({
    kind: 'stage',
    label: 'batch trio 归一化完成',
    detail: `${result.scenes.length}/${args.scenes.length} scenes · ${result.warnings.length} warnings`,
  })
  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers · 可单测
// ─────────────────────────────────────────────────────────────────────────────

export function buildBatchUserPrompt(
  args: ForgePromptTrioForActArgs,
  personaDisplayName: string,
): string {
  const lines: string[] = []

  lines.push(`【导演流派】${personaDisplayName}（身份/剪辑语法/镜头语言见 system prompt）`)

  if (args.visualStyle) lines.push(`【全局视觉风格】${args.visualStyle}`)
  if (args.uiStylePrompt?.trim()) lines.push(`【UI 风格】${args.uiStylePrompt.trim()}`)

  // Phase 5 一致性回流：作者已确认锚点放最前面（仅次于流派），强调"硬约束"
  if (args.lockedAnchorsPrompt?.trim()) {
    lines.push(args.lockedAnchorsPrompt.trim())
  }
  // Phase 5 一致性回流：前 Act 摘要（仅供参考，不是硬约束）
  if (args.precedingContextPrompt?.trim()) {
    lines.push(args.precedingContextPrompt.trim())
  }

  lines.push(
    [
      `【Act 信息】`,
      `· actId: ${args.actId}`,
      `· 标题: ${args.actTitle}`,
      args.actBeat ? `· beat: ${args.actBeat}` : null,
    ]
      .filter(Boolean)
      .join('\n'),
  )

  if ((args.characters?.length ?? 0) > 0) {
    const charBlock = args.characters!
      .map((c) => `- ${c.name}：${(c.prompt || '').trim()}`)
      .join('\n')
    lines.push(`【出场角色锚点（整 Act 共用，整批保持一致）】\n${charBlock}`)
  }

  if (args.keyProps && args.keyProps.length > 0) {
    lines.push(
      `【关键道具（整 Act 共用，守恒）】\n${args.keyProps.map((p) => `- ${p}`).join('\n')}`,
    )
  }

  const sceneBlocks = args.scenes.map((sc, idx) => {
    const subLines: string[] = [
      `### scene #${idx + 1}`,
      `· sceneId: ${sc.sceneId}`,
      `· title: ${sc.title}`,
      `· beat: ${sc.beat}`,
    ]
    const dur = sanitizeSceneDur(sc.sceneDurationSec)
    subLines.push(`· sceneDurationSec: ${dur}`)
    if (sc.place) {
      const desc = sc.place.prompt?.trim()
      subLines.push(`· place: ${sc.place.name}${desc ? ` —— ${desc}` : ''}`)
    }
    if (sc.dialogue && sc.dialogue.length > 0) {
      const dlg = sc.dialogue
        .map((d) => `  - [${d.role}${d.speaker ? `/${d.speaker}` : ''}] ${d.text}`)
        .join('\n')
      subLines.push(`· 已有台词（逐字保留）:\n${dlg}`)
    }
    if (sc.sceneText?.trim()) {
      subLines.push(`· 原文段落（如含台词必须逐字保留）:\n"""\n${sc.sceneText.trim()}\n"""`)
    }
    return subLines.join('\n')
  })

  lines.push(`【场景列表 scenes[]，共 ${args.scenes.length} 条】\n\n${sceneBlocks.join('\n\n')}`)

  lines.push(
    [
      '请严格按 skill 中"输出契约（第四节）"返回 JSON：',
      `· 顶层 actId="${args.actId}"`,
      `· scenes 数组长度恰好 ${args.scenes.length}，sceneId 与上面一一对应`,
      '· 每个 scene 输出 image (150-300 字单段中文) + storyboard.shots[] + video (多行时间码字符串)',
      '· 不要 markdown code fence，不要任何元话语，必须能 JSON.parse 直接通过。',
    ].join('\n'),
  )

  return lines.join('\n\n')
}

export function normalizeActTrioRaw(
  parsed: Record<string, unknown>,
  args: ForgePromptTrioForActArgs,
): ForgePromptTrioForActResult {
  const warnings: string[] = []
  const scenesRaw = Array.isArray(parsed.scenes) ? (parsed.scenes as unknown[]) : []

  if (scenesRaw.length === 0) {
    throw new Error('[BATCH-TRIO-EMPTY] scenes 为空 —— 模型可能被截断或格式偏离')
  }

  const returnedActId = typeof parsed.actId === 'string' ? parsed.actId : ''
  if (returnedActId && returnedActId !== args.actId) {
    warnings.push(`actId 不匹配：输入=${args.actId} vs 输出=${returnedActId}（已使用输入值）`)
  }

  // 优先按 sceneId lookup；没匹配上时回退到顺序对齐
  const bySceneId = new Map<string, Record<string, unknown>>()
  const inOrder: Record<string, unknown>[] = []
  for (const it of scenesRaw) {
    if (!it || typeof it !== 'object') continue
    const r = it as Record<string, unknown>
    inOrder.push(r)
    const sid = typeof r.sceneId === 'string' ? r.sceneId : ''
    if (sid) bySceneId.set(sid, r)
  }

  const out: ActScenePromptTrio[] = []
  args.scenes.forEach((wanted, i) => {
    const matched = bySceneId.get(wanted.sceneId) ?? inOrder[i]
    if (!matched) {
      warnings.push(`scene[${wanted.sceneId}] 缺失，已跳过`)
      return
    }
    if (!bySceneId.has(wanted.sceneId)) {
      warnings.push(
        `scene[${wanted.sceneId}] 在输出中缺失 sceneId，按位置对齐到第 ${i + 1} 条`,
      )
    }

    const sceneWarnings: string[] = []
    const image = sanitizeImagePrompt(stringOr(matched.image), wanted, sceneWarnings)
    const video = sanitizeVideoPrompt(stringOr(matched.video), sceneWarnings)

    const storyboardObj =
      matched.storyboard && typeof matched.storyboard === 'object'
        ? (matched.storyboard as Record<string, unknown>)
        : {}
    const shotsRaw = Array.isArray(storyboardObj.shots)
      ? (storyboardObj.shots as unknown[])
      : []

    const sceneForNormalize: Scene =
      wanted.sceneRef ?? makeStubSceneForNormalize(wanted, image)

    let shots: Shot[] = []
    if (shotsRaw.length === 0) {
      sceneWarnings.push('storyboard.shots 为空，已跳过镜头归一化（调用方应回退老路径补镜头）')
    } else {
      shots = normalizeStoryboardShots(shotsRaw, sceneForNormalize, sceneWarnings)

      // —— P2.5 借鉴 forgeStoryboard 的两条非阻塞守恒校验（只告警，绝不丢镜头）——
      const sceneDur = sanitizeSceneDur(wanted.sceneDurationSec)

      // (1) 时长守恒：Σshot.durationSec 与 sceneDurationSec 偏差 > 10s → 告警
      const totalSec = shots.reduce((acc, s) => acc + (s.durationSec ?? 0), 0)
      if (Math.abs(totalSec - sceneDur) > 10) {
        sceneWarnings.push(
          `时长守恒偏差：shots 总 ${totalSec}s vs 目标 ${sceneDur}s（偏差 > 10s，不阻塞）`,
        )
      }

      // (2) 镜数配额：与 computeShotQuota(sceneDurationSec) 比对，偏离过大 → 告警
      const quota = computeShotQuota(sceneDur)
      if (shots.length < Math.ceil(quota / 2) || shots.length > quota * 2) {
        sceneWarnings.push(
          `镜数配额偏离：实出 ${shots.length} 镜 vs 配额约 ${quota} 镜（按 ${sceneDur}s 估算，不阻塞）`,
        )
      }
    }

    out.push({ sceneId: wanted.sceneId, image, shots, video, warnings: sceneWarnings })
  })

  return { actId: args.actId, scenes: out, raw: '', warnings }
}

function sanitizeSceneDur(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 45
  return Math.max(10, Math.min(180, Math.round(n)))
}

function stringOr(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function sanitizeImagePrompt(
  raw: string,
  wanted: ActSceneInput,
  warnings: string[],
): string {
  const trimmed = raw.trim()
  if (trimmed) return trimmed
  warnings.push('image 缺失，已用 title+beat 占位（调用方应回退老路径重生）')
  return `（占位画面提示词 · ${wanted.title}）${wanted.beat || ''}`.slice(0, 300)
}

function sanitizeVideoPrompt(raw: string, warnings: string[]): string {
  const trimmed = raw.trim()
  if (trimmed) return trimmed
  warnings.push('video 缺失，已用空字符串占位（调用方应回退老路径重生）')
  return ''
}

/**
 * 构造一个最小可用的 Scene stub，仅用来喂 normalizeStoryboardShots 做 fallback prompt 取值。
 * 之所以不直接用 wanted.sceneRef：调用方可能没传完整 scene。
 */
function makeStubSceneForNormalize(wanted: ActSceneInput, imagePrompt: string): Scene {
  const stub = {
    id: wanted.sceneId,
    title: wanted.title,
    media: { kind: 'image' as const, prompt: imagePrompt },
    prompts: { scene: imagePrompt },
    durationMs: (wanted.sceneDurationSec ?? 45) * 1000,
    transitions: [],
  } as unknown as Scene
  return stub
}
