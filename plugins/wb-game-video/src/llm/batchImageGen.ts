import type { ImageClient } from './types'
import type { Scenario, Scene, Shot, VisualStyle } from '../scenario/types'
import { composeVisualPrompt } from './visualStylePresets'
import { shotFaceMaskClause } from './faceMaskPrompt'
import { IMAGE_BATCH_CONCURRENCY } from './concurrency'

/**
 * 批量并行生图 —— 给"剧本锻造完，一键生成所有场景画面"用。
 *
 * 设计要点：
 *   1) 调度器是纯函数（runWithConcurrency），跟 ImageClient 解耦 → 易测
 *   2) 单个失败不连带 → 收集 failures，让 UI 能告诉作者"7/8 成功，第 3 场报错"
 *   3) 进度回调 → UI 能画进度条
 *   4) 默认并发 4（比 sceneImageCache 的 1-2 高，但还在 Azure rate limit 安全区）
 */

export interface BatchTask {
  sceneId: string
  /** v3: 当前镜头 id —— 每 scene 至少 1 镜（migrate 兜底） */
  shotId: string
  /** 是否是 scene.keyShotId —— 决定完成后是否同步 scene.media.ref + sceneImageCache */
  isKeyShot: boolean
  prompt: string
}

export interface BatchSuccess {
  sceneId: string
  shotId: string
  isKeyShot: boolean
  dataUrl: string
  latencyMs: number
}

export interface BatchFailure<T = unknown> {
  item: T
  error: Error
}

export interface BatchResult<R, F = unknown> {
  ok: R[]
  failed: BatchFailure<F>[]
  totalMs: number
}

export interface RunOpts {
  concurrency: number
  onProgress?: (done: number, total: number) => void
  /**
   * v3.8 · 暂停信号 —— `AbortController.signal`。
   *
   * 语义："停止派发新任务"。已在飞的 worker 会完成当前 item 后自然退出；
   * 调用方 UI 上看到 "暂停 · 3/8 进行中 → 5/8" 这种正常进度。
   *
   * 不处理"掐断正在跑的 fetch" —— 那需要让每个 worker 的 HTTP 客户端也接
   * signal，当前 ImageClient/VideoClient 的 signature 还没加，第二期再做。
   */
  signal?: AbortSignal
}

/**
 * 通用并发调度器：N 个 worker 抢同一个任务队列，逐个 await。
 *
 * 不变量：
 *   - 同时在飞的任务数 ≤ concurrency
 *   - 任意 worker 抛错都不会让整体停摆，错误装进 failed
 *   - onProgress 在每个任务结束（成功或失败）时调一次
 */
export async function runWithConcurrency<T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
  opts: RunOpts,
): Promise<BatchResult<R, T>> {
  const t0 = Date.now()
  if (items.length === 0) {
    return { ok: [], failed: [], totalMs: 0 }
  }
  const concurrency = Math.max(1, opts.concurrency | 0)
  const ok: R[] = []
  const failed: BatchFailure<T>[] = []
  let cursor = 0
  let done = 0

  const runOne = async (): Promise<void> => {
    while (true) {
      // 暂停检测：每次循环开头看一次 signal；调用方 abort 后后续 worker 不再取新任务
      // 不 throw，保持 BatchResult 可读；未跑的任务既不进 ok 也不进 failed
      if (opts.signal?.aborted) return
      const idx = cursor++
      if (idx >= items.length) return
      const item = items[idx]!
      try {
        const r = await worker(item, idx)
        ok.push(r)
      } catch (e) {
        failed.push({
          item,
          error: e instanceof Error ? e : new Error(String(e)),
        })
      } finally {
        done++
        opts.onProgress?.(done, items.length)
      }
    }
  }

  const workers: Promise<void>[] = []
  const n = Math.min(concurrency, items.length)
  for (let i = 0; i < n; i++) workers.push(runOne())
  await Promise.all(workers)

  return { ok, failed, totalMs: Date.now() - t0 }
}

