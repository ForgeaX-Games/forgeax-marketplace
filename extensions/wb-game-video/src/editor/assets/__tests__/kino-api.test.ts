import { describe, expect, it, vi } from 'vitest'
import {
  createKinoVideoClient,
  KinoClientError,
  type KinoResourceDTO,
} from '../kino-api'

const FIXTURE_BYTES = 6

function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data }
}

function makeFetch(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>,
) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(input, init)),
  ) as typeof fetch
}

describe('createKinoVideoClient', () => {
  it('normalizes baseUrl without trailing slash', async () => {
    const fetchImpl = makeFetch((input, init) => {
      expect(String(input)).toBe('/api/v1/kino/resources?media_type=video&page=1&page_size=20')
      expect(init?.credentials).toBe('include')
      expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json' })
      return new Response(JSON.stringify(envelope({ items: [], total: 0, page: 1, page_size: 20 })), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    const client = createKinoVideoClient({ fetch: fetchImpl, baseUrl: '/api/v1/kino/' })
    await client.list({ page: 1, page_size: 20 })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('list encodes query params including optional type', async () => {
    const fetchImpl = makeFetch((input) => {
      expect(String(input)).toBe(
        'media/resources?media_type=video&page=2&page_size=10&type=UPLOAD',
      )
      return new Response(JSON.stringify(envelope({ items: [], total: 0, page: 2, page_size: 10 })), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    const client = createKinoVideoClient({ fetch: fetchImpl })
    await client.list({
      media_type: 'video',
      page: 2,
      page_size: 10,
      type: 'UPLOAD',
    })
  })

  it('passes only the caller signal while preserving credentials and headers', async () => {
    const controller = new AbortController()
    const fetchImpl = makeFetch((_input, init) => {
      expect(init?.signal).toBe(controller.signal)
      expect(init?.credentials).toBe('include')
      expect(init?.headers).toEqual({ 'Content-Type': 'application/json' })
      return new Response(
        JSON.stringify(envelope({ items: [], total: 0, page: 1, page_size: 20 })),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })
    const client = createKinoVideoClient({ fetch: fetchImpl })

    await client.list({}, { signal: controller.signal })
  })

  it('prepareUpload posts media metadata without a caller-selected game id', async () => {
    const fetchImpl = makeFetch((input, init) => {
      expect(String(input)).toBe('media/image-assets/upload')
      expect(init?.method).toBe('POST')
      expect(JSON.parse(String(init?.body))).toEqual({
        file_name: 'clip.mp4',
        mime_type: 'video/mp4',
        bytes: FIXTURE_BYTES,
        extension: 'mp4',
      })
      return new Response(
        JSON.stringify(
          envelope({
            upload: {
              method: 'PUT',
              url: 'http://127.0.0.1:18900/api/v1/kino/uploads/token?game_id=demo',
              headers: { 'content-type': 'video/mp4' },
              expires_at: '2099-01-01T00:00:00.000Z',
            },
            object_url: 'http://127.0.0.1:18900/api/v1/kino/uploads/token',
            upload_token: 'token',
          }),
        ),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })
    const client = createKinoVideoClient({ fetch: fetchImpl })
    const prepared = await client.prepareUpload({
      file_name: 'clip.mp4',
      mime_type: 'video/mp4',
      bytes: FIXTURE_BYTES,
      extension: 'mp4',
    })
    expect(prepared.upload_token).toBe('token')
  })

  it('binds a relative host upload instruction to the handshake URL', async () => {
    const fetchImpl = makeFetch(() =>
      new Response(JSON.stringify(envelope({
        upload: {
          method: 'PUT',
          url: 'media/uploads/0123456789abcdef0123456789abcdef',
          headers: { 'content-type': 'image/png' },
          expires_at: '2099-01-01T00:00:00.000Z',
          chunk_size: 512 * 1024,
          chunk_count: 3,
        },
        object_url: 'workbench-upload:0123456789abcdef0123456789abcdef',
        upload_token: '0123456789abcdef0123456789abcdef',
      })), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const client = createKinoVideoClient({
      fetch: fetchImpl,
      url: (path) => `https://host.test/extension/runtime/${path.replace(/^\/+/, '')}`,
    })

    const prepared = await client.prepareUpload({
      file_name: 'large.png',
      mime_type: 'image/png',
      bytes: 1024 * 1024 + 1,
    })

    expect(prepared.upload.url).toBe(
      'https://host.test/extension/runtime/media/uploads/0123456789abcdef0123456789abcdef',
    )
    expect(prepared.upload).toMatchObject({ chunk_size: 512 * 1024, chunk_count: 3 })
  })

  it('accepts audio resource and upload MIME types', async () => {
    const fetchImpl = makeFetch((input, init) => {
      if (init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toMatchObject({ mime_type: 'audio/ogg' })
        return new Response(JSON.stringify(envelope({
          upload: { method: 'PUT', url: 'https://storage.example/upload', headers: {}, expires_at: '2099-01-01' },
          object_url: 'https://storage.example/object',
          upload_token: 'token',
        })), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      expect(String(input)).toBe('media/resources?media_type=audio&page=1&page_size=20')
      return new Response(JSON.stringify(envelope({ items: [], total: 0, page: 1, page_size: 20 })), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    const client = createKinoVideoClient({ fetch: fetchImpl })

    await client.prepareUpload({ file_name: 'theme.ogg', mime_type: 'audio/ogg', bytes: FIXTURE_BYTES })
    await client.list({ media_type: 'audio', page: 1, page_size: 20 })
  })

  it('serializes replacement fields when preparing an upload', async () => {
    const fetchImpl = makeFetch((_input, init) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        file_name: 'replacement.mp4',
        mime_type: 'video/mp4',
        bytes: FIXTURE_BYTES,
        client_resource_id: 'res-existing',
        replace_existing: true,
      })
      return new Response(
        JSON.stringify(envelope({
          upload: {
            method: 'PUT',
            url: 'http://127.0.0.1:18900/upload',
            headers: {},
            expires_at: '2099-01-01T00:00:00.000Z',
          },
          object_url: 'http://127.0.0.1:18900/object',
          upload_token: 'token',
        })),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })
    const client = createKinoVideoClient({ fetch: fetchImpl })

    await client.prepareUpload({
      file_name: 'replacement.mp4',
      mime_type: 'video/mp4',
      bytes: FIXTURE_BYTES,
      client_resource_id: 'res-existing',
      replace_existing: true,
    })
  })

  it('get/update/delete/playbackUrl stay on handshake-bound resource paths', async () => {
    const calls: string[] = []
    const fetchImpl = makeFetch((input, init) => {
      calls.push(String(input))
      if (init?.method === 'DELETE') {
        return new Response(JSON.stringify(envelope(null)), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      const dto: KinoResourceDTO = {
        resource_id: 'res-1',
        media_type: 'video',
        url: 'http://127.0.0.1/content',
        created_at: 1,
        updated_at: 2,
      }
      return new Response(JSON.stringify(envelope(dto)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    const client = createKinoVideoClient({
      fetch: fetchImpl,
      url: (path) => `https://host.test/extension/runtime${path}`,
    })
    await client.get('res/1')
    await client.update('res/1', {
      resource_id: 'res/1',
      media_type: 'video',
      url: 'http://127.0.0.1/content',
      name: 'renamed.mp4',
    })
    await client.delete('res/1')
    expect(client.playbackUrl('res/1')).toBe(
      'https://host.test/extension/runtime/media/resources/res%2F1/content',
    )
    expect(calls[0]).toBe('media/resources/res%2F1')
    expect(calls[1]).toBe('media/resources/res%2F1')
    expect(calls[2]).toBe('media/resources/res%2F1')
  })

  it('accepts the router DELETE 204 contract without parsing JSON', async () => {
    const fetchImpl = makeFetch((_input, init) => {
      expect(init?.method).toBe('DELETE')
      return new Response(null, { status: 204 })
    })
    const client = createKinoVideoClient({ fetch: fetchImpl })

    await expect(client.delete('res-1')).resolves.toBeUndefined()
  })

  it('create and batch post JSON bodies', async () => {
    const fetchImpl = makeFetch((input, init) => {
      expect(init?.method).toBe('POST')
      const body = JSON.parse(String(init?.body))
      if (String(input).endsWith('/batch')) {
        expect(body).toEqual({
          resources: [{ media_type: 'video', url: 'http://x', name: 'a.mp4' }],
        })
        return new Response(
          JSON.stringify(envelope({ created_count: 1, skipped_count: 0, items: [] })),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      expect(body.url).toBe('http://object')
      return new Response(
        JSON.stringify(
          envelope({
            resource_id: 'new',
            media_type: 'video',
            url: 'http://object',
            created_at: 1,
            updated_at: 2,
          }),
        ),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })
    const client = createKinoVideoClient({ fetch: fetchImpl })
    await client.create({
      media_type: 'video',
      url: 'http://object',
      name: 'clip.mp4',
    })
    await client.batch({
      resources: [{ media_type: 'video', url: 'http://x', name: 'a.mp4' }],
    })
  })

  it('drops legacy game_id fields at the host request boundary', async () => {
    const bodies: unknown[] = []
    const fetchImpl = makeFetch((_input, init) => {
      bodies.push(JSON.parse(String(init?.body)))
      return new Response(JSON.stringify(envelope({
        resource_id: 'new',
        media_type: 'video',
        url: 'http://object',
        created_at: 1,
        updated_at: 2,
      })), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    const client = createKinoVideoClient({ fetch: fetchImpl })

    await client.create({
      game_id: 'query-game',
      media_type: 'video',
      url: 'http://object',
    } as never)
    await client.update('new', {
      game_id: 'query-game',
      resource_id: 'new',
      media_type: 'video',
      url: 'http://object',
    } as never)

    expect(bodies).toEqual([
      { media_type: 'video', url: 'http://object' },
      { resource_id: 'new', media_type: 'video', url: 'http://object' },
    ])
  })

  it('throws typed KinoClientError on HTTP and business failures without leaking body', async () => {
    const fetchImpl = makeFetch(() =>
      new Response('{"code":400,"message":"Invalid upload size","data":null,"error_code":"invalid_upload_size","debug":"secret"}', {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const client = createKinoVideoClient({ fetch: fetchImpl })
    await expect(client.list({})).rejects.toMatchObject({
      name: 'KinoClientError',
      status: 400,
      errorCode: 'invalid_upload_size',
      message: 'Invalid upload size',
    })
    await expect(client.list({})).rejects.not.toSatisfy((error: Error) =>
      error.message.includes('secret'),
    )
  })

  it('truncates upstream envelope messages to 512 characters', async () => {
    const fetchImpl = makeFetch(() =>
      new Response(
        JSON.stringify({
          code: 500,
          message: 'x'.repeat(700),
          data: null,
          error_code: 'upstream_unavailable',
        }),
        { status: 500, headers: { 'content-type': 'application/json' } },
      ),
    )
    const client = createKinoVideoClient({ fetch: fetchImpl })

    await expect(client.list({})).rejects.toSatisfy(
      (error: KinoClientError) =>
        error.message.length === 512 &&
        error.status === 500 &&
        error.errorCode === 'upstream_unavailable',
    )
  })

  it('normalizes 401, empty, malformed JSON, and network errors', async () => {
    const unauthorized = createKinoVideoClient({
      fetch: makeFetch(() =>
        new Response('{"code":401,"message":"Unauthorized","data":null,"error_code":"unauthorized"}', {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    })
    await expect(unauthorized.list({})).rejects.toMatchObject({
      status: 401,
      errorCode: 'unauthorized',
    })

    const empty = createKinoVideoClient({
      fetch: makeFetch(() => new Response('', { status: 200 })),
    })
    await expect(empty.list({})).rejects.toMatchObject({
      status: 502,
      errorCode: 'upstream_unavailable',
    })

    const malformed = createKinoVideoClient({
      fetch: makeFetch(() => new Response('not-json', { status: 200 })),
    })
    await expect(malformed.list({})).rejects.toMatchObject({
      status: 502,
      errorCode: 'upstream_unavailable',
    })

    const network = createKinoVideoClient({
      fetch: vi.fn(() => Promise.reject(new Error('offline'))) as typeof fetch,
    })
    await expect(network.list({})).rejects.toMatchObject({
      status: 502,
      errorCode: 'network_error',
    })
  })
})
