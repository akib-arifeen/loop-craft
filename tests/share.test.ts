import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { decodeShare, encodeShare } from "../lib/audio/share.ts"
import { demoTracks } from "../lib/audio/patterns.ts"
import { BASS_PARTS, KEYS_PARTS } from "../lib/harmony/presets.ts"
import { BAR_OPTIONS, DRUM_VOICES, MAX_BPM, MAX_TRACKS, MIN_BPM, STEPS_PER_BAR } from "../lib/audio/types.ts"
import type { Bars, DrumPattern, ShareData } from "../lib/audio/types.ts"

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
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(a: readonly T[]): T => a[Math.floor(next() * a.length)],
    bool: () => next() < 0.5,
  }
}

type ST = ShareData["tracks"][number]

const b64 = (obj: unknown) => Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj), "utf8").toString("base64url")
const lane = (s = "0000000000000000") => s
const rawTrack = (over: Record<string, unknown> = {}) => ({
  id: "t1",
  k: "drums",
  n: "Drums",
  v: 0.5,
  p: 0,
  m: false,
  s: false,
  f: [0, 0, 0, 0],
  d: [lane(), lane(), lane(), lane()],
  ...over,
})
const rawDoc = (t: unknown[], over: Record<string, unknown> = {}) => ({ v: 1, bpm: 92, bars: 4, t, ...over })

function demoShare(): ShareData {
  const tracks: ST[] = demoTracks()
    .filter((t) => t.kind !== "audio")
    .map((t) => {
      const o: ST = { id: t.id, kind: t.kind, name: t.name, volume: t.volume, pan: t.pan, muted: t.muted, soloed: t.soloed, fx: { ...t.fx } }
      if (t.drumPattern) o.drumPattern = t.drumPattern
      if (t.patternId !== undefined) o.patternId = t.patternId
      return o
    })
  return { v: 1, bpm: 92, bars: 4, tracks }
}

// Independent validity predicate for decode results.
function assertValidShare(d: ShareData) {
  assert.equal(d.v, 1)
  assert.ok(Number.isFinite(d.bpm) && d.bpm >= MIN_BPM && d.bpm <= MAX_BPM)
  assert.ok((BAR_OPTIONS as readonly number[]).includes(d.bars))
  assert.ok(d.tracks.length <= MAX_TRACKS)
  for (const t of d.tracks) {
    assert.ok(["drums", "bass", "keys"].includes(t.kind))
    assert.equal(typeof t.id, "string")
    assert.ok(t.name.length <= 24)
    assert.ok(t.volume >= 0 && t.volume <= 1)
    assert.ok(t.pan >= -1 && t.pan <= 1)
    assert.equal(typeof t.muted, "boolean")
    assert.equal(typeof t.soloed, "boolean")
    assert.ok(t.fx.filter >= -1 && t.fx.filter <= 1)
    for (const k of ["drive", "delay", "reverb"] as const) assert.ok(t.fx[k] >= 0 && t.fx[k] <= 1)
    if (t.drumPattern) {
      for (const v of DRUM_VOICES) {
        assert.equal(t.drumPattern[v].length, STEPS_PER_BAR)
        for (const c of t.drumPattern[v]) assert.ok(c === 0 || c === 1 || c === 2)
      }
    }
    if (t.kind === "bass" || t.kind === "keys") assert.equal(typeof t.patternId, "string")
  }
}

function randomShare(r: ReturnType<typeof makeRng>): ShareData {
  const alphabet = ["a", "Z", "0", " ", "é", "–", "✓", '"', "\\", "/", "+", "?", ">", "~", "ß", "日"]
  const bars = r.pick(BAR_OPTIONS) as Bars
  const n = r.int(1, 8)
  const tracks: ST[] = []
  for (let i = 0; i < n; i++) {
    const kind = r.pick(["drums", "bass", "keys"] as const)
    const nameLen = r.int(0, 24)
    let name = ""
    for (let j = 0; j < nameLen; j++) name += r.pick(alphabet)
    const t: ST = {
      id: `trk-${i}-${r.int(0, 99999)}`,
      kind,
      name,
      volume: r.next(),
      pan: r.next() * 2 - 1,
      muted: r.bool(),
      soloed: r.bool(),
      fx: { filter: r.next() * 2 - 1, drive: r.next(), delay: r.next(), reverb: r.next() },
    }
    if (kind === "drums") {
      const dp = {} as DrumPattern
      for (const v of DRUM_VOICES) dp[v] = Array.from({ length: STEPS_PER_BAR }, () => r.int(0, 2))
      t.drumPattern = dp
    } else {
      t.patternId = r.pick(kind === "bass" ? BASS_PARTS : KEYS_PARTS).id
    }
    tracks.push(t)
  }
  return { v: 1, bpm: MIN_BPM + r.next() * (MAX_BPM - MIN_BPM), bars, tracks }
}

