/**
 * videoQueueTrigger —— module-level "为场景生成视频" pipeline trigger.
 *
 * 当 Reia 调用 reel:generate-video，server 把「带 sceneId 的视频任务」投递到
 * `/__reel__/video-queue`，scenarioPersistBoot 的轮询（pollVideoQueue）捡起后
 * 调用本文件 triggerVideoFromQueue。
 *
 * 这是修复「agent 说生成了视频但作者什么都看不到」的关键：以前 reel:generate-video
 * 只是 fire-and-forget 把任务丢给宿主网关，产物永远落不回剧本。现在改走与作者在
 * 工作台手动点「生成视频」**完全相同**的浏览器内管线：
 *   createTask → videoTaskStore.upsert → pollTask → fetch+ingest 落盘 mediaStore
 *   → setSceneMediaRef(VIDEO) 绑定到场景 → 时间轴/预览可见
 * 且因为走了 videoTaskStore + HostGatewayVideoProvider，刷新/翻页还能被
 * resumeRunningVideoTasks 接盘续轮询。
 *
 * 归属规则：
 *   · 每个 job 必须带 sceneId（视频要挂到具体场景）。
 *   · job.scenarioId 与当前 active 剧本不一致 → 跳过并在对话里提示（让作者先切到该本）。
 *   · sceneId 不在 active 剧本里 → 跳过并提示。
 */

import { createVideoProvider } from '../llm'
import { isVideoTaskProvider } from '../llm/VideoProvider'
import { useVideoTaskStore } from '../llm/videoTaskStore'
import { runWithConcurrency } from '../llm/batchImageGen'
import { DEFAULT_VIDEO_SIZE, type VideoSize } from '../llm/seedanceResolution'
import { VIDEO_BATCH_CONCURRENCY } from '../llm/concurrency'
import { useScenarioStore } from '../scenario/scenarioStore'
import { useSettingsStore } from '../scenario/settingsStore'
import { useMediaStore } from '../media/mediaStore'
import { useForgeChatStore } from './forgeChatStore'
import { orchestrateVideos } from './orchestrateVideos'
import { buildVideoReferenceSet } from '../llm/buildVideoReferenceSet'
import type { Scene, Shot } from '../scenario/types'

export interface VideoQueueJob {
  id: string
  /** 必填：视频绑定到哪一场（scenario.scenes 的 key）。 */
  sceneId: string
  /** 可选：目标剧本 id；缺省/匹配当前 active 时直接处理。 */
  scenarioId?: string
  /** 可选：镜头语言提示词；省略时回退到该场景自己的视频提示词。 */
  prompt?: string
  /** 可选：时长（秒）；省略时取场景时长 / 默认 5s。 */
  durationSec?: number
  /** 可选：分辨率档位。 */
  size?: string
  createdAt: number
}

let _aborted = false

export function abortVideoQueue(): void {
  _aborted = true
}

/** 解析该场景送给视频模型的最终 prompt：job > scene.video > scene.scene > media.prompt > 标题。 */
function resolveScenePrompt(job: VideoQueueJob, scene: Scene): string {
  return (
    job.prompt?.trim() ||
    scene.prompts?.video?.trim() ||
    scene.prompts?.scene?.trim() ||
    scene.media?.prompt?.trim() ||
    scene.title?.trim() ||
    ''
  )
}

/** 写实关键帧来源 —— 多模态参考模式下**不发**（写实首帧会过审失败 / 超时）。 */
const KEYFRAME_SOURCES = new Set([
  'shot-keyframe',
  'prev-shot-keyframe',
  'next-shot-keyframe',
  'far-shot-keyframe',
])

/**
 * 为「未分镜」整场构造 R2V 多模态参考输入（与 orchestrateVideos 同策略）：
 *   只发 角色定妆照 + 场景 + 道具 这些「设计稿」作 reference_image，
 *   **不发写实关键帧 / 首帧**；再带上该场首个角色的音色作 reference_audio。
 * 没有任何设计稿时返回空，调用方回落纯文生（依旧绝不发写实首帧）。
 */
