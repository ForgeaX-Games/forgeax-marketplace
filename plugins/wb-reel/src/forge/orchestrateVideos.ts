/**
 * `orchestrateVideos` —— 把「分镜 → 视频」批量编排进统一生成队列。
 *
 * 作者诉求（2026-06）：
 *   "按理说互动影游到这一步应该有非常多视频要生成，但我没看到。"
 *   根因：原来视频只能逐卡手点；没有「先出关键帧 → 一键把每个分镜批量转视频」的编排。
 *
 * 本模块做的事：
 *   1) 遍历目标 scene 的 shots，挑出「可生成视频」的单元
 *      （默认：已有关键帧；可选 includeTextOnly = 没关键帧也用纯锚点文生视频）。
 *   2) 用 buildVideoReferenceSet 智能组参考图（首帧 + 场景/角色/道具锚点，截断到 9 张）。
 *   3) 组装运镜 prompt（优先 shot.kineticVideoPrompt，回落 shot.prompt + cameraHint）。
 *   4) 入 generationQueue（video 池），队列按 settings 并发调度。
 *   5) 成功后自动采用：写回 shot.videoMediaRef + scene.sceneVideos（autoAdopt，默认开）。
 *
 * 纯编排，不接触 key/host：底层 generateCardVideo 的凭据全部来自 settingsStore。
 */
import { useScenarioStore } from '../scenario/scenarioStore'
import { useMediaStore } from '../media/mediaStore'
import type { Scenario, Scene, Shot } from '../scenario/types'
import { buildVideoReferenceSet } from '../llm/buildVideoReferenceSet'
import { generateCardVideo } from './assetCardGen'
import {
  useGenerationQueue,
  registerGenRecipe,
  type GenJobInput,
} from './generationQueueStore'
import { createTextProvider } from '../llm'
import { forgeCinematicVideoPrompt } from '../llm/forgeKineticVideo'

/** orch-video recipe 的持久化参数（纯可序列化；resume 按当前剧本重建）。 */
interface OrchVideoRecipeArgs {
  sceneId: string
  shotId: string
  group: string
  autoAdopt: boolean
  includeTextOnly: boolean
  durationSec?: number
}

export interface OrchestrateVideosOptions {
  /** 目标节点；空 = 全部 scene */
  sceneIds?: string[]
  /** 没关键帧的 shot 也用纯锚点文生视频（默认 false：只对已出关键帧的单元） */
  includeTextOnly?: boolean
  /** 跳过已生成视频（videoMediaRef 存在）的 shot（默认 true） */
  skipExisting?: boolean
  /** 成功后自动写回 shot.videoMediaRef + scene.sceneVideos（默认 true） */
  autoAdopt?: boolean
  /** 视频时长（秒）；缺省取 shot.durationSec 或 5 */
  durationSec?: number
}

export interface OrchestrateVideosResult {
  group: string
  enqueued: number
  skipped: number
  /** 被跳过的原因明细（调试/给作者解释为什么某些 shot 没排） */
  skips: Array<{ sceneId: string; shotId: string; reason: string }>
}

function mediaUrl(id: string): string | undefined {
  return useMediaStore.getState().entries[id]?.url
}

/** 组装单个 shot 的运镜 prompt（入队时的兜底；出片前可被 cinema 工程化覆盖）。 */
export function composeShotVideoPrompt(shot: Shot): string {
  // 优先级：电影级出片提示词(cinema) > 图生视频(kinetic) > 画面 prompt。
  const base = (
    shot.cinemaVideoPrompt?.trim() ||
    shot.kineticVideoPrompt?.trim() ||
    shot.prompt?.trim() ||
    ''
  ).trim()
  const cam = shot.cameraHint?.trim()
  if (cam && !base.includes(cam)) return base ? `${base}（运镜：${cam}）` : cam
  return base
}

