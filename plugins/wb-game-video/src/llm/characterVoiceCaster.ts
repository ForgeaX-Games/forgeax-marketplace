/**
 * Character Voice Caster —— 给角色推荐 3 个 TTS 候选音色 + 自创基准话语
 *
 * 设计动因 (2026-05 作者反馈):
 *   "现在下拉可选太多了，没绑定角色，你要将角色的描述、性格等各种信息，
 *    让他生成这个基准话语，基准话语你别侵权啊，用我们自己的。然后这段话
 *    就会伴随角色给到视频模型。"
 *
 * 工作流:
 *   1. 拿到 Character {name, prompt, anchor, aliases, appearanceVariants}
 *   2. 把 TTS_VOICE_PRESETS 当作"白名单"喂给 LLM (skill: characterVoiceCaster)
 *   3. LLM 出: { sampleText, candidates: [3 项], notes? }
 *      - sampleText 是这个角色会说的一句台词 (18-32 字, 自创不侵权)
 *      - candidates 是 3 个 voiceType + label + reason, 必须都来自白名单
 *   4. 调用方拿到结果后逐个 TTS.synth 试听, 让玩家选 1 锚定到 character.voiceAnchor
 *
 * 兜底:
 *   - LLM 调用失败 / 输出不合规 → 用启发式 fallback (按 character.prompt 关键词
 *     猜性别/年龄段, 从白名单里挑 3 个 + 用一句通用台词). 永远返回结果, 不抛异常.
 *
 * 不写副作用:
 *   - 不调 TTS, 不写 scenarioStore. 那些是上层 UI 的责任.
 *   - 这层只做 "Character → CastingResult" 一个纯函数 (除了 LLM call).
 */

import type { Character } from '../scenario/types'
import type { TextClient } from './types'
import { SKILLS } from './skills'
import { parseJSONLoose } from './parseJSONLoose'
import { TTS_VOICE_PRESETS, type VoicePreset } from './TTSProvider'

export interface VoiceCandidate {
  voiceType: string
  label: string
  /** 18–40 中文字符, "为什么这个音色适合这个角色"的具体理由 */
  reason: string
  /** UI 分组提示, 来自 TTS_VOICE_PRESETS, 兜底时 fallback 自己填 */
  gender: VoicePreset['gender']
  /** preset 里的一句话音色描述, UI 卡片上展示 */
  style: string
}

export interface CastingResult {
  /** 18–32 中文字符的角色专属基准话语, 自创非引用 */
  sampleText: string
  /** 长度恰为 3 的候选音色 */
  candidates: VoiceCandidate[]
  /** 可选的播音指挥备注 */
  notes?: string
  /** true = 走的是兜底路径 (无 LLM 或 LLM 输出非法) */
  fallback: boolean
}

const DEFAULT_FALLBACK_TEXT = '清早的风吹过窗台，茶还烫，故事得慢慢讲。'

/**
 * 入口。
 *
 * @param llm - TextClient. 不传 / 调用失败时走 fallback.
 * @param character - 当前角色卡 (调用方应保证 prompt 字段有意义).
 * @param opts.maxRetries - LLM 重试次数, 默认 1 (失败一次就 fallback).
 */
export async function castCharacterVoice(
  llm: TextClient | null,
  character: Character,
  opts?: { maxRetries?: number },
): Promise<CastingResult> {
  if (!llm) {
    return heuristicFallback(character)
  }
  const maxRetries = opts?.maxRetries ?? 1
  let lastError: unknown = null
  for (let i = 0; i <= maxRetries; i++) {
    try {
      const raw = await llm.generate({
        systemPrompt: SKILLS.characterVoiceCaster,
        userPrompt: composeUserPrompt(character),
        temperature: 0.85,
        maxTokens: 600,
        jsonMode: true,
      })
      const parsed = parseJSONLoose(raw) as unknown
      const validated = validateAndNormalize(parsed, character)
      if (validated) return { ...validated, fallback: false }
    } catch (e) {
      lastError = e
    }
  }
  if (lastError) {
    console.warn('[characterVoiceCaster] LLM failed, using heuristic fallback:', lastError)
  }
  return heuristicFallback(character)
}

/**
 * 把 character 与可用音色列表组装成 user prompt.
 *
 * 格式刻意稳定 (LLM 不要求自由解读输入), 后端可以加字段而不破老调用点.
 */
function composeUserPrompt(character: Character): string {
  const parts: string[] = []
  parts.push('## CHARACTER')
  parts.push(`name: ${character.name}`)
  if (character.prompt) parts.push(`prompt: ${truncate(character.prompt, 400)}`)
  if (character.anchor) parts.push(`anchor: ${truncate(character.anchor, 200)}`)
  if (character.aliases && character.aliases.length > 0) {
    parts.push(`aliases: ${JSON.stringify(character.aliases)}`)
  }
  if (character.appearanceVariants && character.appearanceVariants.length > 0) {
    const labels = character.appearanceVariants
      .map((v) => v.label || v.id)
      .filter(Boolean)
    if (labels.length > 0) {
      parts.push(`appearanceVariantsHint: ${labels.join(' / ')}`)
    }
  }
  parts.push('')
  parts.push('## AVAILABLE_VOICES (whitelist — pick exactly 3 from this list)')
  parts.push(
    JSON.stringify(
      TTS_VOICE_PRESETS.map((p) => ({
        voiceType: p.voiceType,
        label: p.label,
        gender: p.gender,
        style: p.style,
      })),
      null,
      2,
    ),
  )
  parts.push('')
  parts.push(
    '请按 skill 的输出契约返回单一 JSON: { sampleText, candidates: [3 项 {voiceType,label,reason}], notes? }',
  )
  return parts.join('\n')
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + '…'
}

