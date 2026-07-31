import { afterEach, describe, expect, it, vi } from 'vitest'
import { deleteReferenceImage, gvaImageUrl, ImageUploadError } from '../image-assets'

const client = {
  extension: {
    fetch: vi.fn(),
    url: vi.fn((path: string) => `https://host.test/extension/runtime/${path.replace(/^\/+/, '')}`),
  },
}

vi.mock('../../../lib/workbench-host', () => ({
  getWorkbenchHost: () => client,
}))

afterEach(() => {
  client.extension.fetch.mockReset()
  vi.unstubAllGlobals()
})

describe('gvaImageUrl', () => {
  it('builds a same-origin, revisioned image URL', () => {
    expect(gvaImageUrl('a-img-1/2', 42)).toBe(
      'https://host.test/extension/runtime/media/resources/a-img-1%2F2/content?v=42',
    )
  })
})

describe('deleteReferenceImage', () => {
  it('deletes an uploaded image through the shared resource API', async () => {
    client.extension.fetch.mockResolvedValueOnce(new Response(
      JSON.stringify({ code: 0, message: 'ok', data: null }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    await deleteReferenceImage('a-img-1')

    expect(client.extension.fetch).toHaveBeenCalledWith(
      'media/resources/a-img-1',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('surfaces server refusal messages', async () => {
    client.extension.fetch.mockResolvedValueOnce(new Response(
      JSON.stringify({
        code: 403,
        message: 'Only uploaded images can be deleted',
        data: null,
      }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    ))

    await expect(deleteReferenceImage('a-charref-hero')).rejects.toEqual(
      new ImageUploadError('Only uploaded images can be deleted'),
    )
  })
})
