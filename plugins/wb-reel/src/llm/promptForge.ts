import type { OrphanInfo } from '../scenario/reconnectOrphans'
import type { Scene, Scenario } from '../scenario/types'
import {
  buildReconnectPrompt,
  parseReconnectSuggestions,
  type ReconnectSuggestion,
} from '../scenario/aiReconnect'
import { parseJSONLoose } from './parseJSONLoose'
import { SKILLS } from './skills'
import type { TextClient } from './types'
import { streamOrFallback } from './types'

/**
 * Prompt Forge —— Opus 4.6 的「提示词工坊」入口
 *
 * 设计宪法（重要，未来改动前请先读）：
 *
 *   1. **不**在这里写"程序化拼接的中文 systemPrompt 字符串"。
 *      所有 systemPrompt 都来自 `skills/*.skill.md` —— 让它们独立于代码、
 *      可被作者直接编辑、可被 git diff 追踪美学演进。
 *
 *   2. 这个文件只做四件事：
 *        a) 读取对应 skill 作为 systemPrompt
 *        b) 把作者意图 / 上下文塞进 user prompt
 *        c) 设置温度 / token 数 / json 模式
 *        d) 解析模型输出 + 兜底
 *
 *   3. 任何"输出格式（JSON schema 之类）"都贴在 user prompt 里，**不**塞进 skill。
 *      理由：skill 是"美学指南"，schema 是"通信协议"。两者解耦。
 *
 *   4. 涉及 secret 的字段一律不进入 skill 文本、不进入日志。
 *      （我们这里实际上没有跟 secret 打交道，但当 future 加 webhook 时记住。）
 */

// ============================================================================
// 1. 画面提示词锻造（cinema-image-prompt skill）
// ============================================================================

export interface ForgeImagePromptArgs {
  intent: string
  /** 整体故事上下文，可选；让画面与剧情语气对齐 */
  storyContext?: string
  /** 角色一致性锚点（拼到上下文里给模型参考） */
  characters?: { name: string; prompt: string }[]
  /** 全局 UI 风格 */
  uiStyle?: string
  /** 作者额外风格偏好（"赛博朋克 / 民国手绘 / ..."） */
  style?: string
  /**
   * 作者指定的镜头景别 —— v3.9.5 新增。
   *
   * 由 SCENE tab 的"镜头景别"chips 选中后注入。喂给 skill 一段景别指令
   * （例如 "全景 WIDE"），让输出 prompt 含明确的景别措辞。
   * 不填 = 由 LLM 根据画面意图自行判断（旧行为）。
   */
  framing?: string
}

export interface ForgeImagePromptResult {
  prompt: string
  raw: string
}

export async function forgeImagePrompt(
  llm: TextClient,
  args: ForgeImagePromptArgs,
): Promise<ForgeImagePromptResult> {
  const user = composeImageUserPrompt(args)
  const raw = await llm.generate({
    systemPrompt: SKILLS.cinemaImagePrompt,
    userPrompt: user,
    temperature: 0.85,
    maxTokens: 480,
  })
  return { prompt: cleanupPrompt(raw), raw }
}

function composeImageUserPrompt(args: ForgeImagePromptArgs): string {
  const blocks = [
    args.storyContext ? `【故事上下文】\n${args.storyContext}` : null,
    args.characters && args.characters.length > 0
      ? `【出场角色 · 一致性锚点】\n${args.characters
          .map((c) => `- ${c.name}：${c.prompt}`)
          .join('\n')}`
      : null,
    args.uiStyle ? `【全局 UI 风格】\n${args.uiStyle}` : null,
    args.style ? `【风格偏好】${args.style}` : null,
    args.framing ? `【镜头景别】${args.framing}（请在输出中自然使用该景别的术语）` : null,
    `【作者意图】\n${args.intent}`,
    '',
    '请按 skill 中"输出契约"直接输出最终画面提示词，单段 80-150 字。',
  ]
  return blocks.filter(Boolean).join('\n\n')
}

// ============================================================================
// 2. 视频提示词锻造（cinema-video-prompt skill）—— 新增
// ============================================================================

export interface ForgeVideoPromptArgs {
  /** 该场景已有的画面提示词（image prompt） —— 视频要"继承画面，再补动作" */
  scenePrompt: string
  /** 作者写的运动 / 动作意图 */
  motion: string
  /** 视频时长（秒），通常 5-15 */
  durationSec?: number
  /** 角色一致性锚点 */
  characters?: { name: string; prompt: string }[]
  /** 是否要保留 UI（互动影游中通常 yes） */
  keepUI?: boolean
}

export interface ForgeVideoPromptResult {
  prompt: string
  raw: string
}

export async function forgeVideoPrompt(
  llm: TextClient,
  args: ForgeVideoPromptArgs,
): Promise<ForgeVideoPromptResult> {
  const dur = args.durationSec ?? 8
  const blocks = [
    `【场景画面（已确定，视频需在此基础上推进时间）】\n${args.scenePrompt}`,
    args.characters && args.characters.length > 0
      ? `【出场角色 · 一致性参考标签】\n${args.characters
          .map((c) => `- ${c.name}：${c.prompt}`)
          .join('\n')}`
      : null,
    `【作者动作意图】\n${args.motion}`,
    `【时长】${dur} 秒（视频生成模型：seedance / sora 兼容）`,
    args.keepUI
      ? '【UI 约束】保持游戏 UI 在画面中，每镜头都重申"图1/参考标签"以保一致'
      : null,
    '',
    '请按 skill 中"输出契约"，给出含**时间码**（[0 秒]、[3 秒]…）的视频提示词。',
    '若总时长超过 8 秒，**必须**至少给出 2-3 个时间分段。',
    '直接输出最终提示词原文，不要 markdown、不要任何元话语。',
  ]
  const user = blocks.filter(Boolean).join('\n\n')

  const raw = await llm.generate({
    systemPrompt: SKILLS.cinemaVideoPrompt,
    userPrompt: user,
    temperature: 0.9,
    maxTokens: 1400,
  })
  return { prompt: cleanupVideoPrompt(raw), raw }
}

// ============================================================================
// 3. 台词草稿锻造（dialogue-craft skill）
// ============================================================================

export interface ForgeDialogueArgs {
  scene: Pick<Scene, 'title' | 'media' | 'durationMs'>
  beat: string
  protagonist?: string
  storyContext?: string
}

export interface ForgeDialogueResult {
  lines: { role: 'narration' | 'protagonist' | 'character'; speaker?: string; text: string }[]
  raw: string
}

export async function forgeDialogue(
  llm: TextClient,
  args: ForgeDialogueArgs,
): Promise<ForgeDialogueResult> {
  const blocks = [
    args.storyContext ? `【故事上下文】\n${args.storyContext}` : null,
    `【场景标题】${args.scene.title}`,
    args.protagonist ? `【主角】${args.protagonist}` : null,
    `【节拍意图】\n${args.beat}`,
    '',
    '请按 skill 中"输出契约"返回 JSON，2-5 行，少而精。',
  ]
  const user = blocks.filter(Boolean).join('\n\n')

  const raw = await llm.generate({
    systemPrompt: SKILLS.dialogueCraft,
    userPrompt: user,
    temperature: 0.9,
    maxTokens: 800,
    jsonMode: true,
  })

  let lines: ForgeDialogueResult['lines'] = []
  try {
    const parsed = JSON.parse(raw) as {
      lines?: { role?: string; speaker?: string; text?: string }[]
    }
    lines = (parsed.lines ?? [])
      .map((l) => ({
        role: normalizeRole(l.role),
        speaker: l.speaker || undefined,
        text: (l.text ?? '').trim(),
      }))
      .filter((l) => l.text.length > 0)
  } catch (e) {
    console.warn('[promptForge] forgeDialogue parse failed:', e)
  }
  return { lines, raw }
}

// ============================================================================
// 4. 整剧本锻造（scenario-architect skill）—— 一句话 → 完整剧本树
// ============================================================================

export interface ForgeScenarioArgs {
  idea: string
  /** 期望场景数量（含结局），默认 5 */
  sceneCount?: number
  /** 期望角色数量，默认 2-3 */
  characterCount?: number
}

export interface ForgeScenarioResult {
  scenario: Scenario
  raw: string
  warnings: string[]
}

/**
 * 锻造过程中要对 UI 发的"阶段事件"。
 * 给 ForgeChatPanel 的 PendingBubble 串列表用，让作者看到"他在做什么"。
 *
 *   - stage:  一条离散里程碑（"调用 Claude"、"解析 JSON"、"完成"）
 *   - delta:  流式 LLM 文本增量（仅 streaming mode 下出）
 */
export type ForgeProgress =
  | { kind: 'stage'; label: string; detail?: string }
  | { kind: 'delta'; delta: string; cumulative: string }

export interface ForgeScenarioStreamOpts {
  onProgress?: (ev: ForgeProgress) => void
  signal?: AbortSignal
}

