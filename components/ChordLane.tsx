"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from "react"
import { chordAt, chordSymbol, formatNoteName, harmonicFunction, romanNumeral, slotInLoop } from "@/lib/harmony/theory"
import { suggestNext } from "@/lib/harmony/suggest"
import type { ChordSuggestion, Mode } from "@/lib/harmony/types"
import { useAnimationFrame, setModalOpen, useEngine } from "./useEngine"
import styles from "./ChordLane.module.css"

const TONICS = [
  { value: "C", label: "C" },
  { value: "Db", label: "D♭" },
  { value: "D", label: "D" },
  { value: "Eb", label: "E♭" },
  { value: "E", label: "E" },
  { value: "F", label: "F" },
  { value: "F#", label: "F♯" },
  { value: "G", label: "G" },
  { value: "Ab", label: "A♭" },
  { value: "A", label: "A" },
  { value: "Bb", label: "B♭" },
  { value: "B", label: "B" },
]

const MODE_LABELS: Record<Mode, string> = {
  ionian: "Major · ionian",
  aeolian: "Minor · aeolian",
  dorian: "Dorian",
  phrygian: "Phrygian",
  lydian: "Lydian",
  mixolydian: "Mixolydian",
  locrian: "Locrian",
  "harmonic-minor": "Harmonic minor",
  "melodic-minor": "Melodic minor",
}

const MODE_ORDER: Mode[] = ["ionian", "aeolian", "dorian", "phrygian", "lydian", "mixolydian", "locrian", "harmonic-minor", "melodic-minor"]

const CATEGORY_LABELS: Record<ChordSuggestion["category"], string> = {
  diatonic: "Diatonic",
  "secondary-dominant": "Secondary dominant",
  "modal-interchange": "Borrowed",
  "tritone-sub": "Tritone sub",
  deceptive: "Deceptive",
}