/**
 * 出片前把镜头提示词工程化为**电影级出片提示词**（cinema 范式）。
 *
 * 单镜 = 一段 ≤15s 的完整戏 → cinema-video-prompt skill 在镜内用分秒时间码分拍，
 * 台词逐字、点名角色、贴在该角色动作里，角色名↔参考图锚定。续接关系（一段没演完的
 * 内容）由 storyboard 的 continuityGroupId + 首尾帧承接，到下一镜延续。
 *
 *   - 已有 shot.cinemaVideoPrompt → 直接用 fallback（入队时 composeShotVideoPrompt 已含它）。
 *   - 缺失且文本模型可用 → 现生并回写 shot.cinemaVideoPrompt（避免重复 LLM 调用）。
 *   - 模型不可用 / 失败 → 回落 fallback（shot.prompt + 运镜），绝不阻塞出片。
 *
 * 角色花名册按本镜 characterIds（缺省继承 scene 全员）过滤，名字与下面「参考素材说明」
 * 同源（都取 scenario.characters[id].name），保证提示词里指代的角色与参考图一一对应。
 */
async function resolveSeedanceShotPrompt(
  sceneId: string,
  shot: Shot,
  fallbackPrompt: string,
  onStage?: (stage: string) => void,
): Promise<string> {
  if (shot.cinemaVideoPrompt?.trim()) return fallbackPrompt
  let llm
  try {
    llm = createTextProvider()
  } catch {
    return fallbackPrompt
  }
  if (llm.getProviderName() === 'Mock') return fallbackPrompt
  try {
    const scenario = useScenarioStore.getState().scenario
    const scene = scenario.scenes[sceneId]
    if (!scene) return fallbackPrompt
    // 本镜角色花名册：优先 shot.characterIds，缺省继承 scene 全员；名字↔参考图同源。
    const charIds =
      shot.characterIds && shot.characterIds.length > 0
        ? shot.characterIds
        : (scene.characterIds ?? [])
    const characters = charIds
      .map((id) => scenario.characters?.[id])
      .filter((c): c is NonNullable<typeof c> => !!c)
    onStage?.(`工程化出片提示词 · 镜${shot.order + 1}`)
    const r = await forgeCinematicVideoPrompt(llm, {
      shot,
      scene,
      characters,
      directorStyle: scenario.directorStyle,
      directorCustomPersona: scenario.directorCustomPersona,
      visualStyle: scenario.visualStyle,
      uiStylePrompt: scenario.uiStyle?.prompt,
    })
    const engineered = r.prompt?.trim()
    if (!engineered) return fallbackPrompt
    useScenarioStore.getState().updateShot(sceneId, shot.id, {
      cinemaVideoPrompt: engineered,
    })
    const cam = shot.cameraHint?.trim()
    return cam && !engineered.includes(cam)
      ? `${engineered}（运镜：${cam}）`
      : engineered
  } catch {
    return fallbackPrompt
  }
}

/**
 * 把一条参考图来源 trace 翻译成给视频模型看的自然语言说明（含实体名）。
 * 用于 R2V 的「参考素材说明」清单 —— 让模型知道每张图是角色/场景/道具，怎么用。
 */
/**
 * 参考素材的「短身份标签」—— 用于请求快照里每张参考图的徽标（角色/场景/道具 + 名字）。
 * 与 describeRefEntry 的长句说明不同，这个只给一眼能认的简短标签，让作者在素材库卡片 /
 * 生成队列里清楚「这次出片到底用了哪些角色/场景/道具锚点」。
 */
function shortRefLabel(
  scenario: Scenario,
  source: string,
  entityId: string | undefined,
): string {
  switch (source) {
    case 'character-turnaround': {
      const c = entityId ? scenario.characters?.[entityId] : undefined
      return `角色 · ${c?.name ?? entityId ?? '角色'}`
    }
    case 'location-ref':
    case 'location-angle': {
      const l = entityId
        ? (scenario.locations?.[entityId] as { name?: string } | undefined)
        : undefined
      return `场景 · ${l?.name ?? entityId ?? '场景'}`
    }
    case 'prop-ref': {
      const p = entityId
        ? (scenario.props?.[entityId] as { name?: string } | undefined)
        : undefined
      return `道具 · ${p?.name ?? entityId ?? '道具'}`
    }
    default:
      return '参考图'
  }
}

