// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  CLIP_GENERATION_TOOL_ID,
  createClipGenerationRequestId,
  submitClipGeneration,
  type ClipGenerationRequest,
  type ClipGenerationSubmission,
  type WorkbenchGenerationToolPort,
} from '../generation-api'
import {
  CLIP_GENERATION_SOURCE,
  useClipGeneration,
  type ClipGenerationRegistryEntry,
} from '../useClipGeneration'

const request: ClipGenerationRequest = {
  gameSlug: 'browser-only-label',
  prompt: 'A knight crossing a rain-soaked bridge',
  durationSeconds: 30,
  generateAudio: true,
  mode: 'strict',
  firstFrameAssetId: 'first-frame',
  lastFrameAssetId: 'last-frame',
  size: '1440x2560',
  resolution: '1080p',
  model: 'seedance2',
  label: 'Bridge shot',
}

const requestIdA = 'client-a-request-id'
const requestIdB = 'client-b-request-id'

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((onResolve) => { resolve = onResolve })
  return { promise, resolve }
}

function registryEntry(
  id: string,
  status: ClipGenerationRegistryEntry['status'],
  requestId: string,
  error?: string,
): ClipGenerationRegistryEntry {
  return {
    id,
    status,
    ...(error ? { error } : {}),
    meta: { source: CLIP_GENERATION_SOURCE, requestId },
  }
}

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve() })
}

describe('Workbench Host generation tool', () => {
  it('calls the Host tool and validates its result envelope', async () => {
    const port: WorkbenchGenerationToolPort = {
      call: vi.fn().mockResolvedValue({
        ok: true,
        result: { assetId: 'generated-video', status: 'ready' },
      }),
    }

    await expect(submitClipGeneration({
      prompt: request.prompt,
      durationSeconds: 15,
      generateAudio: true,
      mode: 'strict',
      firstFrameAssetId: 'first-frame',
      lastFrameAssetId: 'last-frame',
      requestId: requestIdA,
    }, port)).resolves.toEqual({ assetId: 'generated-video', status: 'ready' })
    expect(port.call).toHaveBeenCalledWith(CLIP_GENERATION_TOOL_ID, expect.any(Object))
  })

  it('rejects malformed Host results', async () => {
    const port: WorkbenchGenerationToolPort = {
      call: vi.fn().mockResolvedValue({ ok: true, result: { status: 'ready' } }),
    }
    await expect(submitClipGeneration({
      prompt: 'prompt',
      durationSeconds: 8,
      generateAudio: false,
      mode: 't2v',
      requestId: requestIdA,
    }, port)).rejects.toThrow('invalid response')
  })

  it('surfaces a typed Workbench Host failure', async () => {
    const port: WorkbenchGenerationToolPort = {
      call: vi.fn().mockResolvedValue({
        ok: false,
        error: {
          code: 'generation_failed',
          target: 'media.video.generate',
          message: 'Kino rejected the generation',
          retryable: false,
        },
      }),
    }
    await expect(submitClipGeneration({
      prompt: 'prompt',
      durationSeconds: 8,
      generateAudio: false,
      mode: 't2v',
      requestId: requestIdA,
    }, port)).rejects.toMatchObject({
      code: 'generation_failed',
      target: 'media.video.generate',
      retryable: false,
    })
  })

  it('creates a bounded cryptographic request id', () => {
    const requestId = createClipGenerationRequestId()
    expect(requestId.length).toBeGreaterThan(0)
    expect(requestId.length).toBeLessThanOrEqual(128)
  })
})

