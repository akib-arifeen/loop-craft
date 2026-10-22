"use client"

import { useRef } from "react"
import { DRUM_VOICES, STEPS_PER_BAR, type DrumVoice, type TrackState } from "@/lib/audio/types"
import { useAnimationFrame, useEngine } from "./useEngine"
import styles from "./StepGrid.module.css"

const LABELS: Record<DrumVoice, string> = { kick: "Kick", snare: "Snare", clap: "Clap", hat: "Hat" }
const STATE = ["off", "on", "accent"]

export default function StepGrid({ track }: { track: TrackState }) {
  const { engine, snap } = useEngine()
  const root = useRef<HTMLDivElement>(null)
  const current = useRef(-1)
  const bars = useRef(snap.bars)
  bars.current = snap.bars
  const pattern = track.drumPattern

  useAnimationFrame(() => {
    const el = root.current
    if (!el) return
    const phase = engine.getPhase()
    const step = phase === null ? -1 : Math.floor(phase * bars.current * STEPS_PER_BAR) % STEPS_PER_BAR
    if (step === current.current) return
    el.querySelectorAll('[data-now="true"]').forEach((n) => n.removeAttribute("data-now"))
    if (step >= 0) el.querySelectorAll(`[data-step="${step}"]`).forEach((n) => n.setAttribute("data-now", "true"))
    current.current = step
  })

  if (!pattern) return null

  return (
    <div ref={root} className={styles.grid}>
      {DRUM_VOICES.map((voice, lane) => (
        <div key={voice} className={styles.lane}>
          <button type="button" className={styles.label} aria-label={`Audition ${LABELS[voice]}`} onClick={() => engine.pad(lane)}>
            {LABELS[voice]}
          </button>
          <div className={styles.cells}>
            {[0, 1, 2, 3].map((g) => (
              <div key={g} className={styles.group}>
                {pattern[voice].slice(g * 4, g * 4 + 4).map((v, i) => {
                  const step = g * 4 + i
                  return (
                    <button
                      key={step}
                      type="button"
                      className={styles.cell}
                      data-v={v}
                      data-step={step}
                      aria-pressed={v > 0}
                      aria-label={`${LABELS[voice]} step ${step + 1}, ${STATE[v] ?? "off"}`}
                      onClick={() => engine.toggleStep(track.id, voice, step)}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
