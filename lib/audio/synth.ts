// Synth voices. Each function schedules one note into ANY BaseAudioContext (live or offline),
// so the demo render, the pads instrument and the export all use the same sounds.
// Every voice must stop() all of its sources so nodes are released after the note ends.

import { mulberry32, midiToHz } from "./dsp.ts"
import type { DrumVoice } from "./types.ts"

/** Exponential ramps cannot reach 0 or start from 0, so amplitudes are floored here. */
const FLOOR = 0.001
const STOP_PAD = 0.02

function noiseSource(ctx: BaseAudioContext, noise: AudioBuffer, time: number, stopAt: number): AudioBufferSourceNode {
  const src = ctx.createBufferSource()
  src.buffer = noise
  src.start(time)
  src.stop(stopAt + STOP_PAD)
  return src
}

function osc(ctx: BaseAudioContext, type: OscillatorType, hz: number, time: number, stopAt: number): OscillatorNode {
  const o = ctx.createOscillator()
  o.type = type
  o.frequency.setValueAtTime(hz, time)
  o.start(time)
  o.stop(stopAt + STOP_PAD)
  return o
}

/** Gain with an exponential decay from `level` at `time` to FLOOR at `time + dur`. */
function decayGain(ctx: BaseAudioContext, level: number, time: number, dur: number): GainNode {
  const g = ctx.createGain()
  g.gain.setValueAtTime(Math.max(level, FLOOR), time)
  g.gain.exponentialRampToValueAtTime(FLOOR, time + dur)
  return g
}

function filter(ctx: BaseAudioContext, type: BiquadFilterType, hz: number, q: number): BiquadFilterNode {
  const f = ctx.createBiquadFilter()
  f.type = type
  f.frequency.value = hz
  f.Q.value = q
  return f
}

/** One second of seeded white noise (dsp.mulberry32(seed)), mono, at ctx.sampleRate. */
export function createNoiseBuffer(ctx: BaseAudioContext, seed = 1): AudioBuffer {
  const buf = new AudioBuffer({ length: ctx.sampleRate, numberOfChannels: 1, sampleRate: ctx.sampleRate })
  const data = buf.getChannelData(0)
  const rand = mulberry32(seed)
  for (let i = 0; i < data.length; i++) data[i] = rand() * 2 - 1
  return buf
}

/**
 * Drum hit at `time` (ctx seconds), velocity 0..1, into `dest`. `noise` from createNoiseBuffer.
 * kick:  sine 150 Hz → 48 Hz exponential over 0.12 s; amp vel → 0.001 exponential over 0.45 s;
 *        plus a 4 ms noise click through a 3 kHz high-pass at 0.3 * vel.
 * snare: noise → 1.2 kHz high-pass, amp 0.7 * vel → 0.001 over 0.2 s; plus triangle body
 *        190 → 160 Hz over 0.08 s, amp 0.5 * vel → 0.001 over 0.12 s.
 * clap:  noise → 1.5 kHz band-pass (Q 1.2); three 8 ms bursts at t, t+11 ms, t+22 ms (amp 0.8 * vel),
 *        then a tail from t+33 ms, 0.6 * vel → 0.001 over 0.15 s.
 * hat:   noise → 7 kHz high-pass, amp 0.35 * vel → 0.001 over 0.05 s.
 */
