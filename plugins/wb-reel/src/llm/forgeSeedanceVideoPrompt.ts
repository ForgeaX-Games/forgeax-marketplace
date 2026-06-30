/**
 * forgeSeedanceVideoPrompt —— sd2-pe 视频提示词合成器（P2）
 *
 * 把「分镜(Shot[]) + 锚点集(SeedanceReferenceSet) + 导演 persona + 视觉风格」
 * 翻译成符合 **Seedance 2.0 + sd2-pe** 契约的工程化视频提示词。
 *
 * 设计要点（落实 src/llm/skills/seedance2-prompt-optimizer.skill.md）：
 *   - **零绝对秒数**：用 `镜头1 / 镜头2`，绝不写 `0–3s`；真实时长由 P3 发送层结算。
 *   - **一镜一运镜**：每镜只取一种运镜（推/拉/摇/移/固定/跟拍 择一）。
 *   - **主体绑定语法**：`<主体N>@图片N` / `<主体N> 的面部特征参考 @图片N（大头照）`；
 *     严禁裸写 `[asset-xxx]`，严禁 `@图片N` 紧接动词（数字粘连歧义）。
 *   - **路径分流**：单镜 / 编辑 / 延长 / 组合 → 路径 A（一段式）；
 *     ≥2 镜的多模态参考影视化场景 → 路径 B（三段论：总设定+主体定义 / 镜头分镜 / 风格+约束包）。
 *   - **强制兜底包**：画质 + 稳定 + 字幕兜底 + 水印/Logo；多主体挂双胞胎兜底；非写实挂风格锚定。
 *   - **音频/台词/字幕特殊符号**：`（BGM）` `<音效>` `{台词}` `【字幕】`。
 *
 * 架构（便于 TDD）：
 *   - 纯函数 `composeSubjectBindings` / `composeShotBlock` / `composeGuardrails` /
 *     `decidePromptPath` / `composeSeedanceDraft` 产出**可断言的工程化骨架**，不打 LLM。
 *   - `forgeSeedanceVideoPrompt(llm, args)` 仅让 LLM 做「润色 + 合并」，
 *     解析失败一律降级回纯函数骨架（绝不阻断生产）。
 */

import type { Shot, VisualStyle } from '../scenario/types'
import type { DirectorPersona } from './directorPersonas'
import { serializePersonaToPrompt } from './directorPersonas'
import type { SeedanceReferenceSet } from './buildSeedanceReferenceSet'
import { SKILLS } from './skills'
import { parseJSONLoose } from './parseJSONLoose'
import type { TextClient } from './types'
import { streamOrFallback } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/** sd2-pe 任务分类（决定路径与句式）。 */
export type SeedanceTaskType = 'multimodal' | 'edit' | 'extend' | 'compose'

export interface ForgeSeedancePromptArgs {
  /** 本节点已拆的镜头（来自 P2.5 / forgeStoryboard / forgePromptTrioForAct） */
  shots: Shot[]
  /** P1-A 装配器产出的统一锚点集 */
  refSet: SeedanceReferenceSet
  /** 导演风格（运镜/剪辑/节奏） */
  persona: DirectorPersona
  /** 全局视觉风格 —— 决定渲染质感词 + 是否挂风格锚定 */
  visualStyle?: VisualStyle
  /** sd2-pe 任务分类；缺省按 'multimodal'（最常见的图生视频） */
  taskType?: SeedanceTaskType
}

export interface ForgeSeedancePromptResult {
  /** 最终工程化提示词（无秒数，含 <主体N>/@图片N 绑定） */
  prompt: string
  /** 'A' 单镜一段式 / 'B' 多镜三段论 */
  path: 'A' | 'B'
  /** sd2-pe「优化问题」透明披露（已补全项 + 检出病灶） */
  disclosures: string[]
}

export interface ForgeSeedancePromptStreamOpts {
  onProgress?: (ev:
    | { kind: 'stage'; label: string; detail?: string }
    | { kind: 'delta'; delta: string; cumulative: string }
  ) => void
  signal?: AbortSignal
}

