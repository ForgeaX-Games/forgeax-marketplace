import { create } from 'zustand'
import type { ImageClient } from '../llm/types'
import { useAssetStore } from './assetStore'
import { useScenarioStore } from '../scenario/scenarioStore'
import { composeVisualPrompt } from '../llm/visualStylePresets'

/**
 * 场景画面缓存 —— 同一个剧情/会话内，每个 sceneId 只生一次图。
 *
 * 设计要点（重写版，2026-04 起持久化重构）：
 *   - 命中 cache → 直接返回（O(1)）
 *   - in-flight 共享同一 Promise，不重复发请求
 *   - **缺失时先查磁盘 assetStore**：若该 sceneId 历史上生成过，直接拿 server URL，免请求
 *   - **生成成功立刻落盘**：写到 .reel-assets/，切场景回来不丢、刷新不丢
 *   - 失败也缓存（除非 retry），避免反复打网络
 *
 * 与 assetStore 的分工：
 *   - assetStore  = 持久化磁盘历史（多张/同 scene/可回溯）
 *   - sceneImageCache = "当前会话最新一张" 的快速访问索引；只是个内存视图
 *
 * 字段语义（重要）：
 *   - dataUrl 字段同时支持 "data:image/png;base64,..." 和 "/__reel__/assets/<id>"
 *     两种格式 —— 浏览器 <img src=...> 都能正常加载。
 *     新生成（这次会话）→ base64；从磁盘预填 → URL。
 */

export type SceneImageRecord =
  | { status: 'pending'; promise: Promise<string | null>; prompt: string }
  | {
      status: 'ready'
      dataUrl: string
      prompt: string
      latencyMs: number
      /** 关联的持久化 asset id；从磁盘预填或落盘成功后填上 */
      assetId?: string
    }
  | { status: 'error'; message: string; prompt: string }

interface CacheState {
  records: Record<string, SceneImageRecord>
  ensure: (sceneId: string, prompt: string, client: ImageClient) => Promise<string | null>
  retry: (sceneId: string, prompt: string, client: ImageClient) => Promise<string | null>
  /**
   * 纯本地预填：只查磁盘历史；找不到就**不**发请求，记录保持 undefined。
   * 用于编辑器切场景 / 刷新时按需展示历史，避免每次自动消耗 token。
   * 返回值：true = 命中并落库；false = 没历史，调用方应展示占位等用户主动点生成。
   */
  loadFromDisk: (sceneId: string, fallbackPrompt?: string) => boolean
  /** 直接灌一条 ready（如：用户拖入图片完成落盘后） */
  put: (sceneId: string, dataUrl: string, prompt: string, assetId?: string) => void
  /**
   * 把 sceneId 标记为 pending 状态——不启动真正的生成，只让订阅者（节点缩略图等）
   * 立刻看到"生成中"反馈。调用方保证之后会用 put() 写 ready 或 markError 写错误。
   *
   * 为什么不直接复用 retry：retry 会真的去调 client，不受调用方控制；批量/流水线
   * 在外面自己管并发和 client，这里只借 store 做广播。
   */
  markPending: (sceneId: string, prompt: string) => void
  markError: (sceneId: string, prompt: string, message: string) => void
  get: (sceneId: string) => SceneImageRecord | undefined
  clear: () => void
}