export function playDrum(ctx: BaseAudioContext, dest: AudioNode, voice: DrumVoice, time: number, velocity: number, noise: AudioBuffer): void {
  const t = time
  const v = velocity
  switch (voice) {
    case "kick": {
      const o = osc(ctx, "sine", 150, t, t + 0.45)
      o.frequency.exponentialRampToValueAtTime(48, t + 0.12)
      const g = decayGain(ctx, v, t, 0.45)
      o.connect(g).connect(dest)
      const click = noiseSource(ctx, noise, t, t + 0.004)
      const hp = filter(ctx, "highpass", 3000, 0.7071)
      const cg = ctx.createGain()
      cg.gain.setValueAtTime(0.3 * v, t)
      cg.gain.setValueAtTime(0, t + 0.004)
      click.connect(hp).connect(cg).connect(dest)
      break
    }
    case "snare": {
      const n = noiseSource(ctx, noise, t, t + 0.2)
      const hp = filter(ctx, "highpass", 1200, 0.7071)
      n.connect(hp).connect(decayGain(ctx, 0.7 * v, t, 0.2)).connect(dest)
      const o = osc(ctx, "triangle", 190, t, t + 0.12)
      o.frequency.linearRampToValueAtTime(160, t + 0.08)
      o.connect(decayGain(ctx, 0.5 * v, t, 0.12)).connect(dest)
      break
    }
    case "clap": {
      const end = t + 0.033 + 0.15
      const n = noiseSource(ctx, noise, t, end)
      const bp = filter(ctx, "bandpass", 1500, 1.2)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, t)
      for (let k = 0; k < 3; k++) {
        const tk = t + 0.011 * k
        g.gain.setValueAtTime(0.8 * v, tk)
        g.gain.setValueAtTime(0, tk + 0.008)
      }
      g.gain.setValueAtTime(Math.max(0.6 * v, FLOOR), t + 0.033)
      g.gain.exponentialRampToValueAtTime(FLOOR, end)
      n.connect(bp).connect(g).connect(dest)
      break
    }
    case "hat": {
      const n = noiseSource(ctx, noise, t, t + 0.05)
      const hp = filter(ctx, "highpass", 7000, 0.7071)
      n.connect(hp).connect(decayGain(ctx, 0.35 * v, t, 0.05)).connect(dest)
      break
    }
  }
}

/**
 * Bass note (finger-style electric bass): sawtooth at f + sine at f/2 (sub, 0.6 level) + a quiet
 * square at f (odd harmonics, 0.12) → low-pass (Q 6) whose cutoff opens 180 → 1100 Hz in 5 ms then
 * decays to 260 Hz over 0.25 s. A 6 ms high-passed square click at 1.6 kHz (0.05 * vel) gives the
 * finger attack, so the note reads as plucked rather than as a synth pad. Amp: 0 → 0.45 * vel in
 * 5 ms, settles to 0.8 of that by 35 ms, holds until time + duration, releases to 0 over 60 ms.
 */
export function playBass(ctx: BaseAudioContext, dest: AudioNode, midi: number, time: number, duration: number, velocity: number): void {
  const f = midiToHz(midi)
  const peak = 0.45 * velocity
  const hold = time + Math.max(duration, 0.035)
  const end = hold + 0.06
  const saw = osc(ctx, "sawtooth", f, time, end)
  const sub = osc(ctx, "sine", f / 2, time, end)
  const subGain = ctx.createGain()
  subGain.gain.value = 0.6
  const body = osc(ctx, "square", f, time, end)
  const bodyGain = ctx.createGain()
  bodyGain.gain.value = 0.12
  const lp = filter(ctx, "lowpass", 180, 6)
  lp.frequency.setValueAtTime(180, time)
  lp.frequency.linearRampToValueAtTime(1100, time + 0.005)
  lp.frequency.exponentialRampToValueAtTime(260, time + 0.005 + 0.25)
  const amp = ctx.createGain()
  amp.gain.setValueAtTime(0, time)
  amp.gain.linearRampToValueAtTime(peak, time + 0.005)
  amp.gain.linearRampToValueAtTime(0.8 * peak, time + 0.035)
  amp.gain.setValueAtTime(0.8 * peak, hold)
  amp.gain.linearRampToValueAtTime(0, end)
  saw.connect(lp)
  sub.connect(subGain).connect(lp)
  body.connect(bodyGain).connect(lp)
  lp.connect(amp).connect(dest)
  // Finger / pick transient: short high-passed click, gone before the note body develops.
  const click = osc(ctx, "square", 1600, time, time + 0.006)
  click.connect(filter(ctx, "highpass", 1200, 0.7071))
    .connect(decayGain(ctx, 0.05 * velocity, time, 0.006))
    .connect(dest)
}

/**
 * Keys note (warm electric piano, closer to a Rhodes than a sine pad): sine at f + two triangles
 * detuned ±7 cents panned -0.35 / +0.35 + a fast-decaying sine at 2f (the tine) at 0.06, all through
 * a low-pass whose cutoff follows velocity (1500 Hz at vel 0 → 3300 Hz at vel 1, Q 0.6). Amp per
 * note: 0 → 0.16 * vel in 4 ms, decays to 55 % over 0.52 s, holds until time + max(duration,
 * 0.52 s), then releases to 0 over 0.35 s. Short notes therefore still complete the decay before the
 * hold/release (piano-like): the hold point is never earlier than 0.52 s after the note start.
 */
