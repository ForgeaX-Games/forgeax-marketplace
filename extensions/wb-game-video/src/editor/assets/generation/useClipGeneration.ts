import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from '../../../i18n'
import type { MediaStatus } from '../registry-types'
import {
  assertClipGenerationRequestId,
  createClipGenerationRequestId,
  submitClipGeneration,
  type ClipGenerationRequest,
  type ClipGenerationSubmission,
  type ClipGenerationWireRequest,
  type VideoGenerationTask,
} from './generation-api'

export const CLIP_GENERATION_SOURCE = 'asset-library-generation'

export type ClipGenPhase = 'idle' | 'submitting' | 'generating' | 'succeeded' | 'failed'

export interface ClipGenState {
  phase: ClipGenPhase
  transport?: 'tool'
  generationId?: string
  assetId?: string
  resultUrl?: string
  resourceId?: string
  error?: string
  /** Restored from Kino's durable generation task after navigation/reload. */
  prompt?: string
  /** Kept empty: durable progress is represented by Host registry assets. */
  activeTasks?: readonly VideoGenerationTask[]
}

export interface ClipGenerationRegistryEntry {
  id: string
  status: MediaStatus
  error?: string
  meta?: Readonly<Record<string, unknown>>
}

export interface UseClipGenerationOptions {
  gameSlug?: string
  submitClip?: (request: ClipGenerationWireRequest) => Promise<ClipGenerationSubmission>
  createRequestId?: () => string
  onTerminal?: () => void | Promise<void>
  restoredTask?: VideoGenerationTask
  activeTasks?: readonly VideoGenerationTask[]
}

export interface ClipGenerationController {
  state: ClipGenState
  submit: (request: ClipGenerationRequest) => void
  /** Stops local observation; the Host-owned generation continues. */
  cancel: () => void
  reset: () => void
  /** Legacy sheet callback; Host registry assets are selected by asset id. */
  track: (generationId: string) => void
}

interface TrackedSubmission {
  requestId: string
  idsBeforeSubmit: ReadonlySet<string>
  assetId?: string
}

const IDLE_STATE: ClipGenState = { phase: 'idle', transport: 'tool' }

export function useClipGeneration(
  entries: readonly ClipGenerationRegistryEntry[],
  options: UseClipGenerationOptions = {},
): ClipGenerationController {
  const submitClip = options.submitClip ?? submitClipGeneration
  const createRequestId = options.createRequestId ?? createClipGenerationRequestId
  const onTerminalRef = useRef(options.onTerminal)
  onTerminalRef.current = options.onTerminal

  const [state, setState] = useState<ClipGenState>(IDLE_STATE)
  const epochRef = useRef(0)
  const mountedRef = useRef(true)
  const trackedRef = useRef<TrackedSubmission | null>(null)
  const notifiedAssetRef = useRef<string | null>(null)
  const restoredTask = options.restoredTask
  const restoredTaskKey = restoredTask
    ? JSON.stringify([
        restoredTask.generationId,
        restoredTask.status,
        restoredTask.prompt,
        restoredTask.resultUrl,
        restoredTask.resourceId,
        restoredTask.errorMessage,
      ])
    : ''
  const activeTasks = options.activeTasks ?? []
  const activeTasksKey = JSON.stringify(
    activeTasks.map((task) => [task.generationId, task.status]),
  )

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      epochRef.current += 1
    }
  }, [])

  useEffect(() => {
    const task = restoredTask
    if (!task) return
    trackedRef.current = null
    setState({
      phase: task.status === 'succeeded'
        ? 'succeeded'
        : task.status === 'failed' || task.status === 'cancelled'
          ? 'failed'
          : 'generating',
      transport: 'tool',
      generationId: task.generationId,
      resultUrl: task.resultUrl,
      resourceId: task.resourceId,
      error: task.errorMessage,
      activeTasks,
      prompt: task.prompt,
    })
  }, [restoredTaskKey])

  useEffect(() => {
    setState((current) => {
      if (!current.generationId || tasksEqual(current.activeTasks ?? [], activeTasks)) return current
      return { ...current, activeTasks }
    })
  }, [activeTasksKey])

  useEffect(() => {
    const tracked = trackedRef.current
    if (!tracked) return
    const entry = tracked.assetId
      ? entries.find((candidate) => candidate.id === tracked.assetId
        && matchesCorrelation(candidate, tracked.requestId))
      : findSubmittedEntry(entries, tracked)
    if (!entry) return

    tracked.assetId ??= entry.id
    const next = stateFromEntry(entry)
    if (!next) return
    setState((current) => statesEqual(current, next) ? current : next)
    if ((entry.status === 'ready' || entry.status === 'failed')
      && notifiedAssetRef.current !== entry.id) {
      notifiedAssetRef.current = entry.id
      void onTerminalRef.current?.()
    }
  }, [entries])

  const submit = useCallback((request: ClipGenerationRequest): void => {
    const epoch = ++epochRef.current
    notifiedAssetRef.current = null
    let requestId: string
    let wireRequest: ClipGenerationWireRequest
    try {
      requestId = createRequestId()
      assertClipGenerationRequestId(requestId)
      wireRequest = toHostWireRequest(request, requestId)
    } catch (error) {
      setState({ phase: 'failed', transport: 'tool', error: errorMessage(error) })
      return
    }

    const tracked: TrackedSubmission = {
      requestId,
      idsBeforeSubmit: new Set(entries.map((entry) => entry.id)),
    }
    trackedRef.current = tracked
    setState({ phase: 'submitting', transport: 'tool' })
    void submitClip(wireRequest).then(
      (submission) => {
        if (!mountedRef.current || epochRef.current !== epoch) return
        tracked.assetId = submission.assetId
        setState((current) => terminalState(current, submission))
        if (notifiedAssetRef.current !== submission.assetId) {
          notifiedAssetRef.current = submission.assetId
          void onTerminalRef.current?.()
        }
      },
      (error: unknown) => {
        if (!mountedRef.current || epochRef.current !== epoch) return
        setState((current) => current.phase === 'succeeded' || current.phase === 'failed'
          ? current
          : { phase: 'failed', transport: 'tool', assetId: current.assetId, error: errorMessage(error) })
      },
    )
  }, [createRequestId, entries, submitClip])

  const cancel = useCallback((): void => {
    epochRef.current += 1
    trackedRef.current = null
    setState(IDLE_STATE)
  }, [])

  const track = useCallback((_generationId: string): void => {}, [])
  return { state, submit, cancel, reset: cancel, track }
}

