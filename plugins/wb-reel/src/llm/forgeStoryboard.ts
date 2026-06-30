/**
 * forgeStoryboard —— 电影分镜脚本生成管线
 *
 * 定位：在一个 **剧情节点 (scene)** 已有基础信息（background / prompts.scene /
 * characterIds / locationId）的前提下，**把它拆成「少而长」的电影分镜**（shots），
 * 每个 shot = 一段 ≤15s 的视频，承载一整拍完整的戏（可含数句来回对白 + 数个动作），
 * 含画面 prompt + 音效视觉化 + 台词/潜台词 + 表演指导 + 衔接。
 * 拆镜由 LLM 全局统筹：密集对白/高潮单元优先完整独占一镜，NEVER 切成一堆 5s 碎镜。
 *
 * 与 `promptForge.ts` 里各函数的分工：
 *
 *   - `forgeImagePrompt`          单镜级 · 重写一张 shot 的画面 prompt
 *   - `forgeShotRefine`           单镜级 · 重写画面 prompt + 同步生图
 *   - `forgeStoryboard`           **场景级 · 一次产出 N 张分镜（本文件）**
 *   - `forgeScenarioFromIdea`     全剧本级 · 从一句话生整个剧情树
 *
 * 流程：
 *   1) 把 scene 各字段 + 角色外观锚点 + 场所描述 + 期望镜数拼成 user prompt
 *   2) 系统 prompt 来自 `storyboard-director.skill.md` —— 它定义了专业分镜规则
 *   3) LLM 以严格 JSON 返回 shots[]，本模块做 normalizeStoryboardShots 对齐结构
 *   4) 产出标准 Shot[]，调用方负责写回 scene.shots 并触发后续生图
 *
 * 设计约束：
 *   - 本模块只管"生出一套分镜脚本文本"，**不自己调 ImageClient 生图**。
 *     生图由调用方（或 forgeImagePipeline.runForgeImagePipeline）后续并发处理。
 *   - LLM 输出里的 `prompt` 已经是 cinema-image-prompt 审美的中文 150-300 字，
 *     下游 buildShotKeyframePrompt 会再叠 framing/audio/performance 段落拼给图像模型。
 *   - 纯函数层：`buildStoryboardUserPrompt` / `normalizeStoryboardShots` 可单测。
 */

import type { Scene, Shot, Character, Location, ShotFraming, VisualStyle, DirectorStyleId } from '../scenario/types'
import { SKILLS } from './skills'
import { parseJSONLoose } from './parseJSONLoose'
import type { TextClient } from './types'
import { streamOrFallback } from './types'
import { resolveDirectorPersona, serializePersonaToPrompt } from './directorPersonas'

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export interface ForgeStoryboardArgs {
  /** 目标剧情节点（提供 background / prompts.scene / characterIds / locationId） */
  scene: Scene
  /** 出场角色完整信息（外观锚点前置） */
  characters: Character[]
  /** 场所信息（可选，有则把描述提供给 LLM） */
  location?: Location
  /** 全局视觉风格 —— 让 LLM 知道往哪个美学方向写（不在 prompt 里复读风格词，composeVisualPrompt 负责前缀） */
  visualStyle?: VisualStyle
  /** 全局 UI 风格提示词（若有） */
  uiStylePrompt?: string
  /**
   * 期望镜数，可选；
   *   - 不填 → 按 sceneDurationSec 自动算（见 computeShotQuota）
   *   - 填了 → clampShotCount 约束到 4-10
   * 范围 4-10。
   */
  desiredShotCount?: number
  /**
   * 场景目标总时长（秒）—— v3.8 新增。
   * 决定自动镜数计算的分档；默认 60（对应 6-8 镜）。
   * 所有 shot.durationSec 之和应 ≈ 此值（±5s 容差）。
   */
  sceneDurationSec?: number
  /**
   * 本场原文 / 节拍描述（可选）——
   * script 模式下应直接把原文段落塞进来，让 LLM 逐字保留台词；
   * idea 模式下可省略，交给 LLM 基于 scene.prompts.scene 发散。
   */
  sceneText?: string
  /**
   * 导演流派 —— v3.8 新增。
   * 决定 system prompt 里注入哪一套 persona（剪辑语法/镜头语言/节奏）。
   * 不填 → directorPersonas 的 DEFAULT_DIRECTOR_STYLE（维伦纽瓦·史诗）。
   */
  directorStyle?: DirectorStyleId
  /**
   * 自定义导演 persona 文本 —— directorStyle='custom' 时使用。
   */
  directorCustomPersona?: string
}

