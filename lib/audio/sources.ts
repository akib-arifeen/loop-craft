// Track sources (v2 seam). A LoopSource turns whatever a track holds into one loop buffer.

import type { LoopSource, TrackState } from "./types.ts"
import { emptyDrumPattern, findPattern } from "./patterns.ts"
import { renderDrums, renderMelodic } from "./render.ts"

/**
 * The offline synth for a "drums" | "bass" | "keys" track: renderDrums / renderMelodic with the
 * track's pattern (drums: drumPattern ?? emptyDrumPattern(); bass/keys: findPattern(patternId),
 * falling back to "bass-pulse" / "keys-stabs"). Throws on an "audio" track.
 */
export function synthSource(track: TrackState): LoopSource {
  const kind = track.kind
  if (kind === "audio") throw new Error("synthSource: an audio track has no synth")
  return {
    kind: "synth",
    render: ({ sampleRate, loopFrames, bars }) =>
      kind === "drums"
        ? renderDrums(sampleRate, loopFrames, bars, track.drumPattern ?? emptyDrumPattern())
        : renderMelodic(
            sampleRate,
            loopFrames,
            bars,
            kind,
            findPattern(track.patternId ?? "") ?? findPattern(kind === "bass" ? "bass-pulse" : "keys-stabs")!,
          ),
  }
}

/**
 * Recorded or sampled audio already in memory. render() returns the buffer when its length equals
 * spec.loopFrames and its sampleRate equals spec.sampleRate, otherwise null (it no longer fits the loop).
 */
export function bufferSource(buffer: AudioBuffer | null, kind: "recording" | "sample"): LoopSource {
  return {
    kind,
    render: async (spec) => (buffer && buffer.length === spec.loopFrames && buffer.sampleRate === spec.sampleRate ? buffer : null),
  }
}
