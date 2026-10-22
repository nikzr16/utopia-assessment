import { PHOTO_JPEG_QUALITY, PHOTO_MAX_DIMENSION, canResizePhoto, fitWithin } from '../../domain'

/**
 * Shrink a large photo in the browser before upload (PRD Q5): JPEG, PNG and
 * WebP wider or taller than 2048 px are redrawn at most 2048 px on the long
 * side and saved as JPEG. Everything else (small photos, HEIC, videos, PDFs,
 * or a photo the browser cannot read) is sent as it is.
 */
export interface PhotoCodec {
  /** Decode with the camera's orientation applied, or null when the browser cannot. */
  decode: (file: Blob) => Promise<{ width: number; height: number; image: CanvasImageSource; close?: () => void } | null>
  /** Draw at the given size and encode as JPEG, or null on failure. */
  encode: (image: CanvasImageSource, width: number, height: number, quality: number) => Promise<Blob | null>
}

export const browserCodec: PhotoCodec = {
  async decode(file) {
    if (typeof createImageBitmap !== 'function') return null
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { width: bitmap.width, height: bitmap.height, image: bitmap, close: () => bitmap.close() }
    } catch {
      return null
    }
  },
  async encode(image, width, height, quality) {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(image, 0, 0, width, height)
    return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality))
  },
}

export async function preparePhoto(
  file: Blob,
  mime: string,
  codec: PhotoCodec = browserCodec,
): Promise<{ body: Blob; mime: string }> {
  if (!canResizePhoto(mime)) return { body: file, mime }
  const decoded = await codec.decode(file)
  if (!decoded) return { body: file, mime }
  try {
    const size = fitWithin(decoded.width, decoded.height, PHOTO_MAX_DIMENSION)
    if (size.width === decoded.width && size.height === decoded.height) return { body: file, mime }
    const blob = await codec.encode(decoded.image, size.width, size.height, PHOTO_JPEG_QUALITY)
    return blob ? { body: blob, mime: 'image/jpeg' } : { body: file, mime }
  } finally {
    decoded.close?.()
  }
}