export async function forgeScenarioFromIdea(
  llm: TextClient,
  args: ForgeScenarioArgs,
  opts: ForgeScenarioStreamOpts = {},
): Promise<ForgeScenarioResult> {
  const sceneCount = args.sceneCount ?? 5
  const characterCount = args.characterCount ?? 3

  const schemaBlock = buildScenarioSchemaBlock({ sceneCount, characterCount })
  const user = `【作者想法】\n${args.idea}\n\n${schemaBlock}\n\n请输出 JSON。`

  opts.onProgress?.({
    kind: 'stage',
    label: '调用模型',
    detail: `${llm.getProviderName()} · ${llm.getModel()} · 流式`,
  })

  // ─────────────────────────────────────────────────────────────────────
  // 输出 token 预算：与 forgeScenarioFromScript 同一档（32000）。
  //
  // 作者 2026-05-07 反馈："maxOutputTokens=7000 截断，已生成 8232 字符"。
  //   根因：7000 对中文整棵剧本树（5 场景 + 3 角色的完整 JSON 结构 + 台词 +
  //   prompt 字段）远远不够，更何况 Gemini 3.x forced-thinking 还要预先
  //   吞掉一部分 thought tokens。直接对齐 forgeScenarioFromScript 的 32000。
  //   Claude Opus / Gemini 3.x / Claude Sonnet 的非流式输出上限均 ≥ 32K，
  //   不会超硬限制；即使模型端有更低的软上限（如 Gemini 2.5 的 8192），
  //   也好过 7000 —— 超过部分会由 provider 报 MAX_TOKENS 让 caller 感知。
  // ─────────────────────────────────────────────────────────────────────
  const MAX_TOKENS = 32000
  const raw = await streamOrFallback(
    llm,
    {
      systemPrompt: SKILLS.scenarioArchitect,
      userPrompt: user,
      temperature: 0.85,
      maxTokens: MAX_TOKENS,
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
          label: '模型输出完成',
          detail: `${ev.full.length} 字 · ${ev.latencyMs}ms`,
        })
      }
    },
    opts.signal,
  )

  opts.onProgress?.({ kind: 'stage', label: '解析 JSON' })

  const warnings: string[] = []
  const parsed = parseJSONLoose(raw)
  if (!parsed) {
    throw new Error('[PARSE] 模型未返回合法 JSON · raw=' + raw.slice(0, 200))
  }

  opts.onProgress?.({ kind: 'stage', label: '构建剧情树' })
  const scenario = normalizeScenario(parsed, args.idea, warnings)
  return { scenario, raw, warnings }
}

// ============================================================================
// 4b. 已有剧本锻造（scenario-architect skill）—— 长文本/md → 完整剧本树
// ============================================================================

export interface ForgeScriptArgs {
  /** 作者贴进来的整段剧本（md 或纯文本，已经经过 loadScriptFile 校验） */
  script: string
  hint?: {
    /** 期望切成多少场景节点；不填则交给模型自行判断（典型 4-8） */
    sceneCount?: number
    /** 期望识别多少角色；不填默认 3 */
    characterCount?: number
  }
}

/**
 * 把作者**已写好的完整剧本**翻译成引擎可读的 Scenario JSON。
 *
 * 与 idea 模式（`forgeScenarioFromIdea`）的**根本区别**：
 *
 *   - idea 模式 = 创作（scenarioArchitect skill）：从一句话扩展整树，模型有自由
 *   - script 模式 = **结构化提取**（scriptStructurer skill）：模型是翻译器不是编剧
 *
 * 历史 bug：早期版本两条路共用了创作型 skill，导致 LLM 在 script 模式下
 * 自由二创（重写台词、补场景、改情节、强行规整成 4-7 场）。修法是：
 *
 *   1. 专用 `script-structurer.skill.md`，宪法第一条就是"绝对忠于原文"
 *   2. 本函数 directives 里写满"禁止补充 / 禁止改写 / 原文一字不改"
 *   3. 不再把 hint.sceneCount/characterCount 当硬约束，只作"参考"
 *   4. temperature 调到 0.3 让输出确定性高
 *
 * 输出形状仍与 idea 模式同源 —— 用同一份 `buildScenarioSchemaBlock`，
 * 这样 normalizeScenario 一套覆盖。
 */
export async function forgeScenarioFromScript(
  llm: TextClient,
  args: ForgeScriptArgs,
  opts: ForgeScenarioStreamOpts = {},
): Promise<ForgeScenarioResult> {
  // hint 仅作"参考"提示，不做硬约束 —— 这是修复"被强行规整"的关键
  const hintScene = args.hint?.sceneCount
  const hintChar = args.hint?.characterCount

  // schema 段附"忠于原文"侧注，避免模型把字段示例当成"应当填什么"
  const schemaBlock = buildScriptSchemaBlock()
  const script = args.script.trim()

  const hintLine =
    hintScene || hintChar
      ? `【参考（仅提示，不强制）】作者建议约 ${hintScene ?? '?'} 场景 / ${hintChar ?? '?'} 角色 —— 但**以原文为准**，原文 12 场就给 12 场。\n\n`
      : ''

  // 三引号包原文：避免剧本里的 { } [ ] 与下方 JSON Schema 段混淆
  const directives = `【任务】下方 """..."""里是作者**已经写好**的完整剧本。
你的**唯一**任务是把它**抽取**成 JSON 数据结构 —— **绝对忠于原文，一字不改**。

【强制约束 · 违反任意一条都视为失败】
- 原文一字不改 —— dialogue.text 必须**逐字保留**作者写的台词，不准润色
- 不得补充新场景 —— 原文有几幕就几幕；原文跳跃就让它跳跃，**不要**自加"过渡场景"
- 不得创作新台词 —— 原文没写的旁白/对白，**绝不**凭空生成
- 不得新增分支 —— 仅在原文**显式**写了"敲，还是不敲？"、"她可以..."这类选择文字时配 \`branches[choice]\`；
                   找不到选择文字 → 全部用 \`branches: [{ "kind": "auto", "label": "", "targetSceneId": "<下一场>" }]\`
- 不得新增 QTE —— 仅在原文**明确**写了动作动词 + 紧迫感时配；其他场景 \`qte: null\`
- 不得改名字 / 不得改顺序 / 不得改结局数 / 不得换风格

【可以做的事 · 抽取 / 映射】
- 场景边界依据原文转折（章节标题、第 X 幕、地点/时间切换）—— 原文怎么分你就怎么分
- 角色识别：从对白前缀（"他："、"老王："）和叙事称谓抽，外观提示词**只能从原文已有描述里抽**，没写就给空字符串
- 对白归属：原文的引号/冒号台词 → role 选 \`character\`/\`protagonist\`；叙事文字 → \`narration\`
- prompts.scene：直接复述原文的环境描写（雨、烛火、地铁站台），**不补充**；原文没写就给空字符串 \`""\`
- prompts.video / prompts.ui：原文没写就**留空字符串**，让作者后期补
- 时长 startMs/endMs：原文标了时间就用原文，没标就按"每行台词字数 × 200ms"顺势排

${hintLine}【作者剧本（一字不改地抽取）】
"""
${script}
"""`

  const user = `${directives}\n\n${schemaBlock}\n\n请输出 JSON。**记住：抽取，不创作。**`

  // ─────────────────────────────────────────────────────────────────────
  // 输出 token 预算 = 32000（Claude Opus 4.6 非流式输出上限）
  //
  // 真实 bug 现场：5022 字剧本 / maxTokens=8000 →
  //   输出跑到 characters 第 6 个角色的 prompt 中间就断了，
  //   根本没轮到 scenes 字段 → parseJSONLoose 拿到截断 JSON →
  //   prefix 段虽然合法（title/synopsis/characters），但 scenes 缺失 →
  //   [EMPTY] 错。
  //
  // 中文输出 token 估算（保守）：1 中文字 ≈ 1.3-1.5 token；JSON 转义 + schema
  // 字段名 + 重复结构 ≈ 1.5x 膨胀 → 5K 字剧本完整结构化输出 ≈ 12-15K token。
  // 32000 给 ~10K 字剧本留充裕余量；超过 ~15K 字才需要分段方案。
  // ─────────────────────────────────────────────────────────────────────
  const MAX_TOKENS = 32000
  opts.onProgress?.({
    kind: 'stage',
    label: '调用模型',
    detail: `${llm.getProviderName()} · ${llm.getModel()} · 流式 · 剧本 ${script.length} 字`,
  })
  const raw = await streamOrFallback(
    llm,
    {
      systemPrompt: SKILLS.scriptStructurer,
      userPrompt: user,
      temperature: 0.3,
      maxTokens: MAX_TOKENS,
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
          label: '模型输出完成',
          detail: `${ev.full.length} 字 · ${ev.latencyMs}ms`,
        })
      }
    },
    opts.signal,
  )

  opts.onProgress?.({ kind: 'stage', label: '解析 JSON' })

  const warnings: string[] = []
  const parsed = parseJSONLoose(raw)
  if (!parsed) {
    throw new Error('[PARSE] 模型未返回合法 JSON · raw=' + raw.slice(0, 200))
  }

  // ─────────────────────────────────────────────────────────────────────
  // **关键守门**：早期 bug —— LLM 返回 `{scenes:[]}` 或 scene 全部缺 id 时，
  // normalizeScenario 会塞一个 title:'01 · 序章' 的占位 stub，UI 直接覆盖
  // 原剧本，作者只看到一个孤独的空节点，完全不知道 LLM 到底返了什么。
  //
  // 修法：script 模式下显式拒绝"空场景结果"，把 raw 头部贴在错信里供调试。
  // ─────────────────────────────────────────────────────────────────────
  const parsedShape = parsed as { scenes?: unknown[] }
  const sceneArr = Array.isArray(parsedShape.scenes) ? parsedShape.scenes : []
  const validScenes = sceneArr.filter(
    (s): s is { id: string } =>
      !!s && typeof (s as { id?: unknown }).id === 'string' && (s as { id: string }).id.length > 0,
  )
  if (validScenes.length === 0) {
    // 诊断：raw 末尾是否疑似被截断（不闭合 JSON / 中字段中间）
    const rawTrim = raw.trim()
    const trailing = rawTrim.slice(-40)
    const looksTruncated =
      !rawTrim.endsWith('}') &&
      !rawTrim.endsWith('```') &&
      // 末尾是字符串中间（典型截断特征：以中文/字母字符结尾，不是结构符）
      /[\u4e00-\u9fa5a-zA-Z0-9]$/.test(trailing)

    throw new Error(
      `[EMPTY] 模型未返回任何有效场景（共 ${sceneArr.length} 个 scene 项，0 个含合法 id）。\n` +
        `输入剧本 ${script.length} 字 · maxTokens=${MAX_TOKENS}。\n` +
        (looksTruncated
          ? `**疑似被 LLM 输出 token 截断**（raw 末尾不闭合：…"${trailing}"）。\n` +
            `→ 解决：① 把剧本按章节切成多段，分批 forge 后合并；② 或者跳过此剧本，从「想法」模式重写。\n`
          : `常见原因：① prompt 触发安全过滤；② 模型偷懒只返了角色没返场景；③ schema 太复杂。\n`) +
        `打开 DevTools Console 看 ClaudeAzureProvider 行：stop=max_tokens 即被截断、stop=end_turn 即模型自己停了。\n` +
        `raw=${raw.slice(0, 800)}`,
    )
  }

  // originIdea 兜底为原剧本前 200 字 —— 给「来源回显」UI 用
  const originIdea = script.slice(0, 200)
  opts.onProgress?.({ kind: 'stage', label: '构建剧情树' })
  const scenario = normalizeScenario(parsed, originIdea, warnings)

  // 二次守门：normalize 走完后场景仍为 0 / 唯一一个是兜底 stub —— 也抛错
  // （理论上前面已经挡住了；这里是 belt-and-suspenders）
  const finalCount = Object.keys(scenario.scenes).length
  const onlyOne = finalCount === 1 ? Object.values(scenario.scenes)[0] : null
  if (
    finalCount === 0 ||
    (onlyOne && onlyOne.title === '01 · 序章' && onlyOne.dialogue.length === 0)
  ) {
    throw new Error(
      `[EMPTY] 解析后场景为空或仅剩兜底 stub —— LLM 输出可能不完整。\nraw=${raw.slice(0, 800)}`,
    )
  }

  return { scenario, raw, warnings }
}

