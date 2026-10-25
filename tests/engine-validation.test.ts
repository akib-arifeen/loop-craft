import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { LoopEngine } from "../lib/audio/engine.ts"
import { decodeShare, encodeShare } from "../lib/audio/share.ts"
import { parseProject } from "../lib/audio/project.ts"
import { BAR_OPTIONS, MAX_BPM, MIN_BPM } from "../lib/audio/types.ts"
import type { CommandEvent, ShareData } from "../lib/audio/types.ts"

function setup() {
  const e = new LoopEngine()
  const events: CommandEvent[] = []
  e.onCommand((ev) => events.push(ev))
  return { e, events }
}

describe("invalid input is a silent no-op (no state change, no event)", () => {
  const cases: Array<[string, (e: LoopEngine) => unknown]> = [
    ["setBpm(NaN)", (e) => e.setBpm(NaN)],
    ["setBpm(Infinity)", (e) => e.setBpm(Infinity)],
    ["setBars(3)", (e) => e.setBars(3 as any)],
    ["setMasterVolume(NaN)", (e) => e.setMasterVolume(NaN)],
    ["setTrack volume NaN", (e) => e.setTrack("drums", { volume: NaN })],
    ["setTrack pan Infinity", (e) => e.setTrack("drums", { pan: Infinity })],
    ["setTrack name 5", (e) => e.setTrack("drums", { name: 5 as any })],
    ["setTrackFx drive NaN", (e) => e.setTrackFx("drums", { drive: NaN })],
    ["toggleStep step 16", (e) => e.toggleStep("drums", "kick", 16)],
    ["toggleStep step 1.5", (e) => e.toggleStep("drums", "kick", 1.5)],
    ["toggleStep voice cowbell", (e) => e.toggleStep("drums", "cowbell" as any, 1)],
    ["setLatencyOffset(NaN)", (e) => e.setLatencyOffset(NaN)],
    ["setRecordSource('tape')", (e) => e.setRecordSource("tape" as any)],
    ["dispatch setBpm '120'", (e) => e.dispatch({ type: "setBpm", bpm: "120" } as any)],
  ]
  for (const [name, call] of cases) {
    test(name, async () => {
      const { e, events } = setup()
      const before = structuredClone(e.getSnapshot())
      await call(e)
      assert.deepEqual(e.getSnapshot(), before)
      assert.equal(events.length, 0, `unexpected event: ${JSON.stringify(events)}`)
    })
  }
})

describe("valid edge values still apply", () => {
  test("setBpm clamps to MAX_BPM / MIN_BPM", () => {
    const { e } = setup()
    e.setBpm(500)
    assert.equal(e.getSnapshot().bpm, MAX_BPM)
    e.setBpm(1)
    assert.equal(e.getSnapshot().bpm, MIN_BPM)
  })

  test("track volume 2 clamps to 1", () => {
    const { e } = setup()
    e.setTrack("drums", { volume: 2 })
    assert.equal(e.getSnapshot().tracks.find((t) => t.id === "drums")!.volume, 1)
  })
})

describe("no-op commands emit nothing", () => {
  test("selectTrack('nope')", () => {
    const { e, events } = setup()
    e.selectTrack("nope")
    assert.equal(events.length, 0)
  })

  test("setBpm to the current value", () => {
    const { e, events } = setup()
    assert.equal(e.getSnapshot().bpm, 92)
    e.setBpm(92)
    assert.equal(events.length, 0)
  })

  test("removeTrack('nope')", () => {
    const { e, events } = setup()
    const before = structuredClone(e.getSnapshot())
    e.removeTrack("nope")
    assert.equal(events.length, 0)
    assert.deepEqual(e.getSnapshot(), before)
  })

  test("a real change still emits (control)", () => {
    const { e, events } = setup()
    e.setBpm(100)
    assert.equal(events.length, 1)
  })
})

describe("shareCode", () => {
  test("after edits it decodes, with valid bars", () => {
    const { e } = setup()
    e.setBpm(110)
    e.setBars(2)
    e.toggleStep("drums", "kick", 1)
    e.setTrack("bass", { volume: 0.4, muted: true })
    const d = decodeShare(e.shareCode())
    assert.ok(d)
    assert.equal(d.bpm, 110)
    assert.ok((BAR_OPTIONS as readonly number[]).includes(d.bars))
    assert.equal(d.bars, 2)
    assert.equal(d.tracks.find((t) => t.id === "drums")!.drumPattern!.kick[1], 1)
    assert.equal(d.tracks.find((t) => t.id === "bass")!.muted, true)
  })
})

const emptyLane = () => Array(16).fill(0)
const drumsJson = (id: string) => ({ id, name: id, kind: "drums", drumPattern: { kick: emptyLane(), snare: emptyLane(), clap: emptyLane(), hat: emptyLane() } })
const projectText = (ids: string[]) =>
  JSON.stringify({
    format: "loopcraft-project",
    version: 1,
    tempo: 92,
    bars: 4,
    key: { tonic: "A", mode: "aeolian" },
    chordLane: ["i7", "VImaj7", "IIImaj7", "VII6"],
    metronome: false,
    masterVolume: 0.9,
    tracks: ids.map(drumsJson),
  })
const shareTrack = (id: string): ShareData["tracks"][number] => ({
  id,
  kind: "drums",
  name: id,
  volume: 0.8,
  pan: 0,
  muted: false,
  soloed: false,
  fx: { filter: 0, drive: 0, delay: 0, reverb: 0 },
  drumPattern: { kick: emptyLane(), snare: emptyLane(), clap: emptyLane(), hat: emptyLane() },
})