export interface ForgeStoryboardResult {
  /** 产出的分镜列表（已对齐到本仓 Shot 结构，含 id/order 等） */
  shots: Shot[]
  /** LLM 原始输出 —— 调试用 */
  raw: string
  /** 解析/归一化过程中的告警 */
  warnings: string[]
}

export interface ForgeStoryboardStreamOpts {
  onProgress?: (ev:
    | { kind: 'stage'; label: string; detail?: string }
    | { kind: 'delta'; delta: string; cumulative: string }
  ) => void
  signal?: AbortSignal
}

/**
 * 入口 —— 场景级分镜脚本生成。
 *
 * 典型调用位置：
 *   - Editor 里作者对某个 scene 点"生成分镜脚本"按钮
 *   - 批量处理：对所有 scenes 并发跑（调用方负责 concurrency 控制）
 */
export async function forgeStoryboard(
  llm: TextClient,
  args: ForgeStoryboardArgs,
  opts: ForgeStoryboardStreamOpts = {},
): Promise<ForgeStoryboardResult> {
  const sceneDurationSec = sanitizeSceneDuration(args.sceneDurationSec)
  const autoQuota = computeShotQuota(sceneDurationSec)
  const desired = args.desiredShotCount !== undefined
    ? clampShotCount(args.desiredShotCount)
    : autoQuota

  // —— 组装 system prompt：persona + 原 skill
  const persona = resolveDirectorPersona(
    args.directorStyle,
    args.directorCustomPersona,
  )
  const systemPrompt = [
    serializePersonaToPrompt(persona),
    '',
    '---',
    '',
    SKILLS.storyboardDirector,
  ].join('\n')

  const user = buildStoryboardUserPrompt({
    ...args,
    desiredShotCount: desired,
    sceneDurationSec,
  })

  opts.onProgress?.({
    kind: 'stage',
    label: '调用分镜导演',
    detail: `${llm.getProviderName()} · ${llm.getModel()} · ${persona.displayName} · ${desired} 镜 / ${sceneDurationSec}s`,
  })

  const raw = await streamOrFallback(
    llm,
    {
      systemPrompt,
      userPrompt: user,
      temperature: 0.8,
      maxTokens: 6000,
      jsonMode: true,
    },
    (ev) => {
      if (ev.type === 'text') {
        opts.onProgress?.({
          kind: 'delta',
          delta: ev.delta,
          cumulative: ev.cumulative,
        })
      } else if (ev.type === 'done') {
        opts.onProgress?.({
          kind: 'stage',
          label: '分镜输出完成',
          detail: `${ev.full.length} 字 · ${ev.latencyMs}ms`,
        })
      }
    },
    opts.signal,
  )

  opts.onProgress?.({ kind: 'stage', label: '解析 JSON' })
  const parsed = parseJSONLoose(raw)
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('[STORYBOARD] 模型未返回合法 JSON · raw=' + raw.slice(0, 240))
  }
  const shapeArr = Array.isArray((parsed as { shots?: unknown }).shots)
    ? ((parsed as { shots: unknown[] }).shots)
    : []
  if (shapeArr.length === 0) {
    throw new Error(
      '[STORYBOARD-EMPTY] shots 为空 —— 模型可能被截断或格式偏离 · raw=' +
        raw.slice(0, 240),
    )
  }

  const warnings: string[] = []
  const shots = normalizeStoryboardShots(shapeArr, args.scene, warnings)

  // 时长守恒检查：总和与 sceneDurationSec 偏差超过 10s 记一条 warning（不阻塞）
  const totalSec = shots.reduce((acc, s) => acc + (s.durationSec ?? 0), 0)
  if (Math.abs(totalSec - sceneDurationSec) > 10) {
    warnings.push(
      `时长守恒偏差：shots 总 ${totalSec}s vs 目标 ${sceneDurationSec}s`,
    )
  }
  opts.onProgress?.({
    kind: 'stage',
    label: `归一化完成（${shots.length} 镜 · ${totalSec}s）`,
  })
  return { shots, raw, warnings }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers · 可单测
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 把 scene 的各字段拼成给 storyboard-director skill 的 user prompt。
 *
 * 结构对应 skill 里声明的"输入格式"章节：
 *   【场景标题】【全局视觉风格】【UI 风格】【场所】【出场角色】
 *   【舞美 / 氛围】【场景意图】【已有台词】【期望镜数】
 */
