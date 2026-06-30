/**
 * Scene BGM Composer —— 把"一个或几个连贯场景"翻译成 MiniMax Music 的 cinematic brief
 *
 * 设计原则 (2026-05 作者反馈):
 *   "你的音乐还不能突兀, 你还得按照背景音乐的方式来约束一些东西.
 *    继续做吧, 多参考一些优秀案例.
 *    同时你也要确保用户能自己输入想要的感觉, 去生成,
 *    而不是完全写死我们的自动化."
 *
 * 关键约束 (skill: sceneBgmComposer 内列出 8 条 BGM 纪律, 这里再总结):
 *   - soft entry / no song structure / vocal pocket / sustained mood
 *   - loopable / subtle pulse / specific over epic / no vocal lead
 *   - 这些纪律由 LLM (skill 系统提示词) 与本文件 (兜底 + 校验) 双重把守.
 *
 * 用户输入三档 (userHintMode):
 *   - "auto" → 没填 hint, composer 完全靠 SCENES + directorPersona 推
 *   - "A"    → 中文粗描述 ("钢琴主导, 不要鼓"), 翻译成乐器/BPM/mood
 *   - "B"    → 参考曲风 ("像 90 年代港片夜戏"), 提取风格描述符
 *   - "C"    → 用户直接写英文 prompt, composer 透传 + 软化违纪条款
 *   composer 不强制用户走哪一档, 全部交给 LLM 自己识别 (skill 已写明).
 *
 * 工作流:
 *   1. 拿到 SceneBgmInput {scenes[], directorPersona?, visualStyle?, userHint?}
 *   2. 组装 userPrompt → 调 LLM (jsonMode, skill: sceneBgmComposer)
 *   3. 校验返回 JSON 是否满足 BGM 纪律 (BPM / 关键短语 / [Verse] 屏蔽 / ...)
 *   4. 不合规重试一次, 仍不合规走启发式 fallback
 *   5. 输出 SceneBgmBrief —— 直接喂给 MinimaxMusicProvider.generate({ prompt, isInstrumental: true })
 *
 * 不写副作用:
 *   - 不调 MiniMax Music, 不改 scenarioStore. 那是上层 UI 的责任.
 *   - 这层只做 "Input → Brief" 一个纯函数 (除了 LLM call).
 */

import type { Scene, Scenario, Character, Location } from '../scenario/types'
import type { TextClient } from './types'
import { SKILLS } from './skills'
import { parseJSONLoose } from './parseJSONLoose'

/** Composer 输出的最终 brief —— 可以直接喂 MinimaxMusicProvider */
export interface SceneBgmBrief {
  /** 80–180 词的英文 prompt, 直接放入 music_generation.prompt 字段 */
  brief: string
  /** 2–4 个英文小写情绪标签, UI 展示 chip */
  moodTags: string[]
  /** BPM 整数 40-160, 与 brief 文本里的数字一致 */
  bpm: number
  /** 子类型 genre, e.g. "cinematic neo-noir" */
  genre: string
  /** 2–4 件具名乐器, 每件都在 brief 里出现过 */
  keyInstruments: string[]
  /** 建议时长 (秒), 60-180. UI 默认 90 */
  estDurationSec: number
  /** 一句中文摘要, ≤40 字, UI 在 brief 上方展示 */
  chineseSummary: string
  /** 用户输入档位标识, 调试 / UI 提示用 */
  userHintMode: 'auto' | 'A' | 'B' | 'C'
  /** true = 走的是兜底路径 (无 LLM 或 LLM 输出非法) */
  fallback: boolean
}

/** Composer 输入 —— 让调用方 (UI / pipeline) 不用知道怎么序列化场景 */
export interface SceneBgmInput {
  /** 1 个或多个连贯场景. 多于 1 个时 brief 应"承接"而非"堆积" */
  scenes: Scene[]
  /** 整段剧本上下文, composer 用来取角色名 / 场所描述 */
  scenario?: Scenario
  /** 导演 persona 一句话描述, 缺省走 visualStyle 推断 */
  directorPersona?: string
  /** 视觉风格 (港风/赛博/古风...), 影响 genre 选择 */
  visualStyle?: string
  /**
   * 作者一句话需求 (中文粗描述 / 英文 prompt / 参考曲风, 三档).
   * 永远是 composer 的最高优先级, 即使违反 BGM 纪律的部分也会被静默软化保留意图.
   */
  userHint?: string
}

