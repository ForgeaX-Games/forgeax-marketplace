import { afterEach, describe, expect, it, vi } from 'vitest'
import { deleteReferenceImage, gvaImageUrl, ImageUploadError } from '../image-assets'

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