export function buildStoryboardUserPrompt(args: ForgeStoryboardArgs): string {
  const lines: string[] = []

  // persona header（仅显示导演流派名，供 LLM 下笔前再确认一次身份）
  const persona = resolveDirectorPersona(
    args.directorStyle,
    args.directorCustomPersona,
  )
  lines.push(`【导演流派】${persona.displayName} —— ${persona.tagline}（身份/剪辑语法/镜头语言见 system prompt）`)

  lines.push(`【场景标题】${args.scene.title || args.scene.id}`)

  if (args.sceneDurationSec !== undefined) {
    lines.push(
      `【场景目标总时长 sceneDurationSec】${args.sceneDurationSec}（所有 shot.durationSec 之和必须 ≈ 此值，±5s 内）`,
    )
  }

  if (args.visualStyle) {
    lines.push(`【全局视觉风格】${args.visualStyle}`)
  }
  if (args.uiStylePrompt?.trim()) {
    lines.push(`【UI 风格】${args.uiStylePrompt.trim()}`)
  }

  if (args.location) {
    const locDesc = args.location.prompt?.trim()
    lines.push(
      `【场所】${args.location.name}${locDesc ? ` —— ${locDesc}` : ''}`,
    )
  }

  if (args.characters.length > 0) {
    const charBlock = args.characters
      .map((c) => {
        const appearance = c.prompt?.trim()
        return `- ${c.name}${appearance ? `：${appearance}` : ''}`
      })
      .join('\n')
    lines.push(`【出场角色（视觉锚点前置，保持一致性）】\n${charBlock}`)
  }

  const background = args.scene.background?.trim()
  if (background) {
    lines.push(`【舞美 / 氛围 / 天气】${background}`)
  }

  const sceneIntent = args.scene.prompts?.scene?.trim()
  if (sceneIntent) {
    lines.push(`【场景意图 / 节拍】${sceneIntent}`)
  }

  // script 模式下，把原文段落塞进来，skill 会要求逐字保留台词
  if (args.sceneText?.trim()) {
    lines.push(`【本场原文（若含台词，必须逐字保留）】\n"""\n${args.sceneText.trim()}\n"""`)
  }

  // 已有台词（有的话）—— 让 LLM 在 dialogueText 字段里原样填，并保留说话人
  if (args.scene.dialogue && args.scene.dialogue.length > 0) {
    const dialogueBlock = args.scene.dialogue
      .map((d) => `- ${d.speaker || d.role}：${d.text}`)
      .join('\n')
    lines.push(
      `【已有台词（按顺序，必须逐字保留 + 标注说话人）】\n${dialogueBlock}\n` +
        `→ 把台词分配进对应镜的 dialogueText：多句来回时每行写「角色名：台词」；同一段连续来回对白尽量整组落在同一镜，不要拆散到相邻镜。`,
    )
  }

  lines.push(
    `【期望镜数】约 ${args.desiredShotCount ?? 1} 镜（少而长 · 仅作下限参考）——\n` +
      `请先通读整场戏统筹分配时长：把密集来回对白 / 情绪高潮 / 不可打断的动作链优先各自完整塞进一个 ≤15s 的镜；琐碎过渡拍压到 4–6s 让出预算。NEVER 把一场戏切成一堆 5s 碎镜，也 NEVER 从一句对白中间硬切。镜数可按戏的密度上下浮动。`,
  )
  lines.push('')
  lines.push(
    '请严格按 skill 中"输出契约"返回 JSON，只含 shots 数组；每个 durationSec 是 4–15 的整数秒（承载戏肉的镜优先 10–15s）；**durationSec 必须 ≥ 本镜 dialogueText 自然朗读所需时间（中文约 4 字/秒）—— 台词长就给满或接近 15s，绝不可压到角色读不完；一句连续台词朗读超过 15s 时，拆到下一镜并用 continuityGroupId 承接**；A/B 双帧模式下 startFramePrompt / endFramePrompt 必填并保证物理守恒；不要任何元话语。',
  )

  return lines.join('\n\n')
}

