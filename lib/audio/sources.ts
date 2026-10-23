// Track sources (v2 seam). A LoopSource turns whatever a track holds into one loop buffer.

import type { LoopSource, MelodicPattern, TrackState } from "./types.ts"
import type { Harmony } from "../harmony/types.ts"
import { findPart } from "../harmony/presets.ts"
import { realizePart } from "../harmony/realize.ts"
import { findSample } from "../samples/library.ts"
import { emptyDrumPattern } from "./patterns.ts"
import { renderDrums, renderMelodic } from "./render.ts"

/**
 * The offline synth for a "drums" | "bass" | "keys" track: renderDrums / renderMelodic. Drums use
 * drumPattern ?? emptyDrumPattern(). Bass/keys realise findPart(patternId) (falling back to "bass-pulse" /
 * "keys-stabs") against `harmony` over the loop, so a key or chord change re-harmonises the music.
 * Throws on an "audio" track.
 */
export function synthSource(track: TrackState, harmony: Harmony): LoopSource {
  const kind = track.kind
  if (kind === "audio") throw new Error("synthSource: an audio track has no synth")
  if (kind === "sample") return sampleSource(track.sampleId)
  return {
    kind: "synth",
    render: ({ sampleRate, loopFrames, bars }) => {
      if (kind === "drums") return renderDrums(sampleRate, loopFrames, bars, track.drumPattern ?? emptyDrumPattern())
      const part = findPart(track.patternId ?? "") ?? findPart(kind === "bass" ? "bass-pulse" : "keys-stabs")!
      const pattern: MelodicPattern = {
        id: part.id,
        name: part.name,
        bars,
        notes: realizePart(part, harmony, bars * 4).map((n) => ({
          step: n.start * 4,
          length: n.length * 4,
          midi: n.midi,
          velocity: n.velocity,
        })),
      }
      return renderMelodic(sampleRate, loopFrames, bars, kind, pattern)
    },
  }
}

/**
 * The offline renderer for a "sample" track: a ready-made loop from lib/samples/library.ts, rendered
 * from its ABSOLUTE note data by the same instrument synths (drums → renderDrums, pitched → the
 * sample's voice). Because the pitches are absolute and stated in the library, the loop keeps its key
 * and deliberately does not follow the project's key or chord changes. Unknown ids render nothing.
 */
export function sampleSource(sampleId: string | undefined): LoopSource {
  return {
    kind: "sample",
    render: async ({ sampleRate, loopFrames, bars }) => {
      const sample = findSample(sampleId)
      if (!sample) return null
      if (sample.voice === "drums") return renderDrums(sampleRate, loopFrames, bars, sample.drumPattern ?? emptyDrumPattern())
      const pattern: MelodicPattern = { id: sample.id, name: sample.name, bars: sample.bars, notes: sample.notes ?? [] }
      return renderMelodic(sampleRate, loopFrames, bars, sample.voice, pattern)
    },
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
