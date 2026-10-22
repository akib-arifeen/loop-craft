import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { LoopEngine } from "../lib/audio/engine.ts"
import { decodeShare } from "../lib/audio/share.ts"
import { BAR_OPTIONS, MAX_BPM, MIN_BPM } from "../lib/audio/types.ts"
import type { CommandEvent } from "../lib/audio/types.ts"

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