/**
 * 把 LLM 返回的 raw shot 对象列表对齐到本仓 Shot 结构。
 *
 * - id 重签：`<sceneId>-sh<NN>`，忽略 LLM 返回的 id（可能重复或格式异常）
 * - order 重排：按 LLM 返回顺序 0..N-1
 * - framing 字典对齐到六基准值
 * - durationSec 吸附到 seedance 合法区间 [4,15]s（每镜=一段视频片段）
 * - bokehState 白名单
 * - prompt 缺失时兜底 fallback 到 scene.prompts.scene，避免生图任务崩
 */
export function normalizeStoryboardShots(
  raw: unknown[],
  scene: Scene,
  warnings: string[],
): Shot[] {
  const fallbackPrompt =
    scene.prompts?.scene?.trim() ||
    scene.media?.prompt?.trim() ||
    scene.title ||
    ''

  // 每次「拆镜」生成一个唯一 token 拼进 shot id（如 s1-sh01-k3f9a）。
  //   根因修复（作者反馈「一个卡片上面有多段视频」）：旧实现用纯索引 id
  //   `<sceneId>-shNN`，「重新拆镜」后新镜会**复用**和上一版完全相同的 id；
  //   而逐镜出片的视频按 `reel:orch:<sceneId>:<shotId>` 打 tag、镜头卡也按同
  //   tag 聚合候选 —— 于是上一版镜头的旧视频会原样挂到新镜卡上，造成「我没在
  //   这张卡上迭代，却出现了好几段视频」。给每次拆镜一个 token，新镜得到全新
  //   id，旧视频自然不再匹配新卡（仍留在素材库可手动找回），实现「一卡一内容、
  //   只有在本卡继续生成才追加候选」。
  const genToken = Math.random().toString(36).slice(2, 7)
  const shotId = (i: number): string =>
    `${scene.id}-sh${String(i + 1).padStart(2, '0')}-${genToken}`

  const mapped: Shot[] = raw.map((item, i) => {
    if (!item || typeof item !== 'object') {
      warnings.push(`shot[${i}] 非对象，已占位`)
    }
    const r = (item as Record<string, unknown>) ?? {}
    const id = shotId(i)
    const framing = normalizeFraming(stringOr(r.framing))
    const prompt = stringOr(r.prompt)?.trim() || fallbackPrompt
    const cameraHint = trimOrUndef(stringOr(r.cameraHint))
    const transitionHint = trimOrUndef(stringOr(r.transitionHint))
    const dialogueText = trimOrUndef(stringOr(r.dialogueText))
    // 台词感知的镜时长：LLM 给的秒数若短于「这句台词自然朗读所需的时间」，角色会
    // 读得飞快还读不完。取两者较大者再 clamp 到 [4,15]；单镜台词需 >15s 则告警，
    // 提示拆到下一镜（靠 continuityGroupId 承接），而不是硬塞进一个读不完的镜。
    const readSec = dialogueReadingSec(dialogueText)
    const llmDurSec = numOr(r.durationSec)
    const durationSec = clampDurationSec(
      Math.max(llmDurSec ?? 0, readSec ?? 0) || undefined,
    )
    if (readSec != null && readSec > 15) {
      warnings.push(
        `shot[${i}] 台词朗读约需 ${readSec}s，超单镜上限 15s —— 建议把这段台词拆到下一镜（continuityGroupId 承接），否则会读不完。`,
      )
    }
    const bokehState = normalizeBokeh(stringOr(r.bokehState))
    const subtext = trimOrUndef(stringOr(r.subtext))
    const performance = trimOrUndef(stringOr(r.performance))
    const audioHint = trimOrUndef(stringOr(r.audioHint))
    const sourceTextSpan = trimOrUndef(stringOr(r.sourceTextSpan))
    const continuityGroupId = trimOrUndef(stringOr(r.continuityGroupId))
    const characterIds = Array.isArray(r.characterIds)
      ? (r.characterIds.filter((x) => typeof x === 'string') as string[])
      : undefined

    // —— A/B 双帧字段处理 ——
    // keyframeStrategy 白名单；其余值 → 兜底 'single'
    const rawStrategy = stringOr(r.keyframeStrategy)?.trim().toLowerCase()
    const keyframeStrategy: Shot['keyframeStrategy'] =
      rawStrategy === 'ab' ? 'ab' : rawStrategy === 'single' ? 'single' : undefined
    const startFramePrompt = trimOrUndef(stringOr(r.startFramePrompt))
    const endFramePrompt = trimOrUndef(stringOr(r.endFramePrompt))

    // 约束：ab 模式必须两个帧 prompt 都有；缺失则降级到 single 并告警
    let finalStrategy = keyframeStrategy
    let finalStart = startFramePrompt
    let finalEnd = endFramePrompt
    if (finalStrategy === 'ab') {
      if (!finalStart || !finalEnd) {
        warnings.push(
          `shot[${i}] keyframeStrategy='ab' 但 startFramePrompt/endFramePrompt 缺失，已降级为 single`,
        )
        finalStrategy = 'single'
        finalStart = undefined
        finalEnd = undefined
      }
    } else if (finalStrategy === 'single') {
      // single 模式下 A/B 字段无意义 —— 丢弃，避免下游误用
      finalStart = undefined
      finalEnd = undefined
    }

    const shot: Shot = {
      id,
      order: i,
      framing,
      prompt,
      cameraHint,
      transitionHint,
      characterIds,
      durationSec,
      bokehState,
      dialogueText,
      subtext,
      performance,
      audioHint,
      sourceTextSpan,
      continuityGroupId,
      keyframeStrategy: finalStrategy,
      startFramePrompt: finalStart,
      endFramePrompt: finalEnd,
    }
    return shot
  })

  // 折叠「相邻、念同一句台词 + 同 prompt」的重复镜：LLM 偶发把同一段戏拆出两条几乎
  // 一样的分镜（用户反馈「前后拆解重复台词」）。**保守起见只在 dialogueText 非空且
  // 完全相同时**才折叠（重复念白是最可靠的「重复镜」信号）——避免把仅 prompt 凑巧
  // 相同、但其实是不同节奏的镜误删。只折叠相邻项；折叠后重排 order + 重签 id 保持连续。
  const norm = (s?: string): string => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
  const deduped: Shot[] = []
  for (const s of mapped) {
    const prev = deduped[deduped.length - 1]
    const dt = norm(s.dialogueText)
    if (
      prev &&
      dt !== '' &&
      norm(prev.dialogueText) === dt &&
      norm(prev.prompt) === norm(s.prompt)
    ) {
      warnings.push(`${s.id} 与上一镜念同一句台词且 prompt 相同，已折叠去重`)
      continue
    }
    deduped.push(s)
  }
  return deduped.map((s, i) => ({
    ...s,
    order: i,
    id: shotId(i),
  }))
}

