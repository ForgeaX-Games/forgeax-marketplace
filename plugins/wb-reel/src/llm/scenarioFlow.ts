import { parseJSONLoose } from './parseJSONLoose'
import { SKILLS } from './skills'
import type { TextClient } from './types'

/**
 * Scenario Flow —— 一句话 → 剧本文本 的**多阶段 orchestrator**
 *
 * 设计要点：
 *   - 这个模块只管"一句话 → 剧本原文（纯文本）"。
 *   - 最终的 Scenario（JSON 剧情树）由下游 `forgeScenarioFromScript` 去做，
 *     即 IdeaForge 的流程改为：
 *
 *         runIdeaToScriptFlow(llm, { idea })   ← 本文件
 *              ↓ 产出 { outline, script }
 *         forgeScenarioFromScript(llm, { script })   ← 现有上传流程，零改动
 *              ↓ 产出 Scenario
 *         loadScenario(scenario)
 *
 *   - 把"创作（creative）"和"结构化（structural）"彻底解耦：
 *       · Stage A / B 走 outline-architect + script-expander（高温度、开放叙事）
 *       · 结构化解析走 script-structurer（低温度、忠于原文、禁二创）
 *
 *   - token 预算**逐阶段小规模**：
 *       · outline: 1800 tok
 *       · per-act:  1800 tok
 *       · structure: 已有 32000 tok（不变）
 *     这样能避开 gemini-3.x "thinking 吃光预算 → [EMPTY]" 和上游 SSE 不稳。
 */

// ============================================================================
// 1. Outline —— Stage A 产物
// ============================================================================

export interface OutlineAct {
  id: string
  title: string
  beat: string
}

/**
 * v3.10 —— 大纲阶段就锁住的角色称谓表。
 *
 * 由 outline-architect skill 在产出大纲时**一并吐出**，下游 entity-resolution
 * （script-index-scanner / scenarioArchitect / actLoopbackContext）可以直接复用,
 * 让"那个戴眼镜的"和"陈医生"从一开始就映射到同一个 character.id, 而不是等到
 * scanner 阶段才发现是同一个人。
 *
 * 字段语义见 outline-architect.skill.md 的 characterAliases 章节。
 */
export interface OutlineCharacterAlias {
  /** 角色"正式 / 主称谓"（姓名或最稳定的指称, 2–6 字） */
  name: string
  /**
   * 该角色在剧本里可能被称呼的所有变体（代词 / 职业 / 关系 / 外观 / 角色 任选）.
   * skill 约束 length ≥ 2; parseOutlineJSON 兜底允许更短, 但低于 2 时不进入下游.
   */
  aliases: string[]
}

export interface Outline {
  title: string
  synopsis: string
  tone: string
  protagonist: string
  acts: OutlineAct[]
  /**
   * v3.10: 大纲阶段就把所有可能出现的角色称谓锁住, 给下游做 entity-resolution.
   * 字段可缺失（向后兼容 v3.9 之前的旧产物 / 旧 skill）—— 下游应当自行兜底.
   */
  characterAliases?: OutlineCharacterAlias[]
}

/**
 * 从模型返回的原始字符串解析 Outline。
 *
 * 容错：
 *   - markdown 代码块（```json ... ```）剥掉
 *   - 字段缺失用空字符串兜底（不抛，让上游检查"整体是否可用"）
 *   - 对 acts 的校验更严：空数组 / 非数组都抛错，因为下一步要靠它迭代
 *
 * 抛错分类：
 *   [OUTLINE_PARSE]  —— JSON 根本解析不出来
 *   [OUTLINE_EMPTY]  —— 解析出来了但 acts 空 / 字段都是空的
 */