// ─────────────────────────────────────────────────────────────────────────────
// 视觉风格 → 渲染质感锚定（与出图侧质感保持一致；P2.6 的文案落点之一）
// ─────────────────────────────────────────────────────────────────────────────

interface StyleAnchor {
  /** 一句话定调用的质感短语 */
  tone: string
  /** 非写实风格的强制风格锚定词（写实为 undefined） */
  anchor?: string
  /** 是否写实（驱动是否需要人脸打码语义；此处仅用于披露） */
  realistic: boolean
}

const STYLE_ANCHORS: Record<VisualStyle, StyleAnchor> = {
  photoreal: { tone: '写实电影质感，自然光影、真实材质层次（可分纪实硬光/柔光人像/电影胶片三档）', realistic: true },
  anime: { tone: '2D 日漫赛璐珞质感，干净线条、通透上色（可分精致电影级/大众扁平 TV 两档）', anchor: '2D 日漫风格', realistic: false },
  cartoon: { tone: '3D 渲染卡通质感，圆润体积感、柔和次表面散射（可分电影级 CG/扁平绘本两档）', anchor: '3D 卡通渲染风格', realistic: false },
  pixelart: { tone: '像素艺术质感，规整像素网格、克制抖动', anchor: '像素艺术风格', realistic: false },
  watercolor: { tone: '水彩手绘质感，湿边晕染、留白透气', anchor: '水彩手绘风格', realistic: false },
  ink: { tone: '水墨国风质感，浓淡干湿、飞白与留白', anchor: '水墨国风风格', realistic: false },
}

