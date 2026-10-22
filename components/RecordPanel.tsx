"use client"

import { useRef } from "react"
import type { RecordSource, TrackState } from "@/lib/audio/types"
import Pads from "./Pads"
import { Grid, Mic, Record } from "./icons"
import { useAnimationFrame, useEngine } from "./useEngine"
import styles from "./RecordPanel.module.css"

export default function RecordPanel({ track }: { track: TrackState }) {
  const { engine, snap } = useEngine()
  const meter = useRef<HTMLDivElement>(null)
  const level = useRef(0)
  const pct = useRef<HTMLSpanElement>(null)
  const record = snap.record
  const mine = record.kind !== "idle" && record.trackId === track.id
  const busy = record.kind !== "idle"
  const state = useRef(record)
  state.current = record

  useAnimationFrame(() => {
    const m = meter.current
    if (m) {
      level.current = Math.max(engine.getInputLevel(), level.current * 0.88)
      m.style.transform = `scaleX(${Math.min(1, level.current)})`
    }
    const p = pct.current
    const r = state.current
    if (p && r.kind === "recording") {
      const now = engine.debug.ctx?.currentTime ?? r.startsAt
      const f = Math.max(0, Math.min(1, (now - r.startsAt) / (r.endsAt - r.startsAt)))
      p.textContent = `${Math.round(f * 100)}%`
    }
  })

  const sources: { id: RecordSource; label: string; icon: React.ReactNode }[] = [
    { id: "mic", label: "Mic", icon: <Mic size={16} /> },
    { id: "pads", label: "Pads", icon: <Grid size={16} /> },
  ]

  let phaseText: React.ReactNode
  if (mine && record.kind === "waiting") phaseText = record.countIn ? "Count-in…" : "Starts on the next loop"
  else if (mine && record.kind === "recording")
    phaseText = (
      <>
        Recording… <span ref={pct} className="mono" />
      </>
    )
  else if (busy) phaseText = "Another track is recording"
  else phaseText = `Quantised to the loop · latency comp ${Math.round(snap.latencyMs)} ms`

  const label = mine ? "Cancel" : track.hasAudio ? "Overdub" : "Record loop"

  return (
    <div className={styles.wrap}>
      <div className={styles.source} role="group" aria-label="Record source">
        {sources.map((s) => (
          <button key={s.id} type="button" className={styles.srcBtn} aria-pressed={snap.recordSource === s.id} disabled={busy} onClick={() => engine.setRecordSource(s.id)}>
            {s.icon}
            {s.label}
            {s.id === "mic" && snap.micStatus === "denied" && <span className={styles.badge}>Blocked</span>}
          </button>
        ))}
      </div>

      <button type="button" className={styles.rec} data-on={mine} onClick={() => (busy ? engine.cancelRecord() : void engine.record(track.id))}>
        <Record size={18} />
        {label}
      </button>

      <div className={styles.phaseRow}>
        <span className={styles.phase}>{phaseText}</span>
        <span className={styles.nudge}>
          <button type="button" className={`mono ${styles.nudgeBtn}`} onClick={() => engine.setLatencyOffset(snap.latencyOffsetMs - 5)}>
            −5 ms
          </button>
          <button type="button" className={`mono ${styles.nudgeBtn}`} onClick={() => engine.setLatencyOffset(snap.latencyOffsetMs + 5)}>
            +5 ms
          </button>
        </span>
      </div>

      <div className={styles.input} aria-hidden="true">
        <div ref={meter} className={styles.inputFill} />
      </div>

      <Pads />
    </div>
  )
}