export function parseOutlineJSON(raw: string): Outline {
  let stripped = raw.trim()
  // 剥 ``` 围栏 —— 即使 jsonMode 下偶尔也会出现
  if (stripped.startsWith('```')) {
    stripped = stripped.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  }

  const parsed = parseJSONLoose(stripped)
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(
      `[OUTLINE_PARSE] 大纲 JSON 无法解析 · raw head=${raw.slice(0, 200)}`,
    )
  }

  const obj = parsed as Record<string, unknown>
  const actsRaw = Array.isArray(obj.acts) ? (obj.acts as unknown[]) : []
  if (actsRaw.length === 0) {
    throw new Error(
      `[OUTLINE_EMPTY] 大纲里没有 acts —— 模型可能没理解任务 · raw head=${raw.slice(0, 200)}`,
    )
  }

  const acts: OutlineAct[] = actsRaw.map((a, i) => {
    const ao = (a ?? {}) as Record<string, unknown>
    const id =
      typeof ao.id === 'string' && ao.id.trim() ? ao.id.trim() : `act_${padAct(i + 1)}`
    return {
      id,
      title: typeof ao.title === 'string' ? ao.title.trim() : `第 ${i + 1} 幕`,
      beat: typeof ao.beat === 'string' ? ao.beat.trim() : '',
    }
  })

  // v3.10: characterAliases 完全可选 —— 老 skill / 老快照都没有这个字段, 不要因此拒收大纲.
  // 但只要存在, 就严格清洗一遍, 让下游放心拿:
  //   - 每条必须 name + aliases[≥1] 都是非空字符串
  //   - 单条 aliases 内部去重, 去前后空格
  //   - 跨条按 name 去重（同名的 aliases 合并）
  let characterAliases: OutlineCharacterAlias[] | undefined
  const rawAliases = Array.isArray(obj.characterAliases)
    ? (obj.characterAliases as unknown[])
    : []
  if (rawAliases.length > 0) {
    const byName = new Map<string, Set<string>>()
    for (const item of rawAliases) {
      if (!item || typeof item !== 'object') continue
      const it = item as Record<string, unknown>
      const name = typeof it.name === 'string' ? it.name.trim() : ''
      if (!name) continue
      const aliasArr = Array.isArray(it.aliases) ? it.aliases : []
      const cleaned = aliasArr
        .filter((s): s is string => typeof s === 'string')
        .map((s) => s.trim())
        .filter(Boolean)
      if (cleaned.length === 0) continue
      const set = byName.get(name) ?? new Set<string>()
      for (const a of cleaned) set.add(a)
      byName.set(name, set)
    }
    if (byName.size > 0) {
      characterAliases = Array.from(byName.entries()).map(([name, set]) => ({
        name,
        aliases: Array.from(set),
      }))
    }
  }

  return {
    title: typeof obj.title === 'string' ? obj.title.trim() : '未命名',
    synopsis: typeof obj.synopsis === 'string' ? obj.synopsis.trim() : '',
    tone: typeof obj.tone === 'string' ? obj.tone.trim() : '',
    protagonist:
      typeof obj.protagonist === 'string' ? obj.protagonist.trim() : '',
    acts,
    ...(characterAliases ? { characterAliases } : {}),
  }
}

