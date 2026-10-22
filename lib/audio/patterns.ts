// The built-in demo session: A minor, Am7 | Fmaj7 | Cmaj7 | G6, laid-back boom-bap at 92 BPM.
// Pure data + factories, no Web Audio.

import type { Bars, DrumPattern, MelodicPattern, NoteEvent, TrackFx, TrackState } from "./types.ts"
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

// One entry per bar: bass root, fifth, octave and the keys voicing (MIDI).
const BARS_HARMONY = [
  { root: 33, fifth: 40, octave: 45, chord: [57, 60, 64, 67] }, // Am7   A3 C4 E4 G4
  { root: 29, fifth: 36, octave: 41, chord: [57, 60, 64, 65] }, // Fmaj7 A3 C4 E4 F4
  { root: 36, fifth: 43, octave: 48, chord: [55, 59, 64, 67] }, // Cmaj7 G3 B3 E4 G4
  { root: 31, fifth: 38, octave: 43, chord: [55, 59, 62, 64] }, // G6    G3 B3 D4 E4
]

function perBar(make: (bar: (typeof BARS_HARMONY)[number], at: (step: number) => number) => NoteEvent[]): NoteEvent[] {
  return BARS_HARMONY.flatMap((bar, i) => make(bar, (step) => i * STEPS_PER_BAR + step))
}

export const BASS_PATTERNS: MelodicPattern[] = [
  {
    id: "bass-pulse",
    name: "Pulse",
    bars: 4,
    notes: perBar((b, at) => [
      { step: at(0), length: 3, midi: b.root, velocity: 1 },
      { step: at(7), length: 1, midi: b.root, velocity: 0.7 },
      { step: at(10), length: 3, midi: b.root, velocity: 0.9 },
      { step: at(14), length: 1.5, midi: b.octave, velocity: 0.6 },
    ]),
  },
  {
    id: "bass-walk",
    name: "Walk",
    bars: 4,
    notes: perBar((b, at) => [
      { step: at(0), length: 2, midi: b.root, velocity: 1 },
      { step: at(4), length: 2, midi: b.fifth, velocity: 0.8 },
      { step: at(8), length: 2, midi: b.octave, velocity: 0.85 },
      { step: at(12), length: 2, midi: b.fifth, velocity: 0.75 },
    ]),
  },
  {
    id: "bass-sub",
    name: "Sub",
    bars: 4,
    notes: perBar((b, at) => [{ step: at(0), length: 14, midi: b.root, velocity: 0.9 }]),
  },
]

const ARP_ORDER = [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0, 1, 2, 3]

export const KEYS_PATTERNS: MelodicPattern[] = [
  {
    id: "keys-stabs",
    name: "Stabs",
    bars: 4,
    notes: perBar((b, at) => [
      ...b.chord.map((midi) => ({ step: at(0), length: 2, midi, velocity: 0.8 })),
      ...b.chord.map((midi) => ({ step: at(6), length: 1.5, midi, velocity: 0.6 })),
      ...b.chord.map((midi) => ({ step: at(10), length: 2, midi, velocity: 0.7 })),
    ]),
  },
  {
    id: "keys-pad",
    name: "Pad",
    bars: 4,
    notes: perBar((b, at) => b.chord.map((midi) => ({ step: at(0), length: 15.5, midi, velocity: 0.6 }))),
  },
  {
    id: "keys-arp",
    name: "Arp",
    bars: 4,
    notes: perBar((b, at) =>
      ARP_ORDER.map((tone, s) => ({ step: at(s), length: 0.9, midi: b.chord[tone] + 12, velocity: s % 4 === 0 ? 0.65 : 0.5 })),
    ),
  },
]

export function findPattern(id: string): MelodicPattern | undefined {
  return [...BASS_PATTERNS, ...KEYS_PATTERNS].find((p) => p.id === id)
}

/** Pads instrument: 0..3 drum voices, 4..7 Am7 stabs (always consonant over the progression). */
export const PADS = [
  { label: "Kick", key: "a", drum: "kick" },
  { label: "Snare", key: "s", drum: "snare" },
  { label: "Clap", key: "d", drum: "clap" },
  { label: "Hat", key: "f", drum: "hat" },
  { label: "A", key: "h", midi: 69 },
  { label: "C", key: "j", midi: 72 },
  { label: "E", key: "k", midi: 76 },
  { label: "G", key: "l", midi: 79 },
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
