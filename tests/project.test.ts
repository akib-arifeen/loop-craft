import { test } from "node:test"
import assert from "node:assert/strict"
import { PROJECT_FORMAT, PROJECT_VERSION, parseProject, stringifyProject, toProject } from "../lib/audio/project.ts"
import { demoHarmony } from "../lib/harmony/presets.ts"
import { cloneDrumPattern, DEMO_DRUMS } from "../lib/audio/patterns.ts"
import type { SessionDocument } from "../lib/audio/types.ts"

/** A document with one of each serialisable track kind plus a recorded (audio) track to be dropped. */
function document(): SessionDocument {
  return {
    v: 1,
    bpm: 92,
    bars: 4,
    metronome: true,
    masterVolume: 0.8,
    tracks: [
      { id: "drums", kind: "drums", name: "Drums", volume: 0.85, pan: 0, muted: false, soloed: false, fx: { filter: 0, drive: 0.1, delay: 0, reverb: 0.08 }, drumPattern: cloneDrumPattern(DEMO_DRUMS), hasAudio: false },
      { id: "bass", kind: "bass", name: "Bass", volume: 0.8, pan: -0.1, muted: false, soloed: false, fx: { filter: -0.15, drive: 0.25, delay: 0, reverb: 0 }, patternId: "bass-pulse", hasAudio: false },
      { id: "sample-1", kind: "sample", name: "Am7 Rhodes", volume: 0.72, pan: 0.15, muted: false, soloed: false, fx: { filter: -0.1, drive: 0, delay: 0.2, reverb: 0.3 }, sampleId: "keys-am7-rhodes", hasAudio: false },
      { id: "loop-a", kind: "audio", name: "Loop A", volume: 0.85, pan: 0, muted: true, soloed: false, fx: { filter: 0, drive: 0, delay: 0.1, reverb: 0.15 }, hasAudio: true },
    ],
    harmony: demoHarmony(),
  }
}

test("toProject writes the documented envelope and drops recorded audio", () => {
  const project = toProject(document())
  assert.equal(project.format, PROJECT_FORMAT)
  assert.equal(project.version, PROJECT_VERSION)
  assert.equal(project.tempo, 92)
  assert.equal(project.bars, 4)
  assert.deepEqual(project.key, { tonic: "A", mode: "aeolian" })
  assert.equal(project.chordLane.length, 4)
  assert.equal(project.metronome, true)
  assert.equal(project.masterVolume, 0.8)
  assert.deepEqual(project.tracks.map((t) => t.kind), ["drums", "bass", "sample"])
  assert.equal(project.tracks[0].drumPattern!.kick.length, 16)
  assert.equal(project.tracks[1].patternId, "bass-pulse")
  assert.equal(project.tracks[2].sampleId, "keys-am7-rhodes")
  assert.ok(!("hasAudio" in project.tracks[0]))
})

test("stringifyProject emits parseable JSON with the format marker", () => {
  const text = stringifyProject(toProject(document()))
  assert.match(text, /"format": "loopcraft-project"/)
  assert.doesNotThrow(() => JSON.parse(text))
  assert.ok(text.endsWith("\n"))
})

test("a project round-trips: toProject → stringify → parseProject", () => {
  const original = toProject(document())
  const parsed = parseProject(stringifyProject(original))
  assert.equal(parsed.ok, true, parsed.ok ? "" : parsed.error)
  if (!parsed.ok) return
  const value = parsed.value
  assert.equal(value.bpm, 92)
  assert.equal(value.bars, 4)
  assert.equal(value.metronome, true)
  assert.equal(value.masterVolume, 0.8)
  assert.equal(value.harmony.key.mode, "aeolian")
  assert.equal(value.harmony.chords.length, 4)
  assert.deepEqual(value.tracks.map((t) => t.kind), ["drums", "bass", "sample"])
  assert.deepEqual(value.tracks[0].drumPattern, DEMO_DRUMS)
  assert.equal(value.tracks[1].patternId, "bass-pulse")
  assert.equal(value.tracks[2].sampleId, "keys-am7-rhodes")
  assert.equal(value.tracks[2].volume, 0.72)
  assert.equal(value.tracks[2].fx.delay, 0.2)
  // and it converts back to the same documented shape
  assert.deepEqual(toProject({ bpm: value.bpm, bars: value.bars, metronome: value.metronome, masterVolume: value.masterVolume, harmony: value.harmony, tracks: value.tracks }), original)
})

