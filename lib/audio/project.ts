// The project bridge: one small, documented JSON shape that an external agent (or a human) can read
// and write without the app running. It is intentionally boring:
//
//   {
//     "format": "loopcraft-project",
//     "version": 1,
//     "tempo": 92,
//     "bars": 4,
//     "key": { "tonic": "A", "mode": "aeolian" },
//     "chordLane": ["i7", "VImaj7", "IIImaj7", "VII6"],
//     "metronome": false,
//     "masterVolume": 0.9,
//     "tracks": [
//       { "id": "drums", "name": "Drums", "kind": "drums",
//         "drumPattern": { "kick": [0,0,...16 numbers 0-2...], "snare": [...], "clap": [...], "hat": [...] } },
//       { "id": "bass", "name": "Bass", "kind": "bass", "patternId": "bass-pulse" },
//       { "id": "sample-1", "name": "Am7 Rhodes", "kind": "sample", "sampleId": "keys-am7-rhodes" },
//       ... and every track also carries volume, pan, muted, soloed, fx: {filter,drive,delay,reverb} ...
//     ]
//   }
//
// Rules:
//  - The key is the source of truth for harmony; chordLane is one Roman numeral per bar (1..8 bars).
//  - A loop's notes are REAL only for "sample" tracks, which reference a stated loop from
//    lib/samples/library.ts by id. Bass/keys reference a harmony-relative preset by patternId.
//  - Recorded audio (mic / pads) is never part of this file: it is local-only, and importing a
//    project leaves the recorded tracks you already have untouched.
//  - Unknown fields are ignored; every numeric field is clamped, and any structural error rejects
//    the whole document with one plain sentence instead of half-applying it.
//
// Pure data: no Web Audio, no DOM. Run under `node --test` (tests/project.test.ts).

import type { Bars, DrumPattern, TrackFx, TrackKind, TrackState } from "./types.ts"
import { BAR_OPTIONS, DRUM_VOICES, MAX_BPM, MAX_TRACKS, MIN_BPM, STEPS_PER_BAR } from "./types.ts"
import type { Chord, Harmony, Mode } from "../harmony/types.ts"
import { MODES } from "../harmony/types.ts"
import { formatNoteName, parseNoteName, parseRoman, romanNumeral } from "../harmony/theory.ts"
import { BASS_PARTS, KEYS_PARTS } from "../harmony/presets.ts"
import { findSample } from "../samples/library.ts"

export const PROJECT_FORMAT = "loopcraft-project"
export const PROJECT_VERSION = 1

/** The documented on-disk shape. Keep this in sync with the doc comment above and the README. */
export interface ProjectJson {
  format: typeof PROJECT_FORMAT
  version: typeof PROJECT_VERSION
  tempo: number
  bars: Bars
  key: { tonic: string; mode: Mode }
  /** One Roman numeral per bar, parsed in `key`. */
  chordLane: string[]
  metronome: boolean
  masterVolume: number
  /** Synth and sample tracks only; recorded audio is local-only. */
  tracks: ProjectTrackJson[]
}

export interface ProjectTrackJson {
  id: string
  name: string
  kind: TrackKind
  volume: number
  pan: number
  muted: boolean
  soloed: boolean
  fx: TrackFx
  drumPattern?: DrumPattern
  patternId?: string
  sampleId?: string
}

/** A parsed, ready-to-apply project. Track state is complete (no recorded buffers). */
export interface LoadedProject {
  bpm: number
  bars: Bars
  metronome: boolean
  masterVolume: number
  harmony: Harmony
  tracks: TrackState[]
}

export type ProjectParseResult = { ok: true; value: LoadedProject } | { ok: false; error: string }

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x)
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x)
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

function snapBars(n: number): Bars {
  let best: Bars = BAR_OPTIONS[0]
  let bestDist = Infinity
  for (const o of BAR_OPTIONS) {
    const d = Math.abs(o - n)
    if (d <= bestDist) {
      best = o
      bestDist = d
    }
  }
  return best
}

function readFx(raw: unknown): TrackFx {
  const o = isObj(raw) ? raw : {}
  const num = (k: string, lo: number, hi: number, d: number) => (isNum(o[k]) ? clamp(o[k] as number, lo, hi) : d)
  return {
    filter: num("filter", -1, 1, 0),
    drive: num("drive", 0, 1, 0),
    delay: num("delay", 0, 1, 0),
    reverb: num("reverb", 0, 1, 0),
  }
}

