import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAssetStore, type AssetRecord } from '../assetStore'
import { useSceneImageCache } from '../sceneImageCache'
import { hydrateSceneImagesFromDisk } from '../hydrateSceneImages'
import type { Scenario } from '../../scenario/types'

/**
 * hydrateSceneImagesFromDisk —— 剧情树/播放器挂载时的"批量恢复"入口。
 *
 * 契约：
 *   1. 遍历 scenario.scenes，对所有 IMAGE_* 场景调用 loadFromDisk
 *   2. VIDEO 场景跳过（视频流不走 sceneImageCache）
 *   3. 只查磁盘 —— 不发网络请求（复用 loadFromDisk 的纯查询性质）
 *   4. 幂等 —— 已 ready 的场景不会重复 set（loadFromDisk 内部已处理）
 *   5. 返回值：成功恢复的场景数量 —— 便于测试 + 调用方做日志
 */

function makeAsset(sceneId: string, over: Partial<AssetRecord> = {}): AssetRecord {
  return {
    id: `img-${sceneId}`,
    kind: 'image',
    filename: `blobs/img-${sceneId}.png`,
    mimeType: 'image/png',
    bytes: 1,
    createdAt: 1000,
    meta: { sceneId, prompt: 'test prompt' },
    ...over,
  }
}

function makeScenario(scenes: Record<string, { kind: 'IMAGE_PROMPT' | 'VIDEO' | 'IMAGE_STATIC' | 'PLACEHOLDER'; prompt?: string }>): Scenario {
  const sceneEntries = Object.entries(scenes).map(([id, spec]) => [
    id,
    {
      id,
      title: `场景 ${id}`,
      durationMs: 6000,
      media: { kind: spec.kind, prompt: spec.prompt },
      dialogue: [],
      branches: [],
    },
  ])
  return {
    id: 'test',
    title: 'Test',
    rootSceneId: Object.keys(scenes)[0] ?? 'a',
    scenes: Object.fromEntries(sceneEntries),
    defaultCharMs: 32,
    schemaVersion: 2,
  }
}

describe('hydrateSceneImagesFromDisk', () => {
  beforeEach(() => {
    useSceneImageCache.getState().clear()
    useAssetStore.setState({
      records: [],
      loaded: true,
      loading: false,
      error: null,
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 200 })),
    )
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:mock'),
      revokeObjectURL: vi.fn(),
    })
  })

  it('把磁盘里有缓存的场景全部灌进 sceneImageCache', () => {
    useAssetStore.setState({
      records: [
        makeAsset('a'),
        makeAsset('b'),
        makeAsset('c'),
      ],
      loaded: true,
      loading: false,
      error: null,
    })
    const scenario = makeScenario({
      a: { kind: 'IMAGE_PROMPT', prompt: 'p-a' },
      b: { kind: 'IMAGE_PROMPT', prompt: 'p-b' },
      c: { kind: 'IMAGE_PROMPT', prompt: 'p-c' },
    })

    const n = hydrateSceneImagesFromDisk(scenario)

    expect(n).toBe(3)
    const records = useSceneImageCache.getState().records
    expect(records.a?.status).toBe('ready')
    expect(records.b?.status).toBe('ready')
    expect(records.c?.status).toBe('ready')
  })

  it('VIDEO 场景不参与批量加载（不进 sceneImageCache）', () => {
    useAssetStore.setState({
      records: [makeAsset('a'), makeAsset('v')],
      loaded: true,
      loading: false,
      error: null,
    })
    const scenario = makeScenario({
      a: { kind: 'IMAGE_PROMPT', prompt: 'p-a' },
      v: { kind: 'VIDEO' },
    })

    const n = hydrateSceneImagesFromDisk(scenario)

    expect(n).toBe(1)
    expect(useSceneImageCache.getState().records.a?.status).toBe('ready')
    expect(useSceneImageCache.getState().records.v).toBeUndefined()
  })

  it('磁盘没缓存的场景返回 false，不污染 sceneImageCache', () => {
    useAssetStore.setState({
      records: [makeAsset('a')],
      loaded: true,
      loading: false,
      error: null,
    })
    const scenario = makeScenario({
      a: { kind: 'IMAGE_PROMPT', prompt: 'p-a' },
      b: { kind: 'IMAGE_PROMPT', prompt: 'p-b' },
    })

    const n = hydrateSceneImagesFromDisk(scenario)

    expect(n).toBe(1)
    expect(useSceneImageCache.getState().records.a?.status).toBe('ready')
    expect(useSceneImageCache.getState().records.b).toBeUndefined()
  })

  it('幂等 —— 再调一次已 ready 的场景不会重置或炸开', () => {
    useAssetStore.setState({
      records: [makeAsset('a')],
      loaded: true,
      loading: false,
      error: null,
    })
    const scenario = makeScenario({
      a: { kind: 'IMAGE_PROMPT', prompt: 'p-a' },
    })

    hydrateSceneImagesFromDisk(scenario)
    const firstRecord = useSceneImageCache.getState().records.a
    hydrateSceneImagesFromDisk(scenario)
    const secondRecord = useSceneImageCache.getState().records.a

    expect(firstRecord).toBe(secondRecord)
  })

  it('空 scenario 不崩', () => {
    const scenario = makeScenario({})
    expect(() => hydrateSceneImagesFromDisk(scenario)).not.toThrow()
  })
})
