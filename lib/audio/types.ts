// Shared types for the LoopCraft audio engine. This file is the contract between the
// engine modules and the UI: workers implement against it and must not change it.

import type { Harmony, Mode } from "../harmony/types.ts"

/** Steps per bar in every pattern grid (16th notes, 4/4). */
export const STEPS_PER_BAR = 16
export const BEATS_PER_BAR = 4

export const MIN_BPM = 60
export const MAX_BPM = 180
export const BAR_OPTIONS = [1, 2, 4] as const
export type Bars = (typeof BAR_OPTIONS)[number]

/** Hard cap on track count (keeps the mixer and the 800×520 embed layout bounded). */
export const MAX_TRACKS = 8

export const DRUM_VOICES = ["kick", "snare", "clap", "hat"] as const
export type DrumVoice = (typeof DRUM_VOICES)[number]

/**
 * One bar of drums. Each lane has exactly STEPS_PER_BAR cells:
 * 0 = off, 1 = hit, 2 = accented hit. The bar repeats for every bar of the loop.
 */
export type DrumPattern = Record<DrumVoice, number[]>

/** A note in a melodic pattern, positioned on the 16th-note grid from the loop start. */
export interface NoteEvent {
  /** 16th-note index from the start of the pattern (0-based). */
  step: number
  /** Duration in 16th notes (> 0, may be fractional). */
  length: number
  /** MIDI note number (69 = A4 = 440 Hz). */
  midi: number
  /** 0..1 */
  velocity: number
}

/** A preset melodic pattern. It repeats when shorter than the loop and is cut when longer. */
export interface MelodicPattern {
  id: string
  name: string
  bars: number
  notes: NoteEvent[]
}

/**
 * "drums" | "bass" | "keys": synthesized — the engine renders the pattern into a loop buffer
 * and re-renders on every edit. "audio": recorded from the mic or the pads instrument.
 */
export type TrackKind = "drums" | "bass" | "keys" | "sample" | "audio"

export interface TrackFx {
  /** DJ filter, -1..1. < 0 sweeps a low-pass down, > 0 sweeps a high-pass up, 0 is flat. */
  filter: number
  /** Waveshaper drive, 0..1. 0 bypasses the shaper. */
  drive: number
  /** Post-fader send to the shared tempo-synced delay bus, 0..1. */
  delay: number
  /** Post-fader send to the shared convolution reverb bus, 0..1. */
  reverb: number
}

export interface TrackState {
  id: string
  name: string
  kind: TrackKind
  /** Fader position 0..1 (gain = faderToGain(volume)). */
  volume: number
  /** -1 (left) .. 1 (right) */
  pan: number
  muted: boolean
  soloed: boolean
  fx: TrackFx
  /** Present only when kind === "drums". */
  drumPattern?: DrumPattern
  /** Present only when kind === "bass" | "keys": id of a preset in patterns.ts. */
  patternId?: string
  /** Present only when kind === "sample": id of an entry in lib/samples/library.ts. */
  sampleId?: string
  /** True when the track has a loop buffer with content (rendered or recorded). */
  hasAudio: boolean
  /** Waveform overview of the loop buffer: max |sample| per bin, 0..1. Empty when no audio. */
  peaks: number[]
}

export type RecordSource = "mic" | "pads"
export type MicStatus = "unknown" | "prompting" | "granted" | "denied" | "unsupported"

export type RecordPhase =
  | { kind: "idle" }
  /** Armed and waiting for the capture to begin (count-in, or the next loop boundary). */
  | { kind: "waiting"; trackId: string; overdub: boolean; countIn: boolean; startsAt: number }
  /** Capturing. Times are AudioContext seconds (startsAt/endsAt bound the heard loop pass). */
  | { kind: "recording"; trackId: string; overdub: boolean; startsAt: number; endsAt: number }

/**
 * "idle": no AudioContext yet; a user gesture must call start().
 * "starting": context created, demo buffers rendering.
 * "ready": running.
 * "suspended": the browser suspended or interrupted the context; a gesture must call start() again.
 * "error": Web Audio or AudioWorklet unavailable; `error` holds a human-readable reason.
 */