/** 默认时长 —— 多数场景 90s 够覆盖, multi-scene arc 由 LLM 自决拉长 */
const DEFAULT_EST_DURATION_SEC = 90
/** 默认兜底 brief —— 永不抛异常, 让 UI 流转能走完 */
const FALLBACK_BRIEF =
  'A quiet 70 BPM ambient minimalism instrumental piece. Instrumental with no vocals, sparse and airy, leaving space for dialogue. Opens from near silence with a single sustained pad as the scene unfolds. Featuring a felt piano carrying a slow recurring three-note motif, a sustained synth pad underneath, and a barely-there sub bass that breathes between phrases. Tail hovers on the pad alone, open-ended for cut.'

/**
 * 入口.
 *
 * @param llm - TextClient. 不传 / 调用失败时走 fallback.
 * @param input - 场景上下文 + 用户 hint.
 * @param opts.maxRetries - LLM 重试次数, 默认 1 (失败一次就 fallback).
 */
export async function composeSceneBgm(
  llm: TextClient | null,
  input: SceneBgmInput,
  opts?: { maxRetries?: number },
): Promise<SceneBgmBrief> {
  if (!input.scenes || input.scenes.length === 0) {
    return heuristicFallback(input)
  }
  if (!llm) {
    return heuristicFallback(input)
  }
  const maxRetries = opts?.maxRetries ?? 1
  let lastError: unknown = null
  for (let i = 0; i <= maxRetries; i++) {
    try {
      const raw = await llm.generate({
        systemPrompt: SKILLS.sceneBgmComposer,
        userPrompt: composeUserPrompt(input),
        temperature: 0.85,
        maxTokens: 900,
        jsonMode: true,
      })
      const parsed = parseJSONLoose(raw) as unknown
      const validated = validateAndNormalize(parsed)
      if (validated) return { ...validated, fallback: false }
    } catch (e) {
      lastError = e
    }
  }
  if (lastError) {
    console.warn('[sceneBgmComposer] LLM failed, using heuristic fallback:', lastError)
  }
  return heuristicFallback(input)
}

/**
 * 把 SceneBgmInput 序列化成稳定的 user prompt.
 *
 * 格式刻意稳定 —— 字段顺序固定, skill 端可按字段名取信息.
 * 后续加字段不会破坏老调用点 (LLM 不要求自由解读输入).
 */
function composeUserPrompt(input: SceneBgmInput): string {
  const lines: string[] = []
  lines.push('## SCENES')
  for (const sc of input.scenes) {
    lines.push(`- title: ${sc.title || '(untitled)'}`)
    if (sc.background) {
      lines.push(`  background: ${truncate(sc.background, 200)}`)
    }
    const summary = deriveSummary(sc)
    if (summary) lines.push(`  summary: ${truncate(summary, 200)}`)

    const charNames = resolveCharacterNames(sc, input.scenario)
    if (charNames.length > 0) {
      lines.push(`  characters: [${charNames.map((n) => JSON.stringify(n)).join(', ')}]`)
    }

    const loc = resolveLocation(sc, input.scenario)
    if (loc) lines.push(`  location: ${truncate(loc, 200)}`)

    const dialogues = pickRepresentativeDialogue(sc, 3)
    if (dialogues.length > 0) {
      lines.push(
        `  dialogueExcerpt: [${dialogues
          .map((d) => JSON.stringify(truncate(d, 80)))
          .join(', ')}]`,
      )
    }

    const moods = collectMoodTags(sc)
    if (moods.length > 0) {
      lines.push(`  mood: [${moods.map((m) => JSON.stringify(m)).join(', ')}]`)
    }
  }

  if (input.directorPersona) {
    lines.push('')
    lines.push(`directorPersona: ${JSON.stringify(truncate(input.directorPersona, 200))}`)
  }
  if (input.visualStyle) {
    lines.push(`visualPreset: ${JSON.stringify(input.visualStyle)}`)
  }
  if (input.userHint && input.userHint.trim()) {
    lines.push(`userHint: ${JSON.stringify(input.userHint.trim())}`)
  }

  return lines.join('\n')
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n - 1) + '…'
}

