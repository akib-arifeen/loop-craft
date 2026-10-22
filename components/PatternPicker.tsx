"use client"

import { BASS_PATTERNS, KEYS_PATTERNS, findPattern } from "@/lib/audio/patterns"
import { STEPS_PER_BAR, type TrackState } from "@/lib/audio/types"
import { useEngine } from "./useEngine"
import styles from "./PatternPicker.module.css"

const H = 120
const NOTE_H = 4

export default function PatternPicker({ track }: { track: TrackState }) {
  const { engine } = useEngine()
  const list = track.kind === "bass" ? BASS_PATTERNS : KEYS_PATTERNS
  const pattern = track.patternId ? findPattern(track.patternId) : undefined
  const totalSteps = (pattern?.bars ?? 4) * STEPS_PER_BAR

  let lo = 0
  let hi = 0
  if (pattern && pattern.notes.length) {
    lo = Math.min(...pattern.notes.map((n) => n.midi))
    hi = Math.max(...pattern.notes.map((n) => n.midi))
  }
  const rows = hi - lo + 1
  const usable = H - 2 * NOTE_H
  const yOf = (midi: number) => NOTE_H + (rows <= 1 ? usable / 2 : (1 - (midi - lo) / (rows - 1)) * usable)

  return (
    <div className={styles.wrap}>
      <div className={styles.seg} role="group" aria-label="Pattern">
        {list.map((p) => (
          <button key={p.id} type="button" className={styles.segBtn} aria-pressed={track.patternId === p.id} onClick={() => engine.setPattern(track.id, p.id)}>
            {p.name}
          </button>
        ))}
      </div>
      <svg className={styles.roll} viewBox={`0 0 ${totalSteps} ${H}`} preserveAspectRatio="none" role="img" aria-label="Pattern preview">
        {Array.from({ length: Math.floor(totalSteps / STEPS_PER_BAR) + 1 }, (_, i) => (
          <line key={i} className={styles.bar} x1={i * STEPS_PER_BAR} x2={i * STEPS_PER_BAR} y1={0} y2={H} vectorEffect="non-scaling-stroke" />
        ))}
        {pattern?.notes.map((n, i) => (
          <rect key={i} className={styles.note} x={n.step} y={yOf(n.midi) - NOTE_H / 2} width={Math.max(0.3, n.length)} height={NOTE_H} rx={1} opacity={0.5 + n.velocity * 0.5} />
        ))}
      </svg>
    </div>
  )
}