/**
 * 镜数范围约束 —— v4 「少而长」范式：单镜可承载一段 ≤15s 的完整戏，
 * 所以下限降到 **1**（≤15s 的场景就该一镜到底），上限放到 12（超长戏才需要）。
 * 作者强调：NEVER 把一场戏切成一堆 5s 碎镜。
 */
export function clampShotCount(n: number): number {
  if (!Number.isFinite(n)) return 1
  return Math.max(1, Math.min(12, Math.round(n)))
}

/**
 * 按 sceneDurationSec 分档给出一个"合理的默认镜数"（少而长）。
 * 与 storyboard-director.skill.md「核心规则 1」表一致 —— 修改时两边必须同步。
 *
 * 边界（仅下限参考，LLM 可按戏的密度 ±2 浮动）：
 *   ≤15s → 1 镜；≤30s → 2；≤45s → 3；≤60s → 4；>60s → ⌈总时长 ÷ 13⌉
 * 最终仍会经过 clampShotCount 夹到 [1,12]。
 *
 * 单镜上限 15s，所以这是「时长 / 13」的保底镜数（留 buffer 给压缩的过渡拍）。
 *
 * 纯函数，方便测试。
 */
export function computeShotQuota(sceneDurationSec: number): number {
  const s = Math.max(1, Math.round(sceneDurationSec))
  let n: number
  if (s <= 15) n = 1
  else if (s <= 30) n = 2
  else if (s <= 45) n = 3
  else if (s <= 60) n = 4
  else n = Math.ceil(s / 13)
  return clampShotCount(n)
}

/**
 * 把外部传入的 sceneDurationSec 夹到合法范围：
 *   - 缺省 / NaN / 负数 → 60 秒默认
 *   - 超过 300 秒 → 夹到 300（AI 不适合规划 5 分钟以上的连续戏）
 *   - 小于 5 秒 → 夹到 5
 */
