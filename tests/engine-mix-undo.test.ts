import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { LoopEngine } from "../lib/audio/engine.ts"
import { isAudible } from "../lib/audio/dsp.ts"
import type { CommandEvent } from "../lib/audio/types.ts"

const track = (e: LoopEngine, id: string) => e.getSnapshot().tracks.find((t) => t.id === id)!
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `expected ${b} got ${a}`)

describe("mix undo", () => {
  test("ten rapid volume changes coalesce into one undo step", () => {
    const e = new LoopEngine()
    assert.equal(track(e, "drums").volume, 0.85)
    assert.equal(e.getSnapshot().canUndo, false)
    for (let i = 1; i <= 10; i++) e.setTrack("drums", { volume: i / 20 })
    assert.equal(e.getSnapshot().canUndo, true)
    near(track(e, "drums").volume, 0.5)
    e.undo()
    near(track(e, "drums").volume, 0.85)
    assert.equal(e.getSnapshot().canUndo, false)
    assert.equal(e.getSnapshot().canRedo, true)
    e.redo()
    near(track(e, "drums").volume, 0.5)
    assert.equal(e.getSnapshot().canRedo, false)
  })

  test("mute then volume are two separate steps, undone in reverse order", () => {
    const e = new LoopEngine()
    e.setTrack("drums", { muted: true })
    e.setTrack("drums", { volume: 0.3 })
    e.undo()
    near(track(e, "drums").volume, 0.85)
    assert.equal(track(e, "drums").muted, true)
    assert.equal(e.getSnapshot().canUndo, true)
    e.undo()
    assert.equal(track(e, "drums").muted, false)
    assert.equal(e.getSnapshot().canUndo, false)
    e.redo()
    assert.equal(track(e, "drums").muted, true)
    near(track(e, "drums").volume, 0.85)
    e.redo()
    near(track(e, "drums").volume, 0.3)
  })

  test("same fields more than 600 ms apart are separate steps", async () => {
    const e = new LoopEngine()
    e.setTrack("drums", { volume: 0.6 })
    await new Promise((r) => setTimeout(r, 650))
    e.setTrack("drums", { volume: 0.4 })
    e.undo()
    near(track(e, "drums").volume, 0.6)
    assert.equal(e.getSnapshot().canUndo, true)
    e.undo()
    near(track(e, "drums").volume, 0.85)
    assert.equal(e.getSnapshot().canUndo, false)
  })

  test("a no-change setTrack pushes nothing", () => {
    const e = new LoopEngine()
    e.setTrack("drums", { volume: 0.85 })
    e.setTrack("drums", { muted: false, soloed: false, pan: 0 })
    e.setTrackFx("drums", { drive: 0.1 })
    assert.equal(e.getSnapshot().canUndo, false)
  })

  test("solo then undo: soloed false and audibility consistent", () => {
    const e = new LoopEngine()
    e.setTrack("bass", { soloed: true })
    let tracks = e.getSnapshot().tracks
    assert.equal(track(e, "bass").soloed, true)
    assert.equal(isAudible(tracks.find((t) => t.id === "bass")!, tracks), true)
    assert.equal(isAudible(tracks.find((t) => t.id === "drums")!, tracks), false)
    e.undo()
    tracks = e.getSnapshot().tracks
    assert.equal(track(e, "bass").soloed, false)
    for (const t of tracks) assert.equal(isAudible(t, tracks), true, t.id)
    e.redo()
    assert.equal(track(e, "bass").soloed, true)
  })

  test("agent setTrackFx then user undo restores it, with matching CommandEvents", async () => {
    const e = new LoopEngine()
    const events: CommandEvent[] = []
    e.onCommand((ev) => events.push(ev))
    const before = track(e, "keys").fx.reverb
    near(before, 0.3)
    await e.dispatch({ type: "setTrackFx", id: "keys", patch: { reverb: 0.9 } }, "agent")
    near(track(e, "keys").fx.reverb, 0.9)
    assert.equal(e.getSnapshot().canUndo, true)
    e.undo()
    near(track(e, "keys").fx.reverb, before)
    assert.equal(events.length, 2)
    assert.equal(events[0].origin, "agent")
    assert.deepEqual(events[0].command, { type: "setTrackFx", id: "keys", patch: { reverb: 0.9 } })
    assert.equal(events[1].origin, "user")
    assert.deepEqual(events[1].command, { type: "undo" })
    assert.ok(events[1].seq > events[0].seq)
    e.redo()
    near(track(e, "keys").fx.reverb, 0.9)
  })

  test("removeTrack drops that track's mix entries; its removal still restores the track", () => {
    const e = new LoopEngine()
    e.setTrack("drums", { volume: 0.5 })
    e.setTrack("keys", { volume: 0.2 })
    e.setTrackFx("keys", { reverb: 0.9 })
    e.removeTrack("keys")
    assert.equal(e.getSnapshot().tracks.some((t) => t.id === "keys"), false)
    e.undo()
    // Only the removal step inverses the removal: the keys mix history was dropped with the track.
    assert.equal(track(e, "keys").volume, 0.2)
    near(track(e, "keys").fx.reverb, 0.9)
    assert.equal(e.getSnapshot().canUndo, true)
    assert.equal(e.getSnapshot().canRedo, true)
    // The other track's older history survives and is the next step.
    e.undo()
    near(track(e, "drums").volume, 0.85)
    near(track(e, "keys").volume, 0.2)
    assert.equal(e.getSnapshot().canUndo, false)
    assert.doesNotThrow(() => e.undo())
    assert.doesNotThrow(() => e.redo())
  })

  test("removing a track with only mix history restores it and leaves nothing else to undo", () => {
    const e = new LoopEngine()
    e.setTrack("keys", { pan: -0.5 })
    e.removeTrack("keys")
    assert.equal(e.getSnapshot().canUndo, true)
    e.undo()
    assert.equal(track(e, "keys").pan, -0.5)
    assert.equal(e.getSnapshot().canUndo, false)
    assert.doesNotThrow(() => e.undo())
  })

  test("setTrackFx drive + reverb in one patch is one step restoring both", () => {
    const e = new LoopEngine()
    const before = { ...track(e, "drums").fx }
    e.setTrackFx("drums", { drive: 0.7, reverb: 0.6 })
    near(track(e, "drums").fx.drive, 0.7)
    near(track(e, "drums").fx.reverb, 0.6)
    e.undo()
    assert.deepEqual(track(e, "drums").fx, before)
    assert.equal(e.getSnapshot().canUndo, false)
    e.redo()
    near(track(e, "drums").fx.drive, 0.7)
    near(track(e, "drums").fx.reverb, 0.6)
  })
})
