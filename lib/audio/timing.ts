// Transport timing math. Pure functions, no Web Audio — unit-tested under Node.
//
// The timing model: the loop length is an INTEGER number of sample frames, derived once from
// bpm/bars/sampleRate. Every grid position, loop boundary and capture window is computed from
// that integer, so tracks can never drift against each other: they all loop on the same frame
// count, and the audio thread (a looping AudioBufferSourceNode) does the counting.

/**
 * Loop length in frames: the integer nearest to bars * beatsPerBar * 60 / bpm * sampleRate whose
 * duration round-trips exactly through a double, i.e. (L / sampleRate) * sampleRate === L.
 * Math.round's value is used when it round-trips. Always >= 1.
 *
 * Why: Chromium's looping AudioBufferSourceNode plays ONE pass and then goes silent when the buffer's
 * duration rounds up past its length ((L / sr) * sr > L) — measured 2026-10-22: at 92 BPM, 4 bars,
 * 48 kHz the plain rounded length 500870 stops after 10.4 s; 500869 loops forever. The chosen L is at
 * most 3 frames from Math.round (checked: integer 60–180 BPM × 1/2/4 bars × 8–96 kHz; ≤ 45 ppm tempo
 * error; the rounded value is kept in 93 % of cases).
 */
export function loopFrameCount(bpm: number, bars: number, sampleRate: number, beatsPerBar = 4): number {
  const exact = ((bars * beatsPerBar * 60) / bpm) * sampleRate
  const base = Math.max(1, Math.round(exact))
  const roundTrips = (n: number) => n >= 1 && (n / sampleRate) * sampleRate === n
  for (let d = 0; d <= 64; d++) {
    const [near, far] = exact > base ? [base + d, base - d] : [base - d, base + d]
    if (roundTrips(near)) return near
    if (roundTrips(far)) return far
  }
  return base
}

/**
 * Frame offset of grid step `step` inside a loop of `loopFrames` frames divided into
 * `totalSteps` equal steps: Math.round(step * loopFrames / totalSteps). step === totalSteps
 * returns loopFrames exactly, so the grid always tiles the loop with no remainder.
 */
export function stepFrame(step: number, loopFrames: number, totalSteps: number): number {
  return Math.round((step * loopFrames) / totalSteps)
}

/**
 * Position inside the loop, in frames, of absolute context frame `frame` for a transport that
 * started (loop position 0) at `startFrame`. Always in [0, loopFrames), including for frames
 * before startFrame (true modulo, never negative).
 */
export function loopOffset(frame: number, startFrame: number, loopFrames: number): number {
  return (((frame - startFrame) % loopFrames) + loopFrames) % loopFrames
}

/** loopOffset(...) / loopFrames, in [0, 1). */
export function loopPhase(frame: number, startFrame: number, loopFrames: number): number {
  return loopOffset(frame, startFrame, loopFrames) / loopFrames
}

/**
 * The first loop boundary (startFrame + k * loopFrames, k an integer, may be negative)
 * that is >= frame + minLeadFrames.
 */
export function nextBoundary(frame: number, startFrame: number, loopFrames: number, minLeadFrames: number): number {
  const k = Math.ceil((frame + minLeadFrames - startFrame) / loopFrames)
  return startFrame + k * loopFrames
}

/**
 * Frames the recorder must keep for one loop pass that is HEARD starting at `boundaryFrame`.
 * Input arrives `latencyFrames` late (output + input latency), so the window is shifted later
 * by that amount: { from: boundaryFrame + latencyFrames, to: from + loopFrames } (to exclusive).
 * latencyFrames may be negative (user nudge); the window is still exactly loopFrames long.
 */
export function captureWindow(boundaryFrame: number, loopFrames: number, latencyFrames: number): { from: number; to: number } {
  const from = boundaryFrame + latencyFrames
  return { from, to: from + loopFrames }
}

/** Math.round(seconds * sampleRate) */
export function secondsToFrames(seconds: number, sampleRate: number): number {
  return Math.round(seconds * sampleRate)
}

/** Delay time for the tempo-synced delay bus: a dotted eighth = 0.75 beat = 45 / bpm seconds. */
export function dottedEighthSeconds(bpm: number): number {
  return 45 / bpm
}

/** Actual duration of `loops` passes at integer loop length `loopFrames`. */
export function loopDurationSeconds(loopFrames: number, sampleRate: number, loops = 1): number {
  if (sampleRate <= 0 || loopFrames <= 0 || loops <= 0) return 0
  return (loopFrames * loops) / sampleRate
}

/**
 * Duration for names and labels: floored to a tenth of a second, so it never promises a file longer
 * than the rendered audio. 20.8695 s -> "20.8s"; 2.6667 s -> "2.6s"; 7.5 s -> "7.5s".
 */
export function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s"
  const tenths = Math.floor(seconds * 10)
  return tenths % 10 === 0 ? `${tenths / 10}s` : `${(tenths / 10).toFixed(1)}s`
}

/** WAV download name derived from the actual loop frame count, never from a pending bpm/bars edit. */
export function exportFileName(input: { bpm: number; bars: number; loops: number; loopFrames: number; sampleRate: number }): string {
  const duration = formatSeconds(loopDurationSeconds(input.loopFrames, input.sampleRate, input.loops))
  const bars = `${input.bars}${input.bars === 1 ? "bar" : "bars"}`
  const loops = `${input.loops}loop${input.loops === 1 ? "" : "s"}`
  return `loopcraft-${input.bpm}bpm-${bars}-${loops}-${duration}.wav`
}
