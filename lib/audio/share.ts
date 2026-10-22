// Share-link codec. Pure — unit-tested under Node.

import { BAR_OPTIONS, DRUM_VOICES, MAX_BPM, MAX_TRACKS, MIN_BPM, STEPS_PER_BAR } from "./types.ts"
import type { Bars, DrumPattern, ShareData, TrackFx, TrackKind } from "./types.ts"

type ShareTrack = ShareData["tracks"][number]

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ""
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function fromBase64Url(code: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(code)) throw new Error("bad base64url")
  const b64 = code.replace(/-/g, "+").replace(/_/g, "/")
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
}

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

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x)
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x)


/**
 * Encodes as base64url (RFC 4648 §5, no padding) of compact JSON. Drum lanes are written as
 * 16-character digit strings ("2000000100200000") to keep URLs short. Only tracks whose kind is
 * "drums" | "bass" | "keys" are written. Must round-trip: decodeShare(encodeShare(d)) deep-equals d
 * for any valid d with only synthesized tracks. Must work in both browsers and Node (no Buffer;
 * use TextEncoder + btoa/atob, both available in Node >= 16).
 */
export function encodeShare(data: ShareData): string {
  const tracks = data.tracks
    .filter((t) => t.kind === "drums" || t.kind === "bass" || t.kind === "keys")
    .map((t) => {
      const o: Record<string, unknown> = {
        id: t.id,
        k: t.kind,
        n: t.name,
        v: t.volume,
        p: t.pan,
        m: t.muted,
        s: t.soloed,
        f: [t.fx.filter, t.fx.drive, t.fx.delay, t.fx.reverb],
      }
      if (t.drumPattern) o.d = DRUM_VOICES.map((voice) => t.drumPattern![voice].join(""))
      if (t.patternId !== undefined) o.pid = t.patternId
      return o
    })
  return toBase64Url(JSON.stringify({ v: 1, bpm: data.bpm, bars: data.bars, t: tracks }))
}

/**
 * Inverse of encodeShare. Returns null for anything malformed: bad base64/JSON, v !== 1, unknown
 * kind, a drum lane that is not 16 digits 0-2, a missing patternId on bass/keys, more than
 * MAX_TRACKS tracks, a code longer than 4096 characters (checked before decoding), a track id that
 * is empty, longer than 64 characters, not matching /^[A-Za-z0-9_-]+$/, or duplicated within the
 * code. Numbers are clamped into range (bpm MIN_BPM..MAX_BPM, bars snapped to the
 * nearest of BAR_OPTIONS, volume 0..1, pan -1..1, fx.filter -1..1, other fx 0..1); names are cut
 * to 24 characters. Never throws.
 */
export function decodeShare(code: string): ShareData | null {
  if (code.length > 4096) return null
  try {
    const raw: unknown = JSON.parse(fromBase64Url(code))
    if (!isObj(raw) || raw.v !== 1 || !isNum(raw.bpm) || !isNum(raw.bars) || !Array.isArray(raw.t)) return null
    if (raw.t.length > MAX_TRACKS) return null
    const tracks: ShareTrack[] = []
    const seenIds = new Set<string>()
    for (const r of raw.t) {
      if (!isObj(r)) return null
      if (typeof r.id !== "string" || typeof r.n !== "string") return null
      if (r.id.length === 0 || r.id.length > 64 || !/^[A-Za-z0-9_-]+$/.test(r.id) || seenIds.has(r.id)) return null
      seenIds.add(r.id)
      if (r.k !== "drums" && r.k !== "bass" && r.k !== "keys") return null
      if (!isNum(r.v) || !isNum(r.p) || typeof r.m !== "boolean" || typeof r.s !== "boolean") return null
      if (!Array.isArray(r.f) || r.f.length !== 4 || !r.f.every(isNum)) return null
      const [filter, drive, delay, reverb] = r.f as number[]
      const fx: TrackFx = {
        filter: clamp(filter, -1, 1),
        drive: clamp(drive, 0, 1),
        delay: clamp(delay, 0, 1),
        reverb: clamp(reverb, 0, 1),
      }
      const track: ShareTrack = {
        id: r.id,
        kind: r.k as TrackKind,
        name: r.n.slice(0, 24),
        volume: clamp(r.v, 0, 1),
        pan: clamp(r.p, -1, 1),
        muted: r.m,
        soloed: r.s,
        fx,
      }
      if (r.d !== undefined) {
        if (!Array.isArray(r.d) || r.d.length !== DRUM_VOICES.length) return null
        const pattern = {} as DrumPattern
        const re = new RegExp(`^[0-2]{${STEPS_PER_BAR}}$`)
        for (let i = 0; i < DRUM_VOICES.length; i++) {
          const lane = r.d[i]
          if (typeof lane !== "string" || !re.test(lane)) return null
          pattern[DRUM_VOICES[i]] = Array.from(lane, Number)
        }
        track.drumPattern = pattern
      }
      if (r.k === "bass" || r.k === "keys") {
        if (typeof r.pid !== "string") return null
        track.patternId = r.pid
      } else if (r.pid !== undefined) {
        if (typeof r.pid !== "string") return null
        track.patternId = r.pid
      }
      tracks.push(track)
    }
    return { v: 1, bpm: clamp(raw.bpm, MIN_BPM, MAX_BPM), bars: snapBars(raw.bars), tracks }
  } catch {
    return null
  }
}