/** 从 Scene 的 dialogue 推导一句"剧情速记", scene.background 已存在时不再补 */
function deriveSummary(sc: Scene): string | null {
  if (!sc.dialogue || sc.dialogue.length === 0) return null
  const speaker = sc.dialogue[0]?.text ?? ''
  return speaker ? `开场对白: ${speaker}` : null
}

function resolveCharacterNames(sc: Scene, scenario?: Scenario): string[] {
  if (!sc.characterIds || sc.characterIds.length === 0) return []
  const lib: Record<string, Character> | undefined = scenario?.characters
  if (!lib) return sc.characterIds.slice(0, 4)
  return sc.characterIds
    .slice(0, 4)
    .map((id) => lib[id]?.name)
    .filter((n): n is string => Boolean(n))
}

function resolveLocation(sc: Scene, scenario?: Scenario): string | null {
  if (!sc.locationId) return null
  const loc: Location | undefined = scenario?.locations?.[sc.locationId]
  if (!loc) return null
  const desc = loc.prompt || ''
  return desc ? `${loc.name} · ${truncate(desc, 80)}` : loc.name
}

function pickRepresentativeDialogue(sc: Scene, n: number): string[] {
  if (!sc.dialogue || sc.dialogue.length === 0) return []
  return sc.dialogue
    .slice(0, n)
    .map((d) => d.text)
    .filter((t): t is string => typeof t === 'string' && t.length > 0)
}

function collectMoodTags(sc: Scene): string[] {
  // Scene 当前没有 mood 字段, 留作扩展点 —— 走 background 关键词识别
  const bg = sc.background ?? ''
  if (!bg) return []
  const tags: string[] = []
  if (/紧张|压迫|窒息|追逐|逼近/.test(bg)) tags.push('紧迫')
  if (/孤独|落寞|一个人|沉默/.test(bg)) tags.push('孤独')
  if (/悲|哭|痛|失去|离别/.test(bg)) tags.push('悲伤')
  if (/温暖|拥抱|相聚|久别|微笑/.test(bg)) tags.push('温馨')
  if (/愤怒|爆发|怒吼|崩溃/.test(bg)) tags.push('愤怒')
  if (/恐惧|颤抖|尖叫|血/.test(bg)) tags.push('恐惧')
  if (/雨|夜|霓虹|烟雾/.test(bg)) tags.push('夜雨')
  return tags
}

// ════════════════════════════════════════════════════════════════════════════
// 校验层 —— BGM 纪律守门人
// ════════════════════════════════════════════════════════════════════════════
//
// 即便 skill 系统提示词写得再严, LLM 仍可能漏: 写 [Verse]/塞作曲家名/忘 soft entry.
// 这里就是 "兜不住的全拒绝, 兜得住的全归一" 的最后一道闸.
//
// 校验失败 = 整个 brief 作废 → 让上层重试一次 / 走 fallback;
// 不做单字段修补 (修了不报警, 反而把 LLM 漏洞掩盖, 后续没法追溯).

/** 受禁词 (case-insensitive) —— 命中即拒绝 */
const FORBIDDEN_PATTERNS: RegExp[] = [
  // 歌曲结构标签
  /\[\s*verse\s*\]/i,
  /\[\s*chorus\s*\]/i,
  /\[\s*bridge\s*\]/i,
  /\[\s*hook\s*\]/i,
  /\[\s*pre-?chorus\s*\]/i,
  // 歌曲式爆发词 (BGM 不允许)
  /\b(big\s+)?drop(s|ped|ping)?\b/i,
  /\bbanger\b/i,
  /\bhits?\s+hard\b/i,
  /\bexplodes?\b/i,
  // v6.7 · 人声主导 —— BGM 纪律明确禁止"vocal lead". 歌唱主旋律会盖住对白.
  // 允许 "no vocals" / "vocal pocket" 等不引主旋律的表述.
  /\bvocal\s+lead(s|ing)?\b/i,
  /\blead\s+vocal(s|ist)?\b/i,
  /\bsung\s+(verse|chorus|melody|lyrics|hook)\b/i,
  // 真实作曲家 / 真实电影 / 真实 OST —— 列常见嫌疑名, 命中即拒
  /\bhans\s*zimmer\b/i,
  /\btrent\s+reznor\b/i,
  /\bjohn\s+williams\b/i,
  /\bennio\s+morricone\b/i,
  /\bjoe\s+hisaishi\b/i,
  /\b(久石让|汉斯·?季默|约翰·?威廉斯)\b/,
  // 真实 OST / 电影名 (典型容易被 LLM 引用的几个)
  /\binterstellar\b/i,
  /\binception\b/i,
  /\bdune\b\s+(score|soundtrack)/i,
]

