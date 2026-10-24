"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  SAMPLE_CATALOG,
  SAMPLE_TYPES,
  SAMPLE_TYPE_LABELS,
  findSample,
  keyLabel,
  modeName,
  searchSamples,
  sortSamples,
  statedKeys,
  type SampleLoop,
  type SampleType,
} from "@/lib/samples/library"
import type { Mode } from "@/lib/harmony/types"
import { MAX_TRACKS } from "@/lib/audio/types"
import { useEngine } from "./useEngine"
import { Play, Stop, X } from "./icons"
import styles from "./Samples.module.css"

type KeyFilter = "any" | "fits" | string

const GROUP_TITLES = (project: string) => [`In key · ${project}`, "Always fits · drums have no key", `Clashes with ${project}`]

/**
 * The sample shelf. Loops are listed with the key their pack states, judged against the project key
 * from their actual notes, and sorted so compatible loops come first. Clashing loops say exactly which
 * note is outside the key before you can add one. Nothing is detected or guessed.
 */
export default function Samples() {
  const { engine, snap } = useEngine()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [type, setType] = useState<"all" | SampleType>("all")
  const [keyFilter, setKeyFilter] = useState<KeyFilter>("any")
  const [modeFilter, setModeFilter] = useState<string>("any")
  const [added, setAdded] = useState<string[]>([])
  const searchRef = useRef<HTMLInputElement>(null)

  const projectKey = snap.harmony.key
  const project = keyLabel(projectKey)
  const atMax = snap.tracks.length >= MAX_TRACKS
  const auditioningId = snap.audition?.sampleId ?? null
  const auditioningSample = auditioningId ? findSample(auditioningId) : undefined

  const closeShelf = () => {
    engine.stopAudition()
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    searchRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        engine.stopAudition()
        setOpen(false)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, engine])

  const keys = useMemo(() => {
    const seen = new Map<string, string>()
    for (const k of statedKeys()) seen.set(k.tonic, keyLabel(k).split(" ")[0])
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [])

  const modes = useMemo(() => {
    const seen = new Set<Mode>()
    for (const s of SAMPLE_CATALOG) if (s.key) seen.add(s.key.mode)
    return [...seen]
  }, [])

  const rows = useMemo(() => {
    let list: readonly SampleLoop[] = SAMPLE_CATALOG
    if (type !== "all") list = list.filter((s) => s.type === type)
    if (keyFilter === "fits") list = list.filter((s) => sortSamples([s], projectKey)[0].fit.fit !== "clash")
    else if (keyFilter !== "any") list = list.filter((s) => s.key?.tonic === keyFilter)
    if (modeFilter !== "any") list = list.filter((s) => s.key?.mode === modeFilter)
    return sortSamples(searchSamples(list, query), projectKey)
  }, [type, keyFilter, modeFilter, query, projectKey])

  const togglePreview = (sample: SampleLoop) => {
    if (auditioningId === sample.id) engine.stopAudition()
    else engine.auditionSample(sample.id)
  }

  // A filtered-out preview would have no visible Stop control, so it stops rather than keeps sounding.
  useEffect(() => {
    if (!open || !auditioningId) return
    if (!rows.some((row) => row.sample.id === auditioningId)) engine.stopAudition()
  }, [open, auditioningId, rows, engine])

  const add = (sample: SampleLoop) => {
    const id = engine.addSampleTrack(sample.id)
    if (!id) return
    engine.selectTrack(id)
    setAdded((prev) => (prev.includes(sample.id) ? prev : [...prev, sample.id]))
  }

  const resetFilters = () => {
    setQuery("")
    setType("all")
    setKeyFilter("any")
    setModeFilter("any")
  }

  const filtered = query.trim() !== "" || type !== "all" || keyFilter !== "any" || modeFilter !== "any"

  return (
    <>
      <button type="button" className={styles.shelfButton} onClick={() => setOpen(true)}>
        Browse samples <span className={`mono ${styles.count}`}>{SAMPLE_CATALOG.length}</span>
      </button>

      {open && (
        <div className={styles.overlay} role="presentation" onPointerDown={(e) => e.target === e.currentTarget && closeShelf()}>
          <div className={styles.panel} role="dialog" aria-modal="true" aria-labelledby="samples-title" data-testid="sample-shelf">
            <div className={styles.head}>
              <div>
                <h2 id="samples-title" className={styles.title}>
                  Samples
                </h2>
                <p className={styles.lede}>
                  Ready-made loops, rendered by LoopCraft&rsquo;s own instruments. Sorted for <strong>{project}</strong>: compatible loops first.
                </p>
              </div>
              <button type="button" className={styles.close} aria-label="Close samples" onClick={closeShelf}>
                <X size={18} />
              </button>
            </div>
            <span className={styles.srOnly} role="status" aria-live="polite">
              {auditioningSample
                ? `Previewing ${auditioningSample.name}${auditioningSample.key ? `, ${keyLabel(auditioningSample.key)}` : ", no pitch"}.`
                : ""}
            </span>

            <div className={styles.controls}>
              <input
                ref={searchRef}
                type="search"
                className={styles.search}
                placeholder="Search name or tag (rhodes, funk, bells…)"
                aria-label="Search samples"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className={styles.filterRow}>
                <div className={styles.seg} role="group" aria-label="Sample type">
                  <button type="button" className={styles.segBtn} aria-pressed={type === "all"} onClick={() => setType("all")}>
                    All
                  </button>
                  {SAMPLE_TYPES.map((t) => (
                    <button key={t} type="button" className={styles.segBtn} aria-pressed={type === t} onClick={() => setType(t)}>
                      {SAMPLE_TYPE_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>
              <div className={styles.filterRow}>
                <div className={styles.chipGroup} role="group" aria-label="Filter by key">
                  <span className={styles.chipLabel}>Key</span>
                  <button type="button" className={styles.chip} aria-pressed={keyFilter === "any"} onClick={() => setKeyFilter("any")}>
                    Any
                  </button>
                  <button type="button" className={styles.chip} aria-pressed={keyFilter === "fits"} onClick={() => setKeyFilter("fits")}>
                    Fits {project}
                  </button>
                  {keys.map(([tonic, label]) => (
                    <button key={tonic} type="button" className={styles.chip} aria-pressed={keyFilter === tonic} onClick={() => setKeyFilter(tonic)}>
                      {label}
                    </button>
                  ))}
                </div>
                <div className={styles.chipGroup} role="group" aria-label="Filter by mode">
                  <span className={styles.chipLabel}>Mode</span>
                  <button type="button" className={styles.chip} aria-pressed={modeFilter === "any"} onClick={() => setModeFilter("any")}>
                    Any
                  </button>
                  {modes.map((m) => (
                    <button key={m} type="button" className={styles.chip} aria-pressed={modeFilter === m} onClick={() => setModeFilter(m)}>
                      {modeName(m)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className={styles.listWrap}>
              {rows.length === 0 ? (
                <div className={styles.empty}>
                  <p>No sample matches that.</p>
                  {filtered && (
                    <button type="button" className={styles.link} onClick={resetFilters}>
                      Clear filters
                    </button>
                  )}
                </div>
              ) : (
                <ul className={styles.list}>
                  {rows.map((row, i) => {
                    const prevGroup = i > 0 ? rows[i - 1].fit.group : -1
                    const isAdded =
                      added.includes(row.sample.id) &&
                      snap.tracks.some((t) => t.kind === "sample" && t.sampleId === row.sample.id)
                    return (
                      <li key={row.sample.id} className={styles.item}>
                        {row.fit.group !== prevGroup && (
                          <h3 className={styles.groupTitle} data-fit={row.fit.fit}>
                            {GROUP_TITLES(project)[row.fit.group]}
                          </h3>
                        )}
                        <div className={styles.row} data-fit={row.fit.fit} data-previewing={auditioningId === row.sample.id ? "true" : undefined}>
                          <div className={styles.info}>
                            <span className={styles.rowHead}>
                              <span className={styles.name}>{row.sample.name}</span>
                              <span className={styles.badge} data-fit={row.fit.fit}>
                                {row.fit.label}
                              </span>
                            </span>
                            <span className={styles.meta}>
                              Synth loop · {SAMPLE_TYPE_LABELS[row.sample.type]} · {row.sample.key ? keyLabel(row.sample.key) : "no pitch"} · {row.sample.bars === 1 ? "1 bar" : `${row.sample.bars} bars`}
                            </span>
                            <span className={styles.reason}>{row.fit.reason}</span>
                          </div>
                          <button
                            type="button"
                            className={styles.preview}
                            aria-pressed={auditioningId === row.sample.id}
                            aria-label={
                              auditioningId === row.sample.id
                                ? `Stop preview of ${row.sample.name}`
                                : `Preview ${row.sample.name}${row.sample.key ? `, ${keyLabel(row.sample.key)}` : ", no pitch"}`
                            }
                            title={auditioningId === row.sample.id ? "Stop preview" : "Preview without adding it to the session"}
                            onClick={() => togglePreview(row.sample)}
                          >
                            {auditioningId === row.sample.id ? <Stop size={14} /> : <Play size={14} />}
                            <span>{auditioningId === row.sample.id ? "Stop" : "Preview"}</span>
                          </button>
                          <button
                            type="button"
                            className={styles.add}
                            disabled={atMax || isAdded}
                            title={atMax ? "Up to 8 tracks" : undefined}
                            aria-label={row.fit.fit === "clash" ? `Add ${row.sample.name} anyway, it clashes with ${project}` : `Add ${row.sample.name} to the session`}
                            onClick={() => add(row.sample)}
                          >
                            {isAdded ? "Added" : row.fit.fit === "clash" ? "Add anyway" : "Add"}
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            <p className={styles.provenance}>
              A loop&rsquo;s key is stated by the pack that wrote it and checked against its notes; LoopCraft never detects or guesses a key. Recorded
              loops never get a key label.
            </p>
          </div>
        </div>
      )}
    </>
  )
}
