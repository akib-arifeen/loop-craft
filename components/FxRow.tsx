"use client"

import type { TrackState } from "@/lib/audio/types"
import Knob from "./Knob"
import { useEngine } from "./useEngine"
import styles from "./FxRow.module.css"

const pct = (v: number) => `${Math.round(v * 100)}%`

function filterText(v: number): string {
  if (Math.abs(v) < 0.02) return "Flat"
  return v < 0 ? `LP ${Math.round(-v * 100)}%` : `HP ${Math.round(v * 100)}%`
}

function panText(v: number): string {
  const n = Math.round(Math.abs(v) * 100)
  if (n === 0) return "C"
  return v < 0 ? `L ${n}` : `R ${n}`
}

export default function FxRow({ track }: { track: TrackState }) {
  const { engine } = useEngine()
  return (
    <div className={styles.row} role="group" aria-label="Track effects">
      <Knob label="Filter" value={track.fx.filter} min={-1} max={1} def={0} bipolar format={filterText} onChange={(v) => engine.setTrackFx(track.id, { filter: v })} />
      <Knob label="Drive" value={track.fx.drive} min={0} max={1} def={0} format={pct} onChange={(v) => engine.setTrackFx(track.id, { drive: v })} />
      <Knob label="Delay" value={track.fx.delay} min={0} max={1} def={0} format={pct} onChange={(v) => engine.setTrackFx(track.id, { delay: v })} />
      <Knob label="Reverb" value={track.fx.reverb} min={0} max={1} def={0} format={pct} onChange={(v) => engine.setTrackFx(track.id, { reverb: v })} />
      <Knob label="Pan" value={track.pan} min={-1} max={1} def={0} bipolar format={panText} onChange={(v) => engine.setTrack(track.id, { pan: v })} />
    </div>
  )
}
