/* Local looks of an agent (PRD F-SHELL-6, v1.2): a display name and a photo kept in app.db on this computer only. They
   are never sent to the VPS and never change profile.yaml or the Hermes config. */

export interface AgentLook {
  /** Shown instead of the name Hermes reports; null keeps Hermes's name. */
  name: string | null
  /** A 96×96 PNG as a data: URL; null shows the initials. */
  photo: string | null
}

export type AgentLooks = Record<string, AgentLook>

export const LOOK_NAME_MAX = 24
export const PHOTO_SIZE = 96
/** The largest photo the renderer may send (it sends a 96×96 PNG, normally a few KB). */
export const PHOTO_MAX_CHARS = 200_000
export const PHOTO_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/

/** A display name as stored: trimmed, inner whitespace collapsed, no control characters; null when empty. */
export function cleanLookName(raw: string): string | null {
  const s = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  return s ? s.slice(0, LOOK_NAME_MAX) : null
}

/**
 * Where a centred square crop of a w×h picture starts and how big it is, after zooming in by `zoom` (1 = the largest
 * square that fits). `dx`/`dy` move the square from the centre, as a share of the room there is (-1..1).
 */
export function squareCrop(w: number, h: number, zoom = 1, dx = 0, dy = 0): { sx: number; sy: number; side: number } {
  const side = Math.max(1, Math.round(Math.min(w, h) / Math.max(1, zoom)))
  const clamp = (v: number): number => Math.max(-1, Math.min(1, v))
  const roomX = (w - side) / 2
  const roomY = (h - side) / 2
  return { sx: Math.round(roomX + clamp(dx) * roomX), sy: Math.round(roomY + clamp(dy) * roomY), side }
}
