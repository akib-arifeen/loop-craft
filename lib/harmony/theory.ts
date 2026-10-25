// Music-theory core. Pure functions over the harmony types — unit-tested under Node.

import type { Chord, ChordQuality, Degree, Harmony, HarmonicFunction, Key, Letter, Mode, NoteName, ChordSlot } from "./types.ts"
import { LETTERS } from "./types.ts"

/** Semitones from the tonic for scale degrees 1..7. */
export const MODE_STEPS: Record<Mode, readonly number[]> = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  "harmonic-minor": [0, 2, 3, 5, 7, 8, 11],
  "melodic-minor": [0, 2, 3, 5, 7, 9, 11],
}

/**
 * Chord tones in order (root, third, fifth, seventh/sixth, ninth) as semitones above the root, and the
 * LETTER offset of each tone above the root letter (so tones are spelled correctly: a minor third above
 * A is C, never B♯).
 */
export const QUALITY_SHAPES: Record<ChordQuality, { semitones: readonly number[]; letters: readonly number[] }> = {
  maj: { semitones: [0, 4, 7], letters: [0, 2, 4] },
  min: { semitones: [0, 3, 7], letters: [0, 2, 4] },
  dim: { semitones: [0, 3, 6], letters: [0, 2, 4] },
  aug: { semitones: [0, 4, 8], letters: [0, 2, 4] },
  sus2: { semitones: [0, 2, 7], letters: [0, 1, 4] },
  sus4: { semitones: [0, 5, 7], letters: [0, 3, 4] },
  maj7: { semitones: [0, 4, 7, 11], letters: [0, 2, 4, 6] },
  dom7: { semitones: [0, 4, 7, 10], letters: [0, 2, 4, 6] },
  min7: { semitones: [0, 3, 7, 10], letters: [0, 2, 4, 6] },
  m7b5: { semitones: [0, 3, 6, 10], letters: [0, 2, 4, 6] },
  dim7: { semitones: [0, 3, 6, 9], letters: [0, 2, 4, 6] },
  minMaj7: { semitones: [0, 3, 7, 11], letters: [0, 2, 4, 6] },
  "6": { semitones: [0, 4, 7, 9], letters: [0, 2, 4, 5] },
  m6: { semitones: [0, 3, 7, 9], letters: [0, 2, 4, 5] },
  add9: { semitones: [0, 4, 7, 14], letters: [0, 2, 4, 1] },
  maj9: { semitones: [0, 4, 7, 11, 14], letters: [0, 2, 4, 6, 1] },
  dom9: { semitones: [0, 4, 7, 10, 14], letters: [0, 2, 4, 6, 1] },
  min9: { semitones: [0, 3, 7, 10, 14], letters: [0, 2, 4, 6, 1] },
}

/** Pitch class 0..11 of a spelled note (C = 0). */
export function pitchClass(n: NoteName): number {
  return mod(LETTER_PC[LETTERS.indexOf(n.letter)] + n.accidental, 12)
}

/**
 * Parses "A", "Bb", "B♭", "F#", "F♯", "Ebb", "C##" (letter case-insensitive) into a NoteName; null when
 * invalid.
 */
export function parseNoteName(s: string): NoteName | null {
  const m = /^([a-gA-G])(.*)$/u.exec(s.trim())
  if (!m) return null
  let acc = 0
  let flats = false
  let sharps = false
  for (const ch of m[2]) {
    if (ch === "b" || ch === "\u266D") { acc -= 1; flats = true }
    else if (ch === "#" || ch === "\u266F") { acc += 1; sharps = true }
    else if (ch === "\u{1D12B}") { acc -= 2; flats = true }
    else if (ch === "\u{1D12A}") { acc += 2; sharps = true }
    else return null
  }
  if ((flats && sharps) || acc < -2 || acc > 2) return null
  return { letter: m[1].toUpperCase() as Letter, accidental: acc as NoteName["accidental"] }
}

/** "A", "B♭", "F♯", "E𝄫", "C𝄪"; with ascii: "A", "Bb", "F#", "Ebb", "C##". */
export function formatNoteName(n: NoteName, ascii = false): string {
  const a = n.accidental
  let sym = ""
  if (ascii) sym = a < 0 ? "b".repeat(-a) : "#".repeat(a)
  else sym = a === -2 ? "\u{1D12B}" : a === -1 ? "\u266D" : a === 1 ? "\u266F" : a === 2 ? "\u{1D12A}" : ""
  return n.letter + sym
}

