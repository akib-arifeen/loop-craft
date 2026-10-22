import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { suggestNext } from "../lib/harmony/suggest.ts"
import { chordPitchClasses, chordQuality, chordSymbol, romanNumeral } from "../lib/harmony/theory.ts"
import { MODES } from "../lib/harmony/types.ts"
import type { Chord, ChordSuggestion, Degree, Key, Mode, NoteName } from "../lib/harmony/types.ts"

const N = (letter: NoteName["letter"], accidental: NoteName["accidental"] = 0): NoteName => ({ letter, accidental })
const K = (tonic: NoteName, mode: Mode): Key => ({ tonic, mode })
const ch = (degree: Degree, extra: Partial<Chord> = {}): Chord => ({ degree, alter: 0, size: 4, inversion: 0, ...extra })
const mod12 = (n: number) => ((n % 12) + 12) % 12
const rootPc = (key: Key, c: Chord) => chordPitchClasses(key, c)[0]

function makeRng(seed: number) {
  let s = seed >>> 0 || 1
  const next = () => {
    s ^= s << 13
    s >>>= 0
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return s / 4294967296
  }
  return { int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)) }
}

// A real note name token: letter A-G, optional accidental, optionally followed by chord-suffix characters.
// "Borrowed" or "Root" must not count.
const NOTE_TOKEN = /^[A-G][♭♯𝄫𝄪]?(?:m|maj|dim|sus|add|°|\+|ø|♭|♯|\d|\/|[A-G])*$/u
const namesANote = (reason: string) => reason.split(/[\s,.:;()—–]+/u).some((t) => NOTE_TOKEN.test(t))

const C = K(N("C"), "ionian")
const A = K(N("A"), "aeolian")
const AH = K(N("A"), "harmonic-minor")

describe("suggestNext invariants", () => {
  const keys = [C, A, AH, K(N("D"), "dorian"), K(N("B", -1), "mixolydian"), K(N("F", 1), "lydian")]

  test("<= n, sorted by score desc, no duplicate (root pc, quality), never the identical chord, reasons non-empty and name a note", () => {
    const r = makeRng(1234)
    for (const key of keys)
      for (let rep = 0; rep < 20; rep++) {
        const prev = ch(r.int(1, 7) as Degree, { size: r.int(0, 1) ? 3 : 4 })
        const next = r.int(0, 2) === 0 ? null : ch(r.int(1, 7) as Degree, { size: r.int(0, 1) ? 3 : 4 })
        for (const n of [undefined, 3, 8, 30]) {
          const out: ChordSuggestion[] = n === undefined ? suggestNext(key, prev, next) : suggestNext(key, prev, next, n)
          const label = `${key.tonic.letter} ${key.mode} prev ${romanNumeral(key, prev)} next ${next ? romanNumeral(key, next) : "-"} n ${n}`
          if (n !== undefined) assert.ok(out.length <= n, label)
          assert.ok(out.length > 0, label)
          const seen = new Set<string>()
          for (let i = 0; i < out.length; i++) {
            const s = out[i]
            if (i > 0) assert.ok(out[i - 1].score >= s.score, `unsorted: ${label}`)
            assert.ok(s.score >= 0 && s.score <= 1, label)
            const id = `${rootPc(key, s.chord)}:${chordQuality(key, s.chord)}`
            assert.ok(!seen.has(id), `duplicate ${id}: ${label}`)
            seen.add(id)
            const identical = rootPc(key, s.chord) === rootPc(key, prev) && chordQuality(key, s.chord) === chordQuality(key, prev)
            assert.ok(!identical, `suggested the identical chord ${s.name}: ${label}`)
            assert.ok(s.reason.trim().length > 0, `empty reason: ${label}`)
            // The doc comment's modal-interchange template ("Borrowed from <mode>: <colour word>.") names no note;
            // every other category's template does.
            if (s.category === "modal-interchange") assert.match(s.reason, /^Borrowed from /, label)
            else assert.ok(namesANote(s.reason), `reason names no note: "${s.reason}" (${s.category}): ${label}`)
            assert.equal(s.roman, romanNumeral(key, s.chord), label)
            assert.equal(s.name, chordSymbol(key, s.chord), label)
          }
        }
      }
  })

  test("every mode works", () => {
    for (const mode of MODES) {
      const key = K(N("C"), mode)
      const out = suggestNext(key, ch(1), ch(5), 10)
      assert.ok(out.length > 0, mode)
    }
  })

  test("a fifth-falling move is ranked above a stepwise-up move (C: from ii)", () => {
    const out = suggestNext(C, ch(2), null, 20)
    const find = (deg: number) => out.find((s) => s.category === "diatonic" && s.chord.degree === deg && s.chord.alter === 0)
    const toV = find(5)
    const toIII = find(3)
    assert.ok(toV && toIII)
    assert.ok(toV.score > toIII.score)
  })
})

