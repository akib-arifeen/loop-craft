// The sample shelf: ready-made loops with stated musical metadata.
//
// Provenance is the whole point of this file, so be precise about it:
//  - Every loop here is rendered by LoopCraft's own instrument synthesizers (lib/audio/synth.ts)
//    from the absolute note data below. There are no third-party recordings in this repo.
//  - A loop's `key` is a STATEMENT by the pack that authored it: those exact notes were written in
//    that key, and tests/samples.test.ts checks the notes really are inside it. Nothing is guessed.
//  - Drum loops state `key: null` + `atonal: true` because they have no pitch, not because their key
//    is unknown. Recorded material (mic / pads) is never given a key anywhere in the app.
//
// Compatibility is computed from the actual pitch classes of the rendered notes against the
// project's scale, so "in key" is an audible claim, not a tag.

import type { Mode, Key } from "../harmony/types.ts"
import { MODES } from "../harmony/types.ts"
import { formatNoteName, parseNoteName, pitchClass, scaleNotes, scalePitchClasses } from "../harmony/theory.ts"
import type { DrumPattern, NoteEvent, TrackFx } from "../audio/types.ts"
import { STEPS_PER_BAR } from "../audio/types.ts"

/** What the loop is, for the type filter. */
export const SAMPLE_TYPES = ["drums", "bass", "chords", "arp"] as const
export type SampleType = (typeof SAMPLE_TYPES)[number]

export const SAMPLE_TYPE_LABELS: Record<SampleType, string> = {
  drums: "Drums",
  bass: "Bass",
  chords: "Chords",
  arp: "Arp",
}

/** Which synth voice renders the loop. */
export type SampleVoice = "drums" | "bass" | "keys" | "pluck"

/** The key a pack authors its loop in. Stored as an ASCII tonic so it round-trips through JSON. */
export interface StatedKey {
  tonic: string
  mode: Mode
}

export interface SampleLoop {
  id: string
  name: string
  type: SampleType
  voice: SampleVoice
  /** Natural length of the loop. It repeats when shorter than the project loop and is cut when longer. */
  bars: 1 | 2 | 4
  /**
   * The stated key of a pitched loop, as written by the pack. `null` for atonal drum loops.
   * Never inferred from the audio: an unstated sample would also use null, and the UI says so.
   */
  key: StatedKey | null
  /** True only for loops with no pitch at all (drums). */
  atonal: boolean
  tags: string[]
  /** Absolute MIDI notes, positioned on the 16th grid from the loop start. Pitched loops only. */
  notes?: NoteEvent[]
  /** One bar of drums, repeated every bar of the project loop. Drum loops only. */
  drumPattern?: DrumPattern
  /** Mix defaults applied when the loop is added as a track. */
  fx: TrackFx
  volume: number
  pan: number
}

const fx = (filter: number, drive: number, delay: number, reverb: number): TrackFx => ({ filter, drive, delay, reverb })

/** One bar of drums from four lane strings of 16 cells: 0 off, 1 hit, 2 accent. */
function drums(kick: string, snare: string, clap: string, hat: string): DrumPattern {
  const lane = (s: string) => Array.from(s, Number)
  if ([kick, snare, clap, hat].some((s) => s.length !== STEPS_PER_BAR || !/^[0-2]+$/.test(s))) {
    throw new Error("drums(): every lane must be 16 digits 0-2")
  }
  return { kick: lane(kick), snare: lane(snare), clap: lane(clap), hat: lane(hat) }
}

const bar = (...hits: Array<[number, number, number, number]>): NoteEvent[] =>
  hits.map(([step, length, midi, velocity]) => ({ step, length, midi, velocity }))

/** A one-bar chord stab: every tone at the same step. */
const stab = (step: number, length: number, tones: number[], velocity: number): NoteEvent[] =>
  tones.map((midi) => ({ step, length, midi, velocity }))

// ── the catalog ─────────────────────────────────────────────────────────────

