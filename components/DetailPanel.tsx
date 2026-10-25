"use client"

import { useEffect, useState, type CSSProperties } from "react"
import type { TrackState } from "@/lib/audio/types"
import { SAMPLE_TYPE_LABELS, findSample, keyLabel, sampleFit } from "@/lib/samples/library"
import FxRow from "./FxRow"
import { X } from "./icons"
import PatternPicker from "./PatternPicker"
import RecordPanel from "./RecordPanel"
import StepGrid from "./StepGrid"
import { trackColor, useEngine } from "./useEngine"
import styles from "./DetailPanel.module.css"

function chipText(t: TrackState): string {
  if (t.kind === "drums") return "16-step synth kit"
  if (t.kind === "audio") return t.hasAudio ? "Recorded loop" : "Empty loop"
  if (t.kind === "sample") {
    const sample = findSample(t.sampleId)
    return sample && sample.key ? `Sample · ${keyLabel(sample.key)}` : "Sample · no pitch"
  }
  return "Synth preset"
}

/** A sample track's stated metadata and how it sits against the project key right now. */
function SampleInfo({ track }: { track: TrackState }) {
  const { snap } = useEngine()
  const sample = findSample(track.sampleId)
  if (!sample) {
    return <p className={styles.empty}>This sample isn&rsquo;t in the library anymore. Remove the track or add another loop from Browse samples.</p>
  }
  const fit = sampleFit(sample, snap.harmony.key)
  const project = keyLabel(snap.harmony.key)
  return (
    <div className={styles.sampleInfo}>
      <div className={styles.sampleRow}>
        <span className={styles.sampleFit} data-fit={fit.fit}>
          {fit.fit === "in-key" ? `In key · ${project}` : fit.fit === "clash" ? `Out of key · ${project}` : "Always fits"}
        </span>
        <span className={styles.sampleMeta}>
          {SAMPLE_TYPE_LABELS[sample.type]} · {sample.key ? `${keyLabel(sample.key)} (stated by the pack)` : "no pitch"} · {sample.bars === 1 ? "1 bar" : `${sample.bars} bars`}
        </span>
      </div>
      <p className={styles.sampleReason} data-fit={fit.fit}>
        {fit.reason}
      </p>
      <p className={styles.sampleNote}>
        A fixed-pitch loop rendered by LoopCraft&rsquo;s synths. It keeps its own key instead of following the project key. Change the key and this
        panel tells you if it still fits.
      </p>
    </div>
  )
}

function NameEditor({ track }: { track: TrackState }) {
  const { engine } = useEngine()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(track.name)

  const commit = () => {
    const name = draft.trim().slice(0, 24)
    if (name && name !== track.name) engine.setTrack(track.id, { name })
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        className={styles.nameInput}
        value={draft}
        maxLength={24}
        autoFocus
        aria-label="Track name"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit()
          if (e.key === "Escape") setEditing(false)
        }}
      />
    )
  }
  return (
    <button
      type="button"
      className={styles.name}
      title="Rename"
      onClick={() => {
        setDraft(track.name)
        setEditing(true)
      }}
    >
      {track.name}
    </button>
  )
}

function RemoveButton({ track }: { track: TrackState }) {
  const { engine } = useEngine()
  const [confirming, setConfirming] = useState(false)
  const undoable = track.kind === "audio" || track.kind === "sample"
  // A recorded loop, a drum pattern and a bass or keys part are the only things one click can lose
  // for good: recorded audio because it is a performance, and the built-in synth tracks because this
  // page has no way to add one back. They ask twice; the mix-only and empty tracks do not.
  const guarded = track.kind === "drums" || track.kind === "bass" || track.kind === "keys" || (track.kind === "audio" && track.hasAudio)
  // The irreversible case states its warning on the page itself, not only in a title: touch and AT never
  // see a title. aria-describedby carries the same words before and after arming.
  const warnId = `remove-warning-${track.id}`

  useEffect(() => {
    if (!confirming) return
    const id = window.setTimeout(() => setConfirming(false), 3000)
    return () => window.clearTimeout(id)
  }, [confirming])

  const title = undoable
    ? confirming
      ? "Remove it. Undo restores the whole track, including recorded audio."
      : `Remove ${track.name}. Undo restores it.`
    : guarded
      ? confirming
        ? "Remove it. This can't be undone."
        : `Remove ${track.name}. This can't be undone, and the synth track can't be added back from this page.`
      : confirming
        ? "Remove it."
        : `Remove ${track.name}.`

  const label = undoable ? "Confirm remove track" : `Remove ${track.name} for good`

  return (
    <>
      <button
        type="button"
        className={styles.remove}
        data-confirm={confirming}
        data-danger={!undoable && confirming ? "true" : undefined}
        aria-label={confirming ? label : "Remove track"}
        aria-describedby={!undoable ? warnId : undefined}
        title={title}
        onClick={() => {
          if (guarded && !confirming) setConfirming(true)
          else engine.removeTrack(track.id)
        }}
      >
        {confirming ? (undoable ? "Remove?" : "Remove for good?") : <X size={16} />}
      </button>
      {!undoable && (
        <span id={warnId} className={styles.warn}>
          Removing {track.name} can&rsquo;t be undone, and this synth track can&rsquo;t be added back from this page.
        </span>
      )}
    </>
  )
}

export default function DetailPanel() {
  const { engine, snap } = useEngine()
  const index = snap.tracks.findIndex((t) => t.id === snap.selectedTrackId)
  const track = index >= 0 ? snap.tracks[index] : null

  if (!track) {
    return (
      <section className={styles.panel} aria-label="Track detail">
        <p className={styles.empty}>Select a track</p>
      </section>
    )
  }

  const clearLabel = track.kind === "audio" ? "Clear loop" : track.kind === "drums" ? "Clear steps" : null

  return (
    <section className={styles.panel} style={{ "--tc": trackColor(index) } as CSSProperties} aria-label={`${track.name} detail`}>
      <div className={styles.head}>
        <NameEditor key={`name-${track.id}`} track={track} />
        <span className={styles.chip}>{chipText(track)}</span>
        <span className={styles.grow} />
        {clearLabel && (
          <button type="button" className={styles.clear} onClick={() => engine.clearTrack(track.id)}>
            {clearLabel}
          </button>
        )}
        <RemoveButton key={`remove-${track.id}`} track={track} />
      </div>
      <div className={styles.body}>
        {track.kind === "drums" && <StepGrid track={track} />}
        {(track.kind === "bass" || track.kind === "keys") && <PatternPicker track={track} />}
        {track.kind === "sample" && <SampleInfo track={track} />}
        {track.kind === "audio" && <RecordPanel track={track} />}
      </div>
      <FxRow track={track} />
    </section>
  )
}
