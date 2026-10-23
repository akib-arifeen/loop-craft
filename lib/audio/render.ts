// Offline loop rendering: pattern → one loop-length AudioBuffer via OfflineAudioContext.
// Notes are scheduled at grid positions derived from the integer loop length (timing.stepFrame),
// rendered with a tail, and the tail is folded back onto the loop start (dsp.foldTail) so the
// buffer loops seamlessly.

import { foldTail } from "./dsp.ts"
import { createNoiseBuffer, playBass, playClick, playDrum, playKeys, playPluck, TAIL_SECONDS } from "./synth.ts"
import { secondsToFrames, stepFrame } from "./timing.ts"
import { DRUM_VOICES } from "./types.ts"
import type { DrumPattern, MelodicPattern } from "./types.ts"

/** Renders `schedule` into an offline context (loop + tail), then folds the tail onto the loop start. */
async function renderLoop(
  sampleRate: number,
  loopFrames: number,
  channels: number,
  tailSeconds: number,
  outGain: number,
  schedule: (ctx: OfflineAudioContext, dest: AudioNode) => void,
): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext({
    numberOfChannels: channels,
    length: loopFrames + secondsToFrames(tailSeconds, sampleRate),
    sampleRate,
  })
  const master = ctx.createGain()
  master.gain.value = outGain
  master.connect(ctx.destination)
  schedule(ctx, master)
  const rendered = await ctx.startRendering()
  const out = new AudioBuffer({ length: loopFrames, numberOfChannels: channels, sampleRate })
  for (let c = 0; c < channels; c++) {
    out.copyToChannel(new Float32Array(foldTail(rendered.getChannelData(c), loopFrames)), c)
  }
  return out
}

/**
 * Renders `bars` bars of the drum pattern (the one-bar pattern repeats each bar) into a mono
 * AudioBuffer of exactly loopFrames frames at sampleRate. Cell value 1 → velocity 0.7, 2 → 1.0.
 * Step s of bar b sits at stepFrame(b * 16 + s, loopFrames, bars * 16) / sampleRate seconds.
 */
export async function renderDrums(sampleRate: number, loopFrames: number, bars: number, pattern: DrumPattern): Promise<AudioBuffer> {
  const totalSteps = bars * 16
  return renderLoop(sampleRate, loopFrames, 1, TAIL_SECONDS.drums, 0.9, (ctx, dest) => {
    const noise = createNoiseBuffer(ctx, 1)
    for (let b = 0; b < bars; b++) {
      for (let s = 0; s < 16; s++) {
        const time = stepFrame(b * 16 + s, loopFrames, totalSteps) / sampleRate
        for (const voice of DRUM_VOICES) {
          const v = pattern[voice][s]
          if (v > 0) playDrum(ctx, dest, voice, time, v === 2 ? 1.0 : 0.7, noise)
        }
      }
    }
  })
}

/**
 * Renders a bass (mono buffer), keys or pluck (stereo buffers) pattern into exactly loopFrames frames.
 * The pattern repeats every pattern.bars bars when shorter than the loop and is cut when longer
 * (notes whose step >= bars * 16 are dropped). Note start = stepFrame(step, loopFrames, bars*16)/sr;
 * duration = length * (loopFrames / (bars * 16)) / sr.
 */
export async function renderMelodic(
  sampleRate: number,
  loopFrames: number,
  bars: number,
  instrument: "bass" | "keys" | "pluck",
  pattern: MelodicPattern,
): Promise<AudioBuffer> {
  if (pattern.bars < 1) throw new RangeError("pattern.bars must be >= 1")
  const patternSteps = pattern.bars * 16
  const loopSteps = bars * 16
  const secPerStep = loopFrames / loopSteps / sampleRate
  const channels = instrument === "bass" ? 1 : 2
  return renderLoop(sampleRate, loopFrames, channels, TAIL_SECONDS[instrument], 0.9, (ctx, dest) => {
    for (let rep = 0; rep * patternSteps < loopSteps; rep++) {
      for (const note of pattern.notes) {
        const step = rep * patternSteps + note.step
        if (step >= loopSteps) continue
        const start = stepFrame(step, loopFrames, loopSteps) / sampleRate
        const duration = note.length * secPerStep
        if (instrument === "bass") playBass(ctx, dest, note.midi, start, duration, note.velocity)
        else if (instrument === "keys") playKeys(ctx, dest, note.midi, start, duration, note.velocity)
        else playPluck(ctx, dest, note.midi, start, duration, note.velocity)
      }
    }
  })
}

/** Metronome loop: a click on every beat (accent on beat 1 of each bar), mono, loopFrames long. */
export async function renderClickTrack(sampleRate: number, loopFrames: number, bars: number): Promise<AudioBuffer> {
  return renderLoop(sampleRate, loopFrames, 1, TAIL_SECONDS.click, 1.0, (ctx, dest) => {
    for (let i = 0; i < bars * 4; i++) {
      playClick(ctx, dest, stepFrame(i * 4, loopFrames, bars * 16) / sampleRate, i % 4 === 0)
    }
  })
}
