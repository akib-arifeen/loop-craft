"use client"

import { useEffect, useRef, useState } from "react"
import { BAR_OPTIONS, MAX_BPM, MIN_BPM } from "@/lib/audio/types"
import { Check, Download, Keyboard, Link, Lock, Metronome, Play, Record, Redo, Stop, Undo } from "./icons"
import { setShortcuts, toggleRecord, useAnimationFrame, useEngine, useShortcuts } from "./useEngine"
import ProjectBridge from "./ProjectBridge"
import styles from "./Transport.module.css"

export default function Transport({ onNotice }: { onNotice: (text: string) => void }) {
  const { engine, snap } = useEngine()
  const shortcuts = useShortcuts()
  const meter = useRef<HTMLDivElement>(null)
  const level = useRef(0)
  const [copied, setCopied] = useState(false)

  useAnimationFrame(() => {
    const el = meter.current
    if (!el) return
    level.current = Math.max(engine.getMasterLevel(), level.current * 0.88)
    el.style.transform = `scaleY(${Math.min(1, level.current)})`
  })

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  const recording = snap.record.kind !== "idle"
  const locked = snap.tempoLocked
  const tempoLockTitle = "Clear recorded loops to change tempo"
  const barsLockTitle = "Loop length is locked while recorded loops exist. Clear the recorded loops to change it."
  const hasRecordedLoops = snap.tracks.some((t) => t.kind === "audio" && t.hasAudio)
  const exportLoops = 2
  const exportSeconds = Math.round((snap.bars * 4 * 60 * exportLoops) / snap.bpm)
  const exportName = `loopcraft-${snap.bpm}bpm-${snap.bars}bars-${exportLoops}loops-${exportSeconds}s.wav`
  const exportTitle = `Export WAV: ${exportLoops} loops of ${snap.bars} bars at ${snap.bpm} BPM, about ${exportSeconds} seconds`

  const nudge = (dir: number, e: React.MouseEvent) => engine.setBpm(snap.bpm + dir * (e.shiftKey ? 5 : 1))

  const share = async () => {
    const code = engine.shareCode()
    const url = `${location.origin}${location.pathname}#s=${code}`
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      onNotice(hasRecordedLoops ? "Link copied without recorded loops — they stay in this browser." : "Link copied. Recorded loops are never included.")
    } catch {
      location.hash = `s=${code}`
      onNotice(hasRecordedLoops ? "Couldn't copy. The link is in the address bar, without your recorded loops." : "Couldn't copy. The link is in the address bar.")
    }
  }

  const exportWav = async () => {
    try {
      const blob = await engine.exportWav(exportLoops)
      const href = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = href
      a.download = exportName
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(href), 1000)
      onNotice(`Exported ${exportLoops} loops · ${exportSeconds}s · ${exportName}`)
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
          title={locked ? tempoLockTitle : undefined}
          onClick={(e) => nudge(-1, e)}
        >
          −
        </button>
        <span className={styles.bpmValue}>
          {locked && <Lock size={14} />}
          <span className={`mono ${styles.bpmNum}`} title={locked ? tempoLockTitle : undefined}>
            {snap.bpm}
          </span>
          <span className={styles.label}>BPM</span>
        </span>
        <button
          type="button"
          className={styles.step}
          aria-label="Faster"
          disabled={locked || snap.bpm >= MAX_BPM}
          title={locked ? tempoLockTitle : undefined}
          onClick={(e) => nudge(1, e)}
        >
          +
        </button>
      </div>

      <div
        className={`${styles.seg} ${styles.o5}`}
        role="radiogroup"
        aria-label="Loop length in bars"
        aria-disabled={locked || undefined}
        aria-describedby={locked ? "loop-length-lock" : undefined}
        title={locked ? barsLockTitle : undefined}
      >
        {BAR_OPTIONS.map((b) => (
          <button
            key={b}
            type="button"
            role="radio"
            aria-label={`${b} bar${b === 1 ? "" : "s"}`}
            aria-checked={snap.bars === b}
            aria-disabled={locked || undefined}
            aria-describedby={locked ? "loop-length-lock" : undefined}
            className={`mono ${styles.segBtn}`}
            title={locked ? barsLockTitle : undefined}
            onClick={() => {
              if (locked) onNotice(barsLockTitle)
              else engine.setBars(b)
            }}
          >
            {b}
          </button>
        ))}
        {locked && (
          <span className={styles.barsLock}>
            <Lock size={14} />
          </span>
        )}
        <span className={styles.segLabel}>{locked ? "locked" : "bars"}</span>
        {locked && (
          <span id="loop-length-lock" className={styles.lockNote}>
            Loop length is locked while recorded loops exist.
          </span>
        )}
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
        <ProjectBridge onNotice={onNotice} />
      </div>

      <span className={`${styles.spacer} ${styles.o7}`} />
      <div className={`${styles.meterTrack} ${styles.o8}`} aria-hidden="true">
        <div ref={meter} className={styles.meterFill} />
      </div>
      <button
        type="button"
        className={`${styles.icon} ${styles.o9}`}
        aria-label={copied ? "Share link copied" : "Copy share link. Recorded loops stay in this browser and are not included."}
        title={
          copied
            ? "Share link copied"
            : "Copies tempo, patterns, samples and mix. Recorded loops stay in this browser and are not included."
        }
        data-copied={copied || undefined}
        onClick={share}
      >
        {copied ? <Check size={18} /> : <Link />}
      </button>
      <button type="button" className={`${styles.export} ${styles.o10}`} disabled={snap.exporting} aria-label={exportTitle} title={exportTitle} onClick={exportWav}>
        <span className={styles.wavText}>{snap.exporting ? "Rendering…" : "WAV"}</span>
        {!snap.exporting && <span className={`mono ${styles.wavDur}`}>{exportSeconds}s</span>}
        <Download size={16} />
      </button>
      <span className={styles.break} />
    </header>
  )
}
