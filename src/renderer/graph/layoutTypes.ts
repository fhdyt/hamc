/** Force sliders of the Second brain controls, each from 0 to 1. */
export interface Forces {
  center: number
  repel: number
  link: number
  distance: number
}

export type ToWorker =
  | {
      type: 'set'
      /** Positions as x,y pairs. NaN means "no position yet". */
      pos: Float32Array
      /** Edge endpoints as s,t pairs of node indices. */
      edges: Int32Array
      forces: Forces
      /** Drawn radius of every node in world units; nodes are kept from overlapping. */
      radii: Float32Array
      /** Starting energy of the simulation (1 for a fresh layout, lower when only a few nodes changed). */
      alpha: number
    }
  | { type: 'forces'; forces: Forces }
  | { type: 'radii'; radii: Float32Array }
  | { type: 'drag'; i: number; x: number; y: number }
  | { type: 'release'; i: number }
  | { type: 'reheat'; alpha: number }

export type FromWorker = { type: 'tick'; pos: Float32Array; alpha: number } | { type: 'settled' }

export const forceValues = (f: Forces): { gravity: number; charge: number; strength: number; distance: number } => ({
  gravity: 0.005 + f.center * 0.12,
  charge: -(10 + f.repel * 140),
  strength: 0.2 + f.link * 1.6,
  distance: 15 + f.distance * 100
})