function buildSceneReferenceInput(sceneId: string): {
  referenceImageUrls: string[]
  referenceAudioUrl?: string
  voiceCharName?: string
} {
  const scenario = useScenarioStore.getState().scenario
  const scene = scenario.scenes?.[sceneId]
  if (!scene) return { referenceImageUrls: [] }
  const lookup = (id: string): string | undefined =>
    useMediaStore.getState().entries[id]?.url
  // 合成一个「无关键帧」的 shot 复用参考集逻辑（buildVideoReferenceSet 只读
  // shot.id / shot.keyframeMediaRef / shot.characterIds）。
  const syntheticShot = {
    id: `__scene-${sceneId}`,
    order: 0,
    characterIds: scene.characterIds,
  } as unknown as Shot
  const set = buildVideoReferenceSet({
    scenario,
    scene,
    shot: syntheticShot,
    mediaLookup: lookup,
  })
  const referenceImageUrls = set.trace
    .filter((t) => !KEYFRAME_SOURCES.has(t.source))
    .map((t) => t.url)
  let referenceAudioUrl: string | undefined
  let voiceCharName: string | undefined
  for (const cid of scene.characterIds ?? []) {
    const ch = scenario.characters?.[cid]
    const u = ch?.voiceSampleMediaId ? lookup(ch.voiceSampleMediaId) : undefined
    if (u) {
      referenceAudioUrl = u
      voiceCharName = ch?.name
      break
    }
  }
  return { referenceImageUrls, referenceAudioUrl, voiceCharName }
}

