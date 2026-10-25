"use client"

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react"
import { getEngine, type LoopEngine } from "@/lib/audio/engine"
import type { EngineSnapshot } from "@/lib/audio/types"

export function useEngine(): { engine: LoopEngine; snap: EngineSnapshot } {
  const engine = getEngine()
  const subscribe = useCallback((listener: () => void) => engine.subscribe(listener), [engine])
  const getSnapshot = useCallback(() => engine.getSnapshot(), [engine])
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return { engine, snap }
}

/** Runs `cb` every animation frame; cancelled on unmount. `cb` must write to refs/DOM, never to React state. */
export function useAnimationFrame(cb: (time: number) => void): void {
  const ref = useRef(cb)
  useEffect(() => {
    ref.current = cb
  })
  useEffect(() => {
    let id = 0
    const loop = (t: number) => {
      ref.current(t)
      id = requestAnimationFrame(loop)
    }
    id = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(id)
  }, [])
}

// Single-key shortcuts on/off (WCAG 2.1.4). Module-level so Transport, LoopCraft and Pads share it.
const SHORTCUTS_KEY = "loopcraft:shortcuts"
let shortcutsOn: boolean | null = null
const shortcutListeners = new Set<() => void>()

function readShortcuts(): boolean {
  if (shortcutsOn === null) {
    try {
      shortcutsOn = localStorage.getItem(SHORTCUTS_KEY) !== "off"
    } catch {
      shortcutsOn = true
    }
  }
  return shortcutsOn
}

export function setShortcuts(on: boolean): void {
  shortcutsOn = on
  try {
    localStorage.setItem(SHORTCUTS_KEY, on ? "on" : "off")
  } catch {
    // storage unavailable: the choice lasts for this page view only
  }
  shortcutListeners.forEach((l) => l())
}

export function shortcutsEnabled(): boolean {
  return readShortcuts()
}

// While a modal dialog is open the global single-key shortcuts (Space, 1-8, R, M, pads) must not
// fire behind it. Modal components register here for as long as they are open.
let modalDepth = 0
export function setModalOpen(open: boolean): void {
  modalDepth = Math.max(0, modalDepth + (open ? 1 : -1))
}
export function modalOpen(): boolean {
  return modalDepth > 0
}

export function useShortcuts(): boolean {
  return useSyncExternalStore(
    (l) => {
      shortcutListeners.add(l)
      return () => void shortcutListeners.delete(l)
    },
    readShortcuts,
    () => true,
  )
}

export function trackColor(index: number): string {
  return `var(--track-${(index % 8) + 1})`
}

/** Start the engine from a user gesture; applies a `#s=` share code first. Must run synchronously inside the gesture. */
export function startDemo(engine: LoopEngine): void {
  if (location.hash.startsWith("#s=")) engine.loadShare(location.hash.slice(3))
  void engine.start({ autoplay: true })
}

/** Record button / R shortcut: cancel when busy, else arm the selected audio track (or the first, or a new one). */
export function toggleRecord(engine: LoopEngine, snap: EngineSnapshot): void {
  if (snap.record.kind !== "idle") {
    engine.cancelRecord()
    return
  }
  const selected = snap.tracks.find((t) => t.id === snap.selectedTrackId)
  const target = selected?.kind === "audio" ? selected : snap.tracks.find((t) => t.kind === "audio")
  const id = target ? target.id : engine.addAudioTrack()
  if (!id) return
  if (id !== snap.selectedTrackId) engine.selectTrack(id)
  void engine.record(id)
}