// ============================================================================
// 4c. 剧本结构整理（script-curator skill）—— 乱排剧本 → 干净 Markdown
//
//   P2 路径专用：作者贴的剧本里混了表格、HTML 残留、段落乱断、标题层级混用，
//   下游的 scriptStructurer 会读错；先用 curator 整理一遍**结构**（不动内容），
//   再把整理后的纯文本喂给 forgeScenarioFromScript。
//
//   设计原则（与 scriptStructurer 一脉相承）：
//     - **保守**：宁可少整理，不要多创作。能不动就不动。
//     - **结构 ≠ 内容**：只允许动段落边界、标题层级、表格转散文这些"框架"层面；
//       任何故事性文字（台词、动作、人名、地点、时间）都一字不改。
//     - **可审阅**：输出是纯 Markdown 文本，UI 用 side-by-side diff 给作者看
//       "我动了哪里"，作者可接受 / 回退到原文 / 退回 P1 直跑。
//     - **温度极低**（0.2）：整理是确定性任务，不要发挥。
// ============================================================================

export interface ForgeCuratedScriptArgs {
  /** 作者贴进来的原始剧本文本 */
  script: string
  /** 来自 detectScriptShape 的提示，用作 prompt 里的"诊断速记" */
  hints?: {
    /** 检测到的剧本形态（structured-script / mixed-with-tables / prose-novel / ...） */
    kind?: string
    /** 检测器列出的人话原因，让 LLM 知道"作者认为它哪里乱" */
    reasons?: string[]
  }
}

export interface ForgeCuratedScriptResult {
  /** 整理后的 Markdown 文本（已 cleanup，去掉了 ``` 围栏 / 元话语） */
  curated: string
  /** 模型原始输出，便于 debug */
  raw: string
  /** 原文长度 / 输出长度，UI 上提示"动了多少" */
  stats: {
    originalLength: number
    curatedLength: number
    /** 输出 / 原文 长度比；明显 < 0.6 多半是删了内容（被禁止），UI 应当告警 */
    ratio: number
  }
}

/**
 * 把乱排剧本整理成干净的 Markdown，**不改一个故事字**。
 *
 * 与 forgeScenarioFromScript 的关系：
 *   - 这个函数输出**纯文本**（Markdown），不输出 JSON
 *   - 输出会作为下一轮 forgeScenarioFromScript 的输入
 *   - 但中间作者要能 review/diff/拒绝（UI 层 ScriptCurateReview 处理）
 *
 * 失败模式：
 *   - 模型偷懒只输出"整理后的剧本如下"一句开场白 → cleanup 会去掉前缀但若全是元话语会
 *     在 stats.ratio 上看到 < 0.3 的异常值，调用方应当抛错或 fallback 到原文。
 *   - 模型输出膨胀（润色 / 二创）→ stats.ratio > 1.3 也是异常，UI 警告作者审慎接受。
 */
export async function forgeCuratedScript(
  llm: TextClient,
  args: ForgeCuratedScriptArgs,
  opts: ForgeScenarioStreamOpts = {},
): Promise<ForgeCuratedScriptResult> {
  const script = args.script.trim()
  if (!script) {
    throw new Error('[CURATE] 输入剧本为空')
  }

  const reasonLine =
    args.hints?.reasons && args.hints.reasons.length > 0
      ? `【检测器诊断】（仅供你判断"哪里乱"，不要把这些字塞进输出）\n- ${args.hints.reasons.join('\n- ')}\n`
      : ''
  const kindLine = args.hints?.kind ? `【输入形态判定】${args.hints.kind}\n` : ''

  // 三引号包原文：剧本里若有 { } [ ] 不会与上方 directives 混淆
  const directives = `${kindLine}${reasonLine}
【任务】下方 """..."""里是作者贴进来的剧本，结构上有点乱（可能含表格、PDF 段落断行、标题层级混用、HTML 残留等）。
你的**唯一**任务是把它整理成**结构干净的 Markdown**，**故事内容一字不改**。

【铁律 · 违反任意一条都视为失败】
- 故事性文字（台词、人名、地点、动作描写、时间标记）→ **一字不改**
- 不补任何"过渡段"、"心理描写"、"环境烘托"
- 不删任何故事性信息（包括歧义内容、口语错字）
- 不改任何顺序
- 不要在输出里加"以下是整理后的版本"之类的元话语
- 不要给整理结果套上 \`\`\` 围栏（输出是 Markdown 剧本，不是代码块）

【你能做的事】
- 修复 PDF 复制黏贴造成的"句子被换行打断"
- 把表格剧情按"时间—动作—台词"自然顺序展开为散文段落，**保留每一个故事性的字**
- 统一标题层级为 \`## 第 X 幕 · <原文标题文字>\`（标题文字必须是原文的字）
- 统一对白前缀为 \`角色名：「台词」\`（台词内容字字保留）
- 删除排版噪音：连续多空行压成一空行；HTML 残留标签删但保留里面文字；Markdown 装饰符号 \`**\` \`__\` 删除

【作者剧本（结构整理，内容不改）】
"""
${script}
"""`

  const user = `${directives}\n\n请直接输出整理后的 Markdown 剧本原文（不要 \`\`\` 围栏，不要任何说明性前后语）。`

  // ─────────────────────────────────────────────────────────────────────
  // maxTokens：与原文长度同档 + 余量。中文 1 字 ≈ 1.3-1.5 token，整理通常
  // 长度 ≈ 原文，但表格转散文可能稍涨；给 2x 估算。封顶 32000 防上限。
  // ─────────────────────────────────────────────────────────────────────
  const estimateTokens = Math.ceil(script.length * 2.0)
  const MAX_TOKENS = Math.min(32000, Math.max(2000, estimateTokens))

  opts.onProgress?.({
    kind: 'stage',
    label: '调用模型',
    detail: `${llm.getProviderName()} · ${llm.getModel()} · 整理 · 剧本 ${script.length} 字`,
  })

  const raw = await streamOrFallback(
    llm,
    {
      systemPrompt: SKILLS.scriptCurator,
      userPrompt: user,
      // 整理任务是确定性活，温度压到 0.2 减少"发挥"
      temperature: 0.2,
      maxTokens: MAX_TOKENS,
      // 输出是 Markdown 文本，非 JSON
      jsonMode: false,
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
          label: '模型输出完成',
          detail: `${ev.full.length} 字 · ${ev.latencyMs}ms`,
        })
      }
    },
    opts.signal,
  )

  const curated = cleanupCuratedMarkdown(raw)
  const stats = {
    originalLength: script.length,
    curatedLength: curated.length,
    ratio: script.length === 0 ? 0 : Number((curated.length / script.length).toFixed(3)),
  }

  // 守门：明显删内容（< 60% 长度）→ 抛错让调用方决定是否 fallback 原文
  if (stats.ratio < 0.6) {
    throw new Error(
      `[CURATE_SHRUNK] 整理后长度只剩原文 ${(stats.ratio * 100).toFixed(0)}%，疑似 LLM 删内容。\n` +
        `原文 ${stats.originalLength} 字 → 整理后 ${stats.curatedLength} 字。\n` +
        `建议：① 直接用原文走 P1 直跑；② 重试 curate；③ 看 raw 确认是否被截断（raw 末尾：${raw.slice(-80)}）。`,
    )
  }

  return { curated, raw, stats }
}