function describeRefEntry(
  scenario: Scenario,
  source: string,
  entityId: string | undefined,
): string | null {
  switch (source) {
    case 'character-turnaround': {
      const c = entityId ? scenario.characters?.[entityId] : undefined
      const name = c?.name ?? '角色'
      return `角色「${name}」定妆照 —— 仅用于认清该角色长相（五官/脸型/发型/发色/肤色/服装/配饰/气质）`
    }
    case 'location-ref':
    case 'location-angle': {
      const l = entityId
        ? (scenario.locations?.[entityId] as { name?: string } | undefined)
        : undefined
      const name = l?.name ?? '场景'
      return `场景「${name}」 —— 仅用于认清环境/布景/光线/色调氛围`
    }
    case 'prop-ref': {
      const p = entityId
        ? (scenario.props?.[entityId] as { name?: string } | undefined)
        : undefined
      const name = p?.name ?? '道具'
      return `道具「${name}」 —— 仅用于认清该道具外观`
    }
    default:
      return null
  }
}

/** 取 shot 首帧 mediaId：ab 用 startFrameMediaRef，single 用 keyframeMediaRef。 */
function shotStartFrame(shot: Shot): string | undefined {
  if (shot.keyframeStrategy === 'ab' && shot.startFrameMediaRef) return shot.startFrameMediaRef
  return shot.keyframeMediaRef ?? shot.startFrameMediaRef
}

function shotEndFrame(shot: Shot): string | undefined {
  return shot.keyframeStrategy === 'ab' ? shot.endFrameMediaRef : undefined
}

/**
 * 编排目标 scene 的视频生成。同步返回入队结果（实际生成异步在队列里跑）。
 */
export function orchestrateVideos(
  opts: OrchestrateVideosOptions = {},
): OrchestrateVideosResult {
  const scenario: Scenario = useScenarioStore.getState().scenario
  const includeTextOnly = opts.includeTextOnly ?? false
  const skipExisting = opts.skipExisting ?? true
  const autoAdopt = opts.autoAdopt ?? true

  const sceneIds =
    opts.sceneIds && opts.sceneIds.length > 0
      ? opts.sceneIds
      : Object.keys(scenario.scenes)

  const group = `orch-${Date.now().toString(36)}`
  const skips: OrchestrateVideosResult['skips'] = []
  let enqueued = 0

  for (const sceneId of sceneIds) {
    const scene: Scene | undefined = scenario.scenes[sceneId]
    if (!scene) continue
    const shots = (scene.shots ?? []).slice().sort((a, b) => a.order - b.order)
    if (shots.length === 0) {
      skips.push({ sceneId, shotId: '-', reason: '尚未分镜' })
      continue
    }

    for (const shot of shots) {
      const built = buildShotVideoInput(sceneId, shot.id, {
        group,
        autoAdopt,
        includeTextOnly,
        skipExisting,
        durationSec: opts.durationSec,
        onSkip: (reason) => skips.push({ sceneId, shotId: shot.id, reason }),
      })
      if (!built) continue
      useGenerationQueue.getState().enqueue(built)
      enqueued += 1
    }
  }

  return { group, enqueued, skipped: skips.length, skips }
}

interface BuildShotVideoOptions {
  group: string
  autoAdopt: boolean
  includeTextOnly: boolean
  /** 已绑定视频是否跳过（编排时听 force；resume 时恒 true，绝不覆盖已出片的镜）。 */
  skipExisting: boolean
  durationSec?: number
  /** 被跳过时回报原因（编排用于汇总；resume 用不到，传 null/不传）。 */
  onSkip?: (reason: string) => void
}

/**
 * 按「当前」剧本/素材为某一镜组装一个可入队的视频 GenJobInput（带 orch-video
 * recipe，可被刷新接盘）。不可生成时回报 onSkip 并返回 null。
 *
 * 关键：所有参考图/提示词/音色都在这里**实时**从 store 取，所以无论首次编排还是
 * 刷新后 resume，用的都是最新值；recipe.args 只存稳定的 id/开关，不存易失的 URL。
 */
