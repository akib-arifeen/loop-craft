"use client"

import { Play } from "./icons"
import { startDemo, useEngine } from "./useEngine"
import styles from "./StartGate.module.css"

export default function StartGate() {
  const { engine, snap } = useEngine()
  if (snap.status !== "idle" && snap.status !== "starting" && snap.status !== "error") return null
  const starting = snap.status === "starting"

  return (
    <div className={styles.overlay}>
      <div className={styles.card} role="dialog" aria-modal="true" aria-labelledby="gate-title">
        <h2 id="gate-title" className={styles.wordmark}>
          LoopCraft
        </h2>
        <p className={styles.lede}>A multi-track looper that runs in your browser.</p>
        {snap.status === "error" ? (
          <p className={styles.error} role="alert">
            {snap.error ?? "Audio is not available in this browser."}
          </p>
        ) : (
          <>
            <button type="button" className={styles.primary} disabled={starting} onClick={() => startDemo(engine)}>
              {!starting && <Play />}
              {starting ? "Starting…" : "Play the demo"}
            </button>
            <p className={styles.hint}>No mic needed · headphones recommended</p>
          </>
        )}
      </div>
    </div>
  )
}
