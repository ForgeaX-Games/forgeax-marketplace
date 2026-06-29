/**
 * keyframeQueueTrigger —— module-level「为节点逐镜生成关键帧」pipeline trigger.
 *
 * 当 Reia / 视觉子智能体调用 reel:generate-keyframes，server 把
 * 「{sceneId, force?}」投递到 `/__reel__/keyframe-queue`，scenarioPersistBoot 的
 * 轮询（pollKeyframeQueue）捡起后调用本文件 triggerKeyframeFromQueue。
 *
 * 与 generate-visuals 的区别：generate-visuals 只生成「人/景/物」锚点参考图、
 * **绝不碰分镜关键帧**；本触发器**只对目标节点逐镜出关键帧**（每个 shot 一张图），
 * 复用与作者在剧情树手动生成关键帧完全相同的纯函数（buildShotKeyframePrompt +
 * pickPrimaryRefForShot + composeVisualPrompt），把结果写到 shot.keyframeMediaRef
 * （keyShot 自动回填 scene.media.ref，保持 Player 兜底一张图）。
 *
 * 前置：节点已 reel:generate-storyboard 拆出多镜（否则只有一个兜底 sh_01）；
 * 人/景/物锚点已 generate-visuals（作参考图，保证跨镜一致）。
 * 幂等：已有 keyframeMediaRef 的镜默认跳过（force=true 才重生）。
 */

import { createImageProvider } from '../llm'
import type { ImageClient } from '../llm/types'
import {
  buildShotKeyframePrompt,
  pickPrimaryRefForShot,
} from '../llm/forgeImagePipeline'
import { composeVisualPrompt } from '../llm/visualStylePresets'
import { useScenarioStore } from '../scenario/scenarioStore'
import { useMediaStore } from '../media/mediaStore'
import { useSceneImageCache } from '../media/sceneImageCache'
import { useForgeChatStore } from './forgeChatStore'
import { useGenerationQueue, type GenRequestSnapshot } from './generationQueueStore'
import type { Character, Location, Prop, Scenario, Scene, Shot } from '../scenario/types'

export interface KeyframeQueueItem {
  /** 必填：要逐镜出关键帧的节点（scenario.scenes 的 key）。 */
  sceneId: string
  /** 可选：目标剧本 id；缺省/匹配当前 active 时直接处理。 */
  scenarioId?: string
  /** 可选：true 时重生已有关键帧；默认幂等跳过已生成的镜。 */
  force?: boolean
  createdAt: number
}

let _aborted = false

export function abortKeyframeQueue(): void {
  _aborted = true
}

/**
 * 单镜关键帧生成的共享上下文 —— 队列批量循环与单镜手动重生共用同一条纯函数链，
 * 保证「打码 / 参考图 / 视觉风格」行为完全一致，不发生漂移。
 */
/**
 * 解析某一镜关键帧实际会用到的「主参考图」的 mediaId + 身份标签（与
 * pickPrimaryRefForShot 同一优先级：场景 location → 镜内/场景首个角色定妆照）。
 * 让关键帧的请求快照能显示「用了哪张参考图（场景X / 角色Y）」并在刷新后据 mediaId
 * 重解析缩略图 —— 修复作者反馈「关键帧看不到参考图」。
 */
function resolveKeyframePrimaryRef(
  scene: Scene,
  shot: Shot,
  scenario: Scenario,
): { mediaId: string; label: string } | undefined {
  if (scene.locationId) {
    const loc = scenario.locations?.[scene.locationId]
    if (loc?.refImageId) return { mediaId: loc.refImageId, label: `场景 · ${loc.name ?? scene.locationId}` }
  }
  const charIds =
    shot.characterIds && shot.characterIds.length > 0
      ? shot.characterIds
      : scene.characterIds ?? []
  for (const cid of charIds) {
    const char = scenario.characters?.[cid]
    const id = char?.turnaroundRefImageId ?? char?.refImageId
    if (id) return { mediaId: id, label: `角色 · ${char?.name ?? cid}` }
  }
  return undefined
}

interface ShotKeyframeContext {
  scenario: Scenario
  scene: Scene
  sceneId: string
  location: Location | undefined
  visualStyle: Scenario['visualStyle']
  allShotsLen: number
  keyShotId: string | undefined
  imgClient: ImageClient
}

/**
 * 为单个 shot 生成关键帧并写回 store —— 抽出供批量与单镜两条入口复用。
 * 不吞异常：调用方决定如何记录失败（批量收集 failures / 单镜直接报错）。
 *
 * onRequest：发图前回调一次，把「发给图像模型的东西」(最终提示词 + 参数 + 参考图)
 *   交给调用方记录进队列 job.request，成功失败都能在素材库/队列右键回看。
 * 返回写入的 keyframe mediaId（供队列 resultMediaId / jobForMedia 反查）。
 */