export type EngineStatus = "idle" | "starting" | "ready" | "suspended" | "error"

/** Immutable snapshot for React (useSyncExternalStore). A new object on every change. */
export interface EngineSnapshot {
  status: EngineStatus
  error: string | null
  playing: boolean
  bpm: number
  bars: Bars
  /** True while any audio track holds a recorded buffer, including a silent take: tempo and bars cannot change. */
  tempoLocked: boolean
  /** Number of audio tracks that hold a recorded buffer, including silent takes. */
  recordedLoops: number
  /** Integer frames in one loop at the current tempo/length, or 1 before the audio starts. */
  loopFrames: number
  /** AudioContext sample rate, or 0 before the audio starts. */
  sampleRate: number
  /** True while a tempo/length retime is queued or rendering; loopFrames may not match bpm/bars yet. */
  retiming: boolean
  /** True when exportWav can render audio that matches the current bpm/bars. */
  exportReady: boolean
  metronome: boolean
  masterVolume: number
  tracks: TrackState[]
  selectedTrackId: string | null
  record: RecordPhase
  recordSource: RecordSource
  micStatus: MicStatus
  /** Total latency compensation applied to the current record source, in ms (estimate + offset). */
  latencyMs: number
  /** User nudge added to the automatic estimate, in ms (-100..100). */
  latencyOffsetMs: number
  canUndo: boolean
  canRedo: boolean
  exporting: boolean
  /** Short status line for the UI (e.g. "Mic blocked. Record from the pads instead."). */
  message: string | null
  /** Key, mode and chord lane. Bass and keys parts are realised against it. */
  harmony: Harmony
  /**
   * The shelf loop being auditioned right now, or null. Preview state only: it is never written to
   * the project document, the undo history or a CommandEvent.
   */
  audition: { sampleId: string; startedAt: number } | null
}

/**
 * Shareable session (URL hash `#s=<code>`): tempo, length and every synthesized track's pattern
 * and mix. Recorded audio is never included.
 */
export interface ShareData {
  v: 1
  bpm: number
  bars: Bars
  tracks: Array<
    Pick<TrackState, "id" | "kind" | "name" | "volume" | "pan" | "muted" | "soloed" | "fx" | "drumPattern" | "patternId" | "sampleId">
  >
  /** Key, mode and chord lane. Absent in codes made before harmony existed: the demo harmony is used. */
  harmony?: Harmony
}

// ── v2 seams: pluggable sources, a command/event API, a readable clock ──

/** What a source must render: one loop of exactly `loopFrames` frames. */
export interface LoopSpec {
  sampleRate: number
  loopFrames: number
  bars: number
}

/**
 * Produces a track's loop buffer. The engine asks a track's source to render on every edit or
 * tempo change. Implemented today by the offline synth (drums/bass/keys) and by recorded or
 * sampled audio; an external pattern source (e.g. a live-coded pattern) implements the same thing.
 */
export interface LoopSource {
  readonly kind: "synth" | "recording" | "sample"
  /** A buffer of exactly spec.loopFrames frames, or null when there is nothing to play. */
  render(spec: LoopSpec): Promise<AudioBuffer | null>
}

/**
 * Every state-changing action, as data. The UI's method calls and an agent's dispatch() go through
 * the same path, so both are logged as events and both land on the undo stack where undoable.
 * (Pad hits are performance, not session edits, and are not commands.)
 */
export type EngineCommand =
  | { type: "play" }
  | { type: "stop" }
  | { type: "setBpm"; bpm: number }
  | { type: "setBars"; bars: Bars }
  | { type: "setMetronome"; on: boolean }
  | { type: "setMasterVolume"; volume: number }
  | { type: "selectTrack"; id: string }
  | { type: "addAudioTrack" }
  | { type: "addSampleTrack"; sampleId: string }
  | { type: "importProject"; json: string }
  | { type: "removeTrack"; id: string }
  | { type: "clearTrack"; id: string }
  | { type: "setTrack"; id: string; patch: Partial<Pick<TrackState, "name" | "volume" | "pan" | "muted" | "soloed">> }
  | { type: "setTrackFx"; id: string; patch: Partial<TrackFx> }
  | { type: "toggleStep"; id: string; voice: DrumVoice; step: number }
  | { type: "setPattern"; id: string; patternId: string }
  | { type: "setRecordSource"; source: RecordSource }
  | { type: "setLatencyOffset"; ms: number }
  | { type: "record"; trackId?: string }
  | { type: "cancelRecord" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "loadShare"; code: string }
  | { type: "setKey"; tonic: string; mode: Mode }
  | { type: "setChord"; index: number; roman: string }
  | { type: "setProgression"; romans: string }

