// Realisation: harmony-relative parts → concrete MIDI notes, with voice leading for chord parts.
// Pure — unit-tested under Node. The renderer, the piano-roll view and agents all use the same output.

import type { HarmonicPart, Harmony, PartNote, RelPitch, RealizedNote, Voicing, Chord, Key } from "./types.ts"
import { MODE_STEPS, QUALITY_SHAPES, chordAt, chordPitchClasses, chordQuality, pitchClass, scalePitchClasses } from "./theory.ts"

/**
 * One note's MIDI number:
 *  - "chord": rootMidi = lowest MIDI ≥ range.low with the chord root's pitch class; then
 *    midi = rootMidi + semitones[tone % n] + 12 * (floor(tone / n) + octave), n = chord-tone count
 *    (so tone 2, octave 0 is the fifth ABOVE the root; tone 0, octave 1 the root an octave up).
 *  - "scale": tonicMidi = lowest MIDI ≥ range.low with the key tonic's pitch class;
 *    midi = tonicMidi + MODE_STEPS[degree − 1] + alter + 12 * octave.
 *  - "abs": midi unchanged (no range folding).
 * Chord/scale results are folded into range by octaves: while midi > high subtract 12; while midi < low add 12
 * (if the range is narrower than an octave and nothing fits, return the value closest to the range).
 */
export function pitchToMidi(pitch: RelPitch, key: Key, chord: Chord, range: { low: number; high: number }): number {
  if (pitch.kind === "abs") return pitch.midi
  let midi: number
  if (pitch.kind === "chord") {
    const shape = QUALITY_SHAPES[chordQuality(key, chord)].semitones
    const n = shape.length
    const rootMidi = lowestWithPc(range.low, chordPitchClasses(key, chord)[0])
    midi = rootMidi + shape[mod(pitch.tone, n)] + 12 * (Math.floor(pitch.tone / n) + pitch.octave)
  } else {
    const tonicMidi = lowestWithPc(range.low, pitchClass(key.tonic))
    midi = tonicMidi + MODE_STEPS[key.mode][pitch.degree - 1] + pitch.alter + 12 * pitch.octave
  }
  return foldIntoRange(midi, range)
}

/**
 * Chooses MIDI notes for the pitch-class set `pcs` (one note per pc, all within range) given the previous
 * chord's notes:
 *  - candidates: every close-position voicing (each rotation of pcs stacked upward within an octave+) whose
 *    notes all fit in range, at every octave that fits; "drop2" = close voicing with the second-highest note
 *    dropped an octave (needs ≥ 4 notes, else close); "spread" = lowest pc of the chord's root position
 *    placed low, the rest an octave above it in close position.
 *  - prev null/empty → the candidate whose mean pitch is closest to the range centre.
 *  - otherwise → the candidate with the smallest total movement: sort both ascending and sum |a_i − b_i|
 *    (when sizes differ, compare each candidate note with its nearest previous note). Ties → lower mean.
 * Returns notes ascending. Returns [] for empty pcs. If no candidate fits, fall back to close position
 * folded into range note by note.
 */
export function voiceLead(prev: readonly number[] | null, pcs: readonly number[], range: { low: number; high: number }, voicing: Voicing): number[] {
  if (pcs.length === 0) return []
  const cands = candidateVoicings(pcs, range, voicing)
  if (cands.length === 0) {
    // Nothing fits: close position from the lowest root in range, each note folded into range.
    const stacked = stackUp(pcs, lowestWithPc(range.low, pcs[0]))
    return stacked.map((m) => foldIntoRange(m, range)).sort((a, b) => a - b)
  }
  const mean = (v: readonly number[]) => v.reduce((s, x) => s + x, 0) / v.length
  const centre = (range.low + range.high) / 2
  const prevSorted = prev && prev.length > 0 ? [...prev].sort((a, b) => a - b) : null
  const cost = (c: readonly number[]): number => {
    if (!prevSorted) return Math.abs(mean(c) - centre)
    if (c.length === prevSorted.length) return c.reduce((s, x, i) => s + Math.abs(x - prevSorted[i]), 0)
    return c.reduce((s, x) => s + Math.min(...prevSorted.map((p) => Math.abs(x - p))), 0)
  }
  let best = cands[0]
  let bestCost = cost(best)
  let bestMean = mean(best)
  for (let i = 1; i < cands.length; i++) {
    const c = cost(cands[i])
    const mn = mean(cands[i])
    if (c < bestCost || (c === bestCost && mn < bestMean)) {
      best = cands[i]
      bestCost = c
      bestMean = mn
    }
  }
  return [...best].sort((a, b) => a - b)
}

/**
 * Realises a part across `loopBeats`, repeating it every part.lengthBeats (copies start at
 * k * lengthBeats for k = 0, 1, … while < loopBeats; notes starting at ≥ loopBeats are dropped; lengths are
 * NOT clipped). Each note's chord = chordAt(harmony, absoluteStart).
 *  - role "chords": notes with the same absolute start form a group; the group's chord-tone notes get pitches
 *    from voiceLead(previous group's midis, their pitch classes, part.range, part.voicing), assigned in
 *    ascending order to the group's notes sorted by (tone index); non-chord notes in a group use pitchToMidi.
 *  - every other role: pitchToMidi per note.
 * `role` on the output: "chord-tone" if the pc is in the chord's pcs, else "scale-tone" if in the key's scale,
 * else "chromatic". Output sorted by start, then midi.
 */
