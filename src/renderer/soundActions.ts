import { inQuietHours, replySoundPlays, type ReplyTone } from '@shared/notify'
import { TONES, peakGain } from './lib/sound'
import { useUi } from './stores/ui'

let ctx: AudioContext | null = null
let lastAt = 0

/** Plays one tone. A second reply within 0.4 s does not ring again, so several agents finishing together stay one sound. */
export function playTone(tone: ReplyTone, volume: number): void {
  if (typeof AudioContext === 'undefined' || volume <= 0) return
  const now = performance.now()
  if (now - lastAt < 400) return
  lastAt = now
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    const t0 = ctx.currentTime + 0.01
    for (const n of TONES[tone]) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = n.wave
      osc.frequency.setValueAtTime(n.freq, t0 + n.at)
      if (n.to) osc.frequency.exponentialRampToValueAtTime(n.to, t0 + n.at + n.dur)
      const peak = peakGain(n, volume)
      gain.gain.setValueAtTime(0.0001, t0 + n.at)
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + n.at + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + n.dur)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t0 + n.at)
      osc.stop(t0 + n.at + n.dur + 0.02)
    }
  } catch {
    /* no audio device: stay silent */
  }
}

/** A reply finished: rings when the setting says so (never in the quiet hours). */
export function playReplySound(away: boolean): void {
  const s = useUi.getState().settings
  const d = new Date()
  const quiet = inQuietHours(s['notify.quiet'], d.getHours() * 60 + d.getMinutes())
  if (replySoundPlays(s['notify.replySound'], { away, quiet })) playTone(s['notify.replyTone'], s['notify.volume'])
}

/** The Play button in Settings (always rings, the quiet hours aside). */
export function previewTone(tone: ReplyTone, volume: number): void {
  lastAt = 0
  playTone(tone, volume)
}
