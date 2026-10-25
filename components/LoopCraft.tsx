"use client"

import { useEffect, useRef, useState } from "react"
import ChordLane from "./ChordLane"
import DetailPanel from "./DetailPanel"
import StartGate from "./StartGate"
import StatusLine, { type Notice } from "./StatusLine"
import TrackList from "./TrackList"
import Transport from "./Transport"
import { shortcutsEnabled, modalOpen, toggleRecord, useEngine } from "./useEngine"
import { PADS } from "@/lib/audio/patterns"
import styles from "./LoopCraft.module.css"

export default function LoopCraft() {
  const { engine, snap } = useEngine()
  const [notice, setNotice] = useState<Notice | null>(null)
  const latest = useRef(snap)
  latest.current = snap

  const notify = (text: string) => setNotice((n) => ({ text, n: (n?.n ?? 0) + 1 }))

  useEffect(() => {
    // Form controls own every key: typing in a field, opening a select, and a slider's own keys
    // must not turn into transport commands.
    const editable = (t: EventTarget | null) => {
      const el = t as HTMLElement | null
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)
    }

    let spaceHandled = false

    const onKeyDown = (e: KeyboardEvent) => {
      if (modalOpen() || editable(e.target)) return
      const s = latest.current
      const key = e.key.toLowerCase()
      const mod = e.ctrlKey || e.metaKey

      if (mod && !e.altKey && s.status === "ready") {
        if (key === "z") {
          e.preventDefault()
          if (e.shiftKey) engine.redo()
          else engine.undo()
        } else if (key === "y" && e.ctrlKey) {
          e.preventDefault()
          engine.redo()
        }
        return
      }
      if (mod || e.altKey || !shortcutsEnabled()) return

      if (e.key === " ") {
        // Space is the transport key. Before the audio starts, leave it to the start button.
        if (s.status !== "ready" && s.status !== "suspended") return
        // ARIA radio/switch controls own Space, as their users expect; ordinary buttons do not.
        const el = e.target as HTMLElement | null
        if (el?.closest?.('[role="radio"], [role="switch"]')) return
        // Always consume Space here: a focused button must not also activate on keyup. Keyboard
        // users activate buttons with Enter instead, so Space cannot mute, remove or record by
        // accident when they asked for play/pause.
        e.preventDefault()
        if (e.repeat) return
        spaceHandled = true
        if (s.status === "ready") engine.togglePlay()
        else void engine.start()
        return
      }
      if (s.status !== "ready") return

      if (/^[1-8]$/.test(e.key)) {
        const t = s.tracks[Number(e.key) - 1]
        if (t) engine.selectTrack(t.id)
        return
      }
      if (key === "r" && !e.repeat) {
        toggleRecord(engine, s)
        return
      }
      if (key === "m" && !e.repeat) {
        const t = s.tracks.find((x) => x.id === s.selectedTrackId)
        if (t) engine.setTrack(t.id, { muted: !t.muted })
        return
      }
      const pad = PADS.findIndex((p) => p.key === key)
      if (pad >= 0 && !e.repeat) engine.pad(pad)
    }

    // Stop a focused button from also "clicking" on Space release.
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== " ") return
      if (spaceHandled) e.preventDefault()
      spaceHandled = false
    }

    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup", onKeyUp)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
    }
  }, [engine])

  const gated = snap.status === "idle" || snap.status === "starting" || snap.status === "error"

  return (
    <main className={styles.main} data-build="2026-10-24-key-aware-samples">
      <div className={styles.app} data-gated={gated} inert={gated}>
        {snap.status === "suspended" && (
          <div className={styles.banner} role="status">
            <span>Audio paused by the browser</span>
            <button type="button" className={styles.resume} onClick={() => void engine.start()}>
              Resume
            </button>
          </div>
        )}
        <Transport onNotice={notify} />
        <ChordLane />
        <div className={styles.body}>
          <TrackList />
          <DetailPanel />
        </div>
      </div>
      <StartGate />
      <StatusLine message={snap.message} notice={notice} />
    </main>
  )
}
