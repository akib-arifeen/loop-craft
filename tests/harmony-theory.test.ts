import { test, describe } from "node:test"
import assert from "node:assert/strict"
import {
  chordAt,
  chordNotes,
  chordPitchClasses,
  chordQuality,
  chordSymbol,
  degreeNote,
  diatonicQuality,
  formatNoteName,
  harmonicFunction,
  laneLength,
  parseNoteName,
  parseRoman,
  pitchClass,
  romanNumeral,
  slotInLoop,
} from "../lib/harmony/theory.ts"
import { demoHarmony } from "../lib/harmony/presets.ts"
import { CHORD_QUALITIES, LETTERS } from "../lib/harmony/types.ts"
import type { Chord, ChordQuality, Degree, Harmony, Key, Mode, NoteName } from "../lib/harmony/types.ts"

const N = (letter: NoteName["letter"], accidental: NoteName["accidental"] = 0): NoteName => ({ letter, accidental })
const K = (tonic: NoteName, mode: Mode): Key => ({ tonic, mode })
const ch = (degree: Degree, extra: Partial<Chord> = {}): Chord => ({ degree, alter: 0, size: 4, inversion: 0, ...extra })
const mod12 = (n: number) => ((n % 12) + 12) % 12

// Hand-written scale tables (semitones above the tonic), independent of the code under test.
const STEPS: Record<Mode, number[]> = {
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
const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
const ALL_MODES = Object.keys(STEPS) as Mode[]

describe("pitchClass / parseNoteName / formatNoteName", () => {
  test("pitchClass", () => {
    assert.equal(pitchClass(N("C")), 0)
    assert.equal(pitchClass(N("C", 1)), 1)
    assert.equal(pitchClass(N("D", -1)), 1)
    assert.equal(pitchClass(N("B", 1)), 0) // B# = C
    assert.equal(pitchClass(N("C", -1)), 11) // Cb = B
    assert.equal(pitchClass(N("E", -2)), 2) // Ebb = D
    assert.equal(pitchClass(N("C", 2)), 2) // C## = D
    assert.equal(pitchClass(N("F", 2)), 7)
    assert.equal(pitchClass(N("A")), 9)
  })

  test("parseNoteName: ascii and unicode, double accidentals, case-insensitive letter", () => {
    assert.deepEqual(parseNoteName("A"), N("A"))
    assert.deepEqual(parseNoteName("Bb"), N("B", -1))
    assert.deepEqual(parseNoteName("B♭"), N("B", -1))
    assert.deepEqual(parseNoteName("F#"), N("F", 1))
    assert.deepEqual(parseNoteName("F♯"), N("F", 1))
    assert.deepEqual(parseNoteName("Ebb"), N("E", -2))
    assert.deepEqual(parseNoteName("C##"), N("C", 2))
    assert.deepEqual(parseNoteName("e"), N("E"))
    assert.deepEqual(parseNoteName("bb"), N("B", -1))
  })

  test("parseNoteName: invalid -> null", () => {
    for (const s of ["", "H", "1", "Z#", "C###", "Bbbb", "##", "AA"]) assert.equal(parseNoteName(s), null, JSON.stringify(s))
  })

  test("formatNoteName", () => {
    assert.equal(formatNoteName(N("A")), "A")
    assert.equal(formatNoteName(N("B", -1)), "B♭")
    assert.equal(formatNoteName(N("F", 1)), "F♯")
    assert.equal(formatNoteName(N("E", -2)), "E𝄫")
    assert.equal(formatNoteName(N("C", 2)), "C𝄪")
    assert.equal(formatNoteName(N("B", -1), true), "Bb")
    assert.equal(formatNoteName(N("F", 1), true), "F#")
    assert.equal(formatNoteName(N("E", -2), true), "Ebb")
    assert.equal(formatNoteName(N("C", 2), true), "C##")
  })

  test("format -> parse round trip for all 35 names, unicode and ascii", () => {
    for (const letter of LETTERS)
      for (const accidental of [-2, -1, 0, 1, 2] as const) {
        const n = N(letter, accidental)
        assert.deepEqual(parseNoteName(formatNoteName(n)), n)
        assert.deepEqual(parseNoteName(formatNoteName(n, true)), n)
      }
  })
})

describe("degreeNote spelling", () => {
  test("hand cases", () => {
    assert.deepEqual(degreeNote(K(N("A"), "aeolian"), 6), N("F"))
    assert.deepEqual(degreeNote(K(N("C"), "ionian"), 7, -1), N("B", -1))
    assert.deepEqual(degreeNote(K(N("F", 1), "ionian"), 3), N("A", 1))
    assert.deepEqual(degreeNote(K(N("B", -1), "aeolian"), 7), N("A", -1))
    assert.deepEqual(degreeNote(K(N("E", -1), "ionian"), 4), N("A", -1))
    assert.deepEqual(degreeNote(K(N("G", 1), "harmonic-minor"), 7), N("F", 2)) // F double sharp
    assert.deepEqual(degreeNote(K(N("D", 1), "harmonic-minor"), 7), N("C", 2))
    assert.deepEqual(degreeNote(K(N("D", -1), "ionian"), 4), N("G", -1))
  })

  test("letters are consecutive from the tonic and pitch classes follow the mode, for every tonic x mode x degree", () => {
    const tonics = [N("C"), N("D"), N("E"), N("F"), N("G"), N("A"), N("B"), N("B", -1), N("E", -1), N("A", -1), N("D", -1), N("G", -1), N("F", 1), N("C", 1), N("G", 1), N("D", 1), N("A", 1)]
    let checked = 0
    for (const tonic of tonics)
      for (const mode of ALL_MODES)
        for (let d = 1; d <= 7; d++) {
          let note: NoteName
          try {
            note = degreeNote(K(tonic, mode), d as Degree)
          } catch (e) {
            assert.ok(e instanceof RangeError, `unexpected error ${e}`)
            continue // would need an accidental beyond double
          }
          const tIdx = LETTERS.indexOf(tonic.letter)
          assert.equal(note.letter, LETTERS[(tIdx + d - 1) % 7], `${formatNoteName(tonic)} ${mode} ${d}`)
          assert.equal(pitchClass(note), mod12(pitchClass(tonic) + STEPS[mode][d - 1]), `${formatNoteName(tonic)} ${mode} ${d}`)
          assert.ok(Math.abs(note.accidental) <= 2)
          checked++
        }
    assert.ok(checked > 1000, `only ${checked} combinations checked`)
  })

  test("alter shifts the pitch class by a semitone (and keeps the letter)", () => {
    const key = K(N("C"), "ionian")
    assert.deepEqual(degreeNote(key, 2, -1), N("D", -1))
    assert.deepEqual(degreeNote(key, 4, 1), N("F", 1))
    assert.deepEqual(degreeNote(key, 5, 0), N("G"))
  })
})

describe("diatonicQuality hand tables", () => {
  const tables: Array<[string, Key, ChordQuality[], ChordQuality[]]> = [
    ["C ionian", K(N("C"), "ionian"), ["maj", "min", "min", "maj", "maj", "min", "dim"], ["maj7", "min7", "min7", "maj7", "dom7", "min7", "m7b5"]],
    ["A aeolian", K(N("A"), "aeolian"), ["min", "dim", "maj", "min", "min", "maj", "maj"], ["min7", "m7b5", "maj7", "min7", "min7", "maj7", "dom7"]],
    // A B C D E F G#: i A-C-E-G# minMaj7 · ii B-D-F-A m7b5 · III C-E-G#-B aug · iv D-F-A-C · V E-G#-B-D · VI F-A-C-E · vii G#-B-D-F dim7
    ["A harmonic-minor", K(N("A"), "harmonic-minor"), ["min", "dim", "aug", "min", "maj", "maj", "dim"], ["minMaj7", "m7b5", "aug", "min7", "dom7", "maj7", "dim7"]],
    ["C dorian", K(N("C"), "dorian"), ["min", "min", "maj", "maj", "min", "dim", "maj"], ["min7", "min7", "maj7", "dom7", "min7", "m7b5", "maj7"]],
    ["C phrygian", K(N("C"), "phrygian"), ["min", "maj", "maj", "min", "dim", "maj", "min"], ["min7", "maj7", "dom7", "min7", "m7b5", "maj7", "min7"]],
    ["C lydian", K(N("C"), "lydian"), ["maj", "maj", "min", "dim", "maj", "min", "min"], ["maj7", "dom7", "min7", "m7b5", "maj7", "min7", "min7"]],
    ["C mixolydian", K(N("C"), "mixolydian"), ["maj", "min", "dim", "maj", "min", "min", "maj"], ["dom7", "min7", "m7b5", "maj7", "min7", "min7", "maj7"]],
    ["C locrian", K(N("C"), "locrian"), ["dim", "maj", "min", "min", "maj", "maj", "min"], ["m7b5", "maj7", "min7", "min7", "maj7", "dom7", "min7"]],
    // C D Eb F G A B: i C-Eb-G-B · ii D-F-A-C · III+ Eb-G-B-D · IV F-A-C-Eb · V G-B-D-F · vi A-C-Eb-G · vii B-D-F-A
    ["C melodic-minor", K(N("C"), "melodic-minor"), ["min", "min", "aug", "maj", "maj", "dim", "dim"], ["minMaj7", "min7", "aug", "dom7", "dom7", "m7b5", "m7b5"]],
  ]
  for (const [name, key, triads, sevenths] of tables) {
    test(name, () => {
      for (let d = 1; d <= 7; d++) {
        assert.equal(diatonicQuality(key, d as Degree, 3), triads[d - 1], `${name} triad ${d}`)
        assert.equal(diatonicQuality(key, d as Degree, 4), sevenths[d - 1], `${name} seventh ${d}`)
      }
    })
  }

  test("chordQuality: explicit quality wins, else diatonic", () => {
    const key = K(N("A"), "aeolian")
    assert.equal(chordQuality(key, ch(5, { quality: "dom7" })), "dom7")
    assert.equal(chordQuality(key, ch(5)), "min7")
    assert.equal(chordQuality(key, ch(5, { size: 3 })), "min")
  })
})

describe("chordNotes spelling", () => {
  test("letters follow QUALITY_SHAPES: minor third above A is C, never B#", () => {
    const key = K(N("A"), "aeolian")
    assert.deepEqual(chordNotes(key, ch(1)), [N("A"), N("C"), N("E"), N("G")])
    assert.deepEqual(chordNotes(key, ch(5, { quality: "dom7" })), [N("E"), N("G", 1), N("B"), N("D")])
    assert.deepEqual(chordNotes(K(N("C"), "ionian"), ch(2, { alter: -1, quality: "maj", size: 3 })), [N("D", -1), N("F"), N("A", -1)])
    assert.deepEqual(chordPitchClasses(key, ch(1)), [9, 0, 4, 7])
  })

  test("sus/add9/6 tones", () => {
    const key = K(N("C"), "ionian")
    assert.deepEqual(chordNotes(key, ch(1, { quality: "sus4", size: 3 })), [N("C"), N("F"), N("G")])
    assert.deepEqual(chordNotes(key, ch(1, { quality: "sus2", size: 3 })), [N("C"), N("D"), N("G")])
    assert.deepEqual(chordNotes(key, ch(1, { quality: "add9" })), [N("C"), N("E"), N("G"), N("D")])
    assert.deepEqual(chordNotes(key, ch(1, { quality: "6" })), [N("C"), N("E"), N("G"), N("A")])
    assert.deepEqual(chordNotes(key, ch(1, { quality: "maj9" })), [N("C"), N("E"), N("G"), N("B"), N("D")])
  })
})

describe("chordSymbol / romanNumeral", () => {
  const A = K(N("A"), "aeolian")
  const C = K(N("C"), "ionian")
  const AH = K(N("A"), "harmonic-minor")

  test("chordSymbol examples (A aeolian)", () => {
    assert.equal(chordSymbol(A, ch(1)), "Am7")
    assert.equal(chordSymbol(A, ch(6)), "Fmaj7")
    assert.equal(chordSymbol(A, ch(3)), "Cmaj7")
    assert.equal(chordSymbol(A, ch(7, { quality: "6" })), "G6")
    assert.equal(chordSymbol(A, ch(5, { quality: "dom7" })), "E7")
    assert.equal(chordSymbol(A, ch(1, { size: 3 })), "Am")
    assert.equal(chordSymbol(A, ch(2, { size: 3 })), "B°")
    assert.equal(chordSymbol(A, ch(2)), "Bm7♭5")
  })

  test("chordSymbol suffixes", () => {
    assert.equal(chordSymbol(AH, ch(1)), "Am(maj7)")
    assert.equal(chordSymbol(AH, ch(3, { size: 3 })), "C+")
    assert.equal(chordSymbol(AH, ch(7)), "G♯°7")
    assert.equal(chordSymbol(C, ch(1, { quality: "sus2", size: 3 })), "Csus2")
    assert.equal(chordSymbol(C, ch(1, { quality: "sus4", size: 3 })), "Csus4")
    assert.equal(chordSymbol(C, ch(1, { quality: "m6" })), "Cm6")
    assert.equal(chordSymbol(C, ch(1, { quality: "add9" })), "Cadd9")
    assert.equal(chordSymbol(C, ch(1, { quality: "maj9" })), "Cmaj9")
    assert.equal(chordSymbol(C, ch(5, { quality: "dom9" })), "G9")
    assert.equal(chordSymbol(C, ch(2, { quality: "min9" })), "Dm9")
    assert.equal(chordSymbol(C, ch(7, { alter: -1, quality: "maj", size: 3 })), "B♭")
  })

  test("chordSymbol inversions append /bass; ascii forms", () => {
    assert.equal(chordSymbol(A, ch(1, { inversion: 1 })), "Am7/C")
    assert.equal(chordSymbol(A, ch(1, { inversion: 3 })), "Am7/G")
    assert.equal(chordSymbol(C, ch(1, { size: 3, inversion: 2 })), "C/G")
    assert.equal(chordSymbol(C, ch(7, { alter: -1, quality: "maj", size: 3 }), true), "Bb")
    assert.equal(chordSymbol(A, ch(2), true), "Bm7b5")
    assert.equal(chordSymbol(A, ch(2, { size: 3 }), true), "Bdim")
    assert.equal(chordSymbol(AH, ch(7), true), "G#dim7")
    assert.equal(chordSymbol(K(N("F", 1), "ionian"), ch(1, { size: 3 }), true), "F#")
  })

  test("romanNumeral examples", () => {
    assert.equal(romanNumeral(A, ch(1)), "i7")
    assert.equal(romanNumeral(A, ch(6)), "VImaj7")
    assert.equal(romanNumeral(A, ch(7, { quality: "6" })), "VIIadd6")
    assert.equal(romanNumeral(A, ch(5, { quality: "dom7" })), "V7")
    assert.equal(romanNumeral(A, ch(5, { quality: "dom7", inversion: 1 })), "V65")
    assert.equal(romanNumeral(A, ch(2, { inversion: 1 })), "iiø65")
    assert.equal(romanNumeral(A, ch(2)), "iiø7")
    assert.equal(romanNumeral(AH, ch(7, { inversion: 3 })), "vii°42")
    assert.equal(romanNumeral(AH, ch(7)), "vii°7")
    assert.equal(romanNumeral(C, ch(2)), "ii7")
    assert.equal(romanNumeral(C, ch(5)), "V7")
    assert.equal(romanNumeral(C, ch(7, { alter: -1, quality: "maj", size: 3 })), "♭VII")
    assert.equal(romanNumeral(C, ch(2, { alter: -1, quality: "maj", size: 3 })), "♭II")
    assert.equal(romanNumeral(C, ch(7, { alter: -1, quality: "maj", size: 3 }), true), "bVII")
    assert.equal(romanNumeral(C, ch(2, { alter: -1, quality: "maj", size: 3 }), true), "bII")
  })

  test("figured bass: triads and sevenths", () => {
    assert.equal(romanNumeral(C, ch(1, { size: 3, inversion: 1 })), "I6")
    assert.equal(romanNumeral(C, ch(1, { size: 3, inversion: 2 })), "I64")
    assert.equal(romanNumeral(C, ch(2, { size: 3, inversion: 1 })), "ii6")
    assert.equal(romanNumeral(C, ch(5, { inversion: 1 })), "V65")
    assert.equal(romanNumeral(C, ch(5, { inversion: 2 })), "V43")
    assert.equal(romanNumeral(C, ch(5, { inversion: 3 })), "V42")
  })

  test("quality marks", () => {
    assert.equal(romanNumeral(C, ch(7, { size: 3 })), "vii°")
    assert.equal(romanNumeral(AH, ch(3, { size: 3 })), "III+")
    assert.equal(romanNumeral(C, ch(1, { quality: "sus4", size: 3 })), "Isus4")
    assert.equal(romanNumeral(C, ch(1, { quality: "add9" })), "Iadd9")
    assert.equal(romanNumeral(C, ch(1, { quality: "maj9" })), "Imaj9")
    assert.equal(romanNumeral(C, ch(5, { quality: "dom9" })), "V9")
    assert.equal(romanNumeral(C, ch(2, { quality: "min9" })), "ii9")
    assert.equal(romanNumeral(AH, ch(1)), "i(maj7)")
  })

  test("applied chords: V7/V", () => {
    const vv = ch(2, { quality: "dom7", applied: { of: 5 } })
    assert.equal(chordSymbol(C, vv), "D7")
    assert.equal(romanNumeral(C, vv), "V7/V")
  })
})

describe("parseRoman", () => {
  const A = K(N("A"), "aeolian")
  const C = K(N("C"), "ionian")
  const AH = K(N("A"), "harmonic-minor")

  test("diatonic numerals leave quality undefined with the matching size", () => {
    const i7 = parseRoman("i7", A)!
    assert.equal(i7.degree, 1)
    assert.equal(i7.alter, 0)
    assert.equal(i7.quality, undefined)
    assert.equal(i7.size, 4)
    assert.equal(i7.inversion, 0)
    const vi = parseRoman("VImaj7", A)!
    assert.equal(vi.degree, 6)
    assert.equal(vi.quality, undefined)
    const tri = parseRoman("III", A)!
    assert.equal(tri.degree, 3)
    assert.equal(tri.size, 3)
    assert.equal(tri.quality, undefined)
  })

  test("explicit qualities", () => {
    assert.equal(parseRoman("VIIadd6", A)!.quality, "6")
    assert.equal(parseRoman("VIIadd6", A)!.degree, 7)
    const v7 = parseRoman("V7", A)!
    assert.equal(v7.degree, 5)
    assert.equal(v7.quality, "dom7")
    assert.equal(chordSymbol(A, v7), "E7")
  })

  test("figured bass inversions", () => {
    const v65 = parseRoman("V65", C)!
    assert.equal(v65.degree, 5)
    assert.equal(v65.inversion, 1)
    assert.equal(chordSymbol(C, v65), "G7/B")
    const ii = parseRoman("iiø65", A)!
    assert.equal(ii.degree, 2)
    assert.equal(ii.inversion, 1)
    assert.deepEqual(chordPitchClasses(A, ii), [11, 2, 5, 9])
    const vii = parseRoman("vii°42", AH)!
    assert.equal(vii.degree, 7)
    assert.equal(vii.inversion, 3)
    assert.deepEqual(chordPitchClasses(AH, vii), [8, 11, 2, 5])
    assert.equal(parseRoman("I64", C)!.inversion, 2)
    assert.equal(parseRoman("I6", C)!.inversion, 1)
    assert.equal(parseRoman("V43", C)!.inversion, 2)
  })

  test("altered roots: unicode and ascii", () => {
    for (const s of ["♭VII", "bVII"]) {
      const c = parseRoman(s, C)!
      assert.equal(c.degree, 7)
      assert.equal(c.alter, -1)
      assert.equal(chordSymbol(C, c), "B♭")
    }
    for (const s of ["♭II", "bII"]) {
      const c = parseRoman(s, C)!
      assert.equal(c.degree, 2)
      assert.equal(c.alter, -1)
      assert.equal(chordSymbol(C, c), "D♭")
    }
    const sharp = parseRoman("#iv°", C)!
    assert.equal(sharp.degree, 4)
    assert.equal(sharp.alter, 1)
    assert.deepEqual(chordPitchClasses(C, sharp), [6, 9, 0])
  })

  test("alternative spellings of dim / half-dim", () => {
    for (const s of ["viio7", "vii°7", "viidim7"]) assert.deepEqual(chordPitchClasses(AH, parseRoman(s, AH)!), [8, 11, 2, 5], s)
    for (const s of ["iiø7", "iih7", "ii07"]) assert.deepEqual(chordPitchClasses(A, parseRoman(s, A)!), [11, 2, 5, 9], s)
    assert.deepEqual(chordPitchClasses(C, parseRoman("viio", C)!), [11, 2, 5])
  })

  test("applied chords", () => {
    const vv = parseRoman("V7/V", C)!
    assert.equal(vv.applied?.of, 5)
    assert.deepEqual(chordPitchClasses(C, vv), [2, 6, 9, 0]) // D7
    assert.equal(chordSymbol(C, vv), "D7")
    const cases: Array<[string, number, Degree]> = [
      ["V7/ii", 9, 2], // A7
      ["V7/iii", 11, 3], // B7
      ["V7/IV", 0, 4], // C7
      ["V7/vi", 4, 6], // E7
    ]
    for (const [s, rootPc, of] of cases) {
      const c = parseRoman(s, C)!
      assert.ok(c, s)
      assert.equal(c.applied?.of, of, s)
      assert.equal(chordPitchClasses(C, c)[0], rootPc, s)
      assert.equal(chordQuality(C, c), "dom7", s)
    }
    const lt = parseRoman("vii°7/ii", C)!
    assert.equal(lt.applied?.of, 2)
    assert.deepEqual(chordPitchClasses(C, lt), [1, 4, 7, 10]) // C♯°7, leading tone of D
    assert.equal(romanNumeral(C, vv), "V7/V")
    assert.equal(romanNumeral(C, lt), "vii°7/ii")
  })

  test("garbage -> null", () => {
    for (const s of ["", "xyz", "VIII", "foo", "V7/", "7", "iiiiiiii", "   "]) assert.equal(parseRoman(s, C), null, JSON.stringify(s))
  })

  test("round trip: parseRoman(romanNumeral(k, c), k) keeps pitch classes, root and inversion", () => {
    const keys = [K(N("C"), "ionian"), K(N("A"), "aeolian"), K(N("D"), "dorian"), K(N("B", -1), "mixolydian"), K(N("G", 1), "harmonic-minor"), K(N("E", -1), "phrygian")]
    const withInversions = new Set<string>(["maj", "min", "dim", "aug", "maj7", "dom7", "min7", "m7b5", "dim7", "minMaj7"])
    const tones: Record<string, number> = { maj: 3, min: 3, dim: 3, aug: 3, maj7: 4, dom7: 4, min7: 4, m7b5: 4, dim7: 4, minMaj7: 4 }
    let tested = 0
    for (const key of keys)
      for (let d = 1; d <= 7; d++)
        for (const alter of [-1, 0, 1] as const) {
          const variants: Array<Partial<Chord>> = [
            { quality: undefined, size: 3 },
            { quality: undefined, size: 4 },
            ...CHORD_QUALITIES.map((q) => ({ quality: q, size: 4 as const })),
          ]
          for (const v of variants) {
            const q = v.quality
            let diatonicTones = 0
            if (q === undefined) {
              try {
                diatonicTones = chordPitchClasses(key, { degree: d as Degree, alter, size: v.size ?? 4, inversion: 0 }).length
              } catch (e) {
                assert.ok(e instanceof RangeError)
                continue // chord tones would need a triple accidental
              }
            }
            const invs = q === undefined ? Array.from({ length: diatonicTones }, (_, i) => i) : withInversions.has(q) ? Array.from({ length: tones[q] }, (_, i) => i) : [0]
            for (const inversion of invs) {
              const c: Chord = { degree: d as Degree, alter, size: 4, inversion: inversion as Chord["inversion"], ...v }
              let text: string
              let expectPcs: number[]
              try {
                text = romanNumeral(key, c)
                expectPcs = chordPitchClasses(key, c)
              } catch (e) {
                assert.ok(e instanceof RangeError)
                continue
              }
              const back = parseRoman(text, key)
              const label = `${text} in ${formatNoteName(key.tonic)} ${key.mode} from ${JSON.stringify(c)}`
              assert.ok(back, `parse failed: ${label}`)
              assert.deepEqual(chordPitchClasses(key, back), expectPcs, label)
              assert.equal(chordPitchClasses(key, back)[0], expectPcs[0], label)
              assert.equal(back.inversion, c.inversion, label)
              tested++
            }
          }
        }
    assert.ok(tested > 2000, `only ${tested} combinations tested`)
  })

  test("ascii romanNumeral parses back too", () => {
    const key = K(N("A"), "harmonic-minor")
    for (let d = 1; d <= 7; d++)
      for (const size of [3, 4] as const) {
        const c = ch(d as Degree, { size })
        const back = parseRoman(romanNumeral(key, c, true), key)
        assert.ok(back, romanNumeral(key, c, true))
        assert.deepEqual(chordPitchClasses(key, back), chordPitchClasses(key, c))
      }
  })
})

describe("harmonicFunction", () => {
  const C = K(N("C"), "ionian")
  test("by degree", () => {
    const f = (d: Degree, extra: Partial<Chord> = {}) => harmonicFunction(C, ch(d, extra))
    assert.equal(f(1), "tonic")
    assert.equal(f(3), "tonic")
    assert.equal(f(6), "tonic")
    assert.equal(f(2), "predominant")
    assert.equal(f(4), "predominant")
    assert.equal(f(5), "dominant")
    assert.equal(f(7), "dominant")
  })
  test("altered roots are 'other'; applied chords are 'dominant'", () => {
    assert.equal(harmonicFunction(C, ch(7, { alter: -1, quality: "maj", size: 3 })), "other")
    assert.equal(harmonicFunction(C, ch(2, { alter: -1, quality: "maj", size: 3 })), "other")
    assert.equal(harmonicFunction(C, ch(2, { quality: "dom7", applied: { of: 5 } })), "dominant")
    assert.equal(harmonicFunction(C, ch(1, { quality: "dom7", applied: { of: 4 } })), "dominant")
  })
})

describe("laneLength / chordAt", () => {
  const h: Harmony = demoHarmony()
  test("laneLength", () => {
    assert.equal(laneLength(h), 16)
  })
  test("chordAt within the lane", () => {
    assert.equal(chordAt(h, 0), h.chords[0])
    assert.equal(chordAt(h, 3.99), h.chords[0])
    assert.equal(chordAt(h, 4), h.chords[1])
    assert.equal(chordAt(h, 9.5), h.chords[2])
    assert.equal(chordAt(h, 15.99), h.chords[3])
  })
  test("beats beyond the lane wrap; negative beats use true modulo", () => {
    assert.equal(chordAt(h, 16), h.chords[0])
    assert.equal(chordAt(h, 100), h.chords[1]) // 100 mod 16 = 4
    assert.equal(chordAt(h, -0.5), h.chords[3]) // 15.5
    assert.equal(chordAt(h, -4), h.chords[3]) // 12
    assert.equal(chordAt(h, -16), h.chords[0])
    assert.equal(chordAt(h, -13), h.chords[0]) // 3
  })
  test("uneven slot lengths", () => {
    const u: Harmony = { ...h, chords: [{ start: 0, length: 6, chord: ch(1) }, { start: 6, length: 2, chord: ch(5) }] }
    assert.equal(laneLength(u), 8)
    assert.equal(chordAt(u, 5.9), u.chords[0])
    assert.equal(chordAt(u, 6), u.chords[1])
    assert.equal(chordAt(u, 8), u.chords[0])
    assert.equal(chordAt(u, -1), u.chords[1])
  })
  test("empty lane throws", () => {
    assert.throws(() => chordAt({ ...h, chords: [] }, 0))
  })
})

describe("slotInLoop", () => {
  const h: Harmony = demoHarmony()
  const flags = (bars: number) => h.chords.map((slot) => slotInLoop(h, slot, bars))

  test("1 bar: only the first slot of a four-chord lane sounds", () => {
    assert.deepEqual(flags(1), [true, false, false, false])
  })

  test("2 bars: the first two slots sound", () => {
    assert.deepEqual(flags(2), [true, true, false, false])
  })

  test("4 bars: every slot sounds", () => {
    assert.deepEqual(flags(4), [true, true, true, true])
  })

  test("the lane itself is never truncated by the loop length", () => {
    for (const bars of [1, 2, 4]) {
      assert.equal(h.chords.length, 4)
      assert.equal(flags(bars).length, 4)
    }
  })

  test("a single-bar lane is in the loop at every length", () => {
    const one: Harmony = { ...h, chords: [h.chords[0]] }
    for (const bars of [1, 2, 4]) assert.equal(slotInLoop(one, one.chords[0], bars), true)
  })
})