export function playKeys(ctx: BaseAudioContext, dest: AudioNode, midi: number, time: number, duration: number, velocity: number): void {
  const f = midiToHz(midi)
  const peak = 0.16 * velocity
  const hold = time + Math.max(duration, 0.52)
  const end = hold + 0.35
  const lp = filter(ctx, "lowpass", 1500 + 1800 * velocity, 0.6)
  const amp = ctx.createGain()
  amp.gain.setValueAtTime(0, time)
  amp.gain.linearRampToValueAtTime(peak, time + 0.004)
  amp.gain.linearRampToValueAtTime(0.55 * peak, time + 0.52)
  amp.gain.setValueAtTime(0.55 * peak, hold)
  amp.gain.linearRampToValueAtTime(0, end)
  lp.connect(amp).connect(dest)
  osc(ctx, "sine", f, time, end).connect(lp)
  for (const side of [-1, 1]) {
    const o = osc(ctx, "triangle", f, time, end)
    o.detune.setValueAtTime(7 * side, time)
    const pan = ctx.createStereoPanner()
    pan.pan.value = 0.35 * side
    o.connect(pan).connect(lp)
  }
  // Tine: a 2f partial that dies quickly enough to read as an attack, not as an organ stop.
  const tine = osc(ctx, "sine", 2 * f, time, time + 0.28)
  tine.connect(decayGain(ctx, 0.06 * velocity, time, 0.28)).connect(lp)
}

/**
 * Pluck (the arp voice): triangle at f + sawtooth at f detuned +5 cents, both → low-pass whose
 * cutoff falls 6200 → 900 Hz over 0.35 s, plus a 5 ms band-passed saw click for the plectrum.
 * Amp: 0 → 0.13 * vel in 3 ms, exponential decay to 0.001 over 0.55 s. Short and bright, so
 * 16th-note arps stay articulate at any tempo.
 */
export function playPluck(ctx: BaseAudioContext, dest: AudioNode, midi: number, time: number, duration: number, velocity: number): void {
  const f = midiToHz(midi)
  const peak = 0.13 * velocity
  const end = time + Math.min(0.55, Math.max(0.12, duration + 0.08))
  const lp = filter(ctx, "lowpass", 6200, 1.6)
  lp.frequency.setValueAtTime(6200, time)
  lp.frequency.exponentialRampToValueAtTime(900, time + 0.35)
  const amp = ctx.createGain()
  amp.gain.setValueAtTime(0, time)
  amp.gain.linearRampToValueAtTime(peak, time + 0.003)
  amp.gain.exponentialRampToValueAtTime(FLOOR, end)
  const tri = osc(ctx, "triangle", f, time, end)
  const saw = osc(ctx, "sawtooth", f, time, end)
  saw.detune.setValueAtTime(5, time)
  const sawGain = ctx.createGain()
  sawGain.gain.value = 0.45
  tri.connect(lp)
  saw.connect(sawGain).connect(lp)
  lp.connect(amp).connect(dest)
  const pick = osc(ctx, "sawtooth", 3200, time, time + 0.005)
  pick.connect(filter(ctx, "bandpass", 2800, 1.4))
    .connect(decayGain(ctx, 0.03 * velocity, time, 0.005))
    .connect(dest)
}

/** Metronome click: sine blip 2000 Hz (accent) or 1500 Hz, amp 0.4 → 0.001 over 30 ms. */
export function playClick(ctx: BaseAudioContext, dest: AudioNode, time: number, accent: boolean): void {
  const o = osc(ctx, "sine", accent ? 2000 : 1500, time, time + 0.03)
  o.connect(decayGain(ctx, 0.4, time, 0.03)).connect(dest)
}

/** Tail length (seconds) each instrument needs rendered past the loop end before folding. */
export const TAIL_SECONDS = { drums: 0.6, bass: 0.3, keys: 1.0, pluck: 0.6, click: 0.05 } as const