/**
 * curated Markdown 的清洗：
 *   - 去掉首尾 ``` 围栏（即便 prompt 里说了不要也得防一手）
 *   - 去掉常见的元话语前言（"以下是整理后的剧本："）
 *   - 不去掉换行（保留 Markdown 段落结构）
 */
function cleanupCuratedMarkdown(raw: string): string {
  let s = raw.trim()
  // 去 ``` 围栏（行首 / 行尾各一次）
  s = s.replace(/^```[a-z0-9-]*\s*\n?/i, '')
  s = s.replace(/\n?```\s*$/i, '')
  // 去常见元话语前言（最多去一行）
  s = s.replace(/^(以下是|这是|下面是)?(整理后的|整理|清理后的)[^\n]{0,40}[:：]\s*\n+/, '')
  // 压缩 3+ 连续空行为 2 行（保留段落分隔）
  s = s.replace(/\n{3,}/g, '\n\n')
  return s.trim()
}

// ============================================================================
// P3 路径 · forgeProseToBeats —— 散文/小说原文 → beats 清单
//
// 与 idea 模式 forgeOutlineFromIdea 的关键差异：
//   - idea 是"无中生有"：温度高、鼓励发散
//   - prose-to-beats 是"忠于原文"：温度低、每个 beat 必须带原文 quote 可审计
//   - 字段名从 acts → beats，是有意的 —— 跟下游 OutlineAct 形状兼容（id/title/beat），
//     但多一个 quote 字段。当作者点"接受"后，UI 层负责把 beats 当 acts 喂进 forgeScriptFromOutline。
// ============================================================================

export interface ProseBeat {
  /** beat_01 / beat_02 / ... */
  id: string
  /** 4-8 字短标题 */
  title: string
  /** 30-80 字一句话节拍 */
  beat: string
  /**
   * 原文里的逐字摘抄片段（30-200 字），可用「……」省略中段；
   * UI 用它做"可审计"展示——作者一眼能看到这个 beat 是从原文哪个段落抽来的。
   * 后续若进一步严格校验，可在这里做"quote 是否真的存在于原文里"的子串检查（暂未启用）。
   */
  quote: string
}

export interface ProseBeats {
  title: string
  synopsis: string
  tone: string
  protagonist: string
  beats: ProseBeat[]
}

export interface ForgeProseToBeatsArgs {
  /** 作者贴进来的原文 */
  prose: string
  /** 来自 detectScriptShape 的提示，prompt 里当"诊断速记"用 */
  hints?: {
    kind?: string
    reasons?: string[]
  }
}

export interface ForgeProseToBeatsResult {
  beats: ProseBeats
  raw: string
}

/**
 * 从已有散文/小说原文里**抽**出 beats 清单。
 *
 * 与 idea 路径的区别：
 *   - 不创作，只抽取。LLM 必须给每个 beat 一段原文 quote 当审计凭据。
 *   - tone / protagonist 字段允许填 "原文未明示"——而不是逼模型瞎编。
 *
 * 失败模式：
 *   - JSON 解析不出 → [BEATS_PARSE]
 *   - beats 数量 < 3 或 > 6 → [BEATS_COUNT]
 *   - quote 字段全空 → [BEATS_NO_QUOTE]（等价于"模型完全没忠于原文"）
 */
export async function forgeProseToBeats(
  llm: TextClient,
  args: ForgeProseToBeatsArgs,
  opts: ForgeScenarioStreamOpts = {},
): Promise<ForgeProseToBeatsResult> {
  const prose = args.prose.trim()
  if (!prose) {
    throw new Error('[BEATS] 输入原文为空')
  }

  const reasonLine =
    args.hints?.reasons && args.hints.reasons.length > 0
      ? `【检测器诊断】\n- ${args.hints.reasons.join('\n- ')}\n`
      : ''
  const kindLine = args.hints?.kind ? `【输入形态判定】${args.hints.kind}\n` : ''

  const directives = `${kindLine}${reasonLine}
【任务】下方 """..."""里是作者贴进来的散文/小说原文。
你的**唯一**任务是按 skill 中"输出契约"抽出 beats JSON——**不创作、不脑补、不发散**。

【铁律】
- 每个 beat 必须带 quote（原文逐字摘抄连续片段，可用「……」省略中段，但保留段必须一字不差）
- beats 数 3-6（默认 3，依原文复杂度上调）
- beats 顺序 = 原文事件顺序，不倒叙、不重排
- tone / protagonist 字段，原文没明示就老老实实填 "原文未明示"，禁止瞎编

【作者原文】
"""
${prose}
"""`

  const user = `${directives}\n\n请按 skill 中"输出契约"返回 JSON beats 清单（jsonMode 已开，外层不要 markdown 围栏）。`

  // 原文最长 ~30k 字，beats JSON 输出顶天 5k 字 ~ 8k tok。给 12000 留余量。
  const MAX_TOKENS = Math.min(16000, Math.max(2000, Math.ceil(prose.length * 0.4)))

  opts.onProgress?.({
    kind: 'stage',
    label: '调用模型',
    detail: `${llm.getProviderName()} · ${llm.getModel()} · prose→beats · 原文 ${prose.length} 字`,
  })

  const raw = await streamOrFallback(
    llm,
    {
      systemPrompt: SKILLS.proseToBeats,
      userPrompt: user,
      // 抽取任务是"忠于原文"活儿，温度压低：0.3（保留少量措辞灵活，避免极端死板）
      temperature: 0.3,
      maxTokens: MAX_TOKENS,
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
          label: '模型输出完成',
          detail: `${ev.full.length} 字 · ${ev.latencyMs}ms`,
        })
      }
    },
    opts.signal,
  )

  const beats = parseProseBeatsJSON(raw)
  return { beats, raw }
}

/**
 * 解析 LLM 返回的 beats JSON。
 *
 * 抛错分类：
 *   [BEATS_PARSE]    —— JSON 根本解析不出
 *   [BEATS_COUNT]    —— beats 数量不在 3-6 范围
 *   [BEATS_NO_QUOTE] —— 所有 beat 的 quote 字段都为空（LLM 没忠于原文要求）
 */
export function parseProseBeatsJSON(raw: string): ProseBeats {
  let stripped = raw.trim()
  if (stripped.startsWith('```')) {
    stripped = stripped.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  }

  const parsed = parseJSONLoose(stripped)
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(
      `[BEATS_PARSE] beats JSON 无法解析 · raw head=${raw.slice(0, 200)}`,
    )
  }

  const obj = parsed as Record<string, unknown>
  const beatsRaw = Array.isArray(obj.beats) ? (obj.beats as unknown[]) : []
  if (beatsRaw.length < 3 || beatsRaw.length > 6) {
    throw new Error(
      `[BEATS_COUNT] beats 数量 ${beatsRaw.length} 不在 3-6 范围 · raw head=${raw.slice(0, 200)}`,
    )
  }

  const beats: ProseBeat[] = beatsRaw.map((b, i) => {
    const bo = (b ?? {}) as Record<string, unknown>
    const idx = i + 1
    const id =
      typeof bo.id === 'string' && bo.id.trim()
        ? bo.id.trim()
        : `beat_${idx < 10 ? `0${idx}` : String(idx)}`
    return {
      id,
      title: typeof bo.title === 'string' ? bo.title.trim() : `第 ${idx} 幕`,
      beat: typeof bo.beat === 'string' ? bo.beat.trim() : '',
      quote: typeof bo.quote === 'string' ? bo.quote.trim() : '',
    }
  })

  // 至少要有一个 beat 带非空 quote，否则模型完全没忠于原文
  const anyQuote = beats.some((b) => b.quote.length > 0)
  if (!anyQuote) {
    throw new Error(
      `[BEATS_NO_QUOTE] 所有 beat 的 quote 字段都为空，模型未按"必须摘抄原文"约束执行。raw head=${raw.slice(0, 200)}`,
    )
  }

  return {
    title: typeof obj.title === 'string' ? obj.title.trim() : '未命名',
    synopsis: typeof obj.synopsis === 'string' ? obj.synopsis.trim() : '',
    tone: typeof obj.tone === 'string' ? obj.tone.trim() : '原文未明示',
    protagonist:
      typeof obj.protagonist === 'string' ? obj.protagonist.trim() : '原文未明示',
    beats,
  }
}


