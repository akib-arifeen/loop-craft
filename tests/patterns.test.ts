import { test, describe } from "node:test"
import assert from "node:assert/strict"
import {
  audioTrack,
  cloneDrumPattern,
  DEMO_BARS,
  DEMO_BPM,
  DEMO_DRUMS,
  demoTracks,
  emptyDrumPattern,
  PADS,
} from "../lib/audio/patterns.ts"
import { DRUM_VOICES, PAD_COUNT, STEPS_PER_BAR } from "../lib/audio/types.ts"
import { BASS_PARTS, KEYS_PARTS, findPart } from "../lib/harmony/presets.ts"
import type { HarmonicPart } from "../lib/harmony/types.ts"

describe("drum patterns", () => {
  test("every DEMO_DRUMS lane has STEPS_PER_BAR cells in {0,1,2}", () => {
    assert.deepEqual(Object.keys(DEMO_DRUMS).sort(), [...DRUM_VOICES].sort())
    for (const v of DRUM_VOICES) {
      assert.equal(DEMO_DRUMS[v].length, STEPS_PER_BAR, v)
      for (const c of DEMO_DRUMS[v]) assert.ok(c === 0 || c === 1 || c === 2, `${v}: ${c}`)
    }
  })

  test("emptyDrumPattern is all zeros, correct shape, fresh each call", () => {
    const a = emptyDrumPattern()
    const b = emptyDrumPattern()
    assert.deepEqual(Object.keys(a).sort(), [...DRUM_VOICES].sort())
    for (const v of DRUM_VOICES) {
      assert.equal(a[v].length, STEPS_PER_BAR)
      assert.ok(a[v].every((c) => c === 0))
    }
    assert.notEqual(a, b)
    a.kick[0] = 2
    assert.equal(b.kick[0], 0)
    assert.equal(emptyDrumPattern().kick[0], 0)
    for (const v of DRUM_VOICES) assert.notEqual(a[v], b[v])
  })

  test("cloneDrumPattern deep-copies", () => {
    const src = cloneDrumPattern(DEMO_DRUMS)
    assert.deepEqual(src, DEMO_DRUMS)
    assert.notEqual(src, DEMO_DRUMS)
    for (const v of DRUM_VOICES) assert.notEqual(src[v], DEMO_DRUMS[v])
    const before = JSON.stringify(DEMO_DRUMS)
    src.kick[1] = 1
    src.hat.fill(2)
    assert.equal(JSON.stringify(DEMO_DRUMS), before, "mutating the clone changed the original")
    const orig = emptyDrumPattern()
    const copy = cloneDrumPattern(orig)
    orig.snare[3] = 1
    assert.equal(copy.snare[3], 0, "mutating the original changed the clone")
  })
})

// CONTRACT CHANGE (v2 harmony): the absolute BASS_PATTERNS / KEYS_PATTERNS / findPattern (MIDI notes in A minor)
// were removed from lib/audio/patterns.ts. Presets are now harmony-relative parts in lib/harmony/presets.ts
// (BASS_PARTS, KEYS_PARTS, findPart), so the old "midi in 24..96" assertions no longer apply; the equivalent
// structural checks are made on the relative notes instead.
describe("harmonic part presets", () => {
  const all: HarmonicPart[] = [...BASS_PARTS, ...KEYS_PARTS]

  test("ids are unique and there are presets of both kinds", () => {
    assert.ok(BASS_PARTS.length > 0 && KEYS_PARTS.length > 0)
    const ids = all.map((p) => p.id)
    assert.equal(new Set(ids).size, ids.length)
  })

  for (const [group, list] of [
    ["BASS", BASS_PARTS],
    ["KEYS", KEYS_PARTS],
  ] as const) {
    for (const p of list) {
      test(`${group} ${p.id}: notes valid`, () => {
        assert.ok(p.lengthBeats > 0)
        assert.ok(p.name.length > 0)
        assert.ok(p.range.low < p.range.high)
        assert.ok(p.range.low >= 24 && p.range.high <= 96)
        assert.ok(p.notes.length > 0)
        for (const n of p.notes) {
          assert.ok(n.start >= 0 && n.start < p.lengthBeats, `start ${n.start}`)
          assert.ok(n.length > 0, `length ${n.length}`)
          assert.ok(n.velocity > 0 && n.velocity <= 1, `velocity ${n.velocity}`)
          if (n.pitch.kind === "chord") assert.ok(Number.isInteger(n.pitch.tone) && n.pitch.tone >= 0 && n.pitch.tone <= 4)
        }
      })
    }
  }

  test("findPart finds every preset and returns undefined for unknown ids", () => {
    for (const p of all) assert.equal(findPart(p.id), p)
    assert.equal(findPart("nope"), undefined)
    assert.equal(findPart(""), undefined)
  })
})

