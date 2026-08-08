import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  deleteReferenceImage,
  gvaImageUrl,
  ImageUploadError,
  uploadReferenceImage,
} from '../image-assets'

const extension = vi.hoisted(() => ({
  fetch: vi.fn((path: string, init?: RequestInit) => fetch(path, init)),
  url: vi.fn((path: string) => `https://host.test/extension/runtime/${path.replace(/^\/+/, '')}`),
}))

vi.mock('../../../lib/workbench-host', () => ({
  getWorkbenchHost: () => ({ extension, ready: vi.fn(async () => undefined) }),
}))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('gvaImageUrl', () => {
  it('builds a same-origin, revisioned image URL', () => {
    expect(gvaImageUrl('a-img-1/2', 'demo game', 42)).toBe(
      '/api/v1/kino/resources/a-img-1%2F2/content?game_id=demo%20game&v=42',
    )
  })
})

describe('deleteReferenceImage', () => {
  it('deletes an uploaded image through the shared resource API', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ code: 0, message: 'ok', data: null }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    vi.stubGlobal('fetch', fetchMock)

    await deleteReferenceImage('demo game', 'a-img-1')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/kino/resources/a-img-1?game_id=demo%20game',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('surfaces server refusal messages', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({
        code: 403,
        message: 'Only uploaded images can be deleted',
        data: null,
      }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    )))

    await expect(deleteReferenceImage('demo', 'a-charref-hero')).rejects.toEqual(
      new ImageUploadError('Only uploaded images can be deleted'),
    )
  })
})

describe('uploadReferenceImage', () => {
  it('preserves the real Kino resource id in provider metadata', async () => {
    type XhrMock = {
      onload: (() => void) | null
      upload: { onprogress: ((event: ProgressEvent<EventTarget>) => void) | null }
      status: number
      responseText: string
    }
    const xhrInstances: XhrMock[] = []
    class MockXHR {
      onload: XhrMock['onload'] = null
      onerror: (() => void) | null = null
      onabort: (() => void) | null = null
      upload = { onprogress: null as XhrMock['upload']['onprogress'] }
      status = 200
      responseText = ''
      open = vi.fn()
      send = vi.fn()
      setRequestHeader = vi.fn()
      abort = vi.fn()
      constructor() {
        xhrInstances.push(this as unknown as XhrMock)
      }
    }
    vi.stubGlobal('XMLHttpRequest', MockXHR)
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : input.toString()
      if (url.endsWith('/image-assets/upload')) {
        return new Response(JSON.stringify({
          code: 0,
          message: 'ok',
          data: {
            upload: {
              method: 'PUT',
              url: 'https://upload.example/image-token',
              headers: { 'content-type': 'image/png' },
              expires_at: '2099-01-01T00:00:00.000Z',
              chunk_size: 3,
              chunk_count: 1,
            },
            object_url: 'https://media.example/reference.png',
            upload_token: 'opaque-token',
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response(JSON.stringify({
        code: 0,
        message: 'ok',
        data: {
          resource_id: 'kino-image-resource',
          game_id: 'demo',
          media_type: 'image',
          name: 'reference',
          url: 'https://media.example/reference.png',
          created_at: 1,
          updated_at: 2,
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))

    const upload = uploadReferenceImage(
      'demo',
      new File(['png'], 'reference.png', { type: 'image/png' }),
      'scene',
    )
    await vi.waitFor(() => expect(xhrInstances).toHaveLength(1))
    xhrInstances[0]?.onload?.()

    await expect(upload).resolves.toMatchObject({
      id: 'kino-image-resource',
      provider: {
        kind: 'kino',
        ref: 'https://media.example/reference.png',
        upstreamResourceId: 'kino-image-resource',
      },
    })
  })
})