describe("suggestNext secondary dominants and tritone substitutes", () => {
  test("with next given: a dom7 a perfect fifth above next's root (applied.of = next.degree when labelled secondary-dominant)", () => {
    for (const key of [C, A, K(N("D"), "dorian")])
      for (let d = 1; d <= 7; d++) {
        const next = ch(d as Degree, { size: 3 })
        const out = suggestNext(key, ch(1), next, 30)
        const label = `${key.tonic.letter} ${key.mode} next degree ${d}`
        // (root pc, quality) de-duplication may let an identical diatonic V7 (e.g. IV7 in dorian) keep the slot instead.
        const hit = out.find((s) => rootPc(key, s.chord) === mod12(rootPc(key, next) + 7) && chordQuality(key, s.chord) === "dom7")
        assert.ok(hit, `no V7 of next: ${label}`)
        if (hit.category === "secondary-dominant") assert.equal(hit.chord.applied?.of, d, label)
        else assert.equal(hit.category, "diatonic", label)
        const sd = out.filter((s) => s.category === "secondary-dominant")
        for (const s of sd) assert.equal(s.chord.applied?.of, d, label)
      }
    // In C and A, where no diatonic dom7 competes for the slot on the targets below, the label is secondary-dominant.
    for (const d of [2, 3, 4, 6] as Degree[]) {
      const out = suggestNext(C, ch(1), ch(d, { size: 3 }), 30)
      assert.ok(out.some((s) => s.category === "secondary-dominant" && s.chord.applied?.of === d), `C next ${d}`)
    }
  })

  test("hand case: in C, V7/V -> D7 leading to G; the reason names the leading tone and the target", () => {
    const out = suggestNext(C, ch(1), ch(5), 30)
    const s = out.find((x) => x.category === "secondary-dominant")!
    assert.equal(s.name, "D7")
    assert.equal(s.roman, "V7/V")
    assert.ok(s.reason.includes("F♯"), s.reason)
    assert.ok(s.reason.includes("G"), s.reason)
  })

  test("without next: secondary dominants of ii, IV, V, vi are offered", () => {
    const out = suggestNext(C, ch(1), null, 40)
    const of = new Set(out.filter((s) => s.category === "secondary-dominant").map((s) => s.chord.applied?.of))
    for (const d of [2, 4, 5, 6]) assert.ok(of.has(d as Degree), `V7/${d} missing`)
  })

  test("tritone sub: root a half step above next's root, dom7", () => {
    for (const key of [C, A])
      for (let d = 1; d <= 7; d++) {
        const next = ch(d as Degree, { size: 3 })
        const out = suggestNext(key, ch(1), next, 30)
        const label = `${key.tonic.letter} ${key.mode} next ${d}`
        const ts = out.find((s) => rootPc(key, s.chord) === mod12(rootPc(key, next) + 1) && chordQuality(key, s.chord) === "dom7")
        assert.ok(ts, `no tritone sub: ${label}`)
        for (const s of out.filter((x) => x.category === "tritone-sub")) {
          assert.equal(chordQuality(key, s.chord), "dom7", label)
          assert.equal(rootPc(key, s.chord), mod12(rootPc(key, next) + 1), label)
        }
      }
  })

  test("hand case: in C, tritone sub into C is D♭7 (♭II7)", () => {
    const out = suggestNext(C, ch(4), ch(1, { size: 3 }), 30)
    const ts = out.find((s) => s.category === "tritone-sub")!
    assert.equal(ts.name, "D♭7")
  })

  test("no tritone sub or secondary dominant without a next-chord target for the tritone sub", () => {
    const out = suggestNext(C, ch(1), null, 40)
    assert.equal(out.some((s) => s.category === "tritone-sub"), false)
  })
})

describe("suggestNext deceptive and borrowed chords", () => {
  test("after V or V7 in a major key: a deceptive vi", () => {
    for (const prev of [ch(5, { size: 3 }), ch(5), ch(5, { quality: "dom7" })]) {
      const out = suggestNext(C, prev, null, 30)
      const d = out.find((s) => s.category === "deceptive")
      assert.ok(d, `no deceptive after ${romanNumeral(C, prev)}`)
      assert.equal(rootPc(C, d.chord), 9) // A
      assert.ok(d.reason.includes(d.name), d.reason)
    }
  })

  test("after the V7 of a minor key: deceptive to the flat-six", () => {
    const out = suggestNext(AH, ch(5), null, 30)
    const d = out.find((s) => s.category === "deceptive")
    assert.ok(d)
    assert.equal(rootPc(AH, d.chord), 5) // F
  })

  test("no deceptive suggestion after a non-dominant chord", () => {
    assert.equal(suggestNext(C, ch(2), null, 30).some((s) => s.category === "deceptive"), false)
    assert.equal(suggestNext(C, ch(4), null, 30).some((s) => s.category === "deceptive"), false)
  })

  test("major key borrows iv, flat-VI, flat-VII, flat-III", () => {
    const out = suggestNext(C, ch(1), null, 40)
    const pcs = new Set(out.filter((s) => s.category === "modal-interchange").map((s) => rootPc(C, s.chord)))
    for (const pc of [5, 8, 10, 3]) assert.ok(pcs.has(pc), `pc ${pc} not borrowed`)
  })

  test("minor key borrows the major IV and V7", () => {
    const out = suggestNext(A, ch(1), null, 40)
    const m = out.filter((s) => s.category === "modal-interchange")
    assert.ok(m.some((s) => rootPc(A, s.chord) === 2), "IV (D) missing") // D major
    assert.ok(m.some((s) => rootPc(A, s.chord) === 4 && chordQuality(A, s.chord) === "dom7"), "V7 (E7) missing")
  })
})
