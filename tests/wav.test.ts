import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { encodeWav16 } from "../lib/audio/wav.ts"

// Seeded xorshift32.
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

// Independent minimal RIFF/WAVE parser (strict canonical 44-byte layout).
interface Parsed {
  riff: string
  chunkSize: number
  wave: string
  fmtTag: string
  fmtSize: number
  format: number
  channels: number
  sampleRate: number
  byteRate: number
  blockAlign: number
  bits: number
  dataTag: string
  dataBytes: number
  byteLength: number
  samples: Int16Array // interleaved
}
function parse(buf: ArrayBuffer): Parsed {
  const dv = new DataView(buf)
  const tag = (o: number) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3))
  const dataBytes = dv.getUint32(40, true)
  const samples = new Int16Array(dataBytes / 2)
  for (let i = 0; i < samples.length; i++) samples[i] = dv.getInt16(44 + i * 2, true)
  return {
    riff: tag(0),
    chunkSize: dv.getUint32(4, true),
    wave: tag(8),
    fmtTag: tag(12),
    fmtSize: dv.getUint32(16, true),
    format: dv.getUint16(20, true),
    channels: dv.getUint16(22, true),
    sampleRate: dv.getUint32(24, true),
    byteRate: dv.getUint32(28, true),
    blockAlign: dv.getUint16(32, true),
    bits: dv.getUint16(34, true),
    dataTag: tag(36),
    dataBytes,
    byteLength: buf.byteLength,
    samples,
  }
}

describe("encodeWav16 header", () => {
  for (const [nch, rate] of [
    [1, 44100],
    [2, 48000],
    [2, 8000],
    [1, 22050],
  ] as const) {
    test(`${nch} channel(s) @ ${rate} Hz`, () => {
      const n = 37
      const chans = Array.from({ length: nch }, () => new Float32Array(n))
      const p = parse(encodeWav16(chans, rate))
      const dataBytes = n * nch * 2
      assert.equal(p.riff, "RIFF")
      assert.equal(p.chunkSize, 36 + dataBytes)
      assert.equal(p.wave, "WAVE")
      assert.equal(p.fmtTag, "fmt ")
      assert.equal(p.fmtSize, 16)
      assert.equal(p.format, 1)
      assert.equal(p.channels, nch)
      assert.equal(p.sampleRate, rate)
      assert.equal(p.byteRate, rate * nch * 2)
      assert.equal(p.blockAlign, nch * 2)
      assert.equal(p.bits, 16)
      assert.equal(p.dataTag, "data")
      assert.equal(p.dataBytes, dataBytes)
      assert.equal(p.byteLength, 44 + dataBytes)
    })
  }

  test("empty channels give a valid header-only file", () => {
    const p = parse(encodeWav16([new Float32Array(0)], 44100))
    assert.equal(p.byteLength, 44)
    assert.equal(p.chunkSize, 36)
    assert.equal(p.dataBytes, 0)
  })
})

describe("encodeWav16 samples", () => {
  test("conversion table (mono)", () => {
    const input = Float32Array.from([0, 1, -1, 0.5, -0.5, 1.5, -1.5, 100, -100])
    const p = parse(encodeWav16([input], 48000))
    assert.deepEqual(Array.from(p.samples), [0, 32767, -32768, 16384, -16384, 32767, -32768, 32767, -32768])
  })

  test("interleaving order is L then R", () => {
    const L = Float32Array.from([1, 0.5, 0])
    const R = Float32Array.from([-1, -0.5, 0.25])
    const p = parse(encodeWav16([L, R], 44100))
    assert.deepEqual(Array.from(p.samples), [32767, -32768, 16384, -16384, 0, 8192])
  })

  test("round trip (random stereo): max error within quantisation bound", () => {
    const r = makeRng(8675309)
    const n = 5000
    const L = Float32Array.from({ length: n }, () => r.next() * 2 - 1)
    const R = Float32Array.from({ length: n }, () => r.next() * 2 - 1)
    L[0] = 1
    R[0] = -1
    L[1] = 0
    const p = parse(encodeWav16([L, R], 48000))
    assert.equal(p.samples.length, 2 * n)
    let maxDiv32768 = 0 // naive decode: v / 32768
    let maxAsym = 0 // inverse of the documented conversion
    for (let i = 0; i < n; i++) {
      for (const [c, src] of [
        [0, L],
        [1, R],
      ] as const) {
        const v = p.samples[2 * i + c]
        maxDiv32768 = Math.max(maxDiv32768, Math.abs(v / 32768 - src[i]))
        maxAsym = Math.max(maxAsym, Math.abs((v < 0 ? v / 32768 : v / 32767) - src[i]))
      }
    }
    // Inverse of the documented scaling: half an LSB (+ float32 slop).
    assert.ok(maxAsym <= 0.5 / 32767 + 1e-9, `asymmetric-decode error ${maxAsym}`)
    // The naive /32768 decode is off by up to 1.5 LSB-of-32768 because of the 32767/32768 scaling.
    assert.ok(maxDiv32768 <= 1.5 / 32768 + 1e-9, `naive-decode error ${maxDiv32768}`)
  })

  test("round trip (mono) bound is also met", () => {
    const r = makeRng(42)
    const x = Float32Array.from({ length: 2000 }, () => r.next() * 2 - 1)
    const p = parse(encodeWav16([x], 22050))
    for (let i = 0; i < x.length; i++) {
      const v = p.samples[i]
      assert.ok(Math.abs((v < 0 ? v / 32768 : v / 32767) - x[i]) <= 0.5 / 32767 + 1e-9)
    }
  })
})

describe("encodeWav16 errors", () => {
  test("RangeError on 0 or 3 channels", () => {
    assert.throws(() => encodeWav16([], 44100), RangeError)
    const c = new Float32Array(4)
    assert.throws(() => encodeWav16([c, c, c], 44100), RangeError)
  })

  test("RangeError on unequal lengths", () => {
    assert.throws(() => encodeWav16([new Float32Array(4), new Float32Array(5)], 44100), RangeError)
    assert.throws(() => encodeWav16([new Float32Array(5), new Float32Array(4)], 44100), RangeError)
  })
})