// ============================================================================
// P4 路径 · forgeImageToStorySeed —— 一张图 → 故事种子（Outline 形态）
//
// 与 P3 prose-to-beats 的差异：
//   - 输入是图片而非文本（依赖 ClaudeAzureProvider 的 vision 能力）
//   - 输出形态直接是 Outline（acts/title/tone/protagonist/synopsis），
//     下游可以**零适配**走 forgeScriptFromOutline → 再 forgeScenarioFromScript。
//   - 温度比 P3 高（0.7）—— 因为 P4 是"看图后顺势创作"，需要适度发散；
//     但又比 idea 模式低，因为 tone/protagonist 必须有图像锚点。
//
// 失败模式：
//   - provider 不支持图（GeminiProvider 等）→ 抛 [MULTIMODAL_NOT_SUPPORTED]，
//     调用方应退到"作者改用文字 idea 模式"。
//   - JSON 解析失败 / acts 为空 → 复用 parseOutlineJSON 的 [OUTLINE_PARSE]/[OUTLINE_EMPTY]
// ============================================================================

export interface ForgeImageToStorySeedArgs {
  /** 一张图的 data URL（base64），由 UI 层从 File / Blob 读出 */
  imageDataUrl: string
  /** 图的人类可读标签（如文件名 "concept.png"），仅用于 debug，不喂 LLM */
  imageLabel?: string
  /**
   * 作者可选附带的一句话提示（"我想要一个赛博朋克的故事" 之类）。
   * 不强制——P4 的核心价值就是"只给图也能起飞"。
   */
  hint?: string
}

export interface ForgeImageToStorySeedResult {
  /** Outline 形态，可直接喂 forgeScriptFromOutline */
  outline: import('./scenarioFlow').Outline
  /** 模型原始返回串（debug / 调试用） */
  raw: string
}

/**
 * 看一张图 → 输出 Outline 故事种子。
 *
 * 调用方约束：
 *   - 必须传一个**支持 vision** 的 TextClient（当前只有 ClaudeAzureProvider）。
 *     如果传错（Gemini 等），错误会从 provider 层冒上来：[MULTIMODAL_NOT_SUPPORTED]。
 *   - imageDataUrl 必须是 base64 data URL；mime 限定 png/jpeg/gif/webp。
 *
 * 输出 Outline 后，UI 层可以走两条路：
 *   - 直接接 forgeScriptFromOutline（与 idea 模式 / P3 的下游路径完全一致）
 *   - 或者展示给作者审一眼，让他改 tone / 调整幕数后再扩写
 */
export async function forgeImageToStorySeed(
  llm: TextClient,
  args: ForgeImageToStorySeedArgs,
  opts: ForgeScenarioStreamOpts = {},
): Promise<ForgeImageToStorySeedResult> {
  const { parseOutlineJSON } = await import('./scenarioFlow')

  if (!args.imageDataUrl || !args.imageDataUrl.startsWith('data:')) {
    throw new Error('[IMAGE_SEED] imageDataUrl 不是合法的 base64 data URL')
  }

  const hintLine = args.hint?.trim()
    ? `\n\n【作者一句话提示（可选辅助，不可替代图像证据）】\n${args.hint.trim()}`
    : ''

  const userPrompt = `【任务】先在脑里默念图里看见了什么，再按 skill 中"输出契约"返回 Outline JSON。

【铁律】
- tone 字段必须明确引用至少一条图像证据（光线 / 色温 / 质感 / 时代感 / 流派）
- protagonist 外观要与图像证据一致；图里没人时，让主角与场景气氛契合
- 不要把图里识别到的文字 / 商标 / 真实人脸搬进 JSON
- acts 数 2-4，默认 3 幕；每 beat 30-80 字
- 整体输出仅一段 JSON，外层不要 markdown 围栏${hintLine}

请按 skill 输出契约返回 Outline JSON（jsonMode 已开）。`

  // vision 任务的输出体量与 idea-outline 等价，给 4000 tok 足够。
  const MAX_TOKENS = 4000

  opts.onProgress?.({
    kind: 'stage',
    label: '调用模型 · 视觉解读',
    detail: `${llm.getProviderName()} · ${llm.getModel()} · image→storyseed`,
  })

  const raw = await streamOrFallback(
    llm,
    {
      systemPrompt: SKILLS.imageToStorySeed,
      userPrompt,
      images: [
        {
          dataUrl: args.imageDataUrl,
          label: args.imageLabel,
        },
      ],
      // 看图后"顺势创作"——比 P3（0.3）高，比 idea 创作（0.95）低。
      temperature: 0.7,
      maxTokens: MAX_TOKENS,
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
          label: '模型输出完成',
          detail: `${ev.full.length} 字 · ${ev.latencyMs}ms`,
        })
      }
    },
    opts.signal,
  )

  // 直接复用 parseOutlineJSON ——产物形状完全一致，下游零适配。
  const outline = parseOutlineJSON(raw)
  return { outline, raw }
}



/**
 * idea 模式专用的 JSON Schema 段（创作型）。
 *
 * **注意**：script 模式有自己的 schema 段（`buildScriptSchemaBlock`），不要在这里改 script 模式
 * 的字段说明 —— 两条路 prompt 已经分家，避免一处改动污染另一处。
 *
 * 输出形状仍然完全一致 → normalizeScenario 一套覆盖。
 */
interface SchemaBlockOptions {
  sceneCount: number
  characterCount: number
}

function buildScenarioSchemaBlock(opts: SchemaBlockOptions): string {
  return `【返回 JSON Schema】
{
  "title": "剧本中文标题",
  "synopsis": "30-80 字简介",
  "uiStyle": { "prompt": "全局 UI 视觉风格提示词，约 40-80 字" },
  "characters": [
    { "id": "char_xxx", "name": "角色名",
      "prompt": "外观气质提示词，约 40-80 字（参考 cinema-image-prompt skill 范例 B 的密度）" }
  ],
  "locations": [
    { "id": "loc_xxx", "name": "<场所中文名（短）>",
      "prompt": "<场所外观提示词，约 50-100 字：建筑/室内外/材质/光线/气氛/时代感。描述空场，不要写具体角色。>" }
  ],
  "props": [
    { "id": "prop_xxx", "name": "<关键道具中文名>",
      "prompt": "<道具外观提示词，约 30-60 字：材质/颜色/形态/标识细节>" }
  ],
  "rootSceneId": "scene_001",
  "scenes": [
    {
      "id": "scene_001",
      "title": "01 · 中文标题",
      "durationMs": 8000,
      "locationId": "loc_xxx",
      "characterIds": ["char_xxx"],
      "background": "本场舞美/氛围速记，不念出来、不上字幕，约 30-80 字（光线、时间、空间、气味、情绪）",
      "prompts": {
        "scene": "场景画面提示词，约 60-120 字（用 cinema-image-prompt 审美；与 background 吻合但不重复）",
        "ui":    "本场 UI 元素附加描述（按钮/字幕条本场色调差异）",
        "video": "视频运动 / 镜头描述，约 30-80 字（用 cinema-video-prompt 审美简化版）"
      },
      "shots": [
        { "id": "sh_01", "order": 0,
          "framing": "wide|medium|close|insert|ots|pov",
          "cameraHint": "可选。运镜/机位/焦段。例：\\"slow dolly-in, low angle, 35mm\\"",
          "prompt": "本镜画面提示词，约 50-100 字，与 background 吻合；点明本镜要看到什么、不要看到什么",
          "characterIds": ["char_xxx"],
          "transitionHint": "与下一镜的衔接（切/叠/划/跟随视线/匹配动作），无则空字符串"
        }
      ],
      "keyShotId": "sh_01",
      "dialogue": [
        { "role": "narration|protagonist|character", "speaker": "可选",
          "text": "（用 dialogue-craft skill 的克制感；**不要**把背景/舞美描述塞到这里，写到 background 去）",
          "startMs": 400, "endMs": 3000 }
      ],
      "qte": null,
      "branches": [
        { "kind": "choice|qte_pass|qte_fail|auto",
          "label": "选项文本",
          "targetSceneId": "scene_002",
          "showAt": 6000 }
      ]
    }
  ]
}

【QTE 形态（仅在关键场景给）】
"qte": {
  "window": { "perfect": 80, "great": 160, "good": 280 },
  "score":  { "perfect": 100, "great": 60, "good": 25, "miss": -30 },
  "passingScore": 200,
  "cues": [
    { "id": "k1", "shape": "tap", "x": 0.5, "y": 0.55,
      "appearAt": 1800, "targetAt": 2600, "label": "敲" }
  ]
}

【硬约束】
- scenes 数 = ${opts.sceneCount}（±1）；characters 数 = ${opts.characterCount}（±1）
- locations：覆盖所有**主要场所**（通常 2-5 个，上限 8）。每个 scene 尽量引用一个 locationId；同一地点不同时间算同一场所
- props：**仅**列出"跨镜头反复出现 + 有身份识别度"的关键道具（信物/武器/徽章/关键文件）；0-6 件上限。普通桌椅门窗不要进
- 必须有 1-2 个 QTE 关键场景 + 至少一次 choice 二选一 + 至少 2 种结局
- branches 全连通：从 rootSceneId 出发可达每个场景；targetSceneId 必须存在
- **每场 shots 数量 2-4 个**：首镜多用 wide/establishing 立空间，末镜收紧或留白便于转场；
  同场内景别与机位要有变化，不要连续三个同景别；
  同 locationId 跨场之间光影/朝向要一致（不要随意改时间/天气）
- **背景描述归位**：舞美/氛围/天气/时间全部写到 scene.background，**不要**混进 dialogue；
  narration 只用于会被念出来、会上字幕的画外旁白
- 不要 markdown、不要 // 注释、不要尾随逗号
- 必须能 \`JSON.parse\` 直接通过`
}