function readDrumPattern(raw: unknown): DrumPattern | null {
  if (!isObj(raw)) return null
  const out = {} as DrumPattern
  for (const voice of DRUM_VOICES) {
    const lane = raw[voice]
    if (!Array.isArray(lane) || lane.length !== STEPS_PER_BAR) return null
    const cells = lane.map((v) => (isNum(v) && Number.isInteger(v) && v >= 0 && v <= 2 ? v : null))
    if (cells.some((v) => v === null)) return null
    out[voice] = cells as number[]
  }
  return out
}

/** The project as pretty JSON for an agent to read or write. */
export function stringifyProject(project: ProjectJson): string {
  return `${JSON.stringify(project, null, 2)}\n`
}

/**
 * SessionDocument (engine.getDocument()) → the documented project shape. Recorded audio tracks are
 * dropped: the file is about the composition, not about this browser's recordings.
 */
export function toProject(doc: {
  bpm: number
  bars: Bars
  metronome: boolean
  masterVolume: number
  harmony: Harmony
  tracks: Array<Pick<TrackState, "id" | "kind" | "name" | "volume" | "pan" | "muted" | "soloed" | "fx" | "drumPattern" | "patternId" | "sampleId">>
}): ProjectJson {
  const key = doc.harmony.key
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    tempo: doc.bpm,
    bars: doc.bars,
    key: { tonic: formatNoteName(key.tonic, true), mode: key.mode },
    chordLane: doc.harmony.chords.map((slot) => romanNumeral(key, slot.chord, true)),
    metronome: doc.metronome,
    masterVolume: clamp(doc.masterVolume, 0, 1),
    tracks: doc.tracks
      .filter((t) => t.kind !== "audio")
      .map((t) => {
        const o: ProjectTrackJson = {
          id: t.id,
          name: t.name,
          kind: t.kind,
          volume: clamp(t.volume, 0, 1),
          pan: clamp(t.pan, -1, 1),
          muted: t.muted,
          soloed: t.soloed,
          fx: { ...t.fx },
        }
        if (t.drumPattern) o.drumPattern = { kick: [...t.drumPattern.kick], snare: [...t.drumPattern.snare], clap: [...t.drumPattern.clap], hat: [...t.drumPattern.hat] }
        if (t.patternId !== undefined) o.patternId = t.patternId
        if (t.sampleId !== undefined) o.sampleId = t.sampleId
        return o
      }),
  }
}

/**
 * Validates the documented project JSON and turns it into a LoadedProject. Accepts an already-parsed
 * object or a JSON string. Never throws: every problem comes back as `{ ok: false, error }` naming
 * the field and the expected shape. Clamps numbers; rejects structural errors.
 */