export async function triggerVideoFromQueue(jobs: VideoQueueJob[]): Promise<void> {
  _aborted = false
  if (jobs.length === 0) return

  const scenario = useScenarioStore.getState().scenario
  const scenarioId = scenario.id
  const chat = useForgeChatStore.getState()

  // 归属过滤 + shot-aware 分流：
  //   · 已分镜化的场（>=2 个 shot）→ 逐镜出片，交给生成队列（后台并发、不挡剪辑），
  //     成功写 shot.videoMediaRef + scene.sceneVideos（orchestrateVideos 的 onDone）。
  //   · 未分镜（无 shots / 只有兜底单镜）→ 回落整场一条，绑 scene.media（向后兼容）。
  const runnable: Array<{ job: VideoQueueJob; scene: Scene; prompt: string }> = []
  const shotSceneIds: string[] = []
  const skipped: string[] = []
  for (const job of jobs) {
    if (job.scenarioId && job.scenarioId !== scenarioId) {
      skipped.push(`${job.sceneId}（目标剧本 ${job.scenarioId} 非当前「${scenario.title}」）`)
      continue
    }
    const scene = scenario.scenes?.[job.sceneId]
    if (!scene) {
      skipped.push(`${job.sceneId}（当前剧本里没有这一场）`)
      continue
    }
    if ((scene.shots?.length ?? 0) >= 2) {
      shotSceneIds.push(job.sceneId)
      continue
    }
    const prompt = resolveScenePrompt(job, scene)
    if (!prompt) {
      skipped.push(`${job.sceneId}（无可用提示词）`)
      continue
    }
    runnable.push({ job, scene, prompt })
  }

  // shot-aware 分支：逐镜入生成队列。队列自动并发跑，作者可同时在时间轴剪辑。
  let orchEnqueued = 0
  let orchScenes = 0
  if (shotSceneIds.length > 0) {
    const r = orchestrateVideos({ sceneIds: shotSceneIds, includeTextOnly: true })
    orchEnqueued = r.enqueued
    orchScenes = shotSceneIds.length
  }

  chat.appendMessage(scenarioId, {
    role: 'user',
    text:
      `[智能体提交 · 生成视频] 整场 ${runnable.length} · 逐镜 ${orchScenes} 场（${orchEnqueued} 镜）` +
      (skipped.length > 0 ? `\n跳过 ${skipped.length}：${skipped.join('；')}` : ''),
  })
  if (orchScenes > 0) {
    chat.appendMessage(scenarioId, {
      role: 'assistant',
      text:
        `已把 ${orchScenes} 个已分镜场的 ${orchEnqueued} 个镜头逐镜送入生成队列（后台并发出片，` +
        `不影响你在时间轴剪辑）。完成后各镜写回 shot.videoMediaRef，Player 按 shot 切镜播放。`,
    })
  }
  if (runnable.length === 0) return

  const cfg = {
    ...useSettingsStore.getState().videoConfig,
    ...(scenario.videoConfig ?? {}),
  }
  const visualStyle = scenario.visualStyle
  const videoProvider = createVideoProvider(cfg)
  if (videoProvider.getProviderName() === 'Mock') {
    chat.appendMessage(scenarioId, {
      role: 'system',
      text: '[视频] 未配置视频服务（Mock provider），无法出片。请确认宿主视频网关可用。',
    })
    return
  }

  chat.setPending(scenarioId, {
    reason: 'forging',
    startedAt: Date.now(),
    stages: [{ label: '生成视频', detail: `${runnable.length} 场排队中`, at: Date.now() }],
    streamTail: '',
    streamBytes: 0,
    abortable: false,
  })

  let done = 0
  const failures: string[] = []
  try {
    await runWithConcurrency(
      runnable,
      async ({ job, scene, prompt }) => {
        if (_aborted) return
        // R2V 多模态参考：定妆照+场景+道具 + 音色，**不发写实首帧**（与逐镜出片一致）。
        const { referenceImageUrls, referenceAudioUrl, voiceCharName } =
          buildSceneReferenceInput(job.sceneId)
        const hasRefs = referenceImageUrls.length > 0 || Boolean(referenceAudioUrl)
        const finalPrompt =
          hasRefs && voiceCharName
            ? `${prompt}\n\n【参考音频】角色「${voiceCharName}」的音色 —— 角色念白请用该嗓音，跨镜保持一致。随附参考图仅作认人/认景/认物的身份信号，请勿照搬其构图。`
            : prompt
        const durationSec = job.durationSec ?? Math.max(1, Math.round((scene.durationMs ?? 5000) / 1000))
        const size = (job.size as VideoSize | undefined) ?? cfg.size ?? DEFAULT_VIDEO_SIZE
        try {
          if (isVideoTaskProvider(videoProvider)) {
            const created = await videoProvider.createTask({
              prompt: finalPrompt,
              mode: hasRefs ? 'reference' : undefined,
              referenceImageUrls: referenceImageUrls.length > 0 ? referenceImageUrls : undefined,
              referenceAudioUrl,
              durationSec,
              size,
              visualStyle,
            })
            const { taskId } = created
            useVideoTaskStore.getState().upsert({
              taskId,
              remoteTaskId: created.remoteTaskId,
              sceneId: job.sceneId,
              status: 'generating',
              createdAt: Date.now(),
              lastMessage: '已提交，排队中（智能体）',
              providerKind: videoProvider.getProviderKind(),
            })
            const result = await videoProvider.pollTask(taskId, {
              onUpdate: (t) => {
                useVideoTaskStore.getState().patch(taskId, {
                  status: t.status as 'generating' | 'downloading' | 'queued',
                  apiStatus: t.api_status,
                  lastMessage: `${t.status}${t.api_status ? ` · ${t.api_status}` : ''}`,
                })
              },
            })
            if (result.status !== 'completed' || !result.videoUrl) {
              useVideoTaskStore.getState().patch(taskId, {
                status: result.status,
                error: result.error,
                lastMessage: result.error ?? result.status,
              })
              throw new Error(`${result.status} · ${result.error ?? '(no detail)'}`)
            }
            const blob = await (await fetch(result.videoUrl)).blob()
            const file = new File([blob], `${job.sceneId}.mp4`, {
              type: blob.type || 'video/mp4',
            })
            const mediaId = useMediaStore.getState().ingest(file)
            useScenarioStore.getState().setSceneMediaRef(job.sceneId, {
              kind: 'VIDEO',
              ref: mediaId,
            })
            useVideoTaskStore.getState().patch(taskId, {
              status: 'completed',
              videoUrl: result.videoUrl,
              ingested: true,
              lastMessage: '完成（智能体）',
            })
          } else {
            // 不可 resume 的 client：直接 generate 落盘绑定（无 store）。
            const out = await videoProvider.generate({
              prompt: finalPrompt,
              mode: hasRefs ? 'reference' : undefined,
              referenceImageUrls: referenceImageUrls.length > 0 ? referenceImageUrls : undefined,
              referenceAudioUrl,
              durationSec,
              size,
              visualStyle,
            })
            if (!out.url) throw new Error('视频服务未返回 URL')
            const blob = await (await fetch(out.url)).blob()
            const file = new File([blob], `${job.sceneId}.mp4`, {
              type: blob.type || 'video/mp4',
            })
            const mediaId = useMediaStore.getState().ingest(file)
            useScenarioStore.getState().setSceneMediaRef(job.sceneId, {
              kind: 'VIDEO',
              ref: mediaId,
            })
          }
        } catch (e) {
          failures.push(`${job.sceneId}：${(e as Error).message}`)
        }
      },
      {
        concurrency: VIDEO_BATCH_CONCURRENCY,
        onProgress: (d, total) => {
          done = d
          useForgeChatStore.getState().appendPendingStage(scenarioId, {
            label: `视频生成 ${d}/${total}`,
            detail: `已完成 ${d} 场`,
          })
        },
      },
    )

    const okCount = runnable.length - failures.length
    chat.appendMessage(scenarioId, {
      role: 'assistant',
      text:
        `视频生成完成 · 成功 ${okCount}/${runnable.length}（已绑定到场景、时间轴可见）` +
        (failures.length > 0 ? `\n失败 ${failures.length}：${failures.join('；')}` : ''),
    })
  } catch (e) {
    chat.appendMessage(scenarioId, {
      role: 'system',
      text: `[视频生成失败] ${(e as Error).message}`,
    })
  } finally {
    void done
    useForgeChatStore.getState().clearPending(scenarioId)
  }
}
