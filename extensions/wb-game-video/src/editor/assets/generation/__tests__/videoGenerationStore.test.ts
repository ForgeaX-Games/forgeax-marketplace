import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VideoGenerationTask } from '../generation-api'
import {
  listActiveVideoGenerationTasks,
  getVideoGenerationTask,
  useVideoGenerationStore,
} from '../videoGenerationStore'

const listActiveKinoGenerations = vi.fn()
const getKinoGeneration = vi.fn()

vi.mock('../kino-generation-client', async () => {
  const actual = await import('../kino-generation-client')
  return {
    isActiveGenerationStatus: actual.isActiveGenerationStatus,
    listActiveKinoGenerations: (...args: unknown[]) => listActiveKinoGenerations(...args),
    getKinoGeneration: (...args: unknown[]) => getKinoGeneration(...args),
  }
})

function task(
  generationId: string,
  status: VideoGenerationTask['status'],
  overrides: Partial<VideoGenerationTask> = {},
): VideoGenerationTask {
  return { generationId, status, createdAt: 123, ...overrides }
}

describe('global video generation store', () => {
  beforeEach(() => {
    useVideoGenerationStore.setState({ byGame: {} })
    listActiveKinoGenerations.mockReset()
    getKinoGeneration.mockReset()
  })

  it('keeps only the still-advancing Kino tasks and their persisted prompt', async () => {
    listActiveKinoGenerations.mockResolvedValue([
      task('generation-1', 'polling', { prompt: '雨夜追逐镜头' }),
      task('generation-2', 'succeeded'),
    ])

    await expect(listActiveVideoGenerationTasks('game-a')).resolves.toEqual([
      task('generation-1', 'polling', { prompt: '雨夜追逐镜头' }),
    ])
    expect(listActiveKinoGenerations).toHaveBeenCalledWith('game-a', {})
  })

  it('stores task selection outside page component lifetime', async () => {
    listActiveKinoGenerations.mockResolvedValue([])
    await useVideoGenerationStore.getState().refresh('game-a')
    useVideoGenerationStore.getState().select('game-a', 'generation-1')

    expect(useVideoGenerationStore.getState().byGame['game-a']?.selectedGenerationId)
      .toBe('generation-1')
  })

  it('loads the selected task detail from the same-origin Kino endpoint', async () => {
    getKinoGeneration.mockResolvedValue(task('generation-1', 'succeeded', {
      prompt: '已完成的提示词',
      resourceId: 'resource-1',
      resultUrl: 'https://cdn.example.com/generation-1.mp4',
    }))

    await expect(getVideoGenerationTask('game-a', 'generation-1')).resolves.toMatchObject({
      generationId: 'generation-1',
      status: 'succeeded',
      prompt: '已完成的提示词',
      resourceId: 'resource-1',
      resultUrl: 'https://cdn.example.com/generation-1.mp4',
    })
    expect(getKinoGeneration).toHaveBeenCalledWith('generation-1', 'game-a', {})
  })

  it('publishes a completion revision when a globally active task leaves the list', async () => {
    listActiveKinoGenerations
      .mockResolvedValueOnce([task('generation-1', 'polling')])
      .mockResolvedValueOnce([])

    await useVideoGenerationStore.getState().refresh('game-a')
    expect(useVideoGenerationStore.getState().byGame['game-a']?.completionRevision).toBe(0)
    await useVideoGenerationStore.getState().refresh('game-a')
    expect(useVideoGenerationStore.getState().byGame['game-a']?.completionRevision).toBe(1)
    expect(listActiveKinoGenerations).toHaveBeenCalledTimes(2)
  })
})
