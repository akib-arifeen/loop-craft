"use client"

import { useCallback, useRef } from "react"
import { MAX_TRACKS } from "@/lib/audio/types"
import { Plus } from "./icons"
import TrackRow from "./TrackRow"
import { isAudible } from "@/lib/audio/dsp"
import { useAnimationFrame, useEngine } from "./useEngine"
import styles from "./TrackList.module.css"

export default function TrackList() {
  const { engine, snap } = useEngine()
  const meters = useRef(new Map<string, { el: HTMLElement; level: number }>())

  const register = useCallback((id: string, el: HTMLElement | null) => {
    if (el) meters.current.set(id, { el, level: 0 })
    else meters.current.delete(id)
  }, [])

  useAnimationFrame(() => {
    const levels = engine.getLevels()
    meters.current.forEach((m, id) => {
      m.level = Math.max(levels[id] ?? 0, m.level * 0.86)
      m.el.style.transform = `scaleY(${Math.min(1, m.level)})`
    })
  })

  const add = () => {
    const id = engine.addAudioTrack()
    if (id) engine.selectTrack(id)
  }

  return (
    <section className={styles.list} aria-label="Tracks">
      <ul className={styles.rows}>
        {snap.tracks.map((t, i) => (
          <TrackRow key={t.id} track={t} index={i} selected={t.id === snap.selectedTrackId} audible={isAudible(t, snap.tracks)} registerMeter={register} />
        ))}
      </ul>
      <button type="button" className={styles.add} disabled={snap.tracks.length >= MAX_TRACKS} onClick={add}>
        <Plus size={16} /> Add loop track
      </button>
    </section>
  )
}
