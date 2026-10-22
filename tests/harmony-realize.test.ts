import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { pitchToMidi, realizePart, voiceLead } from "../lib/harmony/realize.ts"
import { chordAt, chordPitchClasses, laneLength, pitchClass, scalePitchClasses } from "../lib/harmony/theory.ts"
import { BASS_PARTS, KEYS_PARTS, demoHarmony, findPart } from "../lib/harmony/presets.ts"
import { MODES } from "../lib/harmony/types.ts"
import type { Chord, Degree, Harmony, Key, Mode, NoteName } from "../lib/harmony/types.ts"

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
  return { next, int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)), pick: <T>(a: readonly T[]): T => a[Math.floor(next() * a.length)] }
}

const N = (letter: NoteName["letter"], accidental: NoteName["accidental"] = 0): NoteName => ({ letter, accidental })
const K = (tonic: NoteName, mode: Mode): Key => ({ tonic, mode })
const ch = (degree: Degree, extra: Partial<Chord> = {}): Chord => ({ degree, alter: 0, size: 4, inversion: 0, ...extra })
const A_AEOLIAN = K(N("A"), "aeolian")
const mod12 = (n: number) => ((n % 12) + 12) % 12

describe("pitchToMidi", () => {
  const bass = { low: 28, high: 52 }
  const am7 = ch(1)

  test("chord tones: tone 2 octave 0 is the fifth ABOVE the root", () => {
    // lowest MIDI >= 28 with pitch class A is 33
    assert.equal(pitchToMidi({ kind: "chord", tone: 0, octave: 0 }, A_AEOLIAN, am7, bass), 33)
    assert.equal(pitchToMidi({ kind: "chord", tone: 1, octave: 0 }, A_AEOLIAN, am7, bass), 36)
    assert.equal(pitchToMidi({ kind: "chord", tone: 2, octave: 0 }, A_AEOLIAN, am7, bass), 40)
    assert.equal(pitchToMidi({ kind: "chord", tone: 3, octave: 0 }, A_AEOLIAN, am7, bass), 43)
  })

  test("tone beyond the chord wraps up an octave; octave param adds 12 each", () => {
    assert.equal(pitchToMidi({ kind: "chord", tone: 4, octave: 0 }, A_AEOLIAN, am7, bass), 45) // root + 12
    assert.equal(pitchToMidi({ kind: "chord", tone: 0, octave: 1 }, A_AEOLIAN, am7, bass), 45)
    assert.equal(pitchToMidi({ kind: "chord", tone: 2, octave: 1 }, A_AEOLIAN, am7, bass), 52)
  })

  test("results are folded into range by octaves", () => {
    // 43 + 12 = 55 > 52 -> 43
    assert.equal(pitchToMidi({ kind: "chord", tone: 3, octave: 1 }, A_AEOLIAN, am7, bass), 43)
    for (const octave of [-3, -2, -1, 0, 1, 2, 3, 4])
      for (let tone = 0; tone < 8; tone++) {
        const m = pitchToMidi({ kind: "chord", tone, octave }, A_AEOLIAN, am7, bass)
        assert.ok(m >= 28 && m <= 52, `tone ${tone} octave ${octave} -> ${m}`)
        assert.ok(chordPitchClasses(A_AEOLIAN, am7).includes(mod12(m)), `tone ${tone} octave ${octave} -> ${m} not a chord tone`)
      }
  })

  test("root is the lowest note >= range.low with the chord root's pitch class", () => {
    const g = ch(5, { quality: "dom7" }) // E7 in A aeolian: root E, lowest >= 28 is 28
    assert.equal(pitchToMidi({ kind: "chord", tone: 0, octave: 0 }, A_AEOLIAN, g, bass), 28)
    assert.equal(pitchToMidi({ kind: "chord", tone: 2, octave: 0 }, A_AEOLIAN, g, bass), 35) // B above E
    const cKey = K(N("C"), "ionian")
    assert.equal(pitchToMidi({ kind: "chord", tone: 0, octave: 0 }, cKey, ch(5), bass), 31) // G
    assert.equal(pitchToMidi({ kind: "chord", tone: 2, octave: 0 }, cKey, ch(5), bass), 38) // D, fifth above 31
  })

  test("add9 tone is a ninth (14 semitones) above the root", () => {
    const key = K(N("C"), "ionian")
    assert.equal(pitchToMidi({ kind: "chord", tone: 3, octave: 0 }, key, ch(1, { quality: "add9" }), { low: 48, high: 90 }), 48 + 14)
  })

  test("scale degrees", () => {
    assert.equal(pitchToMidi({ kind: "scale", degree: 1, octave: 0, alter: 0 }, A_AEOLIAN, am7, bass), 33)
    assert.equal(pitchToMidi({ kind: "scale", degree: 6, octave: 0, alter: 0 }, A_AEOLIAN, am7, bass), 41) // F
    assert.equal(pitchToMidi({ kind: "scale", degree: 7, octave: 0, alter: 1 }, A_AEOLIAN, am7, bass), 44) // G#
    assert.equal(pitchToMidi({ kind: "scale", degree: 1, octave: 1, alter: 0 }, A_AEOLIAN, am7, bass), 45)
  })

  test("abs is unchanged, with no range folding", () => {
    assert.equal(pitchToMidi({ kind: "abs", midi: 21 }, A_AEOLIAN, am7, bass), 21)
    assert.equal(pitchToMidi({ kind: "abs", midi: 100 }, A_AEOLIAN, am7, bass), 100)
  })
})

