import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { LoopEngine } from "../lib/audio/engine.ts"
import type { CommandEvent } from "../lib/audio/types.ts"
import type { SampleLoop } from "../lib/samples/library.ts"

/**
 * The audible part of an audition needs Web Audio, which Node does not have. This subclass records
 * the playback calls so the state machine (one at a time, retrigger, stop, invalidation) and its
 * separation from the project document can be tested exactly.
 */
class AuditionProbe extends LoopEngine {
  readonly starts: Array<{ id: string; token: number; key: SampleLoop["key"] }> = []
  stops = 0
  audio = true

  protected override canAudition(): boolean {
    return this.audio
  }
  protected override startAuditionAudio(sample: SampleLoop, token: number): void {
    this.starts.push({ id: sample.id, token, key: sample.key })
  }
  protected override stopAuditionAudio(): void {
    this.stops++
  }
}

describe("sample audition state", () => {
  test("starts one preview, exposes it in the snapshot, and does not touch the document", () => {
    const e = new AuditionProbe()
    const before = e.getDocument()
    const json = e.exportProject()
    const events: CommandEvent[] = []
    e.onCommand((ev) => events.push(ev))
    let notices = 0
    e.subscribe(() => notices++)

    assert.equal(e.getSnapshot().audition, null)
    assert.equal(e.auditionSample("keys-am7-rhodes"), true)
    const audition = e.getSnapshot().audition
    assert.ok(audition)
    assert.equal(audition.sampleId, "keys-am7-rhodes")
    assert.ok(Number.isFinite(audition.startedAt))
    // The shelf's stated key is what is being previewed; nothing is detected or rewritten.
    assert.deepEqual(e.starts[0].key, { tonic: "A", mode: "aeolian" })
    assert.equal(e.starts.length, 1)
    assert.equal(e.getSnapshot().playing, false, "audition must not start the transport")
    assert.equal(notices, 1)

    assert.deepEqual(e.getDocument(), before)
    assert.equal(e.exportProject(), json)
    assert.equal(e.getSnapshot().canUndo, false)
    assert.equal(e.getSnapshot().canRedo, false)
    assert.equal(events.length, 0)
  })

  test("retriggering the same sample restarts it without leaving two previews", () => {
    const e = new AuditionProbe()
    assert.equal(e.auditionSample("drums-boom-bap"), true)
    const first = e.getSnapshot().audition!
    assert.equal(e.auditionSample("drums-boom-bap"), true)
    const second = e.getSnapshot().audition!
    assert.equal(second.sampleId, first.sampleId)
    assert.equal(e.starts.length, 2)
    assert.ok(e.starts[1].token > e.starts[0].token)
    // The previous preview was explicitly torn down before the new one started.
    assert.equal(e.stops, 1)
  })

  test("a new audition stops the previous one (one at a time)", () => {
    const e = new AuditionProbe()
    assert.equal(e.auditionSample("drums-boom-bap"), true)
    assert.equal(e.auditionSample("arp-c-lydian-bells"), true)
    assert.equal(e.getSnapshot().audition?.sampleId, "arp-c-lydian-bells")
    assert.deepEqual(e.starts.map((s) => s.id), ["drums-boom-bap", "arp-c-lydian-bells"])
    assert.equal(e.stops, 1)
  })

  test("stop is explicit and idempotent", () => {
    const e = new AuditionProbe()
    assert.equal(e.auditionSample("bass-a-sub"), true)
    let notices = 0
    e.subscribe(() => notices++)
    e.stopAudition()
    assert.equal(e.getSnapshot().audition, null)
    assert.equal(e.stops, 1)
    assert.equal(notices, 1)
    e.stopAudition()
    assert.equal(e.getSnapshot().audition, null)
    assert.equal(e.stops, 1, "a second stop must not tear down anything else")
  })

  test("an unknown sample id is refused without starting anything", () => {
    const e = new AuditionProbe()
    assert.equal(e.auditionSample("not-in-the-library"), false)
    assert.equal(e.getSnapshot().audition, null)
    assert.equal(e.starts.length, 0)
    assert.equal(e.stops, 0)
  })

  test("audition is refused while the engine cannot play audio", () => {
    const e = new AuditionProbe()
    e.audio = false
    assert.equal(e.auditionSample("keys-am7-rhodes"), false)
    assert.equal(e.getSnapshot().audition, null)
    assert.equal(e.starts.length, 0)
  })
})

describe("sample audition invalidation", () => {
  test("removing a track stops the preview", () => {
    const e = new AuditionProbe()
    assert.equal(e.auditionSample("keys-cmaj9-glass"), true)
    e.removeTrack("keys")
    assert.equal(e.getSnapshot().audition, null)
    assert.equal(e.stops, 1)
  })

  test("importing a project stops the preview", () => {
    const e = new AuditionProbe()
    const project = e.exportProject()
    e.addSampleTrack("keys-am7-rhodes")
    assert.equal(e.auditionSample("keys-am7-rhodes"), true)
    assert.equal(e.importProject(project).ok, true)
    assert.equal(e.getSnapshot().audition, null)
    assert.equal(e.stops, 1)
  })

  test("an invalid import leaves the current preview alone", () => {
    const e = new AuditionProbe()
    assert.equal(e.auditionSample("keys-am7-rhodes"), true)
    const result = e.importProject("{not json")
    assert.equal(result.ok, false)
    assert.equal(e.getSnapshot().audition?.sampleId, "keys-am7-rhodes")
    assert.equal(e.stops, 0)
  })

  test("loading a share stops the preview", () => {
    const e = new AuditionProbe()
    assert.equal(e.auditionSample("arp-e-phrygian-spark"), true)
    assert.equal(e.loadShare(e.shareCode()), true)
    assert.equal(e.getSnapshot().audition, null)
    assert.equal(e.stops, 1)
  })

  test("a tempo or loop-length change stops a preview rendered for the old length", () => {
    const e = new AuditionProbe()
    assert.equal(e.auditionSample("keys-am7-rhodes"), true)
    e.setBpm(120)
    assert.equal(e.getSnapshot().audition, null)
    assert.equal(e.stops, 1)

    assert.equal(e.auditionSample("keys-am7-rhodes"), true)
    e.setBars(1)
    assert.equal(e.getSnapshot().audition, null)
    assert.equal(e.stops, 2)
  })
})

