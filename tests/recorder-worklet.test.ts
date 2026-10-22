import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import vm from "node:vm"

const SRC = readFileSync(new URL("../public/worklets/recorder.js", import.meta.url), "utf8")
const N = 128

interface Posted {
  msg: any
  transfer?: any[]
}
interface Rig {
  posted: Posted[]
  send: (data: unknown) => void
  /** process one 128-frame block starting at absolute frame `frame`; input is a list of per-channel generators (or [] for none). */
  block: (frame: number, channels: Array<(f: number) => number> | null) => void
  /** process consecutive blocks covering [fromFrame, toFrame) */
  run: (fromFrame: number, toFrame: number, channels: Array<(f: number) => number> | null) => void
}

function makeRig(): Rig {
  const posted: Posted[] = []
  const registry: Record<string, any> = {}
  const sandbox: Record<string, unknown> = {
    currentFrame: 0,
    Float32Array,
    registerProcessor: (name: string, cls: unknown) => {
      registry[name] = cls
    },
  }
  sandbox.AudioWorkletProcessor = class {
    port = {
      postMessage: (msg: unknown, transfer?: unknown[]) => posted.push({ msg, transfer }),
      onmessage: null as null | ((e: { data: unknown }) => void),
    }
  }
  const ctx = vm.createContext(sandbox)
  vm.runInContext(SRC, ctx)
  const Cls = registry["loopcraft-recorder"]
  assert.ok(Cls, "processor not registered as loopcraft-recorder")
  const proc = new Cls()
  const block = (frame: number, channels: Array<(f: number) => number> | null) => {
    ;(sandbox as any).currentFrame = frame
    const input = (channels ?? []).map((g) => Float32Array.from({ length: N }, (_, i) => g(frame + i)))
    const out = [new Float32Array(N)]
    const keep = proc.process([input], [out])
    assert.equal(keep, true)
  }
  return {
    posted,
    send: (data) => proc.port.onmessage({ data }),
    block,
    run: (from, to, ch) => {
      for (let f = from; f < to; f += N) block(f, ch)
    },
  }
}

const ramp = (f: number) => f / 1e6
const dones = (r: Rig) => r.posted.filter((p) => p.msg.type === "done")
const levels = (r: Rig) => r.posted.filter((p) => p.msg.type === "level")

describe("recorder worklet capture", () => {
  test("capture {300,700} sent at frame 128 -> 400 exact samples, not late, buffer transferred", () => {
    const r = makeRig()
    r.block(0, [ramp])
    r.send({ type: "capture", id: 7, from: 300, to: 700 })
    r.run(128, 1024, [ramp])
    const d = dones(r)
    assert.equal(d.length, 1)
    const m = d[0].msg
    assert.equal(m.id, 7)
    assert.equal(m.late, false)
    assert.ok(m.samples instanceof Float32Array)
    assert.equal(m.samples.length, 400)
    assert.ok(Math.abs(m.samples[0] - 300e-6) < 1e-9)
    assert.ok(Math.abs(m.samples[399] - 699e-6) < 1e-9)
    for (let i = 0; i < 400; i++) assert.ok(Math.abs(m.samples[i] - (300 + i) / 1e6) < 1e-9, `sample ${i}`)
    assert.ok(d[0].transfer && d[0].transfer.includes(m.samples.buffer), "samples.buffer must be in the transfer list")
  })

  test("capture starting in the past -> late true, missed leading samples are 0", () => {
    const r = makeRig()
    r.run(0, 256, [ramp])
    r.send({ type: "capture", id: 1, from: 100, to: 400 })
    r.run(256, 1024, [ramp])
    const d = dones(r)
    assert.equal(d.length, 1)
    const m = d[0].msg
    assert.equal(m.late, true)
    assert.equal(m.samples.length, 300)
    for (let i = 0; i < 156; i++) assert.equal(m.samples[i], 0, `missed sample ${i}`)
    assert.ok(Math.abs(m.samples[156] - 256e-6) < 1e-9)
    assert.ok(Math.abs(m.samples[299] - 399e-6) < 1e-9)
  })

  test("cancel with the matching id -> no done", () => {
    const r = makeRig()
    r.block(0, [ramp])
    r.send({ type: "capture", id: 3, from: 300, to: 700 })
    r.block(128, [ramp])
    r.send({ type: "cancel", id: 3 })
    r.run(256, 2048, [ramp])
    assert.equal(dones(r).length, 0)
  })

  test("cancel with a different id does not cancel", () => {
    const r = makeRig()
    r.block(0, [ramp])
    r.send({ type: "capture", id: 3, from: 300, to: 700 })
    r.send({ type: "cancel", id: 99 })
    r.run(128, 1024, [ramp])
    assert.equal(dones(r).length, 1)
  })

  test("a second capture replaces the first (only the second reports)", () => {
    const r = makeRig()
    r.block(0, [ramp])
    r.send({ type: "capture", id: 1, from: 300, to: 700 })
    r.block(128, [ramp])
    r.send({ type: "capture", id: 2, from: 400, to: 600 })
    r.run(256, 1280, [ramp])
    const d = dones(r)
    assert.equal(d.length, 1)
    assert.equal(d[0].msg.id, 2)
    assert.equal(d[0].msg.samples.length, 200)
    assert.ok(Math.abs(d[0].msg.samples[0] - 400e-6) < 1e-9)
  })

  test("stereo input is averaged to mono", () => {
    const r = makeRig()
    r.block(0, [ramp, ramp])
    r.send({ type: "capture", id: 1, from: 200, to: 400 })
    r.run(128, 640, [(f) => f / 1e6, (f) => (3 * f) / 1e6])
    const m = dones(r)[0].msg
    assert.equal(m.samples.length, 200)
    for (let i = 0; i < 200; i++) assert.ok(Math.abs(m.samples[i] - (2 * (200 + i)) / 1e6) < 1e-9, `sample ${i}`)
  })

  test("no input channels records zeros", () => {
    const r = makeRig()
    r.block(0, null)
    r.send({ type: "capture", id: 1, from: 200, to: 400 })
    r.run(128, 640, null)
    const m = dones(r)[0].msg
    assert.equal(m.samples.length, 200)
    assert.ok(m.samples.every((v: number) => v === 0))
    assert.equal(m.late, false)
  })
})

describe("recorder worklet level meter", () => {
  test("a level message every 16 blocks with the max |input| since the last", () => {
    const r = makeRig()
    // negative ramp: |x| still f / 1e6
    r.run(0, 15 * N, [(f) => -f / 1e6])
    assert.equal(levels(r).length, 0)
    r.block(15 * N, [(f) => -f / 1e6])
    assert.equal(levels(r).length, 1)
    assert.ok(Math.abs(levels(r)[0].msg.peak - (16 * N - 1) / 1e6) < 1e-9)
    // next 16 blocks are silent -> peak resets to 0
    r.run(16 * N, 32 * N, [() => 0])
    assert.equal(levels(r).length, 2)
    assert.equal(levels(r)[1].msg.peak, 0)
    // next 16 blocks: a single 0.5 spike
    r.run(32 * N, 48 * N, [(f) => (f === 40 * N + 3 ? 0.5 : 0)])
    assert.equal(levels(r).length, 3)
    assert.equal(levels(r)[2].msg.peak, 0.5)
  })

  test("no input still reports level 0 every 16 blocks", () => {
    const r = makeRig()
    r.run(0, 16 * N, null)
    assert.equal(levels(r).length, 1)
    assert.equal(levels(r)[0].msg.peak, 0)
  })
})