export const SAMPLE_CATALOG: SampleLoop[] = [
  // Drums. atonal by construction, so they never clash with a key.
  {
    id: "drums-boom-bap",
    name: "Boom Bap",
    type: "drums",
    voice: "drums",
    bars: 1,
    key: null,
    atonal: true,
    tags: ["hip hop", "dusty", "classic"],
    drumPattern: drums("2000000100100000", "0000100000001000", "0000000000001001", "1010101010101010"),
    fx: fx(0, 0.12, 0, 0.08),
    volume: 0.85,
    pan: 0,
  },
  {
    id: "drums-four-floor",
    name: "Four Floor",
    type: "drums",
    voice: "drums",
    bars: 1,
    key: null,
    atonal: true,
    tags: ["house", "steady", "club"],
    drumPattern: drums("1000100010001000", "0000000000000000", "0000100000001000", "0010001000100010"),
    fx: fx(0, 0.08, 0, 0.1),
    volume: 0.85,
    pan: 0,
  },
  {
    id: "drums-half-time",
    name: "Half Time",
    type: "drums",
    voice: "drums",
    bars: 1,
    key: null,
    atonal: true,
    tags: ["trap", "slow", "space"],
    drumPattern: drums("2000000000000010", "0000000010000000", "0000000000000000", "1010101010101010"),
    fx: fx(-0.1, 0.16, 0, 0.12),
    volume: 0.85,
    pan: 0,
  },
  {
    id: "drums-bossa",
    name: "Bossa Shuffle",
    type: "drums",
    voice: "drums",
    bars: 1,
    key: null,
    atonal: true,
    tags: ["latin", "swing", "soft"],
    drumPattern: drums("1000001000100000", "0001000000000100", "0001000000000100", "1010101010101010"),
    fx: fx(0, 0, 0, 0.18),
    volume: 0.8,
    pan: 0,
  },

  // Bass. stated keys written into the notes.
  {
    id: "bass-a-sub",
    name: "A Minor Sub",
    type: "bass",
    voice: "bass",
    bars: 1,
    key: { tonic: "A", mode: "aeolian" },
    atonal: false,
    tags: ["sub", "long", "hip hop"],
    notes: bar([0, 14, 33, 0.9], [14, 1, 33, 0.5]),
    fx: fx(-0.2, 0.2, 0, 0),
    volume: 0.82,
    pan: 0,
  },
  {
    id: "bass-c-roots",
    name: "C Major Roots",
    type: "bass",
    voice: "bass",
    bars: 2,
    key: { tonic: "C", mode: "ionian" },
    atonal: false,
    tags: ["roots", "pop", "simple"],
    notes: [...bar([0, 6, 36, 0.9], [8, 6, 36, 0.75]), ...bar([16, 6, 31, 0.9], [24, 6, 31, 0.75])],
    fx: fx(-0.1, 0.15, 0, 0),
    volume: 0.82,
    pan: 0,
  },
  {
    id: "bass-d-dorian-funk",
    name: "D Dorian Funk",
    type: "bass",
    voice: "bass",
    bars: 1,
    key: { tonic: "D", mode: "dorian" },
    atonal: false,
    tags: ["funk", "syncopated", "bright"],
    notes: bar([0, 2, 38, 0.95], [3, 2, 38, 0.6], [6, 2, 41, 0.8], [8, 2, 45, 0.85], [10, 2, 48, 0.7], [12, 2, 45, 0.8], [14, 2, 43, 0.65]),
    fx: fx(0, 0.2, 0, 0),
    volume: 0.82,
    pan: 0,
  },
  {
    id: "bass-f-aeolian-walk",
    name: "F Minor Walk",
    type: "bass",
    voice: "bass",
    bars: 2,
    key: { tonic: "F", mode: "aeolian" },
    atonal: false,
    tags: ["walk", "minor", "cinematic"],
    notes: [...bar([0, 4, 41, 0.9], [4, 4, 44, 0.7], [8, 4, 49, 0.8], [12, 4, 51, 0.75]), ...bar([16, 4, 41, 0.9], [20, 4, 44, 0.7], [24, 4, 49, 0.8], [28, 4, 46, 0.75])],
    fx: fx(-0.15, 0.1, 0.1, 0.1),
    volume: 0.82,
    pan: 0,
  },

  // Chords and pads. stated keys.
  {
    id: "keys-am7-rhodes",
    name: "Am7 Rhodes",
    type: "chords",
    voice: "keys",
    bars: 2,
    key: { tonic: "A", mode: "aeolian" },
    atonal: false,
    tags: ["rhodes", "warm", "soul"],
    notes: [...stab(0, 14, [57, 60, 64, 67], 0.75), ...stab(16, 14, [57, 60, 64, 67], 0.6)],
    fx: fx(-0.1, 0, 0.2, 0.3),
    volume: 0.72,
    pan: 0.15,
  },
  {
    id: "keys-cmaj9-glass",
    name: "Cmaj9 Glass",
    type: "chords",
    voice: "keys",
    bars: 2,
    key: { tonic: "C", mode: "ionian" },
    atonal: false,
    tags: ["bright", "pop", "clean"],
    notes: [...stab(0, 14, [60, 64, 67, 74], 0.65), ...stab(16, 14, [60, 64, 67, 74], 0.55)],
    fx: fx(0, 0, 0.25, 0.25),
    volume: 0.72,
    pan: -0.1,
  },
  {
    id: "keys-am-pad",
    name: "A Minor Pad",
    type: "chords",
    voice: "keys",
    bars: 2,
    key: { tonic: "A", mode: "aeolian" },
    atonal: false,
    tags: ["pad", "slow", "atmospheric"],
    notes: [...stab(0, 15, [57, 60, 64, 71], 0.5), ...stab(16, 15, [53, 57, 60, 64], 0.45)],
    fx: fx(-0.2, 0, 0.3, 0.42),
    volume: 0.68,
    pan: 0,
  },
  {
    id: "keys-dm9-stabs",
    name: "Dm9 Stabs",
    type: "chords",
    voice: "keys",
    bars: 2,
    key: { tonic: "D", mode: "dorian" },
    atonal: false,
    tags: ["stabs", "house", "punchy"],
    notes: [
      ...stab(0, 3, [62, 65, 69, 76], 0.8),
      ...stab(6, 2, [62, 65, 69, 76], 0.6),
      ...stab(10, 3, [62, 65, 69, 76], 0.7),
      ...stab(16, 3, [62, 65, 69, 76], 0.8),
      ...stab(22, 2, [62, 65, 69, 76], 0.6),
      ...stab(26, 3, [62, 65, 69, 76], 0.7),
    ],
    fx: fx(0, 0.05, 0.2, 0.2),
    volume: 0.7,
    pan: 0.1,
  },
  {
    id: "keys-bb-haze",
    name: "B♭ Lydian Haze",
    type: "chords",
    voice: "keys",
    bars: 2,
    key: { tonic: "Bb", mode: "lydian" },
    atonal: false,
    tags: ["dreamy", "bright", "floating"],
    notes: [...stab(0, 15, [58, 62, 65, 69], 0.55), ...stab(16, 15, [60, 64, 67, 70], 0.5)],
    fx: fx(-0.15, 0, 0.3, 0.4),
    volume: 0.68,
    pan: -0.15,
  },

  // Arps. plucked synth voice.
  {
    id: "arp-am-rain",
    name: "A Minor Rain",
    type: "arp",
    voice: "pluck",
    bars: 2,
    key: { tonic: "A", mode: "aeolian" },
    atonal: false,
    tags: ["arp", "pluck", "fast"],
    notes: [...bar([0, 1, 69, 0.7], [2, 1, 72, 0.55], [4, 1, 76, 0.65], [6, 1, 79, 0.6], [8, 1, 79, 0.55], [10, 1, 76, 0.6], [12, 1, 72, 0.55], [14, 1, 69, 0.7]), ...bar([16, 1, 65, 0.7], [18, 1, 69, 0.55], [20, 1, 72, 0.65], [22, 1, 76, 0.6], [24, 1, 76, 0.55], [26, 1, 72, 0.6], [28, 1, 69, 0.55], [30, 1, 65, 0.7])],
    fx: fx(0, 0, 0.25, 0.3),
    volume: 0.66,
    pan: 0.2,
  },
  {
    id: "arp-c-lydian-bells",
    name: "C Lydian Bells",
    type: "arp",
    voice: "pluck",
    bars: 2,
    key: { tonic: "C", mode: "lydian" },
    atonal: false,
    tags: ["arp", "bells", "bright"],
    notes: [...bar([0, 1, 72, 0.7], [2, 1, 74, 0.6], [4, 1, 76, 0.65], [6, 1, 78, 0.7], [8, 1, 79, 0.6], [10, 1, 81, 0.65], [12, 1, 83, 0.6], [14, 1, 84, 0.75]), ...bar([16, 1, 84, 0.7], [18, 1, 83, 0.6], [20, 1, 81, 0.65], [22, 1, 79, 0.6], [24, 1, 78, 0.7], [26, 1, 76, 0.65], [28, 1, 74, 0.6], [30, 1, 72, 0.7])],
    fx: fx(0.05, 0, 0.3, 0.32),
    volume: 0.64,
    pan: -0.2,
  },
  {
    id: "arp-e-phrygian-spark",
    name: "E Phrygian Spark",
    type: "arp",
    voice: "pluck",
    bars: 2,
    key: { tonic: "E", mode: "phrygian" },
    atonal: false,
    tags: ["arp", "dark", "hocket"],
    notes: [...bar([0, 1, 64, 0.7], [2, 1, 65, 0.55], [4, 1, 67, 0.65], [6, 1, 69, 0.6], [8, 1, 71, 0.65], [10, 1, 72, 0.55], [12, 1, 74, 0.6], [14, 1, 76, 0.7]), ...bar([16, 1, 76, 0.7], [18, 1, 74, 0.6], [20, 1, 72, 0.55], [22, 1, 71, 0.65], [24, 1, 69, 0.6], [26, 1, 67, 0.65], [28, 1, 65, 0.55], [30, 1, 64, 0.7])],
    fx: fx(0, 0.05, 0.2, 0.3),
    volume: 0.64,
    pan: 0.1,
  },
]

