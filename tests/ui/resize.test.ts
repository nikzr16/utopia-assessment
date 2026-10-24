import { describe, expect, it, vi } from 'vitest'
import { preparePhoto, type PhotoCodec } from '../../src/features/attachments/resize'

function codec(width: number, height: number, encoded: Blob | null = new Blob(['small'], { type: 'image/jpeg' })) {
  const close = vi.fn()
  const c: PhotoCodec = {
    decode: vi.fn(async () => ({ width, height, image: {} as CanvasImageSource, close })),
    encode: vi.fn(async () => encoded),
  }
  return { c, close }
}

const photo = new Blob(['x'.repeat(1000)], { type: 'image/png' })

describe('preparePhoto (PRD Q5)', () => {
  it('shrinks a large photo to 2048 px on the long side and saves it as JPEG', async () => {
    const { c, close } = codec(4032, 3024)
    const out = await preparePhoto(photo, 'image/png', c)
    expect(c.encode).toHaveBeenCalledWith(expect.anything(), 2048, 1536, 0.85)
    expect(out.mime).toBe('image/jpeg')
    expect(await out.body.text()).toBe('small')
    expect(close).toHaveBeenCalled()
  })

  it('keeps a photo that is already small enough as it is', async () => {
    const { c } = codec(1600, 1200)
    expect(await preparePhoto(photo, 'image/png', c)).toEqual({ body: photo, mime: 'image/png' })
    expect(c.encode).not.toHaveBeenCalled()
  })

  it('sends HEIC, videos and PDFs as they are, without decoding', async () => {
    const { c } = codec(4000, 3000)
    for (const mime of ['image/heic', 'video/mp4', 'application/pdf']) {
      expect(await preparePhoto(photo, mime, c)).toEqual({ body: photo, mime })
    }
    expect(c.decode).not.toHaveBeenCalled()
  })

  it('falls back to the original when the browser cannot read or redraw the photo', async () => {
    const unreadable: PhotoCodec = { decode: async () => null, encode: vi.fn() }
    expect(await preparePhoto(photo, 'image/jpeg', unreadable)).toEqual({ body: photo, mime: 'image/jpeg' })
    const { c } = codec(5000, 5000, null)
    expect(await preparePhoto(photo, 'image/jpeg', c)).toEqual({ body: photo, mime: 'image/jpeg' })
  })
})
