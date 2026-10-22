// Harmony data model. The contract between the theory core, the engine and the UI.
// Pure data — no Web Audio, no DOM. Every part is stored RELATIVE to the harmony so changing a key,
// mode or chord re-harmonises the music instead of leaving it out of key.

export const MODES = ["ionian", "dorian", "phrygian", "lydian", "mixolydian", "aeolian", "locrian", "harmonic-minor", "melodic-minor"] as const
export type Mode = (typeof MODES)[number]

/** Note letters in order; spelling is derived from letters so chords are named the way musicians write them. */
export const LETTERS = ["C", "D", "E", "F", "G", "A", "B"] as const
export type Letter = (typeof LETTERS)[number]

/** A spelled pitch class: letter + accidental (-2..2 = 𝄫 ♭ ♮ ♯ 𝄪). */
export interface NoteName {
  letter: Letter
  accidental: -2 | -1 | 0 | 1 | 2
}

/** The session's tonal centre. */
export interface Key {
  tonic: NoteName
  mode: Mode
}

export type Degree = 1 | 2 | 3 | 4 | 5 | 6 | 7

export const CHORD_QUALITIES = [
  "maj", "min", "dim", "aug", "sus2", "sus4",
  "maj7", "dom7", "min7", "m7b5", "dim7", "minMaj7",
  "6", "m6", "add9", "maj9", "dom9", "min9",
] as const
export type ChordQuality = (typeof CHORD_QUALITIES)[number]

/**
 * A chord stored as a Roman numeral relative to the key: changing the key transposes it; changing
 * the mode re-derives its quality when `quality` is undefined (diatonic).
 */
export interface Chord {
  degree: Degree
  /** Chromatic root alteration: -1 flat (♭VII), +1 sharp (♯iv°). */
  alter: -1 | 0 | 1
  /** undefined → diatonic quality from the mode (triad or seventh per `size`). Set → explicit/borrowed. */
  quality?: ChordQuality
  /** Used only when `quality` is undefined. */
  size: 3 | 4
  /**
   * 0 = root position, 1 = first inversion, … — the bass is that chord tone. Realisation honours it: a "bass"
   * part's root notes (tone 0) play the inversion's bass tone, and a "chords" part puts that tone lowest.
   */
  inversion: 0 | 1 | 2 | 3
  /** Secondary function target: `{ of: 5 }` = "V7/V" style applied chord (display + analysis only). */
  applied?: { of: Degree }
}

/** One chord per slot on the chord lane, in beats from the loop start. */
export interface ChordSlot {
  start: number
  length: number
  chord: Chord
}

export interface Harmony {
  key: Key
  /** Beats per bar (4 in v2.0). */
  beatsPerBar: number
  /** The chord lane; repeats with the loop. Slots are contiguous from beat 0 and never overlap. */
  chords: ChordSlot[]
}

/**
 * A note's pitch relative to the music around it:
 *  - "chord": chord-tone index (0 root, 1 third, 2 fifth, 3 seventh, 4 ninth…) of the chord sounding at
 *    the note's start; octave is relative to the part's range (0 = lowest octave that fits).
 *  - "scale": scale degree 1..7 in the key (alter for chromatic neighbours), octave as above.
 *  - "abs": an absolute MIDI note (drums, chromatic colour).
 */
export type RelPitch =
  | { kind: "chord"; tone: number; octave: number }
  | { kind: "scale"; degree: Degree; octave: number; alter: -1 | 0 | 1 }
  | { kind: "abs"; midi: number }

export interface PartNote {
  /** Beats from the part start. */
  start: number
  /** Beats. */
  length: number
  /** 0..1 */
  velocity: number
  pitch: RelPitch
}

export type Voicing = "close" | "drop2" | "spread"

/** A harmony-relative part (bass line, comping, arpeggio, melody). Repeats every `lengthBeats`. */
export interface HarmonicPart {
  id: string
  name: string
  /** "chords": simultaneous chord-tone notes are voiced together with voice leading. */
  role: "bass" | "chords" | "arp" | "melody"
  /** MIDI range the realised notes must fall in (inclusive). */
  range: { low: number; high: number }
  voicing: Voicing
  lengthBeats: number
  notes: PartNote[]
}

/** A concrete note after realisation against the harmony. */
export interface RealizedNote {
  start: number
  length: number
  velocity: number
  midi: number
  /** What the note is against the harmony at its start — for colouring and analysis. */
  role: "chord-tone" | "scale-tone" | "chromatic"
}

export interface ChordSuggestion {
  chord: Chord
  roman: string
  name: string
  category: "diatonic" | "secondary-dominant" | "modal-interchange" | "tritone-sub" | "deceptive"
  /** One plain-English sentence; shown to beginners and theory people alike. */
  reason: string
  /** 0..1, higher first. */
  score: number
}

export type HarmonicFunction = "tonic" | "predominant" | "dominant" | "other"