export function sanitizeSceneDuration(n?: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return 60
  return Math.max(5, Math.min(300, Math.round(n)))
}

function normalizeFraming(raw?: string): ShotFraming {
  if (!raw) return 'medium'
  const s = raw.trim().toLowerCase().replace(/[\s_-]/g, '')
  if (
    s === 'wide' ||
    s === 'longshot' ||
    s === 'long' ||
    s === 'establishing' ||
    s === 'establishingshot' ||
    s === 'full' ||
    s === 'fullshot' ||
    s === 'extremelong' ||
    s === 'extremelongshot'
  )
    return 'wide'
  if (
    s === 'close' ||
    s === 'closeup' ||
    s === 'bigcloseup' ||
    s === 'extremecloseup'
  )
    return 'close'
  if (s === 'insert' || s === 'detail' || s === 'macro') return 'insert'
  if (s === 'ots' || s === 'overtheshoulder') return 'ots'
  if (s === 'pov' || s === 'pointofview' || s === 'firstperson') return 'pov'
  return 'medium'
}

function normalizeBokeh(raw?: string): Shot['bokehState'] {
  if (!raw) return undefined
  const s = raw.trim().toLowerCase()
  if (s === 'sharp' || s === 'clear' || s === '清晰') return 'sharp'
  if (s === 'blurred' || s === 'blur' || s === '模糊') return 'blurred'
  if (s === 'dynamic' || s === 'moving' || s === '动态') return 'dynamic'
  return undefined
}

/**
 * 时长夹值 —— v3.8 放开档位约束。
 *
 * 以前：只允许 5 / 10（Seedance 原生档位）→ 跟不上 1s 快切和 30s 长镜的叙事需要
 * 现在：
 *   - 允许任意正整数秒 1..60
 *   - 非数字 / NaN / ≤0 → undefined（不强加）
 *   - 小数四舍五入到整数秒（模型 API 只吃整数）
 *   - >60s 夹到 60s（单 shot 不应超过 1 分钟；超长叙事靠**多 shot**而非一个 shot 无限长）
 *
 * 是否要拆成多段视频是 `forgeVideoPlan + modelCapabilities` 的事，
 * 这里**不做物理拆分判断**——把决策留给 Planner 层。
 */
function clampDurationSec(n?: number): number | undefined {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return undefined
  // seedance 视频单镜合法时长 [4,15]s —— 每镜=一段视频片段，低于 4s 会被模型拒
  //   (InvalidParameter ... in t2v)，高于 15s 也不支持。同时 4s 起也避免时间轴
  //   站位条太短(作者反馈"都太短了")。LLM 给的过短/过长值一律吸附到区间内。
  return Math.max(4, Math.min(15, Math.round(n)))
}

/** 中文朗读速度估计（与 realignDialogue 一致）：每字约 240ms。 */
const READ_MS_PER_CHAR = 240
/** 每行台词之间的小停顿（呼吸/换气）。 */
const READ_LINE_GAP_MS = 120
/** 镜头收尾余量（最后一句读完到切镜的缓冲）。 */
const READ_TAIL_PAD_MS = 600

/**
 * 估算一段 `dialogueText` 自然朗读所需的秒数（向上取整）。
 *   - 逐行计字（剥掉「角色名：」前缀，只算真正要念的内容）。
 *   - 每行字数 × READ_MS_PER_CHAR + 行间停顿 + 收尾余量。
 * 用于给镜头时长兜底：长台词不能被压到读不完。无台词返回 undefined。
 */
function dialogueReadingSec(dialogueText?: string): number | undefined {
  if (!dialogueText) return undefined
  const lines = dialogueText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length === 0) return undefined
  let ms = 0
  for (const line of lines) {
    // 去掉「角色名：」/「角色名:」前缀，只数实际念白字数
    const spoken = line.replace(/^[^：:]{1,12}[：:]\s*/, '')
    ms += spoken.length * READ_MS_PER_CHAR + READ_LINE_GAP_MS
  }
  ms += READ_TAIL_PAD_MS
  return Math.ceil(ms / 1000)
}

function stringOr(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}
function numOr(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}
function trimOrUndef(v?: string): string | undefined {
  if (!v) return undefined
  const t = v.trim()
  return t ? t : undefined
}
