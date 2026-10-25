import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { LoopEngine } from "../lib/audio/engine.ts"
import { loopFrameCount } from "../lib/audio/timing.ts"
import { MAX_TRACKS } from "../lib/audio/types.ts"
import type { CommandEvent } from "../lib/audio/types.ts"
import { findSample, keyLabel } from "../lib/samples/library.ts"

const track = (e: LoopEngine, id: string) => e.getSnapshot().tracks.find((t) => t.id === id)

/** Node has no Web Audio; install a buffer through the engine's own map so the real removal path keeps it. */
function installBuffer(e: LoopEngine, id = "loop-a", length = e.getSnapshot().loopFrames): AudioBuffer {
  const fake = {
    length,
    numberOfChannels: 1,
    sampleRate: 48000,
    getChannelData: () => new Float32Array(length).fill(0.4),
  } as unknown as AudioBuffer
  const internals = e as unknown as {
    buffers: Map<string, AudioBuffer>
    patchTrack: (id: string, patch: object) => void
    emit: () => void
  }
  internals.buffers.set(id, fake)
  internals.patchTrack(id, { hasAudio: true, peaks: [0.4] })
  internals.emit()
  return fake
}

describe("sample add undo", () => {
  test("add then undo removes the track and restores the exact document", () => {
    const e = new LoopEngine()
    const before = e.getDocument()
    assert.equal(e.getSnapshot().canUndo, false)

    const id = e.addSampleTrack("keys-am7-rhodes")
    assert.ok(id)
    const afterAdd = e.getDocument()
    const added = afterAdd.tracks.find((t) => t.id === id)!
    assert.equal(added.kind, "sample")
    assert.equal(added.sampleId, "keys-am7-rhodes")
    assert.equal(added.name, "Am7 Rhodes")
    // The track keeps the loop's stated key by reference; nothing detects or rewrites it.
    assert.equal(keyLabel(findSample(added.sampleId!)!.key!), "A minor")
    assert.equal(e.getSnapshot().selectedTrackId, id)
    assert.equal(e.getSnapshot().canUndo, true)

    e.undo()
    assert.deepEqual(e.getDocument(), before)
    assert.equal(track(e, id), undefined)
    assert.equal(e.getSnapshot().selectedTrackId, "drums")
    assert.equal(e.getSnapshot().canUndo, false)
    assert.equal(e.getSnapshot().canRedo, true)

    e.redo()
    assert.deepEqual(e.getDocument(), afterAdd)
    assert.equal(track(e, id)?.sampleId, "keys-am7-rhodes")
    assert.equal(e.getSnapshot().selectedTrackId, id)
  })

  test("undoing one sample add leaves another sample and every other track untouched", () => {
    const e = new LoopEngine()
    const first = e.addSampleTrack("keys-am7-rhodes")!
    const second = e.addSampleTrack("keys-am7-rhodes")!
    assert.notEqual(first, second)
    assert.equal(track(e, second)?.name, "Am7 Rhodes 2")
    const withBoth = e.getDocument()

    e.undo()
    assert.deepEqual(e.getDocument(), { ...withBoth, tracks: withBoth.tracks.filter((t) => t.id !== second) })
    assert.equal(track(e, second), undefined)
    assert.equal(track(e, first)?.sampleId, "keys-am7-rhodes")
    assert.equal(e.getSnapshot().selectedTrackId, first)

    e.undo()
    assert.equal(track(e, first), undefined)
    assert.equal(e.getDocument().tracks.length, 5)
    assert.equal(e.getSnapshot().canUndo, false)
  })
})