/**
 * script 模式专用 JSON Schema 段。
 *
 * 与 idea 版本相比，差别在**字段说明全部强调"原文一字不改"**，并把硬约束改成**软约束**：
 *   - scenes 数：跟原文章节数；不强求 X±1
 *   - characters 数：跟原文出场角色；不强求
 *   - choice/QTE：原文显式才配，否则全部 auto / qte:null
 *   - 字段空白允许：原文没写就给 ""，绝不用 skill"审美"凭空填
 */
function buildScriptSchemaBlock(): string {
  return `【返回 JSON Schema · script 模式 · 抽取式】
{
  "title": "<原文标题，原文没标就抽前几个字>",
  "synopsis": "<30-80 字简介，**只用原文里的词**总结，不要二创>",
  "uiStyle": { "prompt": "<原文语气/风格关键词；原文没明指就空字符串>" },
  "characters": [
    { "id": "char_xxx", "name": "<原文里出现的称呼>",
      "prompt": "<只从原文已有外观描述抽；找不到给空字符串>" }
  ],
  "locations": [
    { "id": "loc_xxx", "name": "<原文里反复出现的场所名/地点>",
      "prompt": "<仅抽原文对该场所的描写：建筑/室内外/光线/时间/气氛；原文未写给空字符串。一次性背景不要进>" }
  ],
  "props": [
    { "id": "prop_xxx", "name": "<原文里反复提到的关键具名物品名称>",
      "prompt": "<仅抽原文对该物品的描写：材质/颜色/形态/标识；原文未写给空字符串。不反复出现或无识别度的普通物品不要放进来。>" }
  ],
  "rootSceneId": "scene_001",
  "scenes": [
    {
      "id": "scene_001",
      "title": "<原文章节标题原样>",
      "durationMs": 8000,
      "locationId": "loc_xxx",
      "characterIds": ["char_xxx"],
      "background": "<原文里的**舞台指示/环境描写/氛围文字**抽取拼成的纯背景速记，不改写；原文没写给空字符串>",
      "prompts": {
        "scene": "<原文环境描写**逐字复述**；原文没写给空字符串>",
        "ui":    "<空字符串，除非原文明指 UI 风格转折>",
        "video": "<空字符串，让作者后期补>"
      },
      "shots": [
        { "id": "sh_01", "order": 0,
          "framing": "wide|medium|close|insert|ots|pov",
          "cameraHint": "<若原文明指机位/运镜则照抄，否则空字符串>",
          "prompt": "<本镜画面提示词，从原文该段拆分出的视觉要点；不得二创>",
          "characterIds": ["char_xxx"],
          "transitionHint": "<与下一镜衔接；原文无则空字符串>"
        }
      ],
      "keyShotId": "sh_01",
      "dialogue": [
        { "role": "narration|protagonist|character",
          "speaker": "<原文里的称呼>",
          "text": "<**原文台词逐字保留，绝不润色**>",
          "startMs": 400, "endMs": 3000 }
      ],
      "qte": null,
      "branches": [
        { "kind": "choice|auto",
          "label": "<choice 时填原文里的选项文字；auto 时空字符串>",
          "targetSceneId": "scene_002" }
      ]
    }
  ]
}

【QTE 形态 · 仅原文显式动作时才配】
"qte": {
  "window": { "perfect": 80, "great": 160, "good": 280 },
  "score":  { "perfect": 100, "great": 60, "good": 25, "miss": -30 },
  "passingScore": 200,
  "cues": [
    { "id": "k1", "shape": "tap", "x": 0.5, "y": 0.55,
      "appearAt": 1800, "targetAt": 2600, "label": "<原文动作动词>" }
  ]
}

【软约束 · 跟原文走】
- scenes 数 = 原文章节数 / 自然分幕数（不强求 4-7 场，原文 12 场就给 12 场）
- characters 数 = 原文出场角色数（不要新增"路人""旁白者"）
- locations：仅抽"原文反复出现 + 有具名的"主要场所；0-8 个上限。一次性环境或仅一句话提及的不要进
- props：仅抽"原文反复提及 + 有具名身份"的关键物品；0-6 件上限。仅一次提及、或无显著描述的普通物品不要进
- branches：原文显式选择 → \`choice\`；其他全部 \`auto\` 单线
- QTE：原文显式动作动词 + 紧迫感才配；其他场景 \`qte: null\`
- branches 全连通：从 rootSceneId 出发可达每个场景；targetSceneId 必须真实存在
- **background vs dialogue(narration)**：原文里的舞台指示 / 环境描写 / 天气时间 → \`background\`；
  原文里**加引号的画外叙述**或明确的旁白行 → \`dialogue\` 的 narration。**分家不重叠**。
- **shots 分镜**：每场 2-4 镜。先拆再挑：
    a) 先通读本场原文，找出能被视觉化的"节拍"（入画 / 对视 / 动作 / 特写物 / 抽身离场）
    b) 按节拍切 shot，每个 shot 对应一次景别/视角变化；仅在原文支持时才分
    c) 原文极短（一两句）→ 仍出 2 镜（e.g. establishing + reaction），避免单镜占位
    d) cameraHint/transitionHint 原文没写就空字符串，不要凭空造"推镜"
- 不要 markdown、不要 // 注释、不要尾随逗号；必须能 \`JSON.parse\` 直接通过`
}

// ============================================================================
// 内部工具
// ============================================================================

function normalizeRole(r?: string): 'narration' | 'protagonist' | 'character' {
  if (r === 'protagonist' || r === 'narration' || r === 'character') return r
  return 'narration'
}