// Independent enumeration of close-position candidates: every rotation of `pcs` (in the order given), stacked
// upward (each next note is the lowest note above the previous with the required pitch class).
function closeCandidates(pcs: number[], range: { low: number; high: number }): number[][] {
  const out: number[][] = []
  for (let r = 0; r < pcs.length; r++) {
    const order = [...pcs.slice(r), ...pcs.slice(0, r)]
    for (let start = range.low; start <= range.high; start++) {
      if (mod12(start) !== order[0]) continue
      const notes = [start]
      let ok = true
      for (let i = 1; i < order.length; i++) {
        let m = notes[i - 1] + 1
        while (mod12(m) !== order[i]) m++
        notes.push(m)
      }
      if (notes[notes.length - 1] > range.high) ok = false
      if (ok) out.push(notes)
    }
  }
  return out
}
const movement = (a: number[], b: number[]) => {
  const x = [...a].sort((p, q) => p - q)
  const y = [...b].sort((p, q) => p - q)
  return x.reduce((s, v, i) => s + Math.abs(v - y[i]), 0)
}

describe("voiceLead", () => {
  const range = { low: 52, high: 76 }

  test("pitch classes preserved, within range, ascending (all voicings)", () => {
    const r = makeRng(31)
    for (let n = 0; n < 300; n++) {
      const size = r.int(3, 4)
      const pcs: number[] = []
      while (pcs.length < size) {
        const p = r.int(0, 11)
        if (!pcs.includes(p)) pcs.push(p)
      }
      for (const voicing of ["close", "drop2", "spread"] as const) {
        const out = voiceLead(null, pcs, range, voicing)
        assert.equal(out.length, size, `${voicing} ${pcs}`)
        assert.deepEqual([...new Set(out.map(mod12))].sort((a, b) => a - b), [...pcs].sort((a, b) => a - b), `${voicing} ${pcs}`)
        for (let i = 0; i < out.length; i++) {
          assert.ok(out[i] >= range.low && out[i] <= range.high, `${voicing} ${pcs} -> ${out}`)
          if (i > 0) assert.ok(out[i] >= out[i - 1], `not ascending ${out}`)
        }
      }
    }
  })

  test("empty pcs -> []", () => {
    assert.deepEqual(voiceLead(null, [], range, "close"), [])
    assert.deepEqual(voiceLead([60, 64], [], range, "close"), [])
  })

  test("with prev: total movement <= every other close-position candidate (seeded property)", () => {
    const r = makeRng(2024)
    for (let n = 0; n < 200; n++) {
      const size = r.int(3, 4)
      const mk = () => {
        const pcs: number[] = []
        while (pcs.length < size) {
          const p = r.int(0, 11)
          if (!pcs.includes(p)) pcs.push(p)
        }
        return pcs.sort((a, b) => a - b) // ascending pcs: rotations are exactly the inversions
      }
      const prev = voiceLead(null, mk(), range, "close")
      const pcs = mk()
      const out = voiceLead(prev, pcs, range, "close")
      const cands = closeCandidates(pcs, range)
      assert.ok(cands.length > 0)
      const best = movement(out, prev)
      for (const c of cands) assert.ok(best <= movement(c, prev), `prev ${prev} pcs ${pcs}: got ${out} (${best}) but ${c} moves ${movement(c, prev)}`)
    }
  })

  test("prev null: closest to the range centre among close candidates", () => {
    const r = makeRng(7)
    const centre = (range.low + range.high) / 2
    const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length
    for (let n = 0; n < 100; n++) {
      const pcs: number[] = []
      while (pcs.length < 4) {
        const p = r.int(0, 11)
        if (!pcs.includes(p)) pcs.push(p)
      }
      pcs.sort((a, b) => a - b)
      const out = voiceLead(null, pcs, range, "close")
      for (const c of closeCandidates(pcs, range)) assert.ok(Math.abs(mean(out) - centre) <= Math.abs(mean(c) - centre) + 1e-9, `${pcs}: ${out} vs ${c}`)
    }
  })

  test("drop2 differs from close for 4-note chords, equals it for triads", () => {
    const cmaj7 = [0, 4, 7, 11]
    const close = voiceLead(null, cmaj7, range, "close")
    const drop2 = voiceLead(null, cmaj7, range, "drop2")
    assert.notDeepEqual(drop2, close)
    assert.ok(drop2[drop2.length - 1] - drop2[0] > close[close.length - 1] - close[0], "drop2 is wider than close")
    const triad = [0, 4, 7]
    assert.deepEqual(voiceLead(null, triad, range, "drop2"), voiceLead(null, triad, range, "close"))
  })

  test("a repeated chord keeps its voicing (zero movement)", () => {
    const first = voiceLead(null, [9, 0, 4, 7], range, "close")
    assert.deepEqual(voiceLead(first, [9, 0, 4, 7], range, "close"), first)
  })
})

