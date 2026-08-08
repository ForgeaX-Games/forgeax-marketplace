import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaAsset } from '../../registry-types'
import {
  listActiveVideoGenerationTasks,
  getVideoGenerationTask,
  useVideoGenerationStore,
} from '../videoGenerationStore'

const listRegistryAssets = vi.fn()
const getRegistryAsset = vi.fn()

vi.mock('../../../shell/media', () => ({
  listRegistryAssets: (...args: unknown[]) => listRegistryAssets(...args),
  getRegistryAsset: (...args: unknown[]) => getRegistryAsset(...args),
}))

function asset(
  id: string,
  status: MediaAsset['status'],
  overrides: Partial<MediaAsset> = {},
): MediaAsset {
  return {
    id,
    kind: 'video',
    productionType: 'video_clip',
    status,
    createdAt: 123,
    updatedAt: 123,
    ...overrides,
  }
}

describe('global video generation store', () => {
  beforeEach(() => {
    useVideoGenerationStore.setState({ byGame: {} })
    listRegistryAssets.mockReset()
    getRegistryAsset.mockReset()
  })

  it('loads Workbench-owned active placeholders and keeps the persisted prompt', async () => {
    listRegistryAssets.mockResolvedValue([
      asset('generation-1', 'generating', { prompt: '雨夜追逐镜头' }),
      asset('generation-2', 'ready'),
    ])

    await expect(listActiveVideoGenerationTasks('game-a')).resolves.toEqual([{
      generationId: 'generation-1',
      status: 'polling',
      prompt: '雨夜追逐镜头',
      createdAt: 123,
    }])
    expect(listRegistryAssets).toHaveBeenCalledWith('game-a', 'video', { signal: undefined })
  })

  it('stores task selection outside page component lifetime', async () => {
    listRegistryAssets.mockResolvedValue([])
    await useVideoGenerationStore.getState().refresh('game-a')
    useVideoGenerationStore.getState().select('game-a', 'generation-1')

    expect(useVideoGenerationStore.getState().byGame['game-a']?.selectedGenerationId)
      .toBe('generation-1')
  })

  it('loads selected task detail from the Workbench asset registry', async () => {
    getRegistryAsset.mockResolvedValue(asset('generation-1', 'ready', {
      prompt: '已完成的提示词',
      provider: { kind: 'kino', ref: 'task-1', upstreamResourceId: 'resource-1' },
    }))

    await expect(getVideoGenerationTask('game-a', 'generation-1')).resolves.toMatchObject({
      generationId: 'generation-1',
      status: 'succeeded',
      prompt: '已完成的提示词',
      resourceId: 'resource-1',
    })
    expect(getRegistryAsset).toHaveBeenCalledWith('game-a', 'generation-1')
  })

  it('publishes a completion revision when a globally active task leaves the list', async () => {
    listRegistryAssets
      .mockResolvedValueOnce([asset('generation-1', 'generating')])
      .mockResolvedValueOnce([])

    await useVideoGenerationStore.getState().refresh('game-a')
    expect(useVideoGenerationStore.getState().byGame['game-a']?.completionRevision).toBe(0)
    await useVideoGenerationStore.getState().refresh('game-a')
    expect(useVideoGenerationStore.getState().byGame['game-a']?.completionRevision).toBe(1)
    expect(listRegistryAssets).toHaveBeenCalledTimes(2)
  })
})
