// LoopEngine — owns the AudioContext, the transport, the mixer, recording and undo.
// The UI reads immutable snapshots (useSyncExternalStore) and calls the LoopEngineApi methods.
// The constructor must not touch window or Web Audio (it runs during SSR); everything audio is
// created in start(), which the UI calls from a user gesture.

import type {
  Bars,
  DrumPattern,
  CommandEvent,
  DrumVoice,
  EngineCommand,
  EngineSnapshot,
  LoopEngineApi,
  MicStatus,
  RecordPhase,
  RecordSource,
  SessionDocument,
  ShareData,
  TrackFx,
  TrackState,
  TransportClock,
} from "./types.ts"
import { BAR_OPTIONS, DRUM_VOICES, MAX_BPM, MAX_TRACKS, MIN_BPM, PAD_COUNT } from "./types.ts"
import { audioTrack, cloneDrumPattern, DEMO_BARS, DEMO_BPM, demoTracks, emptyDrumPattern, PADS } from "./patterns.ts"
import { MODES } from "../harmony/types.ts"
import type { Harmony, Mode } from "../harmony/types.ts"
import { chordAt, parseNoteName, parseRoman } from "../harmony/theory.ts"
import { pitchToMidi } from "../harmony/realize.ts"
import { demoHarmony, findPart } from "../harmony/presets.ts"
import { computePeaks, isAudible, mixInto } from "./dsp.ts"
import { captureWindow, loopFrameCount, loopOffset, loopPhase, nextBoundary, secondsToFrames, stepFrame } from "./timing.ts"
import { createNoiseBuffer, playDrum, playKeys } from "./synth.ts"
import { renderClickTrack } from "./render.ts"
import { synthSource, sampleSource } from "./sources.ts"
import { createImpulse, createMixer, MASTER_LOOKAHEAD_S } from "./mixer.ts"
import type { Mixer, MixerChannel } from "./mixer.ts"
import { renderMixdown } from "./exporter.ts"
import { encodeWav16 } from "./wav.ts"
import { decodeShare, encodeShare } from "./share.ts"
import { parseProject, stringifyProject, toProject } from "./project.ts"
import { findSample } from "../samples/library.ts"
import type { SampleLoop } from "../samples/library.ts"

/** Read-only internals exposed for probes (drift measurement, export checks) as window.__loopcraft.debug. */
export interface EngineDebug {
  readonly ctx: AudioContext | null
  /** Post-compressor master output node (tap it to measure what the listener hears). */
  readonly output: AudioNode | null
  readonly sampleRate: number
  readonly loopFrames: number
  /** Context frame at which loop position 0 started; null when stopped. */
  readonly startFrame: number | null
  /** Current loop buffer of a track, or null. */
  buffer(trackId: string): AudioBuffer | null
}

const LEAD_S = 0.06
const SWAP_LEAD_S = 0.03
const RECORD_LEAD_S = 0.1
const XFADE_S = 0.006
const MAX_UNDO = 30
const MAX_UNDO_FRAMES = 24_000_000
const DISPOSE_DELAY_MS = 60
const PEAK_BINS = 96
const MESSAGE_MS = 4000
const METRO = "__metronome"
/** Reserved undo-entry trackId for harmony changes: never matches a real track, so removeTrack/dropHistory leave it alone. */
const HARMONY = "__harmony"
const MAX_CHORDS = 8
const cloneHarmony = (h: Harmony): Harmony => structuredClone(h)

interface TrackContent {
  buffer?: AudioBuffer | null
  drumPattern?: DrumPattern
  patternId?: string
  mix?: MixState
  harmony?: Harmony
}
interface MixState {
  name: string
  volume: number
  pan: number
  muted: boolean
  soloed: boolean
  fx: TrackFx
}
interface UndoEntry {
  trackId: string
  before: TrackContent
  after: TrackContent
  /** Mix entries only: sorted changed keys ("volume", "fx.drive"…), used to coalesce a knob drag into one step. */
  fields?: string[]
  /** Mix entries only: performance.now() when last updated. */
  at?: number
  /** Sample add/remove entries: the whole track (null when absent), its slot and the selection on each side. */
  track?: TrackEntry
}
/** Whole-track state for a sample add/remove step. */
interface TrackEntry {
  before: TrackState | null
  after: TrackState | null
  index: number
  selectedBefore: string | null
  selectedAfter: string | null
}
const MIX_COALESCE_MS = 600
const mixOf = (t: TrackState): MixState => ({
  name: t.name, volume: t.volume, pan: t.pan, muted: t.muted, soloed: t.soloed, fx: { ...t.fx },
})
const cloneTrack = (t: TrackState): TrackState => ({ ...t, fx: { ...t.fx }, peaks: [...t.peaks] })
const mixFields = (a: MixState, b: MixState): string[] => {
  const out: string[] = []
  for (const k of ["name", "volume", "pan", "muted", "soloed"] as const) if (a[k] !== b[k]) out.push(k)
  for (const k of Object.keys(b.fx) as (keyof TrackFx)[]) if (a.fx[k] !== b.fx[k]) out.push(`fx.${k}`)
  return out.sort()
}
interface Voice {
  src: AudioBufferSourceNode
  gain: GainNode
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const isSynth = (t: TrackState) => t.kind !== "audio"
// Agents call dispatch() with untrusted data: every setter validates before touching state.
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)
const isStr = (v: unknown): v is string => typeof v === "string"

export class LoopEngine implements LoopEngineApi {
  // ── worker-private section: add any private fields and helpers here ──
  private listeners = new Set<() => void>()
  private snap: EngineSnapshot

  // state
  private tracks: TrackState[] = demoTracks()
  private selectedTrackId: string | null = "drums"
  private harmony: Harmony = demoHarmony()
  private bpm = DEMO_BPM
  private bars: Bars = DEMO_BARS
  private status: EngineSnapshot["status"] = "idle"
  private error: string | null = null
  private playing = false
  private metronome = false
  private masterVolume = 0.9
  private recordSource: RecordSource = "pads"
  private micStatus: MicStatus = "unknown"
  private latencyOffsetMs = 0
  private record_: RecordPhase = { kind: "idle" }
  private exporting = false
  private message: string | null = null
  private messageTimer: ReturnType<typeof setTimeout> | null = null
  private undoStack: UndoEntry[] = []
  private redoStack: UndoEntry[] = []
  /** Preview only: never part of the document, the undo stack or the command log. */
  private audition: { sampleId: string; startedAt: number } | null = null
  private auditionToken = 0

  // audio
  private ctx: AudioContext | null = null
  private mixer: Mixer | null = null
  private channels = new Map<string, MixerChannel>()
  private buffers = new Map<string, AudioBuffer>()
  private clickBuffer: AudioBuffer | null = null
  private voices = new Map<string, Voice>()
  private auditionSrc: AudioBufferSourceNode | null = null
  private auditionGain: GainNode | null = null
  private auditionChannel: MixerChannel | null = null
  private metronomeGain: GainNode | null = null
  private countInGain: GainNode | null = null
  private countInSrc: AudioBufferSourceNode | null = null
  private noise: AudioBuffer | null = null
  private padsBus: GainNode | null = null
  private padsChannel: MixerChannel | null = null
  private recorder: AudioWorkletNode | null = null
  private micStream: MediaStream | null = null
  private micSource: MediaStreamAudioSourceNode | null = null
  private micInputLatency = 0
  private inputPeak = 0
  private startPromise: Promise<void> | null = null
  private micPromise: Promise<boolean> | null = null
  private audioReady = false

  // transport
  private L = 1
  private loopBars: Bars = DEMO_BARS
  private startFrame: number | null = null

  // render queue
  private queue: Promise<void> = Promise.resolve()
  private pendingRenders = new Set<string>()
  private retimeQueued = false
  private retiming = false