describe("round trip", () => {
  test("demo synth tracks at 92 bpm / 4 bars", () => {
    const d = demoShare()
    assert.equal(d.tracks.length, 3)
    assert.deepStrictEqual(decodeShare(encodeShare(d)), d)
  })

  test("200 seeded random valid ShareData round-trip exactly", () => {
    const r = makeRng(20260101)
    for (let i = 0; i < 200; i++) {
      const d = randomShare(r)
      const code = encodeShare(d)
      assert.deepStrictEqual(decodeShare(code), d, `case ${i}`)
    }
  })

  test("audio tracks are not written", () => {
    const d = demoShare()
    const withAudio: ShareData = {
      ...d,
      tracks: [
        ...d.tracks,
        { id: "loop-a", kind: "audio", name: "Loop A", volume: 0.85, pan: 0, muted: false, soloed: false, fx: { filter: 0, drive: 0, delay: 0.1, reverb: 0.15 } },
      ],
    }
    assert.deepStrictEqual(decodeShare(encodeShare(withAudio)), d)
  })

  test("empty track list is valid", () => {
    const d: ShareData = { v: 1, bpm: 100, bars: 2, tracks: [] }
    assert.deepStrictEqual(decodeShare(encodeShare(d)), d)
  })
})

describe("URL safety", () => {
  test("code matches /^[A-Za-z0-9_-]*$/ (no padding, no + or /)", () => {
    const re = /^[A-Za-z0-9_-]*$/
    assert.match(encodeShare(demoShare()), re)
    const r = makeRng(9)
    for (let i = 0; i < 100; i++) assert.match(encodeShare(randomShare(r)), re)
    // names engineered to produce + and / in standard base64, at every padding alignment
    for (let len = 0; len < 8; len++) {
      const d = demoShare()
      d.tracks[0].name = "??>>~~??>>".slice(0, len)
      const code = encodeShare(d)
      assert.match(code, re)
      assert.deepStrictEqual(decodeShare(code), d)
    }
  })
})

describe("decodeShare rejects malformed input with null", () => {
  const cases: Array<[string, string]> = [
    ["empty string", ""],
    ["garbage!!", "garbage!!"],
    ["valid base64 of non-JSON", b64("this is not json")],
    ["v: 2", b64(rawDoc([], { v: 2 }))],
    ["v missing", b64({ bpm: 92, bars: 4, t: [] })],
    ["drum lane of 15 digits", b64(rawDoc([rawTrack({ d: [lane("000000000000000"), lane(), lane(), lane()] })]))],
    ["drum lane of 17 digits", b64(rawDoc([rawTrack({ d: [lane("00000000000000000"), lane(), lane(), lane()] })]))],
    ["drum lane containing 3", b64(rawDoc([rawTrack({ d: [lane("0000000000000003"), lane(), lane(), lane()] })]))],
    ["drum lane with a letter", b64(rawDoc([rawTrack({ d: [lane("000000000000000x"), lane(), lane(), lane()] })]))],
    ["only 3 drum lanes", b64(rawDoc([rawTrack({ d: [lane(), lane(), lane()] })]))],
    ["bass without patternId", b64(rawDoc([rawTrack({ k: "bass", d: undefined })]))],
    ["keys without patternId", b64(rawDoc([rawTrack({ k: "keys", d: undefined })]))],
    ["unknown kind", b64(rawDoc([rawTrack({ k: "synth" })]))],
    ["audio kind", b64(rawDoc([rawTrack({ k: "audio" })]))],
    ["9 tracks", b64(rawDoc(Array.from({ length: 9 }, (_, i) => rawTrack({ id: `t${i}` }))))],
    ["fx with 3 entries", b64(rawDoc([rawTrack({ f: [0, 0, 0] })]))],
    ["non-numeric bpm", b64(rawDoc([], { bpm: "92" }))],
    ["t not an array", b64(rawDoc([], { t: {} }))],
    ["JSON array at top level", b64([1, 2, 3])],
    ["JSON null", b64("null")],
  ]
  for (const [name, code] of cases) {
    test(name, () => {
      assert.equal(decodeShare(code), null)
    })
  }

  test("sanity: 8 tracks and a well-formed doc are accepted", () => {
    const ok = decodeShare(b64(rawDoc(Array.from({ length: 8 }, (_, i) => rawTrack({ id: `t${i}` })))))
    assert.ok(ok)
    assert.equal(ok.tracks.length, 8)
  })

  test("500 seeded random corruptions of a valid code: null or valid ShareData, never a throw", () => {
    const valid = encodeShare(demoShare())
    const r = makeRng(424242)
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
    const junk = ["!", "=", "+", "/", " ", "é", "\n", "%", "\u0000"]
    let nulls = 0
    let valids = 0
    for (let i = 0; i < 500; i++) {
      let s = valid
      const edits = r.int(1, 4)
      for (let e = 0; e < edits; e++) {
        const pos = r.int(0, Math.max(0, s.length - 1))
        switch (r.int(0, 5)) {
          case 0:
            s = s.slice(0, pos) + r.pick(chars.split("")) + s.slice(pos + 1)
            break
          case 1:
            s = s.slice(0, pos) + s.slice(pos + 1)
            break
          case 2:
            s = s.slice(0, pos) + r.pick(chars.split("")) + s.slice(pos)
            break
          case 3:
            s = s.slice(0, pos)
            break
          case 4:
            s = s.slice(0, pos) + r.pick(junk) + s.slice(pos + 1)
            break
          default: {
            const q = r.int(0, s.length - 1)
            const a = s.split("")
            ;[a[pos], a[q]] = [a[q], a[pos]]
            s = a.join("")
          }
        }
      }
      let out: ShareData | null = null
      assert.doesNotThrow(() => {
        out = decodeShare(s)
      }, `threw on corruption ${i}: ${JSON.stringify(s)}`)
      if (out === null) nulls++
      else {
        valids++
        assertValidShare(out)
      }
    }
    assert.ok(nulls > 0, "expected at least some corruptions to be rejected")
    assert.equal(nulls + valids, 500)
  })
})