function styleAnchorFor(style?: VisualStyle): StyleAnchor {
  if (!style) return { tone: '电影质感，自然光影', realistic: true }
  return STYLE_ANCHORS[style] ?? { tone: '电影质感，自然光影', realistic: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// 运镜：一镜一运镜（从 shot.cameraHint 关键词 → 单一运镜；缺则按 persona 默认）
// ─────────────────────────────────────────────────────────────────────────────

/** 规范运镜 token（仅 6 种，互斥；保证「一镜一运镜」可断言）。 */
export type CameraMoveToken = '推进' | '拉远' | '摇移' | '跟移' | '固定' | '升降'

const CAMERA_PHRASE: Record<CameraMoveToken, string> = {
  推进: '镜头缓慢向前推进',
  拉远: '镜头缓慢向后拉远',
  摇移: '镜头水平摇移',
  跟移: '镜头跟拍移动',
  固定: '固定机位',
  升降: '镜头垂直升降',
}

/** persona → 默认运镜（cameraHint 缺省时回退）。 */
const PERSONA_DEFAULT_MOVE: Record<string, CameraMoveToken> = {
  'villeneuve-epic': '推进',
  'fincher-noir': '固定',
  'hitchcock-suspense': '推进',
  'wong-karwai': '跟移',
  'shinkai-anime': '摇移',
  'miller-kinetic': '跟移',
  'cyberpunk-neonoir': '跟移',
}

/**
 * 从 shot 推断**唯一**运镜 token。
 * 优先读 shot.cameraHint 关键词；命中多类时按「推/拉/摇/跟/升/固定」固定优先级取第一个；
 * 都不命中 → persona 默认 → 'fixed'。
 */
export function pickCameraMove(shot: Shot, persona: DirectorPersona): CameraMoveToken {
  const hint = (shot.cameraHint ?? '').toLowerCase()
  const test = (kws: string[]) => kws.some((k) => hint.includes(k))
  // 固定优先级顺序，命中即返回——绝不叠加，落实「一镜一运镜」
  if (test(['推', 'push', 'dolly-in', 'dolly in', 'zoom in', 'track-in', 'track in', 'in '])) return '推进'
  if (test(['拉', 'pull', 'dolly-out', 'dolly out', 'zoom out', 'pull-out', 'pull out'])) return '拉远'
  if (test(['摇', 'pan', 'whip', 'tilt'])) return '摇移'
  if (test(['跟', 'follow', 'track', '移', 'crane', 'handheld', '手持'])) return '跟移'
  if (test(['升', '降', 'rise', 'boom', 'jib'])) return '升降'
  if (test(['固定', 'fixed', 'static', 'lock', 'still'])) return '固定'
  return PERSONA_DEFAULT_MOVE[persona.id] ?? '固定'
}

// ─────────────────────────────────────────────────────────────────────────────
// 纯函数 · 可单测
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 复杂度路径分流：≥2 镜 → 'B'（三段论）；否则 'A'（一段式）。
 *
 * 注意：编辑 / 延长 / 组合任务在 `composeSeedanceDraft` 里会**强制覆盖为 'A'**
 * （单点操作，sd2-pe 规定一律路径 A），这里只按镜数给「多模态参考」分流。
 */
export function decidePromptPath(shots: Shot[]): 'A' | 'B' {
  return shots.length >= 2 ? 'B' : 'A'
}

/**
 * 第一段「主体定义」文本：把 refSet.subjects 翻译成 sd2-pe 绑定句。
 *
 * 规则：
 *   - 有大头照 + 全身照：`<主体N>（name）的面部特征参考 @图片{h}（大头照），妆造参考 @图片{f}（全身照）`
 *   - 仅大头照 / 仅全身照：`<主体N>（name）@图片{ord}`（单图绑定形态）
 *   - 同时把场景锚点（location）绑为 `将 @图片{ord} 中的场景 定义为 <场景1>`
 * 主体序号 N 按 subjects 出现顺序 1 起。
 */
export function composeSubjectBindings(refSet: SeedanceReferenceSet): string {
  const lines: string[] = []

  refSet.subjects.forEach((s, i) => {
    const n = i + 1
    const name = s.subject
    if (s.headshotOrd != null && s.fullbodyOrd != null) {
      lines.push(
        `<主体${n}>（${name}）的面部特征参考 @图片${s.headshotOrd}（大头照），妆造参考 @图片${s.fullbodyOrd}（全身照）`,
      )
    } else if (s.headshotOrd != null) {
      lines.push(`<主体${n}>（${name}）@图片${s.headshotOrd}（大头照）`)
    } else if (s.fullbodyOrd != null) {
      lines.push(`<主体${n}>（${name}）@图片${s.fullbodyOrd}（全身照）`)
    }
  })

  // 场景 / 道具 / 展位锚点（非主体，但路径 B 第一段一并声明，软参考）
  const location = refSet.images.find((im) => im.kind === 'location')
  if (location) {
    lines.push(`将 @图片${location.ord} 中的场景 定义为 <场景1>`)
  }
  const props = refSet.images.filter((im) => im.kind === 'prop')
  props.forEach((p, i) => {
    lines.push(`将 @图片${p.ord} 中的${p.label ?? '道具'} 定义为 <道具${i + 1}>`)
  })
  const blockout = refSet.images.find((im) => im.kind === 'blockout')
  if (blockout) {
    lines.push(`@图片${blockout.ord}（机位静帧）仅作镜头机位与构图参考，不作画面内容来源`)
  }

  return lines.join('；\n')
}

/**
 * 把一句台词/音效/字幕翻译为 sd2-pe 特殊符号包裹形式，拼成本镜「音频信息」段。
 */
function composeShotAudio(shot: Shot): string {
  const parts: string[] = []
  if (shot.dialogueText?.trim()) parts.push(`台词 {${shot.dialogueText.trim()}}`)
  if (shot.audioHint?.trim()) parts.push(`<${shot.audioHint.trim()}>`)
  return parts.length > 0 ? parts.join('，') : '环境氛围音'
}

/**
 * 单镜分镜文本（路径 B 第二段的一行）——四要素：运镜 → 主体动作与表情 → 站位/空间 → 音频。
 *
 * - **零绝对秒数**：不写 durationSec，只用 `镜头N`。
 * - **一镜一运镜**：运镜由 pickCameraMove 取唯一 token。
 * - 主体动作以 shot.prompt 为核心，叠加表演 / 潜台词外化提示（供 LLM 润色时挂 <主体N>）。
 */
export function composeShotBlock(shot: Shot, persona: DirectorPersona): string {
  const n = (shot.order ?? 0) + 1
  const move = pickCameraMove(shot, persona)
  const movePhrase = CAMERA_PHRASE[move]

  const actionParts: string[] = []
  const core = shot.prompt?.trim()
  if (core) actionParts.push(core)
  if (shot.performance?.trim()) actionParts.push(`（表演：${shot.performance.trim()}）`)
  if (shot.subtext?.trim()) actionParts.push(`（潜台词外化为具体身体细节：${shot.subtext.trim()}）`)
  const action = actionParts.length > 0 ? actionParts.join('') : '主体保持低缓连续的小幅动作'

  const audio = composeShotAudio(shot)

  return `镜头${n}：【运镜】${movePhrase}（仅此一种运镜，不叠加）；【主体动作与表情】${action}；【音频】${audio}`
}

/**
 * 第三段「风格 + 约束包」。按场景自动挂载 sd2-pe 标准兜底包。
 * 返回多行文本（路径 B 直接作第三段；路径 A 折叠到末尾串联）。
 */
export function composeGuardrails(args: ForgeSeedancePromptArgs): string {
  const style = styleAnchorFor(args.visualStyle)
  const multiSubject = args.refSet.subjects.length >= 2

  const lines: string[] = []
  // 整体美术调性 / 视觉风格（与出图质感一致）
  lines.push(`整体美术调性：${style.tone}`)
  // 差异化（P2.6 防千篇一律）：与出图所用质感保持一致，按情绪选层次而非套默认模子
  lines.push(
    '差异化：在该风格大类内按场景情绪选定质感层次（写实分纪实硬光/柔光人像/胶片；卡通分电影级 CG/扁平），与出图所用质感词保持一致，避免千篇一律的默认套路',
  )
  // 画质包（默认必挂）
  lines.push('画质包：高清，细节丰富，电影质感，色彩自然，光影柔和')
  // 稳定包（默认必挂）
  lines.push('稳定包：人物面部稳定不变形、五官清晰、动作连贯自然，不僵硬，无穿模无卡顿')
  // 字幕兜底（非文字生成任务必挂）
  lines.push('字幕兜底：保持无字幕，避免生成任何文字或字幕')
  // 水印 / Logo 兜底（默认必挂）
  lines.push('水印兜底：不要生成水印；不要生成 Logo')
  // 双胞胎兜底（多主体必挂）
  if (multiSubject) {
    lines.push(
      '双胞胎兜底：视频全程禁止出现外形、着装、配饰完全一致的人物，禁止生成同款分身、双胞胎效果，同一画面中仅保留单个对应人物，不出现人物重复复刻',
    )
  }
  // 风格锚定（非写实必挂）
  if (style.anchor) {
    lines.push(`风格锚定：全程严格保持「${style.anchor}」，禁止漂移到写实或其它画风`)
  }

  return lines.join('\n')
}

/**
 * 纯函数骨架合成 —— 不打 LLM，产出可断言的工程化提示词草稿。
 *
 * 路径 A：单段式（编辑 / 延长 / 组合 任务恒走此路；单镜多模态参考亦走此路）。
 * 路径 B：三段论（≥2 镜的多模态参考影视化场景）。
 */
export function composeSeedanceDraft(args: ForgeSeedancePromptArgs): ForgeSeedancePromptResult {
  const taskType = args.taskType ?? 'multimodal'
  const style = styleAnchorFor(args.visualStyle)

  // 编辑 / 延长 / 组合 = 单点操作，sd2-pe 规定一律路径 A
  const path: 'A' | 'B' =
    taskType === 'multimodal' ? decidePromptPath(args.shots) : 'A'

  const disclosures = collectDisclosures(args, path, style)

  if (path === 'A') {
    return { prompt: composePathA(args, taskType), path, disclosures }
  }
  return { prompt: composePathB(args), path, disclosures }
}

function collectDisclosures(
  args: ForgeSeedancePromptArgs,
  path: 'A' | 'B',
  style: StyleAnchor,
): string[] {
  const out: string[] = []
  out.push(`复杂度判定 → 路径 ${path}（${path === 'A' ? '单点操作 / 单镜一段式' : '多镜影视化三段论'}）`)
  out.push('已自动挂载画质包 + 稳定包 + 字幕兜底 + 水印/Logo 兜底')
  out.push('镜头序号化（镜头1/镜头2/…），未写绝对秒数 —— 真实时长交由发送层结算（宁多勿少）')
  out.push('默认动作幅度采用低缓连续小动作，规避狂奔 / 大跳 / 剧烈翻滚等高爆发动态')
  if (args.refSet.subjects.length >= 2) {
    out.push('多主体场景已挂双胞胎兜底 + 强方位约束建议')
  }
  if (style.anchor) {
    out.push(`非写实风格已显式锚定「${style.anchor}」防止风格漂移`)
  }
  for (const r of args.refSet.droppedReasons) {
    out.push(`锚点装配告警：${r}`)
  }
  return out
}

/** 任务句式前缀（路径 A 主语句）。 */
function taskLead(taskType: SeedanceTaskType, refSet: SeedanceReferenceSet): string {
  switch (taskType) {
    case 'edit':
      return '严格编辑 @视频1，'
    case 'extend':
      return '向后延长 @视频1，'
    case 'compose': {
      const firstImg = refSet.images[0]
      const ref = firstImg ? `参考 @图片${firstImg.ord}，` : ''
      return `${ref}严格编辑 @视频1，`
    }
    case 'multimodal':
    default: {
      const sub = refSet.subjects[0]
      if (sub) {
        const ord = sub.headshotOrd ?? sub.fullbodyOrd
        return `参考 @图片${ord} 中的 <主体1>（${sub.subject}），生成`
      }
      return '生成'
    }
  }
}

function composePathA(args: ForgeSeedancePromptArgs, taskType: SeedanceTaskType): string {
  const lead = taskLead(taskType, args.refSet)
  const shot = args.shots[0]
  const move = shot ? CAMERA_PHRASE[pickCameraMove(shot, args.persona)] : ''
  const action = shot?.prompt?.trim() || '主体在同一时空内完成单一连续动作'
  const audio = shot ? composeShotAudio(shot) : '环境氛围音'

  // 路径 A：句式直组——主语句 + 简短动作（含唯一运镜）+ 音频 + 折叠兜底包
  const body = `${lead}${action}${move ? `，${move}` : ''}，${audio}。`
  const guard = composeGuardrails(args).split('\n').join('；')
  return `${body}${guard}。`
}

function composePathB(args: ForgeSeedancePromptArgs): string {
  const style = styleAnchorFor(args.visualStyle)
  // 第一段：总体设定（一句话定调） + 主体定义
  const setting = `整体设定：${args.persona.tagline}，${style.tone}。`
  const bindings = composeSubjectBindings(args.refSet)
  const para1 = bindings ? `${setting}\n${bindings}。` : `${setting}`

  // 第二段：镜头分镜
  const para2 = args.shots.map((s) => composeShotBlock(s, args.persona)).join('\n\n')

  // 第三段：风格 + 约束包
  const para3 = composeGuardrails(args)

  return [
    '【第一段 · 总体设定 + 主体定义】',
    para1,
    '',
    '【第二段 · 镜头分镜】',
    para2,
    '',
    '【第三段 · 风格 + 约束包】',
    para3,
  ].join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// LLM 润色入口（骨架由纯函数生成，LLM 仅做润色 + 合并；失败降级回骨架）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 入口 —— 合成 Seedance 2.0 工程化视频提示词。
 *
 * 流程：纯函数出骨架 → 喂 sd2-pe skill 让 LLM 润色合并 → 解析 JSON `{ prompt, disclosures? }`。
 * 任何解析异常一律降级回纯函数骨架，保证生产不阻断。
 */
export async function forgeSeedanceVideoPrompt(
  llm: TextClient,
  args: ForgeSeedancePromptArgs,
  opts: ForgeSeedancePromptStreamOpts = {},
): Promise<ForgeSeedancePromptResult> {
  const draft = composeSeedanceDraft(args)

  const systemPrompt = [
    serializePersonaToPrompt(args.persona),
    '',
    '---',
    '',
    SKILLS.seedance2PromptOptimizer,
  ].join('\n')

  const userPrompt = buildPolishUserPrompt(args, draft)

  opts.onProgress?.({
    kind: 'stage',
    label: '调用 sd2-pe 提示词优化器',
    detail: `${llm.getProviderName()} · ${llm.getModel()} · 路径 ${draft.path} · ${args.shots.length} 镜`,
  })

  let raw = ''
  try {
    raw = await streamOrFallback(
      llm,
      { systemPrompt, userPrompt, temperature: 0.6, maxTokens: 4000, jsonMode: true },
      (ev) => {
        if (ev.type === 'text') {
          opts.onProgress?.({ kind: 'delta', delta: ev.delta, cumulative: ev.cumulative })
        } else if (ev.type === 'done') {
          opts.onProgress?.({
            kind: 'stage',
            label: 'sd2-pe 输出完成',
            detail: `${ev.full.length} 字 · ${ev.latencyMs}ms`,
          })
        }
      },
      opts.signal,
    )
  } catch (e) {
    opts.onProgress?.({
      kind: 'stage',
      label: 'sd2-pe 调用失败，降级回工程化骨架',
      detail: e instanceof Error ? e.message : String(e),
    })
    return draft
  }

  const parsed = parseJSONLoose(raw)
  if (!parsed || typeof parsed !== 'object') {
    opts.onProgress?.({ kind: 'stage', label: '解析失败，降级回工程化骨架' })
    return draft
  }
  const obj = parsed as { prompt?: unknown; disclosures?: unknown }
  const prompt = typeof obj.prompt === 'string' && obj.prompt.trim() ? obj.prompt.trim() : draft.prompt
  const extraDisclosures = Array.isArray(obj.disclosures)
    ? obj.disclosures.filter((x): x is string => typeof x === 'string')
    : []

  return {
    prompt,
    path: draft.path,
    // 纯函数披露在前（工程事实），LLM 补充披露在后（病灶/补全说明）
    disclosures: [...draft.disclosures, ...extraDisclosures],
  }
}

/** 给 sd2-pe skill 的 user prompt：贴骨架草稿 + 约束「只润色不破坏结构」。 */
export function buildPolishUserPrompt(
  args: ForgeSeedancePromptArgs,
  draft: ForgeSeedancePromptResult,
): string {
  const lines: string[] = []
  lines.push(`【任务】下面是已按 Seedance 2.0 工程规范生成的「${draft.path === 'A' ? '路径 A 单段式' : '路径 B 三段论'}」提示词骨架。`)
  lines.push('请在**不破坏其结构与工程约束**的前提下润色合并，使语言更自然连贯、动作更具体可执行。')
  lines.push('')
  lines.push('【必须保持的硬约束】')
  lines.push('1. 绝不写绝对秒数（禁止出现 0–3s 之类），镜头一律用「镜头1 / 镜头2」序号。')
  lines.push('2. 一镜一运镜：每个镜头只保留一种运镜，禁止推拉摇移叠加。')
  lines.push('3. 主体引用一律用 <主体N> 或 <主体N>@图片N；严禁裸写 [asset-xxx]；@图片N 后不得紧接动词。')
  lines.push('4. 保留画质包 + 稳定包 + 字幕兜底 + 水印/Logo 兜底；多主体保留双胞胎兜底；非写实保留风格锚定。')
  lines.push('5. 台词用 {}、音效用 <>、字幕用 【】、背景音乐用 （）。')
  lines.push('')
  lines.push('【输出格式】严格返回单一 JSON 对象：`{"prompt": "<润色后的完整提示词>", "disclosures": ["<补充披露1>", ...]}`，不要任何额外文字。')
  lines.push('')
  lines.push('【提示词骨架】')
  lines.push('"""')
  lines.push(draft.prompt)
  lines.push('"""')
  return lines.join('\n')
}