  // recording
  private captureId = 0
  private pending: { id: number; trackId: string; overdub: boolean; boundary: number } | null = null
  private recTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    this.snap = this.buildSnapshot()
  }

  get debug(): EngineDebug {
    return {
      ctx: this.ctx,
      output: this.mixer?.output ?? null,
      sampleRate: this.ctx?.sampleRate ?? 0,
      loopFrames: this.L,
      startFrame: this.startFrame,
      buffer: (id: string) => this.buffers.get(id) ?? null,
    }
  }

  // ── snapshot ──
  private buildSnapshot(): EngineSnapshot {
    return {
      status: this.status,
      error: this.error,
      playing: this.playing,
      bpm: this.bpm,
      bars: this.bars,
      tempoLocked: this.tracks.some((t) => t.kind === "audio" && this.buffers.has(t.id)),
      metronome: this.metronome,
      masterVolume: this.masterVolume,
      tracks: this.tracks.slice(),
      selectedTrackId: this.selectedTrackId,
      record: this.record_,
      recordSource: this.recordSource,
      micStatus: this.micStatus,
      latencyMs: this.ctx ? Math.round(this.latencySeconds() * 1000) : 0,
      latencyOffsetMs: this.latencyOffsetMs,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      exporting: this.exporting,
      message: this.message,
      harmony: this.harmony,
      audition: this.audition ? { ...this.audition } : null,
    }
  }

  private emit(): void {
    this.snap = this.buildSnapshot()
    for (const l of Array.from(this.listeners)) l()
  }

  private setMessage(text: string): void {
    this.message = text
    if (this.messageTimer) clearTimeout(this.messageTimer)
    this.messageTimer = setTimeout(() => {
      this.messageTimer = null
      this.message = null
      this.emit()
    }, MESSAGE_MS)
    this.emit()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  getSnapshot(): EngineSnapshot {
    return this.snap
  }

  // ── helpers ──
  private get sr(): number {
    return this.ctx ? this.ctx.sampleRate : 0
  }
  private nowFrame(): number {
    return Math.round(this.ctx!.currentTime * this.sr)
  }
  private runnable(): boolean {
    return !!this.ctx && (this.status === "ready" || this.status === "suspended")
  }
  private track(id: string): TrackState | undefined {
    return this.tracks.find((t) => t.id === id)
  }
  private patchTrack(id: string, patch: Partial<TrackState>): void {
    this.tracks = this.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t))
  }
  private channelParams(t: TrackState) {
    return { volume: t.volume, pan: t.pan, fx: t.fx, audible: isAudible(t, this.tracks) }
  }
  private updateAllChannels(immediate = false): void {
    for (const t of this.tracks) this.channels.get(t.id)?.update(this.channelParams(t), immediate)
  }
  private makeChannel(t: TrackState): void {
    if (!this.mixer || this.channels.has(t.id)) return
    const ch = this.mixer.createChannel()
    ch.update(this.channelParams(t), true)
    this.channels.set(t.id, ch)
  }
  private bufferFor(key: string): AudioBuffer | null {
    return key === METRO ? this.clickBuffer : (this.buffers.get(key) ?? null)
  }
  private voiceDest(key: string): AudioNode | null {
    return key === METRO ? this.metronomeGain : (this.channels.get(key)?.input ?? null)
  }
  /** Seconds from scheduling a sample to the listener hearing it: device output + master look-ahead. */
  private heardLatency(): number {
    const ctx = this.ctx
    if (!ctx) return 0
    return (ctx.baseLatency || 0) + ((ctx as AudioContext & { outputLatency?: number }).outputLatency || 0) + MASTER_LOOKAHEAD_S
  }
  private latencySeconds(): number {
    if (!this.ctx) return 0
    const inp = this.recordSource === "mic" ? this.micInputLatency : 0
    return this.heardLatency() + inp + this.latencyOffsetMs / 1000
  }

  // ── start ──
  async start(opts?: { autoplay?: boolean }): Promise<void> {
    const autoplay = !!opts?.autoplay
    const after = () => {
      if (autoplay && !this.playing && this.runnable()) this.play()
    }
    if (this.ctx) {
      if ((this.ctx.state as string) !== "running") void this.ctx.resume()
      if (this.startPromise) await this.startPromise
      after()
      return
    }
    if (typeof AudioContext === "undefined" || typeof AudioWorkletNode === "undefined") {
      this.status = "error"
      this.error = "This browser can't run LoopCraft (it needs Web Audio with AudioWorklet). Try a current Chrome, Edge, Firefox or Safari."
      this.emit()
      return
    }
    let ctx: AudioContext
    try {
      ctx = new AudioContext({ latencyHint: "interactive" })
    } catch (e) {
      this.status = "idle"
      this.error = null
      this.setMessage(`Audio engine failed to start: ${e instanceof Error ? e.message : String(e)}`)
      return
    }
    this.ctx = ctx
    void ctx.resume() // must happen inside the gesture call stack (Safari), before any await
    try {
      const nav = navigator as unknown as { audioSession?: { type: string } }
      if (nav.audioSession) nav.audioSession.type = "playback"
    } catch {
      /* optional iOS nicety */
    }
    this.status = "starting"
    this.emit()
    this.startPromise = this.initAudio(ctx).finally(() => {
      this.startPromise = null
    })
    await this.startPromise
    after()
  }

  private async initAudio(ctx: AudioContext): Promise<void> {
    try {
      await ctx.audioWorklet.addModule("/worklets/recorder.js")
      const mixer = createMixer(ctx, { bpm: this.bpm, masterVolume: this.masterVolume, impulse: createImpulse(ctx), meters: true })
      this.mixer = mixer
      for (const t of this.tracks) this.makeChannel(t)

      const metro = ctx.createGain()
      metro.gain.value = this.metronome ? 0.6 : 0
      metro.connect(mixer.input)
      this.metronomeGain = metro
      const countIn = ctx.createGain()
      countIn.gain.value = 0.6
      countIn.connect(mixer.input)
      this.countInGain = countIn

      this.noise = createNoiseBuffer(ctx, 3)
      const padsBus = ctx.createGain()
      this.padsBus = padsBus
      const padsChannel = mixer.createChannel()
      padsChannel.update({ volume: 0.85, pan: 0, fx: { filter: 0, drive: 0, delay: 0.1, reverb: 0.15 }, audible: true }, true)
      padsBus.connect(padsChannel.input)
      this.padsChannel = padsChannel

      const recorder = new AudioWorkletNode(ctx, "loopcraft-recorder", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] })
      const sink = ctx.createGain()
      sink.gain.value = 0
      recorder.connect(sink)
      sink.connect(ctx.destination)
      recorder.port.onmessage = (e: MessageEvent) => this.onRecorderMessage(e.data)
      this.recorder = recorder
      this.connectInput()

      this.L = loopFrameCount(this.bpm, this.bars, ctx.sampleRate)
      this.loopBars = this.bars
      this.audioReady = true
      for (const t of this.tracks) if (isSynth(t)) this.enqueueRender(t.id)
      this.enqueueClick()
      await this.queue

      ctx.onstatechange = () => {
        if (ctx.state === "running") {
          if (this.status === "suspended") this.status = "ready"
        } else if (this.status === "ready") this.status = "suspended"
        if (ctx.state !== "running" && this.clearAudition()) {
          this.setMessage("Audio was interrupted, so the preview stopped.")
        }
        if (ctx.state !== "running" && (this.pending || this.record_.kind !== "idle")) {
          this.doCancelRecord()
          this.setMessage("Audio was interrupted, so the recording was cancelled.")
        }
        this.emit()
      }
      this.status = ctx.state === "running" ? "ready" : "suspended"
      this.emit()
    } catch (e) {
      // Roll back to a clean "idle" so a later start() retries from scratch ("error" is only for an unsupported browser).
      this.audioReady = false
      void ctx.close()
      for (const v of this.voices.values()) {
        try {
          v.src.stop(0)
        } catch {
          /* not started */
        }
      }
      this.voices.clear()
      if (this.micStream) for (const tr of this.micStream.getTracks()) tr.stop()
      this.micStream = null
      this.micSource = null
      this.micStatus = "unknown"
      this.ctx = null
      this.mixer = null
      this.recorder = null
      this.channels.clear()
      this.buffers.clear()
      this.clickBuffer = null
      this.padsBus = null
      this.padsChannel = null
      this.metronomeGain = null
      this.countInGain = null
      this.countInSrc = null
      this.noise = null
      this.pendingRenders.clear()
      this.startPromise = null
      this.status = "idle"
      this.error = null
      this.setMessage(`Audio engine failed to start: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // ── render queue ──
  private enqueue(name: string, job: () => Promise<void>): void {
    this.queue = this.queue.then(job).catch((e) => {
      console.error(e)
      this.setMessage(`Couldn't render ${name}`)
    })
  }

  private enqueueRender(id: string): void {
    if (!this.ctx || !this.audioReady || this.pendingRenders.has(id)) return
    this.pendingRenders.add(id)
    this.enqueue(this.track(id)?.name ?? id, async () => {
      this.pendingRenders.delete(id)
      const t = this.track(id)
      if (!t || t.kind === "audio") return
      const sr = this.sr
      const L = this.L
      const bars = this.loopBars
      const buffer = await synthSource(t, this.harmony).render({ sampleRate: sr, loopFrames: L, bars })
      if (L !== this.L || !this.track(id)) return // retimed or removed meanwhile; the retime job re-renders
      this.applyBuffer(id, buffer)
    })
  }

  private enqueueClick(): void {
    if (!this.audioReady) return
    this.enqueue("the metronome", async () => {
      this.clickBuffer = await renderClickTrack(this.sr, this.L, this.loopBars)
      if (this.playing) this.swapVoice(METRO)
    })
  }

  private enqueueRetime(): void {
    if (!this.ctx || !this.audioReady || this.retimeQueued) return
    this.retimeQueued = true
    this.retiming = true
    this.enqueue("the new tempo", async () => {
      this.retimeQueued = false
      try {
        const sr = this.sr
        const newL = loopFrameCount(this.bpm, this.bars, sr)
        const newBars = this.bars
        const ids = this.tracks.filter(isSynth).map((t) => t.id)
        const rendered = new Map<string, AudioBuffer>()
        for (const id of ids) {
          const t = this.track(id)
          if (!t) continue
          const buf = await synthSource(t, this.harmony).render({ sampleRate: sr, loopFrames: newL, bars: newBars })
          if (buf) rendered.set(id, buf)
        }
        const click = await renderClickTrack(sr, newL, newBars)
        // apply atomically
        this.doCancelRecord() // a capture armed for the old length can't be applied to the new one
        const oldStart = this.startFrame
        let swapFrame = 0
        let newOffset = 0
        if (this.playing) {
          swapFrame = this.nowFrame() + secondsToFrames(SWAP_LEAD_S, sr)
          const phase = oldStart !== null && swapFrame >= oldStart ? loopPhase(swapFrame, oldStart, this.L) : 0
          newOffset = Math.round(phase * newL)
          this.startFrame = swapFrame - newOffset
        }
        const unstarted = this.playing && oldStart !== null && swapFrame < oldStart
        this.L = newL
        this.loopBars = newBars
        this.purgeHistory()
        this.clickBuffer = click
        for (const [id, buf] of rendered) {
          if (!this.track(id)) continue
          this.setBufferState(id, buf)
        }
        if (this.playing) {
          const keys = new Set<string>([...this.voices.keys(), METRO, ...rendered.keys()])
          for (const key of keys) {
            if (this.voices.has(key)) {
              if (unstarted) this.stopVoice(key, 0, false)
              else this.stopVoice(key, swapFrame / sr, true)
            }
            if (this.bufferFor(key)) this.startVoice(key, swapFrame, newOffset, true)
          }
        }
        this.emit()
      } finally {
        this.retiming = this.retimeQueued
      }
    })
  }

  private setBufferState(id: string, buffer: AudioBuffer | null): void {
    if (buffer) this.buffers.set(id, buffer)
    else this.buffers.delete(id)
    const peaks = buffer ? computePeaks(buffer.getChannelData(0), PEAK_BINS) : []
    this.patchTrack(id, { peaks, hasAudio: peaks.some((p) => p > 0.0005) })
  }

  private applyBuffer(id: string, buffer: AudioBuffer | null): void {
    this.setBufferState(id, buffer)
    this.swapVoice(id)
    this.emit()
  }

  // ── voices ──
  private startVoice(key: string, atFrame: number, offsetFrames: number, fadeIn: boolean): void {
    const ctx = this.ctx
    const buffer = this.bufferFor(key)
    const dest = this.voiceDest(key)
    if (!ctx || !buffer || !dest) return
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.loop = true
    const gain = ctx.createGain()
    const t = atFrame / ctx.sampleRate
    if (fadeIn) {
      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(1, t + XFADE_S)
    } else gain.gain.value = 1
    src.connect(gain)
    gain.connect(dest)
    src.onended = () => gain.disconnect()
    src.start(t, offsetFrames / ctx.sampleRate)
    this.voices.set(key, { src, gain })
  }

  private stopVoice(key: string, atTime: number, fade: boolean): void {
    const v = this.voices.get(key)
    if (!v) return
    this.voices.delete(key)
    if (fade) {
      v.gain.gain.setValueAtTime(1, atTime)
      v.gain.gain.linearRampToValueAtTime(0, atTime + XFADE_S)
      v.src.stop(atTime + XFADE_S + 0.01)
    } else v.src.stop(atTime)
  }

  private swapVoice(key: string): void {
    if (!this.ctx || !this.playing || this.startFrame === null) return
    const sr = this.sr
    const swapFrame = this.nowFrame() + secondsToFrames(SWAP_LEAD_S, sr)
    const buffer = this.bufferFor(key)
    if (swapFrame < this.startFrame) {
      this.stopVoice(key, 0, false)
      if (buffer) this.startVoice(key, this.startFrame, 0, false)
      return
    }
    const offset = loopOffset(swapFrame, this.startFrame, this.L)
    this.stopVoice(key, swapFrame / sr, true)
    if (buffer) this.startVoice(key, swapFrame, offset, true)
  }

  private startAllVoices(atFrame: number): void {
    for (const t of this.tracks) if (this.buffers.has(t.id)) this.startVoice(t.id, atFrame, 0, false)
    this.startVoice(METRO, atFrame, 0, false)
  }

  // ── transport ──

  // ── commands (v2 seam): every public mutating method runs through run() ──
  private cmdListeners = new Set<(event: CommandEvent) => void>()
  private cmdSeq = 0

  /** Performs the command synchronously, then emits a CommandEvent. Returns the implementation's result. */
  private run(command: EngineCommand, origin: string): unknown {
    let result: unknown
    const before = this.snap
    switch (command.type) {
      case "play": this.doPlay(); break
      case "stop": this.doStop(); break
      case "setBpm": this.doSetBpm(command.bpm); break
      case "setBars": this.doSetBars(command.bars); break
      case "setMetronome": this.doSetMetronome(command.on); break
      case "setMasterVolume": this.doSetMasterVolume(command.volume); break
      case "selectTrack": this.doSelectTrack(command.id); break
      case "addAudioTrack": result = this.doAddAudioTrack(); break
      case "addSampleTrack": result = this.doAddSampleTrack(command.sampleId); break
      case "removeTrack": this.doRemoveTrack(command.id); break
      case "clearTrack": this.doClearTrack(command.id); break
      case "setTrack": this.doSetTrack(command.id, command.patch); break
      case "setTrackFx": this.doSetTrackFx(command.id, command.patch); break
      case "toggleStep": this.doToggleStep(command.id, command.voice, command.step); break
      case "setPattern": this.doSetPattern(command.id, command.patternId); break
      case "setRecordSource": this.doSetRecordSource(command.source); break
      case "setLatencyOffset": this.doSetLatencyOffset(command.ms); break
      case "record": result = this.doRecord(command.trackId); break
      case "cancelRecord": this.doCancelRecord(); break
      case "undo": this.doUndo(); break
      case "redo": this.doRedo(); break
      case "loadShare": result = this.doLoadShare(command.code); break
      case "importProject": result = this.doImportProject(command.json); break
      case "setKey": this.doSetKey(command.tonic, command.mode); break
      case "setChord": result = this.doSetChord(command.index, command.roman); break
      case "setProgression": result = this.doSetProgression(command.romans); break
    }
    // No-ops emit nothing; record / loadShare report their outcome asynchronously or via the return value.
    if (this.snap === before && command.type !== "record" && command.type !== "loadShare" && command.type !== "importProject") return result
    const event: CommandEvent = { seq: ++this.cmdSeq, origin, command }
    for (const l of Array.from(this.cmdListeners)) {
      try {
        l(event)
      } catch (e) {
        console.error(e)
      }
    }
    return result
  }

  async dispatch(command: EngineCommand, origin = "agent"): Promise<void> {
    const r = this.run(command, origin)
    if (command.type === "record") await r
  }
  onCommand(listener: (event: CommandEvent) => void): () => void {
    this.cmdListeners.add(listener)
    return () => {
      this.cmdListeners.delete(listener)
    }
  }

  play(): void { this.run({ type: "play" }, "user") }
  stop(): void { this.run({ type: "stop" }, "user") }
  setBpm(bpm: number): void { this.run({ type: "setBpm", bpm }, "user") }
  setBars(bars: Bars): void { this.run({ type: "setBars", bars }, "user") }
  setMetronome(on: boolean): void { this.run({ type: "setMetronome", on }, "user") }
  setMasterVolume(volume: number): void { this.run({ type: "setMasterVolume", volume }, "user") }
  selectTrack(id: string): void { this.run({ type: "selectTrack", id }, "user") }
  addAudioTrack(): string | null { return this.run({ type: "addAudioTrack" }, "user") as string | null }
  addSampleTrack(sampleId: string): string | null { return this.run({ type: "addSampleTrack", sampleId }, "user") as string | null }
  auditionSample(sampleId: string): boolean { return this.doAuditionSample(sampleId) }
  stopAudition(): void { this.doStopAudition() }
  removeTrack(id: string): void { this.run({ type: "removeTrack", id }, "user") }
  clearTrack(id: string): void { this.run({ type: "clearTrack", id }, "user") }
  setTrack(id: string, patch: Partial<Pick<TrackState, "name" | "volume" | "pan" | "muted" | "soloed">>): void { this.run({ type: "setTrack", id, patch }, "user") }
  setTrackFx(id: string, patch: Partial<TrackFx>): void { this.run({ type: "setTrackFx", id, patch }, "user") }
  toggleStep(id: string, voice: DrumVoice, step: number): void { this.run({ type: "toggleStep", id, voice, step }, "user") }
  setPattern(id: string, patternId: string): void { this.run({ type: "setPattern", id, patternId }, "user") }
  setRecordSource(source: RecordSource): void { this.run({ type: "setRecordSource", source }, "user") }
  setLatencyOffset(ms: number): void { this.run({ type: "setLatencyOffset", ms }, "user") }
  record(trackId?: string): Promise<void> { return this.run({ type: "record", trackId }, "user") as Promise<void> }
  cancelRecord(): void { this.run({ type: "cancelRecord" }, "user") }
  undo(): void { this.run({ type: "undo" }, "user") }
  redo(): void { this.run({ type: "redo" }, "user") }
  loadShare(code: string): boolean { return this.run({ type: "loadShare", code }, "user") as boolean }
  exportProject(): string { return stringifyProject(toProject(this.getDocument())) }
  importProject(json: string): { ok: boolean; error?: string } {
    return this.run({ type: "importProject", json }, "user") as { ok: boolean; error?: string }
  }
  setKey(tonic: string, mode: Mode): void { this.run({ type: "setKey", tonic, mode }, "user") }
  setChord(index: number, roman: string): boolean { return this.run({ type: "setChord", index, roman }, "user") === true }
  setProgression(romans: string): boolean { return this.run({ type: "setProgression", romans }, "user") === true }

  getDocument(): SessionDocument {
    return {
      v: 1,
      bpm: this.bpm,
      bars: this.bars,
      metronome: this.metronome,
      masterVolume: this.masterVolume,
      tracks: this.tracks.map((t) => {
        const o: SessionDocument["tracks"][number] = {
          id: t.id,
          kind: t.kind,
          name: t.name,
          volume: t.volume,
          pan: t.pan,
          muted: t.muted,
          soloed: t.soloed,
          fx: { ...t.fx },
          hasAudio: t.hasAudio,
        }
        if (t.drumPattern) o.drumPattern = cloneDrumPattern(t.drumPattern)
        if (t.patternId !== undefined) o.patternId = t.patternId
        if (t.sampleId !== undefined) o.sampleId = t.sampleId
        return o
      }),
      harmony: cloneHarmony(this.harmony),
    }
  }

  getClock(): TransportClock {
    const ctx = this.ctx
    const sr = this.sr
    const L = this.L
    let position: TransportClock["position"] = null
    if (ctx && this.playing && this.startFrame !== null) {
      const f = Math.round((ctx.currentTime - this.heardLatency()) * sr)
      const off = loopOffset(f, this.startFrame, L)
      const step = Math.floor((off / L) * this.loopBars * 16)
      position = {
        loop: Math.floor((f - this.startFrame) / L),
        bar: Math.floor(step / 16),
        beat: Math.floor((step % 16) / 4),
        step,
        phase: off / L,
      }
    }
    return {
      playing: this.playing,
      bpm: this.bpm,
      bars: this.bars,
      sampleRate: sr,
      loopFrames: L,
      startTime: this.startFrame !== null ? this.startFrame / sr : null,
      contextTime: ctx?.currentTime ?? 0,
      position,
    }
  }

  private doPlay(): void {
    if (!this.runnable() || this.playing) return
    this.startFrame = this.nowFrame() + secondsToFrames(LEAD_S, this.sr)
    this.startAllVoices(this.startFrame)
    this.playing = true
    this.emit()
  }
  private doStop(): void {
    this.doCancelRecord()
    for (const key of Array.from(this.voices.keys())) this.stopVoice(key, 0, false)
    if (this.countInSrc) {
      try {
        this.countInSrc.stop(0)
      } catch {
        /* already stopped */
      }
      this.countInSrc = null
    }
    this.startFrame = null
    this.playing = false
    this.emit()
  }
  togglePlay(): void {
    if (this.status === "idle") void this.start({ autoplay: true })
    else if (this.playing) this.stop()
    else this.play()
  }
  private doSetBpm(bpm: number): void {
    if (!isNum(bpm)) return
    const b = clamp(Math.round(bpm), MIN_BPM, MAX_BPM)
    if (this.snap.tempoLocked) {
      this.setMessage("Clear the recorded loops to change tempo")
      return
    }
    if (b === this.bpm) return
    this.clearAudition()
    this.doCancelRecord()
    this.bpm = b
    this.mixer?.setTempo(b)
    this.emit()
    if (this.ctx) this.enqueueRetime()
  }
  private doSetBars(bars: Bars): void {
    if (!(BAR_OPTIONS as readonly unknown[]).includes(bars)) return
    if (this.snap.tempoLocked) {
      this.setMessage("Clear the recorded loops to change the loop length")
      return
    }
    if (bars === this.bars) return
    this.clearAudition()
    this.doCancelRecord()
    this.bars = bars
    this.emit()
    if (this.ctx) this.enqueueRetime()
  }
  private doSetMetronome(on: boolean): void {
    this.metronome = on
    if (this.ctx && this.metronomeGain) this.metronomeGain.gain.setTargetAtTime(on ? 0.6 : 0, this.ctx.currentTime, 0.01)
    this.emit()
  }
  private doSetMasterVolume(volume: number): void {
    if (!isNum(volume)) return
    this.masterVolume = clamp(volume, 0, 1)
    this.mixer?.setMasterVolume(this.masterVolume)
    this.emit()
  }

  // ── tracks & editing ──
  private doSelectTrack(id: string): void {
    if (!isStr(id) || !this.track(id)) return
    this.selectedTrackId = id
    this.emit()
  }
  private doAddAudioTrack(): string | null {
    if (this.tracks.length >= MAX_TRACKS) {
      this.setMessage("Up to 8 tracks")
      return null
    }
    let n = 1
    while (this.track(`loop-${n}`)) n++
    const id = `loop-${n}`
    const names = new Set(this.tracks.map((t) => t.name))
    let name = ""
    for (let i = 0; i < 26; i++) {
      const candidate = `Loop ${String.fromCharCode(65 + i)}`
      if (!names.has(candidate)) {
        name = candidate
        break
      }
    }
    if (!name) name = `Loop ${n}`
    const t = audioTrack(id, name)
    this.tracks = [...this.tracks, t]
    this.makeChannel(t)
    this.updateAllChannels()
    this.emit()
    return id
  }
  private doAddSampleTrack(sampleId: string): string | null {
    if (!isStr(sampleId)) return null
    const sample = findSample(sampleId)
    if (!sample) {
      this.setMessage("That sample isn't in the library")
      return null
    }
    if (this.tracks.length >= MAX_TRACKS) {
      this.setMessage("Up to 8 tracks")
      return null
    }
    // Adding commits the loop, so the audition has done its job. Leaving it running would put a
    // second copy of the same audio beside the new track.
    this.clearAudition()
    let n = 1
    while (this.track(`sample-${n}`)) n++
    const id = `sample-${n}`
    const names = new Set(this.tracks.map((t) => t.name))
    let name = sample.name
    for (let i = 2; names.has(name); i++) name = `${sample.name.slice(0, 20)} ${i}`
    const t: TrackState = {
      id,
      name,
      kind: "sample",
      volume: sample.volume,
      pan: sample.pan,
      muted: false,
      soloed: false,
      fx: { ...sample.fx },
      sampleId: sample.id,
      hasAudio: false,
      peaks: [],
    }
    const selectedBefore = this.selectedTrackId
    this.tracks = [...this.tracks, t]
    this.makeChannel(t)
    this.updateAllChannels()
    this.selectedTrackId = id
    this.enqueueRender(id)
    this.pushUndo({
      trackId: id,
      before: {},
      after: {},
      track: { before: null, after: cloneTrack(t), index: this.tracks.length - 1, selectedBefore, selectedAfter: id },
    })
    this.emit()
    return id
  }

  // ── sample audition: performance only, never a session edit ──
  private doAuditionSample(sampleId: string): boolean {
    if (!isStr(sampleId)) return false
    const sample = findSample(sampleId)
    if (!sample) {
      this.setMessage("That sample isn't in the library")
      return false
    }
    if (!this.canAudition()) {
      this.setMessage("Start the audio to preview a sample")
      return false
    }
    // One at a time: retriggering the same loop tears it down and starts a fresh pass too.
    this.clearAudition()
    this.audition = { sampleId: sample.id, startedAt: this.ctx?.currentTime ?? 0 }
    this.startAuditionAudio(sample, this.auditionToken)
    this.emit()
    return true
  }
  private doStopAudition(): void {
    if (!this.clearAudition()) return
    this.emit()
  }
  /** Clears the preview state and tears down its nodes. Returns whether one was showing. */
  private clearAudition(): boolean {
    const had = this.audition !== null
    const hadAudio = this.auditionSrc !== null || this.auditionChannel !== null
    this.auditionToken++
    this.audition = null
    if (had || hadAudio) this.stopAuditionAudio()
    return had
  }
  /** Whether a preview can play. Separated so the audition state machine is testable without Web Audio. */
  protected canAudition(): boolean {
    return !!this.ctx && this.ctx.state === "running" && this.audioReady && !!this.mixer
  }
  /** Renders a preview at the project's current loop length. Separated so a late render can be tested. */
  protected renderAudition(sample: SampleLoop): Promise<AudioBuffer | null> {
    return sampleSource(sample.id).render({ sampleRate: this.sr, loopFrames: this.L, bars: this.loopBars })
  }
  /**
   * Renders the loop at the project's current loop length and starts it looping on the audio clock.
   * `token` drops a render that finished after the preview was stopped or replaced.
   */
  protected startAuditionAudio(sample: SampleLoop, token: number): void {
    const ctx = this.ctx
    const mixer = this.mixer
    if (!ctx || !mixer) return
    void this.renderAudition(sample)
      .then((buffer) => {
        if (!buffer || token !== this.auditionToken || this.audition?.sampleId !== sample.id) return
        if (!this.canAudition()) {
          this.setMessage("Start the audio to preview a sample")
          this.doStopAudition()
          return
        }
        const channel = mixer.createChannel()
        channel.update({ volume: sample.volume, pan: sample.pan, fx: sample.fx, audible: true }, true)
        const gain = ctx.createGain()
        const startAt = ctx.currentTime + 0.01
        gain.gain.setValueAtTime(0, startAt)
        gain.gain.linearRampToValueAtTime(1, startAt + XFADE_S)
        const src = ctx.createBufferSource()
        src.buffer = buffer
        src.loop = true
        src.connect(gain).connect(channel.input)
        src.onended = () => gain.disconnect()
        src.start(startAt)
        this.auditionSrc = src
        this.auditionGain = gain
        this.auditionChannel = channel
      })
      .catch(() => {
        if (token === this.auditionToken) this.doStopAudition()
      })
  }
  /** Fades the preview out, then disposes its private channel. */
  protected stopAuditionAudio(): void {
    const ctx = this.ctx
    const src = this.auditionSrc
    const gain = this.auditionGain
    this.auditionSrc = null
    this.auditionGain = null
    if (src && gain && ctx) {
      const now = ctx.currentTime
      gain.gain.cancelScheduledValues(now)
      gain.gain.setValueAtTime(gain.gain.value, now)
      gain.gain.linearRampToValueAtTime(0, now + XFADE_S)
      try {
        src.stop(now + XFADE_S + 0.01)
      } catch {
        /* already stopped */
      }
    }
    const channel = this.auditionChannel
    this.auditionChannel = null
    if (channel) setTimeout(() => channel.dispose(), DISPOSE_DELAY_MS)
  }

  private doRemoveTrack(id: string): void {
    if (!isStr(id)) return
    const t = this.track(id)
    if (!t) return
    this.clearAudition()
    if (this.pending?.trackId === id) this.doCancelRecord()
    const selectedBefore = this.selectedTrackId
    this.disposeTrackAudio(id)
    const idx = this.tracks.findIndex((x) => x.id === id)
    this.tracks = this.tracks.filter((x) => x.id !== id)
    this.dropHistory(id)
    if (this.selectedTrackId === id) {
      this.selectedTrackId = this.tracks.length ? this.tracks[Math.min(idx, this.tracks.length - 1)].id : null
    }
    // Only a sample track's removal is undoable; removing any other kind keeps its existing behaviour.
    if (t.kind === "sample") {
      this.pushUndo({
        trackId: id,
        before: {},
        after: {},
        track: { before: cloneTrack(t), after: null, index: idx, selectedBefore, selectedAfter: this.selectedTrackId },
      })
    }
    this.updateAllChannels()
    this.emit()
  }
  private disposeTrackAudio(id: string): void {
    if (this.ctx) this.stopVoice(id, this.ctx.currentTime, true)
    const ch = this.channels.get(id)
    if (ch) setTimeout(() => ch.dispose(), DISPOSE_DELAY_MS) // let the 6 ms voice fade finish first (avoids a click)
    this.channels.delete(id)
    this.buffers.delete(id)
  }
  private dropHistory(id: string): void {
    this.undoStack = this.undoStack.filter((e) => e.trackId !== id)
    this.redoStack = this.redoStack.filter((e) => e.trackId !== id)
  }
  /** Import/share replace the whole synth/sample set; an old sample add/remove step can't apply to the new document. */
  private dropTrackEntries(): void {
    this.undoStack = this.undoStack.filter((e) => !e.track)
    this.redoStack = this.redoStack.filter((e) => !e.track)
  }
  private doSetTrack(id: string, patch: Partial<Pick<TrackState, "name" | "volume" | "pan" | "muted" | "soloed">>): void {
    if (!isStr(id) || !this.track(id) || !patch || typeof patch !== "object") return
    const p: Partial<TrackState> = {}
    if (isNum(patch.volume)) p.volume = clamp(patch.volume, 0, 1)
    if (isNum(patch.pan)) p.pan = clamp(patch.pan, -1, 1)
    if (typeof patch.muted === "boolean") p.muted = patch.muted
    if (typeof patch.soloed === "boolean") p.soloed = patch.soloed
    if (isStr(patch.name)) {
      const name = patch.name.trim().slice(0, 24)
      if (name) p.name = name
    }
    if (Object.keys(p).length === 0) return
    const before = mixOf(this.track(id)!)
    this.patchTrack(id, p)
    this.pushMixUndo(id, before, mixOf(this.track(id)!))
    this.updateAllChannels()
    this.emit()
  }
  private doSetTrackFx(id: string, patch: Partial<TrackFx>): void {
    if (!isStr(id) || !patch || typeof patch !== "object") return
    const t = this.track(id)
    if (!t) return
    const fx = { ...t.fx }
    let any = false
    if (isNum(patch.filter)) ((fx.filter = clamp(patch.filter, -1, 1)), (any = true))
    if (isNum(patch.drive)) ((fx.drive = clamp(patch.drive, 0, 1)), (any = true))
    if (isNum(patch.delay)) ((fx.delay = clamp(patch.delay, 0, 1)), (any = true))
    if (isNum(patch.reverb)) ((fx.reverb = clamp(patch.reverb, 0, 1)), (any = true))
    if (!any) return
    const before = mixOf(t)
    this.patchTrack(id, { fx })
    this.pushMixUndo(id, before, mixOf(this.track(id)!))
    const nt = this.track(id)!
    this.channels.get(id)?.update(this.channelParams(nt))
    this.emit()
  }
  /** One undo step per mix gesture: same track + same changed fields within MIX_COALESCE_MS extend the newest entry. */
  private pushMixUndo(trackId: string, before: MixState, after: MixState): void {
    const fields = mixFields(before, after)
    if (fields.length === 0) return
    const now = performance.now()
    const last = this.undoStack[this.undoStack.length - 1]
    if (last && last.trackId === trackId && last.before.mix && last.at !== undefined && now - last.at < MIX_COALESCE_MS &&
      last.fields?.join() === fields.join()) {
      last.after = { mix: after }
      last.at = now
      this.redoStack = []
      return
    }
    this.pushUndo({ trackId, before: { mix: before }, after: { mix: after }, fields, at: now })
  }
  private pushUndo(entry: UndoEntry): void {
    this.undoStack.push(entry)
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift()
    this.redoStack = []
    while (this.undoStack.length > 0 && this.historyFrames() > MAX_UNDO_FRAMES) this.undoStack.shift()
  }
  /** Total frames of the distinct AudioBuffers kept alive by undo + redo. */
  private historyFrames(): number {
    const seen = new Set<AudioBuffer>()
    for (const e of [...this.undoStack, ...this.redoStack]) {
      if (e.before.buffer) seen.add(e.before.buffer)
      if (e.after.buffer) seen.add(e.after.buffer)
    }
    let total = 0
    for (const b of seen) total += b.length
    return total
  }
  /** After a retime, drop every history entry that references an AudioBuffer (recorded at the old length/tempo; it could never be applied). */
  private purgeHistory(): void {
    const hasBuffer = (e: UndoEntry) => !!e.before.buffer || !!e.after.buffer
    this.undoStack = this.undoStack.filter((e) => !hasBuffer(e))
    this.redoStack = this.redoStack.filter((e) => !hasBuffer(e))
  }
  private doToggleStep(id: string, voice: DrumVoice, step: number): void {
    if (!isStr(id)) return
    const t = this.track(id)
    if (!t || t.kind !== "drums" || !t.drumPattern) return
    if (!DRUM_VOICES.includes(voice) || !isNum(step) || !Number.isInteger(step) || step < 0 || step >= 16) return
    const before = cloneDrumPattern(t.drumPattern)
    const after = cloneDrumPattern(t.drumPattern)
    after[voice][step] = (after[voice][step] + 1) % 3
    this.pushUndo({ trackId: id, before: { drumPattern: before }, after: { drumPattern: cloneDrumPattern(after) } })
    this.patchTrack(id, { drumPattern: after })
    this.enqueueRender(id)
    this.emit()
  }
  private doSetPattern(id: string, patternId: string): void {
    if (!isStr(id) || !isStr(patternId)) return
    const t = this.track(id)
    if (!t || (t.kind !== "bass" && t.kind !== "keys")) return
    if (!findPart(patternId) || t.patternId === patternId) return
    this.pushUndo({ trackId: id, before: { patternId: t.patternId }, after: { patternId } })
    this.patchTrack(id, { patternId })
    this.enqueueRender(id)
    this.emit()
  }
  private doClearTrack(id: string): void {
    if (!isStr(id)) return
    const t = this.track(id)
    if (!t) return
    if (t.kind === "audio") {
      const before = this.buffers.get(id)
      if (!before) return
      this.pushUndo({ trackId: id, before: { buffer: before }, after: { buffer: null } })
      this.applyBuffer(id, null)
    } else if (t.kind === "drums" && t.drumPattern) {
      this.pushUndo({ trackId: id, before: { drumPattern: cloneDrumPattern(t.drumPattern) }, after: { drumPattern: emptyDrumPattern() } })
      this.patchTrack(id, { drumPattern: emptyDrumPattern() })
      this.enqueueRender(id)
    } else return
    this.emit()
  }

  // ── harmony ──
  private renderHarmonyTracks(): void {
    for (const t of this.tracks) if (t.kind === "bass" || t.kind === "keys") this.enqueueRender(t.id)
  }
  /** Installs `next` as one undo step and re-renders bass/keys. A change that leaves the harmony identical is not a step. */
  private commitHarmony(next: Harmony): void {
    if (JSON.stringify(next) === JSON.stringify(this.harmony)) return
    this.pushUndo({ trackId: HARMONY, before: { harmony: cloneHarmony(this.harmony) }, after: { harmony: cloneHarmony(next) } })
    this.harmony = next
    this.renderHarmonyTracks()
    this.emit()
  }
  private doSetKey(tonic: string, mode: Mode): void {
    if (!isStr(tonic) || !isStr(mode)) return
    const name = parseNoteName(tonic)
    if (!name || !(MODES as readonly string[]).includes(mode)) return
    this.commitHarmony({ ...cloneHarmony(this.harmony), key: { tonic: name, mode } })
  }
  private doSetChord(index: number, roman: string): boolean {
    if (!isNum(index) || !Number.isInteger(index) || index < 0 || index >= this.harmony.chords.length || !isStr(roman)) return false
    const chord = parseRoman(roman.trim(), this.harmony.key)
    if (!chord) return false
    const next = cloneHarmony(this.harmony)
    next.chords[index] = { ...next.chords[index], chord }
    this.commitHarmony(next)
    return true
  }
  private doSetProgression(romans: string): boolean {
    if (!isStr(romans)) return false
    const parts = romans.split(/\s+/).filter(Boolean)
    if (parts.length < 1 || parts.length > MAX_CHORDS) return false
    const key = this.harmony.key
    const chords: Harmony["chords"] = []
    for (let i = 0; i < parts.length; i++) {
      const chord = parseRoman(parts[i], key)
      if (!chord) return false
      chords.push({ start: i * 4, length: 4, chord })
    }
    this.commitHarmony({ ...cloneHarmony(this.harmony), chords })
    return true
  }

  // ── undo / redo ──
  /** Returns false when the content was skipped (it can't be applied here); callers drop such entries. */
  private applyContent(id: string, c: TrackContent): boolean {
    if (c.buffer && c.buffer.length !== this.L) return false // recorded at another tempo/length; can't be played back here
    if ("buffer" in c) this.applyBuffer(id, c.buffer ?? null)
    if (c.drumPattern) {
      this.patchTrack(id, { drumPattern: cloneDrumPattern(c.drumPattern) })
      this.enqueueRender(id)
    }
    if (c.patternId !== undefined) {
      this.patchTrack(id, { patternId: c.patternId })
      this.enqueueRender(id)
    }
    if (c.harmony) {
      this.harmony = cloneHarmony(c.harmony)
      this.renderHarmonyTracks()
    }
    if (c.mix) {
      this.patchTrack(id, { ...c.mix, fx: { ...c.mix.fx } })
      this.updateAllChannels() // solo/mute change what the other tracks do
    }
    return true
  }
  /**
   * Undo/redo for one sample add/remove step. Returns false when it can't be applied here (the other
   * side already exists, or the track cap would be exceeded), so the caller drops it instead of
   * clobbering a same-id track introduced by an import or a re-used id.
   */
  private applyTrackEntry(e: UndoEntry, side: "before" | "after"): boolean {
    const entry = e.track!
    const target = entry[side]
    const existing = this.track(e.trackId)
    if (!target) {
      if (!existing) return false
      this.disposeTrackAudio(e.trackId)
      this.tracks = this.tracks.filter((t) => t.id !== e.trackId)
    } else {
      if (existing || this.tracks.length >= MAX_TRACKS) return false
      const t = cloneTrack(target)
      t.hasAudio = false
      t.peaks = []
      const at = clamp(entry.index, 0, this.tracks.length)
      this.tracks = [...this.tracks.slice(0, at), t, ...this.tracks.slice(at)]
      this.makeChannel(t)
      this.enqueueRender(t.id)
    }
    this.selectedTrackId = side === "before" ? entry.selectedBefore : entry.selectedAfter
    if (!this.track(this.selectedTrackId ?? "")) this.selectedTrackId = this.tracks[0]?.id ?? null
    this.updateAllChannels()
    return true
  }
  private doUndo(): void {
    let e = this.undoStack.pop()
    while (e && e.trackId !== HARMONY && !e.track && !this.track(e.trackId)) e = this.undoStack.pop()
    if (!e) {
      this.emit()
      return
    }
    const applied = e.track ? this.applyTrackEntry(e, "before") : this.applyContent(e.trackId, e.before)
    if (applied) this.redoStack.push(e)
    this.emit()
  }
  private doRedo(): void {
    let e = this.redoStack.pop()
    while (e && e.trackId !== HARMONY && !e.track && !this.track(e.trackId)) e = this.redoStack.pop()
    if (!e) {
      this.emit()
      return
    }
    const applied = e.track ? this.applyTrackEntry(e, "after") : this.applyContent(e.trackId, e.after)
    if (applied) this.undoStack.push(e)
    this.emit()
  }

  // ── recording ──
  private connectInput(): void {
    if (!this.recorder) return
    try {
      this.padsBus?.disconnect(this.recorder)
    } catch {
      /* not connected */
    }
    try {
      this.micSource?.disconnect(this.recorder)
    } catch {
      /* not connected */
    }
    if (this.recordSource === "mic" && this.micSource) this.micSource.connect(this.recorder)
    else if (this.recordSource === "pads") this.padsBus?.connect(this.recorder)
  }

  private doSetRecordSource(source: RecordSource): void {
    if (source !== "mic" && source !== "pads") return
    this.recordSource = source
    if (source === "pads") {
      if (this.micStream) {
        for (const tr of this.micStream.getTracks()) tr.stop()
        try {
          this.micSource?.disconnect()
        } catch {
          /* ignore */
        }
        this.micSource = null
        this.micStream = null
        this.micStatus = "unknown"
      }
    } else if (this.ctx) {
      void this.ensureMic().then((ok) => {
        if (!ok && this.recordSource === "mic") {
          this.recordSource = "pads"
          this.connectInput()
          this.emit()
        }
      })
    }
    this.connectInput()
    this.emit()
  }

  private ensureMic(): Promise<boolean> {
    if (this.micSource) return Promise.resolve(true)
    if (!this.micPromise) {
      this.micPromise = this.openMic().finally(() => {
        this.micPromise = null
      })
    }
    return this.micPromise
  }

  private async openMic(): Promise<boolean> {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || !this.ctx) {
      this.micStatus = "unsupported"
      this.setMessage("This browser can't record from a microphone. Use the pads.")
      return false
    }
    this.micStatus = "prompting"
    this.emit()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
      if (this.recordSource !== "mic" || this.micSource || !this.ctx) {
        // switched back to pads (or a stream already exists) while the prompt was open: don't keep this one
        for (const tr of stream.getTracks()) tr.stop()
        return this.recordSource === "mic" && !!this.micSource
      }
      this.micStream = stream
      this.micSource = this.ctx.createMediaStreamSource(stream)
      this.micInputLatency = (stream.getAudioTracks()[0]?.getSettings() as { latency?: number } | undefined)?.latency ?? 0
      this.micStatus = "granted"
      this.connectInput()
      this.emit()
      return true
    } catch (e) {
      const name = (e as { name?: string })?.name
      this.micStatus = name === "NotAllowedError" || name === "SecurityError" ? "denied" : name === "NotFoundError" ? "unsupported" : "denied"
      this.recordSource = "pads"
      this.connectInput()
      this.setMessage("Microphone unavailable. Recording from the pads instead (keys A S D F · H J K L).")
      return false
    }
  }

  private doSetLatencyOffset(ms: number): void {
    if (!isNum(ms)) return
    this.latencyOffsetMs = Math.round(clamp(ms, -100, 100))
    this.emit()
  }

  private async doRecord(trackId?: string): Promise<void> {
    if (trackId !== undefined && !isStr(trackId)) return
    if (this.record_.kind !== "idle") {
      this.doCancelRecord()
      return
    }
    if (this.retiming) {
      this.setMessage("Changing tempo. Try again in a moment.")
      return
    }
    await this.armRecording(trackId)
  }

  private async armRecording(trackId?: string): Promise<void> {
    if (this.status === "idle") {
      await this.start({ autoplay: false })
      if (this.record_.kind !== "idle") return // re-entered while starting
    }
    if (!this.ctx || !this.recorder || !this.runnable()) return
    const id = trackId ?? this.selectedTrackId
    const t = id ? this.track(id) : undefined
    if (!id || !t || t.kind !== "audio") {
      this.setMessage("Pick a loop track to record on")
      return
    }
    if (this.recordSource === "mic" && !this.micSource && this.micStatus !== "denied" && this.micStatus !== "unsupported") {
      // Never block recording on the permission prompt: ask, then let the user press record again.
      void this.ensureMic()
      this.setMessage("Allow the microphone, then press record again")
      return
    }
    if (this.retiming) {
      this.setMessage("Changing tempo. Try again in a moment.")
      return
    }
    const ctx = this.ctx
    const sr = ctx.sampleRate
    const latencyFrames = secondsToFrames(this.latencySeconds(), sr)
    const overdub = t.hasAudio
    let boundary: number
    let countIn = false
    if (this.playing && this.startFrame !== null) {
      boundary = nextBoundary(this.nowFrame(), this.startFrame, this.L, secondsToFrames(RECORD_LEAD_S, sr))
    } else {
      const barFrames = stepFrame(16, this.L, this.loopBars * 16)
      this.startFrame = this.nowFrame() + secondsToFrames(LEAD_S, sr) + barFrames
      this.startAllVoices(this.startFrame)
      this.playing = true
      const click = this.clickBuffer
      if (click && this.countInGain) {
        const src = ctx.createBufferSource()
        src.buffer = click
        src.connect(this.countInGain)
        src.onended = () => src.disconnect()
        src.start((this.startFrame - barFrames) / sr, 0, barFrames / sr)
        this.countInSrc = src
      }
      boundary = this.startFrame
      countIn = true
    }
    const { from, to } = captureWindow(boundary, this.L, latencyFrames)
    this.captureId++
    const capId = this.captureId
    this.pending = { id: capId, trackId: id, overdub, boundary }
    this.recorder.port.postMessage({ type: "capture", id: capId, from, to })
    this.record_ = { kind: "waiting", trackId: id, overdub, countIn, startsAt: boundary / sr }
    this.emit()
    if (this.recTimer) clearTimeout(this.recTimer)
    this.recTimer = setTimeout(
      () => {
        this.recTimer = null
        if (!this.pending || this.pending.id !== capId) return
        this.record_ = { kind: "recording", trackId: id, overdub, startsAt: boundary / sr, endsAt: (boundary + this.L) / sr }
        this.emit()
      },
      Math.max(0, (boundary / sr - ctx.currentTime) * 1000),
    )
  }

  private onRecorderMessage(data: { type: string; peak?: number; id?: number; samples?: Float32Array; late?: boolean }): void {
    if (data.type === "level") {
      this.inputPeak = Math.max(this.inputPeak, data.peak ?? 0)
      return
    }
    if (data.type !== "done" || !this.pending || data.id !== this.pending.id || !data.samples) return
    const { trackId, overdub } = this.pending
    this.pending = null
    if (this.recTimer) {
      clearTimeout(this.recTimer)
      this.recTimer = null
    }
    const t = this.track(trackId)
    this.record_ = { kind: "idle" }
    if (data.late) {
      this.setMessage("The recording started late, so nothing was saved. Try again.")
      return
    }
    if (!t) {
      this.emit()
      return
    }
    const before = this.buffers.get(trackId) ?? null
    const data32 = new Float32Array(this.L)
    if (overdub && before) data32.set(before.getChannelData(0).subarray(0, this.L))
    mixInto(data32, data.samples)
    const buf = new AudioBuffer({ length: this.L, numberOfChannels: 1, sampleRate: this.sr })
    buf.copyToChannel(data32, 0)
    this.pushUndo({ trackId, before: { buffer: before }, after: { buffer: buf } })
    this.applyBuffer(trackId, buf)
    this.setMessage(`${overdub ? "Overdubbed" : "Recorded"} ${t.name}`)
  }

  private doCancelRecord(): void {
    if (this.pending) this.recorder?.port.postMessage({ type: "cancel", id: this.pending.id })
    const had = this.pending !== null || this.record_.kind !== "idle"
    this.pending = null
    if (this.recTimer) {
      clearTimeout(this.recTimer)
      this.recTimer = null
    }
    this.record_ = { kind: "idle" }
    if (had) this.emit()
  }

  // ── pads, export, share ──
  pad(index: number): void {
    if (!this.runnable() || !this.padsBus || !this.noise || !Number.isInteger(index) || index < 0 || index >= PAD_COUNT) return
    const ctx = this.ctx!
    const p = PADS[index] as { drum?: DrumVoice; tone?: number }
    const t = ctx.currentTime
    if (p.drum) playDrum(ctx, this.padsBus, p.drum, t, 1, this.noise)
    else if (p.tone !== undefined) {
      // A chord tone of the chord heard now (slot 0 while stopped), so the pads are always consonant.
      const pos = this.getClock().position
      const slot = chordAt(this.harmony, pos ? pos.step / 4 : 0)
      const midi = pitchToMidi({ kind: "chord", tone: p.tone, octave: 0 }, this.harmony.key, slot.chord, { low: 60, high: 84 })
      playKeys(ctx, this.padsBus, midi, t, 0.3, 0.9)
    }
  }

  async exportWav(loops = 2): Promise<Blob> {
    if (!this.ctx) throw new Error("Start the engine first")
    this.exporting = true
    this.emit()
    try {
      const buf = await renderMixdown({
        sampleRate: this.sr,
        loopFrames: this.L,
        bpm: this.bpm,
        masterVolume: this.masterVolume,
        loops,
        tracks: this.tracks.map((t) => ({ state: t, buffer: this.buffers.get(t.id) ?? null })),
      })
      const wav = encodeWav16([buf.getChannelData(0), buf.getChannelData(1)], this.sr)
      return new Blob([wav], { type: "audio/wav" })
    } finally {
      this.exporting = false
      this.emit()
    }
  }

  shareCode(): string {
    const tracks: ShareData["tracks"] = this.tracks.filter(isSynth).map((t) => {
      const o: ShareData["tracks"][number] = {
        id: t.id,
        kind: t.kind,
        name: t.name,
        volume: t.volume,
        pan: t.pan,
        muted: t.muted,
        soloed: t.soloed,
        fx: { ...t.fx },
      }
      if (t.drumPattern) o.drumPattern = cloneDrumPattern(t.drumPattern)
      if (t.patternId !== undefined) o.patternId = t.patternId
      if (t.sampleId !== undefined) o.sampleId = t.sampleId
      return o
    })
    return encodeShare({ v: 1, bpm: this.bpm, bars: this.bars, tracks, harmony: cloneHarmony(this.harmony) })
  }

  private doLoadShare(code: string): boolean {
    if (!isStr(code)) {
      this.setMessage("That share link isn't valid")
      return false
    }
    const data = decodeShare(code)
    if (!data) {
      this.setMessage("That share link isn't valid")
      return false
    }
    const changedTempo = data.bpm !== this.bpm || data.bars !== this.bars
    if (this.snap.tempoLocked && changedTempo) {
      this.setMessage("Clear the recorded loops before loading a shared beat")
      return false
    }
    if (data.tracks.filter((t) => t.kind !== "audio").length + this.tracks.filter((t) => t.kind === "audio").length > MAX_TRACKS) {
      this.setMessage("That beat has too many tracks to load next to your loops")
      return false
    }
    this.clearAudition()
    this.doCancelRecord()
    const audioTracks = this.tracks.filter((t) => t.kind === "audio")
    const audioIds = new Set(audioTracks.map((t) => t.id))
    const shared: TrackState[] = data.tracks
      .filter((t) => t.kind !== "audio")
      .map((t) => {
        const ts: TrackState = {
          id: audioIds.has(t.id) ? `${t.id}-s` : t.id,
          name: t.name,
          kind: t.kind,
          volume: t.volume,
          pan: t.pan,
          muted: t.muted,
          soloed: t.soloed,
          fx: { ...t.fx },
          hasAudio: false,
          peaks: [],
        }
        if (t.drumPattern) ts.drumPattern = cloneDrumPattern(t.drumPattern)
        if (t.patternId !== undefined) ts.patternId = t.patternId
        if (t.sampleId !== undefined) ts.sampleId = t.sampleId
        return ts
      })
    for (const old of this.tracks) {
      if (isSynth(old)) {
        this.disposeTrackAudio(old.id)
        this.dropHistory(old.id)
      }
    }
    this.dropHistory(HARMONY)
    this.dropTrackEntries()
    this.harmony = data.harmony ? cloneHarmony(data.harmony) : demoHarmony()
    this.tracks = [...shared, ...audioTracks]
    for (const t of shared) this.makeChannel(t)
    this.bpm = data.bpm
    this.bars = data.bars
    this.mixer?.setTempo(this.bpm)
    if (!this.track(this.selectedTrackId ?? "")) this.selectedTrackId = this.tracks[0]?.id ?? null
    this.updateAllChannels()
    if (this.ctx) {
      if (changedTempo) this.enqueueRetime()
      else for (const t of shared) this.enqueueRender(t.id)
    }
    this.emit()
    return true
  }

  private doImportProject(json: string): { ok: boolean; error?: string } {
    if (!isStr(json)) {
      const error = "importProject: expected a JSON string"
      this.setMessage(error)
      return { ok: false, error }
    }
    const parsed = parseProject(json)
    if (!parsed.ok) {
      this.setMessage(parsed.error)
      return parsed
    }
    const project = parsed.value
    const audioTracks = this.tracks.filter((t) => t.kind === "audio")
    if (project.tracks.length + audioTracks.length > MAX_TRACKS) {
      const error = "That project has too many tracks to load next to your recorded loops"
      this.setMessage(error)
      return { ok: false, error }
    }
    const changedTempo = project.bpm !== this.bpm || project.bars !== this.bars
    if (this.snap.tempoLocked && changedTempo) {
      const error = "Clear the recorded loops before importing a project with a different tempo"
      this.setMessage(error)
      return { ok: false, error }
    }
    this.clearAudition()
    this.doCancelRecord()
    const audioIds = new Set(audioTracks.map((t) => t.id))
    const incoming = project.tracks.map((t) => (audioIds.has(t.id) ? { ...t, id: `${t.id}-p` } : t))
    for (const old of this.tracks) {
      if (isSynth(old)) {
        this.disposeTrackAudio(old.id)
        this.dropHistory(old.id)
      }
    }
    this.dropHistory(HARMONY)
    this.dropTrackEntries()
    this.harmony = cloneHarmony(project.harmony)
    this.tracks = [...incoming, ...audioTracks]
    for (const t of incoming) this.makeChannel(t)
    this.bpm = project.bpm
    this.bars = project.bars
    this.metronome = project.metronome
    this.masterVolume = project.masterVolume
    this.mixer?.setTempo(this.bpm)
    this.mixer?.setMasterVolume(this.masterVolume)
    if (this.ctx && this.metronomeGain) this.metronomeGain.gain.setTargetAtTime(this.metronome ? 0.6 : 0, this.ctx.currentTime, 0.01)
    if (!this.track(this.selectedTrackId ?? "")) this.selectedTrackId = this.tracks[0]?.id ?? null
    this.updateAllChannels()
    if (this.ctx) {
      if (changedTempo) this.enqueueRetime()
      else for (const t of incoming) this.enqueueRender(t.id)
    }
    this.setMessage("Project loaded")
    this.emit()
    return { ok: true }
  }

  // ── meters ──
  getPhase(): number | null {
    const ctx = this.ctx
    if (!ctx || !this.playing || this.startFrame === null) return null
    const f = Math.round((ctx.currentTime - this.heardLatency()) * ctx.sampleRate)
    return loopPhase(f, this.startFrame, this.L)
  }
  getLevels(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const t of this.tracks) out[t.id] = this.channels.get(t.id)?.meter() ?? 0
    return out
  }
  getMasterLevel(): number {
    return this.mixer?.masterMeter() ?? 0
  }
  getInputLevel(): number {
    const p = this.inputPeak
    this.inputPeak = 0
    return p
  }
}

let instance: LoopEngine | null = null

/** The app-wide engine. On the client it is also exposed as window.__loopcraft for probes. */
export function getEngine(): LoopEngine {
  if (!instance) {
    instance = new LoopEngine()
    if (typeof window !== "undefined") (window as unknown as { __loopcraft: LoopEngine }).__loopcraft = instance
  }
  return instance
}