/** 必须出现的"骨架短语" —— 三大类至少各命中一条 */
const REQUIRED_SOFT_ENTRY: RegExp[] = [
  /\bopens?\s+from\b/i,
  /\bbegins?\s+(on|with|from)\b/i,
  /\bemerges?\s+out\s+of\b/i,
  /\bfades?\s+in\s+from\b/i,
  /\bnear\s+silence\b/i,
  /\bsingle\s+(held|sustained)\b/i,
]
const REQUIRED_OPEN_TAIL: RegExp[] = [
  /\bopen-?ended\b/i,
  /\bhover(s|ing)\b/i,
  /\bloops?\s+back\b/i,
  /\btail\s+on\b/i,
  /\bfades?\s+(on|out|to|naturally)\b/i,
]
const REQUIRED_VOCAL_POCKET: RegExp[] = [
  /\bleav(es?|ing)\s+space\s+for\s+dialog(ue)?\b/i,
  /\bscooped\s+mids\b/i,
  /\bsparse\b/i,
  /\bairy\s+mids\b/i,
  /\bvocal\s+pocket\b/i,
]

interface ValidatedBrief {
  brief: string
  moodTags: string[]
  bpm: number
  genre: string
  keyInstruments: string[]
  estDurationSec: number
  chineseSummary: string
  userHintMode: 'auto' | 'A' | 'B' | 'C'
}

/**
 * 把 LLM 返回的 raw JSON 校验成合规 brief, 不合规 → null (让上层 fallback).
 *
 * 校验项严格对应 skill 里 16 项 self-check:
 *   - 字段类型 / 长度 / 范围
 *   - BGM 纪律 (soft entry / open tail / vocal pocket)
 *   - 受禁词扫描
 *   - bpm 与 brief 内 BPM 数字一致
 *   - keyInstruments 全部出现在 brief 文本里
 *   - moodTags 不能全是"空话词" (good/epic/awesome)
 */