function cleanupPrompt(raw: string): string {
  return raw
    .trim()
    .replace(/^```[a-z]*\s*|```$/gi, '')
    .replace(/^[「『"']+|[」』"']+$/g, '')
    .replace(/\n+/g, ' ')
    .trim()
}

/**
 * 视频提示词的清洗：保留换行（时间码分段），但去掉 markdown 与多余引号。
 */
function cleanupVideoPrompt(raw: string): string {
  return raw
    .trim()
    .replace(/^```[a-z]*\s*|```$/gi, '')
    .replace(/^[「『"']+|[」』"']+$/g, '')
    .trim()
}

interface ParsedScene {
  id?: string
  title?: string
  durationMs?: number
  locationId?: string
  characterIds?: string[]
  background?: string
  keyShotId?: string
  shots?: unknown[]
  prompts?: { scene?: string; ui?: string; video?: string }
  dialogue?: {
    role?: string
    speaker?: string
    text?: string
    startMs?: number
    endMs?: number
  }[]
  qte?: {
    window?: { perfect?: number; great?: number; good?: number }
    score?: {
      perfect?: number
      great?: number
      good?: number
      miss?: number
    }
    passingScore?: number
    cues?: {
      id?: string
      shape?: string
      x?: number
      y?: number
      appearAt?: number
      targetAt?: number
      durationMs?: number
      label?: string
    }[]
  } | null
  branches?: {
    id?: string
    kind?: string
    label?: string
    targetSceneId?: string
    showAt?: number
  }[]
}

interface ParsedCharacterAppearanceVariant {
  id?: string
  label?: string
  prompt?: string
  aliases?: unknown
  mediaId?: string
}

interface ParsedPropVariant {
  id?: string
  label?: string
  prompt?: string
  aliases?: unknown
  mediaId?: string
}

interface ParsedScenario {
  title?: string
  synopsis?: string
  uiStyle?: { prompt?: string }
  characters?: {
    id?: string
    name?: string
    prompt?: string
    aliases?: unknown
    anchor?: string
    appearanceVariants?: ParsedCharacterAppearanceVariant[]
  }[]
  locations?: { id?: string; name?: string; prompt?: string }[]
  props?: {
    id?: string
    name?: string
    prompt?: string
    aliases?: unknown
    anchor?: string
    variants?: ParsedPropVariant[]
  }[]
  rootSceneId?: string
  scenes?: ParsedScene[]
}

function normalizeScenario(
  parsed: unknown,
  originIdea: string,
  warnings: string[],
): Scenario {
  const data = (parsed ?? {}) as ParsedScenario

  const id = `scn-${Date.now().toString(36)}`

  const characters: Scenario['characters'] = {}
  for (const c of data.characters ?? []) {
    if (!c?.id || !c?.name) continue
    const aliases = sanitizeAliasList(c.aliases)
    const anchor =
      typeof c.anchor === 'string' && c.anchor.trim()
        ? c.anchor.trim()
        : undefined
    const appearanceVariants = Array.isArray(c.appearanceVariants)
      ? c.appearanceVariants
          .map((v, i) => normalizeCharacterAppearanceVariant(v, c.id!, i))
          .filter((v): v is NonNullable<typeof v> => v !== null)
      : undefined
    characters[c.id] = {
      id: c.id,
      name: c.name,
      prompt: c.prompt ?? c.name,
      ...(aliases ? { aliases } : {}),
      ...(anchor ? { anchor } : {}),
      ...(appearanceVariants && appearanceVariants.length > 0
        ? { appearanceVariants }
        : {}),
    }
  }

  // v3.8 · 场所抽取 —— LLM 返回场所数组，转换成 scenario.locations 对象表
  // 这是场所基准图流水线 runForgeImagePipeline/characterRefPass 的前提：
  // 没有 locations 对象，就没有任务可跑，场所基准图永远为空。
  const locations: Scenario['locations'] = {}
  for (const l of data.locations ?? []) {
    if (!l?.id || !l?.name) continue
    locations[l.id] = {
      id: l.id,
      name: l.name,
      prompt: l.prompt?.trim() || l.name,
    }
  }

  // v3.7 · 关键道具抽取（LLM 识别原文中"反复出现 + 有身份识别度"的物品）
  const props: Scenario['props'] = {}
  for (const p of data.props ?? []) {
    if (!p?.id || !p?.name) continue
    const aliases = sanitizeAliasList(p.aliases)
    const anchor =
      typeof p.anchor === 'string' && p.anchor.trim()
        ? p.anchor.trim()
        : undefined
    const variants = Array.isArray(p.variants)
      ? p.variants
          .map((v, i) => normalizePropVariant(v, p.id!, i))
          .filter((v): v is NonNullable<typeof v> => v !== null)
      : undefined
    props[p.id] = {
      id: p.id,
      name: p.name,
      prompt: p.prompt?.trim() || p.name,
      ...(aliases ? { aliases } : {}),
      ...(anchor ? { anchor } : {}),
      ...(variants && variants.length > 0 ? { variants } : {}),
    }
  }

  const scenes: Record<string, Scenario['scenes'][string]> = {}
  const arr = Array.isArray(data.scenes) ? data.scenes : []
  if (arr.length === 0) {
    warnings.push('模型未返回 scenes，已生成单场景兜底')
  }
  for (const s of arr) {
    if (!s?.id) continue
    const sceneId = s.id
    const scenePrompt = s.prompts?.scene ?? s.title ?? '中性占位画面'
    const rawShots = Array.isArray(s.shots) ? s.shots : []
    const shots = rawShots
      .map((sh, i) => normalizeShot(sh, sceneId, i, scenePrompt))
      .filter((sh): sh is NonNullable<typeof sh> => sh !== null)
    const keyShotId =
      typeof s.keyShotId === 'string' && shots.some((sh) => sh.id === s.keyShotId)
        ? s.keyShotId
        : shots[0]?.id
    const background =
      typeof s.background === 'string' && s.background.trim()
        ? s.background.trim()
        : undefined
    scenes[sceneId] = {
      id: sceneId,
      title: s.title ?? sceneId,
      durationMs: clampDuration(s.durationMs),
      // locationId：仅当 LLM 明确给出且 locations 对象里存在时才保留
      // 避免"幽灵引用"（LLM 给了但 locations 没生成 → 场景指向空场所）
      locationId:
        s.locationId && locations[s.locationId] ? s.locationId : undefined,
      media: {
        kind: 'IMAGE_PROMPT',
        prompt: scenePrompt,
      },
      prompts: {
        scene: scenePrompt,
        ui: s.prompts?.ui,
        video: s.prompts?.video,
      },
      background,
      shots: shots.length > 0 ? shots : undefined,
      keyShotId,
      characterIds: Array.isArray(s.characterIds) ? s.characterIds : [],
      dialogue: (s.dialogue ?? []).map((d, i) => ({
        id: `${sceneId}-d${i + 1}`,
        role:
          d.role === 'protagonist' ||
          d.role === 'character' ||
          d.role === 'system'
            ? d.role
            : 'narration',
        speaker: d.speaker || undefined,
        text: (d.text ?? '').trim(),
        startMs: Math.max(0, Number(d.startMs) || 200 + i * 1500),
        endMs:
          d.endMs == null
            ? undefined
            : Math.max(0, Number(d.endMs) || 0),
      })),
      qte: s.qte
        ? {
            window: {
              perfect: s.qte.window?.perfect ?? 80,
              great: s.qte.window?.great ?? 160,
              good: s.qte.window?.good ?? 280,
            },
            score: {
              perfect: s.qte.score?.perfect ?? 100,
              great: s.qte.score?.great ?? 60,
              good: s.qte.score?.good ?? 25,
              miss: s.qte.score?.miss ?? -30,
            },
            passingScore: s.qte.passingScore,
            cues: (s.qte.cues ?? []).map((c, i) => ({
              id: c.id ?? `${sceneId}-q${i + 1}`,
              shape:
                c.shape === 'hold' || c.shape === 'sweep' ? c.shape : 'tap',
              x: clamp01(c.x ?? 0.5),
              y: clamp01(c.y ?? 0.5),
              appearAt: Math.max(0, Number(c.appearAt) || 1500 + i * 1200),
              targetAt: Math.max(
                Math.max(0, Number(c.appearAt) || 1500 + i * 1200) + 500,
                Number(c.targetAt) || 2300 + i * 1200,
              ),
              durationMs: c.durationMs,
              label: c.label,
            })),
          }
        : undefined,
      branches: (s.branches ?? []).map((b, i) => ({
        id: b.id ?? `${sceneId}-b${i + 1}`,
        kind: normalizeBranchKind(b.kind),
        label: b.label,
        targetSceneId: b.targetSceneId ?? sceneId,
        showAt: b.showAt,
      })) as Scenario['scenes'][string]['branches'],
    }
  }

  let rootSceneId =
    data.rootSceneId && scenes[data.rootSceneId] ? data.rootSceneId : ''
  if (!rootSceneId) {
    rootSceneId = Object.keys(scenes)[0] ?? `${id}-stub`
    warnings.push(`rootSceneId 缺失，使用 ${rootSceneId}`)
  }

  if (Object.keys(scenes).length === 0) {
    const stubId = `${id}-stub`
    const stubPrompt = '简单的过渡画面'
    scenes[stubId] = {
      id: stubId,
      title: '01 · 序章',
      durationMs: 6000,
      media: { kind: 'IMAGE_PROMPT', prompt: stubPrompt },
      prompts: { scene: stubPrompt },
      characterIds: [],
      dialogue: [],
      branches: [],
    }
    rootSceneId = stubId
  }

  const firstId = rootSceneId
  for (const s of Object.values(scenes)) {
    s.branches = s.branches.map((b) => {
      if (!scenes[b.targetSceneId]) {
        warnings.push(
          `场景 ${s.id} 分支 ${b.id} 指向不存在的 ${b.targetSceneId}，已重定向到 ${firstId}`,
        )
        return { ...b, targetSceneId: firstId }
      }
      return b
    })
  }

  return {
    id,
    title: data.title?.trim() || '未命名剧本',
    synopsis: data.synopsis?.trim() || originIdea,
    rootSceneId,
    scenes,
    defaultCharMs: 32,
    schemaVersion: 1,
    characters,
    locations: Object.keys(locations).length > 0 ? locations : undefined,
    props: Object.keys(props).length > 0 ? props : undefined,
    uiStyle: data.uiStyle?.prompt ? { prompt: data.uiStyle.prompt } : undefined,
    originIdea,
  }
}

function normalizeBranchKind(k?: string): 'choice' | 'qte_pass' | 'qte_fail' | 'auto' {
  if (k === 'qte_pass' || k === 'qte_fail' || k === 'auto') return k
  return 'choice'
}

/**
 * 标准化 LLM 返回的单个 shot 对象。
 *
 * LLM 返回的 shot 字段顺序/类型都不可靠：
 *   - id 可能缺失 / 可能重复 → 一律用 sceneId + order 重签
 *   - framing 可能写成 "close-up" / "wide shot" 等变体 → 字典对齐到六种基准值
 *   - prompt 为空时回退到 scenePrompt，保证任何 shot 都至少能触发生图
 *
 * 返回 null 表示这条 shot 数据完全无法使用（例如非对象）。
 */
function normalizeShot(
  raw: unknown,
  sceneId: string,
  index: number,
  fallbackPrompt: string,
): {
  id: string
  order: number
  framing: 'wide' | 'medium' | 'close' | 'insert' | 'ots' | 'pov'
  cameraHint?: string
  prompt: string
  startMs?: number
  endMs?: number
  characterIds?: string[]
  characterVariantIds?: Record<string, string>
  propIds?: string[]
  propVariantIds?: Record<string, string>
  keyframeMediaRef?: string
  transitionHint?: string
} | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const rawId = typeof r.id === 'string' ? r.id.trim() : ''
  const id = rawId || `${sceneId}-sh${String(index + 1).padStart(2, '0')}`
  const rawOrder = Number(r.order)
  const order = Number.isFinite(rawOrder) ? Math.max(0, Math.floor(rawOrder)) : index
  const framing = normalizeFraming(
    typeof r.framing === 'string' ? r.framing : undefined,
  )
  const prompt =
    (typeof r.prompt === 'string' && r.prompt.trim()) || fallbackPrompt.trim() || ''
  const cameraHint =
    typeof r.cameraHint === 'string' && r.cameraHint.trim()
      ? r.cameraHint.trim()
      : undefined
  const transitionHint =
    typeof r.transitionHint === 'string' && r.transitionHint.trim()
      ? r.transitionHint.trim()
      : undefined
  const characterIds = Array.isArray(r.characterIds)
    ? (r.characterIds.filter((x) => typeof x === 'string') as string[])
    : undefined
  const propIds = Array.isArray(r.propIds)
    ? (r.propIds.filter((x) => typeof x === 'string') as string[])
    : undefined
  const characterVariantIds = sanitizeStringMap(r.characterVariantIds)
  const propVariantIds = sanitizeStringMap(r.propVariantIds)
  const startMs =
    typeof r.startMs === 'number' && Number.isFinite(r.startMs)
      ? Math.max(0, r.startMs)
      : undefined
  const endMs =
    typeof r.endMs === 'number' && Number.isFinite(r.endMs)
      ? Math.max(0, r.endMs)
      : undefined
  return {
    id,
    order,
    framing,
    cameraHint,
    prompt,
    startMs,
    endMs,
    characterIds,
    ...(characterVariantIds ? { characterVariantIds } : {}),
    ...(propIds && propIds.length > 0 ? { propIds } : {}),
    ...(propVariantIds ? { propVariantIds } : {}),
    transitionHint,
  }
}

function normalizeFraming(
  raw?: string,
): 'wide' | 'medium' | 'close' | 'insert' | 'ots' | 'pov' {
  if (!raw) return 'medium'
  const s = raw.trim().toLowerCase().replace(/[\s-_]/g, '')
  if (
    s === 'wide' ||
    s === 'longshot' ||
    s === 'long' ||
    s === 'establishing' ||
    s === 'establishingshot' ||
    s === 'fullshot' ||
    s === 'full'
  )
    return 'wide'
  if (s === 'closeup' || s === 'close' || s === 'bigcloseup' || s === 'extremecloseup')
    return 'close'
  if (s === 'insert' || s === 'detail' || s === 'macro') return 'insert'
  if (s === 'ots' || s === 'overtheshoulder') return 'ots'
  if (s === 'pov' || s === 'pointofview' || s === 'firstperson') return 'pov'
  return 'medium'
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5
  return Math.max(0, Math.min(1, n))
}

/**
 * v3.10 · 别名清单清洗。
 *
 * LLM 偶尔会把 aliases 写成字符串而不是数组，或者数组里塞 null/数字。
 * 这里统一兜成 string[]：去重 + trim + 丢非字符串。空数组返回 undefined，
 * 让上层用 `...(aliases ? { aliases } : {})` 过滤掉空字段。
 */
function sanitizeAliasList(raw: unknown): string[] | undefined {
  if (typeof raw === 'string') {
    const t = raw.trim()
    return t ? [t] : undefined
  }
  if (!Array.isArray(raw)) return undefined
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const t = item.trim()
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out.length > 0 ? out : undefined
}

/**
 * v3.10 · 字符串映射清洗（用于 Shot.characterVariantIds / propVariantIds）。
 *
 * 期望 LLM 给的就是 `{ "char-x": "var-y" }`，但需要兜：
 * - 非对象 / 数组 → undefined
 * - value 不是字符串 → 跳过该 key
 * - key/value 经 trim 后任一为空 → 跳过
 *
 * 注意：这里**不**校验 variantId 是否真的存在于 character.appearanceVariants。
 * 那是 normalizeScenario 上层 / runtime 的职责（文档里答应过：variant 不存在
 * 时安静丢弃），这里只做形状清洗。
 */
function sanitizeStringMap(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v !== 'string') continue
    const key = k.trim()
    const val = v.trim()
    if (!key || !val) continue
    out[key] = val
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * v3.10 · 角色形态变体标准化。
 *
 * label 是必填（UI 要展示），缺则丢；id 缺则按 `${charId}-var${i+1}` 兜底。
 * prompt 是增量描述（不含 base prompt），可以为空。aliases 走 sanitizeAliasList。
 */
function normalizeCharacterAppearanceVariant(
  raw: unknown,
  charId: string,
  index: number,
): { id: string; label: string; prompt: string; aliases?: string[]; mediaId?: string } | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const label = typeof r.label === 'string' ? r.label.trim() : ''
  if (!label) return null
  const id =
    typeof r.id === 'string' && r.id.trim()
      ? r.id.trim()
      : `${charId}-var${index + 1}`
  const prompt = typeof r.prompt === 'string' ? r.prompt.trim() : ''
  const aliases = sanitizeAliasList(r.aliases)
  const mediaId =
    typeof r.mediaId === 'string' && r.mediaId.trim() ? r.mediaId.trim() : undefined
  return {
    id,
    label,
    prompt,
    ...(aliases ? { aliases } : {}),
    ...(mediaId ? { mediaId } : {}),
  }
}

/**
 * v3.10 · 道具变体标准化（与 normalizeCharacterAppearanceVariant 同形）。
 *
 * 抽出来不合并是为了未来道具变体可能加独有字段（e.g. damageLevel），
 * 现在两个函数体几乎一样属于"暂时重复"，可以容忍。
 */
function normalizePropVariant(
  raw: unknown,
  propId: string,
  index: number,
): { id: string; label: string; prompt: string; aliases?: string[]; mediaId?: string } | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const label = typeof r.label === 'string' ? r.label.trim() : ''
  if (!label) return null
  const id =
    typeof r.id === 'string' && r.id.trim()
      ? r.id.trim()
      : `${propId}-var${index + 1}`
  const prompt = typeof r.prompt === 'string' ? r.prompt.trim() : ''
  const aliases = sanitizeAliasList(r.aliases)
  const mediaId =
    typeof r.mediaId === 'string' && r.mediaId.trim() ? r.mediaId.trim() : undefined
  return {
    id,
    label,
    prompt,
    ...(aliases ? { aliases } : {}),
    ...(mediaId ? { mediaId } : {}),
  }
}

function clampDuration(n?: number): number {
  // 缺省/非法 → 50s 起步；上限放宽到 600s（10min），下限保留 2s。
  // LLM 给的是「素材播放时长」估计，不再被 60s 砍掉；时间轴长度另由 canvasMs 兜底到 ≥50s。
  if (!Number.isFinite(n) || !n) return 50000
  return Math.max(2000, Math.min(600000, Math.round(n)))
}

// ============================================================================
// 5. 剧情树断链修复 · AI 语义补链
//
// 和 reconnectOrphans.ts 里的"按画布几何推断"不同，这里让 LLM 基于剧情
// 语义（title / 首句台词 / 出场角色）给每个 orphan 推一个 targetSceneId。
//
// 设计取舍：
//   - 不让 LLM 输出完整 scenario —— 代价太大、会覆盖作者已有改动
//   - 只输出 { orphanId, targetId } 映射，由调用方 merge 到 plan 再落盘
//   - 白名单在调用方（parseReconnectSuggestions）二次校验，避免 LLM 幻觉
//     出一个不存在的 sceneId
// ============================================================================

export interface ForgeReconnectArgs {
  scenario: Scenario
  orphans: OrphanInfo[]
}

export interface ForgeReconnectResult {
  suggestions: ReconnectSuggestion[]
  warnings: string[]
  raw: string
}

export async function forgeReconnectOrphans(
  llm: TextClient,
  args: ForgeReconnectArgs,
): Promise<ForgeReconnectResult> {
  const { scenario, orphans } = args
  if (orphans.length === 0) {
    return { suggestions: [], warnings: ['无 orphan 可补'], raw: '' }
  }

  const user = buildReconnectPrompt(scenario, orphans)

  // 场景数随作者工程指数级增长，prompt 长度一般 ~ N * 80 字符。4K token
  // 足够容纳 100+ 场景的 digest + 输出。
  const raw = await llm.generate({
    systemPrompt: SKILLS.scenarioArchitect,
    userPrompt: user,
    temperature: 0.4,
    maxTokens: 4000,
    jsonMode: true,
  })

  const parsed = parseJSONLoose(raw)
  if (!parsed) {
    throw new Error(
      '[AI-RECONNECT] 模型未返回合法 JSON · raw=' + raw.slice(0, 200),
    )
  }

  const orphanIds = new Set(orphans.map((o) => o.sceneId))
  const sceneIds = new Set(Object.keys(scenario.scenes))
  const { suggestions, warnings } = parseReconnectSuggestions(
    parsed,
    orphanIds,
    sceneIds,
  )

  return { suggestions, warnings, raw }
}