async function generateShotKeyframe(
  ctx: ShotKeyframeContext,
  shot: Shot,
  hooks?: { onRequest?: (req: GenRequestSnapshot) => void },
): Promise<string> {
  const {
    scenario,
    scene,
    sceneId,
    location,
    visualStyle,
    allShotsLen,
    keyShotId,
    imgClient,
  } = ctx
  const charIds =
    shot.characterIds && shot.characterIds.length > 0
      ? shot.characterIds
      : scene.characterIds ?? []
  const characters = charIds
    .map((id) => scenario.characters?.[id])
    .filter((c): c is Character => !!c)
  const props = (shot.propIds ?? [])
    .map((id) => scenario.props?.[id])
    .filter((p): p is Prop => !!p)

  const primaryRef = pickPrimaryRefForShot({
    scene,
    shot,
    scenario,
    mediaLookup: (id) => useMediaStore.getState().get(id)?.url,
  })
  const finalPrompt = composeVisualPrompt(
    buildShotKeyframePrompt({
      scene,
      shot,
      location,
      characters,
      props,
      uiStylePrompt: scenario.uiStyle?.prompt,
      visualStyle,
      shotIndex: shot.order,
      shotTotal: allShotsLen,
    }),
    visualStyle,
  )

  // 请求快照：先记下「发了什么」，再发请求；失败也能回看。
  if (hooks?.onRequest) {
    // 主参考图的身份（场景X / 角色Y）+ mediaId —— 让「看不到参考图」变成看得到、
    // 且刷新后据 mediaId 仍能解析出缩略图。
    const primaryRefInfo = resolveKeyframePrimaryRef(scene, shot, scenario)
    hooks.onRequest({
      endpoint: `${imgClient.getModel?.() ?? imgClient.getProviderName?.() ?? '图像'} · 分镜关键帧`,
      prompt: finalPrompt,
      params: {
        size: '1536x1024',
        provider: imgClient.getProviderName?.() ?? '(未知)',
        model: imgClient.getModel?.() ?? '(默认)',
        framing: shot.framing ?? '(未标注)',
        hasReference: Boolean(primaryRef),
      },
      refs: primaryRef
        ? [
            {
              role: 'reference_image',
              url: primaryRef,
              label: primaryRefInfo ? `该镜主参考 · ${primaryRefInfo.label}` : '该镜主参考(角色/场景锚点)',
              mediaId: primaryRefInfo?.mediaId,
            },
          ]
        : [],
      at: Date.now(),
    })
  }

  const out = await imgClient.generate({
    prompt: finalPrompt,
    // 分镜关键帧走横版：gpt-image-2 原生最宽是 1536x1024（3:2，无真 16:9），
    // 与场景/人物参考链一致，便于作为 Seedance 16:9 视频首帧参考。
    size: '1536x1024',
    referenceImageDataUrl: primaryRef,
  })
  const mediaId = useMediaStore.getState().ingestDataUrl(out.dataUrl, {
    name: `${sceneId}-${shot.id}.png`,
    sceneId,
    shotId: shot.id,
    promptKind: 'scene',
    humanReadableName: `${scene.title ?? sceneId} · shot-${(shot.order ?? 0) + 1}`,
  })
  useScenarioStore.getState().setSceneShotKeyframe(sceneId, shot.id, mediaId)
  // keyShot 完成时同步 sceneImageCache，保证 Player/预览立刻有兜底图。
  if (
    shot.id === keyShotId ||
    useSceneImageCache.getState().records[sceneId]?.status !== 'ready'
  ) {
    useSceneImageCache.getState().put(sceneId, out.dataUrl, scene.prompts?.scene ?? '')
  }
  return mediaId
}

/**
 * 手动单镜关键帧重生 —— 供 StagePane「↻ 生成该镜关键帧」按钮调用。
 *
 * 与队列批量入口共用 generateShotKeyframe，行为（含写实打码、参考图组装）一致；
 * 区别仅在范围（只补当前选中的一镜）与对话进度文案。
 */
