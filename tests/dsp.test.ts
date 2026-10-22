import { test, describe } from "node:test"
import assert from "node:assert/strict"
import {
  computePeaks,
  driveCurve,
  driveMakeup,
  faderToGain,
  filterSettings,
  foldTail,
  isAudible,
  midiToHz,
  mixInto,
  mulberry32,
  peakLevel,
  reverbImpulse,
} from "../lib/audio/dsp.ts"

// Seeded xorshift32 (test-local; deliberately NOT dsp.mulberry32).
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
  return { next, int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)) }
}

const close = (a: number, b: number, tol: number, msg = "") =>
  assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} got ${a} (tol ${tol})`)

describe("mulberry32", () => {
  test("same seed -> same sequence; different seeds differ", () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    const c = mulberry32(43)
    const sa: number[] = []
    const sb: number[] = []
    const sc: number[] = []
    for (let i = 0; i < 100; i++) {
      sa.push(a())
      sb.push(b())
      sc.push(c())
    }
    assert.deepEqual(sa, sb)
    assert.notDeepEqual(sa, sc)
  })

  test("values in [0, 1) and roughly uniform", () => {
    for (const seed of [0, 1, 42, 0xffffffff, -5]) {
      const f = mulberry32(seed)
      let sum = 0
      const N = 20000
      for (let i = 0; i < N; i++) {
        const v = f()
        assert.ok(v >= 0 && v < 1, `seed ${seed}: ${v}`)
        sum += v
      }
      close(sum / N, 0.5, 0.02, `seed ${seed} mean`)
    }
  })

  test("matches the published mulberry32 algorithm (independent reference)", () => {
    const ref = (seed: number) => {
      let a = seed >>> 0
      return () => {
        a = (a + 0x6d2b79f5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
      }
    }
    const x = mulberry32(2024)
    const y = ref(2024)
    for (let i = 0; i < 50; i++) assert.equal(x(), y())
  })
})

describe("foldTail", () => {
  test("hand case [1..7], L=3 -> [12,7,9]", () => {
    const out = foldTail(Float32Array.from([1, 2, 3, 4, 5, 6, 7]), 3)
    assert.deepEqual(Array.from(out), [12, 7, 9])
  })

  test("no tail: copy of the input, and a NEW array", () => {
    const inp = Float32Array.from([1, 2, 3])
    const out = foldTail(inp, 3)
    assert.deepEqual(Array.from(out), [1, 2, 3])
    assert.notEqual(out, inp)
    assert.notEqual(out.buffer, inp.buffer)
  })

  test("random: length, sum preserved (incl. tails > 2 loops), input unchanged", () => {
    const r = makeRng(2468)
    for (let n = 0; n < 300; n++) {
      const L = r.int(1, 50)
      const total = L + r.int(0, 5 * L) // up to 5 extra loops of tail
      const inp = new Float32Array(total)
      for (let i = 0; i < total; i++) inp[i] = r.next() * 2 - 1
      const copy = Float32Array.from(inp)
      const out = foldTail(inp, L)
      assert.equal(out.length, L)
      assert.deepEqual(inp, copy, "input mutated")
      let sIn = 0
      for (const v of inp) sIn += v
      let sOut = 0
      for (const v of out) sOut += v
      close(sOut, sIn, 1e-4 * total, `L=${L} total=${total}`)
      // independent per-index check
      for (let i = 0; i < L; i++) {
        let e = 0
        for (let j = i; j < total; j += L) e += inp[j]
        close(out[i], e, 1e-4, `idx ${i}`)
      }
    }
  })

  test("random integers: exact sum", () => {
    const r = makeRng(11)
    for (let n = 0; n < 100; n++) {
      const L = r.int(1, 20)
      const total = L + r.int(0, 80)
      const inp = Float32Array.from({ length: total }, () => r.int(-100, 100))
      const out = foldTail(inp, L)
      assert.equal(
        out.reduce((a, b) => a + b, 0),
        inp.reduce((a, b) => a + b, 0),
      )
    }
  })

  test("RangeError on L < 1 and on rendered shorter than L", () => {
    assert.throws(() => foldTail(new Float32Array(4), 0), RangeError)
    assert.throws(() => foldTail(new Float32Array(4), -3), RangeError)
    assert.throws(() => foldTail(new Float32Array(2), 3), RangeError)
  })
})

describe("computePeaks", () => {
  test("hand cases", () => {
    assert.deepEqual(computePeaks(Float32Array.from([0.25, -0.5, 0.125, 0.75]), 2), [0.5, 0.75])
    assert.deepEqual(computePeaks(Float32Array.from([0.25, 0, 0, 0, -0.75]), 2), [0.25, 0.75])
    assert.deepEqual(computePeaks(Float32Array.from([0.25, -0.5, 0.125]), 1), [0.5])
    assert.deepEqual(computePeaks(Float32Array.from([0.25, -0.5, 0.125]), 3), [0.25, 0.5, 0.125])
  })

  test("bins > length -> length bins", () => {
    const p = computePeaks(Float32Array.from([0.5, -0.25]), 10)
    assert.deepEqual(p, [0.5, 0.25])
  })

  test("empty / bins < 1 -> []", () => {
    assert.deepEqual(computePeaks(new Float32Array(0), 8), [])
    assert.deepEqual(computePeaks(Float32Array.from([1, 2]), 0), [])
    assert.deepEqual(computePeaks(Float32Array.from([1, 2]), -1), [])
  })

  test("clamped to 1", () => {
    assert.deepEqual(computePeaks(Float32Array.from([2, -3]), 2), [1, 1])
    assert.deepEqual(computePeaks(Float32Array.from([-1.5, 0.2]), 1), [1])
  })

  test("random: length === min(bins, len), in [0,1], global max preserved", () => {
    const r = makeRng(555)
    for (let n = 0; n < 300; n++) {
      const len = r.int(1, 400)
      const bins = r.int(1, 500)
      const d = Float32Array.from({ length: len }, () => (r.next() * 2 - 1) * 1.2)
      const p = computePeaks(d, bins)
      assert.equal(p.length, Math.min(bins, len))
      for (const v of p) assert.ok(v >= 0 && v <= 1)
      let m = 0
      for (const v of d) m = Math.max(m, Math.abs(v))
      assert.equal(Math.max(...p), Math.min(1, m))
    }
  })
})

describe("peakLevel / faderToGain / midiToHz", () => {
  test("peakLevel", () => {
    assert.equal(peakLevel(new Float32Array(0)), 0)
    assert.equal(peakLevel(Float32Array.from([0.25, -0.75, 0.5])), 0.75)
    assert.equal(peakLevel(Float32Array.from([2, -3])), 3) // not clamped
  })

  test("faderToGain", () => {
    assert.equal(faderToGain(0), 0)
    assert.equal(faderToGain(0.5), 0.25)
    assert.equal(faderToGain(1), 1)
    assert.equal(faderToGain(2), 1)
    assert.equal(faderToGain(-1), 0)
    let prev = -1
    for (let v = 0; v <= 1.0001; v += 0.05) {
      const g = faderToGain(v)
      assert.ok(g >= prev)
      prev = g
    }
  })

  test("midiToHz", () => {
    close(midiToHz(69), 440, 1e-9)
    close(midiToHz(57), 220, 1e-9)
    close(midiToHz(81), 880, 1e-9)
    close(midiToHz(60), 261.6255653, 1e-6)
    close(midiToHz(0), 8.1757989, 1e-6)
  })
})

describe("filterSettings", () => {
  test("flat zone |x| < 0.02", () => {
    for (const x of [0, 0.01, -0.01, 0.0199, -0.0199]) {
      const f = filterSettings(x)
      assert.equal(f.lowpassHz, 20000)
      assert.equal(f.highpassHz, 10)
      assert.equal(f.q, 0.9)
    }
  })

  test("x = +-0.02 is already NOT flat (|x| < 0.02 is the flat zone)", () => {
    const lo = filterSettings(-0.02)
    close(lo.lowpassHz, 20000 * 0.01 ** 0.02, 1e-6)
    assert.ok(lo.lowpassHz < 20000)
    assert.equal(lo.highpassHz, 10)
    const hi = filterSettings(0.02)
    close(hi.highpassHz, 10 * 600 ** 0.02, 1e-6)
    assert.ok(hi.highpassHz > 10)
    assert.equal(hi.lowpassHz, 20000)
    for (const x of [0.0199, -0.0199]) {
      assert.equal(filterSettings(x).lowpassHz, 20000)
      assert.equal(filterSettings(x).highpassHz, 10)
    }
  })

  test("endpoints", () => {
    const lo = filterSettings(-1)
    close(lo.lowpassHz, 200, 1e-6)
    assert.equal(lo.highpassHz, 10)
    const hi = filterSettings(1)
    close(hi.highpassHz, 6000, 1e-6)
    assert.equal(hi.lowpassHz, 20000)
    assert.equal(lo.q, 0.9)
    assert.equal(hi.q, 0.9)
  })

  test("documented formulae at mid points", () => {
    close(filterSettings(-0.5).lowpassHz, 2000, 1e-6) // 20000 * 0.01^0.5
    close(filterSettings(0.5).highpassHz, 10 * Math.sqrt(600), 1e-6)
  })

  test("monotonic in x (lowpass and highpass both non-decreasing)", () => {
    let pl = -Infinity
    let ph = -Infinity
    for (let i = -100; i <= 100; i++) {
      const f = filterSettings(i / 100)
      assert.ok(f.lowpassHz >= pl, `lowpass dropped at ${i / 100}`)
      assert.ok(f.highpassHz >= ph, `highpass dropped at ${i / 100}`)
      pl = f.lowpassHz
      ph = f.highpassHz
    }
  })

  test("clamps beyond +-1", () => {
    assert.deepEqual(filterSettings(-7), filterSettings(-1))
    assert.deepEqual(filterSettings(7), filterSettings(1))
  })
})

describe("driveCurve / driveMakeup", () => {
  test("null below 0.01 (bypass)", () => {
    assert.equal(driveCurve(0), null)
    assert.equal(driveCurve(0.009), null)
    assert.equal(driveCurve(-1), null)
    assert.notEqual(driveCurve(0.01), null)
    assert.notEqual(driveCurve(1), null)
  })

  test("length param (default 2049)", () => {
    assert.equal(driveCurve(0.5)!.length, 2049)
    assert.equal(driveCurve(0.5, 101)!.length, 101)
    assert.equal(driveCurve(0.5, 3)!.length, 3)
  })

  test("ends -1/1, odd symmetry, monotonic, tanh(kx)/tanh(k)", () => {
    for (const amount of [0.01, 0.1, 0.5, 1]) {
      const n = 513
      const c = driveCurve(amount, n)!
      assert.equal(c[0], -1)
      assert.equal(c[n - 1], 1)
      const k = 1 + 15 * amount
      for (let i = 0; i < n; i++) {
        close(c[i], -c[n - 1 - i], 1e-6, `symmetry i=${i} amount=${amount}`)
        if (i > 0) assert.ok(c[i] >= c[i - 1], `non-monotonic at ${i}`)
        const x = (i / (n - 1)) * 2 - 1
        close(c[i], Math.tanh(k * x) / Math.tanh(k), 1e-6, `formula i=${i}`)
      }
      close(c[(n - 1) / 2], 0, 1e-7)
    }
  })

  test("driveMakeup", () => {
    assert.equal(driveMakeup(0), 1)
    close(driveMakeup(1), 0.25, 1e-12)
    close(driveMakeup(0.0667), 1 / Math.sqrt(1 + 15 * 0.0667), 1e-12)
    let prev = Infinity
    for (let a = 0; a <= 1.0001; a += 0.05) {
      const m = driveMakeup(a)
      assert.ok(m < prev)
      prev = m
    }
  })
})

describe("reverbImpulse", () => {
  const sr = 8000
  const [l, r] = reverbImpulse(sr, 1.5, 2, 7)

  test("length = round(seconds * sampleRate), two Float32 channels", () => {
    assert.equal(l.length, 12000)
    assert.equal(r.length, 12000)
    assert.ok(l instanceof Float32Array && r instanceof Float32Array)
    assert.equal(reverbImpulse(44100, 0.01, 1, 1)[0].length, 441)
    assert.equal(reverbImpulse(100, 0.015, 1, 1)[0].length, 2) // 1.5 -> 2
  })

  test("deterministic by seed; different seeds differ", () => {
    const [l2, r2] = reverbImpulse(sr, 1.5, 2, 7)
    assert.deepEqual(l, l2)
    assert.deepEqual(r, r2)
    const [l3] = reverbImpulse(sr, 1.5, 2, 8)
    assert.notDeepEqual(l, l3)
  })

  test("L and R differ; R of seed s is L of seed s+1 (seed + 1 for the right channel)", () => {
    assert.notDeepEqual(l, r)
    const [lNext] = reverbImpulse(sr, 1.5, 2, 8)
    assert.deepEqual(r, lNext)
  })

  test("values within [-1, 1]; envelope decays", () => {
    const mean = (a: Float32Array, from: number, to: number) => {
      let s = 0
      for (let i = from; i < to; i++) s += Math.abs(a[i])
      return s / (to - from)
    }
    const n = l.length
    const tenth = Math.floor(n / 10)
    for (const ch of [l, r]) {
      for (const v of ch) assert.ok(v >= -1 && v <= 1)
      const head = mean(ch, 0, tenth)
      const tail = mean(ch, n - tenth, n)
      assert.ok(head > 0.1, `head mean ${head}`)
      assert.ok(tail < head * 0.1, `tail ${tail} not << head ${head}`)
    }
  })
})

describe("isAudible", () => {
  const T = (muted: boolean, soloed: boolean) => ({ muted, soloed })
  test("four mute/solo combinations", () => {
    // no solos anywhere
    const a = T(false, false)
    const b = T(true, false)
    assert.equal(isAudible(a, [a, b]), true)
    assert.equal(isAudible(b, [a, b]), false)
    // another track soloed
    const solo = T(false, true)
    assert.equal(isAudible(a, [a, solo]), false)
    assert.equal(isAudible(solo, [a, solo]), true)
    // soloed but muted -> silent
    const sm = T(true, true)
    assert.equal(isAudible(sm, [a, sm]), false)
  })

  test("`all` only needs soloed", () => {
    assert.equal(isAudible({ muted: false, soloed: false }, [{ soloed: false }]), true)
    assert.equal(isAudible({ muted: false, soloed: false }, [{ soloed: true }]), false)
  })
})

describe("mixInto", () => {
  test("in place, adds, returns nothing", () => {
    const t = Float32Array.from([1, 2, 3])
    const s = Float32Array.from([10, 20, 30])
    const ret = mixInto(t, s)
    assert.equal(ret, undefined)
    assert.deepEqual(Array.from(t), [11, 22, 33])
    assert.deepEqual(Array.from(s), [10, 20, 30])
  })

  test("source shorter: rest of target untouched", () => {
    const t = Float32Array.from([1, 2, 3, 4])
    mixInto(t, Float32Array.from([10, 20]))
    assert.deepEqual(Array.from(t), [11, 22, 3, 4])
  })

  test("longer source: target keeps its length and gets the summed prefix", () => {
    const t = Float32Array.from([1, 2, 3])
    mixInto(t, Float32Array.from([1, 1, 1, 9, 9, 9]))
    assert.equal(t.length, 3)
    assert.deepEqual(Array.from(t), [2, 3, 4])
  })

  test("target shorter: no write past its end, source untouched", () => {
    const t = Float32Array.from([1, 2])
    const s = Float32Array.from([10, 20, 30, 40])
    mixInto(t, s)
    assert.deepEqual(Array.from(t), [11, 22])
    assert.deepEqual(Array.from(s), [10, 20, 30, 40])
  })
})