describe("demoTracks", () => {
  test("5 tracks, unique ids, kinds drums/bass/keys/audio/audio", () => {
    const t = demoTracks()
    assert.equal(t.length, 5)
    assert.equal(new Set(t.map((x) => x.id)).size, 5)
    assert.deepEqual(
      t.map((x) => x.kind),
      ["drums", "bass", "keys", "audio", "audio"],
    )
  })

  test("synth tracks reference existing patterns; drums carry a pattern; audio is empty", () => {
    for (const t of demoTracks()) {
      if (t.kind === "drums") {
        assert.ok(t.drumPattern)
        assert.deepEqual(t.drumPattern, DEMO_DRUMS)
      }
      if (t.kind === "bass") assert.ok(BASS_PARTS.some((p) => p.id === t.patternId), `bass ${t.patternId}`)
      if (t.kind === "keys") assert.ok(KEYS_PARTS.some((p) => p.id === t.patternId), `keys ${t.patternId}`)
      if (t.kind === "audio") {
        assert.equal(t.hasAudio, false)
        assert.deepEqual(t.peaks, [])
        assert.equal(t.drumPattern, undefined)
        assert.equal(t.patternId, undefined)
      }
      assert.ok(t.volume >= 0 && t.volume <= 1)
      assert.ok(t.pan >= -1 && t.pan <= 1)
      assert.equal(t.muted, false)
      assert.equal(t.soloed, false)
    }
  })

  test("fresh objects per call (deeply)", () => {
    const a = demoTracks()
    const b = demoTracks()
    assert.deepEqual(a, b)
    assert.notEqual(a, b)
    for (let i = 0; i < a.length; i++) {
      assert.notEqual(a[i], b[i])
      assert.notEqual(a[i].fx, b[i].fx)
      assert.notEqual(a[i].peaks, b[i].peaks)
    }
    assert.notEqual(a[0].drumPattern, b[0].drumPattern)
    assert.notEqual(a[0].drumPattern, DEMO_DRUMS)
    a[0].drumPattern!.kick[0] = 0
    a[0].fx.drive = 0.99
    assert.equal(b[0].drumPattern!.kick[0], 2)
    assert.equal(DEMO_DRUMS.kick[0], 2)
    assert.equal(demoTracks()[0].fx.drive, 0.1)
  })

  test("audioTrack returns a fresh empty audio track", () => {
    const a = audioTrack("x", "X")
    const b = audioTrack("x", "X")
    assert.equal(a.id, "x")
    assert.equal(a.name, "X")
    assert.equal(a.kind, "audio")
    assert.equal(a.hasAudio, false)
    assert.notEqual(a, b)
    assert.notEqual(a.fx, b.fx)
  })

  test("demo constants", () => {
    assert.equal(DEMO_BPM, 92)
    assert.equal(DEMO_BARS, 4)
  })
})

describe("PADS", () => {
  test("PAD_COUNT entries with unique keys; 0..3 drum voices in order, 4..7 pitched", () => {
    assert.equal(PADS.length, PAD_COUNT)
    const keys = PADS.map((p) => p.key)
    assert.equal(new Set(keys).size, keys.length)
    PADS.forEach((p, i) => {
      assert.ok(p.label.length > 0)
      if (i < 4) {
        assert.ok("drum" in p && p.drum === DRUM_VOICES[i], `pad ${i}`)
      } else {
        // CONTRACT CHANGE (v2 harmony): pads 4..7 are chord tones 0..3 of the sounding chord, not fixed Am7 MIDI notes.
        assert.ok("tone" in p && p.tone === i - 4, `pad ${i}`)
        assert.equal(p.label, ["Root", "3rd", "5th", "7th"][i - 4])
      }
    })
  })
})
