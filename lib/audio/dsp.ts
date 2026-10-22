// Small pure DSP helpers. No Web Audio types — unit-tested under Node.

import type { TrackState } from "./types.ts"

/**
 * Deterministic PRNG (mulberry32). Returns a function yielding floats in [0, 1).
 * Same seed → same sequence, so noise and reverb impulses are identical in the live
 * graph and in the offline export.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Loop-aware tail folding. `rendered` is a render of one loop plus a tail (length >= loopFrames).
 * Returns a NEW Float32Array of exactly loopFrames samples where every sample at index i >= loopFrames
 * is added onto index i % loopFrames (tails longer than a whole loop wrap repeatedly). A note that
 * rings past the loop end therefore continues at the loop start instead of being cut off (no click
 * at the seam). Throws RangeError if loopFrames < 1 or rendered.length < loopFrames.
 */
export function foldTail(rendered: Float32Array, loopFrames: number): Float32Array {
  if (loopFrames < 1 || rendered.length < loopFrames) {
    throw new RangeError("foldTail: loopFrames must be >= 1 and <= rendered.length")
  }
  const out = new Float32Array(loopFrames)
  for (let i = 0; i < rendered.length; i++) out[i % loopFrames] += rendered[i]
  return out
}

/**
 * Waveform overview: splits `data` into `bins` contiguous chunks (sizes differ by at most one
 * sample) and returns max |sample| of each, clamped to [0, 1]. Returns [] for empty data or
 * bins < 1. If data.length < bins, returns data.length bins.
 */
export function computePeaks(data: Float32Array, bins: number): number[] {
  const len = data.length
  if (len === 0 || bins < 1) return []
  const n = Math.min(Math.floor(bins), len)
  const peaks: number[] = []
  for (let b = 0; b < n; b++) {
    const from = Math.floor((b * len) / n)
    const to = Math.floor(((b + 1) * len) / n)
    let m = 0
    for (let i = from; i < to; i++) {
      const v = Math.abs(data[i])
      if (v > m) m = v
    }
    peaks.push(Math.min(1, m))
  }
  return peaks
}

/** Max |sample| over the array (0 for empty). */
export function peakLevel(data: Float32Array): number {
  let m = 0
  for (let i = 0; i < data.length; i++) {
    const v = Math.abs(data[i])
    if (v > m) m = v
  }
  return m
}

/** Fader position 0..1 → linear gain. Square law (audio taper): v * v, clamped to [0, 1]. */
export function faderToGain(volume: number): number {
  const v = Math.min(1, Math.max(0, volume))
  return v * v
}

/** MIDI note → Hz (69 = 440 Hz, 12-TET). */
export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12)
}

/**
 * DJ filter mapping for TrackFx.filter (x clamped to -1..1), driving a low-pass and a high-pass
 * biquad in series so the type never switches (no clicks):
 *  - |x| < 0.02: lowpassHz = 20000, highpassHz = 10 (flat)
 *  - x < 0:      lowpassHz = 20000 * 0.01 ** (-x)  (20 kHz → 200 Hz), highpassHz = 10
 *  - x > 0:      highpassHz = 10 * 600 ** x        (10 Hz → 6 kHz),  lowpassHz = 20000
 * Q is 0.9 for both. Web Audio low-/high-pass Q is resonance in dB (not a linear Q), so 0.9 is a
 * gentle 0.9 dB peak at the cutoff.
 */
export function filterSettings(x: number): { lowpassHz: number; highpassHz: number; q: number } {
  const c = Math.min(1, Math.max(-1, x))
  let lowpassHz = 20000
  let highpassHz = 10
  if (c <= -0.02) lowpassHz = 20000 * 0.01 ** -c
  else if (c >= 0.02) highpassHz = 10 * 600 ** c
  return { lowpassHz, highpassHz, q: 0.9 }
}

/**
 * WaveShaper curve for TrackFx.drive. Returns null when amount < 0.01 (bypass).
 * Otherwise k = 1 + 15 * amount and curve[i] = tanh(k * x) / tanh(k) for x evenly spaced in
 * [-1, 1] over `samples` points (odd-symmetric, curve[0] = -1, curve[last] = 1).
 */
export function driveCurve(amount: number, samples = 2049): Float32Array | null {
  if (amount < 0.01) return null
  const k = 1 + 15 * amount
  const norm = Math.tanh(k)
  const curve = new Float32Array(samples)
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1
    curve[i] = Math.tanh(k * x) / norm
  }
  curve[0] = -1
  curve[samples - 1] = 1
  return curve
}

/** Output trim after the shaper so drive does not jump in loudness: 1 / sqrt(1 + 15 * amount). */
export function driveMakeup(amount: number): number {
  return 1 / Math.sqrt(1 + 15 * amount)
}

/**
 * Stereo reverb impulse: two channels of seeded white noise (mulberry32(seed) for L,
 * mulberry32(seed + 1) for R, values in [-1, 1)) shaped by the envelope (1 - t/T) ** decay
 * where T = seconds. Length Math.round(seconds * sampleRate).
 */
export function reverbImpulse(sampleRate: number, seconds: number, decay: number, seed: number): [Float32Array, Float32Array] {
  const length = Math.round(seconds * sampleRate)
  const T = seconds
  const channels: Float32Array[] = [mulberry32(seed), mulberry32(seed + 1)].map((rand) => {
    const ch = new Float32Array(length)
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate
      ch[i] = (rand() * 2 - 1) * (1 - t / T) ** decay
    }
    return ch
  })
  return [channels[0], channels[1]]
}

/**
 * Solo logic: a track is audible when it is not muted and either no track is soloed or this
 * track is soloed.
 */
export function isAudible(track: Pick<TrackState, "muted" | "soloed">, all: ReadonlyArray<Pick<TrackState, "soloed">>): boolean {
  return !track.muted && (!all.some((t) => t.soloed) || track.soloed)
}

/** In-place overdub: target[i] += source[i] for i < min(lengths). */
export function mixInto(target: Float32Array, source: Float32Array): void {
  const n = Math.min(target.length, source.length)
  for (let i = 0; i < n; i++) target[i] += source[i]
}