/**
 * The spelled note of scale degree `degree` (+ chromatic `alter`) in `key`. Letters are consecutive
 * from the tonic letter (degree d → tonic letter + d − 1), and the accidental is whatever makes the
 * pitch class right: degreeNote(A aeolian, 6) = F, degreeNote(C ionian, 7, -1) = B♭,
 * degreeNote(F♯ ionian, 3) = A♯. Accidentals beyond ±2 throw RangeError.
 */
export function degreeNote(key: Key, degree: Degree, alter?: -1 | 0 | 1): NoteName {
  const steps = MODE_STEPS[key.mode]
  return spell(LETTERS.indexOf(key.tonic.letter) + degree - 1, pitchClass(key.tonic) + steps[degree - 1] + (alter ?? 0))
}

/** The 7 spelled scale notes of the key, degree 1 first. */
export function scaleNotes(key: Key): NoteName[] {
  return ([1, 2, 3, 4, 5, 6, 7] as Degree[]).map((d) => degreeNote(key, d))
}

/** Pitch classes of the 7 scale degrees, degree 1 first. */
export function scalePitchClasses(key: Key): number[] {
  const t = pitchClass(key.tonic)
  return MODE_STEPS[key.mode].map((s) => mod(t + s, 12))
}

/**
 * Quality of the chord built by stacking scale thirds on `degree` in the key's mode.
 * Triads: (third, fifth) semitones above the root → 4,7 maj · 3,7 min · 3,6 dim · 4,8 aug.
 * Sevenths add the seventh: maj+11 maj7 · maj+10 dom7 · min+10 min7 · dim+10 m7b5 · dim+9 dim7 ·
 * min+11 minMaj7 · aug+11 → "aug" (no augmented-major-seventh quality; the triad is returned).
 */
export function diatonicQuality(key: Key, degree: Degree, size: 3 | 4): ChordQuality {
  const s = MODE_STEPS[key.mode]
  const d = degree - 1
  const root = s[d]
  const third = mod(s[(d + 2) % 7] - root, 12)
  const fifth = mod(s[(d + 4) % 7] - root, 12)
  const seventh = mod(s[(d + 6) % 7] - root, 12)
  let triad: ChordQuality
  if (third === 4 && fifth === 7) triad = "maj"
  else if (third === 3 && fifth === 7) triad = "min"
  else if (third === 3 && fifth === 6) triad = "dim"
  else if (third === 4 && fifth === 8) triad = "aug"
  else triad = third === 4 ? "maj" : "min"
  if (size === 3) return triad
  if (triad === "maj") return seventh === 11 ? "maj7" : seventh === 10 ? "dom7" : triad
  if (triad === "min") return seventh === 10 ? "min7" : seventh === 11 ? "minMaj7" : triad
  if (triad === "dim") return seventh === 10 ? "m7b5" : seventh === 9 ? "dim7" : triad
  return triad
}

/** chord.quality when set, else diatonicQuality(key, chord.degree, chord.size). */
export function chordQuality(key: Key, chord: Chord): ChordQuality {
  return chord.quality ?? diatonicQuality(key, chord.degree, chord.size)
}

/** Spelled chord tones in chord-tone order (root first), using QUALITY_SHAPES letters + semitones. */
export function chordNotes(key: Key, chord: Chord): NoteName[] {
  const root = degreeNote(key, chord.degree, chord.alter)
  const shape = QUALITY_SHAPES[chordQuality(key, chord)]
  const ri = LETTERS.indexOf(root.letter)
  const rp = pitchClass(root)
  return shape.semitones.map((st, i) => spell(ri + shape.letters[i], rp + st))
}

/** Pitch classes of chordNotes, same order. */
export function chordPitchClasses(key: Key, chord: Chord): number[] {
  return chordNotes(key, chord).map(pitchClass)
}