export async function regenerateShotKeyframe(
  sceneId: string,
  shotId: string,
): Promise<void> {
  const scenario = useScenarioStore.getState().scenario
  const scenarioId = scenario.id
  const chat = useForgeChatStore.getState()
  const scene = scenario.scenes?.[sceneId]
  if (!scene) return
  const allShots = scene.shots ?? []
  const shot = allShots.find((s) => s.id === shotId)
  if (!shot) return

  const imgClient = createImageProvider()
  if (imgClient.getProviderName() === 'Mock') {
    chat.appendMessage(scenarioId, {
      role: 'system',
      text: '[关键帧] 未配置图像服务（Mock provider），无法出图。',
    })
    return
  }

  const ctx: ShotKeyframeContext = {
    scenario,
    scene: scene as Scene,
    sceneId,
    location: scene.locationId ? scenario.locations?.[scene.locationId] : undefined,
    visualStyle: scenario.visualStyle,
    allShotsLen: allShots.length,
    keyShotId: scene.keyShotId ?? allShots[0]?.id,
    imgClient,
  }

  const shotLabel = `镜 ${(shot.order ?? 0) + 1}`
  chat.appendMessage(scenarioId, {
    role: 'user',
    text: `[手动 · 生成关键帧] 节点 ${sceneId} · ${shotLabel}`,
  })
  chat.setPending(scenarioId, {
    reason: 'forging',
    startedAt: Date.now(),
    stages: [{ label: '单镜关键帧', detail: shotLabel, at: Date.now() }],
    streamTail: '',
    streamBytes: 0,
    abortable: false,
  })
  try {
    await generateShotKeyframe(ctx, shot)
    chat.appendMessage(scenarioId, {
      role: 'assistant',
      text: `${shotLabel} 关键帧已更新（已在时间轴对应站位刷新缩略图）。`,
    })
  } catch (e) {
    chat.appendMessage(scenarioId, {
      role: 'system',
      text: `[关键帧生成失败] ${shotLabel}：${(e as Error).message}`,
    })
  } finally {
    chat.clearPending(scenarioId)
  }
}

export async function triggerKeyframeFromQueue(item: KeyframeQueueItem): Promise<void> {
  _aborted = false
  const scenario = useScenarioStore.getState().scenario
  const scenarioId = scenario.id
  const chat = useForgeChatStore.getState()

  if (item.scenarioId && item.scenarioId !== scenarioId) {
    chat.appendMessage(scenarioId, {
      role: 'system',
      text: `[关键帧] 跳过：目标剧本 ${item.scenarioId} 非当前「${scenario.title}」，请先切到该本。`,
    })
    return
  }

  const scene = scenario.scenes?.[item.sceneId]
  if (!scene) {
    chat.appendMessage(scenarioId, {
      role: 'system',
      text: `[关键帧] 跳过：当前剧本里没有节点 ${item.sceneId}。`,
    })
    return
  }

  const allShots = scene.shots ?? []
  if (allShots.length === 0) {
    chat.appendMessage(scenarioId, {
      role: 'system',
      text: `[关键帧] 节点 ${item.sceneId} 还没有分镜，请先 reel:generate-storyboard 拆镜。`,
    })
    return
  }

  const shots = item.force
    ? allShots
    : allShots.filter((sh) => !sh.keyframeMediaRef)
  if (shots.length === 0) {
    chat.appendMessage(scenarioId, {
      role: 'assistant',
      text: `节点 ${item.sceneId} 的 ${allShots.length} 个镜头关键帧均已就绪（无需重生）。`,
    })
    return
  }

  const imgClient = createImageProvider()
  if (imgClient.getProviderName() === 'Mock') {
    chat.appendMessage(scenarioId, {
      role: 'system',
      text: '[关键帧] 未配置图像服务（Mock provider），无法出图。',
    })
    return
  }

  const ctx: ShotKeyframeContext = {
    scenario,
    scene: scene as Scene,
    sceneId: item.sceneId,
    location: scene.locationId ? scenario.locations?.[scene.locationId] : undefined,
    visualStyle: scenario.visualStyle,
    allShotsLen: allShots.length,
    keyShotId: scene.keyShotId ?? allShots[0]?.id,
    imgClient,
  }

  // 逐镜关键帧统一进生成队列（image 池并发 + 进度可视 + 失败留可诊断卡片 +
  // 右键时间轴「查看生成参数」可回看发给模型的提示词/参考图）。每镜一条 image job,
  // 绑定 sceneId+shotId（时间轴右键反查）与 cardKey（卡片订阅状态/重试）。
  const q = useGenerationQueue.getState()
  const group = `kf-${item.sceneId}-${Date.now().toString(36)}`
  q.enqueueMany(
    shots.map((shot) => ({
      kind: 'image' as const,
      label: `关键帧 · ${scene.title ?? item.sceneId} · 镜${(shot.order ?? 0) + 1}`,
      sceneId: item.sceneId,
      shotId: shot.id,
      cardKey: `keyframe:${item.sceneId}:${shot.id}`,
      group,
      run: async ({ setRequest }) => generateShotKeyframe(ctx, shot, { onRequest: setRequest }),
    })),
  )

  chat.appendMessage(scenarioId, {
    role: 'user',
    text: `[智能体提交 · 生成关键帧] 节点 ${item.sceneId} · ${shots.length}/${allShots.length} 镜`,
  })
  chat.appendMessage(scenarioId, {
    role: 'assistant',
    text:
      `已把 ${shots.length} 镜关键帧入队（见上方「生成队列」，每镜一张，可看进度/失败原因，` +
      `也可在时间轴对应分镜右键「查看生成参数」回看发给模型的提示词与参考图）。` +
      `\n出图后会自动在时间轴每个分镜站位显示缩略图；随后可逐镜出片（reel:generate-video / reel:produce-node）。`,
  })
}