/**
 * 把 scenario 里所有"需要生图的 shot"挑出来，准备喂给批量生图。
 *
 * v3 从 scene 级变成 **shot 级**：每个 scene 至少一 shot（migrate v2→v3 兜底）；
 * 同一个 scene 的多个 shot 各跑各的 prompt，完成后分别写回 shot.keyframeMediaRef。
 *
 * @param skipReadyShots 一个集合，元素形如 `${sceneId}::${shotId}`；
 *                       里面的 shot 视为已生成，跳过；为了不侵入 cache 的 API，
 *                       调用方自行聚合（通常 = 检查 scene.shots[i].keyframeMediaRef
 *                       是否非空，再加上 sceneImageCache 里 ready 的 keyShot）
 */
export function pickBatchTasksFromScenario(
  scenario: Scenario,
  skipReadyShots: Set<string> = new Set(),
): BatchTask[] {
  const tasks: BatchTask[] = []
  for (const scene of Object.values(scenario.scenes)) {
    const shots =
      scene.shots && scene.shots.length > 0
        ? scene.shots
        : [
            {
              id: 'sh_01',
              order: 0,
              framing: 'medium' as const,
              prompt: scene.prompts?.scene ?? scene.media?.prompt ?? '',
              keyframeMediaRef: scene.media?.ref,
            },
          ]
    const keyShotId = scene.keyShotId ?? shots[0]?.id
    for (const shot of shots) {
      const prompt =
        shot.prompt?.trim() ||
        scene.prompts?.scene?.trim() ||
        scene.media?.prompt?.trim() ||
        ''
      if (!prompt) continue
      const key = `${scene.id}::${shot.id}`
      if (skipReadyShots.has(key)) continue
      tasks.push({
        sceneId: scene.id,
        shotId: shot.id,
        isKeyShot: shot.id === keyShotId,
        prompt,
      })
    }
  }
  return tasks
}

/**
 * 顶层便捷入口：批量生场景图。
 *
 * v3.8 · 批量生图一致性升级：
 *   旧版只把 task.prompt 裸文本（通常是 shot.prompt）发给模型，不拼角色/场所/
 *   道具信息 → 同一剧本跨镜人物漂移、场所气氛不统一、道具随意乱画。
 *   新版：
 *     - 传入完整 `scenario`（可选；不传则退回旧行为以兼容老调用点）
 *     - 为每个 task 调 buildShotKeyframePrompt，织入：
 *       · scene.background / scene.prompts.scene
 *       · characters 的外观 anchor（从 scene.characterIds × shot.characterIds 并集）
 *       · location 的场所描述（scene.locationId）
 *       · props 的道具描述（scene.propIds ∪ shot.propIds；若 scene 没显式 propIds，
 *         则把剧本全部 props 都拼进去——"场景没限定时视为所有关键道具都可能出现"）
 *     - visualStyle 仍由 composeVisualPrompt 叠加
 *
 * 注意：本函数目前**只做 prompt 层文字注入**，不传真实参考图给底层 provider。
 * 下一阶段（Phase B）会让 GptImageProvider 走 /images/edits 端点并附真图。
 *
 * @param onPersist 每个成功生成时回调 —— 调用方负责把结果写进 sceneImageCache
 *                  （这层不直接依赖 cache，保持 LLM 模块的纯净）
 */
