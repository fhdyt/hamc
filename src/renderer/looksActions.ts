import { PHOTO_SIZE, squareCrop } from '@shared/looks'
import { useLooks } from './stores/looks'

/* IO for the local agent looks (F-SHELL-6). Nothing here reaches the server. */

export async function loadLooks(): Promise<void> {
  try {
    useLooks.getState().setLooks(await window.mc.looks.get())
  } catch {
    // no saved connection yet: initials and Hermes names stay
  }
}

/** Saves a local display name; null or blank goes back to the name Hermes reports. Answers an error text or null. */
export async function saveLookName(profile: string, name: string | null): Promise<string | null> {
  try {
    const look = await window.mc.looks.setName(profile, name && name.trim() ? name : null)
    useLooks.getState().setLook(profile, look)
    return null
  } catch {
    return 'The name could not be saved.'
  }
}

/** Crops a picked picture to a centred square of 96×96 and saves it; null removes the photo. Answers an error or null. */
export async function saveLookPhoto(profile: string, file: Blob | null): Promise<string | null> {
  let url: string | null = null
  if (file) {
    if (!/^image\//.test(file.type)) return 'Pick a picture file (PNG, JPEG, WebP or GIF).'
    if (file.size > 20 * 1024 * 1024) return 'The picture is larger than 20 MB.'
    try {
      url = await squarePng(file)
    } catch {
      return 'The picture could not be read.'
    }
  }
  try {
    const look = await window.mc.looks.setPhoto(profile, url)
    useLooks.getState().setLook(profile, look)
    return null
  } catch {
    return 'The photo could not be saved.'
  }
}

async function squarePng(file: Blob): Promise<string> {
  const bmp = await createImageBitmap(file)
  try {
    const c = squareCrop(bmp.width, bmp.height)
    const canvas = document.createElement('canvas')
    canvas.width = PHOTO_SIZE
    canvas.height = PHOTO_SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no canvas')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bmp, c.sx, c.sy, c.side, c.side, 0, 0, PHOTO_SIZE, PHOTO_SIZE)
    return canvas.toDataURL('image/png')
  } finally {
    bmp.close()
  }
}
