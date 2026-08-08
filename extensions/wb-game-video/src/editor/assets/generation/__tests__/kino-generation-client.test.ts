// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { acquireHostInit, resetHostInitForTests } from '../../../../lib/forgeax-http'
import {
  KINO_GENERATIONS_ROUTE,
  createKinoGeneration,
  getKinoGeneration,
  isActiveGenerationStatus,
  listActiveKinoGenerations,
  type CreateKinoGenerationInput,
} from '../kino-generation-client'

const TASK = {
  generation_id: 'gen-1',
  status: 'succeeded',
  prompt_text: '雨夜追逐',
  model: 'seedance2',
  result_url: 'https://cdn.example.com/gen-1.mp4',
  resource: { resource_id: 'res-1' },
}

const INPUT: CreateKinoGenerationInput = {
  gameSlug: 'demo',
  prompt: '雨夜追逐',
  durationSeconds: 5,
  generateAudio: true,
  visualStyleKey: 'bwcinema',
}

interface StubbedResponse {
  status?: number
  body: unknown
}

function ok(data: unknown): StubbedResponse {
  return { body: { code: 0, message: 'ok', data } }
}

function stubFetch(responses: readonly StubbedResponse[]) {
  const calls: { url: string; init?: RequestInit }[] = []
  const queue = [...responses]
  const impl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const next = queue.shift()
    if (!next) throw new Error(`Unexpected fetch: ${url}`)
    const status = next.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(next.body),
    } as unknown as Response
  })
  vi.stubGlobal('fetch', impl)
  return { calls, impl }
}

describe('same-origin Kino generation transport', () => {
  beforeEach(() => resetHostInitForTests())
  afterEach(() => {
    vi.unstubAllGlobals()
    resetHostInitForTests()
  })

  it('posts to the product route and returns a directly playable result url', async () => {
    const { calls } = stubFetch([ok(TASK)])

    const task = await createKinoGeneration(INPUT)

    expect(calls[0]?.url).toBe(KINO_GENERATIONS_ROUTE)
    expect(calls[0]?.init?.method).toBe('POST')
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      game_id: 'demo',
      media_type: 'video',
      duration_sec: 5,
      add_to_resource: true,
      content: [{ type: 'text', text: '雨夜追逐' }],
      extra: { generate_audio: true },
      visual_style_key: 'bwcinema',
    })
    expect(task).toMatchObject({
      generationId: 'gen-1',
      status: 'succeeded',
      prompt: '雨夜追逐',
      resultUrl: 'https://cdn.example.com/gen-1.mp4',
      resourceId: 'res-1',
    })
  })

  it('restores playback from the Kino resource CDN URL when result_url is absent', async () => {
    stubFetch([ok({
      ...TASK,
      result_url: undefined,
      resource: {
        resource_id: 'res-restored',
        url: 'https://cdn.example.com/restored.mp4',
      },
    })])

    await expect(getKinoGeneration('gen-1', 'demo')).resolves.toMatchObject({
      generationId: 'gen-1',
      resourceId: 'res-restored',
      resultUrl: 'https://cdn.example.com/restored.mp4',
    })
  })

  it('sends the handshake game id using the native Kino contract', async () => {
    const { calls } = stubFetch([ok(TASK)])

    await createKinoGeneration(INPUT)

    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({ game_id: 'demo' })
  })

  it('applies host rewrite rules so an in-process host can serve the route from its own origin', async () => {
    acquireHostInit([{
      from: /^\/api\/v1\/kino\/generations(\/.*)?$/,
      to: 'https://mate.example.com/api/v1/kino/generations$1',
    }])
    const { calls } = stubFetch([ok(TASK)])

    await getKinoGeneration('gen-1', 'demo')

    expect(calls[0]?.url).toBe(
      'https://mate.example.com/api/v1/kino/generations/gen-1',
    )
  })

  it('rejects a blank gameSlug before reaching the network', async () => {
    const { impl } = stubFetch([])

    await expect(createKinoGeneration({ ...INPUT, gameSlug: '   ' })).rejects.toMatchObject({
      status: 400,
      errorCode: 'missing_game_slug',
    })
    expect(impl).not.toHaveBeenCalled()
  })

  it('scopes and encodes a single-task poll', async () => {
    const { calls } = stubFetch([ok({ ...TASK, generation_id: 'gen 2', status: 'polling' })])

    const task = await getKinoGeneration('gen 2', 'demo')

    expect(calls[0]?.url).toBe(`${KINO_GENERATIONS_ROUTE}/gen%202`)
    expect(task.status).toBe('polling')
  })

  it('lists the tasks a refresh has to recover', async () => {
    const { calls } = stubFetch([ok({
      items: [TASK, { generation_id: 'gen-2', status: 'polling' }],
    })])

    const tasks = await listActiveKinoGenerations('demo')

    expect(calls[0]?.url).toBe(
      `${KINO_GENERATIONS_ROUTE}?game_id=demo&media_type=video&page=1&page_size=100`,
    )
    expect(tasks.map((task) => task.generationId)).toEqual(['gen-1', 'gen-2'])
  })

  it('rejects a task the upstream returned with an unusable id or status', async () => {
    stubFetch([ok({ generation_id: 'gen-1', status: 'weird' })])
    await expect(getKinoGeneration('gen-1', 'demo')).rejects.toMatchObject({
      status: 502,
      errorCode: 'upstream_unavailable',
    })

    stubFetch([ok({ status: 'succeeded' })])
    await expect(getKinoGeneration('gen-1', 'demo')).rejects.toMatchObject({
      status: 502,
      errorCode: 'upstream_unavailable',
    })
  })

  it('surfaces the upstream failure envelope instead of a generic transport error', async () => {
    stubFetch([{
      status: 502,
      body: {
        code: -1,
        data: null,
        message: 'Kino rejected the generation',
        error_code: 'generation_failed',
      },
    }])

    await expect(createKinoGeneration(INPUT)).rejects.toMatchObject({
      message: 'Kino rejected the generation',
      errorCode: 'generation_failed',
    })
  })

  it('treats only the in-flight statuses as active', () => {
    expect(['pending', 'submitting', 'polling'].map(
      (status) => isActiveGenerationStatus(status as 'polling'),
    )).toEqual([true, true, true])
    expect(['succeeded', 'failed', 'cancelled'].map(
      (status) => isActiveGenerationStatus(status as 'failed'),
    )).toEqual([false, false, false])
  })
})