export async function batchGenerateScenes(args: {
  tasks: BatchTask[]
  client: ImageClient
  concurrency?: number
  /**
   * 全局美术风格 —— 注入到每个 task.prompt 之前。undefined 则不注入。
   * 在这一层 compose（而不是 task 里）可以让调用方少一次遍历。
   */
  visualStyle?: VisualStyle
  /**
   * 完整 scenario —— 必填（Phase A 后）。用于查找 scene / shot / characters /
   * location / props 并组装完整 prompt。
   *
   * 向后兼容：允许省略，省略时退回"只发 task.prompt 裸文本"的旧行为。
   * 新调用点（BatchGenBar、IdeaForge）都会传入；老测试/老调用保持可运行。
   */
  scenario?: Scenario
  /**
   * v3.8 · 从 mediaId 查真实 URL 的函数 —— 用于 Phase B 的参考图上传路径。
   *
   * 传入则 batchGenerateScenes 会挑选 location/character/prop 的参考图
   * 并以 referenceImages 形式发给底层 provider；不传则退回纯文生图。
   *
   * 调用方通常直接传 `useMediaStore.getState().get(id)?.url` 的包装器：
   * ```
   *   mediaLookup: (id) => useMediaStore.getState().entries[id]?.url
   * ```
   */
  mediaLookup?: (mediaId: string) => string | undefined
  /** v3.8 · 暂停信号；传入后 abort 即停止派发新任务 */
  signal?: AbortSignal
  onProgress?: (done: number, total: number) => void
  onPersist?: (success: BatchSuccess) => void
}): Promise<BatchResult<BatchSuccess, BatchTask>> {
  const concurrency = args.concurrency ?? IMAGE_BATCH_CONCURRENCY
  const scenario = args.scenario
  return runWithConcurrency(
    args.tasks,
    async (task) => {
      const t0 = performance.now()
      // 组装最终 prompt：
      //   如果传了 scenario，走 buildShotKeyframePrompt 把角色/场所/道具织进去；
      //   否则退回裸 task.prompt（兼容旧调用点）。
      const fullPrompt = scenario
        ? buildPromptForBatchTask(task, scenario)
        : task.prompt
      // 参考图：有 scenario + mediaLookup 时挑选 location/character/prop 的参考图
      // 挑选逻辑和 prompt 组装共用同一份 task 上下文（buildRefsForBatchTask）
      const referenceImages =
        scenario && args.mediaLookup
          ? buildRefsForBatchTask(task, scenario, args.mediaLookup)
          : undefined
      const out = await args.client.generate({
        prompt: composeVisualPrompt(fullPrompt, args.visualStyle),
        // 批量分镜关键帧走横版 1536x1024（gpt-image-2 原生最宽，对齐 16:9 视频）。
        size: '1536x1024',
        ...(referenceImages && referenceImages.length > 0
          ? { referenceImages }
          : {}),
      })
      const success: BatchSuccess = {
        sceneId: task.sceneId,
        shotId: task.shotId,
        isKeyShot: task.isKeyShot,
        dataUrl: out.dataUrl,
        latencyMs: Math.round(performance.now() - t0),
      }
      args.onPersist?.(success)
      return success
    },
    { concurrency, onProgress: args.onProgress, signal: args.signal },
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase A · 批量分镜 prompt 组装
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 为 BatchTask 组装完整 prompt。
 *
 * 流程：
 *   1. 从 scenario.scenes / scene.shots 找回 scene 和 shot 对象
 *   2. 解析 scene.characterIds / shot.characterIds 的并集 → Character[]
 *   3. 解析 scene.locationId → Location
 *   4. 收集"可能出现的道具"：
 *      - 如果 scene 或 shot 有 propIds 字段就用它（精准）
 *      - 否则把整个 scenario.props 都带上（保守，让模型看到"有哪些关键道具存在"）
 *   5. 调 buildShotKeyframePrompt 组合最终 prompt
 *
 * 如果任何环节失败（scene/shot 找不到），就回退到 task.prompt 裸文本——
 * 保证批量生图永远不会因"一条数据格式异常"全军覆没。
 */
function buildPromptForBatchTask(
  task: BatchTask,
  scenario: Scenario,
): string {
  const scene = scenario.scenes[task.sceneId]
  if (!scene) return task.prompt

  const shots = scene.shots ?? []
  const shot: Shot | undefined =
    shots.find((s) => s.id === task.shotId) ??
    // fallback：scene 没有 shots 数组时，合成一个最小 shot 对象
    (shots.length === 0
      ? {
          id: task.shotId,
          order: 0,
          framing: 'medium',
          prompt: task.prompt,
        }
      : undefined)

  if (!shot) return task.prompt

  // 角色 ID = scene.characterIds ∪ shot.characterIds
  const charIdSet = new Set<string>()
  for (const cid of scene.characterIds ?? []) charIdSet.add(cid)
  for (const cid of (shot as Shot & { characterIds?: string[] }).characterIds ?? []) {
    charIdSet.add(cid)
  }
  const characters = [...charIdSet]
    .map((id) => scenario.characters?.[id])
    .filter((c): c is NonNullable<typeof c> => !!c)

  // 场所
  const location = scene.locationId
    ? scenario.locations?.[scene.locationId]
    : undefined

  // 道具：优先 shot.propIds → scene.propIds → scenario.props 全集
  let propIds: string[] | undefined
  const shotPropIds = (shot as Shot & { propIds?: string[] }).propIds
  const scenePropIds = (scene as Scene & { propIds?: string[] }).propIds
  if (Array.isArray(shotPropIds) && shotPropIds.length > 0) {
    propIds = shotPropIds
  } else if (Array.isArray(scenePropIds) && scenePropIds.length > 0) {
    propIds = scenePropIds
  }
  const props = propIds
    ? propIds.map((id) => scenario.props?.[id]).filter((p): p is NonNullable<typeof p> => !!p)
    : Object.values(scenario.props ?? {})

  // 组装时需要 buildShotKeyframePrompt；动态 import 打破循环依赖
  // （forgeImagePipeline 依赖 batchImageGen.runWithConcurrency）
  // 同步路径下 require 在 ESM 不可用；这里直接用 top-of-module import 不回本反而简单，
  // 但 forgeImagePipeline 已经从 batchImageGen import 了 runWithConcurrency ——
  // 反向 import 会形成循环。所以 prompt 拼接采用"轻量本地实现"：
  const shotIndex = shots.findIndex((s) => s.id === shot.id)
  const shotTotal = shots.length > 0 ? shots.length : 1
  return composeBatchPromptLocally({
    scene,
    shot,
    location,
    characters,
    props,
    uiStylePrompt: scenario.uiStyle?.prompt,
    visualStyle: scenario.visualStyle,
    shotIndex: shotIndex >= 0 ? shotIndex : undefined,
    shotTotal,
  })
}

/**
 * 本地"精简版"prompt 组装器 —— 语义对齐 buildShotKeyframePrompt 的 prop-aware
 * 分支，但不依赖 forgeImagePipeline，避免循环 import。
 *
 * 字段优先级与 buildShotKeyframePrompt 保持一致（维护双方时需要同步修改；
 * 实在怕漂移时 __tests__ 加 snapshot 对比）。
 */
function composeBatchPromptLocally(args: {
  scene: Scene
  shot: Shot
  location?: import('../scenario/types').Location
  characters: import('../scenario/types').Character[]
  props: import('../scenario/types').Prop[]
  uiStylePrompt?: string
  visualStyle?: VisualStyle
  shotIndex?: number
  shotTotal?: number
}): string {
  const parts: string[] = []
  const { scene, shot, location, characters, props, uiStylePrompt } = args

  if (uiStylePrompt) parts.push(`Visual style: ${uiStylePrompt}.`)

  if (location) {
    parts.push(
      `Location: ${location.name} — ${location.prompt || ''}. Match the lighting, spatial orientation, and mood of the provided reference image of this location.`,
    )
  }

  if (characters.length > 0) {
    const anchors = characters
      .map((c) => {
        const appearance = c.prompt?.trim()
        return appearance ? `${c.name} (${appearance})` : c.name
      })
      .join('; ')
    parts.push(
      `Characters present (visual anchors up-front): ${anchors}. Keep each character consistent with their provided turnaround reference — face, wardrobe, proportions, distinctive accessories.`,
    )
    // v3.9 · 写实风格下的人脸局部打码：与 buildShotKeyframePrompt 保持一致
    const maskClause = shotFaceMaskClause(args.visualStyle, characters.length)
    if (maskClause) parts.push(maskClause)
  }

  if (props.length > 0) {
    const propAnchors = props
      .map((p) => {
        const appearance = p.prompt?.trim()
        return appearance ? `${p.name} (${appearance})` : p.name
      })
      .join('; ')
    parts.push(
      `Key props present: ${propAnchors}. Render each visible prop with matching material, silhouette, colors, and any labels/insignia as shown in the prop reference image — do NOT redesign them.`,
    )
  }

  const backgroundText = scene.background?.trim()
  if (backgroundText) {
    parts.push(`Scene mood and staging: ${backgroundText}.`)
  }

  const sceneAction =
    scene.prompts?.scene?.trim() || scene.media?.prompt?.trim() || ''
  if (sceneAction) {
    parts.push(`Scene action (scene level): ${sceneAction}.`)
  }

  if (args.shotIndex !== undefined && args.shotTotal !== undefined) {
    parts.push(`Shot ${args.shotIndex + 1} of ${args.shotTotal}.`)
  }

  const shotPrompt = shot.prompt?.trim()
  if (shotPrompt) {
    parts.push(`This shot shows: ${shotPrompt}.`)
  }

  if (shot.cameraHint?.trim()) {
    parts.push(`Camera direction: ${shot.cameraHint.trim()}.`)
  }

  parts.push('Cinematic framing, high detail, no text, no watermark.')
  return parts.join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase B · 批量分镜参考图选择
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 为 BatchTask 选出应当上传给模型的"多张参考图"。
 *
 * 顺序（也会透传给模型，越前越权重高）：
 *   1. location.refImageId —— 场所基准图（光影、构图、气氛）
 *   2. 本镜角色的 turnaroundRefImageId 或 refImageId（最多 3 张，保证脸一致）
 *   3. 本镜/本场涉及的 props 的 refImageId（最多 2 张）
 *
 * Azure gpt-image-2 上限 16 张，我们内部又限制 6 张以下以控制延迟 + token 成本。
 * 调用方按需自己再 slice。
 *
 * 如果任何 id 在 mediaLookup 里查不到（media 还没 hydrate），就跳过；
 * 绝不抛错，保证 provider 层拿到的一定是可解析的 dataUrl。
 */
function buildRefsForBatchTask(
  task: BatchTask,
  scenario: Scenario,
  mediaLookup: (mediaId: string) => string | undefined,
): import('./types').ImageReference[] {
  const out: import('./types').ImageReference[] = []
  const MAX_CHARS = 3
  const MAX_PROPS = 2
  const MAX_TOTAL = 6

  const scene = scenario.scenes[task.sceneId]
  if (!scene) return out

  const shots = scene.shots ?? []
  const shot = shots.find((s) => s.id === task.shotId)

  // 1) Location 基准图
  if (scene.locationId) {
    const loc = scenario.locations?.[scene.locationId]
    if (loc?.refImageId) {
      const url = mediaLookup(loc.refImageId)
      if (url) {
        out.push({ dataUrl: url, role: 'location', label: `场所·${loc.name}` })
      }
    }
  }

  // 2) 本镜角色（shot > scene）
  const charIds: string[] = []
  const seen = new Set<string>()
  const shotCharIds = (shot as Shot & { characterIds?: string[] })?.characterIds ?? []
  for (const cid of shotCharIds) {
    if (!seen.has(cid)) {
      seen.add(cid)
      charIds.push(cid)
    }
  }
  for (const cid of scene.characterIds ?? []) {
    if (!seen.has(cid)) {
      seen.add(cid)
      charIds.push(cid)
    }
  }
  let charCount = 0
  for (const cid of charIds) {
    if (charCount >= MAX_CHARS) break
    if (out.length >= MAX_TOTAL) break
    const c = scenario.characters?.[cid]
    if (!c) continue
    // 优先三视图（给脸/服装），没有时 fallback 到 refImage
    const mid = c.turnaroundRefImageId ?? c.refImageId
    if (!mid) continue
    const url = mediaLookup(mid)
    if (!url) continue
    out.push({
      dataUrl: url,
      role: 'character',
      label: `角色·${c.name}`,
    })
    charCount++
  }

  // 3) 道具
  const propIds: string[] = []
  const shotPropIds = (shot as Shot & { propIds?: string[] })?.propIds
  const scenePropIds = (scene as Scene & { propIds?: string[] })?.propIds
  if (Array.isArray(shotPropIds) && shotPropIds.length > 0) {
    propIds.push(...shotPropIds)
  } else if (Array.isArray(scenePropIds) && scenePropIds.length > 0) {
    propIds.push(...scenePropIds)
  } else {
    // 没有精确标注时，只取"本场场景有可能出现"的前几个道具
    // 这里采用保守策略：整个剧本的前 MAX_PROPS 个（按 Object.keys 顺序）
    const all = Object.keys(scenario.props ?? {})
    propIds.push(...all.slice(0, MAX_PROPS))
  }
  let propCount = 0
  const propsSeen = new Set<string>()
  for (const pid of propIds) {
    if (propCount >= MAX_PROPS) break
    if (out.length >= MAX_TOTAL) break
    if (propsSeen.has(pid)) continue
    propsSeen.add(pid)
    const p = scenario.props?.[pid]
    if (!p?.refImageId) continue
    const url = mediaLookup(p.refImageId)
    if (!url) continue
    out.push({ dataUrl: url, role: 'prop', label: `道具·${p.name}` })
    propCount++
  }

  return out
}
