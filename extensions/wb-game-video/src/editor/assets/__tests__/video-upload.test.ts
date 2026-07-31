import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import * as videoUpload from '../video-upload'
import {
  assertMediaUploadFile,
  completePreparedVideoUpload,
  createDefaultXhrUploadTransport,
  MAX_IMAGE_UPLOAD_BYTES,
  MAX_VIDEO_UPLOAD_BYTES,
  uploadVideoResource,
  VideoUploadError,
  type PreparedVideoUpload,
  type UploadTransport,
} from '../video-upload'
import { createKinoVideoClient, type DirectUploadResponse, type KinoResourceDTO } from '../kino-api'

const FIXTURE = new Uint8Array([0, 1, 2, 3, 4, 5])

function makeMp4File(name = 'clip.mp4', mime = 'video/mp4'): File {
  return new File([FIXTURE], name, { type: mime })
}

function preparedResponse(): DirectUploadResponse {
  return {
    upload: {
      method: 'PUT',
      url: 'http://127.0.0.1:18900/api/v1/kino/uploads/token',
      headers: { 'content-type': 'video/mp4', 'x-cos-forbid-overwrite': 'true' },
      expires_at: '2099-01-01T00:00:00.000Z',
    },
    object_url: 'http://127.0.0.1:18900/api/v1/kino/uploads/token',
    upload_token: 'token-1',
  }
}

function createdResource(): KinoResourceDTO {
  return {
    resource_id: 'res-new',
    media_type: 'video',
    name: 'clip.mp4',
    url: 'http://127.0.0.1:18900/api/v1/kino/resources/res-new/content',
    created_at: 10,
    updated_at: 20,
  }
}

describe('uploadVideoResource validation', () => {
  it('rejects non-mp4 extension, wrong mime, empty mime, oversize, and non-safe bytes', async () => {
    const client = createKinoVideoClient({
      fetch: vi.fn() as typeof fetch,
    })
    const transport: UploadTransport = { put: vi.fn() }

    await expect(
      uploadVideoResource({
        client,
        transport,
        file: makeMp4File('clip.mov'),
      }),
    ).rejects.toMatchObject({ code: 'invalid_file_name' })

    await expect(
      uploadVideoResource({
        client,
        transport,
        file: makeMp4File('clip.mp4', 'video/webm'),
      }),
    ).rejects.toMatchObject({ code: 'invalid_media_type' })

    await expect(
      uploadVideoResource({
        client,
        transport,
        file: makeMp4File('clip.mp4', ''),
      }),
    ).rejects.toMatchObject({ code: 'invalid_media_type' })

    await expect(
      uploadVideoResource({
        client,
        transport,
        file: new File([], 'clip.mp4', { type: 'video/mp4' }),
      }),
    ).rejects.toMatchObject({ code: 'invalid_upload_size' })

    const huge = new File([new Uint8Array(1)], 'clip.mp4', { type: 'video/mp4' })
    Object.defineProperty(huge, 'size', { value: MAX_VIDEO_UPLOAD_BYTES + 1 })
    await expect(
      uploadVideoResource({ client, transport, file: huge }),
    ).rejects.toMatchObject({ code: 'invalid_upload_size' })
  })
})

describe('shared browser media upload policy', () => {
  it('uses the server image cap and requires m4a for audio/mp4', () => {
    const oversizedImage = new File(['x'], 'cover.png', { type: 'image/png' })
    Object.defineProperty(oversizedImage, 'size', { value: MAX_IMAGE_UPLOAD_BYTES + 1 })

    expect(() => assertMediaUploadFile('image', oversizedImage)).toThrow(
      expect.objectContaining({ code: 'invalid_upload_size' }),
    )
    expect(() => assertMediaUploadFile(
      'audio',
      new File(['x'], 'theme.mp4', { type: 'audio/mp4' }),
    )).toThrow(expect.objectContaining({ code: 'invalid_file_name' }))
    expect(() => assertMediaUploadFile(
      'audio',
      new File(['x'], 'theme.m4a', { type: 'audio/mp4' }),
    )).not.toThrow()
  })
})

