import { test, describe } from "node:test"
import assert from "node:assert/strict"
import {
  captureWindow,
  dottedEighthSeconds,
  loopFrameCount,
  loopOffset,
  loopPhase,
  nextBoundary,
  secondsToFrames,
  stepFrame,
} from "../lib/audio/timing.ts"

// Seeded xorshift32 (test-local; never Math.random).
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
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
  }
}

// Independent true modulo.
const mod = (a: number, n: number) => ((a % n) + n) % n

describe("loopFrameCount", () => {
  test("hand-computed cases", () => {
    assert.equal(loopFrameCount(120, 1, 48000), 96000)
    assert.equal(loopFrameCount(92, 4, 48000), 500869)
    assert.equal(loopFrameCount(92, 4, 44100), 460173)
    assert.equal(loopFrameCount(97, 1, 48000), 118762)
    assert.equal(loopFrameCount(60, 1, 8000), 32000)
  })

  test("rounds to nearest (.5 rounds up, just below rounds down)", () => {
    // 1 bar @ 96 bpm = 2.5 s; at 1 Hz sampleRate exact value is 2.5 frames
    assert.equal(loopFrameCount(96, 1, 1), 3)
    // 1 bar @ 120 bpm = 2 s; sampleRate 1.2 -> 2.4 -> 2 ; 1.3 -> 2.6 -> 3
    assert.equal(loopFrameCount(120, 1, 1.2), 2)
    assert.equal(loopFrameCount(120, 1, 1.3), 3)
  })

  test("never less than 1", () => {
    assert.equal(loopFrameCount(180, 1, 0.1), 1)
    assert.equal(loopFrameCount(180, 1, 0), 1)
  })

  test("property: round-trip, closeness, nearest, Math.round kept when valid (seeded)", () => {
    const r = makeRng(20261022)
    const rates = [44100, 48000, 96000]
    const barOpts = [1, 2, 4]
    const rt = (n: number, sr: number) => (n / sr) * sr === n
    for (let i = 0; i < 1500; i++) {
      const bpm = 60 + r.next() * 120
      const bars = barOpts[r.int(0, 2)]
      const sr = rates[r.int(0, 2)]
      const exact = ((bars * 4 * 60) / bpm) * sr
      const L = loopFrameCount(bpm, bars, sr)
      const msg = `bpm=${bpm} bars=${bars} sr=${sr} L=${L} exact=${exact}`
      assert.ok(Number.isInteger(L), msg)
      assert.ok(rt(L, sr), `does not round-trip: ${msg}`)
      assert.ok(Math.abs(L - exact) <= 64, `too far: ${msg}`)
      const dL = Math.abs(L - exact)
      for (let n = Math.floor(exact) - 70; n <= Math.ceil(exact) + 70; n++) {
        if (n >= 1 && Math.abs(n - exact) < dL) assert.ok(!rt(n, sr), `closer round-tripping ${n}: ${msg}`)
      }
      if (rt(Math.round(exact), sr)) assert.equal(L, Math.round(exact), msg)
    }
  })

  test("beatsPerBar parameter", () => {
    assert.equal(loopFrameCount(120, 1, 48000, 3), 72000)
    assert.equal(loopFrameCount(120, 2, 48000, 3), 144000)
    assert.equal(loopFrameCount(60, 1, 1000, 7), 7000)
  })
})

describe("stepFrame", () => {
  test("hand cases", () => {
    assert.equal(stepFrame(4, 96000, 16), 24000)
    assert.equal(stepFrame(1, 500869, 16), 31304) // 31304.3125
    assert.equal(stepFrame(3, 500869, 16), 93913) // 93912.9375
    assert.equal(stepFrame(1, 10, 4), 3) // 2.5 -> 3
  })

  test("random: endpoints, monotonic, grid is even", () => {
    const r = makeRng(12345)
    const totals = [4, 8, 12, 16, 32, 48, 64, 7, 13]
    for (let n = 0; n < 300; n++) {
      const L = r.int(1000, 700000)
      const total = totals[r.int(0, totals.length - 1)]
      assert.equal(stepFrame(0, L, total), 0)
      assert.equal(stepFrame(total, L, total), L)
      let prev = 0
      let minD = Infinity
      let maxD = -Infinity
      for (let s = 1; s <= total; s++) {
        const f = stepFrame(s, L, total)
        assert.ok(f >= prev, `non-monotonic L=${L} total=${total} s=${s}`)
        const d = f - prev
        minD = Math.min(minD, d)
        maxD = Math.max(maxD, d)
        prev = f
      }
      assert.ok(maxD - minD <= 1, `uneven grid L=${L} total=${total}: ${minD}..${maxD}`)
    }
  })
})

