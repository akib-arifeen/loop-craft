import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { LoopEngine } from "../lib/audio/engine.ts"
import { DEMO_DRUMS } from "../lib/audio/patterns.ts"
import type { CommandEvent } from "../lib/audio/types.ts"

function setup() {
  const e = new LoopEngine()
  const events: CommandEvent[] = []
  const unsub = e.onCommand((ev) => events.push(ev))
  return { e, events, unsub }
}

describe("UI-style calls emit exactly one user CommandEvent", () => {
  test("type, payload, origin, strictly increasing seq", () => {
    const { e, events } = setup()
    const steps: Array<[string, () => void, unknown]> = [
      ["setBpm", () => e.setBpm(100), { type: "setBpm", bpm: 100 }],
      ["setTrack", () => e.setTrack("drums", { soloed: true }), { type: "setTrack", id: "drums", patch: { soloed: true } }],
      ["toggleStep", () => e.toggleStep("drums", "kick", 1), { type: "toggleStep", id: "drums", voice: "kick", step: 1 }],
      ["setPattern", () => e.setPattern("bass", "bass-walk"), { type: "setPattern", id: "bass", patternId: "bass-walk" }],
      ["addAudioTrack", () => void e.addAudioTrack(), { type: "addAudioTrack" }],
      ["undo", () => e.undo(), { type: "undo" }],
    ]
    let lastSeq = -Infinity
    for (const [name, call, expected] of steps) {
      const before = events.length
      call()
      assert.equal(events.length, before + 1, `${name} should emit exactly one event`)
      const ev = events[events.length - 1]
      assert.equal(ev.origin, "user", name)
      assert.deepEqual(ev.command, expected, name)
      assert.ok(ev.seq > lastSeq, `${name}: seq ${ev.seq} not > ${lastSeq}`)
      lastSeq = ev.seq
    }
  })
})

describe("dispatch", () => {
  test("custom origin is carried through", async () => {
    const { e, events } = setup()
    await e.dispatch({ type: "setBpm", bpm: 110 }, "agent")
    assert.equal(events.length, 1)
    assert.equal(events[0].origin, "agent")
    assert.deepEqual(events[0].command, { type: "setBpm", bpm: 110 })
    assert.equal(e.getSnapshot().bpm, 110)
  })

  test("an agent toggleStep is undone by a user undo(), kick lane restored, canUndo updated", async () => {
    const { e, events } = setup()
    const kick = () => e.getDocument().tracks.find((t) => t.id === "drums")!.drumPattern!.kick
    const original = [...DEMO_DRUMS.kick]
    assert.deepEqual(kick(), original)
    assert.equal(e.getSnapshot().canUndo, false)

    await e.dispatch({ type: "toggleStep", id: "drums", voice: "kick", step: 1 }, "agent")
    assert.equal(events[events.length - 1].origin, "agent")
    assert.notDeepEqual(kick(), original)
    assert.equal(kick()[1], 1) // 0 -> 1
    assert.equal(e.getSnapshot().canUndo, true)

    e.undo()
    assert.equal(events[events.length - 1].origin, "user")
    assert.deepEqual(events[events.length - 1].command, { type: "undo" })
    assert.deepEqual(kick(), original)
    assert.equal(e.getSnapshot().canUndo, false)
    assert.equal(e.getSnapshot().canRedo, true)
  })
})

describe("onCommand", () => {
  test("returns an unsubscribe that works", () => {
    const { e, events, unsub } = setup()
    e.setBpm(100)
    assert.equal(events.length, 1)
    assert.equal(typeof unsub, "function")
    unsub()
    e.setBpm(101)
    assert.equal(events.length, 1)
    assert.equal(e.getSnapshot().bpm, 101)
  })

  test("a throwing listener does not break the engine or other listeners", () => {
    const e = new LoopEngine()
    const got: CommandEvent[] = []
    e.onCommand(() => {
      throw new Error("listener boom")
    })
    e.onCommand((ev) => got.push(ev))
    assert.doesNotThrow(() => e.setBpm(120))
    assert.equal(e.getSnapshot().bpm, 120)
    assert.doesNotThrow(() => e.setBpm(130))
    assert.equal(e.getSnapshot().bpm, 130)
    assert.equal(got.length, 2)
    assert.equal(got[1].seq > got[0].seq, true)
  })
})

describe("synchronous return values", () => {
  test("addAudioTrack returns a string id; loadShare('garbage') returns false", () => {
    const e = new LoopEngine()
    const id = e.addAudioTrack()
    assert.equal(typeof id, "string")
    assert.ok(e.getSnapshot().tracks.some((t) => t.id === id))
    const r = e.loadShare("garbage")
    assert.equal(r, false)
  })
})

describe("getDocument", () => {
  test("JSON round-trip, v 1, bpm 92, bars 4, 5 tracks", () => {
    const e = new LoopEngine()
    const d = e.getDocument()
    assert.deepEqual(JSON.parse(JSON.stringify(d)), d)
    assert.equal(d.v, 1)
    assert.equal(d.bpm, 92)
    assert.equal(d.bars, 4)
    assert.equal(d.tracks.length, 5)
    assert.equal(typeof d.metronome, "boolean")
    assert.equal(typeof d.masterVolume, "number")
  })

  test("reflects changes", () => {
    const e = new LoopEngine()
    e.setBpm(100)
    e.setTrack("drums", { soloed: true })
    const d = e.getDocument()
    assert.equal(d.bpm, 100)
    assert.equal(d.tracks.find((t) => t.id === "drums")!.soloed, true)
    assert.equal(d.tracks.find((t) => t.id === "bass")!.soloed, false)
    assert.deepEqual(JSON.parse(JSON.stringify(d)), d)
  })
})

describe("getClock before start()", () => {
  test("stopped clock", () => {
    const e = new LoopEngine()
    const c = e.getClock()
    const s = e.getSnapshot()
    assert.equal(c.playing, false)
    assert.equal(c.startTime, null)
    assert.equal(c.position, null)
    assert.equal(c.contextTime, 0)
    assert.equal(c.bpm, s.bpm)
    assert.equal(c.bars, s.bars)
  })
})