describe('uploadVideoResource flow', () => {
  it('runs prepare → transport PUT → create in order', async () => {
    const order: string[] = []
    const controller = new AbortController()
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/image-assets/upload')) {
        order.push('prepare')
        return new Response(JSON.stringify({ code: 0, message: 'ok', data: preparedResponse() }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url.endsWith('/resources') && init?.method === 'POST') {
        order.push('create')
        expect(JSON.parse(String(init.body))).toMatchObject({
          source_meta: {
            duration_ms: 1200,
            mime_type: 'video/mp4',
          },
        })
        return new Response(JSON.stringify({ code: 0, message: 'ok', data: createdResource() }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      throw new Error(`unexpected fetch ${url}`)
    }) as typeof fetch

    const transport: UploadTransport = {
      put: vi.fn(async (_file, _instruction, _onProgress, signal) => {
        expect(signal).toBe(controller.signal)
        order.push('put')
      }),
    }

    const progress: number[] = []
    const resource = await uploadVideoResource({
      client: createKinoVideoClient({ fetch: fetchImpl }),
      transport,
      file: makeMp4File(),
      durationMs: 1200,
      onProgress: (value) => progress.push(value),
      signal: controller.signal,
    })

    expect(order).toEqual(['prepare', 'put', 'create'])
    expect(resource.resource_id).toBe('res-new')
    expect(progress.at(-1)).toBe(100)
    expect(progress.every((value, index) => index === 0 || value >= progress[index - 1]!)).toBe(true)
  })

  it('replaces through the shared prepare, transfer, and complete flow', async () => {
    const replaceVideoResource = (
      videoUpload as unknown as {
        replaceVideoResource?: (options: {
          client: import('../kino-api').KinoVideoClient
          transport: UploadTransport
          resourceId: string
          file: File
        }) => Promise<KinoResourceDTO>
      }
    ).replaceVideoResource
    expect(replaceVideoResource).toBeTypeOf('function')
    if (!replaceVideoResource) return

    const prepareUpload = vi.fn(async () => preparedResponse())
    const create = vi.fn(async (input) => ({
      ...createdResource(),
      resource_id: 'res-existing',
      url: input.url,
      updated_at: 30,
    }))
    const transport: UploadTransport = { put: vi.fn(async () => {}) }
    const client = {
      prepareUpload,
      create,
    } as unknown as import('../kino-api').KinoVideoClient

    const resource = await replaceVideoResource({
      client,
      transport,
      resourceId: 'res-existing',
      file: makeMp4File('replacement.mp4'),
    })

    expect(prepareUpload).toHaveBeenCalledWith({
      file_name: 'replacement.mp4',
      mime_type: 'video/mp4',
      bytes: FIXTURE.byteLength,
      client_resource_id: 'res-existing',
      replace_existing: true,
    }, { signal: undefined })
    expect(transport.put).toHaveBeenCalledOnce()
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      media_type: 'video',
      url: preparedResponse().object_url,
    }), { signal: undefined })
    expect(resource.resource_id).toBe('res-existing')
  })

  it('keeps the replacement id in retry state when completion fails', async () => {
    const client = {
      prepareUpload: vi.fn(async () => preparedResponse()),
      create: vi.fn(async () => {
        throw new Error('complete failed')
      }),
    } as unknown as import('../kino-api').KinoVideoClient

    await expect(
      videoUpload.replaceVideoResource({
        client,
        transport: { put: vi.fn(async () => {}) },
        resourceId: 'res-existing',
        file: makeMp4File('replacement.mp4'),
      }),
    ).rejects.toMatchObject({
      code: 'complete_failed',
      retryState: {
        replacementResourceId: 'res-existing',
        objectUrl: preparedResponse().object_url,
        uploaded: true,
      },
    })
  })

  it('does not create when transport PUT fails', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/image-assets/upload')) {
        return new Response(JSON.stringify({ code: 0, message: 'ok', data: preparedResponse() }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      throw new Error('create should not run')
    }) as typeof fetch

    const transport: UploadTransport = {
      put: vi.fn(async () => {
        throw new VideoUploadError('upload failed', 'upload_failed')
      }),
    }

    await expect(
      uploadVideoResource({
        client: createKinoVideoClient({ fetch: fetchImpl }),
        transport,
        file: makeMp4File(),
      }),
    ).rejects.toMatchObject({ code: 'upload_failed' })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('returns retry state on create failure and completePreparedVideoUpload skips prepare/transport', async () => {
    let prepareAttempts = 0
    let createAttempts = 0
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/image-assets/upload')) {
        prepareAttempts += 1
        return new Response(JSON.stringify({ code: 0, message: 'ok', data: preparedResponse() }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url.endsWith('/resources') && init?.method === 'POST') {
        createAttempts += 1
        if (createAttempts === 1) {
          return new Response(
            JSON.stringify({
              code: 500,
              message: 'create failed',
              data: null,
              error_code: 'upstream_unavailable',
            }),
            { status: 500, headers: { 'content-type': 'application/json' } },
          )
        }
        return new Response(JSON.stringify({ code: 0, message: 'ok', data: createdResource() }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      throw new Error(`unexpected ${url}`)
    }) as typeof fetch

    const transportPut = vi.fn(async () => {})
    const client = createKinoVideoClient({ fetch: fetchImpl })
    let retryState: PreparedVideoUpload | undefined
    try {
      await uploadVideoResource({
        client,
        transport: { put: transportPut },
        file: makeMp4File(),
        durationMs: 900,
      })
    } catch (error) {
      expect(error).toMatchObject({ code: 'complete_failed' })
      retryState = (error as VideoUploadError).retryState
    }
    expect(retryState).toBeDefined()
    expect(prepareAttempts).toBe(1)
    expect(transportPut).toHaveBeenCalledOnce()
    const transportCallsAfterFirstAttempt = transportPut.mock.calls.length

    const resource = await completePreparedVideoUpload({
      client,
      prepared: retryState!,
    })
    expect(resource.resource_id).toBe('res-new')
    expect(createAttempts).toBe(2)
    expect(prepareAttempts).toBe(1)
    expect(transportPut).toHaveBeenCalledTimes(transportCallsAfterFirstAttempt)
  })

  it('rejects complete when the prepared upload was not transferred', async () => {
    const prepared: PreparedVideoUpload = {
      fileIdentity: {
        name: 'clip.mp4',
        size: FIXTURE.byteLength,
        type: 'video/mp4',
        lastModified: 1,
      },
      response: preparedResponse(),
      objectUrl: preparedResponse().object_url,
      uploadToken: 'token-1',
      uploaded: false,
      createInput: { name: 'clip.mp4' },
    }
    const client = createKinoVideoClient({ fetch: vi.fn() as typeof fetch })

    await expect(completePreparedVideoUpload({ client, prepared })).rejects.toMatchObject({
      code: 'invalid_upload_state',
    })
  })

  it('rejects concurrent duplicate uploads and releases the lock after failure', async () => {
    let releaseFirstPrepare!: () => void
    const firstPrepare = new Promise<void>((resolve) => {
      releaseFirstPrepare = resolve
    })
    let prepareAttempts = 0
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (!String(input).endsWith('/image-assets/upload')) {
        throw new Error('create should not run')
      }
      prepareAttempts += 1
      if (prepareAttempts === 1) {
        await firstPrepare
      }
      return new Response(JSON.stringify({ code: 0, message: 'ok', data: preparedResponse() }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch
    const transport: UploadTransport = {
      put: vi.fn(async () => {
        throw new Error('transfer failed')
      }),
    }
    const options = {
      client: createKinoVideoClient({ fetch: fetchImpl }),
      transport,
      file: makeMp4File(),
    }

    const first = uploadVideoResource(options)
    await expect(uploadVideoResource(options)).rejects.toMatchObject({
      code: 'upload_in_progress',
    })
    expect(prepareAttempts).toBe(1)

    releaseFirstPrepare()
    await expect(first).rejects.toMatchObject({ code: 'upload_failed' })
    await expect(uploadVideoResource(options)).rejects.toMatchObject({ code: 'upload_failed' })
    expect(prepareAttempts).toBe(2)
  })
})

describe('default XHR transport header safety', () => {
  type XhrMock = {
    open: ReturnType<typeof vi.fn>
    send: ReturnType<typeof vi.fn>
    setRequestHeader: ReturnType<typeof vi.fn>
    upload: { onprogress: ((event: ProgressEvent<EventTarget>) => void) | null }
    onload: (() => void) | null
    onerror: (() => void) | null
    onabort: (() => void) | null
    abort: ReturnType<typeof vi.fn>
    status: number
    responseText: string
  }

  let xhrInstances: XhrMock[]
  const OriginalXHR = globalThis.XMLHttpRequest

  beforeEach(() => {
    xhrInstances = []
    class MockXHR {
      open = vi.fn()
      send = vi.fn()
      setRequestHeader = vi.fn()
      upload = { onprogress: null as XhrMock['upload']['onprogress'] }
      onload: XhrMock['onload'] = null
      onerror: XhrMock['onerror'] = null
      onabort: XhrMock['onabort'] = null
      abort = vi.fn(() => this.onabort?.())
      status = 200
      responseText = ''
      constructor() {
        xhrInstances.push(this as unknown as XhrMock)
      }
    }
    globalThis.XMLHttpRequest = MockXHR as unknown as typeof XMLHttpRequest
  })

  afterEach(() => {
    globalThis.XMLHttpRequest = OriginalXHR
  })

  it('sets only server-provided safe headers and rejects forbidden ones', async () => {
    const transport = createDefaultXhrUploadTransport()
    const file = makeMp4File()
    const instruction = preparedResponse().upload

    const promise = transport.put(file, instruction)
    const xhr = xhrInstances[0]!
    xhr.onload?.()
    await promise

    expect(xhr.open).toHaveBeenCalledWith('PUT', instruction.url, true)
    expect(xhr.setRequestHeader).toHaveBeenCalledWith('content-type', 'video/mp4')
    expect(xhr.setRequestHeader).toHaveBeenCalledWith('x-cos-forbid-overwrite', 'true')
    expect(xhr.send).toHaveBeenCalledWith(file)

    const polluted = {
      ...instruction,
      headers: Object.assign(Object.create({ cookie: 'evil' }), {
        Authorization: 'Bearer bad',
        Host: 'evil',
        'Content-Length': '999',
        'x-safe': '1',
      }),
    }
    await expect(transport.put(file, polluted)).rejects.toMatchObject({
      code: 'unsafe_upload_headers',
    })

    for (const header of [
      'Proxy-Authorization',
      'Transfer-Encoding',
      'Connection',
      'TE',
      'Trailer',
    ]) {
      await expect(
        transport.put(file, {
          ...instruction,
          headers: { [header]: 'unsafe' },
        }),
      ).rejects.toMatchObject({ code: 'unsafe_upload_headers' })
    }

    await expect(
      transport.put(file, {
        ...instruction,
        headers: { 'x-safe': 'ok\r\ninjected' },
      }),
    ).rejects.toMatchObject({ code: 'unsafe_upload_headers' })
  })

  it('rejects non-PUT methods and non-http(s) upload URLs', async () => {
    const transport = createDefaultXhrUploadTransport()
    const instruction = preparedResponse().upload

    await expect(
      transport.put(
        makeMp4File(),
        { ...instruction, method: 'POST' } as unknown as typeof instruction,
      ),
    ).rejects.toMatchObject({ code: 'invalid_upload_instruction' })
    await expect(
      transport.put(makeMp4File(), { ...instruction, url: 'javascript:alert(1)' }),
    ).rejects.toMatchObject({ code: 'invalid_upload_instruction' })
    await expect(
      transport.put(makeMp4File(), { ...instruction, url: 'not a url' }),
    ).rejects.toMatchObject({ code: 'invalid_upload_instruction' })
  })

  it('does not open or send when already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const transport = createDefaultXhrUploadTransport()

    await expect(
      transport.put(makeMp4File(), preparedResponse().upload, undefined, controller.signal),
    ).rejects.toMatchObject({ code: 'upload_aborted' })
    expect(xhrInstances).toHaveLength(0)
  })

  it('aborts an in-flight XHR and normalizes network errors', async () => {
    const controller = new AbortController()
    const transport = createDefaultXhrUploadTransport()
    const aborted = transport.put(
      makeMp4File(),
      preparedResponse().upload,
      undefined,
      controller.signal,
    )
    const abortedXhr = xhrInstances[0]!
    controller.abort()
    await expect(aborted).rejects.toMatchObject({ code: 'upload_aborted' })
    expect(abortedXhr.abort).toHaveBeenCalledOnce()

    const network = transport.put(makeMp4File(), preparedResponse().upload)
    xhrInstances[1]!.onerror?.()
    await expect(network).rejects.toMatchObject({ code: 'upload_network_error' })
  })

  it('truncates XHR and wrapped external error messages to 512 characters', async () => {
    const transport = createDefaultXhrUploadTransport()
    const xhrFailure = transport.put(makeMp4File(), preparedResponse().upload)
    const xhr = xhrInstances[0]!
    xhr.status = 500
    xhr.responseText = 'x'.repeat(700)
    xhr.onload?.()
    await expect(xhrFailure).rejects.toSatisfy(
      (error: VideoUploadError) => error.message.length === 512,
    )

    const client = createKinoVideoClient({
      fetch: vi.fn(async () =>
        new Response(JSON.stringify({ code: 0, message: 'ok', data: preparedResponse() }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ) as typeof fetch,
    })
    await expect(
      uploadVideoResource({
        client,
        file: makeMp4File(),
        transport: { put: vi.fn(async () => { throw new Error('y'.repeat(700)) }) },
      }),
    ).rejects.toSatisfy((error: VideoUploadError) => error.message.length === 512)
  })

  it('reports monotonic progress using file.size when total is unknown', async () => {
    const transport = createDefaultXhrUploadTransport()
    const file = makeMp4File()
    const progress: number[] = []
    const promise = transport.put(file, preparedResponse().upload, (value) => progress.push(value))
    const xhr = xhrInstances[0]!
    xhr.upload.onprogress?.({ lengthComputable: false, loaded: 2, total: 0 } as ProgressEvent)
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 3, total: FIXTURE.byteLength } as ProgressEvent)
    xhr.onload?.()
    await promise
    expect(progress).toEqual([expect.any(Number), expect.any(Number)])
    expect(progress[0]!).toBeLessThanOrEqual(progress[1]!)
    expect(progress[1]!).toBeLessThanOrEqual(100)
  })

  it('splits a file larger than 1 MiB into bounded sequential extension requests', async () => {
    const chunkSize = 512 * 1024
    const bytes = new Uint8Array(1024 * 1024 + 7)
    const file = new File([bytes], 'large.mp4', { type: 'video/mp4' })
    const transport = createDefaultXhrUploadTransport()
    const upload = transport.put(file, {
      method: 'PUT',
      url: 'https://host.test/extensions/wb-game-video/media/uploads/0123456789abcdef0123456789abcdef',
      headers: { 'content-type': 'video/mp4' },
      expires_at: '2099-01-01T00:00:00.000Z',
      chunk_size: chunkSize,
      chunk_count: 3,
    })

    for (let index = 0; index < 3; index += 1) {
      await vi.waitFor(() => expect(xhrInstances).toHaveLength(index + 1))
      const xhr = xhrInstances[index]!
      const sent = xhr.send.mock.calls[0]?.[0] as Blob
      expect(sent).toBeInstanceOf(Blob)
      expect(sent.size).toBeLessThan(1024 * 1024)
      expect(xhr.open).toHaveBeenCalledWith(
        'PUT',
        expect.stringContaining(`chunk_index=${index}`),
        true,
      )
      expect(xhr.open).toHaveBeenCalledWith(
        'PUT',
        expect.stringContaining('chunk_count=3'),
        true,
      )
      xhr.upload.onprogress?.({
        lengthComputable: true,
        loaded: sent.size,
        total: sent.size,
      } as ProgressEvent)
      xhr.onload?.()
    }

    await upload
    expect(xhrInstances.map((xhr) => (xhr.send.mock.calls[0]?.[0] as Blob).size)).toEqual([
      chunkSize,
      chunkSize,
      7,
    ])
  })

  it('accepts a safe root-relative handshake upload endpoint', async () => {
    const file = makeMp4File()
    const upload = createDefaultXhrUploadTransport().put(file, {
      ...preparedResponse().upload,
      url: '/extension/runtime/media/uploads/0123456789abcdef0123456789abcdef',
    })
    const xhr = xhrInstances[0]!

    expect(xhr.open).toHaveBeenCalledWith(
      'PUT',
      '/extension/runtime/media/uploads/0123456789abcdef0123456789abcdef',
      true,
    )
    xhr.onload?.()
    await upload
  })
})