test("parseProject rejects malformed documents with one readable error", () => {
  const good = toProject(document())
  const cases: Array<[string, unknown]> = [
    ["not JSON", "{nope"],
    ["not an object", []],
    ["wrong format", { ...good, format: "something-else" }],
    ["wrong version", { ...good, version: 2 }],
    ["bad key tonic", { ...good, key: { tonic: "H", mode: "aeolian" } }],
    ["unknown mode", { ...good, key: { tonic: "A", mode: "blues" } }],
    ["empty chord lane", { ...good, chordLane: [] }],
    ["bad chord", { ...good, chordLane: ["i7", "not-a-chord"] }],
    ["non-numeric tempo", { ...good, tempo: "fast" }],
    ["tracks not array", { ...good, tracks: {} }],
    ["too many tracks", { ...good, tracks: Array.from({ length: 9 }, (_, i) => ({ ...good.tracks[1], id: `t${i}` })) }],
    ["bad track id", { ...good, tracks: [{ ...good.tracks[1], id: "bad id!" }] }],
    ["recorded audio kind", { ...good, tracks: [{ ...good.tracks[1], kind: "audio" }] }],
    ["missing patternId", { ...good, tracks: [{ ...good.tracks[1], patternId: undefined }] }],
    ["unknown patternId", { ...good, tracks: [{ ...good.tracks[1], patternId: "nope" }] }],
    ["unknown sampleId", { ...good, tracks: [{ ...good.tracks[2], sampleId: "nope" }] }],
    ["short drum lane", { ...good, tracks: [{ ...good.tracks[0], drumPattern: { ...good.tracks[0].drumPattern, kick: [1, 0] } }] }],
    ["duplicate ids", { ...good, tracks: [good.tracks[1], { ...good.tracks[1] }] }],
  ]
  for (const [name, input] of cases) {
    const result = parseProject(input)
    assert.equal(result.ok, false, `${name} should be rejected`)
    if (!result.ok) assert.ok(result.error.length > 0, `${name}: empty error`)
  }
})

test("parseProject clamps numbers instead of rejecting musical ones", () => {
  const good = toProject(document())
  const parsed = parseProject({
    ...good,
    tempo: 500,
    bars: 3,
    masterVolume: 2,
    tracks: [{ ...good.tracks[1], volume: -1, pan: 9, fx: { filter: -9, drive: 4, delay: -2, reverb: 0.5 } }],
  })
  assert.equal(parsed.ok, true, parsed.ok ? "" : parsed.error)
  if (!parsed.ok) return
  assert.equal(parsed.value.bpm, 180)
  assert.equal(parsed.value.bars, 4)
  assert.equal(parsed.value.masterVolume, 1)
  assert.equal(parsed.value.tracks[0].volume, 0)
  assert.equal(parsed.value.tracks[0].pan, 1)
  assert.deepEqual(parsed.value.tracks[0].fx, { filter: -1, drive: 1, delay: 0, reverb: 0.5 })
})

test("digit-string drum lanes are rejected: the documented shape uses number arrays", () => {
  const parsed = parseProject({
    format: "loopcraft-project",
    version: 1,
    tempo: 100,
    bars: 2,
    key: { tonic: "C", mode: "ionian" },
    chordLane: ["I", "vi"],
    tracks: [
      { id: "drums", name: "Drums", kind: "drums", drumPattern: { kick: "1000100010001000", snare: "0000100000001000", clap: "0000000000001001", hat: "1010101010101010" } },
    ],
  })
  assert.equal(parsed.ok, false, "digit-string drum lanes are not the documented shape")
})

test("parseProject accepts a string and unknown fields are ignored", () => {
  const good = toProject(document())
  const text = JSON.stringify({ ...good, extra: { note: "ignored" }, tracks: good.tracks.map((t) => ({ ...t, extra: true })) })
  const parsed = parseProject(text)
  assert.equal(parsed.ok, true, parsed.ok ? "" : parsed.error)
})