function padAct(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

// ============================================================================
// 2. Stage A · forgeOutlineFromIdea —— 一句话 → 大纲
// ============================================================================

export interface ForgeOutlineArgs {
  idea: string
}

export interface ForgeOutlineResult {
  outline: Outline
  raw: string
}

export async function forgeOutlineFromIdea(
  llm: TextClient,
  args: ForgeOutlineArgs,
): Promise<ForgeOutlineResult> {
  const user =
    `【作者一句话想法】\n${args.idea.trim()}\n\n` +
    '请按 skill 中"输出契约"给出 JSON 大纲。' +
    '默认 3 幕，如果剧情自然切成 2 或 4 幕也可以。'

  const raw = await llm.generate({
    systemPrompt: SKILLS.outlineArchitect,
    userPrompt: user,
    temperature: 0.85,
    // 8192 是 GeminiProvider 对 gemini-3.x 自动抬的下限；这里显式再抬，
    // 给 forced-thinking 的 thought tokens 留出粮草（实测 222 tokens 就能
    // 被一个"嗨"吃掉，大纲 prompt 可能轻松上千 thought）。
    maxTokens: 8192,
    jsonMode: true,
  })

  return { outline: parseOutlineJSON(raw), raw }
}

// ============================================================================
// 3. Stage B · forgeScriptFromOutline —— 大纲 → 剧本纯文本
// ============================================================================

export interface ForgeScriptFromOutlineArgs {
  outline: Outline
  /**
   * 扩写某一幕时，其他幕的已完成文本。
   * 和 `only` 配合：给 LLM 当上下文，保持腔调一致。
   * 下标对齐 outline.acts。
   */
  existing?: (string | null)[]
  /** 只扩写指定 act id；其他幕直接用 existing 原文返回 */
  only?: string
  /** 每幕开始 / 完成时回调，label 形如"第一幕 · 门前"/"第一幕 · 门前 ✓" */
  onStage?: (label: string) => void
  /** 每幕流式 text delta 回调（流式开启时可用；本版本先留接口） */
  onDelta?: (actId: string, delta: string) => void
  signal?: AbortSignal
}

export interface ForgeScriptFromOutlineResult {
  /** 拼好的完整剧本文本（给下游 forgeScenarioFromScript 吃） */
  script: string
  /** 每幕的纯文本（不含标题行），下标对齐 outline.acts */
  perAct: string[]
}

export async function forgeScriptFromOutline(
  llm: TextClient,
  args: ForgeScriptFromOutlineArgs,
): Promise<ForgeScriptFromOutlineResult> {
  const { outline, only, existing = [] } = args

  const perAct: string[] = []
  for (let i = 0; i < outline.acts.length; i++) {
    const act = outline.acts[i]
    if (!act) continue
    const label = `${ordinalAct(i)} · ${act.title}`

    if (only && act.id !== only) {
      // 不重写本幕 —— 用上游 existing 的原文
      const keep = existing[i] ?? ''
      perAct.push(keep)
      continue
    }

    args.onStage?.(`第${ordinal(i)}幕 · ${act.title}`)
    const user = composeActUserPrompt(outline, act, i, perAct)

    const text = await llm.generate({
      systemPrompt: SKILLS.scriptExpander,
      userPrompt: user,
      temperature: 0.9,
      // 单幕扩写纯文本，也会被 3.x 的 thinking 预热吃掉不少；调至 8192。
      maxTokens: 8192,
    })

    const clean = stripLeadingCodeFence(text).trim()
    perAct.push(clean)
    args.onStage?.(`第${ordinal(i)}幕 · ${act.title} ✓`)
    void label
  }

  const script = assembleScriptFromActs(outline, perAct)
  return { script, perAct }
}

function composeActUserPrompt(
  outline: Outline,
  act: OutlineAct,
  idx: number,
  finishedSoFar: string[],
): string {
  const prev = finishedSoFar
    .filter((t) => t && t.trim())
    .slice(-1) // 只给最近一幕做衔接参考，省 token
    .map((t) => t.slice(0, 600))
    .join('\n')

  const blocks: (string | null)[] = [
    `【故事标题】${outline.title}`,
    `【整体 synopsis】\n${outline.synopsis}`,
    `【美学 tone（必须贯穿）】\n${outline.tone}`,
    `【主角锚点（每次亮相复用特征）】\n${outline.protagonist}`,
    prev
      ? `【上一幕结尾（仅供语气衔接，不要重复内容）】\n${prev}`
      : null,
    `【当前要扩写：第${ordinal(idx)}幕 · ${act.title}】\n【本幕 beat】${act.beat}`,
    '',
    '请按 skill 中"输出契约"直接给出本幕剧本原文（纯文本，不要 JSON、不要 markdown 代码块围栏）。',
  ]
  return blocks.filter((b): b is string => b !== null).join('\n\n')
}

/**
 * 把各幕扩写文本按顺序拼成"完整剧本文本"。
 * 输出格式故意向上游 script-structurer 的"偏好输入"靠——有明确的幕/章标题，
 * 让 forgeScenarioFromScript 能干净地切场景。
 */
export function assembleScriptFromActs(
  outline: Outline,
  perAct: string[],
): string {
  if (perAct.length !== outline.acts.length) {
    throw new Error(
      `[ASSEMBLE_MISMATCH] perAct length (${perAct.length}) !== acts length (${outline.acts.length})`,
    )
  }
  const head = [
    `# ${outline.title}`,
    '',
    `> ${outline.synopsis}`,
    '',
    `**美学 tone**：${outline.tone}`,
    '',
    `**主角**：${outline.protagonist}`,
    '',
  ].join('\n')

  const body = outline.acts
    .map((act, i) => {
      const label = `## 第${ordinal(i)}幕 · ${act.title}`
      const text = perAct[i] ?? ''
      return `${label}\n\n${text.trim()}\n`
    })
    .join('\n')

  return `${head}\n${body}`.trim() + '\n'
}

function ordinalAct(i: number): string {
  return `第${ordinal(i)}幕`
}

const ORDINAL = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
function ordinal(i: number): string {
  return ORDINAL[i] ?? String(i + 1)
}

function stripLeadingCodeFence(t: string): string {
  const s = t.trim()
  if (s.startsWith('```')) {
    return s.replace(/^```\w*\s*/i, '').replace(/```\s*$/, '')
  }
  return s
}

// ============================================================================
// 4. Orchestrator · runIdeaToScriptFlow —— 串起 A → B
// ============================================================================

export type ScenarioFlowEvent =
  | { kind: 'outline.start' }
  | { kind: 'outline.done'; outline: Outline }
  | { kind: 'act.start'; actIndex: number; actId: string; label: string }
  | { kind: 'act.done'; actIndex: number; actId: string; text: string }
  | { kind: 'all.done'; script: string; outline: Outline }

export interface RunIdeaToScriptFlowArgs {
  idea: string
  onEvent?: (ev: ScenarioFlowEvent) => void
  signal?: AbortSignal
}

export interface RunIdeaToScriptFlowResult {
  outline: Outline
  perAct: string[]
  script: string
}

export async function runIdeaToScriptFlow(
  llm: TextClient,
  args: RunIdeaToScriptFlowArgs,
): Promise<RunIdeaToScriptFlowResult> {
  args.onEvent?.({ kind: 'outline.start' })
  const outlineRes = await forgeOutlineFromIdea(llm, { idea: args.idea })
  args.onEvent?.({ kind: 'outline.done', outline: outlineRes.outline })

  const perAct: string[] = []
  for (let i = 0; i < outlineRes.outline.acts.length; i++) {
    const act = outlineRes.outline.acts[i]
    if (!act) continue
    const label = `第${ordinal(i)}幕 · ${act.title}`
    args.onEvent?.({
      kind: 'act.start',
      actIndex: i,
      actId: act.id,
      label,
    })

    // 一次只扩写一幕，让中间态对 UI 可见。
    // 简化实现：直接 inline 发 LLM 请求，避免把 existing/only 逻辑来回传。
    const user = composeActUserPrompt(outlineRes.outline, act, i, perAct)
    const text = await llm.generate({
      systemPrompt: SKILLS.scriptExpander,
      userPrompt: user,
      temperature: 0.9,
      // 单幕扩写纯文本，也会被 3.x 的 thinking 预热吃掉不少；调至 8192。
      maxTokens: 8192,
    })
    const clean = stripLeadingCodeFence(text).trim()
    perAct.push(clean)
    args.onEvent?.({
      kind: 'act.done',
      actIndex: i,
      actId: act.id,
      text: clean,
    })
  }

  const script = assembleScriptFromActs(outlineRes.outline, perAct)
  args.onEvent?.({ kind: 'all.done', script, outline: outlineRes.outline })

  return { outline: outlineRes.outline, perAct, script }
}