describe("loopOffset / loopPhase", () => {
  test("hand cases", () => {
    assert.equal(loopOffset(10, 0, 4), 2)
    assert.equal(loopOffset(-1, 0, 4), 3)
    assert.equal(loopOffset(5, 10, 4), 3) // 5 is 5 frames before start
    assert.equal(loopOffset(10, 10, 4), 0)
    assert.equal(loopPhase(1, 0, 4), 0.25)
    assert.equal(loopPhase(3, 0, 4), 0.75)
  })

  test("random: range, phase range, periodicity", () => {
    const r = makeRng(777)
    for (let n = 0; n < 2000; n++) {
      const L = r.int(1, 700000)
      const start = r.int(-200000, 200000)
      const f = r.int(-3_000_000, 3_000_000)
      const o = loopOffset(f, start, L)
      assert.ok(Number.isInteger(o) && o >= 0 && o < L, `offset ${o} out of [0,${L})`)
      assert.equal(o, mod(f - start, L))
      const p = loopPhase(f, start, L)
      assert.ok(p >= 0 && p < 1, `phase ${p}`)
      assert.equal(p, o / L)
      const k = r.int(-5, 5)
      assert.equal(loopOffset(f + k * L, start, L), o)
    }
  })

  test("before startFrame is never negative", () => {
    assert.equal(loopOffset(-1_000_000, 500, 96000), mod(-1_000_500, 96000))
    assert.ok(loopOffset(-1_000_000, 500, 96000) >= 0)
  })
})

describe("nextBoundary", () => {
  test("hand cases", () => {
    assert.equal(nextBoundary(0, 0, 100, 0), 0) // exactly on a boundary, lead 0 -> itself
    assert.equal(nextBoundary(1, 0, 100, 0), 100)
    assert.equal(nextBoundary(50, 0, 100, 60), 200) // 110 -> next is 200
    assert.equal(nextBoundary(-250, 0, 100, 0), -200)
    assert.equal(nextBoundary(130, 30, 100, 0), 130) // 130 = 30 + 100
    assert.equal(nextBoundary(130, 30, 100, 1), 230)
  })

  test("random: congruent, >= frame+lead, and the FIRST such", () => {
    const r = makeRng(99)
    for (let n = 0; n < 3000; n++) {
      const L = r.int(1000, 700000)
      const start = r.int(-100000, 100000)
      const frame = r.int(-1_000_000, 1_000_000)
      const lead = r.int(0, 20000)
      const b = nextBoundary(frame, start, L, lead)
      assert.equal(mod(b - start, L), 0, "not on the loop grid")
      assert.ok(b >= frame + lead, `boundary ${b} < frame+lead ${frame + lead}`)
      assert.ok(b - L < frame + lead, `boundary ${b} is not the first (previous ${b - L} also qualifies)`)
    }
  })

  test("exact boundary with lead 0 returns itself (random)", () => {
    const r = makeRng(5)
    for (let n = 0; n < 200; n++) {
      const L = r.int(1000, 700000)
      const start = r.int(-100000, 100000)
      const k = r.int(-10, 10)
      const frame = start + k * L
      assert.equal(nextBoundary(frame, start, L, 0), frame)
    }
  })
})

describe("captureWindow", () => {
  test("hand case", () => {
    assert.deepEqual(captureWindow(1000, 500, 30), { from: 1030, to: 1530 })
    assert.deepEqual(captureWindow(1000, 500, -30), { from: 970, to: 1470 })
  })

  test("random: length is exactly L, from = boundary + latency", () => {
    const r = makeRng(31337)
    for (let n = 0; n < 1000; n++) {
      const L = r.int(1, 700000)
      const boundary = r.int(-1_000_000, 1_000_000)
      const lat = r.int(-20000, 20000)
      const w = captureWindow(boundary, L, lat)
      assert.equal(w.to - w.from, L)
      assert.equal(w.from, boundary + lat)
    }
  })
})

describe("secondsToFrames / dottedEighthSeconds", () => {
  test("secondsToFrames", () => {
    assert.equal(secondsToFrames(0.5, 48000), 24000)
    assert.equal(secondsToFrames(1.00001, 44100), 44100) // 44100.441
    assert.equal(secondsToFrames(1.5, 1), 2) // .5 rounds up
    assert.equal(secondsToFrames(0, 48000), 0)
    assert.equal(secondsToFrames(0.0000113, 44100), 0) // 0.498
    assert.equal(secondsToFrames(0.0000114, 44100), 1) // 0.503
  })

  test("dottedEighthSeconds = 0.75 beat", () => {
    assert.equal(dottedEighthSeconds(60), 0.75)
    assert.equal(dottedEighthSeconds(90), 0.5)
    assert.equal(dottedEighthSeconds(120), 0.375)
    assert.ok(Math.abs(dottedEighthSeconds(92) - 0.75 * (60 / 92)) < 1e-12)
  })
})
