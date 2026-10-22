"use client"

import type { CSSProperties } from "react"
import type { TrackState } from "@/lib/audio/types"
import LoopLane from "./LoopLane"
import LoopRing from "./LoopRing"
import { trackColor, useEngine } from "./useEngine"
import styles from "./TrackRow.module.css"

function kindLabel(t: TrackState): string {
  switch (t.kind) {
    case "drums":
      return "Synth kit"
    case "bass":
      return "Synth bass"
    case "keys":
      return "Synth keys"
    default:
      return t.hasAudio ? "Recorded loop" : "Empty · press R"
  }
}

interface Props {
  track: TrackState
  index: number
  selected: boolean
  audible: boolean
  registerMeter: (id: string, el: HTMLElement | null) => void
}

export default function TrackRow({ track, index, selected, audible, registerMeter }: Props) {
  const { engine } = useEngine()
  const style = { "--tc": trackColor(index), "--fill": `${Math.round(track.volume * 100)}%` } as CSSProperties

  return (
    <li
      className={styles.row}
      style={style}
      data-selected={selected}
      data-dim={!audible}
      data-muted={track.muted}
      onClick={() => engine.selectTrack(track.id)}
    >
      <button type="button" className={styles.select} aria-pressed={selected} aria-label={`Select ${track.name}`}>
        <LoopRing track={track} />
        <span className={styles.text}>
          <span className={styles.name}>{track.name}</span>
          <span className={styles.kind}>{kindLabel(track)}</span>
        </span>
      </button>
      <div className={styles.lane} data-dim={!audible}>
        <LoopLane track={track} />
      </div>
      <button
        type="button"
        className={`mono ${styles.ms}`}
        data-kind="mute"
        aria-pressed={track.muted}
        aria-label={`Mute ${track.name}`}
        onClick={(e) => {
          e.stopPropagation()
          engine.setTrack(track.id, { muted: !track.muted })
        }}
      >
        M
      </button>
      <button
        type="button"
        className={`mono ${styles.ms}`}
        data-kind="solo"
        aria-pressed={track.soloed}
        aria-label={`Solo ${track.name}`}
        onClick={(e) => {
          e.stopPropagation()
          engine.setTrack(track.id, { soloed: !track.soloed })
        }}
      >
        S
      </button>
      <input
        type="range"
        className={styles.volume}
        min={0}
        max={1}
        step={0.01}
        value={track.volume}
        aria-label={`${track.name} volume`}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => engine.setTrack(track.id, { volume: Number(e.target.value) })}
      />
      <div className={styles.meter} aria-hidden="true">
        <div ref={(el) => registerMeter(track.id, el)} className={styles.meterFill} />
      </div>
    </li>
  )
}