function buildShotVideoInput(
  sceneId: string,
  shotId: string,
  o: BuildShotVideoOptions,
): GenJobInput | null {
  const scenario: Scenario = useScenarioStore.getState().scenario
  const scene = scenario.scenes[sceneId]
  if (!scene) {
    o.onSkip?.('场景已不存在')
    return null
  }
  const shot = (scene.shots ?? []).find((s) => s.id === shotId)
  if (!shot) {
    o.onSkip?.('镜头已不存在')
    return null
  }
  if (o.skipExisting && shot.videoMediaRef) {
    o.onSkip?.('已有视频')
    return null
  }
  const startFrameId = shotStartFrame(shot)
  const hasKeyframe = !!startFrameId
  if (!hasKeyframe && !o.includeTextOnly) {
    o.onSkip?.('无关键帧（未开纯锚点文生）')
    return null
  }

  const prompt = composeShotVideoPrompt(shot)
  if (!prompt.trim()) {
    o.onSkip?.('无可用 prompt')
    return null
  }

  const refSet = buildVideoReferenceSet({ scenario, scene, shot, mediaLookup: mediaUrl })
  const endFrameId = shotEndFrame(shot)
  const endFrameUrl = endFrameId ? mediaUrl(endFrameId) : undefined

  // 官方互斥：有尾帧 → 首尾帧模式（导演显式 A→B 承接，用关键帧）；
  // 否则 → 多模态参考模式（R2V）。
  const mode: 'frames' | 'reference' = endFrameUrl ? 'frames' : 'reference'

  // 关键帧来源（写实成片画面，未打码）—— 在多模态参考模式下**不作为参考素材**：
  // 直接把写实关键帧当首帧/参考图喂给视频模型会过审失败 / The operation timed out。
  const KEYFRAME_SOURCES = new Set([
    'shot-keyframe',
    'prev-shot-keyframe',
    'next-shot-keyframe',
    'far-shot-keyframe',
  ])
  // 多模态参考用的「设计稿」锚点：角色定妆照(turnaround) + 场景(location) + 道具，
  // 这些才是给视频模型认人/认景/认物的参考素材，由提示词驱动重新“拍摄”。
  const designTrace = refSet.trace.filter((t) => !KEYFRAME_SOURCES.has(t.source))
  const designRefs = designTrace.map((t) => t.url)

  let startFrameUrl: string | undefined
  let referenceImageUrls: string[]
  // 与 referenceImageUrls 同序的身份标签（角色/场景/道具 + 名字），仅用于请求快照展示。
  let referenceImageLabels: string[]
  if (mode === 'frames') {
    // 首尾帧续接：仍用关键帧 A→B（导演显式指定的承接关系）
    startFrameUrl = startFrameId ? mediaUrl(startFrameId) : undefined
    referenceImageUrls = []
    referenceImageLabels = []
  } else {
    // 多模态参考(R2V)：只发 角色定妆照 + 场景 + 道具，**不发写实关键帧、不发首帧**
    startFrameUrl = undefined
    referenceImageUrls = designRefs
    referenceImageLabels = designTrace.map((t) =>
      shortRefLabel(scenario, t.source, t.entityId),
    )
  }

  // 音色参考：取本镜（缺省继承 scene 全员）首个带「音色样本」的角色，把它的 voiceSample
  // 作 Seedance reference_audio，并在 prompt 末尾追加备注，保证该角色嗓音跨镜一致。
  const shotCharIds =
    shot.characterIds && shot.characterIds.length > 0
      ? shot.characterIds
      : (scene.characterIds ?? [])
  let referenceAudioUrl: string | undefined
  let voiceCharName = ''
  for (const cid of shotCharIds) {
    const ch = scenario.characters?.[cid]
    const vsUrl = ch?.voiceSampleMediaId ? mediaUrl(ch.voiceSampleMediaId) : undefined
    if (vsUrl) {
      referenceAudioUrl = vsUrl
      voiceCharName = ch?.name ?? ''
      break
    }
  }

  // R2V 要诀：用自然语言告诉模型「每张参考图 / 音频是什么、怎么用」，否则模型不知道
  // 参考图1 是角色、参考图2 是场景。逐项标注，并强调“仅作身份/风格信号、勿照搬构图”。
  // 顺序与 referenceImageUrls 一致（designTrace 同序）。仅多模态参考模式拼这段。
  let referenceLegend = ''
  if (mode === 'reference' && (designTrace.length > 0 || referenceAudioUrl)) {
    const lines: string[] = [
      '【随附参考素材说明】以下素材只作“认人/认景/认物/认音色”的身份与风格信号，不是要播放的画面、不是首帧，请勿照搬任何一张图的构图或排版：',
    ]
    designTrace.forEach((t, i) => {
      const d = describeRefEntry(scenario, t.source, t.entityId)
      if (d) lines.push(`· 参考图${i + 1}：${d}`)
    })
    if (voiceCharName) {
      lines.push(`· 参考音频：角色「${voiceCharName}」的音色 —— 角色念白/说话请用该嗓音，保持跨镜一致`)
    }
    lines.push('请基于以上理解，按上面的运镜与表演要求，重新“拍摄”这一镜全新画面。')
    referenceLegend = lines.join('\n')
  }

  const durationSec = o.durationSec ?? shot.durationSec ?? 5
  // 紧凑标签：用 sceneId + 镜号（场景全标题太长会占满队列横条，挤掉状态/进度）。
  const label = `视频 · ${sceneId} · 镜${shot.order + 1}`
  const tag = `reel:orch:${sceneId}:${shot.id}`
  const recipeArgs: OrchVideoRecipeArgs = {
    sceneId,
    shotId,
    group: o.group,
    autoAdopt: o.autoAdopt,
    includeTextOnly: o.includeTextOnly,
    durationSec: o.durationSec,
  }

  return {
    kind: 'video',
    label,
    sceneId,
    shotId,
    group: o.group,
    recipe: { type: ORCH_VIDEO_RECIPE, args: recipeArgs },
    run: async ({ onStage, setRequest }) => {
      // 出片前把镜头提示词工程化为 Seedance 2.0 视频提示词（一镜一运镜、路径 A）。
      const engineered = await resolveSeedanceShotPrompt(sceneId, shot, prompt, onStage)
      const finalPrompt = referenceLegend ? `${engineered}\n\n${referenceLegend}` : engineered
      return generateCardVideo({
        sceneId,
        tag,
        title: label,
        prompt: finalPrompt,
        mode,
        startFrameUrl,
        startFrameMediaId: startFrameId,
        endFrameUrl,
        endFrameMediaId: endFrameId,
        referenceImageUrls,
        referenceImageLabels,
        referenceAudioUrl,
        durationSec,
        onStage,
        onRequest: setRequest,
      })
    },
    onDone: (mediaId) => {
      if (!mediaId || !o.autoAdopt) return
      const store = useScenarioStore.getState()
      store.addSceneVideo(sceneId, mediaId)
      store.updateShot(sceneId, shotId, { videoMediaRef: mediaId })
    },
  }
}

// ── recipe 注册：刷新/重开后按当前剧本重建逐镜视频任务 ──────────────────────────
// resume 时一律 skipExisting=true：已出片（绑定了 videoMediaRef）的镜不重做，
// 只把上次没跑完的继续跑完，避免重复出片/重复扣费。
export const ORCH_VIDEO_RECIPE = 'orch-video'

registerGenRecipe(ORCH_VIDEO_RECIPE, (raw) => {
  const args = raw as OrchVideoRecipeArgs | null
  if (!args || typeof args.sceneId !== 'string' || typeof args.shotId !== 'string') {
    return null
  }
  return buildShotVideoInput(args.sceneId, args.shotId, {
    group: args.group ?? `orch-resume-${Date.now().toString(36)}`,
    autoAdopt: args.autoAdopt ?? true,
    includeTextOnly: args.includeTextOnly ?? true,
    skipExisting: true,
    durationSec: args.durationSec,
  })
})