describe("sample remove undo", () => {
  test("remove then undo restores the same track, slot, mix and selection; redo removes it again", () => {
    const e = new LoopEngine()
    const id = e.addSampleTrack("arp-c-lydian-bells")!
    e.setTrack(id, { name: "Bells", volume: 0.42, pan: -0.3, muted: true })
    e.setTrackFx(id, { drive: 0.4, reverb: 0.55 })
    const before = e.getDocument()
    const expectedFx = before.tracks.find((t) => t.id === id)!.fx
    const index = e.getSnapshot().tracks.findIndex((t) => t.id === id)

    e.removeTrack(id)
    assert.equal(track(e, id), undefined)
    assert.equal(e.getSnapshot().canUndo, true)
    assert.equal(e.getSnapshot().canRedo, false)

    e.undo()
    assert.deepEqual(e.getDocument(), before)
    const restored = e.getSnapshot().tracks[index]
    assert.equal(restored.id, id)
    assert.equal(restored.kind, "sample")
    assert.equal(restored.sampleId, "arp-c-lydian-bells")
    assert.equal(restored.name, "Bells")
    assert.equal(restored.volume, 0.42)
    assert.equal(restored.pan, -0.3)
    assert.equal(restored.muted, true)
    assert.deepEqual(restored.fx, expectedFx)
    assert.equal(keyLabel(findSample(restored.sampleId!)!.key!), "C lydian")
    assert.equal(e.getSnapshot().selectedTrackId, id)
    assert.equal(e.getSnapshot().canRedo, true)

    e.redo()
    assert.equal(track(e, id), undefined)
    assert.equal(e.getDocument().tracks.length, 5)
    assert.equal(e.getSnapshot().canRedo, false)
    assert.equal(e.getSnapshot().canUndo, true)
  })

  test("sample undo leaves the project key and harmony untouched, and keeps the loop's own stated key", () => {
    const e = new LoopEngine()
    const id = e.addSampleTrack("bass-f-aeolian-walk")!
    e.setKey("C", "ionian")
    const harmony = e.getDocument().harmony
    const stated = findSample("bass-f-aeolian-walk")!.key!

    e.removeTrack(id)
    e.undo()
    const restored = track(e, id)!
    assert.equal(restored.sampleId, "bass-f-aeolian-walk")
    assert.deepEqual(findSample(restored.sampleId!)!.key, stated)
    assert.equal(keyLabel(stated), "F minor")
    // The sample is absolute: undoing its removal must not re-harmonise it or move the project key.
    assert.deepEqual(e.getDocument().harmony, harmony)
  })

  test("a removed sample's old mix steps do not survive as extra undo steps", () => {
    const e = new LoopEngine()
    const id = e.addSampleTrack("keys-am7-rhodes")!
    e.setTrack(id, { volume: 0.2 })
    e.removeTrack(id)
    assert.equal(e.getSnapshot().canUndo, true)
    e.undo()
    assert.equal(track(e, id)?.volume, 0.2)
    // Add + mix history for that id was dropped with the track; only the removal step was inversed.
    assert.equal(e.getSnapshot().canUndo, false)
  })
})