/** A command that was applied, in order. `origin` is "user" for UI calls, or whatever the dispatcher passed. */
export interface CommandEvent {
  seq: number
  origin: string
  command: EngineCommand
}

/** The session as a JSON-serialisable document (recorded audio is referenced by track id, not embedded). */
export interface SessionDocument {
  v: 1
  bpm: number
  bars: Bars
  metronome: boolean
  masterVolume: number
  tracks: Array<
    Pick<TrackState, "id" | "kind" | "name" | "volume" | "pan" | "muted" | "soloed" | "fx" | "drumPattern" | "patternId" | "sampleId" | "hasAudio">
  >
  harmony: Harmony
}

/** Transport, readable by an external scheduler. All times are AudioContext seconds. */
export interface TransportClock {
  playing: boolean
  bpm: number
  bars: Bars
  sampleRate: number
  loopFrames: number
  /** Context time of loop position 0 (pass k starts at startTime + k * loopFrames / sampleRate); null when stopped. */
  startTime: number | null
  /** ctx.currentTime, or 0 before start(). */
  contextTime: number
  /** What is being HEARD now (output-latency compensated); null when stopped. step is 0..bars*16-1 within the loop. */
  position: { loop: number; bar: number; beat: number; step: number; phase: number } | null
}

/** Numeric ids of the 8 pads in the pads instrument: 0..3 drums, 4..7 pitched stabs. */
export const PAD_COUNT = 8

/** Public engine API. The UI talks to the engine only through this interface. */
export interface LoopEngineApi {
  subscribe(listener: () => void): () => void
  getSnapshot(): EngineSnapshot

  /**
   * Call from a user-gesture handler. Creates (or resumes) the AudioContext, loads the
   * AudioWorklet, renders the demo session and, when `autoplay` is true, starts playback.
   * Idempotent; safe to call again to resume a suspended context.
   */
  start(opts?: { autoplay?: boolean }): Promise<void>

  play(): void
  stop(): void
  togglePlay(): void
  /** Clamped to MIN_BPM..MAX_BPM. No-op (with a message) while tempoLocked. */
  setBpm(bpm: number): void
  /** No-op (with a message) while tempoLocked. */
  setBars(bars: Bars): void
  setMetronome(on: boolean): void
  setMasterVolume(volume: number): void

  selectTrack(id: string): void
  /** Adds an empty "audio" track (no-op at MAX_TRACKS). Returns the new id or null. */
  addAudioTrack(): string | null
  /**
   * Adds a ready-made loop from the sample shelf as a "sample" track (no-op at MAX_TRACKS or when the
   * id isn't in lib/samples/library.ts). Returns the new id or null. Undoable (one step): undo removes
   * the track and redo adds it back with the same id. The loop is rendered by the same
   * synths from absolute pitches, so it keeps its stated key instead of following key changes.
   * Committing the sample ends any preview of it, so the new track is not doubled.
   */
  addSampleTrack(sampleId: string): string | null
  /**
   * Auditions a shelf loop without adding it to the session: one at a time, rendered by the same
   * synths at the project's current loop length and played through the mixer on the audio clock.
   * Auditioning the same loop again retriggers it; a different one stops the previous preview.
   * Returns false (state unchanged) for an unknown id or when audio is not running. Not undoable:
   * it never changes the project document.
   */
  auditionSample(sampleId: string): boolean
  /** Stops the current preview. Safe to call when nothing is auditioning. */
  stopAudition(): void
  /** Removes a track. Removing a "sample" track is undoable; removing any other kind is not. */
  removeTrack(id: string): void
  /** Audio track: drops the recording (undoable). Drum track: clears every step (undoable). */
  clearTrack(id: string): void
  setTrack(id: string, patch: Partial<Pick<TrackState, "name" | "volume" | "pan" | "muted" | "soloed">>): void
  setTrackFx(id: string, patch: Partial<TrackFx>): void
  /** Cycles a drum cell 0 → 1 → 2 → 0 (undoable). */
  toggleStep(id: string, voice: DrumVoice, step: number): void
  /** Selects a bass/keys preset (undoable). */
  setPattern(id: string, patternId: string): void

