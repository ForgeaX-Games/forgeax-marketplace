/**
 * 角色「试镜视频 + 音色样本」生成编排 —— 角色定妆照流程 v7。
 *
 * 串起整条链：
 *   1. 取角色参考图 URL（headshot > fullbody > refImage > turnaround 兜底 → mediaStore；缺则报错）
 *   2. 取/生成念白台词（优先 characterVoiceCaster 的 in-character sampleText，回退角色首句台词/模板）
 *   3. buildCharacterAuditionPrompt → 组试镜提示词
 *   4. generateCardVideo：3:4 · 10s · reference 模式（定妆照作参考图）· generate_audio · 透传 visualStyle
 *   5. extractAudioMp3：把视频整段音轨抽成 MP3 dataURL → ingest 为 audio/mpeg
 *   6. setCharacterAudition：把 auditionVideoMediaId / voiceSampleMediaId 绑回角色
 *
 * 音色抽取失败不阻断：试镜视频仍然绑定（auditionVideoMediaId），voiceSampleMediaId 留空，
 * 调用方据 warning 提示「音色抽取失败，可重试」。
 */

import { useMediaStore } from '../media/mediaStore'
import { useScenarioStore } from '../scenario/scenarioStore'
import { createTextProvider } from '../llm/ClaudeAzureProvider'
import { castCharacterVoice } from '../llm/characterVoiceCaster'
import { buildCharacterAuditionPrompt } from '../llm/characterAudition'
import { extractAudioMp3 } from '../media/extractAudioMp3'
import { generateCardVideo } from './assetCardGen'
import type { GenRequestSnapshot } from './generationQueueStore'
import type { Character } from '../scenario/types'

export interface AuditionResult {
  auditionVideoMediaId: string
  /** 抽取成功时存在；失败则 undefined（视频仍然绑定） */
  voiceSampleMediaId?: string
  /** 非致命提示（如音色抽取失败原因） */
  warnings: string[]
}

/** 试镜视频时长（秒）—— 抽出的 MP3 即这段时长的音色样本。 */
const AUDITION_DURATION_SEC = 10

/**
 * 找一句角色台词作念白：扫场景对话里第一句由该角色说的话（按名字 / 别名匹配 speaker）。
 * 没有则返回 undefined，由上层走 castCharacterVoice / 模板兜底。
 */
function findFirstSpokenLine(character: Character): string | undefined {
  const names = new Set(
    [character.name, ...(character.aliases ?? [])].map((n) => n?.trim()).filter(Boolean),
  )
  const scenes = useScenarioStore.getState().scenario.scenes ?? {}
  for (const sc of Object.values(scenes)) {
    const lines = sc.dialogue
    if (!Array.isArray(lines)) continue
    for (const d of lines) {
      if (
        d?.role === 'character' &&
        d.speaker &&
        names.has(d.speaker.trim()) &&
        typeof d.text === 'string' &&
        d.text.trim()
      ) {
        return d.text.trim()
      }
    }
  }
  return undefined
}

/**
 * 解析念白台词：优先角色专属 in-character 台词（LLM），其次剧本首句，最后模板自我介绍。
 * 永不抛异常。
 */
async function resolveAuditionLine(character: Character): Promise<string> {
  // 1) LLM in-character sampleText（castCharacterVoice 内部已含兜底，不会抛）
  try {
    const llm = createTextProvider()
    const cast = await castCharacterVoice(llm, character)
    if (cast.sampleText?.trim()) return cast.sampleText.trim()
  } catch {
    /* 落到下面的回退 */
  }
  // 2) 剧本里该角色的首句台词
  const scripted = findFirstSpokenLine(character)
  if (scripted) return scripted
  // 3) 模板自我介绍
  return '你好，我准备好了，随时可以开始。'
}

/**
 * 为单个角色生成试镜视频并提取音色。
 *
 * @throws 当缺少定妆照图 / 视频生成失败时（音色抽取失败不抛，仅记 warning）
 */
export async function generateCharacterAudition(
  character: Character,
  opts?: {
    onStage?: (stage: string) => void
    /** 透传给试镜视频请求的快照回调（记录「发了什么」到队列 job.request）。 */
    onRequest?: (req: GenRequestSnapshot) => void
  },
): Promise<AuditionResult> {
  const warnings: string[] = []
  const media = useMediaStore.getState()
  const scenario = useScenarioStore.getState().scenario

  // 试镜是「单人头肩胸像」，参考图优先选**单人单格**的图：
  //   headshot（头肩正脸，最佳）> fullbody（单人正面全身）> refImage > turnaround 兜底
  // turnaroundRefImageId 往往是多分格拼版三视图（正面 + 全身正/背并排）。
  // 不再做 img2img 预生成——直接把这张图当参考喂图生视频，靠**写到位的提示词**
  // 明确告知模型「这是角色设计三视图，只用来还原长相，视频要单人头肩说话、不要拼版」。
  const refMediaId =
    character.headshotMediaId ??
    character.fullbodyMediaId ??
    character.refImageId ??
    character.turnaroundRefImageId
  const refIsSinglePanel = Boolean(character.headshotMediaId ?? character.fullbodyMediaId)
  const refUrl = refMediaId ? media.get(refMediaId)?.url : undefined
  if (!refUrl) {
    throw new Error('缺少角色定妆照图，请先生成定妆照后再生成试镜视频')
  }

  opts?.onStage?.('准备念白台词')
  const line = await resolveAuditionLine(character)

  const prompt = buildCharacterAuditionPrompt(character, {
    visualStyle: scenario.visualStyle,
    line,
    // 参考图非单人单格（拼版三视图/全身并排）时，让 prompt 强制「重新取景为单人头肩」。
    reframeFromMultiPanel: !refIsSinglePanel,
  })

  opts?.onStage?.('生成试镜视频')
  const auditionVideoMediaId = await generateCardVideo({
    sceneId: `audition-${character.id}`,
    tag: `audition:${character.id}`,
    title: `试镜视频 · ${character.name}`,
    prompt,
    mode: 'reference',
    ratio: '3:4',
    // 试镜+音色样本无需 1080p，720p 已足够且明显更快（生成耗时近乎减半）。
    resolution: '720p',
    durationSec: AUDITION_DURATION_SEC,
    referenceImageUrls: [refUrl],
    generateAudio: true,
    visualStyle: scenario.visualStyle,
    onStage: opts?.onStage,
    onRequest: opts?.onRequest,
  })

  // 抽音色 MP3（失败降级）。
  let voiceSampleMediaId: string | undefined
  const videoUrl = useMediaStore.getState().get(auditionVideoMediaId)?.url
  if (videoUrl) {
    try {
      opts?.onStage?.('提取音色')
      const mp3DataUrl = await extractAudioMp3(videoUrl)
      voiceSampleMediaId = useMediaStore.getState().ingestDataUrl(mp3DataUrl, {
        name: `voice-sample-${character.id}.mp3`,
        mimeType: 'audio/mpeg',
        humanReadableName: `音色参考 · ${character.name}`,
        promptKind: 'character-voice',
        tags: ['voice-sample'],
      })
    } catch (e) {
      warnings.push(
        `音色抽取失败：${e instanceof Error ? e.message : String(e)}（试镜视频已保留，可稍后重试）`,
      )
    }
  } else {
    warnings.push('试镜视频已生成，但无法读取视频 URL 以抽取音色')
  }

  useScenarioStore.getState().setCharacterAudition(character.id, {
    auditionVideoMediaId,
    voiceSampleMediaId,
  })

  return { auditionVideoMediaId, voiceSampleMediaId, warnings }
}