describe('useClipGeneration Host-only flow', () => {
  it('starts in Host tool mode and never sends game/provider identities', async () => {
    const submitClip = vi.fn().mockResolvedValue({ assetId: 'video-1', status: 'ready' })
    const { result } = renderHook(() => useClipGeneration([], {
      submitClip,
      createRequestId: () => requestIdA,
    }))

    expect(result.current.state).toEqual({ phase: 'idle', transport: 'tool' })
    act(() => result.current.submit(request))
    await flush()

    expect(submitClip).toHaveBeenCalledWith({
      prompt: request.prompt,
      durationSeconds: 15,
      generateAudio: true,
      mode: 'strict',
      firstFrameAssetId: 'first-frame',
      lastFrameAssetId: 'last-frame',
      label: 'Bridge shot',
      requestId: requestIdA,
    })
    expect(submitClip.mock.calls[0]?.[0]).not.toHaveProperty('gameSlug')
    expect(submitClip.mock.calls[0]?.[0]).not.toHaveProperty('model')
    expect(submitClip.mock.calls[0]?.[0]).not.toHaveProperty('resourceId')
    expect(result.current.state).toEqual({
      phase: 'succeeded', transport: 'tool', assetId: 'video-1',
    })
  })

  it('correlates concurrent identical prompts by request id', async () => {
    const pendingA = deferred<ClipGenerationSubmission>()
    const pendingB = deferred<ClipGenerationSubmission>()
    const clientA = renderHook(
      ({ entries }) => useClipGeneration(entries, {
        submitClip: () => pendingA.promise,
        createRequestId: () => requestIdA,
      }),
      { initialProps: { entries: [] as ClipGenerationRegistryEntry[] } },
    )
    const clientB = renderHook(
      ({ entries }) => useClipGeneration(entries, {
        submitClip: () => pendingB.promise,
        createRequestId: () => requestIdB,
      }),
      { initialProps: { entries: [] as ClipGenerationRegistryEntry[] } },
    )

    act(() => {
      clientA.result.current.submit({ ...request, mode: 't2v' })
      clientB.result.current.submit({ ...request, mode: 't2v' })
    })
    clientA.rerender({ entries: [
      registryEntry('video-b', 'generating', requestIdB),
      registryEntry('video-a', 'generating', requestIdA),
    ] })
    clientB.rerender({ entries: [
      registryEntry('video-b', 'generating', requestIdB),
      registryEntry('video-a', 'generating', requestIdA),
    ] })

    expect(clientA.result.current.state.assetId).toBe('video-a')
    expect(clientB.result.current.state.assetId).toBe('video-b')
  })

  it('uses Host registry status as the progress source of truth', async () => {
    const pending = deferred<ClipGenerationSubmission>()
    const onTerminal = vi.fn()
    const hook = renderHook(
      ({ entries }) => useClipGeneration(entries, {
        submitClip: () => pending.promise,
        createRequestId: () => requestIdA,
        onTerminal,
      }),
      { initialProps: { entries: [] as ClipGenerationRegistryEntry[] } },
    )

    act(() => hook.result.current.submit({ ...request, mode: 't2v' }))
    hook.rerender({ entries: [registryEntry('video-a', 'generating', requestIdA)] })
    expect(hook.result.current.state).toEqual({
      phase: 'generating', transport: 'tool', assetId: 'video-a',
    })
    hook.rerender({ entries: [registryEntry('video-a', 'ready', requestIdA)] })
    expect(hook.result.current.state).toEqual({
      phase: 'succeeded', transport: 'tool', assetId: 'video-a',
    })
    expect(onTerminal).toHaveBeenCalledOnce()
  })

  it('rejects missing Host asset references before calling the tool', () => {
    const submitClip = vi.fn()
    const { result } = renderHook(() => useClipGeneration([], {
      submitClip,
      createRequestId: () => requestIdA,
    }))
    act(() => result.current.submit({
      ...request,
      firstFrameAssetId: undefined,
      lastFrameAssetId: undefined,
    }))
    expect(result.current.state).toMatchObject({
      phase: 'failed',
      transport: 'tool',
      error: expect.stringMatching(/unavailable for tool generation/),
    })
    expect(submitClip).not.toHaveBeenCalled()
  })

  it('cancel ignores a stale Host completion', async () => {
    const pending = deferred<ClipGenerationSubmission>()
    const { result } = renderHook(() => useClipGeneration([], {
      submitClip: () => pending.promise,
      createRequestId: () => requestIdA,
    }))
    act(() => result.current.submit({ ...request, mode: 't2v' }))
    act(() => result.current.cancel())
    await act(async () => pending.resolve({ assetId: 'stale', status: 'ready' }))
    expect(result.current.state).toEqual({ phase: 'idle', transport: 'tool' })
  })
})
