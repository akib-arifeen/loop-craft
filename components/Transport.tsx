"use client"

import { useEffect, useRef, useState } from "react"
import { BAR_OPTIONS, MAX_BPM, MIN_BPM } from "@/lib/audio/types"
import { exportFileName, formatSeconds, loopDurationSeconds } from "@/lib/audio/timing"
import { Check, Download, Keyboard, Link, Lock, Metronome, Play, Record, Redo, Stop, Undo } from "./icons"
import { setShortcuts, toggleRecord, useAnimationFrame, useEngine, useShortcuts } from "./useEngine"
import ProjectBridge from "./ProjectBridge"
import styles from "./Transport.module.css"

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

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
  const recordedLoops = snap.recordedLoops
  const recordedLabel = plural(recordedLoops, "recorded loop", "recorded loops")
  const tempoLockTitle = "Tempo is locked while recorded loops exist. Clear the recorded loops to change it."
  const barsLockTitle = "Loop length is locked while recorded loops exist. Clear the recorded loops to change it."
  const exportLoops = 2
  const exportDuration = loopDurationSeconds(snap.loopFrames, snap.sampleRate, exportLoops)
  const exportDurationLabel = formatSeconds(exportDuration)
  const exportBars = `${snap.bars} ${snap.bars === 1 ? "bar" : "bars"}`
  const exportName =
    snap.sampleRate > 0 && snap.loopFrames > 0
      ? exportFileName({ bpm: snap.bpm, bars: snap.bars, loops: exportLoops, loopFrames: snap.loopFrames, sampleRate: snap.sampleRate })
      : "loopcraft.wav"
  const exportTitle = snap.exportReady
    ? `Export WAV: ${exportLoops} loops of ${exportBars} at ${snap.bpm} BPM, ${exportDurationLabel} total`
    : snap.retiming
      ? "Wait for the tempo change to finish, then export"
      : "Export is unavailable until the audio is ready"
  const exportDisabled = !snap.exportReady || snap.exporting

  const slowerUnavailable = locked || snap.bpm <= MIN_BPM
  const fasterUnavailable = locked || snap.bpm >= MAX_BPM

  const nudge = (dir: number, e: React.MouseEvent) => engine.setBpm(snap.bpm + dir * (e.shiftKey ? 5 : 1))

  const share = async () => {
    const code = engine.shareCode()
    const url = `${location.origin}${location.pathname}#s=${code}`
    const count = engine.getSnapshot().recordedLoops
    const label = plural(count, "recorded loop", "recorded loops")
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      onNotice(
        count > 0
          ? `Link copied without ${label} — ${count === 1 ? "it stays" : "they stay"} in this browser.`
          : "Link copied. No recorded loops to include.",
      )
    } catch {
      location.hash = `s=${code}`
      onNotice(count > 0 ? `Couldn't copy. The link is in the address bar without ${label}.` : "Couldn't copy. The link is in the address bar.")
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
      onNotice(`Exported ${exportLoops} loops · ${exportDurationLabel} · ${exportName}`)
    } catch (e) {
      onNotice(e instanceof Error ? e.message : "Export failed. Try again.")
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

      <div
        className={`${styles.bpm} ${styles.o4}`}
        role="group"
        aria-label="Tempo"
        aria-disabled={locked || undefined}
        aria-describedby={locked ? "tempo-lock" : undefined}
        title={locked ? tempoLockTitle : undefined}
      >
        <button
          type="button"
          className={styles.step}
          aria-label="Slower"
          aria-disabled={slowerUnavailable || undefined}
          aria-describedby={locked ? "tempo-lock" : undefined}
          title={locked ? tempoLockTitle : snap.bpm <= MIN_BPM ? "Already at the slowest tempo" : undefined}
          onClick={(e) => {
            if (locked) onNotice(tempoLockTitle)
            else if (snap.bpm <= MIN_BPM) onNotice(`Tempo is already at its slowest (${MIN_BPM} BPM).`)
            else nudge(-1, e)
          }}
        >
          −
        </button>
        <span className={styles.bpmValue}>
          {locked && <Lock size={14} />}
          <span className={`mono ${styles.bpmNum}`} title={locked ? tempoLockTitle : undefined}>
            {snap.bpm}
          </span>
          <span className={styles.label}>{locked ? "locked" : "BPM"}</span>
        </span>
        <button
          type="button"
          className={styles.step}
          aria-label="Faster"
          aria-disabled={fasterUnavailable || undefined}
          aria-describedby={locked ? "tempo-lock" : undefined}
          title={locked ? tempoLockTitle : snap.bpm >= MAX_BPM ? "Already at the fastest tempo" : undefined}
          onClick={(e) => {
            if (locked) onNotice(tempoLockTitle)
            else if (snap.bpm >= MAX_BPM) onNotice(`Tempo is already at its fastest (${MAX_BPM} BPM).`)
            else nudge(1, e)
          }}
        >
          +
        </button>
        {locked && (
          <span id="tempo-lock" className={styles.tempoLockNote}>
            Tempo is locked while recorded loops exist. Clear the recorded loops to change it.
          </span>
        )}
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
        aria-label={
          copied
            ? "Share link copied"
            : recordedLoops > 0
              ? `Copy share link. ${recordedLabel} will be left out; ${recordedLoops === 1 ? "it stays" : "they stay"} in this browser.`
              : "Copy share link. No recorded loops are in this session."
        }
        title={
          copied
            ? "Share link copied"
            : recordedLoops > 0
              ? `Copies tempo, patterns, samples and mix. ${recordedLabel} ${recordedLoops === 1 ? "stays" : "stay"} in this browser and ${recordedLoops === 1 ? "is" : "are"} not included.`
              : "Copies tempo, patterns, samples and mix. No recorded loops are in this session."
        }
        data-copied={copied || undefined}
        onClick={share}
      >
        {copied ? <Check size={18} /> : <Link />}
      </button>
      <button
        type="button"
        className={`${styles.export} ${styles.o10}`}
        disabled={exportDisabled}
        aria-label={exportTitle}
        title={exportTitle}
        onClick={exportWav}
      >
        <span className={styles.wavText}>{snap.exporting ? "Rendering…" : "WAV"}</span>
        {snap.exportReady && !snap.exporting && <span className={`mono ${styles.wavDur}`}>{exportDurationLabel}</span>}
        <Download size={16} />
      </button>
      <span className={styles.break} />
    </header>
  )
}