type AudioProbe = {
  ctx: { state: AudioContextState }
  counters: { channels: number; resumes: number }
}

/** Installs just enough of a live audio graph for the real canAudition/startAuditionAudio checks. */
function installFakeAudio(e: LoopEngine, state: AudioContextState): AudioProbe {
  const counters = { channels: 0, resumes: 0 }
  const channel = { input: {}, update() {}, dispose() {} }
  const ctx = {
    state,
    currentTime: 0,
    sampleRate: 48000,
    resume: () => {
      counters.resumes++
      return Promise.resolve()
    },
    createGain: () => ({
      gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} },
      connect(node: unknown) {
        return node
      },
      disconnect() {},
    }),
    createBufferSource: () => ({
      buffer: null as AudioBuffer | null,
      loop: false,
      onended: null as (() => void) | null,
      connect(node: unknown) {
        return node
      },
      start() {},
      stop() {},
    }),
  }
  const mixer = {
    createChannel: () => {
      counters.channels++
      return channel
    },
  }
  Object.assign(e as any, { ctx, mixer, audioReady: true, L: 48000, loopBars: 2 })
  return { ctx, counters }
}

class GuardProbe extends LoopEngine {
  starts = 0
  allowed(): boolean {
    return this.canAudition()
  }
  protected override startAuditionAudio(): void {
    this.starts++
  }
}

class DeferredRenderProbe extends LoopEngine {
  private settle: ((buffer: AudioBuffer | null) => void) | null = null
  protected override renderAudition(): Promise<AudioBuffer | null> {
    return new Promise((resolve) => {
      this.settle = resolve
    })
  }
  finishRender(): void {
    this.settle?.({} as AudioBuffer)
  }
}

describe("sample audition requires running audio", () => {
  test("a suspended context refuses to arm and is not resumed", () => {
    const e = new GuardProbe()
    const probe = installFakeAudio(e, "suspended")

    assert.equal(e.allowed(), false)
    assert.equal(e.auditionSample("keys-am7-rhodes"), false)
    assert.equal(e.getSnapshot().audition, null)
    assert.equal(e.starts, 0)
    assert.equal(probe.counters.resumes, 0, "refusing must not resume the context")
    assert.equal(e.getSnapshot().message, "Start the audio to preview a sample")
  })

  test("a running context arms normally", () => {
    const e = new GuardProbe()
    installFakeAudio(e, "running")

    assert.equal(e.allowed(), true)
    assert.equal(e.auditionSample("keys-am7-rhodes"), true)
    assert.equal(e.getSnapshot().audition?.sampleId, "keys-am7-rhodes")
    assert.equal(e.starts, 1)
  })

  test("a suspension during an in-flight render clears the preview instead of arming it", async () => {
    const e = new DeferredRenderProbe()
    const probe = installFakeAudio(e, "running")

    assert.equal(e.auditionSample("keys-am7-rhodes"), true)
    assert.equal(e.getSnapshot().audition?.sampleId, "keys-am7-rhodes")

    probe.ctx.state = "suspended"
    e.finishRender()
    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.equal(e.getSnapshot().audition, null)
    assert.equal(probe.counters.channels, 0, "a suspended context must not create the preview channel")
    assert.equal(e.getSnapshot().message, "Start the audio to preview a sample")
  })
})

describe("sample audition is performance, not an edit", () => {
  test("previewing leaves an existing undo history and the mix untouched", () => {
    const e = new AuditionProbe()
    e.setTrack("drums", { volume: 0.42 })
    const before = e.getDocument()
    const canUndo = e.getSnapshot().canUndo
    const canRedo = e.getSnapshot().canRedo
    const selected = e.getSnapshot().selectedTrackId

    assert.equal(e.auditionSample("keys-dm9-stabs"), true)
    e.stopAudition()
    assert.equal(e.auditionSample("bass-d-dorian-funk"), true)

    assert.deepEqual(e.getDocument(), before)
    assert.equal(e.getSnapshot().canUndo, canUndo)
    assert.equal(e.getSnapshot().canRedo, canRedo)
    assert.equal(e.getSnapshot().selectedTrackId, selected)
    assert.equal(e.getSnapshot().tracks.length, before.tracks.length)

    // Undo still reverses the mix edit, not the audition.
    e.undo()
    assert.equal(e.getSnapshot().tracks.find((t) => t.id === "drums")!.volume, 0.85)
  })

  test("no command event is emitted for starting, retriggering or stopping a preview", () => {
    const e = new AuditionProbe()
    const events: CommandEvent[] = []
    e.onCommand((ev) => events.push(ev))
    e.auditionSample("drums-four-floor")
    e.auditionSample("drums-four-floor")
    e.stopAudition()
    assert.equal(events.length, 0)
  })
})