export function findSample(id: string | undefined): SampleLoop | undefined {
  return id === undefined ? undefined : SAMPLE_CATALOG.find((s) => s.id === id)
}

/** The pitch classes actually played by a loop. Empty for atonal loops. */
export function samplePitchClasses(sample: SampleLoop): number[] {
  const out = new Set<number>()
  for (const n of sample.notes ?? []) out.add(((n.midi % 12) + 12) % 12)
  return [...out].sort((a, b) => a - b)
}

/** Every key any sample states, for the key filter. */
export function statedKeys(): StatedKey[] {
  const seen = new Set<string>()
  const out: StatedKey[] = []
  for (const s of SAMPLE_CATALOG) {
    if (!s.key) continue
    const short = `${s.key.tonic}:${s.key.mode}`
    if (seen.has(short)) continue
    seen.add(short)
    out.push(s.key)
  }
  return out
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const

/** Friendly name of a pitch class (always with an accidental when there is one). */
export function pitchClassName(pc: number): string {
  const ascii = NOTE_NAMES[((pc % 12) + 12) % 12]
  const note = parseNoteName(ascii)
  return note ? formatNoteName(note) : ascii
}

/**
 * The loop's own pitch classes, spelled the way its stated key spells them. A B♭ loop says "B♭",
 * not "A♯", which is what a musician reading the loop's label expects.
 */
export function spelledSamplePitchClasses(sample: SampleLoop): string[] {
  const pcs = samplePitchClasses(sample)
  if (!sample.key) return pcs.map(pitchClassName)
  const tonic = parseNoteName(sample.key.tonic)
  if (!tonic) return pcs.map(pitchClassName)
  const spelled = new Map<number, string>()
  for (const note of scaleNotes({ tonic, mode: sample.key.mode })) spelled.set(pitchClass(note), formatNoteName(note))
  return pcs.map((pc) => spelled.get(pc) ?? pitchClassName(pc))
}

const MODE_NAMES: Partial<Record<Mode, string>> = {
  ionian: "major",
  aeolian: "minor",
  dorian: "dorian",
  phrygian: "phrygian",
  lydian: "lydian",
  mixolydian: "mixolydian",
  locrian: "locrian",
  "harmonic-minor": "harmonic minor",
  "melodic-minor": "melodic minor",
}

export function modeName(mode: Mode): string {
  return MODE_NAMES[mode] ?? mode
}

/** "A minor", "C major", "D dorian". for people who know theory and for people who don't. */
export function keyLabel(key: StatedKey | Key): string {
  const tonic = typeof key.tonic === "string" ? parseNoteName(key.tonic) : key.tonic
  return `${tonic ? formatNoteName(tonic) : "?"} ${modeName(key.mode)}`
}

export type SampleFit = "in-key" | "any" | "clash"

export interface SampleFitInfo {
  fit: SampleFit
  /** 0 = in key first, 1 = fits any key, 2 = clashes. The shelf sorts by this. */
  group: 0 | 1 | 2
  /** Short badge text. */
  label: string
  /** One plain sentence explaining the judgement, shown on the row and in the detail panel. */
  reason: string
  /** Pitch classes in the loop that are outside the project scale, spelled for display. */
  clashes: string[]
}

/**
 * Judges a loop against the project key from its ACTUAL pitch classes (never from its name):
 *  - no pitch (drums) → "any": there is no key to clash with.
 *  - every pitch class is in the project's scale → "in-key".
 *  - anything outside → "clash", listing exactly which notes are outside.
 * The project scale is the mode's scale on the key's tonic (harmony.theory.scalePitchClasses).
 */
export function sampleFit(sample: SampleLoop, projectKey: Key): SampleFitInfo {
  if (sample.atonal || sample.key === null || !sample.notes?.length) {
    return { fit: "any", group: 1, label: "Always fits", reason: "Drums have no key, so they can't clash with one.", clashes: [] }
  }
  const scale = new Set(scalePitchClasses(projectKey))
  const samplePcs = samplePitchClasses(sample)
  const outside = samplePcs.filter((pc) => !scale.has(pc))
  const spelled = spelledSamplePitchClasses(sample)
  const nameOf = (pc: number) => spelled[samplePcs.indexOf(pc)] ?? pitchClassName(pc)
  const project = keyLabel(projectKey)
  if (outside.length === 0) {
    return { fit: "in-key", group: 0, label: "In key", reason: `Every note is in ${project}.`, clashes: [] }
  }
  const names = outside.map(nameOf)
  const listed = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
  return {
    fit: "clash",
    group: 2,
    label: "Clashes",
    reason: `Contains ${listed}, which ${names.length === 1 ? "is" : "are"} not in ${project}.`,
    clashes: names,
  }
}

/** The shelf order: compatible first, clashes last, alphabetical inside a group. */
export function sortSamples(samples: readonly SampleLoop[], projectKey: Key): Array<{ sample: SampleLoop; fit: SampleFitInfo }> {
  return samples
    .map((sample) => ({ sample, fit: sampleFit(sample, projectKey) }))
    .sort((a, b) => a.fit.group - b.fit.group || a.sample.name.localeCompare(b.sample.name))
}

/** Free-text search over name and tags. Case-insensitive; an empty query matches everything. */
export function searchSamples(samples: readonly SampleLoop[], query: string): SampleLoop[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...samples]
  return samples.filter((s) => `${s.name} ${s.tags.join(" ")} ${s.type}`.toLowerCase().includes(q))
}

export const MODE_ORDER: readonly Mode[] = MODES
