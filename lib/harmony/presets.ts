// The demo harmony and the bass/keys preset parts, written RELATIVE to the chord lane so they follow
// any key, mode or chord change. Pure data.

import type { Chord, Harmony, HarmonicPart, PartNote } from "./types.ts"

const chord = (degree: Chord["degree"], extra: Partial<Chord> = {}): Chord => ({ degree, alter: 0, size: 4, inversion: 0, ...extra })

/** A aeolian, one chord per bar: i7 · VImaj7 · IIImaj7 · VII(add6) = Am7 · Fmaj7 · Cmaj7 · G6. */
export function demoHarmony(): Harmony {
  return {
    key: { tonic: { letter: "A", accidental: 0 }, mode: "aeolian" },
    beatsPerBar: 4,
    chords: [
      { start: 0, length: 4, chord: chord(1) },
      { start: 4, length: 4, chord: chord(6) },
      { start: 8, length: 4, chord: chord(3) },
      { start: 12, length: 4, chord: chord(7, { quality: "6" }) },
    ],
  }
}

const tone = (t: number, octave = 0) => ({ kind: "chord" as const, tone: t, octave })
/** A note on the 16th grid: start/length in 16ths, converted to beats. */
const n = (step: number, len: number, t: number, velocity: number, octave = 0): PartNote => ({
  start: step / 4,
  length: len / 4,
  velocity,
  pitch: tone(t, octave),
})
/** The same one-bar figure on every bar of a 4-bar part. */
const perBar = (bar: (at: (s: number) => number) => PartNote[]): PartNote[] =>
  [0, 1, 2, 3].flatMap((b) => bar((s) => b * 16 + s))

const BASS_RANGE = { low: 28, high: 52 }
const KEYS_RANGE = { low: 52, high: 76 }
const ARP_RANGE = { low: 60, high: 84 }

export const BASS_PARTS: HarmonicPart[] = [
  {
    id: "bass-pulse",
    name: "Pulse",
    role: "bass",
    range: BASS_RANGE,
    voicing: "close",
    lengthBeats: 16,
    notes: perBar((at) => [n(at(0), 3, 0, 1), n(at(7), 1, 0, 0.7), n(at(10), 3, 0, 0.9), n(at(14), 1.5, 0, 0.6, 1)]),
  },
  {
    id: "bass-walk",
    name: "Walk",
    role: "bass",
    range: BASS_RANGE,
    voicing: "close",
    lengthBeats: 16,
    notes: perBar((at) => [n(at(0), 2, 0, 1), n(at(4), 2, 2, 0.8), n(at(8), 2, 0, 0.85, 1), n(at(12), 2, 2, 0.75)]),
  },
  {
    id: "bass-sub",
    name: "Sub",
    role: "bass",
    range: BASS_RANGE,
    voicing: "close",
    lengthBeats: 16,
    notes: perBar((at) => [n(at(0), 14, 0, 0.9)]),
  },
]

/** A four-note chord (tones 0..3) at one step. */
const stab = (step: number, len: number, velocity: number): PartNote[] => [0, 1, 2, 3].map((t) => n(step, len, t, velocity))
const ARP_ORDER = [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0, 1, 2, 3]

export const KEYS_PARTS: HarmonicPart[] = [
  {
    id: "keys-stabs",
    name: "Stabs",
    role: "chords",
    range: KEYS_RANGE,
    voicing: "close",
    lengthBeats: 16,
    notes: perBar((at) => [...stab(at(0), 2, 0.8), ...stab(at(6), 1.5, 0.6), ...stab(at(10), 2, 0.7)]),
  },
  {
    id: "keys-pad",
    name: "Pad",
    role: "chords",
    range: KEYS_RANGE,
    voicing: "close",
    lengthBeats: 16,
    notes: perBar((at) => stab(at(0), 15.5, 0.6)),
  },
  {
    id: "keys-arp",
    name: "Arp",
    role: "arp",
    range: ARP_RANGE,
    voicing: "close",
    lengthBeats: 16,
    notes: perBar((at) => ARP_ORDER.map((t, s) => n(at(s), 0.9, t, s % 4 === 0 ? 0.65 : 0.5))),
  },
]

export function findPart(id: string): HarmonicPart | undefined {
  return [...BASS_PARTS, ...KEYS_PARTS].find((p) => p.id === id)
}