/**
 * Lead-sheet symbol. Root spelled per chordNotes; suffix by quality:
 * maj "" · min "m" · dim "°" · aug "+" · sus2 "sus2" · sus4 "sus4" · maj7 "maj7" · dom7 "7" · min7 "m7" ·
 * m7b5 "m7♭5" · dim7 "°7" · minMaj7 "m(maj7)" · 6 "6" · m6 "m6" · add9 "add9" · maj9 "maj9" · dom9 "9" · min9 "m9".
 * Inversion > 0 appends "/<bass note>" (the chord tone at that index). ascii: ♭→b, ♯→#, °→dim, "m7♭5"→"m7b5".
 * Examples in A aeolian: i7 → "Am7"; VI (size 4) → "Fmaj7"; VII with quality "6" → "G6"; V7 (quality dom7) → "E7".
 */
export function chordSymbol(key: Key, chord: Chord, ascii = false): string {
  const notes = chordNotes(key, chord)
  let out = formatNoteName(notes[0], ascii) + SYMBOL_SUFFIX[chordQuality(key, chord)]
  if (chord.inversion > 0 && chord.inversion < notes.length) out += "/" + formatNoteName(notes[chord.inversion], ascii)
  if (ascii) out = out.replace(/\u00B0/g, "dim").replace(/\u266D/g, "b").replace(/\u266F/g, "#")
  return out
}

/**
 * Roman numeral in classical-analysis style:
 * - numeral I..VII by degree; prefix ♭/♯ for alter (ascii b/#);
 * - lowercase when the quality has a minor third (min, dim, min7, m7b5, dim7, minMaj7, m6, min9), else uppercase;
 * - quality marks: dim "°", aug "+", m7b5 "ø7", dim7 "°7", maj7 "maj7", minMaj7 "(maj7)", sus2/sus4 as is,
 *   add9 "add9", maj9 "maj9", dom9/min9 "9", 6/m6 "add6" (an added sixth — "6" alone means an inversion here),
 *   dom7/min7 "7";
 * - inversions as figured bass: triads 1st "6", 2nd "64"; sevenths 1st "65", 2nd "43", 3rd "42" (the figure
 *   replaces the "7"; e.g. V7 1st inversion → "V65", iiø7 1st → "iiø65", vii°7 3rd → "vii°42");
 * - applied chords append "/" + the target's diatonic numeral (case from the target's diatonic triad): "V7/V", "vii°7/ii".
 * Examples in C ionian: ii7 → "ii7"; V7 → "V7"; ♭VII → "♭VII"; Neapolitan ♭II (quality maj) → "♭II".
 */
export function romanNumeral(key: Key, chord: Chord, ascii = false): string {
  const q = chordQuality(key, chord)
  const notes = chordNotes(key, chord)
  const inv = chord.inversion < notes.length ? chord.inversion : 0
  let degree: number
  let acc: number
  let tail = ""
  if (chord.applied) {
    // Applied chord: the numeral is relative to the TARGET'S major scale (V7/V, vii\u00B07/ii).
    const target = degreeNote(key, chord.applied.of)
    degree = mod(LETTERS.indexOf(notes[0].letter) - LETTERS.indexOf(target.letter), 7) + 1
    acc = norm12(mod(pitchClass(notes[0]) - pitchClass(target), 12) - MAJOR_STEPS[degree - 1])
    tail = "/" + numeralText(chord.applied.of, MINOR_THIRD.has(diatonicQuality(key, chord.applied.of, 3)))
  } else {
    degree = chord.degree
    acc = chord.alter
  }
  const flat = ascii ? "b" : "\u266D"
  const sharp = ascii ? "#" : "\u266F"
  const prefix = acc < 0 ? flat.repeat(-acc) : sharp.repeat(acc)
  return prefix + numeralText(degree, MINOR_THIRD.has(q)) + qualityText(q, inv, notes.length, ascii) + tail
}

/**
 * True when every scale note and every diatonic triad and seventh of the key can be spelled with at most a
 * double accidental (scaleNotes / chordNotes do not throw). The engine accepts only spellable keys.
 */
export function keySpellable(key: Key): boolean {
  throw new Error("not implemented")
}

/** True when chordNotes(key, chord) can be spelled (does not throw). The engine accepts only spellable chords. */
export function chordSpellable(key: Key, chord: Chord): boolean {
  throw new Error("not implemented")
}