describe("audio removal undo", () => {
  test("removing an empty loop track is undoable and restores its slot and selection", () => {
    const e = new LoopEngine()
    const id = e.addAudioTrack()!
    e.selectTrack(id)
    const before = e.getDocument()
    const index = e.getSnapshot().tracks.findIndex((t) => t.id === id)

    e.removeTrack(id)
    assert.equal(track(e, id), undefined)
    assert.equal(e.getSnapshot().canUndo, true)
    assert.match(e.getSnapshot().message ?? "", /Undo restores it/)

    e.undo()
    assert.deepEqual(e.getDocument(), before)
    assert.equal(e.getSnapshot().tracks[index].id, id)
    assert.equal(e.getSnapshot().selectedTrackId, id)
    assert.equal(e.getSnapshot().canRedo, true)

    e.redo()
    assert.equal(track(e, id), undefined)
  })

  test("undoing a recorded-loop removal restores its buffer and re-locks tempo", () => {
    const e = new LoopEngine()
    const fake = installBuffer(e)
    assert.equal(e.getSnapshot().tempoLocked, true)
    assert.equal(e.getSnapshot().recordedLoops, 1)

    e.removeTrack("loop-a")
    assert.equal(e.debug.buffer("loop-a"), null)
    assert.equal(e.getSnapshot().tempoLocked, false)
    assert.equal(e.getSnapshot().canUndo, true)

    e.undo()
    assert.equal(e.debug.buffer("loop-a"), fake)
    const restored = track(e, "loop-a")!
    assert.equal(restored.hasAudio, true)
    assert.equal(e.getSnapshot().tempoLocked, true)

    e.redo()
    assert.equal(e.debug.buffer("loop-a"), null)
    assert.equal(e.getSnapshot().tempoLocked, false)
  })

  test("a cap-blocked recorded-loop undo restores after a removal frees a slot", () => {
    const e = new LoopEngine()
    const fake = installBuffer(e)
    while (e.getSnapshot().tracks.length < MAX_TRACKS) assert.ok(e.addAudioTrack())
    assert.equal(e.getSnapshot().tracks.length, MAX_TRACKS)

    e.removeTrack("loop-a")
    assert.equal(e.getSnapshot().tracks.length, MAX_TRACKS - 1)
    assert.ok(e.addAudioTrack())
    const filler = e.getSnapshot().tracks[e.getSnapshot().tracks.length - 1].id

    e.undo()
    assert.equal(track(e, "loop-a"), undefined)
    assert.equal(e.getSnapshot().tracks.length, MAX_TRACKS)
    assert.match(e.getSnapshot().message ?? "", /Free a track slot/)
    assert.equal(e.getSnapshot().canUndo, true)

    e.removeTrack(filler)
    e.undo()
    assert.equal(track(e, "loop-a")?.kind, "audio")
    assert.equal(e.debug.buffer("loop-a"), fake, "the recorded buffer is kept across the blocked retry")
    assert.equal(e.getSnapshot().tracks.length, MAX_TRACKS)
    assert.equal(e.getSnapshot().tempoLocked, true)
    assert.equal(e.getSnapshot().message, "Undone.")
  })
})

describe("built-in track removal undo", () => {
  test("removing at the track cap restores the exact state, rendered buffer, slot and selection", () => {
    const e = new LoopEngine()
    const fake = installBuffer(e, "keys")
    e.setTrack("keys", { name: "Pads", volume: 0.31, pan: 0.4, muted: true })
    e.setTrackFx("keys", { filter: -0.2, reverb: 0.7 })
    e.selectTrack("keys")
    const state = track(e, "keys")!
    const index = e.getSnapshot().tracks.findIndex((t) => t.id === "keys")
    while (e.getSnapshot().tracks.length < MAX_TRACKS) assert.ok(e.addAudioTrack())
    assert.equal(e.getSnapshot().tracks.length, MAX_TRACKS)

    e.removeTrack("keys")
    assert.equal(track(e, "keys"), undefined)
    assert.equal(e.debug.buffer("keys"), null)
    assert.equal(e.getSnapshot().tracks.length, MAX_TRACKS - 1)
    assert.match(e.getSnapshot().message ?? "", /Undo restores it/)

    e.undo()
    const restored = track(e, "keys")!
    assert.equal(restored.kind, "keys")
    assert.equal(restored.name, "Pads")
    assert.equal(restored.volume, 0.31)
    assert.equal(restored.pan, 0.4)
    assert.equal(restored.muted, true)
    assert.deepEqual(restored.fx, state.fx)
    assert.equal(restored.patternId, state.patternId)
    assert.equal(restored.hasAudio, true)
    assert.equal(e.debug.buffer("keys"), fake, "the exact rendered buffer is restored")
    assert.equal(e.getSnapshot().tracks[index].id, "keys", "the original slot")
    assert.equal(e.getSnapshot().selectedTrackId, "keys", "the selection from before the removal")
    assert.equal(e.getSnapshot().tracks.length, MAX_TRACKS)
    assert.equal(e.getSnapshot().message, "Undone.")
    assert.equal(e.getSnapshot().canRedo, true)

    e.redo()
    assert.equal(track(e, "keys"), undefined)
    assert.equal(e.debug.buffer("keys"), null)
    e.undo()
    assert.deepEqual(track(e, "keys"), restored)
    assert.equal(e.debug.buffer("keys"), fake)
  })

  test("removing and restoring a built-in track repeatedly never exceeds the cap", () => {
    const e = new LoopEngine()
    while (e.getSnapshot().tracks.length < MAX_TRACKS) assert.ok(e.addAudioTrack())
    for (let i = 0; i < 3; i++) {
      e.removeTrack("bass")
      assert.equal(e.getSnapshot().tracks.length, MAX_TRACKS - 1)
      e.undo()
      assert.equal(e.getSnapshot().tracks.length, MAX_TRACKS)
      assert.equal(track(e, "bass")?.kind, "bass")
      e.redo()
      assert.equal(e.getSnapshot().tracks.length, MAX_TRACKS - 1)
      e.undo()
      assert.equal(e.getSnapshot().tracks.length, MAX_TRACKS)
    }
  })

  test("a stale rendered buffer is re-rendered, not restored, and the step is kept", () => {
    const e = new LoopEngine()
    installBuffer(e, "keys", 96) // the engine's L is still 1, as before audio starts
    e.removeTrack("keys")
    e.undo()
    assert.equal(track(e, "keys")?.kind, "keys")
    assert.equal(e.debug.buffer("keys"), null, "old-length audio must never be attached")
    assert.equal(e.getSnapshot().message, "Undone.")
    assert.equal(e.getSnapshot().canRedo, true)
  })

  test("a loop-length change keeps a built-in removal step but drops its old-length audio", () => {
    const e = new LoopEngine()
    installBuffer(e, "keys")
    e.removeTrack("keys")
    e.setBars(2)
    assert.equal(e.getSnapshot().canUndo, true, "a built-in removal step is not recorded-audio history")
    e.undo()
    assert.equal(track(e, "keys")?.kind, "keys")
    assert.equal(e.debug.buffer("keys"), null)
    assert.equal(e.getSnapshot().message, "Undone.")
  })
})

