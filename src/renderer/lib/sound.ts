import type { ReplyTone } from '@shared/notify'

/* The reply sounds, made with WebAudio at play time (no audio files, nothing for the CSP to allow). Each tone is a few
   short notes with a quick attack and an exponential fade, so they stay soft and never clip. */

export interface Note {
  /** Seconds after the start. */
  at: number
  dur: number
  freq: number
  /** The pitch the note slides to by its end, for a sweep. */
  to?: number
  wave: OscillatorType
  /** 0..1, multiplied by the volume setting. */
  gain: number
}

export const TONES: Record<ReplyTone, Note[]> = {
  // two bell notes a fifth apart (E5, B5)
  chime: [
    { at: 0, dur: 0.35, freq: 659.25, wave: 'sine', gain: 0.5 },
    { at: 0.09, dur: 0.5, freq: 987.77, wave: 'sine', gain: 0.4 }
  ],
  // one short rising bubble
  pop: [{ at: 0, dur: 0.14, freq: 520, to: 900, wave: 'triangle', gain: 0.55 }],
  // two quick terminal blips
  blip: [
    { at: 0, dur: 0.06, freq: 880, wave: 'square', gain: 0.18 },
    { at: 0.09, dur: 0.06, freq: 1320, wave: 'square', gain: 0.18 }
  ]
}

export const TONE_LABEL: Record<ReplyTone, string> = { chime: 'Chime', pop: 'Pop', blip: 'Blip' }

/** How long a tone lasts, in seconds. */
export const toneLength = (tone: ReplyTone): number => Math.max(...TONES[tone].map((n) => n.at + n.dur))

/** The peak gain of one note: never above 0.6, silent at volume 0. */
export const peakGain = (note: Note, volume: number): number => Math.min(0.6, Math.max(0, note.gain * Math.min(1, Math.max(0, volume))))