describe("decodeShare charset", () => {
  const valid = encodeShare(demoShare())
  test("space, newline, trailing '=' inside/after a valid code -> null", () => {
    assert.ok(decodeShare(valid))
    const mid = Math.floor(valid.length / 2)
    assert.equal(decodeShare(valid.slice(0, mid) + " " + valid.slice(mid)), null)
    assert.equal(decodeShare(valid.slice(0, mid) + "\n" + valid.slice(mid)), null)
    assert.equal(decodeShare(valid + "\n"), null)
    assert.equal(decodeShare(valid + "="), null)
    assert.equal(decodeShare(" " + valid), null)
  })

  test("standard-alphabet (+ and /, padded) variant -> null when it differs", () => {
    const doc = rawDoc([rawTrack({ n: "???>>>~~~" })])
    const std = Buffer.from(JSON.stringify(doc), "utf8").toString("base64")
    assert.ok(/[+/=]/.test(std), "test setup: standard variant must differ from base64url")
    assert.ok(decodeShare(b64(doc)), "url-safe variant must decode")
    assert.equal(decodeShare(std), null)
    const plusSlashOnly = std.replace(/=+$/, "")
    if (/[+/]/.test(plusSlashOnly)) assert.equal(decodeShare(plusSlashOnly), null)
  })
})

describe("decodeShare size and id rules", () => {
  const dec = (t: unknown[], over: Record<string, unknown> = {}) => decodeShare(b64(rawDoc(t, over)))

  test("code longer than 4096 chars -> null", () => {
    assert.equal(decodeShare("A".repeat(5000)), null)
    // otherwise-valid document padded past the limit
    const big = b64(rawDoc([rawTrack()], { pad: "a".repeat(5000) }))
    assert.ok(big.length > 4096)
    assert.equal(decodeShare(big), null)
  })

  test("empty id -> null", () => {
    assert.equal(dec([rawTrack({ id: "" })]), null)
  })

  test("id length: 64 ok, 65 -> null", () => {
    assert.ok(dec([rawTrack({ id: "a".repeat(64) })]))
    assert.equal(dec([rawTrack({ id: "a".repeat(65) })]), null)
  })

  test("id outside /^[A-Za-z0-9_-]+$/ -> null", () => {
    for (const id of ["a b", "a.b", "a/b", "é", "a\n", "<x>"]) assert.equal(dec([rawTrack({ id })]), null, JSON.stringify(id))
    for (const id of ["a-b_C9", "__proto__", "0"]) assert.ok(dec([rawTrack({ id })]), id)
  })

  test("duplicate ids within one code -> null", () => {
    assert.equal(dec([rawTrack({ id: "x" }), rawTrack({ id: "x" })]), null)
    assert.equal(dec([rawTrack({ id: "x" }), rawTrack({ id: "y" }), rawTrack({ id: "x" })]), null)
    assert.ok(dec([rawTrack({ id: "x" }), rawTrack({ id: "y" })]))
  })

  test("valid demo data still round-trips", () => {
    const d = demoShare()
    assert.deepStrictEqual(decodeShare(encodeShare(d)), d)
  })
})

