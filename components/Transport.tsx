"use client"

import { useRef } from "react"
import { BAR_OPTIONS, MAX_BPM, MIN_BPM } from "@/lib/audio/types"
import { Download, Keyboard, Link, Lock, Metronome, Play, Record, Redo, Stop, Undo } from "./icons"
import { setShortcuts, toggleRecord, useAnimationFrame, useEngine, useShortcuts } from "./useEngine"
import styles from "./Transport.module.css"

export default function Transport({ onNotice }: { onNotice: (text: string) => void }) {
  const { engine, snap } = useEngine()
  const shortcuts = useShortcuts()
  const meter = useRef<HTMLDivElement>(null)
  const level = useRef(0)

  useAnimationFrame(() => {
    const el = meter.current
    if (!el) return
    level.current = Math.max(engine.getMasterLevel(), level.current * 0.88)
    el.style.transform = `scaleY(${Math.min(1, level.current)})`
  })

  const recording = snap.record.kind !== "idle"
  const locked = snap.tempoLocked
  const lockTitle = "Clear recorded loops to change tempo"

  const nudge = (dir: number, e: React.MouseEvent) => engine.setBpm(snap.bpm + dir * (e.shiftKey ? 5 : 1))

  const share = async () => {
    const url = `${location.origin}${location.pathname}#s=${engine.shareCode()}`
    try {
      await navigator.clipboard.writeText(url)
      onNotice("Link copied")
    } catch {
      location.hash = `s=${engine.shareCode()}`
      onNotice("Couldn't copy. The link is in the address bar.")
    }
  }

  const exportWav = async () => {
    try {
      const blob = await engine.exportWav(2)
      const href = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = href
      a.download = `loopcraft-${snap.bpm}bpm.wav`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(href), 1000)
    } catch {
      onNotice("Export failed. Try again.")
    }
  }

  return (
    <header className={styles.header}>
      <h1 className={`${styles.wordmark} ${styles.o1}`}>LoopCraft</h1>
      <button
        type="button"
        className={`${styles.round} ${styles.o2}`}
        data-on={snap.playing}
        aria-label={snap.playing ? "Stop" : "Play"}
        onClick={() => engine.togglePlay()}
      >
        {snap.playing ? <Stop /> : <Play />}
      </button>
      <button
        type="button"
        className={`${styles.round} ${styles.rec} ${styles.o3}`}
        data-on={recording}
        aria-label={recording ? "Cancel recording" : "Record loop"}
        onClick={() => toggleRecord(engine, snap)}
      >
        <Record />
      </button>

      <div className={`${styles.bpm} ${styles.o4}`} role="group" aria-label="Tempo">
        <button
          type="button"
          className={styles.step}
          aria-label="Slower"
          disabled={locked || snap.bpm <= MIN_BPM}
          title={locked ? lockTitle : undefined}
          onClick={(e) => nudge(-1, e)}
        >
          −
        </button>
        <span className={styles.bpmValue}>
          {locked && <Lock size={14} />}
          <span className={`mono ${styles.bpmNum}`} title={locked ? lockTitle : undefined}>
            {snap.bpm}
          </span>
          <span className={styles.label}>BPM</span>
        </span>
        <button
          type="button"
          className={styles.step}
          aria-label="Faster"
          disabled={locked || snap.bpm >= MAX_BPM}
          title={locked ? lockTitle : undefined}
          onClick={(e) => nudge(1, e)}
        >
          +
        </button>
      </div>

      <div className={`${styles.seg} ${styles.o5}`} role="radiogroup" aria-label="Loop length in bars" title={locked ? lockTitle : undefined}>
        {BAR_OPTIONS.map((b) => (
          <button
            key={b}
            type="button"
            role="radio"
            aria-checked={snap.bars === b}
            disabled={locked}
            className={`mono ${styles.segBtn}`}
            onClick={() => engine.setBars(b)}
          >
            {b}
          </button>
        ))}
        <span className={styles.segLabel}>bars</span>
      </div>

      <div className={`${styles.tools} ${styles.o6}`}>
        <button type="button" className={styles.icon} aria-pressed={snap.metronome} aria-label="Metronome" onClick={() => engine.setMetronome(!snap.metronome)}>
          <Metronome />
        </button>
        <button
          type="button"
          className={styles.icon}
          aria-pressed={shortcuts}
          aria-label="Keyboard shortcuts"
          title="Single-key shortcuts on/off"
          onClick={() => setShortcuts(!shortcuts)}
        >
          <Keyboard />
        </button>
        <button type="button" className={styles.icon} aria-label="Undo" disabled={!snap.canUndo} onClick={() => engine.undo()}>
          <Undo />
        </button>
        <button type="button" className={styles.icon} aria-label="Redo" disabled={!snap.canRedo} onClick={() => engine.redo()}>
          <Redo />
        </button>
      </div>

      <span className={`${styles.spacer} ${styles.o7}`} />
      <div className={`${styles.meterTrack} ${styles.o8}`} aria-hidden="true">
        <div ref={meter} className={styles.meterFill} />
      </div>
      <button type="button" className={`${styles.icon} ${styles.o9}`} aria-label="Copy share link" onClick={share}>
        <Link />
      </button>
      <button type="button" className={`${styles.export} ${styles.o10}`} disabled={snap.exporting} onClick={exportWav}>
        <span className={styles.wavText}>{snap.exporting ? "Rendering…" : "WAV"}</span>
        <Download size={16} />
      </button>
      <span className={styles.break} />
    </header>
  )
}