describe("audio undo across a retime", () => {
  test("changing the loop length after a removal drops the stale buffer history", () => {
    const e = new LoopEngine()
    installBuffer(e)
    e.removeTrack("loop-a")
    assert.equal(e.getSnapshot().canUndo, true)

    e.setBars(2)
    assert.equal(e.getSnapshot().canUndo, false, "buffer history must be purged synchronously")
    assert.match(e.getSnapshot().message ?? "", /cleared for the new loop length/)
    e.undo()
    assert.equal(track(e, "loop-a"), undefined)
    assert.equal(e.debug.buffer("loop-a"), null)
    assert.equal(e.getSnapshot().tempoLocked, false)
  })

  test("changing the tempo after a removal also drops the stale buffer history", () => {
    const e = new LoopEngine()
    installBuffer(e)
    e.removeTrack("loop-a")
    e.setBpm(180)
    assert.equal(e.getSnapshot().canUndo, false)
    assert.match(e.getSnapshot().message ?? "", /cleared for the new tempo/)
    e.undo()
    assert.equal(track(e, "loop-a"), undefined)
    assert.equal(e.debug.buffer("loop-a"), null)
  })

  test("a failed retime cannot resurrect audio removed before the length change", () => {
    const e = new LoopEngine()
    installBuffer(e, "loop-a", 48000)
    // Simulate a live context at the old length, then a retime that never reaches its success path.
    const internals = e as unknown as {
      ctx: { sampleRate: number; state: string } | null
      audioReady: boolean
      L: number
      loopBars: number
      retiming: boolean
      retimeQueued: boolean
      enqueueRetime: () => void
      emit: () => void
    }
    internals.ctx = { sampleRate: 48000, state: "running" }
    internals.audioReady = true
    internals.L = 48000
    internals.loopBars = 4
    internals.enqueueRetime = () => {
      internals.retiming = false
      internals.retimeQueued = false
    }

    e.removeTrack("loop-a")
    assert.equal(e.debug.buffer("loop-a"), null)
    e.setBars(2)
    // The retime never rendered: bpm/bars and L now disagree, but the old audio must stay gone.
    assert.equal(e.getSnapshot().exportReady, false)
    assert.equal(e.getSnapshot().canUndo, false)
    e.undo()
    assert.equal(track(e, "loop-a"), undefined)
    assert.equal(e.debug.buffer("loop-a"), null)
  })

  test("a buffer at a different loop length is never restored, and says why", () => {
    const e = new LoopEngine()
    installBuffer(e, "loop-a", 96) // engine L is still 1, as it is before audio starts
    e.removeTrack("loop-a")
    e.undo()
    assert.equal(track(e, "loop-a"), undefined)
    assert.equal(e.debug.buffer("loop-a"), null)
    assert.match(e.getSnapshot().message ?? "", /earlier loop length/)
    assert.equal(e.getSnapshot().canUndo, false)
    assert.equal(e.getSnapshot().canRedo, false)
  })
})

