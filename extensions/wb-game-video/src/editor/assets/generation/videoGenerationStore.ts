import { useEffect } from 'react'
import { create } from 'zustand'
import type { KinoRequestOptions } from '../kino-api'
import type { VideoGenerationTask } from './generation-api'
import {
  getKinoGeneration,
  isActiveGenerationStatus,
  listActiveKinoGenerations,
} from './kino-generation-client'

export const VIDEO_GENERATION_POLL_INTERVAL_MS = 3_000

export interface VideoGenerationStoreEntry {
  tasks: readonly VideoGenerationTask[]
  selectedGenerationId?: string
  selectedTask?: VideoGenerationTask
  loading: boolean
  error: string | null
  revision: number
  completionRevision: number
}
interface VideoGenerationStore {
  byGame: Record<string, VideoGenerationStoreEntry | undefined>
  refresh: (gameSlug: string, options?: KinoRequestOptions) => Promise<void>
  select: (gameSlug: string, generationId?: string) => void
}

const EMPTY_ENTRY: VideoGenerationStoreEntry = {
  tasks: [],
  loading: false,
  error: null,
  revision: 0,
  completionRevision: 0,
}

/**
 * Kino 是生成任务的权威：任务在 Kino 侧继续推进，页面卸载或刷新后由这个
 * app 级 store 从同一个同源端点恢复提示词与状态，不依赖宿主 placeholder。
 */
export async function listActiveVideoGenerationTasks(
  gameSlug: string,
  options: KinoRequestOptions = {},
): Promise<VideoGenerationTask[]> {
  const tasks = await listActiveKinoGenerations(gameSlug, options)
  return tasks.filter((task) => isActiveGenerationStatus(task.status))
}

export async function getVideoGenerationTask(
  gameSlug: string,
  generationId: string,
  options: KinoRequestOptions = {},
): Promise<VideoGenerationTask> {
  return getKinoGeneration(generationId, gameSlug, options)
}

export const useVideoGenerationStore = create<VideoGenerationStore>((set, get) => ({
  byGame: {},

  async refresh(gameSlug, options) {
    const current = get().byGame[gameSlug] ?? EMPTY_ENTRY
    const revision = current.revision + 1
    set((state) => ({
      byGame: {
        ...state.byGame,
        [gameSlug]: { ...current, loading: current.tasks.length === 0, error: null, revision },
      },
    }))
    try {
      const tasks = await listActiveVideoGenerationTasks(gameSlug, options)
      const selectedGenerationId = current.selectedGenerationId
      const selectedTask = selectedGenerationId === undefined
        ? undefined
        : tasks.find((task) => task.generationId === selectedGenerationId)
          ?? await getVideoGenerationTask(gameSlug, selectedGenerationId, options)
      if ((get().byGame[gameSlug]?.revision ?? 0) !== revision) return
      set((state) => ({
        byGame: (() => {
          const previous = state.byGame[gameSlug] ?? EMPTY_ENTRY
          const activeIds = new Set(tasks.map((task) => task.generationId))
          const completed = previous.tasks.some((task) => !activeIds.has(task.generationId))
          return {
            ...state.byGame,
            [gameSlug]: {
              ...previous,
              completionRevision: previous.completionRevision + (completed ? 1 : 0),
              tasks,
              selectedTask,
              loading: false,
              error: null,
              revision,
            },
          }
        })(),
      }))
    } catch (error) {
      if (options?.signal?.aborted || (get().byGame[gameSlug]?.revision ?? 0) !== revision) return
      set((state) => ({
        byGame: {
          ...state.byGame,
          [gameSlug]: {
            ...(state.byGame[gameSlug] ?? EMPTY_ENTRY),
            loading: false,
            error: error instanceof Error ? error.message : String(error),
            revision,
          },
        },
      }))
    }
  },

  select(gameSlug, generationId) {
    set((state) => {
      const current = state.byGame[gameSlug] ?? EMPTY_ENTRY
      return {
        byGame: {
          ...state.byGame,
          [gameSlug]: generationId === undefined
            ? {
                ...current,
                revision: current.revision + 1,
                selectedGenerationId: undefined,
                selectedTask: undefined,
              }
            : {
                ...current,
                revision: current.revision + 1,
                selectedGenerationId: generationId,
                selectedTask: current.tasks.find((task) => task.generationId === generationId),
              },
        },
      }
    })
  },
}))

/** One app-level subscriber owns polling; page components only consume snapshots. */
export function useGlobalVideoGenerationTracker(gameSlug: string): void {
  const refresh = useVideoGenerationStore((state) => state.refresh)
  useEffect(() => {
    const controller = new AbortController()
    void refresh(gameSlug, { signal: controller.signal })
    const timer = window.setInterval(() => {
      void refresh(gameSlug, { signal: controller.signal })
    }, VIDEO_GENERATION_POLL_INTERVAL_MS)
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [gameSlug, refresh])
}