describe("decodeShare pattern presets match parseProject", () => {
  const dec = (t: unknown[]) => decodeShare(b64(rawDoc(t)))

  test("a preset from the other family is rejected", () => {
    assert.equal(dec([rawTrack({ id: "k", k: "keys", d: undefined, pid: "bass-pulse" })]), null)
    assert.equal(dec([rawTrack({ id: "b", k: "bass", d: undefined, pid: "keys-stabs" })]), null)
    assert.equal(dec([rawTrack({ id: "k", k: "keys", d: undefined, pid: "bass-sub" })]), null)
  })

  test("an unknown preset id is rejected instead of falling back", () => {
    assert.equal(dec([rawTrack({ id: "k", k: "keys", d: undefined, pid: "keys-nope" })]), null)
    assert.equal(dec([rawTrack({ id: "b", k: "bass", d: undefined, pid: "nope" })]), null)
  })

  test("a preset of the track's own kind is kept", () => {
    const keys = dec([rawTrack({ id: "k", k: "keys", d: undefined, pid: "keys-arp" })])!
    assert.equal(keys.tracks[0].patternId, "keys-arp")
    const bass = dec([rawTrack({ id: "b", k: "bass", d: undefined, pid: "bass-walk" })])!
    assert.equal(bass.tracks[0].patternId, "bass-walk")
  })

  test("pid on a drums or sample track is ignored, as parseProject ignores patternId", () => {
    const drums = dec([rawTrack({ pid: "bass-pulse" })])!.tracks[0]
    assert.equal("patternId" in drums, false)
    const sample = dec([rawTrack({ k: "sample", d: undefined, sid: "keys-am7-rhodes", pid: "keys-pad" })])!.tracks[0]
    assert.equal("patternId" in sample, false)
    assert.equal(sample.sampleId, "keys-am7-rhodes")
  })
})

describe("decodeShare clamping", () => {
  const decodeDoc = (t: unknown[], over: Record<string, unknown> = {}) => decodeShare(b64(rawDoc(t, over)))!

  test("bpm clamps to MIN_BPM..MAX_BPM", () => {
    assert.equal(decodeDoc([], { bpm: 500 }).bpm, MAX_BPM)
    assert.equal(decodeDoc([], { bpm: 1 }).bpm, MIN_BPM)
    assert.equal(decodeDoc([], { bpm: -40 }).bpm, MIN_BPM)
    assert.equal(decodeDoc([], { bpm: 100.5 }).bpm, 100.5)
  })

  test("bars snap to nearest of 1/2/4 (tie -> larger)", () => {
    assert.equal(decodeDoc([], { bars: 3 }).bars, 4)
    assert.equal(decodeDoc([], { bars: 1.4 }).bars, 1)
    assert.equal(decodeDoc([], { bars: 1.6 }).bars, 2)
    assert.equal(decodeDoc([], { bars: 0 }).bars, 1)
    assert.equal(decodeDoc([], { bars: 100 }).bars, 4)
    assert.equal(decodeDoc([], { bars: 2 }).bars, 2)
  })

  test("volume, pan, fx, name", () => {
    const t = decodeDoc([rawTrack({ v: 2, p: -5, f: [9, -3, 7, -1], n: "x".repeat(40) })]).tracks[0]
    assert.equal(t.volume, 1)
    assert.equal(t.pan, -1)
    assert.deepEqual(t.fx, { filter: 1, drive: 0, delay: 1, reverb: 0 })
    assert.equal(t.name, "x".repeat(24))
    const u = decodeDoc([rawTrack({ v: -2, p: 5, f: [-9, 0.5, 0.5, 0.5] })]).tracks[0]
    assert.equal(u.volume, 0)
    assert.equal(u.pan, 1)
    assert.equal(u.fx.filter, -1)
  })

  test("name of exactly 24 chars is kept intact", () => {
    const n = "abcdefghijklmnopqrstuvwx"
    assert.equal(decodeDoc([rawTrack({ n })]).tracks[0].name, n)
  })
})
