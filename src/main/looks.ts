import { PHOTO_MAX_CHARS, PHOTO_RE, PHOTO_SIZE, squareCrop } from '@shared/looks'

/** The part of Electron's `nativeImage` used here (tests pass a fake). */
export interface ImageLike {
  isEmpty(): boolean
  getSize(): { width: number; height: number }
  crop(r: { x: number; y: number; width: number; height: number }): ImageLike
  resize(o: { width: number; height: number; quality?: 'good' | 'better' | 'best' }): ImageLike
  toPNG(): Buffer
}

/**
 * Turns the picture the renderer cropped into the one stored: decoded by Electron (so it really is an image), cut to a
 * centred square if it is not one, 96×96, re-encoded as PNG (no metadata survives). Null for anything else.
 */
export function normalizePhoto(dataUrl: string, decode: (url: string) => ImageLike): string | null {
  if (dataUrl.length > PHOTO_MAX_CHARS || !PHOTO_RE.test(dataUrl)) return null
  let img: ImageLike
  try {
    img = decode(dataUrl)
  } catch {
    return null
  }
  if (img.isEmpty()) return null
  const { width, height } = img.getSize()
  if (width < 8 || height < 8) return null
  if (width !== height) {
    const c = squareCrop(width, height)
    img = img.crop({ x: c.sx, y: c.sy, width: c.side, height: c.side })
  }
  const png = img.resize({ width: PHOTO_SIZE, height: PHOTO_SIZE, quality: 'best' }).toPNG()
  return `data:image/png;base64,${png.toString('base64')}`
}