export default function ChordLane() {
  const { engine, snap } = useEngine()
  const { harmony } = snap
  const { key, chords } = harmony
  const bars = snap.bars
  const [open, setOpen] = useState<number | null>(null)
  const [draft, setDraft] = useState("")
  const [error, setError] = useState(false)
  const slotRefs = useRef<(HTMLButtonElement | null)[]>([])
  const dialogRef = useRef<HTMLDivElement>(null)
  const heard = useRef(-1)

  // Mark the slot being heard: DOM attribute only, never React state (runs every frame).
  useAnimationFrame(() => {
    const pos = engine.getClock().position
    let idx = -1
    if (pos && chords.length) {
      const slot = chordAt(harmony, pos.step / 4)
      idx = chords.findIndex((c) => c.start === slot.start)
    }
    if (idx === heard.current) return
    heard.current = idx
    slotRefs.current.forEach((el, i) => {
      if (!el) return
      if (i === idx) el.setAttribute("data-playing", "true")
      else el.removeAttribute("data-playing")
    })
  })

  const index = open !== null && open < chords.length ? open : null

  const close = useCallback(
    (restoreFocus: boolean) => {
      const i = open
      setOpen(null)
      setDraft("")
      setError(false)
      if (restoreFocus && i !== null) slotRefs.current[i]?.focus()
    },
    [open],
  )

  // Outside click closes (the slot itself toggles via its own onClick).
  useEffect(() => {
    if (index === null) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null
      if (!t || dialogRef.current?.contains(t) || slotRefs.current[index]?.contains(t)) return
      close(false)
    }
    document.addEventListener("pointerdown", onDown)
    return () => document.removeEventListener("pointerdown", onDown)
  }, [index, close])

  // Focus the first suggestion when the popover opens (not the dialog container), close on Escape
  // wherever focus is, and gate the global single-key shortcuts while it is up.
  useEffect(() => {
    if (index === null) return
    setModalOpen(true)
    const first = dialogRef.current?.querySelector<HTMLButtonElement>("[data-chord-suggestion]")
    ;(first ?? dialogRef.current)?.focus()
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.preventDefault()
      e.stopPropagation()
      close(true)
    }
    document.addEventListener("keydown", onKey, true)
    return () => {
      setModalOpen(false)
      document.removeEventListener("keydown", onKey, true)
    }
  }, [index, close])

  const suggestions = useMemo(() => {
    if (index === null) return []
    const n = chords.length
    const prev = chords[(index - 1 + n) % n].chord
    const next = n > 1 ? chords[(index + 1) % n].chord : null
    return suggestNext(key, prev, next, 6)
  }, [index, chords, key])

  const onDialogKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // A held Enter that opened the popover must not repeat into the newly focused suggestion.
    if (e.repeat && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault()
      e.stopPropagation()
      return
    }
    if (e.key === "Tab") {
      const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button, input") ?? []).filter((el) => !el.hasAttribute("disabled"))
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === dialogRef.current)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    // Keep typing and activation keys from reaching the global single-key shortcuts.
    if (!e.ctrlKey && !e.metaKey && !e.altKey) e.nativeEvent.stopPropagation()
  }

  const choose = (s: ChordSuggestion) => {
    if (index === null) return
    engine.setChord(index, romanNumeral(key, s.chord, true))
    close(true)
  }

  const apply = (e: FormEvent) => {
    e.preventDefault()
    if (index === null) return
    if (engine.setChord(index, draft.trim())) close(true)
    else setError(true)
  }

  const tonicValue = formatNoteName(key.tonic, true)
  const tonics = TONICS.some((t) => t.value === tonicValue) ? TONICS : [...TONICS, { value: tonicValue, label: formatNoteName(key.tonic) }]
  const bar = (i: number) => Math.floor(chords[i].start / harmony.beatsPerBar) + 1

  return (
    <section className={styles.lane} aria-label="Chords">
      <div className={styles.key} role="group" aria-label="Key">
        <select className={styles.select} aria-label="Tonic" value={tonicValue} onChange={(e) => engine.setKey(e.target.value, key.mode)}>
          {tonics.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <select className={styles.select} aria-label="Mode" value={key.mode} onChange={(e) => engine.setKey(tonicValue, e.target.value as Mode)}>
          {MODE_ORDER.map((m) => (
            <option key={m} value={m}>
              {MODE_LABELS[m]}
            </option>
          ))}
        </select>
      </div>
      <div className={styles.slots} style={{ "--n": chords.length } as CSSProperties}>
        {chords.map((slot, i) => {
          const symbol = chordSymbol(key, slot.chord)
          const roman = romanNumeral(key, slot.chord)
          const outside = !slotInLoop(harmony, slot, bars)
          return (
            <button
              key={slot.start}
              ref={(el) => {
                slotRefs.current[i] = el
              }}
              type="button"
              className={styles.slot}
              data-fn={harmonicFunction(key, slot.chord)}
              data-open={index === i}
              data-out-of-loop={outside || undefined}
              aria-label={`Bar ${bar(i)}, ${symbol}, ${roman}${outside ? `, outside the ${bars}-bar loop` : ""}`}
              aria-haspopup="dialog"
              aria-expanded={index === i}
              disabled={outside}
              title={outside ? `Outside the ${bars}-bar loop. Lengthen the loop to use this chord.` : undefined}
              onKeyDown={(e) => {
                if (e.repeat && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault()
                  e.stopPropagation()
                }
              }}
              onClick={() => {
                if (index === i) close(true)
                else {
                  setDraft("")
                  setError(false)
                  setOpen(i)
                }
              }}
            >
              <span className={styles.symbol}>{symbol}</span>
              <span className={`mono ${styles.roman}`}>{roman}</span>
            </button>
          )
        })}
      </div>
      {chords.length > bars && (
        <p className={styles.note}>
          Chords in bars {bars + 1}–{chords.length} are outside the {bars}-bar loop. Lengthen the loop to use them.
        </p>
      )}
      {index !== null && (
        <div
          ref={dialogRef}
          className={styles.popover}
          role="dialog"
          aria-modal="true"
          aria-label={`Change chord in bar ${bar(index)}`}
          tabIndex={-1}
          style={{ "--i": index, "--n": chords.length } as CSSProperties}
          data-align={index * 2 >= chords.length ? "end" : "start"}
          onKeyDown={onDialogKeyDown}
        >
          <ul className={styles.list}>
            {suggestions.map((s) => (
              <li key={`${s.roman}-${s.category}`}>
                <button type="button" className={styles.row} data-chord-suggestion onClick={() => choose(s)}>
                  <span className={styles.rowHead}>
                    <span className={styles.rowSymbol}>{chordSymbol(key, s.chord)}</span>
                    <span className={`mono ${styles.rowRoman}`}>{s.roman}</span>
                    <span className={styles.chip}>{CATEGORY_LABELS[s.category]}</span>
                  </span>
                  <span className={styles.reason}>{s.reason}</span>
                </button>
              </li>
            ))}
          </ul>
          <form className={styles.form} onSubmit={apply} noValidate>
            <input
              className={styles.input}
              value={draft}
              aria-label="Type a numeral (ii7, V7/V, ♭VII)"
              placeholder="Type a numeral (ii7, V7/V, ♭VII)"
              aria-invalid={error}
              aria-describedby={error ? "chord-error" : undefined}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              onChange={(e) => {
                setDraft(e.target.value)
                setError(false)
              }}
            />
            <button type="submit" className={styles.apply}>
              Apply
            </button>
          </form>
          {error && (
            <p id="chord-error" className={styles.error} role="alert">
              That isn&apos;t a numeral I know.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