describe("project import reconciles ids with the recorded loops it keeps", () => {
  test("a renamed incoming id cannot collide with another incoming id", () => {
    const { e } = setup()
    const result = e.importProject(projectText(["loop-a", "loop-a-p"]))
    assert.equal(result.ok, true, result.ok ? "" : result.error)
    const ids = e.getSnapshot().tracks.map((t) => t.id)
    assert.deepEqual(ids, ["loop-a-p-2", "loop-a-p", "loop-a", "loop-b"])
    assert.equal(new Set(ids).size, ids.length)
    assert.deepEqual(
      e.getSnapshot().tracks.filter((t) => t.kind === "audio").map((t) => t.id),
      ["loop-a", "loop-b"],
    )
    const exported = parseProject(e.exportProject())
    assert.equal(exported.ok, true, exported.ok ? "" : exported.error)
  })

  test("repeated collisions keep walking the suffix until the id is free", () => {
    const { e } = setup()
    const result = e.importProject(projectText(["loop-a", "loop-a-p", "loop-a-p-2"]))
    assert.equal(result.ok, true, result.ok ? "" : result.error)
    assert.deepEqual(e.getSnapshot().tracks.map((t) => t.id), ["loop-a-p-3", "loop-a-p", "loop-a-p-2", "loop-a", "loop-b"])
  })

  test("editing and removing a renamed track leaves the recorded loop alone", () => {
    const { e } = setup()
    e.importProject(projectText(["loop-a", "loop-a-p"]))
    e.setTrack("loop-a-p-2", { muted: true })
    assert.equal(e.getSnapshot().tracks.find((t) => t.id === "loop-a-p-2")!.muted, true)
    assert.equal(e.getSnapshot().tracks.find((t) => t.id === "loop-a-p")!.muted, false)
    e.removeTrack("loop-a-p-2")
    assert.deepEqual(e.getSnapshot().tracks.map((t) => t.id), ["loop-a-p", "loop-a", "loop-b"])
  })
})

describe("share load reconciles ids with the recorded loops it keeps", () => {
  test("a renamed shared id cannot collide with another shared id", () => {
    const { e } = setup()
    const code = encodeShare({ v: 1, bpm: 92, bars: 4, tracks: [shareTrack("loop-a"), shareTrack("loop-a-s")] })
    assert.equal(e.loadShare(code), true)
    const ids = e.getSnapshot().tracks.map((t) => t.id)
    assert.deepEqual(ids, ["loop-a-s-2", "loop-a-s", "loop-a", "loop-b"])
    assert.equal(new Set(ids).size, ids.length)
    const d = decodeShare(e.shareCode())
    assert.ok(d)
    assert.equal(new Set(d.tracks.map((t) => t.id)).size, d.tracks.length)
    assert.deepEqual(e.getSnapshot().tracks.filter((t) => t.kind === "audio").map((t) => t.id), ["loop-a", "loop-b"])
  })

  test("a shared code with a cross-family preset is refused without replacing the session", () => {
    const { e } = setup()
    const before = structuredClone(e.getSnapshot())
    const bad = { ...shareTrack("k"), kind: "keys", patternId: "bass-pulse" } as ShareData["tracks"][number]
    const code = encodeShare({ v: 1, bpm: 92, bars: 4, tracks: [bad] })
    assert.equal(e.loadShare(code), false)
    const after = e.getSnapshot()
    assert.deepEqual(after.tracks, before.tracks)
    assert.deepEqual(after.harmony, before.harmony)
    assert.equal(after.bpm, before.bpm)
    assert.equal(after.bars, before.bars)
    assert.equal(after.selectedTrackId, before.selectedTrackId)
    assert.equal(after.message, "That share link isn't valid")
  })
})

describe("setPattern applies the same preset rules as parseProject", () => {
  const bad: Array<[string, string]> = [
    ["bass", "keys-stabs"],
    ["bass", "keys-arp"],
    ["keys", "bass-pulse"],
    ["keys", "bass-sub"],
    ["bass", "bass-nope"],
    ["keys", "keys-nope"],
    ["bass", ""],
  ]
  for (const [id, patternId] of bad) {
    test(`${id} rejects ${JSON.stringify(patternId)} without state, event or undo`, () => {
      const { e, events } = setup()
      const before = structuredClone(e.getSnapshot())
      e.setPattern(id, patternId)
      assert.deepEqual(e.getSnapshot(), before)
      assert.equal(events.length, 0)
      assert.equal(e.getSnapshot().canUndo, false)
    })
  }

  test("a preset of the track's own kind still applies and is undoable", () => {
    const { e, events } = setup()
    e.setPattern("bass", "bass-walk")
    assert.equal(e.getSnapshot().tracks.find((t) => t.id === "bass")!.patternId, "bass-walk")
    assert.equal(events.length, 1)
    assert.equal(e.getSnapshot().canUndo, true)
    e.undo()
    assert.equal(e.getSnapshot().tracks.find((t) => t.id === "bass")!.patternId, "bass-pulse")
  })

  test("the dispatch path refuses a cross-family preset too", async () => {
    const { e, events } = setup()
    const before = structuredClone(e.getSnapshot())
    await e.dispatch({ type: "setPattern", id: "keys", patternId: "bass-pulse" }, "agent")
    assert.deepEqual(e.getSnapshot(), before)
    assert.equal(events.length, 0)
  })
})