describe("undo status and track cap", () => {
  test("undo and redo replace the removal message instead of leaving it stale", () => {
    const e = new LoopEngine()
    const id = e.addAudioTrack()!
    e.removeTrack(id)
    assert.match(e.getSnapshot().message ?? "", /Undo restores it/)
    e.undo()
    assert.equal(e.getSnapshot().message, "Undone.")
    e.redo()
    assert.equal(e.getSnapshot().message, "Redone.")
  })

  test("a cap-blocked undo keeps its step and succeeds once a removal frees a slot", () => {
    const e = new LoopEngine()
    const keysBefore = e.getSnapshot().tracks.find((t) => t.id === "keys")!
    while (e.getSnapshot().tracks.length < MAX_TRACKS) assert.ok(e.addAudioTrack())
    assert.equal(e.getSnapshot().tracks.length, MAX_TRACKS)

    e.removeTrack("keys")
    assert.equal(e.getSnapshot().tracks.length, MAX_TRACKS - 1)
    // Adding an empty loop track is not an undo step, so it can refill the slot without burying
    // the removal step.
    assert.ok(e.addAudioTrack())
    const added = e.getSnapshot().tracks[e.getSnapshot().tracks.length - 1].id
    assert.equal(e.getSnapshot().tracks.length, MAX_TRACKS)

    e.undo()
    assert.equal(track(e, "keys"), undefined)
    assert.equal(e.getSnapshot().tracks.length, MAX_TRACKS)
    assert.equal(e.getSnapshot().canUndo, true, "a cap-blocked step must remain undoable")
    assert.match(e.getSnapshot().message ?? "", /Free a track slot/)

    // Freeing the slot is itself a removal; it must not bury the step that is waiting for it.
    e.removeTrack(added)
    assert.equal(e.getSnapshot().tracks.length, MAX_TRACKS - 1)
    e.undo()
    assert.deepEqual(track(e, "keys"), keysBefore)
    assert.equal(e.getSnapshot().tracks.length, MAX_TRACKS)
    assert.equal(e.getSnapshot().message, "Undone.")
    assert.equal(e.getSnapshot().canUndo, true, "the freeing removal is still on the stack")

    // The slot is full again, so the freeing removal's own restore waits too, without being lost.
    e.undo()
    assert.equal(track(e, added), undefined)
    assert.equal(e.getSnapshot().tracks.length, MAX_TRACKS)
    assert.equal(e.getSnapshot().canUndo, true, "a cap-blocked removal keeps its step")
    assert.match(e.getSnapshot().message ?? "", /Free a track slot/)
  })

  test("a cap-blocked redo survives later edits and applies once a slot is free", () => {
    const e = new LoopEngine()
    const id = e.addSampleTrack("keys-am7-rhodes")!
    e.undo()
    assert.equal(e.getSnapshot().canRedo, true)
    while (e.getSnapshot().tracks.length < MAX_TRACKS) assert.ok(e.addAudioTrack())

    e.redo()
    assert.equal(track(e, id), undefined)
    assert.equal(e.getSnapshot().tracks.length, MAX_TRACKS)
    assert.equal(e.getSnapshot().canRedo, true, "a cap-blocked redo must remain redoable")
    assert.match(e.getSnapshot().message ?? "", /Free a track slot, then redo again\./)

    // Both clearRedo() paths: a new mix step, then a coalesced continuation of it.
    e.setTrack("drums", { volume: 0.5 })
    e.setTrack("drums", { volume: 0.4 })
    assert.equal(e.getSnapshot().canRedo, true, "the blocked redo survives later edits")
    assert.equal(track(e, id), undefined)

    e.removeTrack("keys")
    assert.equal(e.getSnapshot().tracks.length, MAX_TRACKS - 1)
    assert.equal(e.getSnapshot().canRedo, true, "the freeing removal keeps the blocked redo")

    e.redo()
    assert.equal(track(e, id)?.kind, "sample")
    assert.equal(e.getSnapshot().tracks.length, MAX_TRACKS)
    assert.equal(e.getSnapshot().message, "Redone.")
    assert.equal(e.getSnapshot().canRedo, false)
  })

  test("a new edit still clears an ordinary redo step", () => {
    const e = new LoopEngine()
    const id = e.addSampleTrack("keys-am7-rhodes")!
    e.undo()
    assert.equal(e.getSnapshot().canRedo, true)
    e.setTrack("drums", { volume: 0.5 })
    assert.equal(e.getSnapshot().canRedo, false, "an unblocked redo step is still cleared")
    e.redo()
    assert.equal(track(e, id), undefined)
  })

  test("a blocked retry needs intervening edits unwound before a removal swaps again", () => {
    const e = new LoopEngine()
    const keysBefore = e.getSnapshot().tracks.find((t) => t.id === "keys")!
    while (e.getSnapshot().tracks.length < MAX_TRACKS) assert.ok(e.addAudioTrack())
    e.removeTrack("keys")
    const filler = e.addAudioTrack()!
    e.undo()
    assert.match(e.getSnapshot().message ?? "", /Free a track slot/)
    assert.equal(track(e, "keys"), undefined)

    // An unrelated edit lands above the waiting step. The next removal must not skip over it.
    e.setTrack("drums", { volume: 0.2 })
    e.removeTrack(filler)
    assert.equal(e.getSnapshot().tracks.length, MAX_TRACKS - 1)
    e.undo()
    assert.equal(track(e, filler)?.kind, "audio")
    assert.equal(track(e, "keys"), undefined, "the removal did not reach past the mix step")
    assert.equal(e.getSnapshot().tracks.length, MAX_TRACKS)
    assert.equal(e.getSnapshot().message, "Undone.")

    // Unwinding the intervening edit puts the blocked step back on top.
    e.undo()
    assert.equal(track(e, "drums")!.volume, 0.85)
    assert.equal(track(e, "keys"), undefined)

    // The next removal swaps with it, and the waiting restore applies.
    e.removeTrack("loop-1")
    assert.equal(e.getSnapshot().tracks.length, MAX_TRACKS - 1)
    e.undo()
    assert.deepEqual(track(e, "keys"), keysBefore)
    assert.equal(e.getSnapshot().tracks.length, MAX_TRACKS)
    assert.equal(e.getSnapshot().message, "Undone.")
  })
})