/**
 * 校验 LLM 输出 + 把 voiceType 校准回白名单 (LLM 偶尔大小写错).
 * 任何字段不合规 → 返回 null, 调用方走 fallback.
 */
function validateAndNormalize(
  raw: unknown,
  character: Character,
): Omit<CastingResult, 'fallback'> | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>

  const sampleText = typeof obj.sampleText === 'string' ? obj.sampleText.trim() : ''
  if (!sampleText) return null
  const len = sampleText.length
  if (len < 6 || len > 80) return null
  if (containsCharacterName(sampleText, character)) return null

  const candArr = Array.isArray(obj.candidates) ? obj.candidates : null
  if (!candArr || candArr.length !== 3) return null

  const seenVoices = new Set<string>()
  const candidates: VoiceCandidate[] = []
  for (const c of candArr) {
    if (!c || typeof c !== 'object') return null
    const cobj = c as Record<string, unknown>
    const voiceType = typeof cobj.voiceType === 'string' ? cobj.voiceType.trim() : ''
    if (!voiceType) return null
    const preset = TTS_VOICE_PRESETS.find(
      (p) => p.voiceType.toLowerCase() === voiceType.toLowerCase(),
    )
    if (!preset) return null
    if (seenVoices.has(preset.voiceType)) return null
    seenVoices.add(preset.voiceType)

    const label = typeof cobj.label === 'string' && cobj.label.trim()
      ? cobj.label.trim()
      : preset.label
    const reason = typeof cobj.reason === 'string' ? cobj.reason.trim() : ''
    if (!reason || reason.length < 6) return null

    candidates.push({
      voiceType: preset.voiceType,
      label,
      reason,
      gender: preset.gender,
      style: preset.style,
    })
  }

  const notes = typeof obj.notes === 'string' && obj.notes.trim() ? obj.notes.trim() : undefined

  return { sampleText, candidates, notes }
}

function containsCharacterName(text: string, character: Character): boolean {
  if (character.name && text.includes(character.name)) return true
  if (character.aliases) {
    for (const alias of character.aliases) {
      if (alias && text.includes(alias)) return true
    }
  }
  return false
}

/**
 * 启发式兜底:
 *   - 用 character.prompt 抓性别 / 年龄段
 *   - 从对应桶里挑 3 个 voiceType (不同 label, 留一张反差牌)
 *   - sampleText 走通用兜底
 *
 * 永不抛异常, 永远返回 3 个候选.
 */
export function heuristicFallback(character: Character): CastingResult {
  const blob = `${character.prompt ?? ''} ${character.anchor ?? ''}`.toLowerCase()
  const isChild =
    /小孩|儿童|童|five|six|seven|eight|nine|ten|岁/.test(blob) &&
    /[1-9]\s*岁|童声|奶气|小学|幼儿园/.test(`${character.prompt ?? ''}${character.anchor ?? ''}`)

  // 中文里"女"/"她"判女声; "男"/"他"判男声; 都没线索就女声兜底 (大部分故事女主角描述更细)
  const female =
    /女|妈|姐|奶奶|姑娘|少女|大婶|妻|母亲|female|woman|girl/i.test(blob)
  const male = /男|爸|哥|爷爷|先生|少年|大叔|父|父亲|male|man|boy/i.test(blob)
  const old = /老|中年|沧桑|疲惫|资深|退役|苍老|elder|aged/i.test(blob)
  const energetic = /元气|活泼|高中|青春|阳光|跳脱|热血|少女|少年/i.test(blob)

  let pool: VoicePreset[]
  if (isChild) {
    pool = TTS_VOICE_PRESETS.filter((p) => p.gender === 'child')
    // child 池只有 1 个, 补 2 个邻近偏年轻
    pool = pool.concat(
      TTS_VOICE_PRESETS.filter(
        (p) => p.label.includes('元气') || p.label.includes('青年'),
      ),
    )
  } else if (female || (!male && !old)) {
    pool = TTS_VOICE_PRESETS.filter((p) => p.gender === 'female')
  } else {
    pool = TTS_VOICE_PRESETS.filter((p) => p.gender === 'male')
  }

  // 加入一张反差牌
  const reversal = old
    ? TTS_VOICE_PRESETS.find((p) => p.label.includes('青年'))
    : energetic
      ? TTS_VOICE_PRESETS.find((p) => p.label.includes('醇厚'))
      : TTS_VOICE_PRESETS.find((p) => p.gender === 'special')

  const orderedSeed = [...pool]
  if (reversal && !orderedSeed.find((p) => p.voiceType === reversal.voiceType)) {
    orderedSeed.push(reversal)
  }

  const seen = new Set<string>()
  const picked: VoicePreset[] = []
  for (const p of orderedSeed) {
    if (picked.length >= 3) break
    if (seen.has(p.voiceType)) continue
    seen.add(p.voiceType)
    picked.push(p)
  }
  // 最后兜底: 不够 3 个就从全表补
  for (const p of TTS_VOICE_PRESETS) {
    if (picked.length >= 3) break
    if (seen.has(p.voiceType)) continue
    seen.add(p.voiceType)
    picked.push(p)
  }

  const candidates: VoiceCandidate[] = picked.slice(0, 3).map((p, i) => ({
    voiceType: p.voiceType,
    label: p.label,
    reason: i === 2
      ? '反差候选 —— 与前两款气质不同, 留一张备选给作者对比试听。'
      : `${p.style} —— 与"${truncate(character.prompt || character.name, 28)}"气质相符。`,
    gender: p.gender,
    style: p.style,
  }))

  return {
    sampleText: DEFAULT_FALLBACK_TEXT,
    candidates,
    notes: '当前为离线启发式推荐 (LLM 不可用或返回非法), 建议联网后重试以获得角色专属台词。',
    fallback: true,
  }
}
