// Offline mixdown for WAV export: builds the same mixer graph in an OfflineAudioContext,
// loops every track buffer, renders one extra pre-roll pass so the effects are at steady state,
// and keeps only the following `loops` passes.

import type { TrackState } from "./types.ts"
import { isAudible } from "./dsp.ts"
import { createImpulse, createMixer, MASTER_LOOKAHEAD_S } from "./mixer.ts"

export interface MixdownInput {
  sampleRate: number
  loopFrames: number
  bpm: number
  masterVolume: number
  /** Number of loop passes to render (>= 1). */
  loops: number
  tracks: ReadonlyArray<{ state: TrackState; buffer: AudioBuffer | null }>
}

/**
 * Renders a stereo AudioBuffer of exactly loops * loopFrames frames (no tail).
 * Each track with a buffer gets an AudioBufferSourceNode (loop = true, loopStart/loopEnd left at their
 * default 0 so the WHOLE buffer loops by exact sample count — never set loopEnd from a float duration)
 * started at 0 and stopped at (loops + 1) * loopFrames / sampleRate, through its own mixer channel
 * (createMixer with meters: false, params applied with immediate = true, audibility from dsp.isAudible).
 * The first pass is a pre-roll so delay, reverb and compressor reach steady state; the result is cut
 * from frame loopFrames + lookahead (the master compressor's look-ahead, MASTER_LOOKAHEAD_S, rendered
 * extra) and is exactly loops * loopFrames long. Frame 0 is loop position 0 and already carries the
 * tails of a previous pass, so the file loops seamlessly in other software.
 */
export async function renderMixdown(input: MixdownInput): Promise<AudioBuffer> {
  const { sampleRate, loopFrames, loops } = input
  if (loops < 1) throw new RangeError("loops must be >= 1")
  if (loopFrames < 1) throw new RangeError("loopFrames must be >= 1")
  // Chromium truncates the compressor look-ahead (not rounded): measured 264 frames
  // at 44.1 kHz, 288 at 48 kHz, 132 at 22.05 kHz, 576 at 96 kHz, i.e. floor(0.006 * sampleRate).
  const lookahead = Math.floor(MASTER_LOOKAHEAD_S * sampleRate)
  const length = loops * loopFrames
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: (loops + 1) * loopFrames + lookahead, sampleRate })
  const mixer = createMixer(ctx, { bpm: input.bpm, masterVolume: input.masterVolume, impulse: createImpulse(ctx), meters: false })
  const allStates = input.tracks.map((t) => t.state)
  const stopAt = ((loops + 1) * loopFrames) / sampleRate
  for (const { state, buffer } of input.tracks) {
    if (!buffer) continue
    const channel = mixer.createChannel()
    channel.update({ volume: state.volume, pan: state.pan, fx: state.fx, audible: isAudible(state, allStates) }, true)
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.loop = true
    src.connect(channel.input)
    src.start(0)
    src.stop(stopAt)
  }
  const rendered = await ctx.startRendering()
  const out = new AudioBuffer({ numberOfChannels: 2, length, sampleRate })
  for (let c = 0; c < 2; c++) out.copyToChannel(rendered.getChannelData(c).subarray(loopFrames + lookahead, loopFrames + lookahead + length), c)
  return out
}