describe("export readiness", () => {
  function fakeLiveAudio(e: LoopEngine) {
    const internals = e as unknown as {
      ctx: { sampleRate: number } | null
      audioReady: boolean
      bpm: number
      bars: number
      L: number
      loopBars: number
      pendingRenders: Set<string>
      rendersInFlight: Set<string>
      emit: () => void
    }
    internals.ctx = { sampleRate: 48000 }
    internals.audioReady = true
    internals.bpm = 92
    internals.bars = 4
    internals.L = loopFrameCount(92, 4, 48000)
    internals.loopBars = 4
    internals.emit()
    return internals
  }

  test("a queued or in-flight track render keeps export blocked", async () => {
    const e = new LoopEngine()
    const internals = fakeLiveAudio(e)
    assert.equal(e.getSnapshot().exportReady, true)
    assert.equal(e.getSnapshot().rendering, false)

    internals.pendingRenders.add("sample-1")
    internals.emit()
    assert.equal(e.getSnapshot().rendering, true)
    assert.equal(e.getSnapshot().exportReady, false)
    await assert.rejects(e.exportWav(2), /still rendering/)

    internals.pendingRenders.clear()
    internals.rendersInFlight.add("sample-1")
    internals.emit()
    assert.equal(e.getSnapshot().rendering, true)
    assert.equal(e.getSnapshot().exportReady, false)
    await assert.rejects(e.exportWav(2), /still rendering/)

    internals.rendersInFlight.clear()
    internals.emit()
    assert.equal(e.getSnapshot().rendering, false)
    assert.equal(e.getSnapshot().exportReady, true)
  })

  test("a failed retime has its own blocked reason and is not treated as ready audio", async () => {
    const e = new LoopEngine()
    const internals = fakeLiveAudio(e)
    internals.bpm = 180 // L still belongs to 92 BPM, as after a failed retime
    internals.emit()
    assert.equal(e.getSnapshot().retiming, false)
    assert.equal(e.getSnapshot().exportReady, false)
    await assert.rejects(e.exportWav(2), /tempo change didn't finish/)
  })
})

describe("sample undo scope", () => {
  test("synth removals are one undo step; addAudioTrack stays outside the history", () => {
    const e = new LoopEngine()
    assert.ok(e.addAudioTrack())
    assert.equal(e.getSnapshot().canUndo, false)
    const before = e.getDocument()
    e.removeTrack("keys")
    assert.equal(e.getSnapshot().canUndo, true)
    e.undo()
    assert.deepEqual(e.getDocument(), before)
    assert.equal(e.getSnapshot().canUndo, false)
  })

  test("removing a built-in track reports that Undo restores it", () => {
    const e = new LoopEngine()
    e.removeTrack("keys")
    assert.equal(e.getSnapshot().message, "Track removed. Undo restores it.")
    assert.equal(e.getSnapshot().canUndo, true)
  })

  test("a refused sample add leaves no undo entry", () => {
    const e = new LoopEngine()
    while (e.getSnapshot().tracks.length < MAX_TRACKS) assert.ok(e.addAudioTrack())
    assert.equal(e.addSampleTrack("keys-am7-rhodes"), null)
    assert.equal(e.getSnapshot().canUndo, false)
  })

  test("importing a project drops sample add/remove entries from the replaced session", () => {
    const e = new LoopEngine()
    const original = e.exportProject()
    const id = e.addSampleTrack("keys-am7-rhodes")!
    e.removeTrack(id)
    assert.equal(e.getSnapshot().canUndo, true)

    assert.equal(e.importProject(original).ok, true)
    assert.equal(e.getSnapshot().canUndo, false)
    e.undo()
    assert.equal(e.getSnapshot().tracks.some((t) => t.id === id), false)
    assert.equal(e.getSnapshot().tracks.length, 5)
  })

  test("an agent-dispatched sample add is undone by a user undo on the same stack", async () => {
    const e = new LoopEngine()
    const events: CommandEvent[] = []
    e.onCommand((ev) => events.push(ev))
    await e.dispatch({ type: "addSampleTrack", sampleId: "keys-am7-rhodes" }, "agent")
    assert.equal(events.length, 1)
    assert.equal(events[0].origin, "agent")
    assert.deepEqual(events[0].command, { type: "addSampleTrack", sampleId: "keys-am7-rhodes" })
    assert.equal(e.getSnapshot().canUndo, true)

    e.undo()
    assert.equal(events.length, 2)
    assert.equal(events[1].origin, "user")
    assert.deepEqual(events[1].command, { type: "undo" })
    assert.ok(events[1].seq > events[0].seq)
    assert.equal(e.getSnapshot().tracks.some((t) => t.id === "sample-1"), false)
  })
})