export function realizePart(part: HarmonicPart, harmony: Harmony, loopBeats: number): RealizedNote[] {
  interface Placed { note: PartNote; start: number }
  const placed: Placed[] = []
  for (let k = 0; k * part.lengthBeats < loopBeats; k++) {
    for (const note of part.notes) {
      const start = k * part.lengthBeats + note.start
      if (start < loopBeats) placed.push({ note, start })
    }
  }
  placed.sort((a, b) => a.start - b.start)
  const key = harmony.key
  const scalePcs = new Set(scalePitchClasses(key))
  const out: RealizedNote[] = []
  const emit = (p: Placed, midi: number, chord: Chord) => {
    const pc = mod(midi, 12)
    const role = chordPitchClasses(key, chord).includes(pc) ? "chord-tone" : scalePcs.has(pc) ? "scale-tone" : "chromatic"
    out.push({ start: p.start, length: p.note.length, velocity: p.note.velocity, midi, role })
  }

  if (part.role !== "chords") {
    for (const p of placed) {
      const chord = chordAt(harmony, p.start).chord
      emit(p, pitchToMidi(p.note.pitch, key, chord, part.range), chord)
    }
  } else {
    let prevVoiced: number[] | null = null
    for (let i = 0; i < placed.length; ) {
      let j = i
      while (j < placed.length && Math.abs(placed[j].start - placed[i].start) < 1e-9) j++
      const group = placed.slice(i, j)
      i = j
      const chord = chordAt(harmony, group[0].start).chord
      const shape = QUALITY_SHAPES[chordQuality(key, chord)].semitones
      const chordPcs = chordPitchClasses(key, chord)
      const toned = group
        .filter((p) => p.note.pitch.kind === "chord")
        .sort((a, b) => (a.note.pitch as { tone: number }).tone - (b.note.pitch as { tone: number }).tone)
      if (toned.length > 0) {
        const pcs = toned.map((p) => chordPcs[mod((p.note.pitch as { tone: number }).tone, shape.length)])
        const voiced = voiceLead(prevVoiced, pcs, part.range, part.voicing)
        toned.forEach((p, idx) => emit(p, voiced[idx], chord))
        prevVoiced = voiced
      }
      for (const p of group) if (p.note.pitch.kind !== "chord") emit(p, pitchToMidi(p.note.pitch, key, chord, part.range), chord)
    }
  }
  return out.sort((a, b) => a.start - b.start || a.midi - b.midi)
}


// ---------------------------------------------------------------------------------------------
// Private helpers.
// ---------------------------------------------------------------------------------------------

function mod(a: number, b: number): number {
  return ((a % b) + b) % b
}

/** Lowest MIDI >= `low` whose pitch class is `pc`. */
function lowestWithPc(low: number, pc: number): number {
  return low + mod(pc - low, 12)
}

/** Octave-folds `midi` into [low, high]; a range narrower than an octave with no fit yields the closest value. */
function foldIntoRange(midi: number, range: { low: number; high: number }): number {
  let m = midi
  while (m > range.high) m -= 12
  while (m < range.low) m += 12
  if (m > range.high) {
    const below = m - 12
    return range.low - below <= m - range.high ? below : m
  }
  return m
}

/** Close position upward from `first` (the first note's MIDI): each next note is the lowest MIDI above the previous with that pc. */
function stackUp(pcs: readonly number[], first: number): number[] {
  const out = [first]
  for (let i = 1; i < pcs.length; i++) {
    const last = out[i - 1]
    out.push(last + 1 + mod(pcs[i] - last - 1, 12))
  }
  return out
}

const rotations = <T>(xs: readonly T[]): T[][] => xs.map((_, r) => [...xs.slice(r), ...xs.slice(0, r)])

/** Every voicing of `pcs` (see voiceLead) whose notes all lie in range, at every octave that fits. */
function candidateVoicings(pcs: readonly number[], range: { low: number; high: number }, voicing: Voicing): number[][] {
  const { low, high } = range
  const fits = (v: readonly number[]) => v.every((m) => m >= low && m <= high)
  const out: number[][] = []
  const n = pcs.length
  if (voicing === "spread" && n > 1) {
    // Root placed low, the remaining tones in close position starting at least an octave above it.
    for (const rot of rotations(pcs.slice(1))) {
      for (let m0 = lowestWithPc(low, pcs[0]); m0 <= high; m0 += 12) {
        const above = m0 + 12
        const v = [m0, ...stackUp(rot, above + mod(rot[0] - above, 12))]
        if (fits(v)) out.push(v)
      }
    }
    return out
  }
  for (const rot of rotations(pcs)) {
    for (let m0 = lowestWithPc(low, rot[0]); m0 <= high; m0 += 12) {
      let v = stackUp(rot, m0)
      if (voicing === "drop2" && n >= 4) {
        v = v.slice()
        v[n - 2] -= 12
        v.sort((a, b) => a - b)
      }
      if (fits(v)) out.push(v)
    }
  }
  return out
}
