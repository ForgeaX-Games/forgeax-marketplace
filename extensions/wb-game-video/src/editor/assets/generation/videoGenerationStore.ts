import { useEffect } from 'react'
import { create } from 'zustand'
import type { KinoRequestOptions } from '../kino-api'
import { getRegistryAsset, listRegistryAssets } from '../../shell/media'
import type { MediaAsset } from '../registry-types'
import type { VideoGenerationTask, VideoGenerationStatus } from './generation-api'

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
 * Reads Workbench-owned durable placeholders. Generation continues inside the
 * host when the page unmounts, while this app-level store recovers prompt and
 * status from the same asset registry used by the extension backend.
 */
export async function listActiveVideoGenerationTasks(
  gameSlug: string,
  options: KinoRequestOptions = {},
): Promise<VideoGenerationTask[]> {
  const assets = await listRegistryAssets(gameSlug, 'video', { signal: options.signal })
  return assets
    .filter((asset) => asset.productionType === 'video_clip' && isActiveStatus(asset.status))
    .map(toTask)
}

export async function getVideoGenerationTask(
  gameSlug: string,
  generationId: string,
  options: KinoRequestOptions = {},
): Promise<VideoGenerationTask> {
  if (options.signal?.aborted) throw options.signal.reason
  const asset = await getRegistryAsset(gameSlug, generationId)
  if (!asset || asset.productionType !== 'video_clip') {
    throw new Error('Video generation task was not found')
  }
  return toTask(asset)
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

function toTask(asset: MediaAsset): VideoGenerationTask {
  const status = taskStatus(asset.status)
  return {
    generationId: asset.id,
    status,
    ...(asset.prompt ? { prompt: asset.prompt } : {}),
    ...(typeof asset.meta?.model === 'string' ? { model: asset.meta.model } : {}),
    ...(typeof asset.meta?.taskId === 'string' ? { providerTaskId: asset.meta.taskId } : {}),
    ...(asset.status === 'ready' ? { resourceId: asset.provider?.upstreamResourceId ?? asset.id } : {}),
    ...(asset.error ? { errorMessage: asset.error } : {}),
    createdAt: asset.createdAt,
  }
}

function isActiveStatus(status: MediaAsset['status']): boolean {
  return status === 'placeholder' || status === 'generating'
}

function taskStatus(status: MediaAsset['status']): VideoGenerationStatus {
  if (status === 'placeholder') return 'pending'
  if (status === 'generating') return 'polling'
  if (status === 'ready') return 'succeeded'
  return 'failed'
}