export const useSceneImageCache = create<CacheState>((set, get) => ({
  records: {},
  ensure: async (sceneId, prompt, client) => {
    const existing = get().records[sceneId]
    if (existing?.status === 'ready') return existing.dataUrl
    if (existing?.status === 'pending') return existing.promise
    if (existing?.status === 'error') return null

    // 缺失：先查磁盘历史。assetStore 已 boot，直接同步读
    const fromDisk = pickLatestDiskAsset(sceneId)
    if (fromDisk) {
      const url = useAssetStore.getState().urlOf(fromDisk.id)
      set((s) => ({
        records: {
          ...s.records,
          [sceneId]: {
            status: 'ready',
            dataUrl: url,
            prompt: fromDisk.meta.prompt ?? prompt,
            latencyMs: fromDisk.meta.latencyMs ?? 0,
            assetId: fromDisk.id,
          },
        },
      }))
      return url
    }

    return startGenerate(sceneId, prompt, client, set, get)
  },
  retry: async (sceneId, prompt, client) => {
    return startGenerate(sceneId, prompt, client, set, get)
  },
  loadFromDisk: (sceneId, fallbackPrompt) => {
    const cur = get().records[sceneId]
    if (cur?.status === 'ready' || cur?.status === 'pending') return true
    const fromDisk = pickLatestDiskAsset(sceneId)
    if (!fromDisk) return false
    const url = useAssetStore.getState().urlOf(fromDisk.id)
    set((s) => ({
      records: {
        ...s.records,
        [sceneId]: {
          status: 'ready',
          dataUrl: url,
          prompt: fromDisk.meta.prompt ?? fallbackPrompt ?? '',
          latencyMs: fromDisk.meta.latencyMs ?? 0,
          assetId: fromDisk.id,
        },
      },
    }))
    return true
  },
  put: (sceneId, dataUrl, prompt, assetId) =>
    set((s) => ({
      records: {
        ...s.records,
        [sceneId]: {
          status: 'ready',
          dataUrl,
          prompt,
          latencyMs: 0,
          assetId,
        },
      },
    })),
  markPending: (sceneId, prompt) =>
    set((s) => {
      const cur = s.records[sceneId]
      // 已有真 pending（retry 进行中）不覆盖，避免把真实 promise 顶掉
      if (cur?.status === 'pending') return s
      return {
        records: {
          ...s.records,
          [sceneId]: {
            status: 'pending',
            promise: Promise.resolve(null),
            prompt,
          },
        },
      }
    }),
  markError: (sceneId, prompt, message) =>
    set((s) => ({
      records: {
        ...s.records,
        [sceneId]: { status: 'error', prompt, message },
      },
    })),
  get: (sceneId) => get().records[sceneId],
  clear: () => set({ records: {} }),
}))

function pickLatestDiskAsset(sceneId: string) {
  // 必须同时匹配 scenarioId，防止旧剧本的相同 sceneId 图片污染新剧本
  const currentScenarioId = useScenarioStore.getState().scenario.id
  const a = useAssetStore.getState().latest({
    sceneId,
    scenarioId: currentScenarioId,
    kind: 'image',
    promptKind: 'scene',
  })
  if (a) return a
  return useAssetStore.getState().latest({
    sceneId,
    scenarioId: currentScenarioId,
    kind: 'image',
  })
}

function startGenerate(
  sceneId: string,
  prompt: string,
  client: ImageClient,
  set: (fn: (s: CacheState) => Partial<CacheState>) => void,
  get: () => CacheState,
): Promise<string | null> {
  const t0 = performance.now()
  // 全局美术风格：读当下 scenario.visualStyle，拼到 prompt 前面。
  // 在 startGenerate 内一次集中处理，保证 ensure / retry 都走同一条路径；
  // 原 prompt（不带风格前缀）仍写入 record.prompt / asset.meta.prompt —— 方便
  // 作者切换风格时能从"原文"推导最新前缀，而不是"前缀套前缀"。
  const style = useScenarioStore.getState().scenario.visualStyle
  const finalPrompt = composeVisualPrompt(prompt, style)
  const promise = (async (): Promise<string | null> => {
    try {
      const out = await client.generate({ prompt: finalPrompt, size: '1024x1024' })
      const latencyMs = Math.round(performance.now() - t0)

      // 1) 立刻显示（base64 dataUrl）
      set((s) => ({
        records: {
          ...s.records,
          [sceneId]: {
            status: 'ready',
            dataUrl: out.dataUrl,
            prompt,
            latencyMs,
          },
        },
      }))

      // 2) 后台落盘 —— 不阻塞返回；成功后回写 assetId
      void (async () => {
        const scenarioId = useScenarioStore.getState().scenario.id
        const asset = await useAssetStore.getState().saveDataUrl({
          kind: 'image',
          dataUrl: out.dataUrl,
          meta: {
            scenarioId,
            sceneId,
            promptKind: 'scene',
            prompt,
            model: client.getModel(),
            latencyMs,
            source: client.getProviderName(),
          },
        })
        if (asset) {
          set((s) => {
            const cur = s.records[sceneId]
            if (cur?.status !== 'ready') return s
            return {
              records: {
                ...s.records,
                [sceneId]: { ...cur, assetId: asset.id },
              },
            }
          })
        }
      })()

      return out.dataUrl
    } catch (e) {
      set((s) => ({
        records: {
          ...s.records,
          [sceneId]: {
            status: 'error',
            message: (e as Error).message,
            prompt,
          },
        },
      }))
      return null
    }
  })()

  set((s) => ({
    records: { ...s.records, [sceneId]: { status: 'pending', promise, prompt } },
  }))

  return promise
}
