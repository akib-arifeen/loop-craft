"use client"

import { useEffect, useRef, type CSSProperties } from "react"
import { PADS } from "@/lib/audio/patterns"
import { shortcutsEnabled, modalOpen, useEngine, useShortcuts } from "./useEngine"
import styles from "./Pads.module.css"

export default function Pads() {
  const { engine } = useEngine()
  const shortcuts = useShortcuts()
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const timers = useRef<number[]>([])

  const flash = (i: number) => {
    const el = refs.current[i]
    if (!el) return
    el.setAttribute("data-hit", "true")
    window.clearTimeout(timers.current[i])
    timers.current[i] = window.setTimeout(() => el.removeAttribute("data-hit"), 120)
  }

  // Visual feedback for the global A S D F H J K L shortcuts (the engine call itself is made in LoopCraft).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!shortcutsEnabled() || modalOpen() || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return
      const i = PADS.findIndex((p) => p.key === e.key.toLowerCase())
      if (i >= 0) flash(i)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <div className={styles.root}>
      <div className={styles.grid}>
        {PADS.map((p, i) => (
          <button
            key={p.label + i}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            className={styles.pad}
            style={{ "--pt": i < 4 ? "var(--track-1)" : "var(--track-4)" } as CSSProperties}
            aria-label={`Pad ${p.label}`}
            aria-keyshortcuts={shortcuts ? p.key.toUpperCase() : undefined}
            onPointerDown={() => {
              engine.pad(i)
              flash(i)
            }}
            onClick={(e) => {
              // detail 0 = keyboard / assistive-tech activation; pointer taps already fired on pointerdown
              if (e.detail === 0) {
                engine.pad(i)
                flash(i)
              }
            }}
          >
            <span className={styles.padLabel}>{p.label}</span>
            <span className={`mono ${styles.padKey}`}>{p.key.toUpperCase()}</span>
          </button>
        ))}
      </div>
      <p className={styles.hint}>{shortcuts ? "Keys A S D F · H J K L play the pads" : "Keyboard shortcuts are off"}</p>
    </div>
  )
}
