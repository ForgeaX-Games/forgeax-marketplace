import type { TextClient } from '../llm/types'
import { streamOrFallback } from '../llm/types'
import { parseJSONLoose } from '../llm/parseJSONLoose'
import { SKILLS } from '../llm/skills'
import { useForgeChatStore } from './forgeChatStore'
import type {
  ForgeStage,
  StageDraftLogline,
  StageDraftOutline,
  StageDraftStyle,
  StageDraftSynopsis,
} from './forgeChatStore'

/**
 * runStages —— 模块化锻造管道的 stage 级 LLM 调度器。
 *
 * 与 ForgeChatPanel.runForgeFromChat 的关系：
 *   - runForgeFromChat: 旧路径"一句话 → Scenario JSON 直奔下游"，PR5 仍保留作为
 *     默认起点 / 资产生成阶段调用。
 *   - runStages: 新路径"作者一句话 → style → logline → synopsis → outline →
 *     expansion → assets" 的细粒度 runner。每个 stage 一次 LLM 调用，写入
 *     forgeChatStore.stages.records[stage].draft / status, 不直接动 scenarioStore.
 *
 * 设计要点：
 *   1. **module 级 / 与组件解耦**。组件随时可能卸载，runStage 不持有任何 React
 *      state；进度全部走 store。
 *   2. **每个 stage 都跑 beginStageAttempt → setStageStatus('running') → LLM →
 *      setStageDraft + setStageStatus('await-confirm')**。失败走
 *      setStageStatus('failed', err.message), 不抛出（让 UI 通过 status 渲染）。
 *   3. **不自动确认 / 不自动前进**。UI 渲染卡片并提供「确认」按钮显式调用
 *      forgeChatStore.confirmStage(scenarioId, stage)，然后路由器在下一次
 *      作者发言时才 advance.
 *   4. **patch 模式**。把当前 draft 序列化进 user prompt + 作者的 instruction,
 *      要求 LLM 返回与 stage skill 同 schema 的新 draft（而不是 RFC6902 patch）—
 *      patch 字段做加法 PR6 再切，先用整体替换跑通 UX。
 *   5. **取消**。每次启动都注册一个 AbortController；abortStage(scenarioId) 中断。
 *
 * 复用现有 PendingForge 进度气泡：
 *   - 这里不再额外塞 stage 标签到 PendingBubble；ForgeStageRoll 用每个
 *     record.status 直接渲染卡片，单 stage 跑动时能看到 "running…"。
 *   - 只在调度入口写一次 setPending(reason='forging') / clearPending(),
 *     让"中断"按钮和耗时计算继续可用；细节 stage 标签由 store 自己驱动 UI.
 */

// ─────────────────────────────────────────────────────────────────────────────
// abortRegistry —— per-scenario 单飞，并发跑会互相覆盖。一般情况下作者不会
// 同一个 scenario 两手并发触发；万一触发新一次，前一次的 controller.abort()
// 让旧调用主动放弃写入。
// ─────────────────────────────────────────────────────────────────────────────
const stageAbortRegistry = new Map<string, AbortController>()

export function abortStage(scenarioId: string): void {
  const c = stageAbortRegistry.get(scenarioId)
  if (c) {
    c.abort()
    stageAbortRegistry.delete(scenarioId)
  }
}

function isAbortLike(e: unknown): boolean {
  if (!e) return false
  const err = e as { name?: string; message?: string }
  return err.name === 'AbortError' || /aborted/i.test(err.message ?? '')
}