  setRecordSource(source: RecordSource): void
  setLatencyOffset(ms: number): void
  /**
   * Arms a one-loop recording on the track (default: selected track; must be "audio").
   * Playing: capture starts at the next loop boundary. Stopped: transport starts with a
   * one-bar count-in and capture starts at bar 1. The capture is exactly one loop long and is
   * overdubbed (summed) when the track already has audio. Calling while waiting or recording
   * cancels and discards. Requests mic permission when the source is "mic".
   */
  record(trackId?: string): Promise<void>
  cancelRecord(): void
  undo(): void
  redo(): void

  /** Plays pad 0..PAD_COUNT-1 now (and into the recorder when the source is "pads"). */
  pad(index: number): void

  /** Renders `loops` passes of the mix offline (same graph as live) and encodes 16-bit WAV. */
  exportWav(loops?: number): Promise<Blob>

  /** share.encodeShare of the current tempo, bars and synthesized tracks. */
  shareCode(): string
  /**
   * Applies a share code (works before or after start()). Replaces the synthesized tracks with the
   * shared ones (keeping the audio tracks), sets bpm/bars and re-renders. Returns false (state
   * unchanged, with a message) when the code is invalid or tempoLocked would block the change.
   */
  loadShare(code: string): boolean

  /**
   * Sets the key (tonic like "A", "Bb", "F#"; any mode). Chords stay Roman numerals, so the progression
   * moves with the key and diatonic chords take the new mode's qualities; bass and keys re-render.
   * Invalid tonic → no-op. Undoable (one step).
   */
  setKey(tonic: string, mode: Mode): void
  /**
   * Replaces chord slot `index` (0-based bar) with a Roman numeral parsed in the current key ("ii7", "V7/V",
   * "bVII", "IVmaj7", "viiø7"). Returns false (no change) when the numeral doesn't parse or index is out of
   * range. Undoable.
   */
  setChord(index: number, roman: string): boolean
  /**
   * Replaces the whole chord lane: space-separated Roman numerals, one bar each (1..8 chords). Returns false
   * (no change) if any numeral fails to parse. Undoable.
   */
  setProgression(romans: string): boolean

  /**
   * Applies a command (the same code path as the matching method above), emits a CommandEvent with
   * this origin, and returns once the command has been applied (record resolves after arming).
   */
  dispatch(command: EngineCommand, origin?: string): Promise<void>
  /** Subscribes to applied commands (from the UI and from dispatch). Returns an unsubscribe function. */
  onCommand(listener: (event: CommandEvent) => void): () => void
  /** The current session as a serialisable document. */
  getDocument(): SessionDocument
  /**
   * The documented project JSON (see lib/audio/project.ts and the README): key, tempo, chord lane,
   * tracks with their patterns/instruments and mix. Recorded audio is not included.
   */
  exportProject(): string
  /**
   * Validates and applies the documented project JSON. Replaces the synth/sample tracks, keeps your
   * recorded loops, and leaves the session untouched when the document is invalid. Never throws.
   */
  importProject(json: string): { ok: boolean; error?: string }
  /** Transport clock for external schedulers. */
  getClock(): TransportClock

  /** Loop position 0..1 of what is currently heard (output-latency compensated); null when stopped. */
  getPhase(): number | null
  /** Peak level 0..1 per track id since the previous call. */
  getLevels(): Record<string, number>
  getMasterLevel(): number
  /** Peak level 0..1 of the active record input since the previous call. */
  getInputLevel(): number
}
