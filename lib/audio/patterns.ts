// The built-in demo session: A minor, Am7 | Fmaj7 | Cmaj7 | G6, laid-back boom-bap at 92 BPM.
// Pure data + factories, no Web Audio. Bass/keys parts live in lib/harmony/presets.ts (harmony-relative).

import type { Bars, DrumPattern, TrackFx, TrackState } from "./types.ts"
import { STEPS_PER_BAR } from "./types.ts"

export const DEMO_BPM = 92
export const DEMO_BARS: Bars = 4

export const DEMO_DRUMS: DrumPattern = {
  kick: [2, 0, 0, 0, 0, 0, 0, 1, 0, 0, 2, 0, 0, 0, 0, 0],
  snare: [0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0],
  clap: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1],
  hat: [1, 0, 2, 0, 1, 0, 2, 1, 1, 0, 2, 0, 1, 0, 2, 0],
}

export function emptyDrumPattern(): DrumPattern {
  const lane = () => new Array<number>(STEPS_PER_BAR).fill(0)
  return { kick: lane(), snare: lane(), clap: lane(), hat: lane() }
}

export function cloneDrumPattern(p: DrumPattern): DrumPattern {
  return { kick: [...p.kick], snare: [...p.snare], clap: [...p.clap], hat: [...p.hat] }
}

/** Pads instrument: 0..3 drum voices, 4..7 chord tones 0..3 of the chord sounding now (always consonant). */
export const PADS = [
  { label: "Kick", key: "a", drum: "kick" },
  { label: "Snare", key: "s", drum: "snare" },
  { label: "Clap", key: "d", drum: "clap" },
  { label: "Hat", key: "f", drum: "hat" },
  { label: "Root", key: "h", tone: 0 },
  { label: "3rd", key: "j", tone: 1 },
  { label: "5th", key: "k", tone: 2 },
  { label: "7th", key: "l", tone: 3 },
] as const

const fx = (filter: number, drive: number, delay: number, reverb: number): TrackFx => ({ filter, drive, delay, reverb })

function track(id: string, name: string, kind: TrackState["kind"], volume: number, pan: number, trackFx: TrackFx): TrackState {
  return { id, name, kind, volume, pan, muted: false, soloed: false, fx: trackFx, hasAudio: false, peaks: [] }
}

/** A fresh empty recordable track. */
export function audioTrack(id: string, name: string): TrackState {
  return track(id, name, "audio", 0.85, 0, fx(0, 0, 0.1, 0.15))
}

/** The demo session the visitor hears on first tap. Buffers are rendered by the engine. */
export function demoTracks(): TrackState[] {
  return [
    { ...track("drums", "Drums", "drums", 0.85, 0, fx(0, 0.1, 0, 0.08)), drumPattern: cloneDrumPattern(DEMO_DRUMS) },
    { ...track("bass", "Bass", "bass", 0.8, 0, fx(-0.15, 0.25, 0, 0)), patternId: "bass-pulse" },
    { ...track("keys", "Keys", "keys", 0.7, 0.15, fx(-0.1, 0, 0.25, 0.3)), patternId: "keys-stabs" },
    audioTrack("loop-a", "Loop A"),
    audioTrack("loop-b", "Loop B"),
  ]
}