/**
 * Inverse of romanNumeral (accepts both unicode and ascii forms, and "o"/"dim" for °, "h"/"0" for ø):
 *   [♭|b|♯|#]? NUMERAL QUALITY? FIGURE? ("/" NUMERAL)?
 * Accidentals are relative to the mode's own scale degree, with one forgiving rule for the pop/jazz habit of
 * writing accidentals relative to the MAJOR scale: when the accidental exactly restates how the mode's degree
 * differs from the major scale (e.g. "♭VI" or "♭VII" in aeolian, "♭II" in phrygian, "♯IV" in lydian), it is read
 * as the diatonic degree (alter 0). So in A aeolian "♭VI" and "VI" both mean F.
 * NUMERAL case decides major vs minor third when QUALITY doesn't. Resulting quality → if it equals the
 * diatonic quality of that degree in `key` and alter is 0, `quality` is left undefined (diatonic) with the
 * matching size; otherwise it is set explicitly. Applied chords ("V7/V") produce the chord whose root is a
 * fifth above the target (degree computed, alter chosen to hit the pitch class; null if that needs |alter| > 1)
 * with `applied: { of }`. Returns null for anything unparseable. Must round-trip:
 * parseRoman(romanNumeral(key, c), key) describes the same chord (same pitch classes, root, inversion).
 */
