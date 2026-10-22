"use client"

import { useMemo } from "react"
import { BASS_PARTS, KEYS_PARTS, findPart } from "@/lib/harmony/presets"
import { realizePart } from "@/lib/harmony/realize"
import { STEPS_PER_BAR, type TrackState } from "@/lib/audio/types"
import { useEngine } from "./useEngine"
import styles from "./PatternPicker.module.css"

const H = 120
const NOTE_H = 4
const BEAT_STEPS = STEPS_PER_BAR / 4

export default function PatternPicker({ track }: { track: TrackState }) {
  const { engine, snap } = useEngine()
  const list = track.kind === "bass" ? BASS_PARTS : KEYS_PARTS
  const part = (track.patternId ? findPart(track.patternId) : undefined) ?? list[0]
  const bars = snap.bars
  const totalSteps = bars * STEPS_PER_BAR

  // Re-harmonises live: realised against the current key and chord lane.
  const notes = useMemo(() => realizePart(part, snap.harmony, bars * 4), [part, snap.harmony, bars])

  let lo = 0
  let hi = 0
  if (notes.length) {
    lo = Math.min(...notes.map((n) => n.midi))
    hi = Math.max(...notes.map((n) => n.midi))
  }
  const rows = hi - lo + 1
  const usable = H - 2 * NOTE_H
  const yOf = (midi: number) => NOTE_H + (rows <= 1 ? usable / 2 : (1 - (midi - lo) / (rows - 1)) * usable)

  return (
    <div className={styles.wrap}>
      <div className={styles.seg} role="group" aria-label="Pattern">
        {list.map((p) => (
          <button key={p.id} type="button" className={styles.segBtn} aria-pressed={part.id === p.id} onClick={() => engine.setPattern(track.id, p.id)}>
            {p.name}
          </button>
        ))}
      </div>
      <svg className={styles.roll} viewBox={`0 0 ${totalSteps} ${H}`} preserveAspectRatio="none" role="img" aria-label="Pattern preview, coloured by chord tone, scale tone and chromatic note">
        {Array.from({ length: bars + 1 }, (_, i) => (
          <line key={i} className={styles.bar} x1={i * STEPS_PER_BAR} x2={i * STEPS_PER_BAR} y1={0} y2={H} vectorEffect="non-scaling-stroke" />
        ))}
        {notes.map((n, i) => (
          <rect
            key={i}
            className={n.role === "chord-tone" ? styles.note : n.role === "scale-tone" ? styles.noteScale : styles.noteChromatic}
            x={n.start * BEAT_STEPS}
            y={yOf(n.midi) - NOTE_H / 2}
            width={Math.max(0.3, n.length * BEAT_STEPS)}
            height={NOTE_H}
            rx={1}
            opacity={0.5 + n.velocity * 0.5}
          />
        ))}
      </svg>
    </div>
  )
}