describe("realizePart", () => {
  const keys: Key[] = [K(N("A"), "aeolian"), K(N("C"), "ionian"), K(N("F", 1), "lydian"), K(N("B", -1), "dorian"), K(N("E", -1), "mixolydian"), K(N("D"), "phrygian")]

  function randomHarmony(r: ReturnType<typeof makeRng>, key: Key): Harmony {
    const n = r.int(1, 8)
    return {
      key,
      beatsPerBar: 4,
      chords: Array.from({ length: n }, (_, i) => ({ start: i * 4, length: 4, chord: ch(r.int(1, 7) as Degree, { size: r.pick([3, 4] as const) }) })),
    }
  }

  test("every preset x 6 keys x 9 modes x random diatonic progressions: chord tones, in range, sorted", () => {
    const r = makeRng(99)
    let notes = 0
    for (const part of [...BASS_PARTS, ...KEYS_PARTS])
      for (const k of keys)
        for (const mode of MODES) {
          const key = K(k.tonic, mode)
          for (let rep = 0; rep < 2; rep++) {
            const h = randomHarmony(r, key)
            const loop = laneLength(h)
            const out = realizePart(part, h, loop)
            let expectedCount = 0
            for (let k = 0; k * part.lengthBeats < loop; k++) expectedCount += part.notes.filter((n) => k * part.lengthBeats + n.start < loop).length
            assert.equal(out.length, expectedCount, `${part.id}: note count`)
            for (let i = 0; i < out.length; i++) {
              const n = out[i]
              const slot = chordAt(h, n.start)
              const label = `${part.id} ${k.tonic.letter}${k.tonic.accidental} ${mode} beat ${n.start} midi ${n.midi}`
              assert.ok(chordPitchClasses(key, slot.chord).includes(mod12(n.midi)), `not a chord tone: ${label}`)
              assert.equal(n.role, "chord-tone", label)
              assert.ok(n.midi >= part.range.low && n.midi <= part.range.high, `out of range: ${label}`)
              if (i > 0) {
                const p = out[i - 1]
                assert.ok(p.start < n.start || (p.start === n.start && p.midi <= n.midi), `unsorted: ${label}`)
              }
              assert.ok(n.length > 0 && n.velocity > 0 && n.velocity <= 1)
              notes++
            }
          }
        }
    assert.ok(notes > 10000)
  })

  test("loop shorter than the part drops later notes; longer loop repeats it with unclipped lengths", () => {
    const bass = findPart("bass-pulse")!
    const h = demoHarmony()
    const four = realizePart(bass, h, 4)
    assert.equal(four.length, bass.notes.filter((n) => n.start < 4).length)
    for (const n of four) assert.ok(n.start < 4)
    const long = realizePart(bass, h, 32)
    assert.equal(long.length, bass.notes.length * 2)
    assert.equal(long[long.length - 1].start >= 16, true)
  })

  test("demo bass-walk first four midis are [33, 40, 45, 40]", () => {
    const out = realizePart(findPart("bass-walk")!, demoHarmony(), 16)
    assert.deepEqual(out.slice(0, 4).map((n) => n.midi), [33, 40, 45, 40])
  })

  test("A aeolian -> C aeolian transposes every realised bass note by +3 semitones", () => {
    for (const part of BASS_PARTS) {
      const a = demoHarmony()
      const c: Harmony = { ...a, key: K(N("C"), "aeolian") }
      const ra = realizePart(part, a, 16)
      const rc = realizePart(part, c, 16)
      assert.equal(rc.length, ra.length)
      for (let i = 0; i < ra.length; i++) {
        assert.equal(rc[i].start, ra[i].start)
        assert.equal(rc[i].midi - ra[i].midi, 3, `${part.id} note ${i}`)
      }
    }
  })

  test("roles: scale-tone / chromatic are assigned against the key", () => {
    // an "abs" note that is in the scale but not a chord tone, and one that is chromatic
    const h = demoHarmony() // A aeolian, Am7 first: B is scale-tone, A# is chromatic
    const part = {
      id: "t",
      name: "t",
      role: "melody" as const,
      range: { low: 48, high: 84 },
      voicing: "close" as const,
      lengthBeats: 4,
      notes: [
        { start: 0, length: 1, velocity: 1, pitch: { kind: "abs" as const, midi: 59 } }, // B
        { start: 1, length: 1, velocity: 1, pitch: { kind: "abs" as const, midi: 58 } }, // A#
        { start: 2, length: 1, velocity: 1, pitch: { kind: "abs" as const, midi: 57 } }, // A
      ],
    }
    const out = realizePart(part, h, 4)
    assert.deepEqual(out.map((n) => n.role), ["scale-tone", "chromatic", "chord-tone"])
    assert.ok(scalePitchClasses(h.key).includes(11))
    assert.equal(pitchClass(N("A")), 9)
  })

  test("chord parts are voice-led: consecutive stab groups move little", () => {
    const out = realizePart(findPart("keys-pad")!, demoHarmony(), 16)
    assert.equal(out.length, 16)
    const groups = [0, 1, 2, 3].map((b) => out.filter((n) => n.start === b * 4).map((n) => n.midi))
    for (let b = 1; b < 4; b++) {
      assert.equal(groups[b].length, 4)
      assert.ok(movement(groups[b], groups[b - 1]) <= 12, `bar ${b}: ${groups[b - 1]} -> ${groups[b]}`)
    }
  })
})
