export const ZOOM_MIN = 0.7
export const ZOOM_MAX = 1.5

export function stepZoom(current: number, dir: 1 | -1): number {
  const next = Math.round((current + dir * 0.1) * 10) / 10
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, next))
}

export const zoomPercent = (z: number): string => `${Math.round(z * 100)}%`