interface RunStageBaseParams {
  scenarioId: string
  llm: TextClient
  /**
   * 作者的修改诉求（仅 patch 路径用）。空字符串视作"重生", 即不带 instruction
   * 的全新一版.
   */
  instruction?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// 通用包装：注册 abort + setPending + 异常分类。
// 每个 runStageX 把"实际跑 LLM 的逻辑"以 inner 形式传进来.
// ─────────────────────────────────────────────────────────────────────────────
async function withStageEnvelope(
  scenarioId: string,
  stage: ForgeStage,
  inner: (signal: AbortSignal) => Promise<void>,
): Promise<void> {
  const chat = useForgeChatStore.getState()
  // 上一次还没完？踢掉
  abortStage(scenarioId)
  const ctrl = new AbortController()
  stageAbortRegistry.set(scenarioId, ctrl)

  chat.beginStageAttempt(scenarioId, stage)
  chat.setPending(scenarioId, {
    reason: 'forging',
    startedAt: Date.now(),
    stages: [
      {
        label: stageLabel(stage),
        detail: '调用模型',
        at: Date.now(),
      },
    ],
    streamTail: '',
    streamBytes: 0,
    abortable: true,
  })

  try {
    await inner(ctrl.signal)
  } catch (e) {
    if (isAbortLike(e)) {
      useForgeChatStore
        .getState()
        .setStageStatus(scenarioId, stage, 'failed', '已中断')
    } else {
      const msg = (e as Error).message ?? String(e)
      useForgeChatStore.getState().setStageStatus(scenarioId, stage, 'failed', msg)
    }
  } finally {
    stageAbortRegistry.delete(scenarioId)
    useForgeChatStore.getState().clearPending(scenarioId)
  }
}

function stageLabel(stage: ForgeStage): string {
  switch (stage) {
    case 'await-style':
      return '风格策展'
    case 'logline':
      return '一句话核心冲突'
    case 'synopsis':
      return '梗概与节拍'
    case 'outline':
      return '故事大纲'
    case 'expansion':
      return '分幕扩写'
    case 'await-assets':
    case 'generating-assets':
      return '资产生成'
    case 'idle':
    case 'confirmed':
      return ''
  }
}

/**
 * 给 LLM 喂的 user prompt 公共头部 —— 让每个 stage skill 都能"看到"上游已确认
 * 的内容，而不必每个 runStage 重复拼字符串.
 *
 * 排版优先：
 *   作者本意（idea / instruction） → 已确认的上游 stages → 当前 stage 的 draft.
 */
function composeUpstreamContext(scenarioId: string, untilExclusive: ForgeStage): string {
  const sess = useForgeChatStore.getState().getSession(scenarioId)
  const lines: string[] = []
  // 按 ForgeStage 顺序遍历, 直到 untilExclusive 之前
  const pickOrder: ForgeStage[] = [
    'await-style',
    'logline',
    'synopsis',
    'outline',
  ]
  for (const k of pickOrder) {
    if (k === untilExclusive) break
    const rec = sess.stages.records[k]
    if (!rec || rec.status !== 'confirmed') continue
    lines.push(`【${stageLabel(k)} · 已确认】`)
    lines.push(formatDraftForContext(k, rec.draft))
    lines.push('')
  }
  return lines.join('\n')
}

function formatDraftForContext(kind: ForgeStage, draft: unknown): string {
  if (!draft || typeof draft !== 'object') return ''
  const d = draft as Record<string, unknown>
  switch (kind) {
    case 'await-style':
      return [
        d.director ? `导演：${d.director}` : '',
        d.writer ? `编剧：${d.writer}` : '',
        d.visualPreset ? `视觉基调：${d.visualPreset}` : '',
        d.notes ? `备注：${d.notes}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    case 'logline':
      return typeof d.text === 'string' ? d.text : ''
    case 'synopsis':
      return typeof d.text === 'string' ? d.text : ''
    case 'outline': {
      const chapters = Array.isArray(d.chapters) ? d.chapters : []
      return chapters
        .map((c) => {
          const cc = c as Record<string, unknown>
          return `- ${String(cc.title ?? '')}：${String(cc.summary ?? '')}`
        })
        .join('\n')
    }
    default:
      return ''
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 0) Stage await-style —— 风格策展
// ─────────────────────────────────────────────────────────────────────────────

export interface RunStageStyleParams extends RunStageBaseParams {
  /** 作者最初的灵感原文，没填就尝试用 session 已有的 user 消息拼接 */
  idea?: string
}

export async function runStageStyle(p: RunStageStyleParams): Promise<void> {
  const stage: ForgeStage = 'await-style'
  await withStageEnvelope(p.scenarioId, stage, async (signal) => {
    const idea = (p.idea ?? '').trim() || guessIdeaFromMessages(p.scenarioId)
    const userPromptParts = [`【作者想法】\n${idea || '(作者尚未给出明确想法)'}`]
    if (p.instruction) {
      const cur = useForgeChatStore.getState().getSession(p.scenarioId).stages
        .records['await-style']?.draft
      userPromptParts.push(
        `【当前风格 draft】\n${formatDraftForContext('await-style', cur ?? {})}`,
      )
      userPromptParts.push(`【作者的修改诉求】\n${p.instruction}`)
    }
    userPromptParts.push('请按 skill 契约返回 JSON。')

    const raw = await streamOrFallback(
      p.llm,
      {
        systemPrompt: SKILLS.styleCurator,
        userPrompt: userPromptParts.join('\n\n'),
        temperature: 0.7,
        maxTokens: 4096,
        jsonMode: true,
      },
      () => {},
      signal,
    )
    const draft = coerceStyleDraft(raw)
    useForgeChatStore.getState().setStageDraft(p.scenarioId, 'await-style', draft)
    useForgeChatStore
      .getState()
      .setStageStatus(p.scenarioId, 'await-style', 'await-confirm')
  })
}

function coerceStyleDraft(raw: string): StageDraftStyle {
  const obj = (parseJSONLoose(stripFences(raw)) ?? {}) as Record<string, unknown>
  return {
    director: stringField(obj.director),
    writer: stringField(obj.writer),
    visualPreset: stringField(obj.visualPreset),
    notes: stringField(obj.notes),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1) Stage logline —— 一句话核心冲突 + 3 条备选
// ─────────────────────────────────────────────────────────────────────────────

export interface RunStageLoglineParams extends RunStageBaseParams {
  idea?: string
}

export async function runStageLogline(p: RunStageLoglineParams): Promise<void> {
  const stage: ForgeStage = 'logline'
  await withStageEnvelope(p.scenarioId, stage, async (signal) => {
    const idea = (p.idea ?? '').trim() || guessIdeaFromMessages(p.scenarioId)
    const userPromptParts = [
      `【作者想法】\n${idea || '(作者尚未给出明确想法)'}`,
      composeUpstreamContext(p.scenarioId, 'logline'),
    ].filter(Boolean)
    if (p.instruction) {
      const cur = useForgeChatStore.getState().getSession(p.scenarioId).stages
        .records['logline']?.draft as StageDraftLogline | undefined
      if (cur?.text) {
        userPromptParts.push(`【当前 logline】\n${cur.text}`)
      }
      userPromptParts.push(`【作者的修改诉求】\n${p.instruction}`)
    }
    userPromptParts.push('请按 skill 契约返回 JSON。')

    const raw = await streamOrFallback(
      p.llm,
      {
        systemPrompt: SKILLS.loglineWriter,
        userPrompt: userPromptParts.join('\n\n'),
        temperature: 0.85,
        maxTokens: 4096,
        jsonMode: true,
      },
      () => {},
      signal,
    )
    const draft = coerceLoglineDraft(raw)
    useForgeChatStore.getState().setStageDraft(p.scenarioId, 'logline', draft)
    useForgeChatStore
      .getState()
      .setStageStatus(p.scenarioId, 'logline', 'await-confirm')
  })
}

function coerceLoglineDraft(raw: string): StageDraftLogline {
  const obj = (parseJSONLoose(stripFences(raw)) ?? {}) as Record<string, unknown>
  const altRaw = Array.isArray(obj.alternatives) ? obj.alternatives : []
  const alternatives = altRaw
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.trim())
    .filter(Boolean)
  return {
    text: stringField(obj.text) ?? '',
    alternatives: alternatives.length > 0 ? alternatives : undefined,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) Stage synopsis —— 梗概 + beats + keyImage
// ─────────────────────────────────────────────────────────────────────────────

export async function runStageSynopsis(p: RunStageBaseParams): Promise<void> {
  const stage: ForgeStage = 'synopsis'
  await withStageEnvelope(p.scenarioId, stage, async (signal) => {
    const userPromptParts = [composeUpstreamContext(p.scenarioId, 'synopsis')]
    if (p.instruction) {
      const cur = useForgeChatStore.getState().getSession(p.scenarioId).stages
        .records['synopsis']?.draft as StageDraftSynopsis | undefined
      if (cur?.text) userPromptParts.push(`【当前梗概】\n${cur.text}`)
      userPromptParts.push(`【作者的修改诉求】\n${p.instruction}`)
    }
    userPromptParts.push('请按 skill 契约返回 JSON。')

    const raw = await streamOrFallback(
      p.llm,
      {
        systemPrompt: SKILLS.synopsisWriter,
        userPrompt: userPromptParts.join('\n\n'),
        temperature: 0.85,
        maxTokens: 6000,
        jsonMode: true,
      },
      () => {},
      signal,
    )
    const draft = coerceSynopsisDraft(raw)
    useForgeChatStore.getState().setStageDraft(p.scenarioId, 'synopsis', draft)
    useForgeChatStore
      .getState()
      .setStageStatus(p.scenarioId, 'synopsis', 'await-confirm')
  })
}

function coerceSynopsisDraft(raw: string): StageDraftSynopsis {
  const obj = (parseJSONLoose(stripFences(raw)) ?? {}) as Record<string, unknown>
  const beatsRaw = Array.isArray(obj.beats) ? obj.beats : []
  const beats = beatsRaw
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.trim())
    .filter(Boolean)
  return {
    text: stringField(obj.text) ?? '',
    beats: beats.length > 0 ? beats : undefined,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) Stage outline —— 故事大纲（章/幕标题 + summary）
//
// 对接 outline-architect skill (PR5 已加 characterAliases 字段). 这里我们把
// skill 的 acts[] 翻译成 store 的 chapters[] (字段名不同, 语义对齐).
// characterAliases 暂不进 stage draft —— 后续 normalizeScenario 已经能在 forge
// 终局阶段消费它, 不需要在 stage UI 里展示.
// ─────────────────────────────────────────────────────────────────────────────

export async function runStageOutline(p: RunStageBaseParams): Promise<void> {
  const stage: ForgeStage = 'outline'
  await withStageEnvelope(p.scenarioId, stage, async (signal) => {
    const userPromptParts = [composeUpstreamContext(p.scenarioId, 'outline')]
    if (p.instruction) {
      const cur = useForgeChatStore.getState().getSession(p.scenarioId).stages
        .records['outline']?.draft as StageDraftOutline | undefined
      if (cur?.chapters?.length) {
        userPromptParts.push(
          `【当前大纲】\n${cur.chapters
            .map((c) => `- ${c.title}：${c.summary}`)
            .join('\n')}`,
        )
      }
      userPromptParts.push(`【作者的修改诉求】\n${p.instruction}`)
    }
    userPromptParts.push('请按 outline-architect skill 契约返回 JSON。')

    const raw = await streamOrFallback(
      p.llm,
      {
        systemPrompt: SKILLS.outlineArchitect,
        userPrompt: userPromptParts.join('\n\n'),
        temperature: 0.85,
        maxTokens: 8192,
        jsonMode: true,
      },
      () => {},
      signal,
    )
    const draft = coerceOutlineDraft(raw)
    useForgeChatStore.getState().setStageDraft(p.scenarioId, 'outline', draft)
    useForgeChatStore
      .getState()
      .setStageStatus(p.scenarioId, 'outline', 'await-confirm')
  })
}

function coerceOutlineDraft(raw: string): StageDraftOutline {
  const obj = (parseJSONLoose(stripFences(raw)) ?? {}) as Record<string, unknown>
  // outline-architect skill 用 acts[] 字段; 我们要 chapters[]
  const actsRaw = Array.isArray(obj.acts) ? obj.acts : []
  const chapters = actsRaw.map((a, i) => {
    const ao = (a ?? {}) as Record<string, unknown>
    const id =
      typeof ao.id === 'string' && ao.id.trim()
        ? ao.id.trim()
        : `act_${String(i + 1).padStart(2, '0')}`
    return {
      id,
      title: stringField(ao.title) ?? `第 ${i + 1} 幕`,
      summary: stringField(ao.beat) ?? stringField(ao.summary) ?? '',
    }
  })
  return { chapters }
}

// ─────────────────────────────────────────────────────────────────────────────
// utils
// ─────────────────────────────────────────────────────────────────────────────

function stringField(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t || undefined
}

function stripFences(raw: string): string {
  let s = raw.trim()
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  }
  return s
}

/**
 * 当作者直接从 idle 跳过来 (例如 ForgeStageRoll 上点"开始风格"按钮且没传 idea),
 * 我们尝试从最近的 user 消息里捞一段当 idea —— 比要求作者重发一次输入友好.
 *
 * 取最近一条带文本的 user 消息（截到 1200 字以内）.
 */
function guessIdeaFromMessages(scenarioId: string): string {
  const sess = useForgeChatStore.getState().getSession(scenarioId)
  for (let i = sess.messages.length - 1; i >= 0; i--) {
    const m = sess.messages[i]
    if (m?.role === 'user' && m.text && m.text !== '(仅附件)') {
      return m.text.slice(0, 1200)
    }
  }
  return ''
}