export function parseRoman(input: string, key: Key): Chord | null {
  const m = /^([\u266Db\u266F#])?([ivIV]+)(.*)$/u.exec(input.trim())
  if (!m) return null
  const lower = m[2] === m[2].toLowerCase()
  if (!lower && m[2] !== m[2].toUpperCase()) return null
  const numeral = NUMERALS.indexOf(m[2].toUpperCase())
  if (numeral < 0) return null
  const alt = m[1] === undefined ? 0 : m[1] === "b" || m[1] === "\u266D" ? -1 : 1
  const rest = m[3]
  const slash = rest.indexOf("/")
  const parsed = parseQualityFigure(slash < 0 ? rest : rest.slice(0, slash), lower)
  if (!parsed) return null
  if (slash < 0) return makeChord(key, (numeral + 1) as Degree, alt as -1 | 0 | 1, parsed.quality, parsed.inversion)
  const t = /^([ivIV]+)$/.exec(rest.slice(slash + 1))
  if (!t || (t[1] !== t[1].toLowerCase() && t[1] !== t[1].toUpperCase())) return null
  const of = NUMERALS.indexOf(t[1].toUpperCase())
  if (of < 0) return null
  try {
    const target = degreeNote(key, (of + 1) as Degree)
    const root = transposeSpelled(target, numeral, MAJOR_STEPS[numeral] + alt)
    return chordOnRoot(key, root, parsed.quality, parsed.inversion, { of: (of + 1) as Degree })
  } catch {
    return null
  }
}

/**
 * Functional category in the key: applied chords → "dominant"; otherwise by degree (alter 0):
 * 1, 3, 6 → "tonic"; 2, 4 → "predominant"; 5, 7 → "dominant"; altered roots → "other".
 */
export function harmonicFunction(key: Key, chord: Chord): HarmonicFunction {
  if (chord.applied) return "dominant"
  if (chord.alter !== 0) return "other"
  if (chord.degree === 1 || chord.degree === 3 || chord.degree === 6) return "tonic"
  if (chord.degree === 2 || chord.degree === 4) return "predominant"
  return "dominant"
}

/** Total length of the chord lane in beats (sum of slot lengths). */
export function laneLength(h: Harmony): number {
  return h.chords.reduce((sum, c) => sum + c.length, 0)
}

/**
 * True when a chord slot starts inside the transport loop. A lane may hold more bars than the
 * loop is long; the extra slots stay in the lane (and in the project) but are not heard.
 */
export function slotInLoop(h: Harmony, slot: ChordSlot, bars: number): boolean {
  return slot.start < bars * h.beatsPerBar
}

/** The slot sounding at `beat` (taken modulo laneLength, true modulo for negatives). Throws if the lane is empty. */
export function chordAt(h: Harmony, beat: number): ChordSlot {
  if (h.chords.length === 0) throw new Error("chordAt: the chord lane is empty")
  const total = laneLength(h)
  const b = mod(beat, total)
  for (const slot of h.chords) if (b >= slot.start && b < slot.start + slot.length) return slot
  return h.chords[h.chords.length - 1]
}


// ---------------------------------------------------------------------------------------------
// Private helpers and a few small exports used by suggest.ts / parseRoman.
// ---------------------------------------------------------------------------------------------

const LETTER_PC = [0, 2, 4, 5, 7, 9, 11]
const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11]
const NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII"]
/** Qualities whose third is minor: their numeral is written in lower case. */
const MINOR_THIRD: ReadonlySet<ChordQuality> = new Set<ChordQuality>(["min", "dim", "min7", "m7b5", "dim7", "minMaj7", "m6", "min9"])
const SEVENTHS: ReadonlySet<ChordQuality> = new Set<ChordQuality>(["maj7", "dom7", "min7", "m7b5", "dim7", "minMaj7"])
const SYMBOL_SUFFIX: Record<ChordQuality, string> = {
  maj: "", min: "m", dim: "°", aug: "+", sus2: "sus2", sus4: "sus4",
  maj7: "maj7", dom7: "7", min7: "m7", m7b5: "m7♭5", dim7: "°7", minMaj7: "m(maj7)",
  "6": "6", m6: "m6", add9: "add9", maj9: "maj9", dom9: "9", min9: "m9",
}
const TRIAD_FIGURES = ["", "6", "64"]
const SEVENTH_FIGURES = ["", "65", "43", "42"]
/** Figure text -> inversion. */
const FIGURE_INVERSION: Record<string, 1 | 2 | 3> = { "6": 1, "64": 2, "65": 1, "43": 2, "42": 3 }

function mod(a: number, b: number): number {
  return ((a % b) + b) % b
}

/** Wraps a semitone difference into -6..5. */
function norm12(d: number): number {
  const x = mod(d, 12)
  return x >= 6 ? x - 12 : x
}

/** The note on letter index `letterIdx` (any integer, wrapped) with pitch class `pc`. Throws RangeError beyond double accidentals. */
function spell(letterIdx: number, pc: number): NoteName {
  const li = mod(letterIdx, 7)
  const acc = norm12(pc - LETTER_PC[li])
  if (acc < -2 || acc > 2) throw new RangeError(`accidental ${acc} is out of range for ${LETTERS[li]}`)
  return { letter: LETTERS[li], accidental: acc as NoteName["accidental"] }
}

/** The note `letterSteps` letters above `n` and `semitones` semitones above it (a fifth: 4, 7; a minor second: 1, 1). */
export function transposeSpelled(n: NoteName, letterSteps: number, semitones: number): NoteName {
  return spell(LETTERS.indexOf(n.letter) + letterSteps, pitchClass(n) + semitones)
}

/**
 * Builds a Chord, leaving `quality` undefined (diatonic) when alter is 0 and the quality is the mode's own
 * triad or seventh on that degree; otherwise the quality is explicit.
 */
export function makeChord(key: Key, degree: Degree, alter: -1 | 0 | 1, quality: ChordQuality, inversion: 0 | 1 | 2 | 3 = 0, applied?: { of: Degree }): Chord {
  const chord: Chord = { degree, alter, size: QUALITY_SHAPES[quality].semitones.length >= 4 ? 4 : 3, inversion }
  if (alter === 0 && quality === diatonicQuality(key, degree, 3)) chord.size = 3
  else if (alter === 0 && quality === diatonicQuality(key, degree, 4)) chord.size = 4
  else chord.quality = quality
  if (applied) chord.applied = applied
  return chord
}

/** The chord of `quality` whose root is exactly the spelled note `root`; null when that needs an alteration beyond +-1. */
export function chordOnRoot(key: Key, root: NoteName, quality: ChordQuality, inversion: 0 | 1 | 2 | 3 = 0, applied?: { of: Degree }): Chord | null {
  const degree = mod(LETTERS.indexOf(root.letter) - LETTERS.indexOf(key.tonic.letter), 7) + 1
  const alter = norm12(pitchClass(root) - (pitchClass(key.tonic) + MODE_STEPS[key.mode][degree - 1]))
  if (alter < -1 || alter > 1) return null
  return makeChord(key, degree as Degree, alter as -1 | 0 | 1, quality, inversion, applied)
}

function numeralText(degree: number, lower: boolean): string {
  const n = NUMERALS[degree - 1]
  return lower ? n.toLowerCase() : n
}

/** Quality marks + figured bass for romanNumeral (see its doc comment). `inv` is already clamped to the chord's size. */
function qualityText(q: ChordQuality, inv: number, count: number, ascii: boolean): string {
  const dimMark = ascii ? "o" : "°"
  const hdimMark = ascii ? "h" : "ø"
  if (SEVENTHS.has(q)) {
    const fig = inv > 0 ? SEVENTH_FIGURES[inv] : "7"
    switch (q) {
      case "maj7": return "maj" + fig
      case "m7b5": return hdimMark + fig
      case "dim7": return dimMark + fig
      case "minMaj7": return "(maj" + fig + ")"
      default: return fig // dom7, min7
    }
  }
  const marks: Partial<Record<ChordQuality, string>> = {
    dim: dimMark, aug: "+", sus2: "sus2", sus4: "sus4", add9: "add9", maj9: "maj9", dom9: "9", min9: "9", "6": "add6", m6: "add6",
  }
  const fig = inv > 0 ? (count === 3 ? TRIAD_FIGURES[inv] : SEVENTH_FIGURES[inv]) : ""
  return (marks[q] ?? "") + (fig ?? "")
}

/** Inverse of qualityText: the part of a numeral after the roman letters and before any "/target". */
function parseQualityFigure(r: string, lower: boolean): { quality: ChordQuality; inversion: 0 | 1 | 2 | 3 } | null {
  const inv = (fig: string | undefined): 0 | 1 | 2 | 3 => (fig === undefined ? 0 : FIGURE_INVERSION[fig])
  const isSeventhFig = (fig: string | undefined) => fig === "65" || fig === "43" || fig === "42"
  let m: RegExpExecArray | null
  if (r === "") return { quality: lower ? "min" : "maj", inversion: 0 }
  if ((m = /^\(maj(7|65|43|42)\)$/.exec(r))) {
    return lower ? { quality: "minMaj7", inversion: m[1] === "7" ? 0 : inv(m[1]) } : null
  }
  if ((m = /^(?:maj|Δ)(?:(7|65|43|42)|9(65|64|43|42|6)?)$/.exec(r))) {
    if (lower) return null
    return m[1] !== undefined ? { quality: "maj7", inversion: m[1] === "7" ? 0 : inv(m[1]) } : { quality: "maj9", inversion: inv(m[2]) }
  }
  if ((m = /^(?:°|o|dim)(7|65|64|43|42|6)?$/.exec(r))) {
    if (m[1] === "7") return { quality: "dim7", inversion: 0 }
    return { quality: isSeventhFig(m[1]) ? "dim7" : "dim", inversion: inv(m[1]) }
  }
  if ((m = /^(?:ø|h|0)(7|65|43|42)?$/.exec(r))) {
    return { quality: "m7b5", inversion: m[1] === "7" ? 0 : inv(m[1]) }
  }
  if ((m = /^\+(64|6)?$/.exec(r))) return { quality: "aug", inversion: inv(m[1]) }
  if ((m = /^sus([24])(65|64|43|42|6)?$/.exec(r))) return { quality: m[1] === "2" ? "sus2" : "sus4", inversion: inv(m[2]) }
  if ((m = /^add([69])(65|64|43|42|6)?$/.exec(r))) {
    if (m[1] === "9") return lower ? null : { quality: "add9", inversion: inv(m[2]) }
    return { quality: lower ? "m6" : "6", inversion: inv(m[2]) }
  }
  if ((m = /^9(65|64|43|42|6)?$/.exec(r))) return { quality: lower ? "min9" : "dom9", inversion: inv(m[1]) }
  if (r === "7") return { quality: lower ? "min7" : "dom7", inversion: 0 }
  if ((m = /^(65|64|43|42|6)$/.exec(r))) {
    if (isSeventhFig(m[1])) return { quality: lower ? "min7" : "dom7", inversion: inv(m[1]) }
    return { quality: lower ? "min" : "maj", inversion: inv(m[1]) }
  }
  return null
}