function toHostWireRequest(
  request: ClipGenerationRequest,
  requestId: string,
): ClipGenerationWireRequest {
  assertReferenceIdentities(request)
  return {
    prompt: request.prompt,
    durationSeconds: Math.min(15, request.durationSeconds),
    generateAudio: request.generateAudio,
    mode: request.mode,
    ...(request.firstFrameAssetId ? { firstFrameAssetId: request.firstFrameAssetId } : {}),
    ...(request.lastFrameAssetId ? { lastFrameAssetId: request.lastFrameAssetId } : {}),
    ...(request.referenceImageAssetIds
      ? { referenceImageAssetIds: request.referenceImageAssetIds }
      : {}),
    ...(request.visualStyleKey ? { visualStyleKey: request.visualStyleKey } : {}),
    ...(request.label ? { label: request.label } : {}),
    requestId,
  }
}

function assertReferenceIdentities(request: ClipGenerationRequest): void {
  if (request.mode === 'strict') {
    if (!isNonEmptyId(request.firstFrameAssetId) || !isNonEmptyId(request.lastFrameAssetId)) {
      throw missingReferenceIdentity()
    }
    return
  }
  if (request.mode === 'firstref') {
    if (!isNonEmptyId(request.firstFrameAssetId)) throw missingReferenceIdentity()
    return
  }
  if (request.mode === 'ref' && (
    !request.referenceImageAssetIds?.length
    || !request.referenceImageAssetIds.every(isNonEmptyId)
  )) {
    throw missingReferenceIdentity()
  }
}

function missingReferenceIdentity(): Error {
  return new Error(t('videoAssets.generate.validation.referenceUnavailableTool'))
}

function isNonEmptyId(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function findSubmittedEntry(
  entries: readonly ClipGenerationRegistryEntry[],
  tracked: TrackedSubmission,
): ClipGenerationRegistryEntry | undefined {
  return entries.find((entry) => !tracked.idsBeforeSubmit.has(entry.id)
    && matchesCorrelation(entry, tracked.requestId))
}

function matchesCorrelation(entry: ClipGenerationRegistryEntry, requestId: string): boolean {
  return entry.meta?.source === CLIP_GENERATION_SOURCE && entry.meta.requestId === requestId
}

function stateFromEntry(entry: ClipGenerationRegistryEntry): ClipGenState | null {
  if (entry.status === 'generating') {
    return { phase: 'generating', transport: 'tool', assetId: entry.id }
  }
  if (entry.status === 'ready') {
    return { phase: 'succeeded', transport: 'tool', assetId: entry.id }
  }
  if (entry.status === 'failed') {
    return { phase: 'failed', transport: 'tool', assetId: entry.id, error: entry.error }
  }
  return null
}

function terminalState(
  current: ClipGenState,
  submission: ClipGenerationSubmission,
): ClipGenState {
  if (current.phase === 'succeeded' || current.phase === 'failed') return current
  if (submission.status === 'ready') {
    return { phase: 'succeeded', transport: 'tool', assetId: submission.assetId }
  }
  return {
    phase: 'failed',
    transport: 'tool',
    assetId: submission.assetId,
    error: submission.error,
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function statesEqual(left: ClipGenState, right: ClipGenState): boolean {
  return left.phase === right.phase
    && left.transport === right.transport
    && left.assetId === right.assetId
    && left.error === right.error
}

function tasksEqual(
  left: readonly VideoGenerationTask[],
  right: readonly VideoGenerationTask[],
): boolean {
  return left.length === right.length && left.every((task, index) => {
    const candidate = right[index]
    return candidate?.generationId === task.generationId && candidate.status === task.status
  })
}