export function parseProject(input: unknown): ProjectParseResult {
  let raw: unknown = input
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input)
    } catch {
      return { ok: false, error: "That isn't valid JSON." }
    }
  }
  if (!isObj(raw)) return { ok: false, error: "The project must be a JSON object." }
  if (raw.format !== PROJECT_FORMAT) return { ok: false, error: `Expected format "${PROJECT_FORMAT}".` }
  if (raw.version !== PROJECT_VERSION) return { ok: false, error: `Unsupported project version ${String(raw.version)}; this build reads version ${PROJECT_VERSION}.` }

  // key
  const k = raw.key
  if (!isObj(k) || typeof k.tonic !== "string" || typeof k.mode !== "string") return { ok: false, error: 'key must look like { "tonic": "A", "mode": "aeolian" }.' }
  const tonic = parseNoteName(k.tonic)
  if (!tonic) return { ok: false, error: `Unreadable key tonic "${k.tonic}". Use note names like C, F#, Bb.` }
  if (!(MODES as readonly string[]).includes(k.mode)) return { ok: false, error: `Unknown mode "${k.mode}".` }
  const key = { tonic, mode: k.mode as Mode }

  // chord lane
  if (!Array.isArray(raw.chordLane) || raw.chordLane.length < 1 || raw.chordLane.length > 8) {
    return { ok: false, error: "chordLane must hold 1 to 8 Roman numerals (one per bar)." }
  }
  const chords: Harmony["chords"] = []
  for (let i = 0; i < raw.chordLane.length; i++) {
    const numeral = raw.chordLane[i]
    if (typeof numeral !== "string") return { ok: false, error: `chordLane[${i}] must be a Roman numeral string.` }
    const chord: Chord | null = parseRoman(numeral.trim(), key)
    if (!chord) return { ok: false, error: `chordLane[${i}] "${numeral}" isn't a chord in ${k.tonic} ${k.mode}.` }
    chords.push({ start: i * 4, length: 4, chord })
  }

  // tempo / length / mix
  if (!isNum(raw.tempo)) return { ok: false, error: "tempo must be a number." }
  if (!isNum(raw.bars)) return { ok: false, error: "bars must be a number (1, 2 or 4)." }
  const bpm = clamp(Math.round(raw.tempo), MIN_BPM, MAX_BPM)
  const bars = snapBars(raw.bars)
  const metronome = raw.metronome === true
  const masterVolume = isNum(raw.masterVolume) ? clamp(raw.masterVolume, 0, 1) : 0.9

  // tracks
  if (!Array.isArray(raw.tracks)) return { ok: false, error: "tracks must be an array." }
  if (raw.tracks.length > MAX_TRACKS) return { ok: false, error: `At most ${MAX_TRACKS} tracks.` }
  const ids = new Set<string>()
  const tracks: TrackState[] = []
  for (let i = 0; i < raw.tracks.length; i++) {
    const r = raw.tracks[i]
    if (!isObj(r)) return { ok: false, error: `tracks[${i}] must be an object.` }
    if (typeof r.id !== "string" || !ID_RE.test(r.id)) return { ok: false, error: `tracks[${i}].id must match ${ID_RE}.` }
    if (ids.has(r.id)) return { ok: false, error: `Duplicate track id "${r.id}".` }
    ids.add(r.id)
    if (typeof r.name !== "string" || r.name.trim() === "") return { ok: false, error: `tracks[${i}].name must be a non-empty string.` }
    if (r.kind !== "drums" && r.kind !== "bass" && r.kind !== "keys" && r.kind !== "sample") {
      return { ok: false, error: `tracks[${i}].kind must be drums, bass, keys or sample (recorded audio isn't part of a project file).` }
    }
    const kind = r.kind
    const volume = isNum(r.volume) ? clamp(r.volume, 0, 1) : 0.8
    const pan = isNum(r.pan) ? clamp(r.pan, -1, 1) : 0
    const fx = readFx(r.fx)
    const track: TrackState = {
      id: r.id,
      name: r.name.trim().slice(0, 24),
      kind,
      volume,
      pan,
      muted: r.muted === true,
      soloed: r.soloed === true,
      fx,
      hasAudio: false,
      peaks: [],
    }
    if (kind === "drums") {
      const pattern = readDrumPattern(r.drumPattern)
      if (!pattern) return { ok: false, error: `tracks[${i}].drumPattern must hold kick, snare, clap and hat lanes of ${STEPS_PER_BAR} cells each (0 off, 1 hit, 2 accent).` }
      track.drumPattern = pattern
    } else if (kind === "bass" || kind === "keys") {
      if (typeof r.patternId !== "string") return { ok: false, error: `tracks[${i}].patternId is required for a ${kind} track.` }
      const parts = kind === "bass" ? BASS_PARTS : KEYS_PARTS
      if (!parts.some((p) => p.id === r.patternId)) return { ok: false, error: `tracks[${i}].patternId "${r.patternId}" isn't a ${kind} preset in this build.` }
      track.patternId = r.patternId
    } else {
      if (typeof r.sampleId !== "string") return { ok: false, error: `tracks[${i}].sampleId is required for a sample track.` }
      if (!findSample(r.sampleId)) return { ok: false, error: `tracks[${i}].sampleId "${r.sampleId}" isn't in the sample library.` }
      track.sampleId = r.sampleId
    }
    tracks.push(track)
  }

  return {
    ok: true,
    value: { bpm, bars, metronome, masterVolume, harmony: { key, beatsPerBar: 4, chords }, tracks },
  }
}