function validateAndNormalize(raw: unknown): ValidatedBrief | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>

  // 1. brief —— 80–180 词, 单段, 含 BPM + genre + ≥2 乐器
  const brief = typeof r.brief === 'string' ? r.brief.trim() : ''
  if (!brief) return null
  const wordCount = brief.split(/\s+/).filter(Boolean).length
  if (wordCount < 60 || wordCount > 220) return null
  if (/\n\s*\n/.test(brief)) return null // 多段 → 拒

  // 2. 受禁词扫描
  for (const pat of FORBIDDEN_PATTERNS) {
    if (pat.test(brief)) return null
  }

  // 3. BGM 纪律: 三类骨架短语各至少命中一条
  if (!REQUIRED_SOFT_ENTRY.some((p) => p.test(brief))) return null
  if (!REQUIRED_OPEN_TAIL.some((p) => p.test(brief))) return null
  if (!REQUIRED_VOCAL_POCKET.some((p) => p.test(brief))) return null

  // 4. bpm —— 与 brief 内的 BPM 数字一致
  const bpm = Math.round(Number(r.bpm))
  if (!Number.isFinite(bpm) || bpm < 40 || bpm > 160) return null
  const bpmInBrief = brief.match(/\b(\d{2,3})\s*BPM\b/i)
  if (!bpmInBrief || Number(bpmInBrief[1]) !== bpm) return null

  // 5. genre —— ≤30 char, 不能是 "music" / "score" / "soundtrack" 这类循环词
  const genre = typeof r.genre === 'string' ? r.genre.trim().toLowerCase() : ''
  if (!genre || genre.length > 30) return null
  if (/^(music|score|soundtrack|audio|sound)$/i.test(genre)) return null

  // 6. keyInstruments —— 2–4 件, 全部具体 (≥2 词或含连字符), 全部出现在 brief
  if (!Array.isArray(r.keyInstruments)) return null
  const keyInstruments = (r.keyInstruments as unknown[])
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map((x) => x.trim())
  if (keyInstruments.length < 2 || keyInstruments.length > 4) return null
  for (const ins of keyInstruments) {
    if (ins.length > 30) return null
    // 单词类 (drums / synth / brass) 直接拒 —— 必须有限定词
    if (/^[a-z]+$/i.test(ins) && !/^(taiko|erhu|guzheng|piccolo|rhodes|mellotron|theremin)$/i.test(ins)) {
      return null
    }
    if (!brief.toLowerCase().includes(ins.toLowerCase())) return null
  }

  // 7. moodTags —— 2–4 个, 英文小写, 不能是"空话词"
  if (!Array.isArray(r.moodTags)) return null
  const moodTags = (r.moodTags as unknown[])
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map((x) => x.trim().toLowerCase())
  if (moodTags.length < 2 || moodTags.length > 4) return null
  const EMPTY_MOOD_WORDS = new Set([
    'good', 'great', 'awesome', 'amazing', 'cool', 'nice',
    'epic', 'huge', 'massive', 'big', 'high-quality', 'quality',
  ])
  if (moodTags.every((t) => EMPTY_MOOD_WORDS.has(t))) return null
  for (const t of moodTags) {
    if (t.length > 24 || /[A-Z\s]/.test(t)) return null // 大写或含空格 → 不合 lowercase + hyphen 约定
  }

  // 8. estDurationSec —— 60–180
  const estDurationSec = Math.round(Number(r.estDurationSec))
  if (!Number.isFinite(estDurationSec) || estDurationSec < 60 || estDurationSec > 180) {
    return null
  }

  // 9. chineseSummary —— ≤40 中文字符, 含至少 1 个汉字
  const chineseSummary =
    typeof r.chineseSummary === 'string' ? r.chineseSummary.trim() : ''
  if (!chineseSummary || chineseSummary.length > 60) return null
  if (!/[\u4e00-\u9fa5]/.test(chineseSummary)) return null

  // 10. userHintMode —— "auto" | "A" | "B" | "C"
  const rawMode = typeof r.userHintMode === 'string' ? r.userHintMode.trim() : 'auto'
  const userHintMode: ValidatedBrief['userHintMode'] =
    rawMode === 'A' || rawMode === 'B' || rawMode === 'C' ? rawMode : 'auto'

  return {
    brief,
    moodTags,
    bpm,
    genre,
    keyInstruments,
    estDurationSec,
    chineseSummary,
    userHintMode,
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 启发式兜底 —— 永远不抛, 让 UI 流转能走完
// ════════════════════════════════════════════════════════════════════════════
//
// 触发条件:
//   - 没传 llm
//   - LLM 调用 / 解析全部失败
//   - 校验全部失败
//
// 策略: 从 input 关键词推一档"安全套" —— ambient minimalism / 70 BPM / felt piano
// + pad + sub bass. 这一档对任何场景都不抢戏, 是真正"播了不出错"的兜底.
// 如果 input 里能识别到强情绪 (action / horror / warm), 在 mood 上贴一下,
// 但 BGM 纪律 (soft entry / open tail / vocal pocket) 永远不破.

function heuristicFallback(input: SceneBgmInput): SceneBgmBrief {
  const { genre, bpm, instruments, moodTags, chineseSummary } =
    pickFallbackProfile(input)

  // 根据 profile 拼一段安全 brief, 三类骨架短语全员到位
  const insSentence =
    instruments.length >= 3
      ? `Featuring ${instruments[0]}, ${instruments[1]}, and ${instruments[2]} answering between phrases.`
      : `Featuring ${instruments[0]} and ${instruments[1]} answering between phrases.`

  const brief = [
    `A quiet ${bpm} BPM ${genre} instrumental piece.`,
    'Instrumental with no vocals, sparse and airy, leaving space for dialogue.',
    'Opens from near silence with a single sustained pad as the scene unfolds.',
    insSentence,
    'Tail hovers on the pad alone, open-ended for cut.',
  ].join(' ')

  return {
    brief,
    moodTags,
    bpm,
    genre,
    keyInstruments: instruments,
    estDurationSec: DEFAULT_EST_DURATION_SEC,
    chineseSummary,
    userHintMode: input.userHint && input.userHint.trim() ? 'A' : 'auto',
    fallback: true,
  }
}

interface FallbackProfile {
  genre: string
  bpm: number
  instruments: string[]
  moodTags: string[]
  chineseSummary: string
}

function pickFallbackProfile(input: SceneBgmInput): FallbackProfile {
  // 把 hint + 全场 background + visualStyle 拼起来当关键词识别土壤
  const blob = [
    input.userHint ?? '',
    input.visualStyle ?? '',
    input.directorPersona ?? '',
    ...input.scenes.map((s) => s.background ?? ''),
    ...input.scenes.map((s) => s.title ?? ''),
  ]
    .join(' ')
    .toLowerCase()

  // 战斗 / 追逐 → 史诗节制档
  if (/战斗|追逐|逃|爆炸|action|chase|fight|battle/.test(blob)) {
    return {
      genre: 'orchestral epic underscore',
      bpm: 120,
      instruments: ['low taiko', 'agitated tremolo strings', 'sustained brass section'],
      moodTags: ['urgent', 'cinematic', 'tense'],
      chineseSummary: '120 BPM 史诗管弦底乐, 太鼓+弦乐+铜管, 留对白空间。',
    }
  }
  // 恐怖 / 反派
  if (/恐惧|血|尸|horror|demon|evil|villain|反派/.test(blob)) {
    return {
      genre: 'dark cinematic underscore',
      bpm: 70,
      instruments: ['bowed double bass', 'low brass cluster', 'distorted cello'],
      moodTags: ['ominous', 'tense', 'cinematic'],
      chineseSummary: '70 BPM 暗色压迫底乐, 低音弦+低铜管+失真大提, 不用强鼓。',
    }
  }
  // 温情 / 回忆 / 重逢
  if (/温|相聚|拥抱|久别|warm|home|family|reunion/.test(blob)) {
    return {
      genre: 'warm folk score',
      bpm: 76,
      instruments: ['acoustic guitar fingerpicking', 'soft Rhodes', 'sustained string pad'],
      moodTags: ['warm', 'nostalgic', 'tender'],
      chineseSummary: '76 BPM 暖色民谣底乐, 木吉他+电钢+弦乐铺底。',
    }
  }
  // 古风 / 武侠
  if (/古|武|江湖|侠|martial|ancient|dynasty/.test(blob)) {
    return {
      genre: 'east-asian cinematic',
      bpm: 70,
      instruments: ['erhu', 'guzheng', 'bamboo flute'],
      moodTags: ['contemplative', 'cinematic', 'lonely'],
      chineseSummary: '70 BPM 东方电影感底乐, 二胡+古筝+笛, 全程留白。',
    }
  }
  // 赛博 / 科幻
  if (/赛博|cyber|sci-?fi|future|霓虹|neon|数据|consciousness/.test(blob)) {
    return {
      genre: 'ambient electronic',
      bpm: 64,
      instruments: ['analog synth pad', 'sub bass', 'felted piano'],
      moodTags: ['digital', 'introspective', 'cinematic'],
      chineseSummary: '64 BPM 氛围电子底乐, 模拟 pad+sub+毡化钢琴。',
    }
  }
  // 港风 / 80s 都市
  if (/港|sax|saxophone|80s|retro|霓虹/.test(blob)) {
    return {
      genre: '80s synth-noir cinematic',
      bpm: 80,
      instruments: ['tenor saxophone', 'DX7 Rhodes', 'analog pad'],
      moodTags: ['nostalgic', 'lonely', 'cinematic'],
      chineseSummary: '80 BPM 港风夜城底乐, 萨克斯+电钢+合成 pad。',
    }
  }

  // 万用安全档 —— ambient minimalism, 任何场景播了不出错
  return {
    genre: 'ambient minimalism',
    bpm: 70,
    instruments: ['felted piano', 'sustained synth pad', 'sub bass'],
    moodTags: ['contemplative', 'cinematic', 'introspective'],
    chineseSummary: '70 BPM 极简氛围底乐, 毡化钢琴+pad+sub, 不抢戏。',
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 测试钩子 —— 给单测 / playground 用
// ════════════════════════════════════════════════════════════════════════════

/** @internal 单测可见 */
export const __test = {
  validateAndNormalize,
  heuristicFallback,
  composeUserPrompt,
  FALLBACK_BRIEF,
  FORBIDDEN_PATTERNS,
}

